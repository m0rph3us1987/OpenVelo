import fs from 'fs';
import path from 'path';
import { getChatSession, getProject, getChatDir, getChatMessages, getProjectModels, deleteDomainsByChatId, insertDomain, insertDomainQuestion } from '@/lib/db';
import { serveRegistry } from '@/lib/opencode-serve-registry';
import { transitionTo } from './index';
import { stageWsManager } from '@/lib/stage-ws-manager';
import { getSkillsDir } from '@/lib/skills';

interface DomainPlan {
  domains: Array<{
    name: string;
    description: string;
    key_topics: Array<{
      topic: string;
      questions: Array<{
        question: string;
        options: string[];
        recommended_index: number | null;
      }>;
    }>;
  }>;
}

export async function handleDomain(chatId: number): Promise<void> {
  console.log(`[workflow:domain] Initializing`);
  const chat = getChatSession(chatId);
  if (!chat) {
    console.log(`[workflow:domain] Chat ${chatId} not found`);
    return;
  }

  if (chat.sub_stage === 'plan') {
    await handlePlan(chatId);
    return;
  }

  if (chat.sub_stage === 'quiz') {
    handleQuiz();
    return;
  }
}

async function handlePlan(chatId: number): Promise<void> {
  console.log(`[workflow:domain:plan] Starting domain planning`);
  const chat = getChatSession(chatId);
  if (!chat) {
    console.log(`[workflow:domain:plan] Chat ${chatId} not found`);
    return;
  }

  const project = getProject(chat.project_id);
  if (!project) {
    console.log(`[workflow:domain:plan] Project ${chat.project_id} not found`);
    return;
  }

  const chatDir = getChatDir(chatId, chat.project_id);
  const repoDir = path.join(chatDir, 'repository');

  const collectingMessages = getChatMessages(chatId).filter(m => m.stage === 'collecting' && m.role === 'user');
  if (collectingMessages.length === 0) {
    console.log(`[workflow:domain:plan] No collecting conversation found`);
    transitionTo(chatId, 'domain', 'error');
    stageWsManager.broadcastToStage(chatId, 'domain', { type: 'sub_stage', sub_stage: 'error' });
    return;
  }

  const client = serveRegistry.getOrCreate(chatId, chatDir, process.env);

  try {
    await client.ensureStarted();
  } catch (err) {
    console.log(`[workflow:domain:plan] Server start failed: ${(err as Error).message}`);
    transitionTo(chatId, 'domain', 'error');
    stageWsManager.broadcastToStage(chatId, 'domain', { type: 'sub_stage', sub_stage: 'error' });
    return;
  }

  const sessionId = await client.createSession();
  console.log(`[workflow:domain:plan] Created new session: ${sessionId}`);

  const promptTemplate = fs.readFileSync(
    path.join(process.cwd(), 'prompts', 'plan-domain.md'),
    'utf-8'
  );

  let repoContext = '';
  const repoContextPath = path.join(repoDir, 'REPOSITORY.md');
  if (fs.existsSync(repoContextPath)) {
    repoContext = fs.readFileSync(repoContextPath, 'utf-8');
  }

  const chatQA = collectingMessages
    .map(m => `User: ${m.message}`)
    .join('\n\n');

  const prompt = promptTemplate
    .replace(/{CHAT_DIR}/g, chatDir)
    .replace(/{REPO_DIR}/g, repoDir)
    .replace(/{SKILLS_DIR}/g, getSkillsDir())
    .replace(/{UPLOAD_DIR}/g, path.join(chatDir, 'uploads'))
    .replace(/{REPO_CONTEXT}/g, repoContext)
    .replace(/{CHAT_QA}/g, chatQA);

  const models = getProjectModels(project.id);
  console.log(`[workflow:domain:plan] Sending prompt to LLM`);

  try {
    await client.sendMessage(sessionId, prompt, models.chat_model);

    const domainPlanPath = path.join(chatDir, 'domain_plan.json');

    if (!fs.existsSync(domainPlanPath)) {
      console.log(`[workflow:domain:plan] domain_plan.json not found at ${domainPlanPath}`);
      transitionTo(chatId, 'domain', 'error');
      stageWsManager.broadcastToStage(chatId, 'domain', { type: 'sub_stage', sub_stage: 'error' });
      return;
    }

    let plan: DomainPlan;
    try {
      const content = fs.readFileSync(domainPlanPath, 'utf-8');
      plan = JSON.parse(content) as DomainPlan;
    } catch (err) {
      console.log(`[workflow:domain:plan] Failed to parse domain_plan.json: ${err}`);
      transitionTo(chatId, 'domain', 'error');
      stageWsManager.broadcastToStage(chatId, 'domain', { type: 'sub_stage', sub_stage: 'error' });
      return;
    }

    deleteDomainsByChatId(chatId);

    for (const domain of plan.domains) {
      const domainId = insertDomain({
        chat_id: chatId,
        name: domain.name,
        description: domain.description,
      });

      for (const keyTopic of domain.key_topics) {
        for (const q of keyTopic.questions) {
          insertDomainQuestion({
            domain_id: domainId,
            topic: keyTopic.topic,
            question: q.question,
            options_json: JSON.stringify(q.options),
            recommended_index: q.recommended_index,
          });
        }
      }
    }

    console.log(`[workflow:domain:plan] Inserted ${plan.domains.length} domains`);

    try {
      fs.unlinkSync(domainPlanPath);
    } catch { /* ignore */ }

    transitionTo(chatId, 'domain', 'quiz');
    stageWsManager.broadcastToStage(chatId, 'domain', { type: 'sub_stage', sub_stage: 'quiz' });
  } catch (err) {
    console.log(`[workflow:domain:plan] sendMessage failed: ${err}`);
    transitionTo(chatId, 'domain', 'error');
    stageWsManager.broadcastToStage(chatId, 'domain', { type: 'sub_stage', sub_stage: 'error' });
  }
}

function handleQuiz(): void {
  console.log(`[workflow:domain:quiz] Quiz stage not yet implemented - waiting`);
}