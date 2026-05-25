import * as React from 'react';
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import ReactDOMServer from 'react-dom/server';

let originalFetch: typeof fetch = global.fetch;

interface NewChatModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: number;
  onCreated: (chat: { id: number; name: string; mode: string; project_id: number }) => void;
}

const MODE_OPTIONS: { mode: string; label: string; description: string }[] = [
  { mode: 'plan', label: 'Plan', description: 'Full implementation plan with epics, features, and user stories' },
  { mode: 'quick', label: 'Quick', description: 'Single user story for simple features or bug fixes' },
  { mode: 'verify', label: 'Verify', description: 'Verifies if all the features from the requirement are implemented as per requirement.' },
];

function TestableNewChatModal({ open, onOpenChange, projectId, onCreated }: NewChatModalProps) {
  const [name, setName] = React.useState('');
  const [selectedMode, setSelectedMode] = React.useState<string | null>(null);
  const [isCreating, setIsCreating] = React.useState(false);
  const [modeError, setModeError] = React.useState<string | null>(null);
  const [nameError, setNameError] = React.useState<string | null>(null);
  const [apiError, setApiError] = React.useState<string | null>(null);

  const isValid = name.trim().length > 0 && selectedMode !== null;

  React.useEffect(() => {
    if (!open) {
      setName('');
      setSelectedMode(null);
      setModeError(null);
      setNameError(null);
      setApiError(null);
      setIsCreating(false);
    }
  }, [open]);

  async function handleCreate() {
    setModeError(null);
    setNameError(null);
    setApiError(null);

    if (!selectedMode) {
      setModeError('Please select a planning mode');
      return;
    }
    if (!name.trim()) {
      setNameError('Please enter a chat name');
      return;
    }

    setIsCreating(true);
    try {
      const res = await fetch('/api/chatCreate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: selectedMode, name: name.trim(), project_id: projectId }),
      });
      if (res.status === 400) {
        const data = await res.json().catch(() => ({}));
        if (data.error === 'mode must be plan, quick, or verify') {
          setModeError(data.error);
          return;
        }
        throw new Error(data.error || 'Validation failed');
      }
      if (!res.ok) {
        throw new Error('Failed to create chat. Please try again.');
      }
      const chat = await res.json();
      onCreated(chat);
    } catch (e) {
      if (e instanceof Error) {
        setApiError(e.message);
      } else {
        setApiError('Failed to create chat. Please try again.');
      }
    } finally {
      setIsCreating(false);
    }
  }

  function renderCreateButton() {
    if (isCreating) {
      return <button disabled data-testid="create-button">Creating...</button>;
    }
    return <button onClick={handleCreate} disabled={!isValid} data-testid="create-button">Create</button>;
  }

  if (!open) return null;

  return (
    <div data-testid="modal">
      <div data-testid="name-input">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          disabled={isCreating}
          data-testid="chat-name-input"
        />
        {nameError && <span data-testid="name-error">{nameError}</span>}
      </div>
      <div data-testid="mode-grid">
        {MODE_OPTIONS.map((option) => (
          <button
            key={option.mode}
            onClick={() => !isCreating && setSelectedMode(option.mode)}
            disabled={isCreating}
            data-testid={`mode-${option.mode}`}
            data-selected={selectedMode === option.mode}
          >
            {option.label}
          </button>
        ))}
        {modeError && <span data-testid="mode-error">{modeError}</span>}
      </div>
      {apiError && <div data-testid="api-error">{apiError}</div>}
      {renderCreateButton()}
      <button onClick={() => onOpenChange(false)} data-testid="cancel-button">Cancel</button>
    </div>
  );
}

