import fs from 'fs';
import path from 'path';
import { getChatSession, getProject, getChatDir, getProjectModels } from '@/lib/db';
import { serveRegistry } from '@/lib/opencode-serve-registry';
import { transitionTo } from './index';
import { loggerService as defaultLoggerService } from '@/lib/logger-service';
import { parseVerifyResponse as parseResponse } from './verify-response-parser';
import { classifyVerifyError } from './verify-error-classifier';
import { getSkillsDir } from '@/lib/skills';

export interface LoggerServiceLike {
    appendVerbose(chatId: number, prefix: string, message: string): void;
    clearChat(chatId: number): void;
    append(chatId: number, line: string): void;
}

let _loggerService: LoggerServiceLike = defaultLoggerService;

export function _setLoggerServiceForTest(service: LoggerServiceLike | null): void {
    _loggerService = service ?? defaultLoggerService;
}

export async function handleVerify(chatId: number): Promise<void> {
  _loggerService.appendVerbose(chatId, 'workflow:verify', `Initializing`);
  const chat = getChatSession(chatId);
  if (!chat) {
    _loggerService.appendVerbose(chatId, 'workflow:verify', `Chat ${chatId} not found`);
    return;
  }

  if (chat.sub_stage === 'upload') {
    _loggerService.appendVerbose(chatId, 'workflow:verify', `Waiting for user upload`);
    return;
  }

  if (chat.sub_stage === 'satisfied') {
    _loggerService.appendVerbose(chatId, 'workflow:verify', `Satisfied state - terminal`);
    return;
  }

  if (chat.sub_stage === 'error') {
    _loggerService.appendVerbose(chatId, 'workflow:verify', `Error state`);
    return;
  }

  if (chat.sub_stage === 'analysis') {
    _loggerService.clearChat(chatId);

    _loggerService.appendVerbose(chatId, 'workflow:verify', 'Starting verify analysis');
    const chatDir = getChatDir(chatId, chat.project_id);
    const repoDir = path.join(chatDir, 'repository');

    if (!fs.existsSync(chatDir) || !fs.existsSync(repoDir)) {
      const { errorType, message } = classifyVerifyError('missing_repository');
      _loggerService.appendVerbose(chatId, 'workflow:verify', message);
      _loggerService.appendVerbose(chatId, 'workflow:verify', 'chat dir or repo dir missing - transitioning to error');
      transitionTo(chatId, 'verify', 'error', { errorType });
      return;
    }

    const project = getProject(chat.project_id);
    if (!project) {
      _loggerService.appendVerbose(chatId, 'workflow:verify', `Project ${chat.project_id} not found - transitioning to error`);
      const { errorType } = classifyVerifyError('unknown');
      transitionTo(chatId, 'verify', 'error', { errorType });
      return;
    }

    const client = serveRegistry.getOrCreate(chatId, chatDir, process.env);

    const started = await client.ensureStarted().then(() => true).catch(() => null);
    if (!started) {
      _loggerService.appendVerbose(chatId, 'workflow:verify', `OpenCode session creation failed`);
      const { errorType } = classifyVerifyError('session_start_failure');
      transitionTo(chatId, 'verify', 'error', { errorType });
      return;
    }

    _loggerService.appendVerbose(chatId, 'workflow:verify', 'OpenCode session created');

    const models = getProjectModels(project.id);

    _loggerService.appendVerbose(chatId, 'workflow:verify', 'Loading verify prompt');
    const existingSession = serveRegistry.getSession(chatId, 'verify');
    if (existingSession) {
      await serveRegistry.abortSession(chatId, existingSession);
    }

    let sessionId: string;
    try {
      sessionId = await client.createSession();
    } catch (err) {
      _loggerService.appendVerbose(chatId, 'workflow:verify', `createSession failed: ${err}`);
      const { errorType } = classifyVerifyError('session_start_failure');
      transitionTo(chatId, 'verify', 'error', { errorType });
      return;
    }
    serveRegistry.setSession(chatId, 'verify', sessionId);

    const originalRequirementPath = path.join(chatDir, 'ORIGINAL_REQUIREMENT.md');
    let originalRequirementContent = '';
    try {
      if (fs.existsSync(originalRequirementPath)) {
        originalRequirementContent = fs.readFileSync(originalRequirementPath, 'utf-8');
        _loggerService.appendVerbose(chatId, 'workflow:verify', 'ORIGINAL_REQUIREMENT.md read successfully');
      } else {
        _loggerService.appendVerbose(chatId, 'workflow:verify', 'ORIGINAL_REQUIREMENT.md not found or unreadable');
      }
    } catch (err) {
      _loggerService.appendVerbose(chatId, 'workflow:verify', `Failed to read ORIGINAL_REQUIREMENT.md: ${err}`);
      const { errorType } = classifyVerifyError('missing_original_requirement');
      transitionTo(chatId, 'verify', 'error', { errorType });
      return;
    }

    let promptTemplate: string;
    try {
      promptTemplate = fs.readFileSync(
        path.join(process.cwd(), 'prompts', 'verify-analysis.md'),
        'utf-8'
      );
    } catch (err) {
      _loggerService.appendVerbose(chatId, 'workflow:verify', `Failed to read verify-analysis.md prompt: ${err}`);
      const { errorType } = classifyVerifyError('unknown');
      transitionTo(chatId, 'verify', 'error', { errorType });
      return;
    }

    const prompt = promptTemplate
      .replace(/{CHAT_DIR}/g, chatDir)
      .replace(/{REPO_DIR}/g, repoDir)
      .replace(/{SKILLS_DIR}/g, getSkillsDir())
      .replace(/{ORIGINAL_REQUIREMENT_CONTENT}/g, originalRequirementContent);

    _loggerService.appendVerbose(chatId, 'workflow:verify', `Sending verify prompt (${prompt.length} chars)`);

    try {
      const result = await client.sendMessage(sessionId, prompt, models.analyzer_model);
      const textPart = result.parts.find((p: { type?: string }) => p.type === 'text');
      const resultText = textPart?.text?.trim() ?? '';

      _loggerService.appendVerbose(chatId, 'workflow:verify', 'LLM response received');

      const parsed = parseResponse(resultText);
      if (parsed.error) {
        _loggerService.appendVerbose(chatId, 'workflow:verify', `Parse failure - ${parsed.error}`);
        const { errorType } = classifyVerifyError('parse_failure');
        transitionTo(chatId, 'verify', 'error', { errorType });
        return;
      }

      if (parsed.satisfied) {
        _loggerService.appendVerbose(chatId, 'workflow:verify', 'Verdict: satisfied');
        transitionTo(chatId, 'verify', 'satisfied');
        return;
      }

      _loggerService.appendVerbose(chatId, 'workflow:verify', 'Verdict: unsatisfied');

      const requirementPath = path.join(chatDir, 'REQUIREMENT.md');
      if (!fs.existsSync(requirementPath)) {
        _loggerService.appendVerbose(chatId, 'workflow:verify', `LLM returned satisfied:false but REQUIREMENT.md was not created`);
        const { errorType } = classifyVerifyError('missing_requirement_file');
        transitionTo(chatId, 'verify', 'error', { errorType });
        return;
      }

      let requirementContent: string;
      try {
        requirementContent = fs.readFileSync(requirementPath, 'utf-8');
      } catch (err) {
        _loggerService.appendVerbose(chatId, 'workflow:verify', `Failed to read REQUIREMENT.md: ${err}`);
        const { errorType } = classifyVerifyError('missing_requirement_file');
        transitionTo(chatId, 'verify', 'error', { errorType });
        return;
      }

      if (!requirementContent.trim()) {
        _loggerService.appendVerbose(chatId, 'workflow:verify', `REQUIREMENT.md exists but is empty`);
        const { errorType } = classifyVerifyError('missing_requirement_file');
        transitionTo(chatId, 'verify', 'error', { errorType });
        return;
      }

      _loggerService.appendVerbose(chatId, 'workflow:verify', 'REQUIREMENT.md generated, transitioning to requirement stage');
      transitionTo(chatId, 'requirement', 'requirement');
    } catch (err) {
      _loggerService.appendVerbose(chatId, 'workflow:verify', `sendMessage failed: ${err}`);
      const { errorType } = classifyVerifyError('llm_error');
      transitionTo(chatId, 'verify', 'error', { errorType });
    }
    return;
  }

  _loggerService.appendVerbose(chatId, 'workflow:verify', `Unknown sub_stage: ${chat.sub_stage} - no-op`);
}