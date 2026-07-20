import type { Project, ProjectFormData } from './types';

export interface ValidationStep {
  id: string;
  label: string;
  status?: 'pending' | 'running' | 'success' | 'error' | 'skipped';
  message?: string;
  tab?: string;
  fieldId?: string;
  relevantFields?: (keyof ProjectFormData)[];
}

export const INITIAL_VALIDATION_STEPS: ValidationStep[] = [
  { id: 'name', label: 'Project Name Availability', status: 'pending', tab: 'general', fieldId: 'name' },
  { id: 'port', label: 'Port Availability', status: 'pending', tab: 'general', fieldId: 'port' },
  { id: 'models', label: 'Model Configuration', status: 'pending', tab: 'models', fieldId: 'default_model' },
  { id: 'docker', label: 'Docker Image Implementer', status: 'pending', tab: 'execution', fieldId: 'docker_image' },
  { id: 'docker_tester', label: 'Docker Image Tester', status: 'pending', tab: 'execution', fieldId: 'docker_image_tester' },
  { id: 'repo_clone', label: 'Repository Clone', status: 'pending', tab: 'repo', fieldId: 'repo_url' },
];

export const EDIT_VALIDATION_STEPS: ValidationStep[] = [
  { id: 'name', label: 'Project Name Availability', tab: 'general', fieldId: 'name', relevantFields: ['name'] },
  { id: 'port', label: 'Port Availability', tab: 'general', fieldId: 'port', relevantFields: ['port'] },
  { id: 'models', label: 'Model Configuration', tab: 'models', fieldId: 'default_model', relevantFields: ['default_model', 'execution_model', 'analyzer_model', 'chat_model', 'requirement_model', 'planning_model', 'blueprint_model', 'review_model', 'documentation_model'] },
  { id: 'docker', label: 'Docker Image Implementer', tab: 'execution', fieldId: 'docker_image', relevantFields: ['docker_image'] },
  { id: 'docker_tester', label: 'Docker Image Tester', tab: 'execution', fieldId: 'docker_image_tester', relevantFields: ['docker_image_tester'] },
  { id: 'repo_clone', label: 'Repository Clone', tab: 'repo', fieldId: 'repo_url', relevantFields: ['repo_url', 'repo_pat', 'staging_branch'] },
];

export function projectToFormData(project: Project): ProjectFormData {
  return {
    password: '',
    name: project.name,
    port: project.port,
    repo_host: project.repo_host || 'github',
    repo_url: project.repo_url,
    repo_pat: project.repo_pat || '',
    docker_image: project.docker_image,
    docker_image_tester: project.docker_image_tester,
    backend: project.backend,
    default_model: project.default_model ?? '',
    execution_model: project.execution_model ?? '',
    analyzer_model: project.analyzer_model ?? '',
    chat_model: project.chat_model ?? '',
    requirement_model: project.requirement_model ?? '',
    planning_model: project.planning_model ?? '',
    blueprint_model: project.blueprint_model ?? '',
    review_model: project.review_model ?? '',
    documentation_model: project.documentation_model ?? '',
    build_cmd: project.build_cmd ?? '',
    test_cmd: project.test_cmd ?? '',
    staging_branch: project.staging_branch,
    poll_interval: project.poll_interval,
    agent_max_timeout: project.agent_max_timeout,
    max_parallel_jobs: project.max_parallel_jobs,
    max_retries: project.max_retries ?? 3,
    agent_max_retries: project.agent_max_retries ?? 3,
    remove_deleted_containers: (project.remove_deleted_containers ?? 1) === 1,
  };
}

export interface ValidationHandlers {
  onStepStatus: (index: number, status: ValidationStep['status'], message?: string) => void;
  onValidationFailed: (step: ValidationStep) => void;
  onComplete: (project: Project) => void;
  onError: (message: string) => void;
  onCloneStepStart?: (step: ValidationStep) => void;
  onCloneStepProgress?: (step: ValidationStep, message?: string) => void;
}

export interface CloneStepHandlers {
  onProgress?: (message?: string) => void;
}

