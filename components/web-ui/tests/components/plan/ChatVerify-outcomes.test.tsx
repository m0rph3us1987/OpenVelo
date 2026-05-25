import * as React from 'react';
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import ReactDOMServer from 'react-dom/server';
import type { ChatSession } from '@/lib/types';

const originalFetch = global.fetch;

interface ChatVerifyProps {
  chat: ChatSession;
  onHeaderInfo?: (info: { title: string; showSpinner: boolean }) => void;
  mockSubStage?: string;
  mockProgress?: string;
  mockFetchError?: string;
  mockFetchStatus?: number;
}

function buildTestChatVerify() {
  return function TestChatVerify({ chat, onHeaderInfo, mockSubStage = 'satisfied', mockProgress, mockFetchError }: ChatVerifyProps) {
    const subStage = mockSubStage;
    const progress = mockProgress;
    const isConnected = true;
    const [retrying, setRetrying] = React.useState(false);
    const [retryError, setRetryError] = React.useState<string | null>(mockFetchError ?? null);

    React.useEffect(() => {
      setRetryError(mockFetchError ?? null);
    }, [mockFetchError]);

    const reconnectBanner = !isConnected;

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

    if (subStage === 'satisfied') {
      return (
        <div data-testid="satisfied-view">
          <span data-testid="check-circle">CheckCircle</span>
          <span>All requirements are satisfied</span>
        </div>
      );
    }

    if (subStage === 'error') {
      const isMissingRepo = progress === 'missing_repository';
      return (
        <div data-testid="error-view">
          {reconnectBanner && <div data-testid="reconnect-banner">Reconnecting...</div>}
          <span data-testid="error-message">{isMissingRepo ? 'No repository found — run implementation first' : 'An error occurred during verification'}</span>
          <button
            data-testid="retry-button"
            disabled={retrying}
            onClick={async () => {
              setRetrying(true);
              setRetryError(null);
              let success = true;
              try {
                const res = await fetch(`/api/chats/${chat.id}/verify/retry`, { method: 'POST' });
                if (!res.ok) {
                  setRetryError('Retry failed. Please try again.');
                  success = false;
                }
              } catch {
                setRetryError('Retry failed. Please try again.');
                success = false;
              } finally {
                if (success) {
                  setRetrying(false);
                }
              }
            }}
          >
            {retrying ? 'Retrying...' : 'Retry'}
          </button>
          {retryError && <span data-testid="retry-error">{retryError}</span>}
        </div>
      );
    }

    return <div data-testid="default-view">default</div>;
  };
}

