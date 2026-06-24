import { Router } from 'express';
import {
  getAllProjects,
  createProject,
  getNextAvailablePort,
  initDb,
  getProject,
  getProjectByName,
  updateProject,
  deleteProject,
  markProjectRunning,
  markProjectStopped,
  getJobsByProject,
  insertLocalJob,
  deleteJobs,
  getJob,
  setJobStatus,
  isPortInUse,
  updateJob,
  resetJob,
  getProjectModels,
  getAllModels,
  isUserAuthorizedForProject,
  getProjectsForUser,
  getPlanJobs,
  getDb,
  updateJobStopped,
} from '@/lib/db';
import type { ProjectFormData, Project } from '@/lib/types';
import { sendToOrchestrator, getOrchestrator, isOrchestratorConnected } from '@/lib/orch-registry';
import { wsManager, WsKeys } from '@/lib/websocket-manager';
import { requestJobState } from '@/lib/job-state';
import { requestJobAgentStatus } from '@/lib/agent-status';
import { requireProjectAccess } from '../middleware/auth';
import bcrypt from 'bcryptjs';
import path from 'path';
import fs from 'fs';
import { spawn, execSync, execFileSync } from 'child_process';
import Docker from 'dockerode';

export const projectsRouter = Router();

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sanitizeProject(p: Project) {
  const { password_hash, ...rest } = p;
  void password_hash; // intentionally excluded from returned object
  return {
    ...rest,
    has_repo_pat: !!p.repo_pat,
  };
}

export function generateFinalRepoURL(repoUrl: string, repoPat: string, repoHost: string): string {
  if (!repoPat) return repoUrl;
  try {
    const u = new URL(repoUrl);
    if (repoHost === 'bitbucket') {
      u.username = 'x-token-auth';
    } else {
      u.username = 'token';
    }
    u.password = repoPat;
    return u.toString();
  } catch {
    return repoUrl;
  }
}

