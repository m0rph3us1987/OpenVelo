import fs from 'fs';
import path from 'path';
import { execFileSync, spawn } from 'child_process';
import { wsManager, WsKeys } from './websocket-manager';
import { getChatDir, getChatSession } from './db';
import type { Project } from './types';

export interface RepoCloneSettings {
  repoUrl: string;
  repoPat: string | null;
  repoHost: string;
  stagingBranch: string;
}

export type CloneStage = 'cloning' | 'pulling' | 'checkout' | 'starting' | 'done';

export interface CloneJobStatus {
  jobId: string;
  projectId: number;
  running: boolean;
  stage: CloneStage;
  message?: string;
  startedAt: string;
  completedAt: string | null;
  error: string | null;
  branch?: string;
}

const REPO_URL_MARKER = '.openvelo_repo_url';

function getTempDataRoot(): string {
  return (
    process.env.OPENVELO_TEMP_DATA_PATH ||
    process.env.OLYMP_TEMP_DATA ||
    path.join(process.cwd(), 'temp_data')
  );
}

export function getProjectRepoDir(projectId: number): string {
  return path.join(getTempDataRoot(), 'shared_repos', String(projectId), 'repository');
}

export function getProjectRepoParentDir(projectId: number): string {
  return path.join(getTempDataRoot(), 'shared_repos', String(projectId));
}

export function isProjectRepoCloned(projectId: number): boolean {
  const repoDir = getProjectRepoDir(projectId);
  return fs.existsSync(path.join(repoDir, '.git'));
}

export function getStoredRepoUrl(projectId: number): string | null {
  const repoDir = getProjectRepoDir(projectId);
  const marker = path.join(repoDir, REPO_URL_MARKER);
  if (!fs.existsSync(marker)) return null;
  try {
    return fs.readFileSync(marker, 'utf8').trim() || null;
  } catch {
    return null;
  }
}

function writeStoredRepoUrl(projectId: number, url: string): void {
  const repoDir = getProjectRepoDir(projectId);
  fs.writeFileSync(path.join(repoDir, REPO_URL_MARKER), url, 'utf8');
}

export function getProjectRepoLogPath(projectId: number): string {
  return path.join(getTempDataRoot(), 'logs', `repo-clone-${projectId}.log`);
}

function appendLog(projectId: number, line: string): void {
  const logPath = getProjectRepoLogPath(projectId);
  try {
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    fs.appendFileSync(logPath, `[${new Date().toISOString()}] ${line}\n`, 'utf8');
  } catch (err) {
    console.error(`[repo-clone] failed to write log for project ${projectId}:`, err);
  }
  console.log(`[repo-clone project=${projectId}] ${line}`);
}

export function buildFinalRepoURL(repoUrl: string, repoPat: string | null, repoHost: string): string {
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

function runGit(
  args: string[],
  cwd: string,
  projectId: number,
  label: string,
  envOverrides?: NodeJS.ProcessEnv
): Promise<void> {
  return new Promise((resolve, reject) => {
    appendLog(projectId, `${label}: git ${args.join(' ')} (cwd=${cwd})`);
    const proc = spawn('git', args, {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, ...(envOverrides || {}) },
    });

    let stderr = '';
    let stdout = '';
    proc.stdout?.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    proc.stderr?.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    proc.on('error', (err) => {
      reject(err);
    });

    proc.on('close', (code) => {
      if (stdout.trim()) appendLog(projectId, `${label} stdout: ${stdout.trim()}`);
      if (stderr.trim()) appendLog(projectId, `${label} stderr: ${stderr.trim()}`);
      if (code !== 0) {
        reject(new Error(`git ${args.join(' ')} exited with code ${code}: ${stderr.trim() || stdout.trim()}`));
        return;
      }
      resolve();
    });
  });
}

const activeJobs = new Map<number, CloneJobStatus>();
const controllers = new Map<number, AbortController>();

export function getCloneJobStatus(projectId: number): CloneJobStatus | null {
  return activeJobs.get(projectId) || null;
}

function setStatus(status: CloneJobStatus): void {
  activeJobs.set(status.projectId, status);
  wsManager.broadcast(WsKeys.projectKey(status.projectId), statusToMessage(status));
}

