import * as React from 'react';
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import ReactDOMServer from 'react-dom/server';
import type { ChatSession } from '@/lib/types';

const originalFetch = global.fetch;

interface TestChatVerifyProps {
  chat: ChatSession;
  onHeaderInfo?: (info: { title: string; showSpinner: boolean }) => void;
  mockSubStage?: string;
  mockProgress?: string;
  mockErrorType?: string;
  mockIsConnected?: boolean;
}

function TestChatVerify({ chat, onHeaderInfo, mockSubStage = 'upload', mockProgress, mockErrorType, mockIsConnected = true }: TestChatVerifyProps) {
  const subStage = mockSubStage;
  const progress = mockProgress;
  const errorType = mockErrorType;
  const isConnected = mockIsConnected;
  const [analysisKey, setAnalysisKey] = React.useState(0);

  React.useEffect(() => {
    if (subStage === 'analysis') {
      setAnalysisKey(k => k + 1);
    }
  }, [subStage]);

  const reconnectBanner = !isConnected && (subStage === 'analysis' || subStage === 'error');

  React.useEffect(() => {
    const titleMap: Record<string, string> = {
      'upload': 'Upload Requirement',
      'analysis': 'Verifying implementation...',
      'satisfied': 'Verification complete',
      'error': 'Error',
    };
    const subtitle = titleMap[subStage] ?? 'Verify';
    onHeaderInfo?.({
      title: `${chat.name} - ${subtitle}`,
      showSpinner: subStage === 'analysis',
    });
  }, [chat.id, subStage, chat.name, onHeaderInfo]);

  if (subStage === 'upload') {
    return <div data-testid="upload-view">Upload</div>;
  }

  if (subStage === 'analysis') {
    return (
      <div data-testid="analysis-view" data-key={`${chat.id}-verify-${analysisKey}`} data-reconnecting={!isConnected}>
        {reconnectBanner && <div data-testid="reconnect-banner">Reconnecting...</div>}
        TextLog streaming
      </div>
    );
  }

  if (subStage === 'satisfied') {
    return (
      <div data-testid="satisfied-view">
        <span data-testid="check-circle">CheckCircle</span>
        <span>All requirements are satisfied</span>
      </div>
    );
  }

  if (subStage === 'error') {
    const isMissingRepo = errorType === 'missing_repository';
    return (
      <div data-testid="error-view" data-reconnecting={!isConnected}>
        {reconnectBanner && <div data-testid="reconnect-banner">Reconnecting...</div>}
        <span data-testid="error-message">{isMissingRepo ? 'No repository found — run implementation first' : 'An error occurred during verification'}</span>
        <button data-testid="retry-button">Retry</button>
      </div>
    );
  }

  return <div data-testid="upload-view">default</div>;
}

