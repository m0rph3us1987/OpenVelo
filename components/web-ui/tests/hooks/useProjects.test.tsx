import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import * as React from 'react';
import { render, cleanup, act } from '@testing-library/react';
import { Window } from 'happy-dom';
import { useProjects } from '@/hooks/useProjects';

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
  projectsLength: number;
  loading: boolean;
  refresh: () => Promise<void>;
}

function Harness({ stateRef }: { stateRef: React.MutableRefObject<HarnessState | null> }) {
  const { projects, loading, refresh } = useProjects();
  stateRef.current = { projectsLength: projects.length, loading, refresh };
  return React.createElement(
    'div',
    { 'data-testid': 'harness' },
    `count=${projects.length} loading=${loading}`
  );
}

async function flush() {
  await act(async () => {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  });
  await act(async () => {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  });
}

describe('useProjects', () => {
  let origFetch: typeof global.fetch;
  let fetchCalls: number;

  beforeEach(() => {
    setupDOM();
    origFetch = global.fetch;
    fetchCalls = 0;
  });

  afterEach(() => {
    global.fetch = origFetch;
    cleanup();
  });

  it('fetches /api/projects on mount, exposes a refresh function that re-fetches', async () => {
    global.fetch = (async (url: unknown) => {
      const u = String(url);
      if (u === '/api/projects') {
        fetchCalls++;
        return Response.json([{ id: 1, name: 'Demo' }]) as Response;
      }
      return Response.json({}) as Response;
    }) as typeof fetch;

    const stateRef = React.createRef<HarnessState | null>();
    render(React.createElement(Harness as any, { stateRef }));

    await flush();

    assert.ok(stateRef.current, 'harness must have captured hook state');
    assert.strictEqual(fetchCalls, 1, 'hook must call /api/projects exactly once on mount');
    assert.strictEqual(stateRef.current!.projectsLength, 1, 'hook must expose the fetched project');
    assert.strictEqual(stateRef.current!.loading, false, 'loading must flip to false after fetch settles');

    await act(async () => {
      await stateRef.current!.refresh();
    });

    assert.strictEqual(fetchCalls, 2, 'refresh() must trigger a second /api/projects fetch');
    assert.strictEqual(stateRef.current!.projectsLength, 1, 'project list must still have one entry after refresh');
  });
});