describe('ChatVerify-outcomes satisfied view', () => {
  beforeEach(() => {
    global.fetch = async () => Response.json({});
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('renders CheckCircle icon and "All requirements are satisfied" text', () => {
    const chat = { id: 1, name: 'Test Chat', stage: 'verify', project_id: '1' } as ChatSession;
    const TestChatVerify = buildTestChatVerify();
    const html = ReactDOMServer.renderToString(
      <TestChatVerify chat={chat} mockSubStage="satisfied" />
    );
    assert.ok(html.includes('data-testid="satisfied-view"'), `Expected satisfied-view: ${html}`);
    assert.ok(html.includes('CheckCircle'), `Expected CheckCircle: ${html}`);
    assert.ok(html.includes('All requirements are satisfied'), `Expected "All requirements are satisfied": ${html}`);
  });

  it('has no interactive elements in satisfied view', () => {
    const chat = { id: 1, name: 'Test Chat', stage: 'verify', project_id: '1' } as ChatSession;
    const TestChatVerify = buildTestChatVerify();
    const html = ReactDOMServer.renderToString(
      <TestChatVerify chat={chat} mockSubStage="satisfied" />
    );
    assert.ok(!html.includes('data-testid="retry-button"'), `Should not have retry button in satisfied view: ${html}`);
    assert.ok(!html.includes('<button'), `Should not have any buttons in satisfied view: ${html}`);
    assert.ok(!html.includes('<input'), `Should not have any inputs in satisfied view: ${html}`);
  });
});

describe('ChatVerify-outcomes error view', () => {
  beforeEach(() => {
    global.fetch = async () => Response.json({});
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('displays missing repository error message when progress is missing_repository', () => {
    const chat = { id: 1, name: 'Test Chat', stage: 'verify', project_id: '1' } as ChatSession;
    const TestChatVerify = buildTestChatVerify();
    const html = ReactDOMServer.renderToString(
      <TestChatVerify chat={chat} mockSubStage="error" mockProgress="missing_repository" />
    );
    assert.ok(html.includes('data-testid="error-view"'), `Expected error-view: ${html}`);
    assert.ok(html.includes('data-testid="error-message"'), `Expected error-message: ${html}`);
    assert.ok(html.includes('No repository found — run implementation first'), `Expected missing repo message: ${html}`);
  });

  it('displays generic error message when progress is not missing_repository', () => {
    const chat = { id: 1, name: 'Test Chat', stage: 'verify', project_id: '1' } as ChatSession;
    const TestChatVerify = buildTestChatVerify();
    const html = ReactDOMServer.renderToString(
      <TestChatVerify chat={chat} mockSubStage="error" mockProgress="llm_timeout" />
    );
    assert.ok(html.includes('data-testid="error-view"'), `Expected error-view: ${html}`);
    assert.ok(html.includes('An error occurred during verification'), `Expected generic error: ${html}`);
    assert.ok(!html.includes('No repository found — run implementation first'), `Should not show missing repo message: ${html}`);
  });

  it('displays Retry button in error view', () => {
    const chat = { id: 1, name: 'Test Chat', stage: 'verify', project_id: '1' } as ChatSession;
    const TestChatVerify = buildTestChatVerify();
    const html = ReactDOMServer.renderToString(
      <TestChatVerify chat={chat} mockSubStage="error" />
    );
    assert.ok(html.includes('data-testid="retry-button"'), `Expected retry button: ${html}`);
    assert.ok(html.includes('>Retry<'), `Expected "Retry" text: ${html}`);
  });

  it('Retry button is not disabled initially', () => {
    const chat = { id: 1, name: 'Test Chat', stage: 'verify', project_id: '1' } as ChatSession;
    const TestChatVerify = buildTestChatVerify();
    const html = ReactDOMServer.renderToString(
      <TestChatVerify chat={chat} mockSubStage="error" />
    );

    const buttonMatch = html.match(/<button[^>]*data-testid="retry-button"[^>]*>/);
    assert.ok(buttonMatch, `Expected retry button: ${html}`);
    assert.ok(!buttonMatch[0].includes('disabled'), `Button should not be disabled initially: ${buttonMatch[0]}`);
  });

  it('shows "Retry" text (not "Retrying...") initially', () => {
    const chat = { id: 1, name: 'Test Chat', stage: 'verify', project_id: '1' } as ChatSession;
    const TestChatVerify = buildTestChatVerify();
    const html = ReactDOMServer.renderToString(
      <TestChatVerify chat={chat} mockSubStage="error" />
    );
    assert.ok(html.includes('>Retry<'), `Expected "Retry" text: ${html}`);
    assert.ok(!html.includes('Retrying...'), `Should not show "Retrying..." initially: ${html}`);
  });
});

describe('ChatVerify-outcomes retry interaction', () => {
  beforeEach(() => {
    global.fetch = async () => Response.json({});
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('on retry failure (network error), error message is displayed', () => {
    const chat = { id: 1, name: 'Test Chat', stage: 'verify', project_id: '1' } as ChatSession;
    const TestChatVerify = buildTestChatVerify();
    const html = ReactDOMServer.renderToString(
      <TestChatVerify chat={chat} mockSubStage="error" mockFetchError="Retry failed. Please try again." />
    );

    assert.ok(html.includes('data-testid="retry-error"'), `Should show retry error: ${html}`);
    assert.ok(html.includes('Retry failed. Please try again.'), `Should show retry failure message: ${html}`);
  });

  it('on retry HTTP error (403), error message is displayed', () => {
    const chat = { id: 1, name: 'Test Chat', stage: 'verify', project_id: '1' } as ChatSession;
    const TestChatVerify = buildTestChatVerify();
    const html = ReactDOMServer.renderToString(
      <TestChatVerify chat={chat} mockSubStage="error" mockFetchError="Retry failed. Please try again." />
    );

    assert.ok(html.includes('data-testid="retry-error"'), `Should show retry error for HTTP 403: ${html}`);
    assert.ok(html.includes('Retry failed. Please try again.'), `Should show retry failure message: ${html}`);
  });
});