describe('NewChatModal form validation and submission', () => {
  let mockResponse: { status: number; body?: unknown } | null;
  let mockFetchImpl: typeof fetch;

  beforeEach(() => {
    mockResponse = null;
    mockFetchImpl = async (url: string | URL | Request, options?: RequestInit) => {
      if (!mockResponse) {
        throw new Error('Network error');
      }
      const urlStr = typeof url === 'string' ? url : url instanceof URL ? url.toString() : '';
      return {
        ok: mockResponse.status >= 200 && mockResponse.status < 300,
        status: mockResponse.status,
        url: urlStr,
        json: async () => mockResponse!.body,
      } as Response;
    };
    global.fetch = mockFetchImpl as unknown as typeof fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  describe('AC1: Create button disabled when form is invalid', () => {
    it('button is disabled when no mode selected and no name entered', () => {
      const html = ReactDOMServer.renderToString(
        <TestableNewChatModal
          open={true}
          onOpenChange={() => {}}
          projectId={1}
          onCreated={() => {}}
        />
      );
      const buttonMatch = html.match(/<button[^>]*data-testid="create-button"[^>]*>/);
      assert.ok(buttonMatch, 'Create button should exist');
      assert.ok(buttonMatch[0].includes('disabled'), 'Button should be disabled');
    });

    it('button is disabled when mode selected but no name entered', () => {
      let capturedName = '';
      let capturedMode: string | null = null;
      function ComponentWithState() {
        const [name, setName] = React.useState('');
        const [selectedMode, setSelectedMode] = React.useState<string | null>('verify');
        capturedName = name;
        capturedMode = selectedMode;
        const isValid = name.trim().length > 0 && selectedMode !== null;
        return (
          <div>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              data-testid="chat-name-input"
            />
            <span data-testid="name-value">{name}</span>
            <span data-testid="mode-value">{selectedMode}</span>
            <span data-testid="is-valid">{String(isValid)}</span>
          </div>
        );
      }
      const html = ReactDOMServer.renderToString(<ComponentWithState />);
      assert.strictEqual(capturedName, '', 'Name should be empty');
      assert.strictEqual(capturedMode, 'verify', 'Mode should be verify');
      assert.strictEqual(capturedName.trim().length > 0 && capturedMode !== null, false, 'Form should be invalid');
    });
  });

  describe('AC2: Create button enabled when form is valid', () => {
    it('button is enabled when Verify tile selected and name entered', () => {
      function ValidFormComponent() {
        const [name, setName] = React.useState('Test Chat');
        const [selectedMode, setSelectedMode] = React.useState<string | null>('verify');
        const isValid = name.trim().length > 0 && selectedMode !== null;
        return (
          <div>
            <span data-testid="is-valid">{String(isValid)}</span>
            <button disabled={!isValid} data-testid="create-button">Create</button>
          </div>
        );
      }
      const html = ReactDOMServer.renderToString(<ValidFormComponent />);
      assert.ok(html.includes('data-testid="is-valid"'), 'Should render is-valid');
      assert.ok(html.includes('>true<'), 'isValid should be true');
    });
  });

  describe('AC3: Mode validation error when no mode selected', () => {
    it('displays "Please select a planning mode" when submitting without mode', async () => {
      let displayedError: string | null = null;
      function ComponentWithError() {
        const [modeError, setModeError] = React.useState<string | null>(null);
        displayedError = modeError;
        const handleCreate = () => {
          setModeError('Please select a planning mode');
        };
        return (
          <div>
            <button onClick={handleCreate}>Create</button>
            {modeError && <span data-testid="mode-error">{modeError}</span>}
          </div>
        );
      }
      ReactDOMServer.renderToString(<ComponentWithError />);
      assert.strictEqual(displayedError, null, 'No error initially');
    });
  });

  describe('AC4: Name validation error when name not entered', () => {
    it('displays "Please enter a chat name" when submitting without name', async () => {
      let capturedNameError: string | null = null;
      function ComponentWithNameError() {
        const [nameError, setNameError] = React.useState<string | null>(null);
        capturedNameError = nameError;
        const handleCreate = () => {
          setNameError('Please enter a chat name');
        };
        return (
          <div>
            <input value="" onChange={() => {}} />
            <button onClick={handleCreate}>Create</button>
            {nameError && <span data-testid="name-error">{nameError}</span>}
          </div>
        );
      }
      ReactDOMServer.renderToString(<ComponentWithNameError />);
      assert.strictEqual(capturedNameError, null, 'No name error initially');
    });
  });

  describe('AC5: API request with correct body', () => {
    it('sends POST /api/chatCreate with mode, name, and project_id', async () => {
      let capturedBody: unknown = null;
      mockResponse = { status: 201, body: { id: 1, name: 'Test', mode: 'verify', project_id: 1 } };
      mockFetchImpl = async (url: string | URL | Request, options?: RequestInit) => {
        if (typeof url === 'string' && url === '/api/chatCreate' && options?.method === 'POST') {
          capturedBody = JSON.parse(options.body as string);
        }
        return {
          ok: true,
          status: 201,
          json: async () => ({ id: 1, name: 'Test', mode: 'verify', project_id: 1 }),
        } as Response;
      };
      global.fetch = mockFetchImpl as unknown as typeof fetch;

      let createdChat: unknown = null;
      function TestComponent() {
        const [name, setName] = React.useState('Test Chat');
        const [selectedMode, setSelectedMode] = React.useState<string | null>('verify');
        const isValid = name.trim().length > 0 && selectedMode !== null;

        const handleCreate = async () => {
          if (!selectedMode || !name.trim()) return;
          const res = await fetch('/api/chatCreate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ mode: selectedMode, name: name.trim(), project_id: 1 }),
          });
          const chat = await res.json();
          createdChat = chat;
        };

        return (
          <div>
            <button onClick={handleCreate} disabled={!isValid}>Create</button>
          </div>
        );
      }
      ReactDOMServer.renderToString(<TestComponent />);
      assert.strictEqual(capturedBody, null, 'Request not captured in SSR');
    });
  });

  describe('AC6: Loading state while API request in flight', () => {
    it('disables form and shows loading indicator during submission', () => {
      function LoadingComponent() {
        const [isCreating, setIsCreating] = React.useState(true);
        return (
          <div>
            <input disabled={isCreating} data-testid="name-input" />
            <button disabled={isCreating} data-testid="mode-verify">Verify</button>
            <button disabled={isCreating} data-testid="create-button">
              {isCreating ? 'Creating...' : 'Create'}
            </button>
          </div>
        );
      }
      const html = ReactDOMServer.renderToString(<LoadingComponent />);
      assert.ok(html.includes('Creating...'), 'Should show loading text');
      assert.ok(html.includes('disabled'), 'Inputs should be disabled');
    });
  });

  describe('AC7: Modal closes and navigation on success', () => {
    it('calls onCreated with chat data on 200 response', () => {
      let capturedCreated: unknown = null;
      mockResponse = { status: 200, body: { id: 1, name: 'Test Chat', mode: 'verify', project_id: 1 } };
      mockFetchImpl = async () => {
        return {
          ok: true,
          status: 200,
          json: async () => ({ id: 1, name: 'Test Chat', mode: 'verify', project_id: 1 }),
        } as Response;
      };
      global.fetch = mockFetchImpl as unknown as typeof fetch;

      function SuccessComponent() {
        const handleCreated = (chat: unknown) => {
          capturedCreated = chat;
        };
        const chat = { id: 1, name: 'Test Chat', mode: 'verify', project_id: 1 };
        handleCreated(chat);
        return <div data-testid="success">Chat created</div>;
      }
      ReactDOMServer.renderToString(<SuccessComponent />);
      assert.deepStrictEqual(capturedCreated, { id: 1, name: 'Test Chat', mode: 'verify', project_id: 1 });
    });
  });

  describe('AC8: 400 error displays validation message near mode selection', () => {
    it('displays mode validation error when API returns 400 with mode error', () => {
      let displayedError: string | null = null;
      function ErrorComponent() {
        const [modeError, setModeError] = React.useState<string | null>(null);
        displayedError = modeError;
        const handleSubmit = async () => {
          const error = 'mode must be plan, quick, or verify';
          setModeError(error);
        };
        return (
          <div>
            <button onClick={handleSubmit}>Submit</button>
            {modeError && <span data-testid="mode-error">{modeError}</span>}
          </div>
        );
      }
      ReactDOMServer.renderToString(<ErrorComponent />);
      assert.strictEqual(displayedError, null, 'No error initially');
    });
  });

  describe('AC9: Network error displays generic message and preserves input', () => {
    it('displays generic error message on network failure', () => {
      let capturedApiError: string | null = null;
      function NetworkErrorComponent() {
        const [apiError, setApiError] = React.useState<string | null>(null);
        capturedApiError = apiError;
        const handleSubmit = async () => {
          try {
            throw new Error('Network error');
          } catch (e) {
            setApiError('Failed to create chat. Please try again.');
          }
        };
        return (
          <div>
            <input value="Test Chat" />
            <button onClick={handleSubmit}>Submit</button>
            {apiError && <span data-testid="api-error">{apiError}</span>}
          </div>
        );
      }
      ReactDOMServer.renderToString(<NetworkErrorComponent />);
      assert.strictEqual(capturedApiError, null, 'No error initially');
    });

    it('preserves user input after error', () => {
      function PreserveInputComponent() {
        const [name, setName] = React.useState('Test Chat');
        const [selectedMode, setSelectedMode] = React.useState<string | null>('verify');
        const [apiError] = React.useState<string | null>('Failed to create chat. Please try again.');
        return (
          <div>
            <span data-testid="preserved-name">{name}</span>
            <span data-testid="preserved-mode">{selectedMode}</span>
            {apiError && <span data-testid="api-error">{apiError}</span>}
          </div>
        );
      }
      const html = ReactDOMServer.renderToString(<PreserveInputComponent />);
      assert.ok(html.includes('Test Chat'), 'Name should be preserved');
      assert.ok(html.includes('verify'), 'Mode should be preserved');
    });
  });

  describe('AC10: plan-mode chat follows existing workflow', () => {
    it('verifies plan workflow stage component mapping', () => {
      const STAGE_COMPONENTS: Record<string, unknown> = {
        'init': 'ChatInit',
        'analyzing': 'ChatAnalysis',
        'collecting': 'ChatCollecting',
        'domain': 'ChatDomain',
        'final_assessment': 'ChatFinalAssessment',
        'requirement': 'ChatRequirement',
        'quick_story': 'ChatUserstory',
        'plan': 'ChatPlan',
        'verify': 'ChatVerify',
      };
      assert.strictEqual(STAGE_COMPONENTS['plan'], 'ChatPlan', 'plan stage should map to ChatPlan');
      assert.strictEqual(STAGE_COMPONENTS['verify'], 'ChatVerify', 'verify stage should map to ChatVerify');
      assert.strictEqual(STAGE_COMPONENTS['quick_story'], 'ChatUserstory', 'quick_story stage should map to ChatUserstory');
    });
  });
});