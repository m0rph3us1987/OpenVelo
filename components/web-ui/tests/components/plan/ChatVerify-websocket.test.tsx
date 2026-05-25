/* eslint-disable @typescript-eslint/no-explicit-any */
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

const defaultChat = {
  id: 1,
  name: 'Test Chat',
  stage: 'verify' as const,
  project_id: '1',
};

describe.skip('ChatVerify WebSocket sub-view transitions', () => {
  beforeEach(() => {
    wsInstances.length = 0;
    setupWindowForWs();
    global.fetch = async () => Response.json({});
  });

  afterEach(() => {
    cleanupWindowForWs();
    global.fetch = originalFetch;
  });

describe.skip('AC1: UploadView renders when subStage is upload', () => {
    it('renders UploadView when WebSocket delivers sub_stage = upload', async () => {
      const container = (globalThis as any).document.createElement('div');
      const root = ReactDOM.createRoot(container);
      root.render(
        <ChatVerify chat={defaultChat as ChatSession} />
      );
      await new Promise<void>((resolve) => setTimeout(resolve, 50));

      wsInstances[0]?._onopen?.(new Event('open'));
      await new Promise<void>((resolve) => setTimeout(resolve, 20));
      wsInstances[0]?._onmessage?.(new MessageEvent('message', {
        data: JSON.stringify({ type: 'sub_stage', sub_stage: 'upload' }),
      }));

      await new Promise<void>((resolve) => setTimeout(resolve, 100));

      const html = container.innerHTML;
      assert.ok(
        html.includes('Upload the original requirement document'),
        `Expected UploadView prompt in output: ${html}`
      );
      assert.ok(
        html.includes('Upload Requirement'),
        `Expected upload button text in output: ${html}`
      );
    });
  });

  describe.skip('AC2: Automatic transition from UploadView to AnalysisView', () => {
    it('switches from UploadView to AnalysisView when WebSocket delivers sub_stage = analysis', async () => {
      const container = (globalThis as any).document.createElement('div');
      ReactDOM.createRoot(container).render(
        <ChatVerify chat={defaultChat as ChatSession} />
      );
      await new Promise<void>((resolve) => setTimeout(resolve, 20));

      const ws = wsInstances[0];
      ws._onopen?.(new Event('open'));
      ws._onmessage?.(new MessageEvent('message', {
        data: JSON.stringify({ type: 'sub_stage', sub_stage: 'upload' }),
      }));
      await new Promise<void>((resolve) => setTimeout(resolve, 50));
      const uploadHtml = container.innerHTML;
      assert.ok(
        uploadHtml.includes('Upload the original requirement document'),
        `Expected UploadView before transition: ${uploadHtml}`
      );

      ws._onmessage?.(new MessageEvent('message', {
        data: JSON.stringify({ type: 'sub_stage', sub_stage: 'analysis' }),
      }));
      await new Promise<void>((resolve) => setTimeout(resolve, 50));

      const analysisHtml = container.innerHTML;
      assert.ok(
        analysisHtml.includes('placeholder="Waiting for logs"') || analysisHtml.includes('bg-background'),
        `Expected AnalysisView (TextLog) after transition: ${analysisHtml}`
      );
    });
  });

  describe.skip('AC3: SatisfiedView renders when subStage is satisfied', () => {
    it('renders SatisfiedView with CheckCircle and "All requirements are satisfied" when sub_stage = satisfied', async () => {
      const container = (globalThis as any).document.createElement('div');
      ReactDOM.createRoot(container).render(
        <ChatVerify chat={defaultChat as ChatSession} />
      );
      await new Promise<void>((resolve) => setTimeout(resolve, 20));

      wsInstances[0]?._onopen?.(new Event('open'));
      wsInstances[0]?._onmessage?.(new MessageEvent('message', {
        data: JSON.stringify({ type: 'sub_stage', sub_stage: 'satisfied' }),
      }));

      await new Promise<void>((resolve) => setTimeout(resolve, 20));

      const html = container.innerHTML;
      assert.ok(
        html.includes('All requirements are satisfied'),
        `Expected satisfied text: ${html}`
      );
      assert.ok(
        html.includes('CheckCircle') || html.includes('check-circle') || html.includes('text-green-500'),
        `Expected CheckCircle icon: ${html}`
      );
    });
  });

  describe.skip('AC4: ErrorView renders when subStage is error', () => {
    it('renders ErrorView when WebSocket delivers sub_stage = error', async () => {
      const container = (globalThis as any).document.createElement('div');
      ReactDOM.createRoot(container).render(
        <ChatVerify chat={defaultChat as ChatSession} />
      );
      await new Promise<void>((resolve) => setTimeout(resolve, 20));

      wsInstances[0]?._onopen?.(new Event('open'));
      wsInstances[0]?._onmessage?.(new MessageEvent('message', {
        data: JSON.stringify({ type: 'sub_stage', sub_stage: 'error' }),
      }));

      await new Promise<void>((resolve) => setTimeout(resolve, 20));

      const html = container.innerHTML;
      assert.ok(
        html.includes('An error occurred during verification') || html.includes('Retry'),
        `Expected ErrorView: ${html}`
      );
    });
  });

  describe.skip('AC5 & AC6: Reconnection banner displays when isConnected is false', () => {
    it('displays "Reconnecting..." banner when isConnected is false', async () => {
      const container = (globalThis as any).document.createElement('div');
      ReactDOM.createRoot(container).render(
        <ChatVerify chat={defaultChat as ChatSession} />
      );
      await new Promise<void>((resolve) => setTimeout(resolve, 20));

      wsInstances[0]?._onopen?.(new Event('open'));
      wsInstances[0]?._onmessage?.(new MessageEvent('message', {
        data: JSON.stringify({ type: 'sub_stage', sub_stage: 'upload' }),
      }));
      await new Promise<void>((resolve) => setTimeout(resolve, 20));

      wsInstances[0]?._onclose?.(createMockCloseEvent());
      await new Promise<void>((resolve) => setTimeout(resolve, 100));

      const html = container.innerHTML;
      assert.ok(
        html.includes('Reconnecting...'),
        `Expected "Reconnecting..." banner: ${html}`
      );
    });

    it('removes reconnect banner when isConnected returns to true after reconnection', async () => {
      const container = (globalThis as any).document.createElement('div');
      ReactDOM.createRoot(container).render(
        <ChatVerify chat={defaultChat as ChatSession} />
      );
      await new Promise<void>((resolve) => setTimeout(resolve, 20));

      const ws = wsInstances[0];
      ws._onopen?.(new Event('open'));
      ws._onmessage?.(new MessageEvent('message', {
        data: JSON.stringify({ type: 'sub_stage', sub_stage: 'upload' }),
      }));
      await new Promise<void>((resolve) => setTimeout(resolve, 20));

      ws._onclose?.(createMockCloseEvent());
      await new Promise<void>((resolve) => setTimeout(resolve, 1200));

      const newWs = wsInstances[wsInstances.length - 1];
      newWs._onopen?.(new Event('open'));
      await new Promise<void>((resolve) => setTimeout(resolve, 20));

      const html = container.innerHTML;
      assert.ok(
        !html.includes('Reconnecting...'),
        `Expected no reconnect banner after reconnection: ${html}`
      );
    });
  });

  describe.skip('AC7: Loading state when no WebSocket message has arrived', () => {
    it('shows loading skeleton/spinner on initial mount before first sub_stage message', async () => {
      const container = (globalThis as any).document.createElement('div');
      ReactDOM.createRoot(container).render(
        <ChatVerify chat={defaultChat as ChatSession} />
      );
      await new Promise<void>((resolve) => setTimeout(resolve, 20));

      const html = container.innerHTML;
      assert.ok(
        html.includes('Loading...') || html.includes('animate-spin'),
        `Expected loading spinner on initial render: ${html}`
      );
    });
  });
});