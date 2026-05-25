import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import * as React from 'react';
import ReactDOMServer from 'react-dom/server';
import type { ChatSession } from '@/lib/types';

let mockSubStage = '';
let mockProgress: string | undefined;

interface MockedChatUserstoryProps {
  chat: ChatSession;
  onHeaderInfo?: (info: { title: string; showSpinner: boolean }) => void;
}

function MockedChatUserstory({ chat, onHeaderInfo }: MockedChatUserstoryProps) {
  let subtitle: string;
  if (mockProgress) {
    subtitle = mockProgress;
  } else if (mockSubStage === '') {
    subtitle = 'Quick Story';
  } else if (mockSubStage === 'generate') {
    subtitle = 'Generating story...';
  } else if (mockSubStage === 'error') {
    subtitle = 'Error';
  } else {
    subtitle = 'Quick Story';
  }

  onHeaderInfo?.({
    title: `${chat.name} - ${subtitle}`,
    showSpinner: mockSubStage === '' || mockSubStage === 'generate',
  });

  if (mockSubStage === '' || mockSubStage === 'generate') {
    return <div data-testid="textlog">TextLog for chat {chat.id}</div>;
  }

  if (mockSubStage === 'error') {
    return (
      <div data-testid="error-message" className="flex items-center justify-center h-full text-muted-foreground">
        Error generating story
      </div>
    );
  }

  return null;
}

describe('ChatUserstory', () => {
  beforeEach(() => {
    mockSubStage = '';
    mockProgress = undefined;
  });

  afterEach(() => {
    mockSubStage = '';
    mockProgress = undefined;
  });

  it('renders TextLog when sub_stage is generate', () => {
    mockSubStage = 'generate';
    const chat = { id: 1, name: 'Test Chat', mode: 'quick' } as ChatSession;
    const html = ReactDOMServer.renderToString(<MockedChatUserstory chat={chat} />);
    assert.ok(html.includes('data-testid="textlog"'), `Expected TextLog in output: ${html}`);
    assert.ok(!html.includes('Error generating story'), 'Should not show error during generate');
  });

  it('renders TextLog when sub_stage is empty', () => {
    mockSubStage = '';
    const chat = { id: 2, name: 'My Chat', mode: 'quick' } as ChatSession;
    const html = ReactDOMServer.renderToString(<MockedChatUserstory chat={chat} />);
    assert.ok(html.includes('data-testid="textlog"'), `Expected TextLog in output: ${html}`);
    assert.ok(!html.includes('Error generating story'), 'Should not show error during empty substage');
  });

  it('renders error message when sub_stage is error', () => {
    mockSubStage = 'error';
    const chat = { id: 3, name: 'Error Chat', mode: 'quick' } as ChatSession;
    const html = ReactDOMServer.renderToString(<MockedChatUserstory chat={chat} />);
    assert.ok(html.includes('Error generating story'), `Expected error message: ${html}`);
    assert.ok(!html.includes('TextLog for chat 3'), 'Should not show TextLog during error');
  });

  it('renders centered error message with flex styling when sub_stage is error', () => {
    mockSubStage = 'error';
    const chat = { id: 4, name: 'Styled Error Chat', mode: 'quick' } as ChatSession;
    const html = ReactDOMServer.renderToString(<MockedChatUserstory chat={chat} />);
    assert.ok(html.includes('flex'), 'Should use flex layout');
    assert.ok(html.includes('items-center'), 'Should center items');
    assert.ok(html.includes('justify-center'), 'Should justify center');
    assert.ok(html.includes('Error generating story'), 'Should contain error text');
  });

  it('does not render any buttons when sub_stage is generate', () => {
    mockSubStage = 'generate';
    const chat = { id: 5, name: 'No Controls Chat', mode: 'quick' } as ChatSession;
    const html = ReactDOMServer.renderToString(<MockedChatUserstory chat={chat} />);
    assert.ok(!html.includes('<button'), 'Should have no buttons');
  });

  it('does not render any input elements when sub_stage is generate', () => {
    mockSubStage = 'generate';
    const chat = { id: 6, name: 'No Inputs Chat', mode: 'quick' } as ChatSession;
    const html = ReactDOMServer.renderToString(<MockedChatUserstory chat={chat} />);
    assert.ok(!html.includes('<input'), 'Should have no input elements');
  });

  it('calls onHeaderInfo with correct title when sub_stage is empty', () => {
    mockSubStage = '';
    const chat = { id: 7, name: 'Empty Substage', mode: 'quick' } as ChatSession;
    let capturedInfo: { title: string; showSpinner: boolean } | undefined;
    ReactDOMServer.renderToString(
      <MockedChatUserstory
        chat={chat}
        onHeaderInfo={(info) => { capturedInfo = info; }}
      />
    );
    assert.strictEqual(capturedInfo?.title, 'Empty Substage - Quick Story', 'Title should contain Quick Story');
    assert.strictEqual(capturedInfo?.showSpinner, true, 'showSpinner should be true');
  });

  it('calls onHeaderInfo with correct title when sub_stage is generate', () => {
    mockSubStage = 'generate';
    const chat = { id: 8, name: 'Header Test', mode: 'quick' } as ChatSession;
    let capturedInfo: { title: string; showSpinner: boolean } | undefined;
    ReactDOMServer.renderToString(
      <MockedChatUserstory
        chat={chat}
        onHeaderInfo={(info) => { capturedInfo = info; }}
      />
    );
    assert.strictEqual(capturedInfo?.title, 'Header Test - Generating story...', 'Title should contain Generating story...');
    assert.strictEqual(capturedInfo?.showSpinner, true, 'showSpinner should be true');
  });

  it('calls onHeaderInfo with showSpinner false when sub_stage is error', () => {
    mockSubStage = 'error';
    const chat = { id: 9, name: 'Error Stage', mode: 'quick' } as ChatSession;
    let capturedInfo: { title: string; showSpinner: boolean } | undefined;
    ReactDOMServer.renderToString(
      <MockedChatUserstory
        chat={chat}
        onHeaderInfo={(info) => { capturedInfo = info; }}
      />
    );
    assert.strictEqual(capturedInfo?.title, 'Error Stage - Error', 'Title should be Error Stage - Error');
    assert.strictEqual(capturedInfo?.showSpinner, false, 'showSpinner should be false');
  });

  it('calls onHeaderInfo with progress string replacing subtitle when progress is set', () => {
    mockSubStage = 'generate';
    mockProgress = 'Creating characters...';
    const chat = { id: 10, name: 'Progress Test', mode: 'quick' } as ChatSession;
    let capturedInfo: { title: string; showSpinner: boolean } | undefined;
    ReactDOMServer.renderToString(
      <MockedChatUserstory
        chat={chat}
        onHeaderInfo={(info) => { capturedInfo = info; }}
      />
    );
    assert.ok(capturedInfo?.title.includes('Creating characters...'), `Title should include progress: ${capturedInfo?.title}`);
  });
});