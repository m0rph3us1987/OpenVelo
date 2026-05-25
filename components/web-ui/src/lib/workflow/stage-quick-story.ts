import fs from 'fs';
import path from 'path';
import { getChatSession, getProject, getChatDir, getProjectModels, insertPlanEpic, insertPlanFeature, insertPlanStory, deletePlanDataByChatId } from '@/lib/db';
import { serveRegistry } from '@/lib/opencode-serve-registry';
import { transitionTo } from './index';
import { stageWsManager } from '@/lib/stage-ws-manager';
import { loggerService } from '@/lib/logger-service';
import { getSkillsDir } from '@/lib/skills';

interface QuickStoryResult {
  epic: {
    index: number;
    title: string;
    description: string;
    content: string;
  };
  feature: {
    epic_index: number;
    epic_title: string;
    feature_index: number;
    title: string;
    description: string;
    content: string;
  };
  story: {
    epic_index: number;
    epic_title: string;
    feature_index: number;
    feature_title: string;
    story_index: number;
    title: string;
    description: string;
    acceptance_criteria: string;
  };
}

async function parseJsonWithRetry(
  client: { sendMessage: (sessionId: string, prompt: string, model: string) => Promise<{ parts: Array<{ type: string; text?: string }> }> },
  sessionId: string,
  resultText: string,
  modelKey: keyof { analyzer_model: string; planning_model: string; requirement_model: string; chat_model: string },
  models: { analyzer_model: string; planning_model: string; requirement_model: string; chat_model: string },
  maxAttempts: number = 3
): Promise<{ parsed: QuickStoryResult | null; finalText: string }> {
  const extractJson = (text: string): QuickStoryResult | null => {
    const stripped = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();

    try {
      return JSON.parse(stripped) as QuickStoryResult;
    } catch {
      const jsonMatch = stripped.match(new RegExp(`\\{[\\s\\S]*"epic"[\\s\\S]*\\}`));
      if (jsonMatch) {
        try {
          return JSON.parse(jsonMatch[0]) as QuickStoryResult;
        } catch {
          return null;
        }
      }
      return null;
    }
  };

  const parsed = extractJson(resultText);
  if (parsed) {
    return { parsed, finalText: resultText };
  }

  const correctionModel = models[modelKey];

  for (let attempt = 1; attempt < maxAttempts; attempt++) {
    loggerService.appendVerbose(0, 'workflow:quick-story', `JSON parse failed, attempt ${attempt}/${maxAttempts}, requesting correction`);
    const correctionPrompt = `The JSON you returned was malformed or incomplete. Return ONLY valid JSON with no additional text. Previous response was:\n${resultText.substring(0, 2000)}\n\nReturn only the corrected JSON.`;

    try {
      const corrected = await client.sendMessage(sessionId, correctionPrompt, correctionModel);
      const correctedText = corrected.parts.find((p: { type?: string }) => p.type === 'text')?.text?.trim() ?? '';
      const correctedParsed = extractJson(correctedText);
      if (correctedParsed) {
        return { parsed: correctedParsed, finalText: correctedText };
      }
    } catch (err) {
      loggerService.appendVerbose(0, 'workflow:quick-story', `Correction request failed: ${err}`);
    }
  }

  return { parsed: null, finalText: resultText };
}

export async function handleQuickStory(chatId: number): Promise<void> {
  loggerService.appendVerbose(chatId, 'workflow:quick-story', `Initializing`);
  const chat = getChatSession(chatId);
  if (!chat) {
    loggerService.appendVerbose(chatId, 'workflow:quick-story', `Chat ${chatId} not found`);
    return;
  }

  const chatDir = getChatDir(chatId, chat.project_id);
  const project = getProject(chat.project_id);
  if (!project) {
    loggerService.appendVerbose(chatId, 'workflow:quick-story', `Project ${chat.project_id} not found`);
    return;
  }

  const repoDir = path.join(chatDir, 'repository');

  if (!fs.existsSync(chatDir) || !fs.existsSync(repoDir)) {
    loggerService.appendVerbose(chatId, 'workflow:quick-story', `chat dir or repo dir missing`);
    transitionTo(chatId, 'quick_story', 'error');
    return;
  }

  if (chat.sub_stage === '') {
    loggerService.appendVerbose(chatId, 'workflow:quick-story', `Starting quick story generation`);
    transitionTo(chatId, 'quick_story', 'generate');
    stageWsManager.broadcastToStage(chatId, 'quick_story', { type: 'sub_stage', sub_stage: 'generate' });
    return;
  }

  if (chat.sub_stage === 'generate') {
    await handleGenerate(chatId, chatDir, repoDir, project.id);
    return;
  }

  if (chat.sub_stage === 'error') {
    loggerService.appendVerbose(chatId, 'workflow:quick-story', `Error state`);
    return;
  }
}