function emitUpdate(
  projectId: number,
  jobId: string,
  stage: CloneStage,
  message?: string
): void {
  const existing = activeJobs.get(projectId);
  if (!existing) return;
  existing.stage = stage;
  if (message !== undefined) existing.message = message;
  wsManager.broadcast(WsKeys.projectKey(projectId), {
    type: 'repo_clone_update',
    jobId,
    stage,
    message,
  });
  appendLog(projectId, `[${stage}] ${message || ''}`.trim());
}

function emitComplete(
  projectId: number,
  jobId: string,
  status: 'success' | 'error',
  payload: { error?: string; branch?: string }
): void {
  const existing = activeJobs.get(projectId);
  if (existing) {
    existing.running = false;
    existing.stage = 'done';
    existing.completedAt = new Date().toISOString();
    existing.error = payload.error || null;
    existing.branch = payload.branch;
  }
  wsManager.broadcast(WsKeys.projectKey(projectId), {
    type: 'repo_clone_complete',
    jobId,
    status,
    error: payload.error,
    branch: payload.branch,
  });
  appendLog(projectId, `clone ${status}${payload.error ? `: ${payload.error}` : ''}`);
  // Drop the job from the in-memory map after a short delay so a quick
  // status poll after completion can still see it.
  setTimeout(() => {
    if (activeJobs.get(projectId)?.jobId === jobId) {
      activeJobs.delete(projectId);
    }
  }, 30_000);
}

function statusToMessage(status: CloneJobStatus): Record<string, unknown> {
  return {
    type: 'repo_clone_status',
    jobId: status.jobId,
    running: status.running,
    stage: status.stage,
    message: status.message,
    startedAt: status.startedAt,
    completedAt: status.completedAt,
    error: status.error,
    branch: status.branch,
  };
}

