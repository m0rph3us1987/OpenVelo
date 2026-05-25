import fs from 'fs';
import path from 'path';
import { getChatSession, getProject, getChatDir, getChatMessages, getProjectModels, insertChatMessage, insertMessageOptions } from '@/lib/db';
import { getSkillsDir } from '@/lib/skills';
import { serveRegistry } from '@/lib/opencode-serve-registry';
import { transitionTo } from './index';
import { stageWsManager } from '@/lib/stage-ws-manager';

interface LlmResponse {
  message: string;
  options: Array<{recommended: boolean, option: string}>;
  ready_for_next_stage: boolean;
}

export async function handleFinalAssessment(chatId: number): Promise<void> {
  console.log(`[workflow:final_assessment] Initializing`);
  const chat = getChatSession(chatId);
  if (!chat) {
    console.log(`[workflow:final_assessment] Chat ${chatId} not found`);
    return;
  }

  if (chat.sub_stage === '' || chat.sub_stage === 'new') {
    console.log(`[workflow:final_assessment] Starting new assessment`);
    transitionTo(chatId, 'final_assessment', 'analysis');
    stageWsManager.broadcastToStage(chatId, 'final_assessment', { type: 'sub_stage', sub_stage: 'analysis' });
    return;
  }

  if (chat.sub_stage === 'analysis') {
    stageWsManager.broadcastToStage(chatId, 'final_assessment', { type: 'sub_stage', sub_stage: 'analysis' });
    const isNewSession = !serveRegistry.getSession(chatId, 'final_assessment');
    await handleSystem(chatId, isNewSession);
    return;
  }

  if (chat.sub_stage === 'system') {
    stageWsManager.broadcastToStage(chatId, 'final_assessment', { type: 'sub_stage', sub_stage: 'system' });
    const isNewSession = !serveRegistry.getSession(chatId, 'final_assessment');
    await handleSystem(chatId, isNewSession);
    return;
  }

  if (chat.sub_stage === 'user') {
    handleUser();
    return;
  }

  if (chat.sub_stage === 'error') {
    handleError();
    return;
  }
}

async function handleSystem(chatId: number, isNewSession: boolean): Promise<void> {
  console.log(`[workflow:final_assessment] handleSystem start`);
  const chat = getChatSession(chatId);
  if (!chat) {
    console.log(`[workflow:final_assessment] Chat ${chatId} not found`);
    return;
  }

  const project = getProject(chat.project_id);
  if (!project) {
    console.log(`[workflow:final_assessment] Project ${chat.project_id} not found`);
    return;
  }

  const chatDir = getChatDir(chatId, chat.project_id);
  const repoDir = path.join(chatDir, 'repository');
  const messages = getChatMessages(chatId);

  const client = serveRegistry.getOrCreate(chatId, chatDir, process.env);

  try {
    await client.ensureStarted();
  } catch (err) {
    console.log(`[workflow:final_assessment] Server start failed: ${(err as Error).message}`);
    transitionTo(chatId, 'final_assessment', 'error');
    stageWsManager.broadcastToStage(chatId, 'final_assessment', { type: 'sub_stage', sub_stage: 'error' });
    return;
  }

  let sessionId = serveRegistry.getSession(chatId, 'final_assessment');

  if (!sessionId) {
    sessionId = await client.createSession();
    serveRegistry.setSession(chatId, 'final_assessment', sessionId);
    console.log(`[workflow:final_assessment] Created new session: ${sessionId}`);
  }

  let prompt: string;
  const models = getProjectModels(project.id);

  if (isNewSession) {
    console.log(`[workflow:final_assessment] New session - loading system prompt`);
    const promptTemplate = fs.readFileSync(
      path.join(process.cwd(), 'prompts', 'plan-final-assessment.md'),
      'utf-8'
    );

    let repoContext = '';
    const repoContextPath = path.join(repoDir, 'REPOSITORY.md');
    if (fs.existsSync(repoContextPath)) {
      repoContext = fs.readFileSync(repoContextPath, 'utf-8');
    }

    const chatQa = messages.map(m => {
      if (m.role === 'system') {
        return `Q: ${m.message}`;
      } else {
        return `A: ${m.message}`;
      }
    }).join('\n');

    prompt = promptTemplate
      .replace(/{CHAT_DIR}/g, chatDir)
      .replace(/{REPO_DIR}/g, repoDir)
      .replace(/{UPLOAD_DIR}/g, path.join(chatDir, 'uploads'))
      .replace(/{REPO_CONTEXT}/g, repoContext)
      .replace(/{CHAT_QA}/g, chatQa)
      .replace(/{SKILLS_DIR}/g, getSkillsDir());
  } else {
    const lastUserMessage = [...messages].reverse().find(m => m.role === 'user');
    if (!lastUserMessage) {
      console.log(`[workflow:final_assessment] No user message found`);
      transitionTo(chatId, 'final_assessment', 'error');
      stageWsManager.broadcastToStage(chatId, 'final_assessment', { type: 'sub_stage', sub_stage: 'error' });
      return;
    }
    prompt = lastUserMessage.message;
    console.log(`[workflow:final_assessment] Subsequent turn - sending user message`);
  }

  console.log(`[workflow:final_assessment] Sending prompt to LLM`);

  try {
    const result = await client.sendMessage(sessionId, prompt, models.chat_model);

    const textPart = result.parts.find((p: { type?: string }) => p.type === 'text');
    const resultText = textPart?.text?.trim() ?? '';

    let parsed: LlmResponse;
    try {
      parsed = JSON.parse(resultText) as LlmResponse;
    } catch {
      const jsonMatch = resultText.match(/\{[\s\S]*"message"[\s\S]*\}/);
      if (jsonMatch) {
        try {
          parsed = JSON.parse(jsonMatch[0]) as LlmResponse;
        } catch {
          console.log(`[workflow:final_assessment] Failed to parse LLM response as JSON. Raw response: ${resultText}`);
          transitionTo(chatId, 'final_assessment', 'error');
          stageWsManager.broadcastToStage(chatId, 'final_assessment', { type: 'sub_stage', sub_stage: 'error' });
          return;
        }
      } else {
        console.log(`[workflow:final_assessment] Failed to parse LLM response as JSON. Raw response: ${resultText}`);
        transitionTo(chatId, 'final_assessment', 'error');
        stageWsManager.broadcastToStage(chatId, 'final_assessment', { type: 'sub_stage', sub_stage: 'error' });
        return;
      }
    }

    const systemMsg = insertChatMessage({
      chat_id: chatId,
      project_id: chat.project_id,
      stage: 'final_assessment',
      role: 'system',
      message: parsed.message,
      ready_for_next_stage: parsed.ready_for_next_stage,
    });

    insertMessageOptions({
      id: systemMsg.id,
      options_json: JSON.stringify(parsed.options || []),
    });

    console.log(`[workflow:final_assessment] Inserted system message id=${systemMsg.id} with options`);

    transitionTo(chatId, 'final_assessment', 'user');
    stageWsManager.broadcastToStage(chatId, 'final_assessment', { type: 'sub_stage', sub_stage: 'user' });
  } catch (err) {
    console.log(`[workflow:final_assessment] sendMessage failed: ${err}`);
    transitionTo(chatId, 'final_assessment', 'error');
    stageWsManager.broadcastToStage(chatId, 'final_assessment', { type: 'sub_stage', sub_stage: 'error' });
  }
}

function handleUser(): void {
  console.log(`[workflow:final_assessment] handleUser - waiting for user input`);
}

function handleError(): void {
  console.log(`[workflow:final_assessment] handleError - in error state`);
}