import fs from 'fs';
import path from 'path';
import { getChatSession, getProject, getChatDir, getChatMessages, insertChatMessage, insertMessageOptions, getProjectModels } from '@/lib/db';
import { serveRegistry } from '@/lib/opencode-serve-registry';
import { transitionTo } from './index';
import { stageWsManager } from '@/lib/stage-ws-manager';
import { getSkillsDir } from '@/lib/skills';

interface LlmResponse {
  message: string;
  options: Array<{recommended: boolean, option: string}>;
  ready_for_next_stage: boolean;
}

export async function handleCollecting(chatId: number): Promise<void> {
  console.log(`[workflow:collecting] Initializing`);
  const chat = getChatSession(chatId);
  if (!chat) {
    console.log(`[workflow:collecting] Chat ${chatId} not found`);
    return;
  }

  if (chat.sub_stage === '' || chat.sub_stage === 'new') {
    console.log(`[workflow:collecting] Starting new chat`);
    transitionTo(chatId, 'collecting', 'user');
    stageWsManager.broadcastToStage(chatId, 'collecting', { type: 'sub_stage', sub_stage: 'user' });
    return;
  }

  if (chat.sub_stage === 'system') {
    stageWsManager.broadcastToStage(chatId, 'collecting', { type: 'sub_stage', sub_stage: 'system' });
    const isNewSession = !serveRegistry.getSession(chatId, 'collecting');
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
  console.log(`[workflow:collecting] handleSystem start`);
  const chat = getChatSession(chatId);
  if (!chat) {
    console.log(`[workflow:collecting] Chat ${chatId} not found`);
    return;
  }

  const project = getProject(chat.project_id);
  if (!project) {
    console.log(`[workflow:collecting] Project ${chat.project_id} not found`);
    return;
  }

  const chatDir = getChatDir(chatId, chat.project_id);
  const repoDir = path.join(chatDir, 'repository');
  const messages = getChatMessages(chatId);

  console.log(`[workflow:collecting] Found ${messages.length} messages for chat ${chatId}`);

  if (messages.length === 0) {
    console.log(`[workflow:collecting] No messages found - should not happen`);
    transitionTo(chatId, 'collecting', 'error');
    stageWsManager.broadcastToStage(chatId, 'collecting', { type: 'sub_stage', sub_stage: 'error' });
    return;
  }

  const client = serveRegistry.getOrCreate(chatId, chatDir, process.env);

  try {
    await client.ensureStarted();
  } catch (err) {
    console.log(`[workflow:collecting] Server start failed: ${(err as Error).message}`);
    transitionTo(chatId, 'collecting', 'error');
    stageWsManager.broadcastToStage(chatId, 'collecting', { type: 'sub_stage', sub_stage: 'error' });
    return;
  }

  let sessionId = serveRegistry.getSession(chatId, 'collecting');

  if (!sessionId) {
    sessionId = await client.createSession();
    serveRegistry.setSession(chatId, 'collecting', sessionId);
    console.log(`[workflow:collecting] Created new session: ${sessionId}`);
  }

  let prompt: string;
  const models = getProjectModels(project.id);

  if (isNewSession) {
    console.log(`[workflow:collecting] New session - loading system prompt`);
    const promptTemplate = fs.readFileSync(
      path.join(process.cwd(), 'prompts', 'plan-collecting.md'),
      'utf-8'
    );

    let repoContext = '';
    const repoContextPath = path.join(repoDir, 'REPOSITORY.md');
    if (fs.existsSync(repoContextPath)) {
      repoContext = fs.readFileSync(repoContextPath, 'utf-8');
    }

    let systemPrompt = promptTemplate
      .replace(/{CHAT_DIR}/g, chatDir)
      .replace(/{REPO_DIR}/g, repoDir)
      .replace(/{SKILLS_DIR}/g, getSkillsDir())
      .replace(/{UPLOAD_DIR}/g, path.join(chatDir, 'uploads'))
      .replace(/{REPO_CONTEXT}/g, repoContext);

    if (messages.length > 0) {
      const history = messages.map(m => `${m.role === 'user' ? 'User' : 'System'}: ${m.message}`).join('\n');
      systemPrompt += `\n\nThese questions have already been answered:\n${history}`;
    }

    prompt = systemPrompt;
  } else {
    const lastUserMessage = [...messages].reverse().find(m => m.role === 'user');
    if (!lastUserMessage) {
      console.log(`[workflow:collecting] No user message found`);
      transitionTo(chatId, 'collecting', 'error');
      stageWsManager.broadcastToStage(chatId, 'collecting', { type: 'sub_stage', sub_stage: 'error' });
      return;
    }
    prompt = lastUserMessage.message;
    console.log(`[workflow:collecting] Subsequent turn - sending user message`);
  }

  console.log(`[workflow:collecting] Sending prompt to LLM`);
  console.log(`[workflow:collecting] Prompt: ${prompt}`);

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
          console.log(`[workflow:collecting] Failed to parse LLM response as JSON. Raw response: ${resultText}`);
          transitionTo(chatId, 'collecting', 'error');
          stageWsManager.broadcastToStage(chatId, 'collecting', { type: 'sub_stage', sub_stage: 'error' });
          return;
        }
      } else {
        console.log(`[workflow:collecting] Failed to parse LLM response as JSON. Raw response: ${resultText}`);
        transitionTo(chatId, 'collecting', 'error');
        stageWsManager.broadcastToStage(chatId, 'collecting', { type: 'sub_stage', sub_stage: 'error' });
        return;
      }
    }

    const systemMsg = insertChatMessage({
      chat_id: chatId,
      project_id: chat.project_id,
      stage: 'collecting',
      role: 'system',
      message: parsed.message,
      ready_for_next_stage: parsed.ready_for_next_stage,
    });

    insertMessageOptions({
      id: systemMsg.id,
      options_json: JSON.stringify(parsed.options || []),
    });

    console.log(`[workflow:collecting] Inserted system message id=${systemMsg.id} with options`);

    transitionTo(chatId, 'collecting', 'user');
    stageWsManager.broadcastToStage(chatId, 'collecting', { type: 'sub_stage', sub_stage: 'user' });
  } catch (err) {
    console.log(`[workflow:collecting] sendMessage failed: ${err}`);
    transitionTo(chatId, 'collecting', 'error');
    stageWsManager.broadcastToStage(chatId, 'collecting', { type: 'sub_stage', sub_stage: 'error' });
  }
}

function handleUser(): void {
  console.log(`[workflow:collecting] handleUser - waiting for user input`);
}

function handleError(): void {
  console.log(`[workflow:collecting] handleError - in error state`);
}
