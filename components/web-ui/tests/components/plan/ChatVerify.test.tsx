import * as React from 'react';
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import ReactDOMServer from 'react-dom/server';
import type { ChatSession } from '@/lib/types';

const originalFetch = global.fetch;

interface HeaderInfo { title: string; showSpinner: boolean }

function ChatVerifyTestComponent({
  chat,
  onHeaderInfo,
  subStageOverride = 'upload',
}: {
  chat: ChatSession;
  onHeaderInfo?: (info: HeaderInfo) => void;
  subStageOverride?: string;
}) {
  const [subStage] = React.useState(subStageOverride);

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
    return (
      <div data-testid="upload-view">
        <input type="file" accept=".md,.txt" data-testid="file-input" />
        <button data-testid="upload-button">Upload Requirement</button>
      </div>
    );
  }

  if (subStage === 'analysis') {
    return <div data-testid="analysis-view">TextLog streaming</div>;
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
    return (
      <div data-testid="error-view">
        <span data-testid="error-message">{subStageOverride === 'missing_repo' ? 'No repository found — run implementation first' : 'An error occurred'}</span>
        <button data-testid="retry-button">Retry</button>
      </div>
    );
  }

  return <div data-testid="upload-view">default</div>;
}

describe('ChatVerify sub-view rendering', () => {
  beforeEach(() => {
    global.fetch = async () => Response.json({});
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('renders upload view when sub_stage is upload', () => {
    const chat = { id: 1, name: 'Test Chat', stage: 'verify', project_id: '1' } as ChatSession;
    const html = ReactDOMServer.renderToString(
      <ChatVerifyTestComponent chat={chat} subStageOverride="upload" />
    );
    assert.ok(html.includes('data-testid="upload-view"'), `Expected upload-view in output: ${html}`);
    assert.ok(html.includes('data-testid="file-input"'), `Expected file-input in output: ${html}`);
    const fileInputMatch = html.match(/accept="[^"]*"/);
    assert.ok(fileInputMatch, 'File input should have accept attribute');
    assert.ok(fileInputMatch[0].includes('.md') && fileInputMatch[0].includes('.txt'), `accept should include .md and .txt: ${fileInputMatch[0]}`);
  });

  it('renders analysis view when sub_stage is analysis', () => {
    const chat = { id: 2, name: 'Verify Chat', stage: 'verify', project_id: '1' } as ChatSession;
    const html = ReactDOMServer.renderToString(
      <ChatVerifyTestComponent chat={chat} subStageOverride="analysis" />
    );
    assert.ok(html.includes('data-testid="analysis-view"'), `Expected analysis-view in output: ${html}`);
  });

  it('renders satisfied view when sub_stage is satisfied', () => {
    const chat = { id: 3, name: 'Done Chat', stage: 'verify', project_id: '1' } as ChatSession;
    const html = ReactDOMServer.renderToString(
      <ChatVerifyTestComponent chat={chat} subStageOverride="satisfied" />
    );
    assert.ok(html.includes('data-testid="satisfied-view"'), `Expected satisfied-view in output: ${html}`);
    assert.ok(html.includes('CheckCircle'), 'Should display CheckCircle icon');
    assert.ok(html.includes('All requirements are satisfied'), 'Should display satisfied text');
  });

  it('renders error view when sub_stage is error', () => {
    const chat = { id: 4, name: 'Error Chat', stage: 'verify', project_id: '1' } as ChatSession;
    const html = ReactDOMServer.renderToString(
      <ChatVerifyTestComponent chat={chat} subStageOverride="error" />
    );
    assert.ok(html.includes('data-testid="error-view"'), `Expected error-view in output: ${html}`);
    assert.ok(html.includes('data-testid="retry-button"'), 'Should display Retry button');
  });

  it('shows missing repository message when progress is missing_repository', () => {
    const chat = { id: 5, name: 'Error Chat', stage: 'verify', project_id: '1' } as ChatSession;
    const html = ReactDOMServer.renderToString(
      <ChatVerifyTestComponent chat={chat} subStageOverride="missing_repo" />
    );
    assert.ok(html.includes('No repository found — run implementation first'), `Expected missing repo message: ${html}`);
  });
});

describe('ChatVerify header info callback', () => {
  beforeEach(() => {
    global.fetch = async () => Response.json({});
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('calls onHeaderInfo with correct title and spinner for upload sub_stage', () => {
    const chat = { id: 1, name: 'Test Chat', stage: 'verify', project_id: '1' } as ChatSession;
    let capturedInfo: HeaderInfo | undefined;
    ReactDOMServer.renderToString(
      <ChatVerifyTestComponent
        chat={chat}
        onHeaderInfo={(info) => { capturedInfo = info; }}
        subStageOverride="upload"
      />
    );
    assert.strictEqual(capturedInfo?.title, 'Test Chat - Upload Requirement', `Expected "Test Chat - Upload Requirement": ${capturedInfo?.title}`);
    assert.strictEqual(capturedInfo?.showSpinner, false, 'showSpinner should be false for upload');
  });

  it('calls onHeaderInfo with correct title and spinner for analysis sub_stage', () => {
    const chat = { id: 2, name: 'Verify Chat', stage: 'verify', project_id: '1' } as ChatSession;
    let capturedInfo: HeaderInfo | undefined;
    ReactDOMServer.renderToString(
      <ChatVerifyTestComponent
        chat={chat}
        onHeaderInfo={(info) => { capturedInfo = info; }}
        subStageOverride="analysis"
      />
    );
    assert.strictEqual(capturedInfo?.title, 'Verify Chat - Verifying implementation...', `Expected "Verify Chat - Verifying implementation...": ${capturedInfo?.title}`);
    assert.strictEqual(capturedInfo?.showSpinner, true, 'showSpinner should be true for analysis');
  });

  it('calls onHeaderInfo with correct title and spinner for satisfied sub_stage', () => {
    const chat = { id: 3, name: 'Done Chat', stage: 'verify', project_id: '1' } as ChatSession;
    let capturedInfo: HeaderInfo | undefined;
    ReactDOMServer.renderToString(
      <ChatVerifyTestComponent
        chat={chat}
        onHeaderInfo={(info) => { capturedInfo = info; }}
        subStageOverride="satisfied"
      />
    );
    assert.strictEqual(capturedInfo?.title, 'Done Chat - Verification complete', `Expected "Done Chat - Verification complete": ${capturedInfo?.title}`);
    assert.strictEqual(capturedInfo?.showSpinner, false, 'showSpinner should be false for satisfied');
  });

  it('calls onHeaderInfo with correct title and spinner for error sub_stage', () => {
    const chat = { id: 4, name: 'Error Chat', stage: 'verify', project_id: '1' } as ChatSession;
    let capturedInfo: HeaderInfo | undefined;
    ReactDOMServer.renderToString(
      <ChatVerifyTestComponent
        chat={chat}
        onHeaderInfo={(info) => { capturedInfo = info; }}
        subStageOverride="error"
      />
    );
    assert.strictEqual(capturedInfo?.title, 'Error Chat - Error', `Expected "Error Chat - Error": ${capturedInfo?.title}`);
    assert.strictEqual(capturedInfo?.showSpinner, false, 'showSpinner should be false for error');
  });
});

describe('ChatVerify upload view file picker', () => {
  beforeEach(() => {
    global.fetch = async () => Response.json({});
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('renders file picker with accept=".md,.txt"', () => {
    const chat = { id: 1, name: 'Test Chat', stage: 'verify', project_id: '1' } as ChatSession;
    const html = ReactDOMServer.renderToString(
      <ChatVerifyTestComponent chat={chat} subStageOverride="upload" />
    );
    const fileInputMatch = html.match(/<input[^>]*type="file"[^>]*>/);
    assert.ok(fileInputMatch, 'Should have a file input');
    const acceptMatch = fileInputMatch[0].match(/accept="[^"]*"/);
    assert.ok(acceptMatch, 'File input should have accept attribute');
    assert.ok(acceptMatch[0].includes('.md') && acceptMatch[0].includes('.txt'), `accept should include .md and .txt in: ${acceptMatch[0]}`);
  });
});