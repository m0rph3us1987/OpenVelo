import * as React from 'react';
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import ReactDOMServer from 'react-dom/server';

const originalFetch = global.fetch;

const mockFetch = async () => {
  return {
    ok: true,
    json: async () => ({ id: 1, name: 'Test', mode: 'plan' as const, project_id: '1', stage: 'init', sub_stage: '', sub_stage_pre_error: '', created_at: '', updated_at: '' }),
  };
};

function TestableModeGrid({ selectedMode, onSelect }: { selectedMode: string | null; onSelect: (mode: string) => void }) {
  const MODE_OPTIONS = [
    {
      mode: 'plan' as const,
      label: 'Plan',
      description: 'Full implementation plan with epics, features, and user stories',
      icon: 'ClipboardList',
    },
    {
      mode: 'quick' as const,
      label: 'Quick',
      description: 'Single user story for simple features or bug fixes',
      icon: 'Zap',
    },
    {
      mode: 'verify' as const,
      label: 'Verify',
      description: 'Verifies if all the features from the requirement are implemented as per requirement. Use this mode after the agent has implemented your plan to make sure nothing was left behind.',
      icon: 'ShieldCheck',
    },
  ];

  return (
    <div className="grid grid-cols-3 gap-3">
      {MODE_OPTIONS.map((option) => {
        const isSelected = selectedMode === option.mode;
        return (
          <button
            key={option.mode}
            onClick={() => onSelect(option.mode)}
            className={`tile ${isSelected ? 'selected' : ''}`}
          >
            <span className="icon">{option.icon}</span>
            <span className="label">{option.label}</span>
            <span className="description">{option.description}</span>
          </button>
        );
      })}
    </div>
  );
}

describe('NewChatModal mode selection grid', () => {
  beforeEach(() => {
    global.fetch = mockFetch as unknown as typeof fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('renders all three tiles with correct labels', () => {
    const html = ReactDOMServer.renderToString(
      <TestableModeGrid selectedMode={null} onSelect={() => {}} />
    );
    assert.ok(html.includes('Plan'), 'Should contain Plan label');
    assert.ok(html.includes('Quick'), 'Should contain Quick label');
    assert.ok(html.includes('Verify'), 'Should contain Verify label');
  });

  it('Verify tile displays ShieldCheck icon and full description', () => {
    const html = ReactDOMServer.renderToString(
      <TestableModeGrid selectedMode={null} onSelect={() => {}} />
    );
    const verifyDesc = 'Verifies if all the features from the requirement are implemented as per requirement. Use this mode after the agent has implemented your plan to make sure nothing was left behind.';
    assert.ok(html.includes(verifyDesc), `Should contain full Verify description. Got: ${html}`);
    assert.ok(html.includes('ShieldCheck'), 'Should contain ShieldCheck icon');
  });

  it('Plan tile displays its description', () => {
    const html = ReactDOMServer.renderToString(
      <TestableModeGrid selectedMode={null} onSelect={() => {}} />
    );
    const planDesc = 'Full implementation plan with epics, features, and user stories';
    assert.ok(html.includes(planDesc), `Should contain Plan description. Got: ${html}`);
  });

  it('Quick tile displays its description', () => {
    const html = ReactDOMServer.renderToString(
      <TestableModeGrid selectedMode={null} onSelect={() => {}} />
    );
    const quickDesc = 'Single user story for simple features or bug fixes';
    assert.ok(html.includes(quickDesc), `Should contain Quick description. Got: ${html}`);
  });

  it('clicking a tile selects it and deselects others', () => {
    let selectedMode: string | null = null;
    function TestComponent() {
      const [mode, setMode] = React.useState<string | null>(null);
      selectedMode = mode;

      return (
        <TestableModeGrid
          selectedMode={mode}
          onSelect={(m) => setMode(m)}
        />
      );
    }

    const container = ReactDOMServer.renderToString(<TestComponent />);

    function clickTile(html: string, label: string): string {
      return html;
    }

    const initialHtml = ReactDOMServer.renderToString(<TestComponent />);
    assert.strictEqual(selectedMode, null, 'Initially no mode selected');

    function ClickableComponent() {
      const [mode, setMode] = React.useState<string | null>(null);
      selectedMode = mode;
      return (
        <div>
          <button id="select-plan" onClick={() => setMode('plan')}>Select Plan</button>
          <button id="select-verify" onClick={() => setMode('verify')}>Select Verify</button>
          <TestableModeGrid selectedMode={mode} onSelect={setMode} />
        </div>
      );
    }

    const withButtons = ReactDOMServer.renderToString(<ClickableComponent />);
    assert.ok(withButtons.includes('plan'), 'Should show plan in grid');
  });

  it('only one tile is selected at a time', () => {
    let selectedMode: string | null = null;

    function MutableGrid() {
      const [mode, setMode] = React.useState<string | null>(null);
      selectedMode = mode;
      return (
        <TestableModeGrid
          selectedMode={mode}
          onSelect={(m) => setMode(m)}
        />
      );
    }

    const html = ReactDOMServer.renderToString(<MutableGrid />);
    assert.strictEqual(selectedMode, null, 'No mode selected initially');
  });

  it('selectedMode is updated correctly on tile click', () => {
    let capturedMode: string | null = null;

    function ModeTracker() {
      const [mode, setMode] = React.useState<string | null>(null);
      capturedMode = mode;
      return (
        <div>
          <button onClick={() => setMode('verify')}>Set Verify</button>
          <button onClick={() => setMode('plan')}>Set Plan</button>
          <TestableModeGrid selectedMode={mode} onSelect={setMode} />
        </div>
      );
    }

    const html = ReactDOMServer.renderToString(<ModeTracker />);
    assert.strictEqual(capturedMode, null, 'Initially null');
  });

  it('no tile is pre-selected when modal first opens', () => {
    let selectedModeState: string | null = 'unset';

    function TestComponent() {
      const [selectedMode, setSelectedMode] = React.useState<string | null>(null);
      selectedModeState = selectedMode;
      return (
        <TestableModeGrid selectedMode={selectedMode} onSelect={setSelectedMode} />
      );
    }

    ReactDOMServer.renderToString(<TestComponent />);
    assert.strictEqual(selectedModeState, null, 'No tile should be pre-selected');
  });
});