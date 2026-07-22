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
  updatePlanJobStatus,
  updatePlanJobLogs,
  insertPlanBlock,
  deletePlanBlocksByChatId,
  getChatMessages,
  getDb
} from '@/lib/db';
import { serveRegistry } from '@/lib/opencode-serve-registry';
import { WorkflowAbortError } from '@/lib/opencode-serve-client';
import { transitionTo, getWorkflowSignal } from './index';
import { stageWsManager } from '@/lib/stage-ws-manager';
import { loggerService } from '@/lib/logger-service';
import { getSkillsDir } from '@/lib/skills';

interface DiscoveredBlock {
  index: number;
  title: string;
  description: string;
}

interface DiscoveredJob {
  index: number;
  block_index?: number;
  block_sequence?: number;
  title: string;
  description: string;
  line_mapping: string;
  test_plan_markdown?: string;
}

interface DiscoveryManifest {
  build_cmd: string;
  test_cmd: string;
  blocks?: DiscoveredBlock[];
  jobs: DiscoveredJob[];
}

async function parseJsonWithRetry<T>(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client: any,
  sessionId: string,
  resultText: string,
  expectedKey: string,
  modelKey: 'planning_model',
  models: { planning_model: string },
  maxAttempts: number = 3,
  signal?: AbortSignal
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
    if (signal?.aborted) {
      throw new WorkflowAbortError('Aborted during JSON parse retry');
    }
    loggerService.appendVerbose(0, 'workflow:plan', `JSON parse failed, attempt ${attempt}/${maxAttempts}, requesting correction`);
    const correctionPrompt = `The JSON you returned was malformed or incomplete. Return ONLY valid JSON with no additional text. Previous response was:\n${resultText.substring(0, 2000)}\n\nReturn only the corrected JSON.`;
    try {
      const corrected = await client.sendMessage(sessionId, correctionPrompt, correctionModel, false, signal);
      const correctedText = corrected.parts.find((p: { type?: string }) => p.type === 'text')?.text?.trim() ?? '';
      const correctedParsed = extractJson(correctedText);
      if (correctedParsed) {
        return { parsed: correctedParsed, finalText: correctedText };
      }
    } catch (err) {
      if (err instanceof WorkflowAbortError) throw err;
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

  const signal = getWorkflowSignal(chatId);
  if (signal?.aborted) {
    loggerService.appendVerbose(chatId, 'workflow:plan', `Plan aborted before start`);
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
      } catch {
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

  if (chat.sub_stage === 'test') {
    await handleTest(chatId, chatDir, repoDir, project.id);
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

  const chat = getChatSession(chatId);
  if (!chat) return;

  const signal = getWorkflowSignal(chatId);
  if (signal?.aborted) {
    loggerService.appendVerbose(chatId, 'workflow:plan', `Discovery aborted before start`);
    return;
  }

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

  let specContext: string;
  if (chat.mode === 'requirement') {
    const requirementPath = path.join(chatDir, 'REQUIREMENT.md');
    if (fs.existsSync(requirementPath)) {
      specContext = fs.readFileSync(requirementPath, 'utf-8');
    } else {
      loggerService.appendVerbose(chatId, 'workflow:plan', `REQUIREMENT.md not found`);
      transitionTo(chatId, 'plan', 'error');
      return;
    }
  } else {
    const messages = getChatMessages(chatId);
    specContext = messages
      .map(m => m.role === 'system' ? `Q: ${m.message}` : `A: ${m.message}`)
      .join('\n');
  }

  const promptTemplate = fs.readFileSync(
    path.join(process.cwd(), 'prompts', 'plan-jobs-discovery.md'),
    'utf-8'
  );

  const prompt = promptTemplate
    .replace(/{CHAT_DIR}/g, chatDir)
    .replace(/{REPO_DIR}/g, repoDir)
    .replace(/{REPO_CONTEXT}/g, repoContext)
    .replace(/{SPEC_CONTEXT}/g, specContext)
    .replace(/{SKILLS_DIR}/g, getSkillsDir());

  loggerService.appendVerbose(chatId, 'workflow:plan', `Sending job discovery prompt`);

  try {
    const result = await client.sendMessage(sessionId, prompt, models.planning_model, false, signal);
    const textPart = result.parts.find((p: { type?: string }) => p.type === 'text');
    const resultText = textPart?.text?.trim() ?? '';

    const { parsed } = await parseJsonWithRetry<DiscoveryManifest>(
      client, sessionId, resultText, 'jobs', 'planning_model', models, 3, signal
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
    deletePlanBlocksByChatId(chatId);

    const blockIdMap = new Map<number, number>();
    if (parsed.blocks && Array.isArray(parsed.blocks)) {
      for (const block of parsed.blocks) {
        const blockDbId = insertPlanBlock({
          chat_id: chatId,
          block_index: block.index,
          title: block.title,
          description: block.description
        });
        blockIdMap.set(block.index, blockDbId);
      }
    }

    let lastImplDbId: number | null = null;
    for (const job of parsed.jobs) {
      const blockDbId = job.block_index !== undefined ? (blockIdMap.get(job.block_index) || null) : null;
      const isTest = job.title.startsWith('Test: ') || (typeof job.test_plan_markdown === 'string' && job.test_plan_markdown.trim().length > 0);
      const planJobDbId = insertPlanJob({
        chat_id: chatId,
        job_index: job.index,
        title: job.title,
        description: job.description,
        requirement_line_mapping: job.line_mapping,
        block_id: blockDbId,
        block_sequence: job.block_sequence ?? 0,
        test_plan_markdown: job.test_plan_markdown ?? '',
        implements_job_id: isTest ? lastImplDbId : null
      });
      if (!isTest) {
        lastImplDbId = planJobDbId;
      }
    }

    // Update project build/test commands based on discovery
    getDb().prepare('UPDATE projects SET build_cmd = ?, test_cmd = ? WHERE id = ?')
      .run(parsed.build_cmd || '', parsed.test_cmd || '', projectId);

    loggerService.appendVerbose(chatId, 'workflow:plan', `Discovered ${parsed.jobs.length} jobs. Transitioning to generation stage.`);
    transitionTo(chatId, 'plan', 'generation');
    stageWsManager.broadcastToStage(chatId, 'plan', { type: 'sub_stage', sub_stage: 'generation' });
  } catch (err) {
    if (err instanceof WorkflowAbortError || signal?.aborted) {
      loggerService.appendVerbose(chatId, 'workflow:plan', `Job Discovery aborted`);
      return;
    }
    loggerService.appendVerbose(chatId, 'workflow:plan', `Job Discovery failed: ${err}`);
    const currentChat = getChatSession(chatId);
    if (currentChat && !currentChat.running) {
      return;
    }
    transitionTo(chatId, 'plan', 'error');
  }
}

async function runWithLimit<T>(limit: number, items: T[], fn: (item: T) => Promise<void>, shouldStop?: () => boolean): Promise<void> {
  const executing = new Set<Promise<void>>();
  for (const item of items) {
    if (shouldStop?.()) {
      break;
    }
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

  const chat = getChatSession(chatId);
  if (!chat) return;

  const signal = getWorkflowSignal(chatId);
  if (signal?.aborted) {
    loggerService.appendVerbose(chatId, 'workflow:plan', `Generation aborted before start`);
    return;
  }

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

  let specContext: string;
  if (chat.mode === 'requirement') {
    const requirementPath = path.join(chatDir, 'REQUIREMENT.md');
    if (fs.existsSync(requirementPath)) {
      specContext = fs.readFileSync(requirementPath, 'utf-8');
    } else {
      loggerService.appendVerbose(chatId, 'workflow:plan', `REQUIREMENT.md not found`);
      transitionTo(chatId, 'plan', 'error');
      return;
    }
  } else {
    const messages = getChatMessages(chatId);
    specContext = messages
      .map(m => m.role === 'system' ? `Q: ${m.message}` : `A: ${m.message}`)
      .join('\n');
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
      if (signal?.aborted) {
        updatePlanJobStatus(job.id, 'failed');
        return;
      }
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
        .replace(/{SPEC_CONTEXT}/g, specContext)
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
        await client.sendMessage(sessionId, jobPrompt, models.planning_model, true, signal);
        
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
    if (err instanceof WorkflowAbortError || signal?.aborted) {
      loggerService.appendVerbose(chatId, 'workflow:plan', `Generation aborted`);
      return;
    }
    loggerService.appendVerbose(chatId, 'workflow:plan', `Job specs orchestration failed: ${err}`);
    const currentChat = getChatSession(chatId);
    if (currentChat && !currentChat.running) {
      return;
    }
    transitionTo(chatId, 'plan', 'error');
  }
}

async function handleTest(chatId: number, chatDir: string, repoDir: string, projectId: number): Promise<void> {
  loggerService.appendVerbose(chatId, 'workflow:plan', `Stage 3: Test Generation`);

  const chat = getChatSession(chatId);
  if (!chat) return;

  const signal = getWorkflowSignal(chatId);
  if (signal?.aborted) {
    loggerService.appendVerbose(chatId, 'workflow:plan', `Test generation aborted before start`);
    return;
  }

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
  const db = getDb();

  // 1. Delete existing test jobs to support idempotency/rerun
  db.prepare("DELETE FROM plan_jobs WHERE chat_id = ? AND (title LIKE 'Test: %' OR implements_job_id IS NOT NULL)").run(chatId);

  // 2. Read existing implementation jobs
  const implJobs = getPlanJobs(chatId);
  if (implJobs.length === 0) {
    loggerService.appendVerbose(chatId, 'workflow:plan', `No implementation jobs found to generate tests for.`);
    transitionTo(chatId, 'plan', 'plan');
    stageWsManager.broadcastToStage(chatId, 'plan', { type: 'sub_stage', sub_stage: 'plan' });
    return;
  }

  let specContext: string;
  if (chat.mode === 'requirement') {
    const requirementPath = path.join(chatDir, 'REQUIREMENT.md');
    if (fs.existsSync(requirementPath)) {
      specContext = fs.readFileSync(requirementPath, 'utf-8');
    } else {
      loggerService.appendVerbose(chatId, 'workflow:plan', `REQUIREMENT.md not found`);
      transitionTo(chatId, 'plan', 'error');
      return;
    }
  } else {
    const messages = getChatMessages(chatId);
    specContext = messages
      .map(m => m.role === 'system' ? `Q: ${m.message}` : `A: ${m.message}`)
      .join('\n');
  }

  const planDir = path.join(chatDir, 'plan');

  try {
    // 3. Overall Discovery Phase
    stageWsManager.broadcastToStage(chatId, 'plan', {
      type: 'sub_stage',
      sub_stage: 'test',
      progress: `Discovering necessary test jobs based on implementation plan...`,
    });

    const discoveryPromptTemplate = fs.readFileSync(
      path.join(process.cwd(), 'prompts', 'plan-test-discovery.md'),
      'utf-8'
    );

    const discoveryPrompt = discoveryPromptTemplate
      .replace(/{IMPL_JOBS}/g, JSON.stringify(implJobs.map(j => ({ index: j.job_index, title: j.title, description: j.description }))))
      .replace(/{SPEC_CONTEXT}/g, specContext);

    const discoverySessionId = await client.createSession();
    let discoveredTests: { test_title: string; test_description: string; implements_job_index: number }[] = [];

    try {
      const discoveryResult = await client.sendMessage(discoverySessionId, discoveryPrompt, models.planning_model, false, signal);
      const textPart = discoveryResult.parts.find((p: { type?: string }) => p.type === 'text');
      const resultText = textPart?.text?.trim() ?? '';

      const { parsed } = await parseJsonWithRetry<{ test_jobs: { test_title: string; test_description: string; implements_job_index: number }[] }>(
        client, discoverySessionId, resultText, 'test_jobs', 'planning_model', models, 3, signal
      );
      if (parsed && Array.isArray(parsed.test_jobs)) {
        discoveredTests = parsed.test_jobs;
      }
    } catch (err) {
      if (err instanceof WorkflowAbortError) throw err;
      loggerService.appendVerbose(chatId, 'workflow:plan', `Failed to discover tests: ${err}`);
      transitionTo(chatId, 'plan', 'error');
      return;
    } finally {
      try {
        await client.deleteSession(discoverySessionId);
      } catch { /* ignore */ }
    }

    if (discoveredTests.length === 0) {
      loggerService.appendVerbose(chatId, 'workflow:plan', `No manual test jobs discovered.`);
    } else {
      loggerService.appendVerbose(chatId, 'workflow:plan', `Discovered ${discoveredTests.length} test jobs.`);
    }

    // Assign temp negative indices to impl jobs
    for (let i = 0; i < implJobs.length; i++) {
      db.prepare('UPDATE plan_jobs SET job_index = ? WHERE id = ?').run(-(i + 1), implJobs[i].id);
    }

    // Interleave test jobs
    const newJobSequence: { id?: number; isTest: boolean; title: string; description: string; implements_job_id: number | null; requirement_line_mapping: string; block_id: number | null; block_sequence: number }[] = [];
    
    for (const implJob of implJobs) {
      newJobSequence.push({
        id: implJob.id,
        isTest: false,
        title: implJob.title,
        description: implJob.description,
        implements_job_id: null,
        requirement_line_mapping: implJob.requirement_line_mapping,
        block_id: implJob.block_id,
        block_sequence: implJob.block_sequence
      });

      const testsForThisImpl = discoveredTests.filter(t => t.implements_job_index === implJob.job_index);
      for (const t of testsForThisImpl) {
        newJobSequence.push({
          isTest: true,
          title: t.test_title,
          description: t.test_description,
          implements_job_id: implJob.id,
          requirement_line_mapping: implJob.requirement_line_mapping,
          block_id: implJob.block_id,
          block_sequence: implJob.block_sequence
        });
      }
    }

    // Handle tests that map to an invalid/missing impl index by appending them at the end
    const validImplIndices = new Set(implJobs.map(j => j.job_index));
    const orphanTests = discoveredTests.filter(t => !validImplIndices.has(t.implements_job_index));
    const lastImplJob = implJobs.length > 0 ? implJobs[implJobs.length - 1] : null;
    for (const t of orphanTests) {
       newJobSequence.push({
          isTest: true,
          title: t.test_title,
          description: t.test_description,
          implements_job_id: lastImplJob ? lastImplJob.id : null,
          requirement_line_mapping: lastImplJob ? lastImplJob.requirement_line_mapping : '',
          block_id: lastImplJob ? lastImplJob.block_id : null,
          block_sequence: lastImplJob ? lastImplJob.block_sequence : 0
        });
    }

    // Insert pending test jobs and get their IDs, and update impl job indices to final
    const pendingTestJobs: { id: number, title: string, description: string, index: number }[] = [];
    for (let i = 0; i < newJobSequence.length; i++) {
      const jobDef = newJobSequence[i];
      const newIndex = i + 1;
      if (!jobDef.isTest) {
        db.prepare('UPDATE plan_jobs SET job_index = ? WHERE id = ?').run(newIndex, jobDef.id);
      } else {
        const testJobId = insertPlanJob({
          chat_id: chatId,
          job_index: newIndex,
          title: jobDef.title,
          description: jobDef.description,
          requirement_line_mapping: jobDef.requirement_line_mapping,
          block_id: jobDef.block_id,
          block_sequence: jobDef.block_sequence,
          test_plan_markdown: '',
          implements_job_id: jobDef.implements_job_id
        });
        updatePlanJobStatus(testJobId, 'pending');
        updatePlanJobLogs(testJobId, 'Pending evaluation...\n');
        pendingTestJobs.push({ id: testJobId, title: jobDef.title, description: jobDef.description, index: newIndex, implements_job_id: jobDef.implements_job_id });
      }
    }

    if (pendingTestJobs.length > 0) {
      stageWsManager.broadcastToStage(chatId, 'plan', {
        type: 'sub_stage',
        sub_stage: 'test',
        progress: `Generating test plans for ${pendingTestJobs.length} jobs (max 4 in parallel)...`,
      });

      const generationPromptTemplate = fs.readFileSync(
        path.join(process.cwd(), 'prompts', 'plan-test-generation.md'),
        'utf-8'
      );

      await runWithLimit(4, pendingTestJobs.map((job, i) => ({ job, i })), async ({ job, i }) => {
        if (signal?.aborted) {
          updatePlanJobStatus(job.id, 'failed');
          updatePlanJobLogs(job.id, 'Cancelled before generation.\n');
          return;
        }

        const progressMsg = `Generating test plan ${i + 1}/${pendingTestJobs.length}: ${job.title}`;
        loggerService.appendVerbose(chatId, 'workflow:plan', progressMsg);

        updatePlanJobStatus(job.id, 'running');
        updatePlanJobLogs(job.id, 'Generating detailed test instructions...\n');
        stageWsManager.broadcastToStage(chatId, 'plan', {
          type: 'sub_stage',
          sub_stage: 'test',
          progress: progressMsg,
        });

        const pastImplJobs = [];
        const futureImplJobs = [];
        let currentImplJob = null;
        let foundCurrent = false;

        for (const ij of implJobs) {
          if (foundCurrent) {
            futureImplJobs.push({ title: ij.title, description: ij.description });
          } else {
            if (ij.id === job.implements_job_id) {
              currentImplJob = { title: ij.title, description: ij.description };
              foundCurrent = true;
            } else {
              pastImplJobs.push({ title: ij.title, description: ij.description });
            }
          }
        }

        const prompt = generationPromptTemplate
          .replace(/{JOB_TITLE}/g, job.title)
          .replace(/{JOB_DESCRIPTION}/g, job.description)
          .replace(/{CURRENT_IMPL_JOB}/g, JSON.stringify(currentImplJob))
          .replace(/{PAST_IMPL_JOBS}/g, JSON.stringify(pastImplJobs))
          .replace(/{FUTURE_IMPL_JOBS}/g, JSON.stringify(futureImplJobs))
          .replace(/{SPEC_CONTEXT}/g, specContext);

        const sessionId = await client.createSession();
        let parsedTest: { test_plan_markdown: string } | null = null;

        try {
          const result = await client.sendMessage(sessionId, prompt, models.planning_model, false, signal);
          const textPart = result.parts.find((p: { type?: string }) => p.type === 'text');
          const resultText = textPart?.text?.trim() ?? '';

          const { parsed } = await parseJsonWithRetry<{ test_plan_markdown: string }>(
            client, sessionId, resultText, 'test_plan_markdown', 'planning_model', models, 3, signal
          );
          parsedTest = parsed;
        } catch (err) {
          if (err instanceof WorkflowAbortError) throw err;
          loggerService.appendVerbose(chatId, 'workflow:plan', `Failed to generate test for job ${job.title}: ${err}`);
          updatePlanJobStatus(job.id, 'failed');
          updatePlanJobLogs(job.id, `Failed to generate: ${err}\n`);
        } finally {
          try {
            await client.deleteSession(sessionId);
          } catch { /* ignore */ }
        }

        if (parsedTest && parsedTest.test_plan_markdown) {
          updatePlanJobLogs(job.id, `Test plan generated successfully.\n`);
          db.prepare(`
            UPDATE plan_jobs
            SET test_plan_markdown = @test_plan_markdown
            WHERE id = @id
          `).run({
            test_plan_markdown: parsedTest.test_plan_markdown,
            id: job.id
          });
          updatePlanJobStatus(job.id, 'completed');
        } else {
          updatePlanJobLogs(job.id, `Failed to parse test plan markdown.\n`);
          updatePlanJobStatus(job.id, 'failed');
        }
      });
    }

    // Clean spec files from planDir
    if (fs.existsSync(planDir)) {
      const files = fs.readdirSync(planDir);
      for (const file of files) {
        if (file.startsWith('job-') && file.endsWith('.json')) {
          try {
            fs.unlinkSync(path.join(planDir, file));
          } catch { /* ignore */ }
        }
      }
    } else {
      fs.mkdirSync(planDir, { recursive: true });
    }

    const remainingJobs = getPlanJobs(chatId);
    for (let i = 0; i < remainingJobs.length; i++) {
      const job = remainingJobs[i];
      const isTest = job.title.startsWith('Test: ') || job.implements_job_id !== null;
      const jobFile = path.join(planDir, `job-${job.job_index}.json`);
      fs.writeFileSync(jobFile, JSON.stringify({
        index: job.job_index,
        title: job.title,
        description: job.description,
        content: isTest ? job.test_plan_markdown : (job.content || '')
      }, null, 2));
    }

    loggerService.appendVerbose(chatId, 'workflow:plan', `Test generation complete. Transitioning to plan stage.`);
    transitionTo(chatId, 'plan', 'plan');
    stageWsManager.broadcastToStage(chatId, 'plan', { type: 'sub_stage', sub_stage: 'plan' });
  } catch (err) {
    if (err instanceof WorkflowAbortError || signal?.aborted) {
      loggerService.appendVerbose(chatId, 'workflow:plan', `Test generation aborted`);
      return;
    }
    loggerService.appendVerbose(chatId, 'workflow:plan', `Test generation failed: ${err}`);
    const currentChat = getChatSession(chatId);
    if (currentChat && !currentChat.running) {
      return;
    }
    transitionTo(chatId, 'plan', 'error');
  }
}
