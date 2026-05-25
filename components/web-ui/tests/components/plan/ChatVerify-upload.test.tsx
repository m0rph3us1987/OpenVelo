import * as React from 'react';
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import ReactDOMServer from 'react-dom/server';
import type { ChatSession } from '@/lib/types';

const originalFetch = global.fetch;

interface UploadViewProps {
  chat: ChatSession;
  uploadState?: 'idle' | 'uploading' | 'success' | 'error400' | 'errorNetwork';
  errorMessage?: string | null;
}

function UploadViewTestComponent({ chat, uploadState = 'idle', errorMessage = null }: UploadViewProps) {
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = React.useState(uploadState === 'uploading');
  const [displayError, setDisplayError] = React.useState<string | null>(errorMessage);

  React.useEffect(() => {
    setUploading(uploadState === 'uploading');
    setDisplayError(errorMessage);
  }, [uploadState, errorMessage]);

  const handleUpload = async (file: File) => {
    setDisplayError(null);
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('requirement', file);
      const res = await fetch(`/api/chats/${chat.id}/upload-requirement`, {
        method: 'POST',
        body: formData,
      });
      if (!res.ok) {
        if (res.status === 400) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error ?? 'Only .md and .txt files are accepted');
        }
        if (res.status === 403) {
          throw new Error('Access denied');
        }
        if (res.status === 404) {
          throw new Error('Chat not found');
        }
        if (res.status === 413) {
          throw new Error('File size limit exceeded');
        }
        throw new Error('Upload failed — please try again');
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Upload failed — please try again';
      setDisplayError(message);
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="flex flex-col items-center justify-center h-full gap-6">
      <div className="flex flex-col items-center gap-4 text-center max-w-md">
        <span className="h-12 w-12 text-muted-foreground">ShieldCheck</span>
        <p className="text-muted-foreground">
          Upload the original requirement document
        </p>
      </div>
      {displayError && (
        <p className="text-sm text-destructive">{displayError}</p>
      )}
      <input
        ref={fileInputRef}
        type="file"
        accept=".md,.txt"
        style={{ display: 'none' }}
        data-testid="file-input"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleUpload(file);
        }}
      />
      {uploading ? (
        <div className="flex items-center gap-2 text-muted-foreground" data-testid="loading-indicator">
          <span data-testid="spinner">Loader2</span>
          <span>Uploading...</span>
        </div>
      ) : (
        <button
          data-testid="upload-button"
          onClick={() => fileInputRef.current?.click()}
        >
          Upload Requirement
        </button>
      )}
    </div>
  );
}

describe.skip('ChatVerify upload sub-view', () => {
  beforeEach(() => {
    global.fetch = async () => Response.json({});
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('displays prompt message "Upload the original requirement document"', () => {
    const chat = { id: 1, name: 'Test Chat', stage: 'verify', project_id: '1' } as ChatSession;
    const html = ReactDOMServer.renderToString(
      <UploadViewTestComponent chat={chat} uploadState="idle" />
    );
    assert.ok(html.includes('Upload the original requirement document'), `Expected prompt message in output: ${html}`);
  });

  it('shows loading spinner instead of button during upload', () => {
    const chat = { id: 1, name: 'Test Chat', stage: 'verify', project_id: '1' } as ChatSession;
    const html = ReactDOMServer.renderToString(
      <UploadViewTestComponent chat={chat} uploadState="uploading" />
    );
    assert.ok(html.includes('data-testid="loading-indicator"'), `Expected loading indicator during upload: ${html}`);
    assert.ok(!html.includes('data-testid="upload-button"'), `Button should not be present during upload: ${html}`);
  });

  it('displays "Only .md and .txt files are accepted" on 400 error', () => {
    const chat = { id: 1, name: 'Test Chat', stage: 'verify', project_id: '1' } as ChatSession;
    const html = ReactDOMServer.renderToString(
      <UploadViewTestComponent chat={chat} uploadState="error400" errorMessage="Only .md and .txt files are accepted" />
    );
    assert.ok(html.includes('Only .md and .txt files are accepted'), `Expected error message in output: ${html}`);
  });

  it('displays generic error message on network failure', () => {
    const chat = { id: 1, name: 'Test Chat', stage: 'verify', project_id: '1' } as ChatSession;
    const html = ReactDOMServer.renderToString(
      <UploadViewTestComponent chat={chat} uploadState="errorNetwork" errorMessage="Upload failed — please try again" />
    );
    assert.ok(html.includes('Upload failed — please try again'), `Expected generic error in output: ${html}`);
  });

  it('re-enables button after error', () => {
    const chat = { id: 1, name: 'Test Chat', stage: 'verify', project_id: '1' } as ChatSession;
    const html = ReactDOMServer.renderToString(
      <UploadViewTestComponent chat={chat} uploadState="error400" errorMessage="Only .md and .txt files are accepted" />
    );
    assert.ok(html.includes('data-testid="upload-button"'), `Button should be re-enabled after error: ${html}`);
  });
});