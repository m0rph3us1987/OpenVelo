import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import * as React from 'react';
import { render, cleanup, fireEvent, act } from '@testing-library/react';
import { Window } from 'happy-dom';
import { MobileStatusHeader } from '@/components/mobile/jobs/MobileStatusHeader';
import { ToastProvider } from '@/context/ToastContext';
import type { Project } from '@/lib/types';

function setupDOM() {
  const window = new Window({ url: 'https://localhost/' });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (global as any).window = window;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (global as any).document = window.document;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (global as any).navigator = window.navigator;
  // Radix Presence calls bare `getComputedStyle(...)`, which is not on
  // globalThis under happy-dom. Bind it explicitly so @radix-ui/react-collapsible
  // (used by the status header trigger) can mount under happy-dom.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (global as any).getComputedStyle = window.getComputedStyle.bind(window);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (typeof (global as any).requestAnimationFrame !== 'function') {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (global as any).requestAnimationFrame = (cb: FrameRequestCallback) =>
      setTimeout(() => cb(Date.now()), 0);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (global as any).cancelAnimationFrame = (id: number) => clearTimeout(id);
  }
  Object.defineProperty(global, 'localStorage', {
    value: {
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {},
      clear: () => {},
    },
    writable: true,
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (!(window as any).matchMedia) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).matchMedia = () => ({
      matches: false,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
    });
  }
}

function TestWrapper({ children }: { children: React.ReactElement }) {
  return React.createElement(ToastProvider, null, children);
}

async function flush() {
  await act(async () => {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  });
  await act(async () => {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  });
}

const baseProject: Project = {
  id: 7,
  name: 'Alpha',
  port: 3001,
  repo_host: 'github',
  repo_url: 'https://github.com/example/alpha',
  repo_pat: '',
  docker_image: 'openvelo-agent:linux',
  backend: 'opencode',
  default_model: '',
  execution_model: '',
  analyzer_model: '',
  chat_model: '',
  requirement_model: '',
  planning_model: '',
  blueprint_model: '',
  review_model: '',
  documentation_model: '',
  build_cmd: '',
  test_cmd: '',
  staging_branch: 'staging',
  poll_interval: 60000,
  agent_max_timeout: 300,
  max_parallel_jobs: 1,
  max_retries: 3,
  agent_max_retries: 3,
  remove_deleted_containers: 1,
  status: 'stopped',
};