export function startOrAttachCloneJob(
  projectId: number,
  settings: RepoCloneSettings
): string {
  const existing = activeJobs.get(projectId);
  if (existing && existing.running) {
    return existing.jobId;
  }

  const jobId = `clone-${projectId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const controller = new AbortController();
  controllers.set(projectId, controller);

  const status: CloneJobStatus = {
    jobId,
    projectId,
    running: true,
    stage: 'starting',
    message: 'Preparing repository clone...',
    startedAt: new Date().toISOString(),
    completedAt: null,
    error: null,
  };
  setStatus(status);

  // Fire and forget.
  void runCloneWorker(projectId, jobId, settings, controller.signal);

  return jobId;
}

function clearController(projectId: number): void {
  controllers.delete(projectId);
}

async function runCloneWorker(
  projectId: number,
  jobId: string,
  settings: RepoCloneSettings,
  signal: AbortSignal
): Promise<void> {
  const repoDir = getProjectRepoDir(projectId);
  const parentDir = getProjectRepoParentDir(projectId);

  try {
    if (signal.aborted) {
      throw new Error('Clone cancelled');
    }

    fs.mkdirSync(parentDir, { recursive: true });

    const alreadyCloned = isProjectRepoCloned(projectId);
    const storedUrl = alreadyCloned ? getStoredRepoUrl(projectId) : null;
    const urlMatches = alreadyCloned && storedUrl === settings.repoUrl;

    if (alreadyCloned && !urlMatches) {
      emitUpdate(projectId, jobId, 'cloning', 'Repository URL changed — removing old clone');
      appendLog(projectId, `URL mismatch (stored=${storedUrl}, new=${settings.repoUrl}); wiping ${repoDir}`);
      fs.rmSync(repoDir, { recursive: true, force: true });
    }

    if (isProjectRepoCloned(projectId)) {
      emitUpdate(projectId, jobId, 'pulling', 'Fetching latest changes');
      try {
        await runGit(['fetch', '--prune', 'origin'], repoDir, projectId, 'fetch');
      } catch (err) {
        // Fetch may fail (offline / deleted remote); fall back to a status log
        // but keep going — local checkout may still be useful.
        appendLog(projectId, `fetch failed (continuing): ${(err as Error).message}`);
      }

      // Restore the repo to its default branch so downstream chat workflows
      // always start from a known-good reference. The staging branch (and any
      // feature branches) is the responsibility of the chat-level workflow.
      await resetToDefaultBranch(repoDir, projectId, jobId);
    } else {
      emitUpdate(projectId, jobId, 'cloning', 'Cloning repository');
      const finalUrl = buildFinalRepoURL(settings.repoUrl, settings.repoPat, settings.repoHost);
      await runGit(['clone', finalUrl, repoDir], process.cwd(), projectId, 'clone');

      // After a fresh clone HEAD is already on the default branch — nothing
      // else to do here.
    }

    // Persist the URL for future comparison.
    writeStoredRepoUrl(projectId, settings.repoUrl);

    emitUpdate(projectId, jobId, 'done', 'Repository ready');
    emitComplete(projectId, jobId, 'success', { branch: (await getCurrentBranch(repoDir)) ?? undefined });
  } catch (err) {
    const message = (err as Error).message || String(err);
    appendLog(projectId, `clone error: ${message}`);
    emitComplete(projectId, jobId, 'error', { error: message });
  } finally {
    clearController(projectId);
  }
}

async function resetToDefaultBranch(
  repoDir: string,
  projectId: number,
  jobId: string
): Promise<void> {
  // Discover the remote's HEAD (the default branch) without assuming a name.
  // `origin/HEAD` is set by `git clone` and updated by `git fetch`.
  const symbolicHead = await resolveSymbolicHead(repoDir);

  let target: string | null = null;
  if (symbolicHead && symbolicHead.startsWith('refs/remotes/origin/')) {
    target = symbolicHead.slice('refs/remotes/origin/'.length);
  }

  // Fallback: read the symbolic ref via `remote show origin` if origin/HEAD
  // isn't set yet (older repos, manual clones).
  if (!target) {
    target = await detectDefaultBranchViaRemote(repoDir);
  }

  // Last-resort fallback: ask the working tree which branch is the HEAD.
  if (!target) {
    target = await getCurrentBranch(repoDir);
  }

  if (!target) {
    appendLog(projectId, 'Could not determine default branch — leaving working tree as-is');
    return;
  }

  const localRef = `refs/heads/${target}`;
  const localExists = await branchExists(repoDir, target);
  const remoteExists = await branchExists(repoDir, `origin/${target}`);

  emitUpdate(projectId, jobId, 'checkout', `Restoring default branch ${target}`);

  if (localExists) {
    await runGit(['checkout', target], repoDir, projectId, 'checkout');
  } else if (remoteExists) {
    await runGit(['checkout', '-B', target, `origin/${target}`], repoDir, projectId, 'checkout-track');
  } else {
    appendLog(projectId, `Default branch ${target} not present locally or on origin — leaving working tree as-is`);
    return;
  }

  if (remoteExists) {
    // Fast-forward the local default branch to match origin so the next chat
    // pull starts from the latest state.
    try {
      await runGit(['reset', '--hard', `origin/${target}`], repoDir, projectId, 'reset-ff');
    } catch (err) {
      appendLog(projectId, `fast-forward to origin/${target} failed (continuing): ${(err as Error).message}`);
    }
  }

  // Sanity: log which ref we're sitting on.
  const head = await getCurrentBranch(repoDir);
  appendLog(projectId, `default branch resolved to ${head ?? '(detached)'}; symbolic=${symbolicHead ?? '(unset)'}; target=${target}`);
  // Reference to keep the type checker happy if localRef is unused in some flows.
  void localRef;
}

/**
 * Return true if `local` and `remote` share no common ancestor in the working
 * tree of `repoDir` — i.e. one is not reachable from the other. This indicates
 * genuine branch divergence (each side has commits the other does not).
 */
async function areBranchesDiverged(repoDir: string, local: string, remote: string): Promise<boolean> {
  return new Promise((resolve) => {
    const proc = spawn('git', ['merge-base', '--is-ancestor', local, remote], {
      cwd: repoDir,
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let stderr = '';
    proc.stderr?.on('data', (chunk) => { stderr += chunk.toString(); });
    proc.on('close', (code) => {
      if (code === 0) {
        // local is an ancestor of remote → remote is ahead (or equal). Not diverged.
        resolve(false);
      } else if (stderr.includes('no merge base') || stderr.includes('not a tree')) {
        // No common ancestor — they never shared history. Treat as diverged.
        resolve(true);
      } else {
        // exit code != 0 but message doesn't say "no merge base": check the
        // other direction. If remote is not an ancestor of local either, the
        // branches have diverged.
        const reverse = spawn('git', ['merge-base', '--is-ancestor', remote, local], {
          cwd: repoDir,
          stdio: ['ignore', 'ignore', 'pipe'],
        });
        reverse.on('close', (code2) => {
          if (code2 === 0) {
            // remote is an ancestor of local → local is ahead. Not diverged.
            resolve(false);
          } else {
            // Neither side is an ancestor of the other → diverged.
            resolve(true);
          }
        });
        reverse.on('error', () => resolve(true));
      }
    });
    proc.on('error', () => resolve(true));
  });
}

async function branchExists(repoDir: string, branch: string): Promise<boolean> {
  // Accept both local branches ("main") and remote-tracking branches
  // ("origin/main"). Normalize to the right ref namespace before checking.
  const ref = branch.startsWith('origin/')
    ? `refs/remotes/${branch}`
    : `refs/heads/${branch}`;
  return new Promise((resolve) => {
    const proc = spawn('git', ['rev-parse', '--verify', '--quiet', ref], {
      cwd: repoDir,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    proc.on('close', (code) => resolve(code === 0));
    proc.on('error', () => resolve(false));
  });
}

async function getCurrentBranch(repoDir: string): Promise<string | null> {
  return new Promise((resolve) => {
    const proc = spawn('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
      cwd: repoDir,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    proc.stdout?.on('data', (c) => { stdout += c.toString(); });
    proc.on('close', (code) => {
      if (code !== 0) { resolve(null); return; }
      const v = stdout.trim();
      if (!v || v === 'HEAD') resolve(null);
      else resolve(v);
    });
    proc.on('error', () => resolve(null));
  });
}

async function resolveSymbolicHead(repoDir: string): Promise<string | null> {
  return new Promise((resolve) => {
    const proc = spawn('git', ['symbolic-ref', '--quiet', 'refs/remotes/origin/HEAD'], {
      cwd: repoDir,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    proc.stdout?.on('data', (c) => { stdout += c.toString(); });
    proc.on('close', (code) => {
      if (code !== 0) { resolve(null); return; }
      const v = stdout.trim();
      resolve(v || null);
    });
    proc.on('error', () => resolve(null));
  });
}

async function detectDefaultBranchViaRemote(repoDir: string): Promise<string | null> {
  return new Promise((resolve) => {
    const proc = spawn('git', ['remote', 'show', 'origin'], {
      cwd: repoDir,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    proc.stdout?.on('data', (c) => { stdout += c.toString(); });
    proc.on('close', (code) => {
      if (code !== 0) { resolve(null); return; }
      const match = stdout.match(/HEAD branch:\s*([^\s]+)/i);
      resolve(match ? match[1] : null);
    });
    proc.on('error', () => resolve(null));
  });
}

export function runCloneJobAndWait(
  projectId: number,
  settings: RepoCloneSettings,
): Promise<void> {
  const existing = activeJobs.get(projectId);
  const jobId = startOrAttachCloneJob(projectId, settings);
  const current = activeJobs.get(projectId);
  if (!current || current.jobId !== jobId) {
    return Promise.reject(new Error(`Clone job ${jobId} was not found`));
  }
  if (!current.running) {
    return current.error ? Promise.reject(new Error(current.error)) : Promise.resolve();
  }

  return new Promise<void>((resolve, reject) => {
    const deadline = Date.now() + 120_000;
    const poll = () => {
      const status = activeJobs.get(projectId);
      if (status && status.jobId === jobId && !status.running) {
        if (status.error) reject(new Error(status.error));
        else resolve();
        return;
      }
      if (Date.now() >= deadline) {
        reject(new Error(`Clone job ${jobId} timed out`));
        return;
      }
      setTimeout(poll, 200).unref();
    };
    void existing;
    poll();
  });
}

function resolveGbfsBinary(): string | null {
  const configured = process.env.GBFS_BINARY;
  if (configured && fs.existsSync(configured)) return configured;
  if (fs.existsSync('/gbfs/gbfs')) return '/gbfs/gbfs';
  try {
    return execFileSync('which', ['gbfs'], { encoding: 'utf8', timeout: 2000 }).trim() || null;
  } catch {
    return null;
  }
}

export function unmountGbfsIfMounted(mountPoint: string): Promise<void> {
  const gbfs = resolveGbfsBinary();
  if (!gbfs) return Promise.resolve();
  return new Promise((resolve) => {
    const proc = spawn(gbfs, ['unmount', mountPoint], { stdio: 'ignore' });
    const timer = setTimeout(resolve, 3000);
    timer.unref();
    proc.once('close', () => { clearTimeout(timer); resolve(); });
    proc.once('error', () => { clearTimeout(timer); resolve(); });
  });
}

export async function waitForGbfsMount(mountPoint: string, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (fs.existsSync(path.join(mountPoint, '.git'))) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`gbfs mount did not become ready at ${mountPoint} within ${timeoutMs}ms`);
}

export async function isChatMountActive(chatId: number): Promise<boolean> {
  const chat = getChatSession(chatId);
  if (!chat) return false;
  const mountPoint = path.join(getChatDir(chatId, chat.project_id), 'repository');
  if (!fs.existsSync(path.join(mountPoint, '.git'))) return false;
  try {
    const canonical = fs.realpathSync(mountPoint);
    const output = process.platform === 'linux' && fs.existsSync('/proc/mounts')
      ? fs.readFileSync('/proc/mounts', 'utf8')
      : execFileSync('mount', [], { encoding: 'utf8', timeout: 2000 });
    return output.split('\n').some((line) => {
      const columns = line.trim().split(/\s+/);
      return columns.length >= 3 && columns[1] === canonical && /fuse/i.test(columns[2]);
    });
  } catch {
    return false;
  }
}

const projectGitQueues: Map<number, Promise<unknown>> = new Map();

async function runProjectGitExclusive<T>(projectId: number, fn: () => Promise<T>): Promise<T> {
  const previous = projectGitQueues.get(projectId) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(fn);
  projectGitQueues.set(projectId, next);
  try {
    return (await next) as T;
  } finally {
    if (projectGitQueues.get(projectId) === next) {
      projectGitQueues.delete(projectId);
    }
  }
}

export async function setupChatMount(chatId: number, project: Project): Promise<void> {
  await runProjectGitExclusive(project.id, () => doSetupChatMount(chatId, project));
}

async function doSetupChatMount(chatId: number, project: Project): Promise<void> {
  const chat = getChatSession(chatId);
  if (!chat) throw new Error(`chat ${chatId} not found`);
  if (!project.repo_url) throw new Error(`project ${project.id} has no repo_url`);

  const sharedRepoDir = getProjectRepoDir(chat.project_id);
  const mountPoint = path.join(getChatDir(chatId, chat.project_id), 'repository');
  if (!isProjectRepoCloned(chat.project_id)) {
    await runCloneJobAndWait(chat.project_id, {
      repoUrl: project.repo_url,
      repoPat: project.repo_pat,
      repoHost: project.repo_host,
      stagingBranch: project.staging_branch || 'staging',
    });
  }
  const defaultBranch = await resolveProjectDefaultBranch(sharedRepoDir, chat.project_id);
  if (defaultBranch) {
    try {
      await runGit(['checkout', defaultBranch], sharedRepoDir, chat.project_id, 'shared-checkout');
    } catch (err) {
      appendLog(chat.project_id, `shared-checkout skipped: ${(err as Error).message}`);
    }
  }
  await runGit(['pull', '--ff-only'], sharedRepoDir, chat.project_id, 'shared-pull');
  await unmountGbfsIfMounted(mountPoint);
  fs.mkdirSync(mountPoint, { recursive: true });
  const gbfs = resolveGbfsBinary();
  if (!gbfs) throw new Error('gbfs binary not found; web-ui startup check should have caught this');
  const stagingBranch = project.staging_branch || 'staging';
  appendLog(chat.project_id, `gbfs mount ${stagingBranch} ${mountPoint} (cwd=${sharedRepoDir})`);
  const proc = spawn(gbfs, ['mount', stagingBranch, mountPoint], {
    cwd: sharedRepoDir,
    detached: true,
    stdio: 'ignore',
  });
  proc.unref();
  await waitForGbfsMount(mountPoint);
  const remoteUpstream = await branchExists(mountPoint, `origin/${stagingBranch}`);
  const localUpstream = await branchExists(mountPoint, stagingBranch);

  if (remoteUpstream && localUpstream) {
    // Normal case: both the local and remote tracking refs for the staging
    // branch exist. The remote is authoritative — discard any local divergent
    // commits and align the working tree with origin/<staging>.
    await runGit(
      ['branch', `--set-upstream-to=origin/${stagingBranch}`, stagingBranch],
      mountPoint,
      chat.project_id,
      'mount-set-upstream',
    );
    if (await areBranchesDiverged(mountPoint, stagingBranch, `origin/${stagingBranch}`)) {
      appendLog(
        chat.project_id,
        `local ${stagingBranch} diverged from origin/${stagingBranch} — discarding local commits and resetting to remote`,
      );
      await runGit(
        ['reset', '--hard', `origin/${stagingBranch}`],
        mountPoint,
        chat.project_id,
        'mount-reset-remote',
      );
    } else {
      await runGit(['pull', '--ff-only'], mountPoint, chat.project_id, 'mount-pull');
    }
  } else if (localUpstream && !remoteUpstream) {
    // The staging branch exists locally but origin/<staging> doesn't. This can
    // happen when the staging branch has been created but never pushed, or has
    // been deleted on the remote. Fast-forward is not possible; keep the
    // existing local ref and just check it out.
    appendLog(
      chat.project_id,
      `origin/${stagingBranch} missing but local ${stagingBranch} exists — checking out local ref without upstream`,
    );
    await runGit(['checkout', stagingBranch], mountPoint, chat.project_id, 'mount-checkout-staging');
  } else {
    // No local nor remote staging branch. Materialize it from the default
    // branch so the chat repo has a usable working tree.
    appendLog(
      chat.project_id,
      `neither origin/${stagingBranch} nor local ${stagingBranch} exists — creating ${stagingBranch} from ${defaultBranch ?? '(unknown default)'}`,
    );
    await createLocalStagingFromDefault(
      mountPoint,
      chat.project_id,
      stagingBranch,
      defaultBranch,
      sharedRepoDir,
    );
  }
}

async function createLocalStagingFromDefault(
  mountPoint: string,
  projectId: number,
  stagingBranch: string,
  defaultBranch: string | null,
  sharedRepoDir: string,
): Promise<void> {
  // Make sure the default branch's remote tracking ref is up to date in the
  // chat repo by pulling it from the shared repo's file:// transport. This
  // works whether or not gbfs exposed origin/<default> through the mount.
  let sourceDefault: string | null = null;
  if (defaultBranch) {
    if (await branchExists(mountPoint, `origin/${defaultBranch}`)) {
      sourceDefault = `origin/${defaultBranch}`;
    }
  }

  // First try to set HEAD to the default branch so the new staging branch is
  // created on top of a reasonable commit.
  if (defaultBranch) {
    try {
      await runGit(['checkout', defaultBranch], mountPoint, projectId, 'mount-checkout-default');
    } catch (err) {
      appendLog(projectId, `mount-checkout-default failed (continuing): ${(err as Error).message}`);
    }
  }

  // If we don't have origin/<default> available in the mount, fetch it from
  // the shared repo on disk using file:// transport.
  if (!sourceDefault && defaultBranch) {
    try {
      await runGit(
        ['fetch', sharedRepoDir, defaultBranch],
        mountPoint,
        projectId,
        'mount-fetch-shared-default',
      );
      await runGit(
        ['reset', '--hard', 'FETCH_HEAD'],
        mountPoint,
        projectId,
        'mount-reset-shared-default',
      );
      sourceDefault = defaultBranch;
    } catch (err) {
      appendLog(projectId, `mount-fetch-shared-default failed (continuing): ${(err as Error).message}`);
    }
  }

  // Now fast-forward the local working tree to the default branch (without
  // setting an upstream — the goal is just a clean base for the staging
  // branch).
  if (defaultBranch) {
    try {
      await runGit(
        ['pull', '--ff-only', sourceDefault ?? defaultBranch],
        mountPoint,
        projectId,
        'mount-pull-default',
      );
    } catch (err) {
      appendLog(projectId, `mount-pull-default failed (continuing): ${(err as Error).message}`);
    }
  }

  // Create (or recreate) the local staging branch on top of the default. Use
  // -B so it forcibly resets an existing local ref to the current HEAD.
  try {
    await runGit(['checkout', '-B', stagingBranch], mountPoint, projectId, 'mount-create-staging');
  } catch (err) {
    appendLog(projectId, `mount-create-staging failed (continuing): ${(err as Error).message}`);
    if (!(await branchExists(mountPoint, stagingBranch))) throw err;
  }
}

async function resolveProjectDefaultBranch(repoDir: string, projectId: number): Promise<string | null> {
  const symbolic = await resolveSymbolicHead(repoDir);
  if (symbolic && symbolic.startsWith('refs/remotes/origin/')) {
    return symbolic.slice('refs/remotes/origin/'.length);
  }
  const fromRemote = await detectDefaultBranchViaRemote(repoDir);
  if (fromRemote) return fromRemote;
  const fallback = await getCurrentBranch(repoDir);
  appendLog(projectId, `default branch resolution fallback to current HEAD: ${fallback ?? '(none)'}`);
  return fallback;
}

export function cancelCloneJob(projectId: number): boolean {
  const controller = controllers.get(projectId);
  if (!controller) return false;
  controller.abort();
  return true;
}