function wsUrlForProject(projectId: number): string {
  const port = window.location.port || (window.location.protocol === 'https:' ? '443' : '80');
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.hostname}:${port}/ws?projectId=${projectId}`;
}

/**
 * POST to the backend to start (or attach to) a repository clone job and wait
 * for the matching `repo_clone_complete` frame over the project WebSocket
 * channel before resolving. Rejects with the backend error message on failure
 * or with the WS error message if the socket closes before completion.
 */
export async function runProjectCloneStep(
  projectId: number,
  data: ProjectFormData,
  handlers: CloneStepHandlers = {}
): Promise<void> {
  const startRes = await fetch(`/api/projects/${projectId}/clone_repo`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      repo_url: data.repo_url,
      repo_pat: data.repo_pat,
      repo_host: data.repo_host,
      staging_branch: data.staging_branch,
    }),
  });

  if (!startRes.ok) {
    let detail = `Failed to start repository clone (HTTP ${startRes.status})`;
    try {
      const err = await startRes.json();
      if (err?.error) detail = err.error;
    } catch { /* ignore */ }
    throw new Error(detail);
  }

  const { jobId } = (await startRes.json()) as { jobId: string };

  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const ws = new WebSocket(wsUrlForProject(projectId));

    const finish = (ok: boolean, payload?: { error?: string }) => {
      if (settled) return;
      settled = true;
      try { ws.close(); } catch { /* ignore */ }
      if (ok) {
        resolve();
      } else {
        reject(new Error(payload?.error || 'Repository clone failed'));
      }
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data as string);
        if (msg?.type === 'repo_clone_update' && msg.jobId === jobId) {
          handlers.onProgress?.(msg.message);
        } else if (msg?.type === 'repo_clone_complete' && msg.jobId === jobId) {
          finish(msg.status === 'success', { error: msg.error });
        }
      } catch { /* ignore malformed */ }
    };

    ws.onerror = () => {
      // Don't reject immediately — the server may still complete the job.
    };

    ws.onclose = () => {
      if (!settled) {
        // The socket dropped before completion; fall back to polling status
        // endpoint so transient WS hiccups don't surface as clone failures.
        pollForCloneCompletion(projectId, jobId, handlers).then(
          () => finish(true),
          (err) => finish(false, { error: (err as Error).message })
        );
      }
    };
  });
}

async function pollForCloneCompletion(
  projectId: number,
  jobId: string,
  handlers: CloneStepHandlers
): Promise<void> {
  const deadline = Date.now() + 5 * 60_000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 1000));
    try {
      const res = await fetch(`/api/projects/${projectId}/clone_repo/status`);
      if (!res.ok) continue;
      const data = await res.json();
      if (data.jobId && data.jobId !== jobId) continue;
      if (data.message) handlers.onProgress?.(data.message);
      if (!data.running) {
        if (data.error) throw new Error(data.error);
        return;
      }
    } catch {
      // network blip — keep polling until the deadline
    }
  }
  throw new Error('Timed out waiting for repository clone to complete');
}

export async function runCreateValidation(
  data: ProjectFormData,
  handlers: ValidationHandlers
): Promise<void> {
  for (let i = 0; i < INITIAL_VALIDATION_STEPS.length; i++) {
    const step = INITIAL_VALIDATION_STEPS[i];
    if (step.id === 'repo_clone') continue; // handled after project creation
    handlers.onStepStatus(i, 'running');

    try {
      const res = await fetch('/api/projects/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...data, step: step.id }),
      });
      const result = await res.json();
      if (result.success) {
        handlers.onStepStatus(i, 'success');
      } else {
        handlers.onStepStatus(i, 'error', result.message);
        handlers.onValidationFailed(step);
        return;
      }
    } catch (err) {
      handlers.onStepStatus(i, 'error', String(err));
      return;
    }
  }

  let project: Project;
  try {
    const createRes = await fetch('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!createRes.ok) {
      const errData = await createRes.json().catch(() => ({}));
      handlers.onError(errData.error || 'Failed to create project');
      return;
    }
    project = (await createRes.json()) as Project;
  } catch (err) {
    handlers.onError(String(err));
    return;
  }

  const cloneIndex = INITIAL_VALIDATION_STEPS.findIndex((s) => s.id === 'repo_clone');
  if (cloneIndex === -1) {
    handlers.onComplete(project);
    return;
  }

  const cloneStep = INITIAL_VALIDATION_STEPS[cloneIndex];
  handlers.onStepStatus(cloneIndex, 'running');
  handlers.onCloneStepStart?.(cloneStep);
  try {
    await runProjectCloneStep(project.id, data, {
      onProgress: (msg) => handlers.onCloneStepProgress?.(cloneStep, msg),
    });
    handlers.onStepStatus(cloneIndex, 'success');
    handlers.onComplete(project);
  } catch (err) {
    const message = (err as Error).message || String(err);
    handlers.onStepStatus(cloneIndex, 'error', message);
    handlers.onValidationFailed(cloneStep);
  }
}

function hasRelevantFieldsChanged(initial: ProjectFormData, current: ProjectFormData, fields?: (keyof ProjectFormData)[]): boolean {
  if (!fields) return false;
  return fields.some((field) => String(initial[field]) !== String(current[field]));
}

export async function runUpdateValidation(
  project: Project,
  data: ProjectFormData,
  handlers: ValidationHandlers & { onNoChanges: () => void }
): Promise<void> {
  const initialData = projectToFormData(project);

  // Probe the server for the on-disk shared-repo state so we can still
  // trigger the clone step when no repo settings changed but the repo
  // has not been cloned yet (e.g. previous clone failed or was wiped).
  let repoNotClonedYet = false;
  try {
    const statusRes = await fetch(`/api/projects/${project.id}/clone_repo/status`);
    if (statusRes.ok) {
      const status = await statusRes.json();
      repoNotClonedYet = status.cloned === false;
    } else {
      repoNotClonedYet = true;
    }
  } catch {
    repoNotClonedYet = true;
  }

  const stepsToValidate = EDIT_VALIDATION_STEPS.map((step) => {
    const fieldChanged = hasRelevantFieldsChanged(initialData, data, step.relevantFields);
    const needsCloneFallback = step.id === 'repo_clone' && repoNotClonedYet;
    return {
      ...step,
      status: (fieldChanged || needsCloneFallback) ? ('pending' as const) : ('skipped' as const),
    };
  });

  const pendingSteps = stepsToValidate.filter((s) => s.status === 'pending');
  const cloneNeedsRun = pendingSteps.some((s) => s.id === 'repo_clone');
  const nonClonePending = pendingSteps.filter((s) => s.id !== 'repo_clone');

  if (nonClonePending.length === 0 && !cloneNeedsRun) {
    handlers.onNoChanges();
    try {
      const updateRes = await fetch(`/api/projects/${project.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (updateRes.ok) {
        handlers.onComplete(project);
      } else {
        const updateResult = await updateRes.json();
        handlers.onError(updateResult.error || 'Save failed');
      }
    } catch (err) {
      handlers.onError(String(err));
    }
    return;
  }

  for (let i = 0; i < stepsToValidate.length; i++) {
    const step = stepsToValidate[i];
    if (step.status === 'skipped') continue;
    if (step.id === 'repo_clone') continue; // handled after PUT
    handlers.onStepStatus(i, 'running');

    try {
      const res = await fetch('/api/projects/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...data, id: project.id, step: step.id }),
      });
      const result = await res.json();
      if (result.success) {
        handlers.onStepStatus(i, 'success');
      } else {
        handlers.onStepStatus(i, 'error', result.message);
        handlers.onValidationFailed(step);
        return;
      }
    } catch (err) {
      handlers.onStepStatus(i, 'error', String(err));
      return;
    }
  }

  try {
    const updateRes = await fetch(`/api/projects/${project.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!updateRes.ok) {
      const updateResult = await updateRes.json().catch(() => ({}));
      handlers.onError(updateResult.error || 'Save failed');
      return;
    }
  } catch (err) {
    handlers.onError(String(err));
    return;
  }

  if (!cloneNeedsRun) {
    handlers.onComplete(project);
    return;
  }

  const cloneIndex = EDIT_VALIDATION_STEPS.findIndex((s) => s.id === 'repo_clone');
  const cloneStep = EDIT_VALIDATION_STEPS[cloneIndex];
  handlers.onStepStatus(cloneIndex, 'running');
  handlers.onCloneStepStart?.(cloneStep);
  try {
    await runProjectCloneStep(project.id, data, {
      onProgress: (msg) => handlers.onCloneStepProgress?.(cloneStep, msg),
    });
    handlers.onStepStatus(cloneIndex, 'success');
    handlers.onComplete(project);
  } catch (err) {
    const message = (err as Error).message || String(err);
    handlers.onStepStatus(cloneIndex, 'error', message);
    handlers.onValidationFailed(cloneStep);
  }
}
