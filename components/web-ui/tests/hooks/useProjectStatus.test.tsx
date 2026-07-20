import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import * as React from 'react';
import { render, cleanup, act } from '@testing-library/react';
import { Window } from 'happy-dom';
import { useProjectStatus } from '@/hooks/useProjectStatus';

function setupDOM() {
  const window = new Window({ url: 'https://localhost' });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (global as any).window = window;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (global as any).document = window.document;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (global as any).navigator = window.navigator;
}

interface HarnessState {
  status: 'running' | 'stopped';
  refreshCalls: number;
  refresh: () => Promise<void>;
  refreshSafe: () => Promise<void>;
}

function Harness({ projectId, stateRef }: { projectId: number; stateRef: React.MutableRefObject<HarnessState | null> }) {
  const { status, refresh, refreshSafe } = useProjectStatus(projectId);
  const refreshCallsRef = React.useRef(0);
  const wrappedRefresh = React.useCallback(async () => {
    refreshCallsRef.current += 1;
    await refresh();
  }, [refresh]);
  stateRef.current = { status, refreshCalls: refreshCallsRef.current, refresh: wrappedRefresh, refreshSafe };
  return React.createElement('div', { 'data-testid': 'harness' }, `status=${status}`);
}

async function flush() {
  await act(async () => {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  });
  await act(async () => {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  });
}

describe('useProjectStatus', () => {
  let origFetch: typeof global.fetch;

  beforeEach(() => {
    setupDOM();
    origFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = origFetch;
    cleanup();
  });

  it('polls /api/projects/:id/status and exposes status, refresh, and refreshSafe', async () => {
    let statusResponse: 'running' | 'stopped' = 'stopped';
    let fetchCalls = 0;
    global.fetch = async (url: unknown) => {
      const u = String(url);
      if (u === `/api/projects/7/status`) {
        fetchCalls++;
        return Response.json({ status: statusResponse }) as Response;
      }
      return Response.json({}) as Response;
    };

    const stateRef = React.createRef<HarnessState | null>();
    render(React.createElement(Harness as any, { projectId: 7, stateRef }));

    await flush();
    assert.ok(stateRef.current, 'harness must capture hook state');
    assert.strictEqual(stateRef.current!.status, 'stopped', 'initial status must reflect the API response');
    assert.strictEqual(fetchCalls, 1, 'hook must call /api/projects/:id/status on mount');

    // Flip the next response to 'running' and call refresh() — the hook must
    // observe the new state.
    statusResponse = 'running';
    await act(async () => {
      await stateRef.current!.refresh();
    });
    assert.strictEqual(stateRef.current!.status, 'running', 'refresh() must pick up the new status');
    assert.strictEqual(stateRef.current!.refreshCalls, 1, 'refresh() must trigger exactly one fetch');
  });

  it('refreshSafe() never throws even when /status fails', async () => {
    global.fetch = async () => {
      return new Response('boom', { status: 500 }) as Response;
    };
    const stateRef = React.createRef<HarnessState | null>();
    render(React.createElement(Harness as any, { projectId: 9, stateRef }));
    await flush();

    let threw = false;
    await act(async () => {
      try {
        await stateRef.current!.refreshSafe();
      } catch {
        threw = true;
      }
    });
    assert.strictEqual(threw, false, 'refreshSafe() must swallow errors so callers do not need try/catch');
  });
});
