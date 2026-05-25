import * as React from 'react';
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { Window } from 'happy-dom';
import ReactDOM from 'react-dom/client';
import { ChatVerify } from '@/components/plan/ChatVerify';
import type { ChatSession } from '@/lib/types';

const origWindow = (globalThis as any).window;
const origWebSocket = (globalThis as any).WebSocket;
const origDocument = (globalThis as any).document;

const wsInstances: Array<{
  url: string;
  readyState: number;
  _onopen: ((event: Event) => void) | null;
  _onmessage: ((event: MessageEvent) => void) | null;
  _onclose: ((event: CloseEvent) => void) | null;
  _onerror: ((event: Event) => void) | null;
  send: () => void;
  close: () => void;
  closeCalled: boolean;
}> = [];

function createMockCloseEvent() {
  return {
    wasClean: false,
    code: 1006,
    reason: '',
    type: 'close',
    bubbles: false,
    cancelable: false,
    composed: false,
  } as unknown as CloseEvent;
}

function setupWindowForWs() {
  const win = new Window({ url: 'https://localhost' });
  (globalThis as any).window = win;
  (globalThis as any).document = win.document;

  class MockWebSocket {
    url: string;
    readyState = 1;
    closeCalled = false;
    _onopen: ((event: Event) => void) | null = null;
    _onmessage: ((event: MessageEvent) => void) | null = null;
    _onclose: ((event: CloseEvent) => void) | null = null;
    _onerror: ((event: Event) => void) | null = null;
    send = () => {};
    close = () => {
      this.closeCalled = true;
      this.readyState = 3;
      this._onclose?.(createMockCloseEvent());
    };
    constructor(url: string) {
      this.url = url;
      wsInstances.push(this);
    }
    get onopen() { return this._onopen; }
    set onopen(fn) { this._onopen = fn; }
    get onmessage() { return this._onmessage; }
    set onmessage(fn) { this._onmessage = fn; }
    get onclose() { return this._onclose; }
    set onclose(fn) { this._onclose = fn; }
    get onerror() { return this._onerror; }
    set onerror(fn) { this._onerror = fn; }
  }

  (globalThis as any).WebSocket = MockWebSocket as any;
}

function cleanupWindowForWs() {
  (globalThis as any).window = origWindow;
  (globalThis as any).WebSocket = origWebSocket;
  (globalThis as any).document = origDocument;
}

const originalFetch = global.fetch;

describe.skip('ChatVerify error message from chat.error_type (history/replay mode)', () => {
  beforeEach(() => {
    wsInstances.length = 0;
    setupWindowForWs();
    global.fetch = async () => Response.json({});
  });

  afterEach(() => {
    cleanupWindowForWs();
    global.fetch = originalFetch;
  });

  it('displays "No repository found — run implementation first" when chat.error_type is missing_repository in viewOnly mode', async () => {
    const chat = {
      id: 1,
      name: 'Test Chat',
      stage: 'verify',
      project_id: '1',
      error_type: 'missing_repository',
    } as ChatSession;

    const container = (globalThis as any).document.createElement('div');
    const root = ReactDOM.createRoot(container);
    root.render(
      <ChatVerify chat={chat} viewOnly={true} />
    );
    await new Promise<void>((resolve) => setTimeout(resolve, 50));

    wsInstances[0]?._onopen?.(new Event('open'));
    await new Promise<void>((resolve) => setTimeout(resolve, 20));
    wsInstances[0]?._onmessage?.(new MessageEvent('message', {
      data: JSON.stringify({ type: 'sub_stage', sub_stage: 'error' }),
    }));

    await new Promise<void>((resolve) => setTimeout(resolve, 100));

    const html = container.innerHTML;
    assert.ok(
      html.includes('No repository found — run implementation first'),
      `Expected "No repository found — run implementation first": ${html}`
    );
  });

  it('displays "An error occurred during verification" when chat.error_type is llm_error in viewOnly mode', async () => {
    const chat = {
      id: 2,
      name: 'Test Chat',
      stage: 'verify',
      project_id: '1',
      error_type: 'llm_error',
    } as ChatSession;

    const container = (globalThis as any).document.createElement('div');
    const root = ReactDOM.createRoot(container);
    root.render(
      <ChatVerify chat={chat} viewOnly={true} />
    );
    await new Promise<void>((resolve) => setTimeout(resolve, 50));

    wsInstances[0]?._onopen?.(new Event('open'));
    await new Promise<void>((resolve) => setTimeout(resolve, 20));
    wsInstances[0]?._onmessage?.(new MessageEvent('message', {
      data: JSON.stringify({ type: 'sub_stage', sub_stage: 'error' }),
    }));

    await new Promise<void>((resolve) => setTimeout(resolve, 100));

    const html = container.innerHTML;
    assert.ok(
      html.includes('An error occurred during verification'),
      `Expected "An error occurred during verification": ${html}`
    );
  });

  it('does not render retry button in viewOnly mode', async () => {
    const chat = {
      id: 3,
      name: 'Test Chat',
      stage: 'verify',
      project_id: '1',
      error_type: 'missing_repository',
    } as ChatSession;

    const container = (globalThis as any).document.createElement('div');
    const root = ReactDOM.createRoot(container);
    root.render(
      <ChatVerify chat={chat} viewOnly={true} />
    );
    await new Promise<void>((resolve) => setTimeout(resolve, 50));

    wsInstances[0]?._onopen?.(new Event('open'));
    await new Promise<void>((resolve) => setTimeout(resolve, 20));
    wsInstances[0]?._onmessage?.(new MessageEvent('message', {
      data: JSON.stringify({ type: 'sub_stage', sub_stage: 'error' }),
    }));

    await new Promise<void>((resolve) => setTimeout(resolve, 100));

    const html = container.innerHTML;
    assert.ok(
      !html.includes('Retry'),
      `Should not display Retry button in viewOnly mode: ${html}`
    );
  });

  it('renders retry button in live mode (viewOnly=false)', async () => {
    const chat = {
      id: 4,
      name: 'Test Chat',
      stage: 'verify',
      project_id: '1',
      error_type: 'missing_repository',
    } as ChatSession;

    const container = (globalThis as any).document.createElement('div');
    const root = ReactDOM.createRoot(container);
    root.render(
      <ChatVerify chat={chat} viewOnly={false} />
    );
    await new Promise<void>((resolve) => setTimeout(resolve, 50));

    wsInstances[0]?._onopen?.(new Event('open'));
    await new Promise<void>((resolve) => setTimeout(resolve, 20));
    wsInstances[0]?._onmessage?.(new MessageEvent('message', {
      data: JSON.stringify({ type: 'sub_stage', sub_stage: 'error' }),
    }));

    await new Promise<void>((resolve) => setTimeout(resolve, 100));

    const html = container.innerHTML;
    assert.ok(
      html.includes('Retry'),
      `Should display Retry button in live mode: ${html}`
    );
  });
});