describe('MobileStatusHeader', () => {
  let origFetch: typeof global.fetch;

  beforeEach(() => {
    setupDOM();
    origFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = origFetch;
    cleanup();
  });

  it('shows the project name and status in the collapsed trigger (no max parallel)', async () => {
    global.fetch = async () => Response.json({}) as Response;
    const { container } = render(
      TestWrapper({
        children: React.createElement(MobileStatusHeader as any, {
          project: baseProject,
          projectId: 7,
          liveStatus: 'stopped',
          hasRunningJobs: false,
          onAddJob: () => {},
        }),
      })
    );
    await flush();
    const trigger = container.querySelector('button[aria-label="Collapse orchestrator status"]') as HTMLElement;
    assert.ok(trigger, 'trigger must render');
    assert.ok(trigger.textContent?.includes('Alpha'), 'trigger must show the project name');
    assert.ok(trigger.textContent?.includes('Stopped'), 'trigger must show the status label');
    assert.ok(!trigger.textContent?.includes('max parallel'), 'trigger must NOT show max parallel');
  });

  it('Start orchestrator button POSTs to /api/projects/:id/start', async () => {
    const startCalls: string[] = [];
    const refreshCalls: number[] = [];
    global.fetch = async (url: unknown, init?: RequestInit) => {
      const u = String(url);
      if (u.endsWith('/start') && init?.method === 'POST') {
        startCalls.push(u);
        return new Response('', { status: 200 }) as Response;
      }
      return Response.json({}) as Response;
    };
    const { container } = render(
      TestWrapper({
        children: React.createElement(MobileStatusHeader as any, {
          project: baseProject,
          projectId: 7,
          liveStatus: 'stopped',
          hasRunningJobs: false,
          onAddJob: () => {},
          onAfterAction: () => { refreshCalls.push(Date.now()); },
        }),
      })
    );
    await flush();
    const startBtn = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent?.includes('Start orchestrator')
    ) as HTMLButtonElement;
    assert.ok(startBtn, 'Start button must render when stopped');
    await act(async () => {
      fireEvent.click(startBtn);
    });
    await flush();
    assert.deepStrictEqual(startCalls, ['/api/projects/7/start'], 'must POST /api/projects/:id/start');
    assert.strictEqual(refreshCalls.length, 1, 'onAfterAction must be called after successful start');
  });

  it('shows "Starting…" and disables the button while start is in flight', async () => {
    let resolveStart: (v: Response) => void = () => {};
    global.fetch = async (url: unknown) => {
      const u = String(url);
      if (u.endsWith('/start')) {
        return new Promise<Response>((resolve) => { resolveStart = resolve; });
      }
      return Response.json({}) as Response;
    };
    const { container } = render(
      TestWrapper({
        children: React.createElement(MobileStatusHeader as any, {
          project: baseProject,
          projectId: 7,
          liveStatus: 'stopped',
          hasRunningJobs: false,
          onAddJob: () => {},
        }),
      })
    );
    await flush();
    const startBtn = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent?.includes('Start orchestrator')
    ) as HTMLButtonElement;
    assert.ok(startBtn, 'Start button must render');
    assert.strictEqual(startBtn.disabled, false, 'Start button starts enabled');
    await act(async () => {
      fireEvent.click(startBtn);
    });
    await flush();
    assert.ok(
      Array.from(container.querySelectorAll('button')).some((b) =>
        b.textContent?.includes('Starting…')
      ),
      'Starting… label must show while in flight'
    );
    const startBtnDuringFlight = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent?.includes('Starting…') || b.textContent?.includes('Start orchestrator')
    ) as HTMLButtonElement;
    assert.ok(startBtnDuringFlight, 'start button must still be in the DOM');
    assert.strictEqual(startBtnDuringFlight.disabled, true, 'start button must be disabled while in flight');
    // Resolve the start request so the test cleanup completes.
    await act(async () => {
      resolveStart(new Response('', { status: 200 }));
    });
    await flush();
  });

  it('shows a toast error and does NOT call onAfterAction when start fails', async () => {
    const refreshCalls: number[] = [];
    global.fetch = async (url: unknown) => {
      const u = String(url);
      if (u.endsWith('/start')) {
        return new Response(JSON.stringify({ error: 'Container not found' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        }) as Response;
      }
      return Response.json({}) as Response;
    };
    const { container } = render(
      TestWrapper({
        children: React.createElement(MobileStatusHeader as any, {
          project: baseProject,
          projectId: 7,
          liveStatus: 'stopped',
          hasRunningJobs: false,
          onAddJob: () => {},
          onAfterAction: () => { refreshCalls.push(1); },
        }),
      })
    );
    await flush();
    const startBtn = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent?.includes('Start orchestrator')
    ) as HTMLButtonElement;
    await act(async () => {
      fireEvent.click(startBtn);
    });
    await flush();
    assert.strictEqual(refreshCalls.length, 0, 'onAfterAction must NOT be called on start failure');
    // Button is back to enabled / non-loading state
    const startBtnAfter = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent?.includes('Start orchestrator')
    ) as HTMLButtonElement;
    assert.ok(startBtnAfter, 'start button must remain available');
    assert.strictEqual(startBtnAfter.disabled, false, 'start button must re-enable after failure');
  });

  it('Stop orchestrator POSTs to /api/projects/:id/stop and surfaces errors', async () => {
    const refreshCalls: number[] = [];
    global.fetch = async (url: unknown, init?: RequestInit) => {
      const u = String(url);
      if (u.endsWith('/stop') && init?.method === 'POST') {
        return new Response(JSON.stringify({ error: 'Already stopped' }), {
          status: 409,
          headers: { 'Content-Type': 'application/json' },
        }) as Response;
      }
      return Response.json({}) as Response;
    };
    const { container } = render(
      TestWrapper({
        children: React.createElement(MobileStatusHeader as any, {
          project: { ...baseProject, status: 'running' },
          projectId: 7,
          liveStatus: 'running',
          hasRunningJobs: false,
          onAddJob: () => {},
          onAfterAction: () => { refreshCalls.push(1); },
        }),
      })
    );
    await flush();
    const stopBtn = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent?.includes('Stop orchestrator')
    ) as HTMLButtonElement;
    assert.ok(stopBtn, 'Stop button must render when running');
    await act(async () => {
      fireEvent.click(stopBtn);
    });
    await flush();
    assert.strictEqual(refreshCalls.length, 0, 'onAfterAction must NOT be called when stop fails');
    const stopBtnAfter = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent?.includes('Stop orchestrator')
    ) as HTMLButtonElement;
    assert.ok(stopBtnAfter, 'stop button must remain available');
    assert.strictEqual(stopBtnAfter.disabled, false, 'stop button must re-enable after failure');
  });
});
