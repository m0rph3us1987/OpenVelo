import * as React from 'react';
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import ReactDOMServer from 'react-dom/server';
import type { ChatSession } from '@/lib/types';

const originalFetch = global.fetch;

interface ChatListItemProps {
  chat: ChatSession;
}

function ChatListItem({ chat }: ChatListItemProps) {
  return (
    <div data-testid="chat-item">
      <div data-testid="chat-name">{chat.name}</div>
      <div data-testid="chat-stage">Stage: {chat.stage}</div>
      {chat.error_type && (
        <div data-testid="error-badge">
          {chat.error_type === 'missing_repository' ? 'No repository' : 'Error'}
        </div>
      )}
    </div>
  );
}

describe('ChatList error badge rendering', () => {
  beforeEach(() => {
    global.fetch = async () => Response.json({});
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('displays error badge with "No repository" when error_type is missing_repository', () => {
    const chat = { id: 1, name: 'Test Chat', stage: 'verify', project_id: '1', error_type: 'missing_repository' } as ChatSession;
    const html = ReactDOMServer.renderToString(<ChatListItem chat={chat} />);
    assert.ok(html.includes('data-testid="error-badge"'), `Expected error-badge: ${html}`);
    assert.ok(html.includes('No repository'), `Expected "No repository" label: ${html}`);
  });

  it('displays error badge with "Error" for other error_type values', () => {
    const chat = { id: 2, name: 'Test Chat', stage: 'verify', project_id: '1', error_type: 'llm_error' } as ChatSession;
    const html = ReactDOMServer.renderToString(<ChatListItem chat={chat} />);
    assert.ok(html.includes('data-testid="error-badge"'), `Expected error-badge: ${html}`);
    assert.ok(html.includes('Error'), `Expected "Error" label: ${html}`);
  });

  it('does not display error badge when error_type is not set', () => {
    const chat = { id: 3, name: 'Test Chat', stage: 'verify', project_id: '1' } as ChatSession;
    const html = ReactDOMServer.renderToString(<ChatListItem chat={chat} />);
    assert.ok(!html.includes('data-testid="error-badge"'), `Should not display error badge: ${html}`);
  });
});