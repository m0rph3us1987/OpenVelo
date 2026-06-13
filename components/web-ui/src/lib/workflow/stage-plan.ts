import fs from 'fs';
import path from 'path';
import {
  getChatSession,
  getProject,
  getChatDir,
  getProjectModels,
  insertPlanJob,
  updatePlanJobContent,
  getPlanJobs,
  deletePlanJobsByChatId,
  deletePlanDataByChatId,
  updateChatSession,
  updatePlanJobStatus,
  updatePlanJobLogs
} from '@/lib/db';
import { serveRegistry } from '@/lib/opencode-serve-registry';
import { transitionTo } from './index';
import { stageWsManager } from '@/lib/stage-ws-manager';
import { loggerService } from '@/lib/logger-service';
import { getSkillsDir } from '@/lib/skills';

interface DiscoveredJob {
  index: number;
  title: string;
  description: string;
  line_mapping: string;
}

interface DiscoveryManifest {
  build_cmd: string;
  test_cmd: string;
  jobs: DiscoveredJob[];
}

async function parseJsonWithRetry<T>(
  client: any,
  sessionId: string,
  resultText: string,
  expectedKey: string,
  modelKey: 'planning_model',
  models: { planning_model: string },
  maxAttempts: number = 3
): Promise<{ parsed: T | null; finalText: string }> {
  const extractJson = (text: string): T | null => {
    const stripped = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
    try {
      return JSON.parse(stripped) as T;
    } catch {
      const jsonMatch = stripped.match(new RegExp(`\\{[\\s\\S]*"${expectedKey}"[\\s\\S]*\\}`));
      if (jsonMatch) {
        try {
          return JSON.parse(jsonMatch[0]) as T;
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
    loggerService.appendVerbose(0, 'workflow:plan', `JSON parse failed, attempt ${attempt}/${maxAttempts}, requesting correction`);
    const correctionPrompt = `The JSON you returned was malformed or incomplete. Return ONLY valid JSON with no additional text. Previous response was:\n${resultText.substring(0, 2000)}\n\nReturn only the corrected JSON.`;
    try {
      const corrected = await client.sendMessage(sessionId, correctionPrompt, correctionModel);
      const correctedText = corrected.parts.find((p: { type?: string }) => p.type === 'text')?.text?.trim() ?? '';
      const correctedParsed = extractJson(correctedText);
      if (correctedParsed) {
        return { parsed: correctedParsed, finalText: correctedText };
      }
    } catch (err) {
      loggerService.appendVerbose(0, 'workflow:plan', `Correction request failed: ${err}`);
    }
  }
  return { parsed: null, finalText: resultText };
}

export async function handlePlan(chatId: number): Promise<void> {
  loggerService.appendVerbose(chatId, 'workflow:plan', `Initializing`);
  const chat = getChatSession(chatId);
  if (!chat) {
    loggerService.appendVerbose(chatId, 'workflow:plan', `Chat ${chatId} not found`);
    return;
  }

  const chatDir = getChatDir(chatId, chat.project_id);
  const project = getProject(chat.project_id);
  if (!project) {
    loggerService.appendVerbose(chatId, 'workflow:plan', `Project ${chat.project_id} not found`);
    return;
  }

  const repoDir = path.join(chatDir, 'repository');

  if (!fs.existsSync(chatDir) || !fs.existsSync(repoDir)) {
    loggerService.appendVerbose(chatId, 'workflow:plan', `chat dir or repo dir missing`);
    transitionTo(chatId, 'plan', 'error');
    return;
  }

  if (chat.sub_stage === '') {
    loggerService.appendVerbose(chatId, 'workflow:plan', `Starting plan generation`);
    const planDir = path.join(chatDir, 'plan');
    if (!fs.existsSync(planDir)) {
      fs.mkdirSync(planDir, { recursive: true });
    }
    // Clean plan dir
    const files = fs.readdirSync(planDir);
    for (const file of files) {
      try {
        fs.unlinkSync(path.join(planDir, file));
      } catch (err) {
        // Ignore files that cannot be unlinked
      }
    }
    deletePlanDataByChatId(chatId);
    transitionTo(chatId, 'plan', 'discovery');
    stageWsManager.broadcastToStage(chatId, 'plan', { type: 'sub_stage', sub_stage: 'discovery' });
    return;
  }

  if (chat.sub_stage === 'discovery') {
    await handleDiscovery(chatId, chatDir, repoDir, project.id);
    return;
  }

  if (chat.sub_stage === 'generation') {
    await handleGeneration(chatId, chatDir, repoDir, project.id);
    return;
  }

  if (chat.sub_stage === 'plan') {
    loggerService.appendVerbose(chatId, 'workflow:plan', `Plan ready - waiting for user`);
    return;
  }

  // Legacy sub-stages from the old epic/feature/story flow. Treat as a
  // request to start (or restart) the new discovery → generation flow.
  if (chat.sub_stage === 'epics' || chat.sub_stage === 'features' || chat.sub_stage === 'stories') {
    loggerService.appendVerbose(chatId, 'workflow:plan', `Recovering from legacy sub_stage=${chat.sub_stage}, restarting plan flow`);
    transitionTo(chatId, 'plan', '');
    return;
  }

  if (chat.sub_stage === 'error') {
    loggerService.appendVerbose(chatId, 'workflow:plan', `Error state`);
    return;
  }
}

async function handleDiscovery(chatId: number, chatDir: string, repoDir: string, projectId: number): Promise<void> {
  loggerService.appendVerbose(chatId, 'workflow:plan', `Stage 1: Job Discovery`);

  const client = serveRegistry.getOrCreate(chatId, chatDir, process.env);
  await client.ensureStarted().catch((err) => {
    loggerService.appendVerbose(chatId, 'workflow:plan', `Server start failed: ${err.message}`);
    const currentChat = getChatSession(chatId);
    if (currentChat && !currentChat.running) {
      return;
    }
    transitionTo(chatId, 'plan', 'error');
    return;
  });

  const models = getProjectModels(projectId);
  const sessionId = await client.createSession();
  serveRegistry.setSession(chatId, 'plan-discovery', sessionId);

  const repoContextPath = path.join(repoDir, 'REPOSITORY.md');
  let repoContext = '';
  if (fs.existsSync(repoContextPath)) {
    repoContext = fs.readFileSync(repoContextPath, 'utf-8');
  }

  const requirementPath = path.join(chatDir, 'REQUIREMENT.md');
  if (!fs.existsSync(requirementPath)) {
    loggerService.appendVerbose(chatId, 'workflow:plan', `REQUIREMENT.md not found`);
    transitionTo(chatId, 'plan', 'error');
    return;
  }

  const promptTemplate = fs.readFileSync(
    path.join(process.cwd(), 'prompts', 'plan-jobs-discovery.md'),
    'utf-8'
  );

  const prompt = promptTemplate
    .replace(/{CHAT_DIR}/g, chatDir)
    .replace(/{REPO_DIR}/g, repoDir)
    .replace(/{REPO_CONTEXT}/g, repoContext)
    .replace(/{REQUIREMENT_MD_PATH}/g, requirementPath)
    .replace(/{SKILLS_DIR}/g, getSkillsDir());

  loggerService.appendVerbose(chatId, 'workflow:plan', `Sending job discovery prompt`);

  try {
    const result = await client.sendMessage(sessionId, prompt, models.planning_model);
    const textPart = result.parts.find((p: { type?: string }) => p.type === 'text');
    const resultText = textPart?.text?.trim() ?? '';

    const { parsed, finalText } = await parseJsonWithRetry<DiscoveryManifest>(
      client, sessionId, resultText, 'jobs', 'planning_model', models
    );

    if (!parsed) {
      loggerService.appendVerbose(chatId, 'workflow:plan', `Failed to parse discovery manifest JSON after retries.`);
      transitionTo(chatId, 'plan', 'error');
      return;
    }

    if (!parsed.jobs || !Array.isArray(parsed.jobs) || parsed.jobs.length === 0) {
      loggerService.appendVerbose(chatId, 'workflow:plan', `Invalid discovery manifest: no jobs found`);
      transitionTo(chatId, 'plan', 'error');
      return;
    }

    // Save discovery manifest to disk
    const planDir = path.join(chatDir, 'plan');
    fs.writeFileSync(
      path.join(planDir, 'discovery-manifest.json'),
      JSON.stringify(parsed, null, 2)
    );

    deletePlanJobsByChatId(chatId);
    for (const job of parsed.jobs) {
      insertPlanJob({
        chat_id: chatId,
        job_index: job.index,
        title: job.title,
        description: job.description,
        requirement_line_mapping: job.line_mapping
      });
    }

    // Update project build/test commands based on discovery
    const db = require('@/lib/db');
    db.getDb().prepare('UPDATE projects SET build_cmd = ?, test_cmd = ? WHERE id = ?')
      .run(parsed.build_cmd || '', parsed.test_cmd || '', projectId);

    loggerService.appendVerbose(chatId, 'workflow:plan', `Discovered ${parsed.jobs.length} jobs. Transitioning to generation stage.`);
    transitionTo(chatId, 'plan', 'generation');
    stageWsManager.broadcastToStage(chatId, 'plan', { type: 'sub_stage', sub_stage: 'generation' });
  } catch (err) {
    loggerService.appendVerbose(chatId, 'workflow:plan', `Job Discovery failed: ${err}`);
    const currentChat = getChatSession(chatId);
    if (currentChat && !currentChat.running) {
      return;
    }
    transitionTo(chatId, 'plan', 'error');
  }
}

async function runWithLimit<T>(limit: number, items: T[], fn: (item: T) => Promise<void>): Promise<void> {
  const executing = new Set<Promise<void>>();
  for (const item of items) {
    const p = Promise.resolve().then(() => fn(item));
    executing.add(p);
    const clean = () => executing.delete(p);
    p.then(clean, clean);
    if (executing.size >= limit) {
      await Promise.race(executing);
    }
  }
  await Promise.all(executing);
}

async function handleGeneration(chatId: number, chatDir: string, repoDir: string, projectId: number): Promise<void> {
  loggerService.appendVerbose(chatId, 'workflow:plan', `Stage 2: Job Specification Generation`);

  const jobs = getPlanJobs(chatId);
  if (jobs.length === 0) {
    loggerService.appendVerbose(chatId, 'workflow:plan', `No discovered jobs found in database.`);
    transitionTo(chatId, 'plan', 'error');
    return;
  }

  // Reset statuses and logs in database
  for (const job of jobs) {
    updatePlanJobStatus(job.id, 'pending');
    updatePlanJobLogs(job.id, '');
  }

  // Broadcast progress update
  const progressMsg = `Generating specifications for ${jobs.length} jobs in batches of max 4 parallel sub-agents...`;
  stageWsManager.broadcastToStage(chatId, 'plan', {
    type: 'sub_stage',
    sub_stage: 'generation',
    progress: progressMsg
  });

  const client = serveRegistry.getOrCreate(chatId, chatDir, process.env);
  await client.ensureStarted().catch((err) => {
    loggerService.appendVerbose(chatId, 'workflow:plan', `Server start failed: ${err.message}`);
    const currentChat = getChatSession(chatId);
    if (currentChat && !currentChat.running) {
      return;
    }
    transitionTo(chatId, 'plan', 'error');
    return;
  });

  const models = getProjectModels(projectId);

  const repoContextPath = path.join(repoDir, 'REPOSITORY.md');
  let repoContext = '';
  if (fs.existsSync(repoContextPath)) {
    repoContext = fs.readFileSync(repoContextPath, 'utf-8');
  }

  const requirementPath = path.join(chatDir, 'REQUIREMENT.md');
  if (!fs.existsSync(requirementPath)) {
    loggerService.appendVerbose(chatId, 'workflow:plan', `REQUIREMENT.md not found`);
    transitionTo(chatId, 'plan', 'error');
    return;
  }

  const promptTemplate = fs.readFileSync(
    path.join(process.cwd(), 'prompts', 'plan-jobs-runner.md'),
    'utf-8'
  );

  const planDir = path.join(chatDir, 'plan');
  if (!fs.existsSync(planDir)) {
    fs.mkdirSync(planDir, { recursive: true });
  }

  try {
    // Run outlines concurrently up to a limit of 4
    await runWithLimit(4, jobs, async (job) => {
      updatePlanJobStatus(job.id, 'running');
      stageWsManager.broadcastToStage(chatId, 'plan', {
        type: 'sub_stage',
        sub_stage: 'generation',
        progress: progressMsg
      });

      const jobPrompt = promptTemplate
        .replace(/{CHAT_DIR}/g, chatDir)
        .replace(/{REPO_DIR}/g, repoDir)
        .replace(/{REPO_CONTEXT}/g, repoContext)
        .replace(/{REQUIREMENT_MD_PATH}/g, requirementPath)
        .replace(/{SKILLS_DIR}/g, getSkillsDir())
        .replace(/{JOB_INDEX}/g, String(job.job_index))
        .replace(/{JOB_TITLE}/g, job.title)
        .replace(/{JOB_DESCRIPTION}/g, job.description)
        .replace(/{JOB_LINE_MAPPING}/g, job.requirement_line_mapping);

      const sessionId = await client.createSession();

      // Periodically reconstruct and save logs to the database while running
      const interval = setInterval(async () => {
        try {
          const logs = await client.reconstructSessionLogs(sessionId);
          updatePlanJobLogs(job.id, logs);
          stageWsManager.broadcastToStage(chatId, 'plan', {
            type: 'sub_stage',
            sub_stage: 'generation',
            progress: progressMsg
          });
        } catch {
          // ignore
        }
      }, 1000);

      try {
        await client.sendMessage(sessionId, jobPrompt, models.planning_model, true);
        
        clearInterval(interval);
        const finalLogs = await client.reconstructSessionLogs(sessionId);
        updatePlanJobLogs(job.id, finalLogs);

        const jobFile = path.join(planDir, `job-${job.job_index}.json`);
        if (fs.existsSync(jobFile)) {
          updatePlanJobStatus(job.id, 'completed');
        } else {
          loggerService.appendVerbose(chatId, 'workflow:plan', `Specification file missing for job index ${job.job_index} after sub-agent run`);
          updatePlanJobStatus(job.id, 'failed');
          throw new Error(`Specification file job-${job.job_index}.json was not generated`);
        }
      } catch (err) {
        clearInterval(interval);
        updatePlanJobStatus(job.id, 'failed');
        throw err;
      } finally {
        try {
          await client.deleteSession(sessionId);
        } catch {
          // ignore
        }
        stageWsManager.broadcastToStage(chatId, 'plan', {
          type: 'sub_stage',
          sub_stage: 'generation',
          progress: progressMsg
        });
      }
    });

    // Sync generated spec files from disk to the database
    const project = getProject(projectId);

    for (const job of jobs) {
      const jobFile = path.join(planDir, `job-${job.job_index}.json`);
      if (fs.existsSync(jobFile)) {
        try {
          const content = fs.readFileSync(jobFile, 'utf-8');
          const parsed = JSON.parse(content) as { content?: string };
          if (!parsed || typeof parsed.content !== 'string' || parsed.content.length === 0) {
            loggerService.appendVerbose(chatId, 'workflow:plan', `Spec file for job ${job.job_index} has empty/missing 'content' field`);
            transitionTo(chatId, 'plan', 'error');
            return;
          }
          updatePlanJobContent(job.id, parsed.content, project?.build_cmd || '', project?.test_cmd || '');
        } catch (err) {
          loggerService.appendVerbose(chatId, 'workflow:plan', `Failed to parse spec file for job index ${job.job_index}: ${err}`);
          transitionTo(chatId, 'plan', 'error');
          return;
        }
      } else {
        loggerService.appendVerbose(chatId, 'workflow:plan', `Specification file missing for job index ${job.job_index}`);
        transitionTo(chatId, 'plan', 'error');
        return;
      }
    }

    loggerService.appendVerbose(chatId, 'workflow:plan', `All specifications synced. Plan ready.`);
    transitionTo(chatId, 'plan', 'plan');
    stageWsManager.broadcastToStage(chatId, 'plan', { type: 'sub_stage', sub_stage: 'plan' });
  } catch (err) {
    loggerService.appendVerbose(chatId, 'workflow:plan', `Job specs orchestration failed: ${err}`);
    const currentChat = getChatSession(chatId);
    if (currentChat && !currentChat.running) {
      return;
    }
    transitionTo(chatId, 'plan', 'error');
  }
}
