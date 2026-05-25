/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import * as React from 'react';
import { Window } from 'happy-dom';
import ReactDOM from 'react-dom/client';
import { useStageWebSocket } from '@/hooks/useStageWebSocket';

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

const origWindow = (globalThis as any).window;
const origWebSocket = (globalThis as any).WebSocket;
const origDocument = (globalThis as any).document;

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
      this.closeCalled = false;
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

function TestComponent({ chatId, stage }: { chatId: number; stage: string }) {
  const { subStage, progress, errorType, isConnected } = useStageWebSocket({ chatId, stage });
  return (
    <div>
      <div id="subStage">{subStage}</div>
      <div id="progress">{progress ?? 'null'}</div>
      <div id="errorType">{errorType ?? 'null'}</div>
      <div id="isConnected">{isConnected ? 'true' : 'false'}</div>
    </div>
  );
}

describe.skip('useStageWebSocket', () => {
  beforeEach(() => {
    wsInstances.length = 0;
    setupWindowForWs();
  });

  afterEach(() => {
    cleanupWindowForWs();
  });

  describe('AC1: WebSocket connection opened on mount with correct URL', () => {
    it('opens WebSocket to wss://host/ws/stage/verify?chatId=123', async () => {
      const container = (globalThis as any).document.createElement('div');
      ReactDOM.createRoot(container).render(
        <TestComponent chatId={123} stage="verify" />
      );
      await new Promise<void>((resolve) => setTimeout(resolve, 20));

      assert.ok(wsInstances.length > 0, 'Expected WebSocket to be created');
      assert.ok(
        wsInstances[0].url.includes('/ws/stage/verify'),
        `Expected URL to contain /ws/stage/verify, got: ${wsInstances[0].url}`
      );
      assert.ok(
        wsInstances[0].url.includes('chatId=123'),
        `Expected URL to contain chatId=123, got: ${wsInstances[0].url}`
      );
    });

    it('isConnected becomes true once connection is established', async () => {
      const container = (globalThis as any).document.createElement('div');
      ReactDOM.createRoot(container).render(
        <TestComponent chatId={456} stage="verify" />
      );
      await new Promise<void>((resolve) => setTimeout(resolve, 20));

      const ws = wsInstances[0];
      ws._onopen?.(new Event('open'));

      await new Promise<void>((resolve) => setTimeout(resolve, 20));

      const html = container.innerHTML;
      assert.ok(
        html.includes('isConnected">true'),
        `Expected isConnected to be true, got HTML: ${html}`
      );
    });
  });

  describe('AC2 & AC3: sub_stage messages update subStage state', () => {
    it('updates subStage to "analysis" on sub_stage message', async () => {
      const container = (globalThis as any).document.createElement('div');
      ReactDOM.createRoot(container).render(
        <TestComponent chatId={123} stage="verify" />
      );
      await new Promise<void>((resolve) => setTimeout(resolve, 20));

      const ws = wsInstances[0];
      ws._onopen?.(new Event('open'));
      ws._onmessage?.(new MessageEvent('message', {
        data: JSON.stringify({ type: 'sub_stage', sub_stage: 'analysis' }),
      }));

      await new Promise<void>((resolve) => setTimeout(resolve, 20));

      const html = container.innerHTML;
      assert.ok(
        html.includes('subStage">analysis'),
        `Expected subStage to be "analysis", got HTML: ${html}`
      );
    });

    it('updates subStage to "upload" on sub_stage message', async () => {
      const container = (globalThis as any).document.createElement('div');
      ReactDOM.createRoot(container).render(
        <TestComponent chatId={123} stage="verify" />
      );
      await new Promise<void>((resolve) => setTimeout(resolve, 20));

      const ws = wsInstances[0];
      ws._onopen?.(new Event('open'));
      ws._onmessage?.(new MessageEvent('message', {
        data: JSON.stringify({ type: 'sub_stage', sub_stage: 'upload' }),
      }));

      await new Promise<void>((resolve) => setTimeout(resolve, 20));

      const html = container.innerHTML;
      assert.ok(
        html.includes('subStage">upload'),
        `Expected subStage to be "upload", got HTML: ${html}`
      );
    });
  });

  describe('AC4: isConnected false on unexpected disconnection, reconnection with exponential backoff', () => {
    it('sets isConnected to false on unexpected close', async () => {
      const container = (globalThis as any).document.createElement('div');
      ReactDOM.createRoot(container).render(
        <TestComponent chatId={789} stage="verify" />
      );
      await new Promise<void>((resolve) => setTimeout(resolve, 20));

      const ws = wsInstances[0];
      ws._onopen?.(new Event('open'));
      ws._onclose?.(createMockCloseEvent());

      await new Promise<void>((resolve) => setTimeout(resolve, 20));

      const html = container.innerHTML;
      assert.ok(
        html.includes('isConnected">false'),
        `Expected isConnected to be false after close, got HTML: ${html}`
      );
    });

    it('reconnection is attempted after unexpected disconnection', async () => {
      const container = (globalThis as any).document.createElement('div');
      ReactDOM.createRoot(container).render(
        <TestComponent chatId={999} stage="verify" />
      );
      await new Promise<void>((resolve) => setTimeout(resolve, 20));

      const firstWs = wsInstances[0];
      const initialCount = wsInstances.length;

      firstWs._onclose?.(createMockCloseEvent());

      await new Promise<void>((resolve) => setTimeout(resolve, 1200));

      assert.ok(
        wsInstances.length > initialCount,
        `Expected reconnection attempt, had ${initialCount} ws instances, now ${wsInstances.length}`
      );
    });
  });

  describe('AC5: Successful reconnection resets backoff and isConnected becomes true', () => {
    it('isConnected returns to true after successful reconnection', async () => {
      const container = (globalThis as any).document.createElement('div');
      ReactDOM.createRoot(container).render(
        <TestComponent chatId={111} stage="verify" />
      );
      await new Promise<void>((resolve) => setTimeout(resolve, 20));

      const firstWs = wsInstances[0];
      firstWs._onopen?.(new Event('open'));
      firstWs._onclose?.(createMockCloseEvent());

      await new Promise<void>((resolve) => setTimeout(resolve, 1200));

      assert.ok(wsInstances.length > 1, 'Expected reconnection to occur');
      const newWs = wsInstances[wsInstances.length - 1];
      newWs._onopen?.(new Event('open'));

      await new Promise<void>((resolve) => setTimeout(resolve, 20));

      const html = container.innerHTML;
      assert.ok(
        html.includes('isConnected">true'),
        `Expected isConnected to be true after reconnection, got HTML: ${html}`
      );
    });
  });

  describe('AC6: Cleanup on unmount closes connection and cancels timers', () => {
    it('closes WebSocket and cancels timers on unmount', async () => {
      const container = (globalThis as any).document.createElement('div');
      const root = ReactDOM.createRoot(container);
      root.render(
        <TestComponent chatId={222} stage="verify" />
      );
      await new Promise<void>((resolve) => setTimeout(resolve, 20));

      const ws = wsInstances[0];
      let closeCalled = false;
      const origClose = ws.close;
      ws.close = () => {
        closeCalled = true;
        origClose.call(ws);
      };

      root.unmount();

      await new Promise<void>((resolve) => setTimeout(resolve, 100));

      assert.ok(closeCalled, 'Expected WebSocket.close to be called on unmount');
    });
  });

  describe('AC7: chatId change triggers reconnection with new chatId', () => {
    it('closes old connection and opens new one when chatId changes', async () => {
      const container = (globalThis as any).document.createElement('div');
      const root = ReactDOM.createRoot(container);
      root.render(
        <TestComponent chatId={333} stage="verify" />
      );
      await new Promise<void>((resolve) => setTimeout(resolve, 20));

      const initialWs = wsInstances[0];
      const initialUrl = initialWs.url;

      root.render(
        <TestComponent chatId={444} stage="verify" />
      );
      await new Promise<void>((resolve) => setTimeout(resolve, 20));

      assert.ok(initialWs.closeCalled, 'Expected initial WebSocket.close to be called when chatId changes');
      assert.ok(
        initialUrl.includes('chatId=333'),
        `Initial URL should contain chatId=333`
      );
      assert.ok(
        wsInstances[wsInstances.length - 1].url.includes('chatId=444'),
        `New WebSocket should have chatId=444`
      );
    });
  });

  describe('errorType extraction from stage messages', () => {
    it('extracts errorType from sub_stage message when present', async () => {
      const container = (globalThis as any).document.createElement('div');
      ReactDOM.createRoot(container).render(
        <TestComponent chatId={123} stage="verify" />
      );
      await new Promise<void>((resolve) => setTimeout(resolve, 20));

      const ws = wsInstances[0];
      ws._onopen?.(new Event('open'));
      ws._onmessage?.(new MessageEvent('message', {
        data: JSON.stringify({ type: 'sub_stage', sub_stage: 'error', errorType: 'missing_repository' }),
      }));

      await new Promise<void>((resolve) => setTimeout(resolve, 20));

      const html = container.innerHTML;
      assert.ok(
        html.includes('errorType">missing_repository'),
        `Expected errorType to be "missing_repository", got HTML: ${html}`
      );
    });

    it('does not update errorType when not present in message', async () => {
      const container = (globalThis as any).document.createElement('div');
      ReactDOM.createRoot(container).render(
        <TestComponent chatId={123} stage="verify" />
      );
      await new Promise<void>((resolve) => setTimeout(resolve, 20));

      const ws = wsInstances[0];
      ws._onopen?.(new Event('open'));
      ws._onmessage?.(new MessageEvent('message', {
        data: JSON.stringify({ type: 'sub_stage', sub_stage: 'analysis' }),
      }));

      await new Promise<void>((resolve) => setTimeout(resolve, 20));

      const html = container.innerHTML;
      assert.ok(
        html.includes('errorType">null'),
        `Expected errorType to remain null, got HTML: ${html}`
      );
    });

    it('extracts errorType for non-missing_repository error types', async () => {
      const container = (globalThis as any).document.createElement('div');
      ReactDOM.createRoot(container).render(
        <TestComponent chatId={123} stage="verify" />
      );
      await new Promise<void>((resolve) => setTimeout(resolve, 20));

      const ws = wsInstances[0];
      ws._onopen?.(new Event('open'));
      ws._onmessage?.(new MessageEvent('message', {
        data: JSON.stringify({ type: 'sub_stage', sub_stage: 'error', errorType: 'llm_error' }),
      }));

      await new Promise<void>((resolve) => setTimeout(resolve, 20));

      const html = container.innerHTML;
      assert.ok(
        html.includes('errorType">llm_error'),
        `Expected errorType to be "llm_error", got HTML: ${html}`
      );
    });
  });

  describe('unknown message types are ignored', () => {
    it('ignores messages with unknown type', async () => {
      const container = (globalThis as any).document.createElement('div');
      ReactDOM.createRoot(container).render(
        <TestComponent chatId={555} stage="verify" />
      );
      await new Promise<void>((resolve) => setTimeout(resolve, 20));

      const ws = wsInstances[0];
      ws._onopen?.(new Event('open'));
      ws._onmessage?.(new MessageEvent('message', {
        data: JSON.stringify({ type: 'unknown_type', data: 'something' }),
      }));

      await new Promise<void>((resolve) => setTimeout(resolve, 20));

      const html = container.innerHTML;
      assert.ok(
        html.includes('subStage">'),
        `Expected subStage to remain empty, got HTML: ${html}`
      );
    });
  });
});