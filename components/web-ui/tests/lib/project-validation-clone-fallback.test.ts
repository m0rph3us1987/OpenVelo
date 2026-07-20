import { describe, it, mock } from 'node:test';
import assert from 'node:assert';

// Provide a minimal `window` shim so the module under test can be imported
// outside a real browser (project-validation.ts uses `wsUrlForProject` which
// reads `window.location`).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const g: any = globalThis;
if (!g.window) {
  g.window = { location: { protocol: 'http:', host: 'localhost:3000', port: '3000' } };
}

// Stub WebSocket — Node has none. Return a dummy that immediately closes so
// runProjectCloneStep falls back to the polling path.
class FakeWebSocket {
  onmessage: ((ev: any) => void) | null = null;
  onerror: ((ev: any) => void) | null = null;
  onclose: ((ev: any) => void) | null = null;
  constructor() {
    setImmediate(() => this.onclose?.({}));
  }
  close() { /* noop */ }
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(g as any).WebSocket = FakeWebSocket;

interface Call {
  url: string;
  method?: string;
  body?: string;
}

const calls: Call[] = [];

function makeFetchMock(handlers: Record<string, (req: { url: string; method: string; body?: string }) => Response | Promise<Response>>): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.toString()
        : input.url;
    const method = (init?.method ?? 'GET').toUpperCase();
    const body = typeof init?.body === 'string' ? init.body : undefined;
    calls.push({ url, method, body });
    for (const [pattern, fn] of Object.entries(handlers)) {
      // Pattern is a suffix of the URL path (no host).
      const path = url.replace(/^https?:\/\/[^/]+/, '');
      if (path.endsWith(pattern) || path === pattern.replace(/^\//, '')) {
        return fn({ url, method, body });
      }
    }
    return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
  }) as typeof fetch;
}

const realFetch = global.fetch;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const gAny: any = globalThis;