async function handleGenerate(chatId: number, chatDir: string, repoDir: string, projectId: number): Promise<void> {
  loggerService.appendVerbose(chatId, 'workflow:quick-story', `Generating quick story`);

  deletePlanDataByChatId(chatId);

  const client = serveRegistry.getOrCreate(chatId, chatDir, process.env);

  await client.ensureStarted().catch((err) => {
    loggerService.appendVerbose(chatId, 'workflow:quick-story', `Server start failed: ${err.message}`);
    transitionTo(chatId, 'quick_story', 'error');
    return;
  });

  const models = getProjectModels(projectId);
  const sessionId = await client.createSession();
  serveRegistry.setSession(chatId, 'quick-story', sessionId);

  const repoContextPath = path.join(repoDir, 'REPOSITORY.md');
  let repoContext = '';
  if (fs.existsSync(repoContextPath)) {
    repoContext = fs.readFileSync(repoContextPath, 'utf-8');
  }

  const requirementPath = path.join(chatDir, 'REQUIREMENT.md');
  if (!fs.existsSync(requirementPath)) {
    loggerService.appendVerbose(chatId, 'workflow:quick-story', `REQUIREMENT.md not found`);
    transitionTo(chatId, 'quick_story', 'error');
    return;
  }

  const promptTemplate = fs.readFileSync(
    path.join(process.cwd(), 'prompts', 'plan-quickstory.md'),
    'utf-8'
  );

  const prompt = promptTemplate
    .replace(/{CHAT_DIR}/g, chatDir)
    .replace(/{REPO_DIR}/g, repoDir)
    .replace(/{SKILLS_DIR}/g, getSkillsDir())
    .replace(/{UPLOAD_DIR}/g, path.join(chatDir, 'uploads'))
    .replace(/{REPO_CONTEXT}/g, repoContext)
    .replace(/{REQUIREMENT_MD_PATH}/g, requirementPath);

  loggerService.appendVerbose(chatId, 'workflow:quick-story', 'Sending quick story prompt');

  try {
    const result = await client.sendMessage(sessionId, prompt, models.planning_model);

    const textPart = result.parts.find((p: { type?: string }) => p.type === 'text');
    const resultText = textPart?.text?.trim() ?? '';

    const { parsed, finalText } = await parseJsonWithRetry(
      client, sessionId, resultText, 'planning_model', models
    );

    if (!parsed) {
      loggerService.appendVerbose(chatId, 'workflow:quick-story', `Failed to parse quick story JSON after retries. Raw response: ${finalText}`);
      transitionTo(chatId, 'quick_story', 'error');
      return;
    }

    if (!parsed.epic || !parsed.feature || !parsed.story) {
      loggerService.appendVerbose(chatId, 'workflow:quick-story', `Invalid quick story result: missing epic, feature, or story`);
      transitionTo(chatId, 'quick_story', 'error');
      return;
    }

    const epicId = insertPlanEpic({
      chat_id: chatId,
      epic_index: parsed.epic.index,
      title: parsed.epic.title,
      description: parsed.epic.description,
      content: parsed.epic.content,
      build_cmd: '',
      test_cmd: '',
    });

    const featureId = insertPlanFeature({
      chat_id: chatId,
      epic_id: epicId,
      feature_index: parsed.feature.feature_index,
      title: parsed.feature.title,
      description: parsed.feature.description,
      content: parsed.feature.content,
    });

    insertPlanStory({
      chat_id: chatId,
      feature_id: featureId,
      story_index: parsed.story.story_index,
      title: parsed.story.title,
      description: parsed.story.description,
      acceptance_criteria: parsed.story.acceptance_criteria,
      depends_on: '[]',
    });

    loggerService.appendVerbose(chatId, 'workflow:quick-story', `Generated quick story successfully`);
    transitionTo(chatId, 'plan', 'plan');
    stageWsManager.broadcastToStage(chatId, 'plan', { type: 'sub_stage', sub_stage: 'plan' });
  } catch (err) {
    loggerService.appendVerbose(chatId, 'workflow:quick-story', `sendMessage failed: ${err}`);
    transitionTo(chatId, 'quick_story', 'error');
  }
}