function createDockerClient(): Docker {
  if (process.platform === 'win32') return new Docker();
  const socketPath = process.env.DOCKER_HOST
    ? process.env.DOCKER_HOST.replace(/^unix:\/\//, '')
    : fs.existsSync('/home/' + (process.env.USER || process.env.LOGNAME || 'root') + '/.docker/desktop/docker.sock')
      ? '/home/' + (process.env.USER || process.env.LOGNAME || 'root') + '/.docker/desktop/docker.sock'
      : '/var/run/docker.sock';
  return new Docker({ socketPath });
}

// ─── Projects CRUD ────────────────────────────────────────────────────────────

projectsRouter.post('/validate', async (req, res) => {
  const { id, name, port, repo_url, repo_pat, repo_host, docker_image, step } = req.body;
  
  try {
    initDb();
    
    switch (step) {
      case 'name': {
        if (!name) {
          return res.json({ success: false, message: 'Project name is required' });
        }
        const existing = getProjectByName(name);
        if (existing && (!id || existing.id !== parseInt(id))) {
          return res.json({ success: false, message: 'Project name already exists' });
        }
        return res.json({ success: true });
      }

      case 'port': {
        if (!port) {
          return res.json({ success: false, message: 'Port is required' });
        }
        if (isPortInUse(port, id ? parseInt(id) : undefined)) {
          return res.json({ success: false, message: 'Port is already in use by another project' });
        }
        return res.json({ success: true });
      }

      case 'coding':
      case 'planning': {
        return res.json({ success: true });
      }

      case 'repo': {
        if (repo_url) {
          const finalUrl = generateFinalRepoURL(repo_url, repo_pat || '', repo_host || 'github');
          try {
            execFileSync('git', ['ls-remote', finalUrl], { stdio: 'ignore', timeout: 10000 });
            return res.json({ success: true });
          } catch {
            return res.json({ success: false, message: 'Failed to connect to repository. Check URL and Token.' });
          }
        }
        return res.json({ success: true });
      }

      case 'docker': {
        if (docker_image) {
          const docker = createDockerClient();
          try {
            await docker.getImage(docker_image).inspect();
            return res.json({ success: true });
          } catch {
            return res.json({ success: false, message: `Docker image '${docker_image}' not found locally.` });
          }
        }
        return res.json({ success: true });
      }

      case 'models': {
        const { default_model } = req.body;
        if (!default_model) {
          return res.json({ success: false, message: 'Default model is required. Please select a model in the Models tab.' });
        }
        const allModels = getAllModels();
        const modelExists = allModels.some(m => `${m.provider}/${m.model_name}` === default_model);
        if (!modelExists) {
          return res.json({ success: false, message: `Default model "${default_model}" is not in the models table. Please refresh models or select a valid model.` });
        }
        return res.json({ success: true });
      }

      default:
        return res.status(400).json({ error: 'Invalid validation step' });
    }
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

projectsRouter.get('/', (req, res) => {
  if (!req.user) { res.status(401).json({ error: 'Unauthorized' }); return; }
  try {
    initDb();
    const projects = req.user.role === 'admin'
      ? getAllProjects()
      : getProjectsForUser(req.user.id, req.user.role);
    res.json(projects.map(sanitizeProject));
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

projectsRouter.get('/next-port', (_req, res) => {
  try {
    initDb();
    const port = getNextAvailablePort();
    res.json({ port });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

projectsRouter.post('/', async (req, res) => {
  if (!req.user) { res.status(401).json({ error: 'Unauthorized' }); return; }
  if (req.user.role !== 'admin') { res.status(403).json({ error: 'Forbidden' }); return; }
  const body = req.body as ProjectFormData;
  try {
    initDb();
    const password_hash = body.password ? await bcrypt.hash(body.password, 10) : null;
    const port = parseInt(String(body.port));

    const project = createProject({
      name: body.name,
      password_hash,
      port,
      repo_host: body.repo_host || 'github',
      repo_url: body.repo_url ?? '',
      repo_pat: body.repo_pat || null,
      docker_image: body.docker_image || 'openvelo-agent:linux',
      backend: body.backend || 'opencode',
      default_model: body.default_model || '',
      execution_model: body.execution_model || '',
      analyzer_model: body.analyzer_model || '',
      chat_model: body.chat_model || '',
      requirement_model: body.requirement_model || '',
      planning_model: body.planning_model || '',
      blueprint_model: body.blueprint_model || '',
      review_model: body.review_model || '',
      documentation_model: body.documentation_model || '',
      build_cmd: body.build_cmd || null,
      test_cmd: body.test_cmd || null,
      staging_branch: body.staging_branch || 'staging',
      poll_interval: body.poll_interval || 60000,
      agent_max_timeout: body.agent_max_timeout !== undefined ? body.agent_max_timeout : 300,
      max_parallel_jobs: body.max_parallel_jobs || 1,
      max_retries: body.max_retries ?? 3,
      agent_max_retries: body.agent_max_retries ?? 3,
      remove_deleted_containers: body.remove_deleted_containers === undefined ? 1 : (body.remove_deleted_containers ? 1 : 0),
      status: 'stopped',
      pid: null,
    });

    res.status(201).json(sanitizeProject(project));
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

projectsRouter.get('/:id', requireProjectAccess, (req, res) => {
  if (!req.user) { res.status(401).json({ error: 'Unauthorized' }); return; }
  const { id } = req.params;
  try {
    initDb();
    const project = getProject(parseInt(id));
    if (!project) { res.status(404).json({ error: 'Not found' }); return; }
    if (req.user.role !== 'admin' && !isUserAuthorizedForProject(req.user.id, project.id)) {
      res.status(403).json({ error: 'Forbidden' }); return;
    }
    res.json(sanitizeProject(project));
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

projectsRouter.get('/:id/models', requireProjectAccess, (req, res) => {
  const { id } = req.params;
  try {
    initDb();
    const models = getProjectModels(parseInt(id));
    res.json(models);
  } catch (err) {
    res.status(404).json({ error: String(err) });
  }
});

projectsRouter.put('/:id', requireProjectAccess, async (req, res) => {
  if (!req.user) { res.status(401).json({ error: 'Unauthorized' }); return; }
  const { id } = req.params;
  try {
    initDb();
    if (req.user.role !== 'admin' && !isUserAuthorizedForProject(req.user.id, parseInt(id))) {
      res.status(403).json({ error: 'Forbidden' }); return;
    }
    const {
      name,
      repo_host,
      repo_url,
      repo_pat,
      docker_image,
      backend,
      default_model,
      execution_model,
      analyzer_model,
      chat_model,
      requirement_model,
      planning_model,
      blueprint_model,
      review_model,
      documentation_model,
      build_cmd,
      test_cmd,
      staging_branch,
      poll_interval,
      agent_max_timeout,
      max_parallel_jobs,
      max_retries,
      agent_max_retries,
      remove_deleted_containers,
      password,
    } = req.body as Partial<Project & { password: string }>;

    const updates: Partial<Project> = {};
    if (name !== undefined) updates.name = name;
    if (repo_host !== undefined) updates.repo_host = repo_host;
    if (repo_url !== undefined) updates.repo_url = repo_url;
    if (repo_pat !== undefined) updates.repo_pat = repo_pat;
    if (docker_image !== undefined) updates.docker_image = docker_image;
    if (backend !== undefined) updates.backend = backend;
    if (default_model !== undefined) updates.default_model = default_model;
    if (execution_model !== undefined) updates.execution_model = execution_model;
    if (analyzer_model !== undefined) updates.analyzer_model = analyzer_model;
    if (chat_model !== undefined) updates.chat_model = chat_model;
    if (requirement_model !== undefined) updates.requirement_model = requirement_model;
    if (planning_model !== undefined) updates.planning_model = planning_model;
    if (blueprint_model !== undefined) updates.blueprint_model = blueprint_model;
    if (review_model !== undefined) updates.review_model = review_model;
    if (documentation_model !== undefined) updates.documentation_model = documentation_model;
    if (build_cmd !== undefined) updates.build_cmd = build_cmd;
    if (test_cmd !== undefined) updates.test_cmd = test_cmd;
    if (staging_branch !== undefined) updates.staging_branch = staging_branch;
    if (poll_interval !== undefined) updates.poll_interval = poll_interval;
    if (agent_max_timeout !== undefined) updates.agent_max_timeout = agent_max_timeout;
    if (max_parallel_jobs !== undefined) updates.max_parallel_jobs = max_parallel_jobs;
    if (max_retries !== undefined) updates.max_retries = max_retries;
    if (agent_max_retries !== undefined) updates.agent_max_retries = agent_max_retries;

    if (!updates.repo_pat) delete updates.repo_pat;
    if (!updates.planning_model) delete updates.planning_model;
    
    if (password) {
      updates.password_hash = await bcrypt.hash(password, 10);
    }
    
    if (typeof remove_deleted_containers === 'boolean') {
      updates.remove_deleted_containers = remove_deleted_containers ? 1 : 0;
    }
    
    const project = updateProject(parseInt(id), updates);
    if (!project) { res.status(404).json({ error: 'Not found' }); return; }
    res.json(sanitizeProject(project));
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

projectsRouter.delete('/:id', requireProjectAccess, (req, res) => {
  if (!req.user) { res.status(401).json({ error: 'Unauthorized' }); return; }
  if (req.user.role !== 'admin') { res.status(403).json({ error: 'Forbidden' }); return; }
  const { id } = req.params;
  try {
    initDb();
    const project = getProject(parseInt(id));
    if (!project) { res.status(404).json({ error: 'Not found' }); return; }
    deleteProject(parseInt(id));
    res.json(sanitizeProject(project));
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

projectsRouter.get('/:id/status', requireProjectAccess, (req, res) => {
  const projectId = parseInt(req.params.id);
  res.json({ status: isOrchestratorConnected(projectId) ? 'running' : 'stopped' });
});

// ─── Orchestrator Control ─────────────────────────────────────────────────────

projectsRouter.post('/:id/start', requireProjectAccess, async (req, res) => {
  const { id } = req.params;
  try {
    initDb();
    const project = getProject(parseInt(id));
    if (!project) { res.status(404).json({ error: 'Not found' }); return; }

    const models = getProjectModels(parseInt(id));
    if (!models.execution_model) {
      res.status(400).json({ error: 'Execution model is not set and no default model is configured. Please configure a default model in the Models tab of project settings.' });
      return;
    }

    const allModels = getAllModels();
    const modelExists = allModels.some(m => `${m.provider}/${m.model_name}` === models.default_model);
    if (!modelExists) {
      res.status(400).json({ error: `Default model "${models.default_model}" is not in the models table. Please refresh models or select a valid default model in the Models tab of project settings.` });
      return;
    }

    const allResolvedModels = [
      { field: 'blueprint_model', value: models.blueprint_model },
      { field: 'execution_model', value: models.execution_model },
      { field: 'review_model', value: models.review_model },
      { field: 'documentation_model', value: models.documentation_model },
    ];
    for (const { field, value } of allResolvedModels) {
      if (value === models.default_model) continue;
      const exists = allModels.some(m => `${m.provider}/${m.model_name}` === value);
      if (!exists) {
        res.status(400).json({ error: `Model "${value}" (${field}) is not in the models table. Please refresh models or select a valid model in the Models tab of project settings.` });
        return;
      }
    }

    if (project.status === 'paused') {
      const sent = sendToOrchestrator(parseInt(id), { type: 'resume' });
      if (sent) { res.json({ success: true, mode: 'resumed' }); return; }
    }

    if (project.status === 'running') {
      const connected = sendToOrchestrator(parseInt(id), { type: 'ping_check' });
      if (connected) { res.status(400).json({ error: 'Already running' }); return; }
      markProjectStopped(parseInt(id));
    }

    const containerMode = process.env.OPENVELO_CONTAINER_MODE === 'true';

    if (containerMode) {
      await spawnOrchestratorContainer(id, res);
    } else {
      await spawnOrchestratorProcess(id, project, res);
    }
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

async function spawnOrchestratorProcess(id: string, project: ReturnType<typeof getProject>, res: import('express').Response) {
  const orchestratorSrc = path.join(process.cwd(), '..', 'orchestrator', 'src', 'index.ts');
  const tsxBin = path.join(process.cwd(), '..', 'orchestrator', 'node_modules', '.bin', process.platform === 'win32' ? 'tsx.cmd' : 'tsx');

  const dbPath = process.env.OPENVELO_DB_PATH
    ? path.resolve(process.env.OPENVELO_DB_PATH)
    : path.resolve(process.cwd(), '..', '..', 'openvelo.sqlite');

  const logDir = path.join(
    process.env.OPENVELO_TEMP_DATA_PATH ?? path.join(process.cwd(), 'temp_data'),
    'logs'
  );
  if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
  const logFile = path.join(logDir, `orchestrator-${id}.log`);
  const logFd = fs.openSync(logFile, 'a');

  const models = getProjectModels(parseInt(id));
  const resolvedExecutionModel = models.execution_model;
  console.log(`[projects] Spawning orchestrator process for project ${id} with BACKEND_MODEL=${resolvedExecutionModel}`);
  const child = spawn(tsxBin, [orchestratorSrc, `--project-id=${id}`], {
    detached: false,
    stdio: ['ignore', logFd, logFd],
    shell: process.platform === 'win32',
    env: {
      ...process.env,
      OPENVELO_DB_PATH: dbPath,
      WEB_UI_URL: `ws://localhost:${process.env.PORT || 3000}`,
      DOCKER_IMAGE: project?.docker_image || 'openvelo-agent:linux',
      BACKEND: project?.backend || 'gemini',
      BACKEND_MODEL: resolvedExecutionModel,
      STAGING_BRANCH: project?.staging_branch || 'staging',
      MAX_PARALLEL_JOBS: String(project?.max_parallel_jobs ?? 1),
      MAX_RETRIES: String(project?.max_retries ?? 3),
    },
  });

  child.on('exit', () => {
    fs.closeSync(logFd);
    try { markProjectStopped(parseInt(id)); } catch { /* db may be closed */ }
  });
  child.on('error', () => {
    fs.closeSync(logFd);
    try { markProjectStopped(parseInt(id)); } catch { /* db may be closed */ }
  });
  child.unref();

  const projectId = parseInt(id);
  for (let i = 0; i < 20; i++) {
    await new Promise(resolve => setTimeout(resolve, 500));
    if (getOrchestrator(projectId)) {
      markProjectRunning(projectId, child.pid ?? 0);
      res.json({ success: true, mode: 'spawned' });
      return;
    }
  }

  let logTail = '';
  try {
    const logContent = fs.readFileSync(logFile, 'utf-8');
    logTail = logContent.trim().split('\n').slice(-10).join('\n');
  } catch { /* ignore */ }
  markProjectStopped(parseInt(id));
  res.status(500).json({
    error: `Orchestrator failed to connect. Check logs at ${logFile}`,
    log: logTail,
  });
}

async function spawnOrchestratorContainer(id: string, res: import('express').Response) {
  const { dockerManager: dm } = await import('@/lib/docker-manager');
  
  let webUiUrl = process.env.WEB_UI_URL || 'ws://host.docker.internal:3000';
  
  // If running inside docker, the docker-compose.yml often hardcodes host.docker.internal.
  // We actively rewrite this to the container's internal hostname to use the internal Docker network.
  if (process.env.OPENVELO_CONTAINER_MODE === 'true' && process.env.HOSTNAME) {
    if (webUiUrl.includes('host.docker.internal')) {
      const internalPort = process.env.PORT || '3000';
      webUiUrl = `ws://${process.env.HOSTNAME}:${internalPort}`;
      console.log(`[projects] Rewrote WEB_UI_URL to internal network: ${webUiUrl}`);
    }
  }

  const tempDataHostPath = process.env.OPENVELO_TEMP_DATA_HOST_PATH || process.env.OPENVELO_TEMP_DATA_PATH || '';
  const skillsHostPath = process.env.OPENVELO_SKILLS_HOST_PATH || '';

  try {
    const models = getProjectModels(parseInt(id));
    console.log(`[projects] Spawning orchestrator container for project ${id} with resolved execution_model=${models.execution_model}`);

    const { containerId } = await dm.spawnOrchestratorContainer(
      parseInt(id),
      0,
      {
        WEB_UI_URL: webUiUrl,
        OPENVELO_TEMP_DATA_HOST_PATH: tempDataHostPath,
        OPENVELO_SKILLS_HOST_PATH: skillsHostPath,
        OPENVELO_HOST_HOME: process.env.OPENVELO_HOST_HOME || '',
      }
    );

    const projectId = parseInt(id);
    for (let i = 0; i < 30; i++) {
      await new Promise(resolve => setTimeout(resolve, 500));
      if (getOrchestrator(projectId)) {
        markProjectRunning(projectId, 0);
        res.json({ success: true, mode: 'container', containerId });
        return;
      }
    }

    markProjectStopped(parseInt(id));
    res.status(500).json({ error: 'Orchestrator container started but did not connect.' });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
}

projectsRouter.post('/:id/stop', requireProjectAccess, async (req, res) => {
  const { id } = req.params;
  initDb();
  const project = getProject(parseInt(id));
  if (!project) { res.json({ success: true }); return; }

  const body = (req.body ?? {}) as { checkpoint?: boolean };
  const sent = sendToOrchestrator(parseInt(id), {
    type: 'shutdown',
    checkpoint: body.checkpoint ?? false,
  });

  if (!sent) {
    // Orchestrator isn't connected — fall back to PID kill
    if (project.pid) {
      try { process.kill(project.pid, 'SIGTERM'); } catch { /* already gone */ }
    }
    markProjectStopped(parseInt(id));
  }

  res.json({ success: true });
});


// ─── Work Items / Jobs ────────────────────────────────────────────────────────

projectsRouter.post('/:id/updateBuildTest', requireProjectAccess, (req, res) => {
  const { id } = req.params;
  const { build_cmd, test_cmd } = req.body as { build_cmd?: string; test_cmd?: string };
  try {
    initDb();
    const project = getProject(parseInt(id));
    if (!project) { res.status(404).json({ error: 'Not found' }); return; }
    const updates: Partial<Project> = {};
    if (build_cmd !== undefined) updates.build_cmd = build_cmd;
    if (test_cmd !== undefined) updates.test_cmd = test_cmd;
    const updated = updateProject(parseInt(id), updates);
    res.json(sanitizeProject(updated));
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

projectsRouter.post('/:id/create-jobs-from-stories', requireProjectAccess, (req, res) => {
  const { id } = req.params;
  const { chatId } = req.body;
  if (!chatId) {
    res.status(400).json({ error: 'chatId is required' });
    return;
  }
  try {
    initDb();
    const project = getProject(parseInt(id));
    if (!project) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }
    const planJobs = getPlanJobs(Number(chatId));
    if (planJobs.length === 0) {
      res.status(400).json({ error: 'No planned jobs found for chatId', chatId });
      return;
    }
    const jobIds: number[] = [];

    let prevJobId: number | null = null;
    for (const planJob of planJobs) {
      const job = insertLocalJob(parseInt(id), {
        title: planJob.title,
        description: planJob.content || planJob.description || '',
        dependsOn: prevJobId ? [String(prevJobId)] : []
      });
      jobIds.push(job.id);
      prevJobId = job.id;
    }

    res.json({ success: true, jobsCreated: jobIds.length, jobIds });
  } catch (err) {
    console.error('create-jobs error:', err);
    res.status(500).json({ error: String(err) });
  }
});

projectsRouter.get('/:id/jobs', requireProjectAccess, (req, res) => {
  const { id } = req.params;
  try {
    initDb();
    res.json(getJobsByProject(parseInt(id)));
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

projectsRouter.post('/:id/jobs', requireProjectAccess, (req, res) => {
  const { id } = req.params;
  const body = req.body;
  try {
    initDb();
    const job = insertLocalJob(parseInt(id), {
      ...body,
      status: 'PENDING',
    });
    res.status(201).json(job);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

projectsRouter.patch('/:id/jobs/:jobId', requireProjectAccess, (req, res) => {
  const { jobId } = req.params;
  const body = req.body;
  try {
    initDb();
    const job = updateJob(parseInt(jobId), {
      title: body.title,
      description: body.description,
      depends_on: body.dependsOn ? JSON.stringify(body.dependsOn) : null,
    });
    if (!job) return res.status(404).json({ error: 'Job not found' });
    res.json(job);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

projectsRouter.post('/:id/jobs/set-status', requireProjectAccess, (req, res) => {
  const { id } = req.params;
  const projectId = parseInt(id);
  const { jobIds, status } = req.body;
  try {
    initDb();
    jobIds.forEach((jobId: number) => {
      setJobStatus(jobId, status);
    });
    jobIds.forEach((jobId: number) => {
      wsManager.broadcast(WsKeys.projectKey(projectId), {
        type: 'job_update',
        jobId,
        status,
        timestamp: new Date().toISOString(),
      });
    });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

projectsRouter.delete('/:id/jobs', requireProjectAccess, (req, res) => {
  const { id } = req.params;
  const { jobIds } = req.body;
  try {
    initDb();
    deleteJobs(parseInt(id), jobIds);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

projectsRouter.post('/:id/jobs/:jobId/reset', requireProjectAccess, (req, res) => {
  const { id, jobId } = req.params;
  try {
    initDb();
    resetJob(parseInt(jobId));
    wsManager.broadcast(WsKeys.projectKey(parseInt(id)), {
      type: 'job_update',
      jobId: parseInt(jobId),
      status: 'PENDING',
      timestamp: new Date().toISOString(),
    });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

projectsRouter.post('/:id/jobs/:jobId/stop', requireProjectAccess, (req, res) => {
  const { id, jobId } = req.params;
  try {
    initDb();
    const job = getJob(parseInt(jobId));
    if (!job) {
      res.status(404).json({ error: 'Job not found' });
      return;
    }

    if (job.status === 'RUNNING') {
      sendToOrchestrator(parseInt(id), { type: 'stop_job', jobId: parseInt(jobId) });
    } else {
      updateJobStopped(parseInt(jobId), job.runtime || 0);
      wsManager.broadcast(WsKeys.projectKey(parseInt(id)), {
        type: 'job_update',
        jobId: parseInt(jobId),
        status: 'STOPPED',
        timestamp: new Date().toISOString(),
      });
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

projectsRouter.get('/:id/jobs/:jobId/started-at', requireProjectAccess, (req, res) => {
  const { jobId } = req.params;
  try {
    initDb();
    const job = getJob(parseInt(jobId));
    if (!job || !job.container_id) {
      res.json({ startedAt: null });
      return;
    }

    const startedAt = execSync(
      `docker inspect --format={{.State.StartedAt}} ${job.container_id}`,
      { encoding: 'utf-8', timeout: 5000 }
    ).trim();
    res.json({ startedAt: startedAt || null });
  } catch {
    res.json({ startedAt: null });
  }
});

projectsRouter.get('/:id/jobs/:jobId/container-logs', requireProjectAccess, async (req, res) => {
  const { jobId } = req.params;
  try {
    initDb();
    const job = getJob(parseInt(jobId));
    if (!job || !job.container_id) {
      return res.json({ logs: 'No container ID' });
    }
    const docker = createDockerClient();
    const container = docker.getContainer(job.container_id);
    const logs = await container.logs({
      stdout: true,
      stderr: true,
      tail: 2000,
    });
    // Logs are returned as Buffers with 8-byte headers. Strip headers.
    let logString = '';
    let offset = 0;
    while (offset < logs.length) {
      const size = logs.readUInt32BE(offset + 4);
      logString += logs.toString('utf8', offset + 8, offset + 8 + size);
      offset += 8 + size;
    }
    res.json({ logs: logString });
  } catch (err) {
    res.json({ logs: `Error fetching logs: ${String(err)}` });
  }
});

projectsRouter.get('/:id/jobs/:jobId/state', requireProjectAccess, async (req, res) => {
  const { id, jobId } = req.params;
  const projectId = parseInt(id);
  const jobIdNum = parseInt(jobId);

  const orchWs = getOrchestrator(projectId);
  if (!orchWs || (orchWs.readyState as number) !== 1 /* OPEN */) {
    res.json({ state: null, plan: null, usage: null, reason: 'orchestrator_offline' });
    return;
  }

  try {
    const { state, plan, usage } = await requestJobState(orchWs, jobIdNum);
    if (state === null) {
      res.json({ state: null, plan: null, usage: null, reason: 'timeout' });
    } else {
      res.json({ state, plan, usage });
    }
  } catch (err) {
    res.json({ state: null, plan: null, usage: null, reason: 'error', error: String(err) });
  }
});

projectsRouter.get('/:id/jobs/:jobId/agent-status', requireProjectAccess, async (req, res) => {
  const { id, jobId } = req.params;
  const projectId = parseInt(id);
  const jobIdNum = parseInt(jobId);

  const orchWs = getOrchestrator(projectId);
  if (!orchWs || (orchWs.readyState as number) !== 1 /* OPEN */) {
    res.json({ state: null, plan: null, usage: null, reason: 'orchestrator_offline' });
    return;
  }

  try {
    const { state, plan, usage } = await requestJobAgentStatus(orchWs, jobIdNum);
    if (state === null) {
      res.json({ state: null, plan: null, usage: null, reason: 'timeout' });
    } else {
      res.json({ state, plan, usage });
    }
  } catch (err) {
    res.json({ state: null, plan: null, usage: null, reason: 'error', error: String(err) });
  }
});