describe('runUpdateValidation — clone fallback', () => {
  it('triggers clone step when no fields changed but shared repo is not cloned yet', async () => {
    calls.length = 0;
    gAny.window = { location: { protocol: 'http:', host: 'localhost:3000', port: '3000' } };

    // Status returns cloned:false → clone step should be promoted.
    // Validate returns success.
    // Clone POST returns a jobId; the WebSocket flow is replaced by a polling
    // fallback that reads the status endpoint until running=false.
    let clonePosted = false;
    let putPosted = false;
    let statusReads = 0;
    global.fetch = makeFetchMock({
      '/clone_repo/status': () => {
        statusReads += 1;
        // First read = probe (cloned:false). Subsequent reads = polling during
        // runProjectCloneStep; first polls report running, last reports done.
        const isProbe = statusReads === 1;
        if (isProbe) {
          return new Response(JSON.stringify({ cloned: false, running: false }), {
            status: 200, headers: { 'Content-Type': 'application/json' },
          });
        }
        const running = statusReads <= 2;
        return new Response(JSON.stringify({ running, stage: running ? 'cloning' : 'done', error: null }), {
          status: 200, headers: { 'Content-Type': 'application/json' },
        });
      },
      '/api/projects/validate': () => new Response(JSON.stringify({ success: true }), { status: 200, headers: { 'Content-Type': 'application/json' } }),
      '/api/projects/1/clone_repo': () => {
        clonePosted = true;
        return new Response(JSON.stringify({ jobId: 'job-1', projectId: 1 }), {
          status: 200, headers: { 'Content-Type': 'application/json' },
        });
      },
      '/api/projects/1': (req) => {
        if (req.method === 'PUT') putPosted = true;
        return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
      },
    });

    const { runUpdateValidation } = await import('@/lib/project-validation.ts');
    const { projectToFormData } = await import('@/lib/project-validation.ts');

    // Use a minimal Project shape; runUpdateValidation reads id, plus
    // projectToFormData reads many fields. Build one that matches the form
    // exactly so hasRelevantFieldsChanged sees no diff.
    const project = {
      id: 1,
      name: 'Demo',
      password_hash: null,
      port: 8080,
      repo_host: 'github',
      repo_url: 'https://github.com/example/demo.git',
      repo_pat: null,
      docker_image: 'img',
      docker_image_tester: 'img',
      backend: 'opencode',
      default_model: 'm',
      execution_model: 'm',
      blueprint_model: 'm',
      analyzer_model: 'm',
      chat_model: 'm',
      requirement_model: 'm',
      planning_model: 'm',
      review_model: 'm',
      documentation_model: 'm',
      build_cmd: null,
      test_cmd: null,
      staging_branch: 'staging',
      poll_interval: 10,
      agent_max_timeout: 600,
      max_parallel_jobs: 1,
      max_retries: 1,
      agent_max_retries: 1,
      remove_deleted_containers: 1,
      status: 'stopped' as const,
      pid: null,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    };
    const data = projectToFormData(project);

    const events: string[] = [];
    await runUpdateValidation(project, data, {
      onNoChanges: () => events.push('noChanges'),
      onComplete: () => events.push('complete'),
      onStepStatus: (_i, status) => events.push(`step:${status}`),
      onValidationFailed: () => events.push('failed'),
      onError: (m) => events.push(`error:${m}`),
    });

    assert.ok(putPosted, 'Expected PUT /api/projects/1 to be sent');
    assert.ok(clonePosted, 'Expected POST /api/projects/1/clone_repo to be sent even though no fields changed');
    assert.ok(events.includes('step:running'), 'Expected at least one step to be marked running');
    assert.ok(events.includes('complete'), 'Expected onComplete to fire after clone path runs');

    global.fetch = realFetch;
  });

  it('skips clone step when no fields changed and shared repo is already cloned', async () => {
    calls.length = 0;
    gAny.window = { location: { protocol: 'http:', host: 'localhost:3000', port: '3000' } };

    let clonePosted = false;
    let putPosted = false;
    global.fetch = makeFetchMock({
      '/clone_repo/status': () => new Response(JSON.stringify({ cloned: true, running: false }), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      }),
      '/api/projects/1/clone_repo': () => {
        clonePosted = true;
        return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
      },
      '/api/projects/1': (req) => {
        if (req.method === 'PUT') putPosted = true;
        return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
      },
    });

    const { runUpdateValidation, projectToFormData } = await import('@/lib/project-validation.ts');

    const project = {
      id: 1, name: 'Demo', password_hash: null, port: 8080,
      repo_host: 'github', repo_url: 'https://github.com/example/demo.git', repo_pat: null,
      docker_image: 'img', docker_image_tester: 'img', backend: 'opencode',
      default_model: 'm', execution_model: 'm', blueprint_model: 'm', analyzer_model: 'm',
      chat_model: 'm', requirement_model: 'm', planning_model: 'm', review_model: 'm',
      documentation_model: 'm', build_cmd: null, test_cmd: null, staging_branch: 'staging',
      poll_interval: 10, agent_max_timeout: 600, max_parallel_jobs: 1, max_retries: 1,
      agent_max_retries: 1, remove_deleted_containers: 1, status: 'stopped' as const,
      pid: null, created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
    };
    const data = projectToFormData(project);

    await runUpdateValidation(project, data, {
      onNoChanges: () => {},
      onComplete: () => {},
      onStepStatus: () => {},
      onValidationFailed: () => {},
      onError: () => {},
    });

    assert.ok(putPosted, 'PUT should still happen');
    assert.ok(!clonePosted, 'Clone POST must NOT be sent when nothing changed AND repo is already cloned');

    global.fetch = realFetch;
  });

  it('triggers clone step when fields changed and shared repo already cloned (URL change path)', async () => {
    calls.length = 0;
    gAny.window = { location: { protocol: 'http:', host: 'localhost:3000', port: '3000' } };

    let clonePosted = false;
    global.fetch = makeFetchMock({
      '/clone_repo/status': () => new Response(JSON.stringify({ cloned: true, running: false }), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      }),
      '/api/projects/validate': () => new Response(JSON.stringify({ success: true }), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      }),
      '/api/projects/1/clone_repo': () => {
        clonePosted = true;
        return new Response(JSON.stringify({ jobId: 'job-1', projectId: 1 }), {
          status: 200, headers: { 'Content-Type': 'application/json' },
        });
      },
      '/api/projects/1': () => new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } }),
    });

    const { runUpdateValidation, projectToFormData } = await import('@/lib/project-validation.ts');

    const project = {
      id: 1, name: 'Demo', password_hash: null, port: 8080,
      repo_host: 'github', repo_url: 'https://github.com/example/demo.git', repo_pat: null,
      docker_image: 'img', docker_image_tester: 'img', backend: 'opencode',
      default_model: 'm', execution_model: 'm', blueprint_model: 'm', analyzer_model: 'm',
      chat_model: 'm', requirement_model: 'm', planning_model: 'm', review_model: 'm',
      documentation_model: 'm', build_cmd: null, test_cmd: null, staging_branch: 'staging',
      poll_interval: 10, agent_max_timeout: 600, max_parallel_jobs: 1, max_retries: 1,
      agent_max_retries: 1, remove_deleted_containers: 1, status: 'stopped' as const,
      pid: null, created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
    };
    const data = projectToFormData(project);
    data.repo_url = 'https://github.com/example/other.git';

    await runUpdateValidation(project, data, {
      onNoChanges: () => {},
      onComplete: () => {},
      onStepStatus: () => {},
      onValidationFailed: () => {},
      onError: () => {},
    });

    assert.ok(clonePosted, 'Clone POST should fire when a repo field changed');

    global.fetch = realFetch;
  });
});
