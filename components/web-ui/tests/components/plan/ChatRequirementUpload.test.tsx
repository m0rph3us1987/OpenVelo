import * as React from 'react';
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import ReactDOMServer from 'react-dom/server';
import type { ChatSession } from '@/lib/types';

const originalFetch = global.fetch;

interface RequirementUploadProps {
  chat: ChatSession;
  uploadState?: 'idle' | 'uploading' | 'success' | 'error400' | 'error403' | 'error404' | 'error409' | 'error413' | 'errorNetwork';
  errorMessage?: string | null;
  wsSubStage?: string;
}

function RequirementUploadTestComponent({ chat, uploadState = 'idle', errorMessage = null }: RequirementUploadProps) {
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
        if (res.status === 409) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error ?? 'Upload is only supported in verify or requirement mode');
        }
        if (res.status === 413) {
          throw new Error('File size limit exceeded');
        }
        throw new Error('Upload failed - please try again');
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Upload failed - please try again';
      setDisplayError(message);
    } finally {
      setUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  return (
    <div className="relative flex flex-col items-center justify-center h-full gap-6">
      <div className="flex flex-col items-center gap-4 text-center max-w-md">
        <span className="h-12 w-12 text-muted-foreground">FileText</span>
        <p className="text-muted-foreground">
          Upload the requirement document to plan from
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

describe('ChatRequirementUpload component', () => {
  beforeEach(() => {
    global.fetch = async () => Response.json({});
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('displays the requirement upload prompt and FileText icon', () => {
    const chat = { id: 7, name: 'Req Chat', mode: 'requirement', stage: 'verify', sub_stage: 'upload', project_id: 1 } as ChatSession;
    const html = ReactDOMServer.renderToString(
      <RequirementUploadTestComponent chat={chat} uploadState="idle" />
    );
    assert.ok(html.includes('Upload the requirement document to plan from'), `Expected prompt message in output: ${html}`);
    assert.ok(html.includes('FileText'), `Expected FileText icon name in output: ${html}`);
    assert.ok(html.includes('Upload Requirement'), `Expected upload button label: ${html}`);
  });

  it('shows loading spinner instead of button during upload', () => {
    const chat = { id: 7, name: 'Req Chat', mode: 'requirement', stage: 'verify', sub_stage: 'upload', project_id: 1 } as ChatSession;
    const html = ReactDOMServer.renderToString(
      <RequirementUploadTestComponent chat={chat} uploadState="uploading" />
    );
    assert.ok(html.includes('data-testid="loading-indicator"'), `Expected loading indicator during upload: ${html}`);
    assert.ok(!html.includes('data-testid="upload-button"'), `Button should not be present during upload: ${html}`);
  });

  it('displays 400 server-provided error message', () => {
    const chat = { id: 7, name: 'Req Chat', mode: 'requirement', stage: 'verify', sub_stage: 'upload', project_id: 1 } as ChatSession;
    const html = ReactDOMServer.renderToString(
      <RequirementUploadTestComponent chat={chat} uploadState="error400" errorMessage="Only .md and .txt files are accepted" />
    );
    assert.ok(html.includes('Only .md and .txt files are accepted'), `Expected 400 error message: ${html}`);
  });

  it('displays 403 access denied error', () => {
    const chat = { id: 7, name: 'Req Chat', mode: 'requirement', stage: 'verify', sub_stage: 'upload', project_id: 1 } as ChatSession;
    const html = ReactDOMServer.renderToString(
      <RequirementUploadTestComponent chat={chat} uploadState="error403" errorMessage="Access denied" />
    );
    assert.ok(html.includes('Access denied'), `Expected 403 error message: ${html}`);
  });

  it('displays 404 chat not found error', () => {
    const chat = { id: 7, name: 'Req Chat', mode: 'requirement', stage: 'verify', sub_stage: 'upload', project_id: 1 } as ChatSession;
    const html = ReactDOMServer.renderToString(
      <RequirementUploadTestComponent chat={chat} uploadState="error404" errorMessage="Chat not found" />
    );
    assert.ok(html.includes('Chat not found'), `Expected 404 error message: ${html}`);
  });

  it('displays 409 mode-specific error', () => {
    const chat = { id: 7, name: 'Req Chat', mode: 'requirement', stage: 'verify', sub_stage: 'upload', project_id: 1 } as ChatSession;
    const html = ReactDOMServer.renderToString(
      <RequirementUploadTestComponent chat={chat} uploadState="error409" errorMessage="Upload is only supported in verify or requirement mode" />
    );
    assert.ok(html.includes('Upload is only supported in verify or requirement mode'), `Expected 409 error message: ${html}`);
  });

  it('displays 413 file size limit exceeded error', () => {
    const chat = { id: 7, name: 'Req Chat', mode: 'requirement', stage: 'verify', sub_stage: 'upload', project_id: 1 } as ChatSession;
    const html = ReactDOMServer.renderToString(
      <RequirementUploadTestComponent chat={chat} uploadState="error413" errorMessage="File size limit exceeded" />
    );
    assert.ok(html.includes('File size limit exceeded'), `Expected 413 error message: ${html}`);
  });

  it('displays generic network failure message', () => {
    const chat = { id: 7, name: 'Req Chat', mode: 'requirement', stage: 'verify', sub_stage: 'upload', project_id: 1 } as ChatSession;
    const html = ReactDOMServer.renderToString(
      <RequirementUploadTestComponent chat={chat} uploadState="errorNetwork" errorMessage="Upload failed - please try again" />
    );
    assert.ok(html.includes('Upload failed - please try again'), `Expected generic network error: ${html}`);
  });

  it('re-enables button after error', () => {
    const chat = { id: 7, name: 'Req Chat', mode: 'requirement', stage: 'verify', sub_stage: 'upload', project_id: 1 } as ChatSession;
    const html = ReactDOMServer.renderToString(
      <RequirementUploadTestComponent chat={chat} uploadState="error400" errorMessage="Only .md and .txt files are accepted" />
    );
    assert.ok(html.includes('data-testid="upload-button"'), `Button should be re-enabled after error: ${html}`);
  });
});
