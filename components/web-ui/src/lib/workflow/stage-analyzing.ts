import fs from 'fs';
import path from 'path';
import { getChatSession, getProject, getChatDir, getProjectModels } from '@/lib/db';
import { serveRegistry } from '@/lib/opencode-serve-registry';
import { transitionTo } from './index';
import { stageWsManager } from '@/lib/stage-ws-manager';
import { loggerService } from '@/lib/logger-service';
import { getSkillsDir } from '@/lib/skills';

export async function handleAnalyzing(chatId: number): Promise<void> {
  loggerService.appendVerbose(chatId, 'workflow:analyzing', `Initializing`);
  const chat = getChatSession(chatId);
  if (!chat) {
    loggerService.appendVerbose(chatId, 'workflow:analyzing', `Chat ${chatId} not found`);
    return;
  }

  const chatDir = getChatDir(chatId, chat.project_id);
  const project = getProject(chat.project_id);
  if (!project) {
    loggerService.appendVerbose(chatId, 'workflow:analyzing', `Project ${chat.project_id} not found`);
    return;
  }

  const repoDir = path.join(chatDir, 'repository');

  if (!fs.existsSync(chatDir) || !fs.existsSync(repoDir)) {
    loggerService.appendVerbose(chatId, 'workflow:analyzing', `chat dir or repo dir missing`);
    transitionTo(chatId, 'analyzing', 'error');
    return;
  }

  loggerService.appendVerbose(chatId, 'workflow:analyzing', `Creating OpenCode server session`);
  const client = serveRegistry.getOrCreate(chatId, chatDir, process.env);

  await client.ensureStarted().catch((err) => {
    loggerService.appendVerbose(chatId, 'workflow:analyzing', `Server start failed: ${err.message}`);
    transitionTo(chatId, 'analyzing', 'error');
  });

  if (chat.sub_stage === '') {
    transitionTo(chatId, 'analyzing', 'analyzing');
    stageWsManager.broadcastToStage(chatId, 'analyzing', { type: 'sub_stage', sub_stage: 'analyzing' });
    return;
  }

  if (chat.sub_stage === 'analyzing') {
    loggerService.appendVerbose(chatId, 'workflow:analyzing', `Starting analysis`);
    const models = getProjectModels(project.id);
    const sessionId = await client.createSession();
    serveRegistry.setSession(chatId, 'analyzing', sessionId);

    const promptTemplate = fs.readFileSync(
      path.join(process.cwd(), 'prompts', 'plan-analyze.md'),
      'utf-8'
    );
    const prompt = promptTemplate
      .replace(/{CHAT_DIR}/g, chatDir)
      .replace(/{REPO_DIR}/g, repoDir)
      .replace(/{SKILLS_DIR}/g, getSkillsDir())
      .replace(/{UPLOAD_DIR}/g, path.join(chatDir, 'uploads'));

    loggerService.appendVerbose(chatId, 'workflow:analyzing', 'Sending plan-analyze prompt');
    loggerService.appendVerbose(chatId, 'workflow:analyzing', prompt);

    try {
      await client.sendMessage(sessionId, prompt, models.analyzer_model);

      const repoContextPath = path.join(repoDir, 'REPOSITORY.md');
      if (fs.existsSync(repoContextPath)) {
        loggerService.appendVerbose(chatId, 'workflow:analyzing', 'Done! Transitioning to next stage.');
        if (chat.mode === 'verify') {
          transitionTo(chatId, 'verify', 'upload');
        } else {
          transitionTo(chatId, 'collecting', 'new');
        }
      } else {
        transitionTo(chatId, 'analyzing', 'error');
      }
    } catch (err) {
      loggerService.appendVerbose(chatId, 'workflow:analyzing', `sendMessage failed: ${err}`);
      transitionTo(chatId, 'analyzing', 'error');
    }
  }
}