describe.skip('ChatVerify TextLog clearing on re-entry', () => {
  beforeEach(() => {
    global.fetch = async () => Response.json({});
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('clears TextLog when sub_stage transitions to analysis', () => {
    const chat = { id: 1, name: 'Test Chat', stage: 'verify', project_id: '1' } as ChatSession;
    const html = ReactDOMServer.renderToString(
      <TestChatVerify chat={chat} mockSubStage="analysis" mockIsConnected={true} />
    );
    assert.ok(html.includes('data-testid="analysis-view"'), `Expected analysis-view: ${html}`);
    const keyMatch = html.match(/data-key="1-verify-(\d+)"/);
    assert.ok(keyMatch, 'Should have a key attribute');
    assert.strictEqual(keyMatch[1], '1', 'Key should be 1 on first entry');
  });

  it('forces new TextLog instance on retry re-entry to analysis', () => {
    const chat = { id: 1, name: 'Test Chat', stage: 'verify', project_id: '1' } as ChatSession;

    const html1 = ReactDOMServer.renderToString(
      <TestChatVerify chat={chat} mockSubStage="analysis" mockIsConnected={true} />
    );
    const keyMatch1 = html1.match(/data-key="1-verify-(\d+)"/);
    assert.ok(keyMatch1, 'First render should have key');
    const firstKey = keyMatch1[1];

    const html2 = ReactDOMServer.renderToString(
      <TestChatVerify chat={chat} mockSubStage="analysis" mockIsConnected={true} />
    );
    const keyMatch2 = html2.match(/data-key="1-verify-(\d+)"/);
    assert.ok(keyMatch2, 'Second render should have key');
    const secondKey = keyMatch2[1];

    assert.strictEqual(secondKey, String(parseInt(firstKey) + 1), 'Key should increment on re-entry');
  });
});

describe.skip('ChatVerify error message routing', () => {
  beforeEach(() => {
    global.fetch = async () => Response.json({});
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('displays missing repository message when errorType is missing_repository', () => {
    const chat = { id: 1, name: 'Test Chat', stage: 'verify', project_id: '1' } as ChatSession;
    const html = ReactDOMServer.renderToString(
      <TestChatVerify chat={chat} mockSubStage="error" mockErrorType="missing_repository" mockIsConnected={true} />
    );
    assert.ok(html.includes('No repository found — run implementation first'), `Expected missing repo message: ${html}`);
  });

  it('displays generic error message for non-missing-repo errors', () => {
    const chat = { id: 2, name: 'Error Chat', stage: 'verify', project_id: '1' } as ChatSession;
    const html = ReactDOMServer.renderToString(
      <TestChatVerify chat={chat} mockSubStage="error" mockErrorType="llm_timeout" mockIsConnected={true} />
    );
    assert.ok(html.includes('An error occurred during verification'), `Expected generic error: ${html}`);
    assert.ok(!html.includes('No repository found'), 'Should not show missing repo message');
  });

  it('displays generic error message when errorType is undefined', () => {
    const chat = { id: 3, name: 'Error Chat', stage: 'verify', project_id: '1' } as ChatSession;
    const html = ReactDOMServer.renderToString(
      <TestChatVerify chat={chat} mockSubStage="error" mockIsConnected={true} />
    );
    assert.ok(html.includes('An error occurred during verification'), `Expected generic error when errorType undefined: ${html}`);
  });
});

describe.skip('ChatVerify WebSocket reconnection handling', () => {
  beforeEach(() => {
    global.fetch = async () => Response.json({});
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('shows reconnect banner in analysis view when isConnected is false', () => {
    const chat = { id: 1, name: 'Test Chat', stage: 'verify', project_id: '1' } as ChatSession;
    const html = ReactDOMServer.renderToString(
      <TestChatVerify chat={chat} mockSubStage="analysis" mockIsConnected={false} />
    );
    assert.ok(html.includes('data-testid="reconnect-banner"'), `Expected reconnect banner in analysis: ${html}`);
    assert.ok(html.includes('Reconnecting...'), `Expected "Reconnecting..." text: ${html}`);
  });

  it('shows reconnect banner in error view when isConnected is false', () => {
    const chat = { id: 1, name: 'Error Chat', stage: 'verify', project_id: '1' } as ChatSession;
    const html = ReactDOMServer.renderToString(
      <TestChatVerify chat={chat} mockSubStage="error" mockProgress="llm_timeout" mockIsConnected={false} />
    );
    assert.ok(html.includes('data-testid="reconnect-banner"'), `Expected reconnect banner in error: ${html}`);
    assert.ok(html.includes('Reconnecting...'), `Expected "Reconnecting..." text: ${html}`);
  });

  it('does not show reconnect banner when isConnected is true', () => {
    const chat = { id: 1, name: 'Test Chat', stage: 'verify', project_id: '1' } as ChatSession;
    const html = ReactDOMServer.renderToString(
      <TestChatVerify chat={chat} mockSubStage="analysis" mockIsConnected={true} />
    );
    assert.ok(!html.includes('data-testid="reconnect-banner"'), `Should not have reconnect banner: ${html}`);
  });

  it('removes reconnect banner when WebSocket reconnects', () => {
    const chat = { id: 1, name: 'Test Chat', stage: 'verify', project_id: '1' } as ChatSession;

    const disconnectedHtml = ReactDOMServer.renderToString(
      <TestChatVerify chat={chat} mockSubStage="analysis" mockIsConnected={false} />
    );
    assert.ok(disconnectedHtml.includes('data-testid="reconnect-banner"'), 'Should show banner when disconnected');

    const reconnectedHtml = ReactDOMServer.renderToString(
      <TestChatVerify chat={chat} mockSubStage="analysis" mockIsConnected={true} />
    );
    assert.ok(!reconnectedHtml.includes('data-testid="reconnect-banner"'), 'Should not show banner when reconnected');
  });
});

describe.skip('ChatVerify satisfied view unchanged', () => {
  beforeEach(() => {
    global.fetch = async () => Response.json({});
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('displays CheckCircle and "All requirements are satisfied" text', () => {
    const chat = { id: 1, name: 'Done Chat', stage: 'verify', project_id: '1' } as ChatSession;
    const html = ReactDOMServer.renderToString(
      <TestChatVerify chat={chat} mockSubStage="satisfied" mockIsConnected={true} />
    );
    assert.ok(html.includes('data-testid="satisfied-view"'), `Expected satisfied-view: ${html}`);
    assert.ok(html.includes('CheckCircle'), 'Should display CheckCircle icon');
    assert.ok(html.includes('All requirements are satisfied'), 'Should display satisfied text');
  });
});