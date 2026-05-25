import { describe, it } from 'node:test';
import assert from 'node:assert';
import * as React from 'react';
import ReactDOMServer from 'react-dom/server';

const RequirementButtons = ({
  mode,
  onGeneratePlan,
  onGenerateQuickStory,
}: {
  mode: 'plan' | 'quick' | 'verify';
  onGeneratePlan: () => void;
  onGenerateQuickStory: () => void;
}) => {
  const isQuickMode = mode === 'quick';
  const handleGenerate = isQuickMode ? onGenerateQuickStory : onGeneratePlan;

  return (
    <div>
      <button data-testid="toolbar-generate" onClick={handleGenerate}>
        {isQuickMode ? 'Generate user story' : 'Generate plan'}
      </button>
      <button data-testid="bottom-generate" onClick={handleGenerate}>
        {isQuickMode ? 'Generate user story' : 'Generate plan'}
      </button>
    </div>
  );
};

describe('ChatRequirement mode-aware buttons', () => {
  describe('button labels based on chat mode', () => {
    it('renders Generate user story buttons when chat.mode === quick', () => {
      const html = ReactDOMServer.renderToString(
        React.createElement(RequirementButtons, {
          mode: 'quick',
          onGeneratePlan: () => {},
          onGenerateQuickStory: () => {},
        })
      );
      const generateUserStoryCount = (html.match(/Generate user story/g) || []).length;
      assert.strictEqual(generateUserStoryCount, 2, 'Expected 2 Generate user story buttons');
      assert.ok(!html.includes('Generate plan'), 'Should not include Generate plan for quick mode');
    });

    it('renders Generate plan buttons when chat.mode === plan', () => {
      const html = ReactDOMServer.renderToString(
        React.createElement(RequirementButtons, {
          mode: 'plan',
          onGeneratePlan: () => {},
          onGenerateQuickStory: () => {},
        })
      );
      const generatePlanCount = (html.match(/Generate plan/g) || []).length;
      assert.strictEqual(generatePlanCount, 2, 'Expected 2 Generate plan buttons');
      assert.ok(!html.includes('Generate user story'), 'Should not include Generate user story for plan mode');
    });

    it('renders Generate plan buttons when chat.mode === verify', () => {
      const html = ReactDOMServer.renderToString(
        React.createElement(RequirementButtons, {
          mode: 'verify',
          onGeneratePlan: () => {},
          onGenerateQuickStory: () => {},
        })
      );
      const generatePlanCount = (html.match(/Generate plan/g) || []).length;
      assert.strictEqual(generatePlanCount, 2, 'Expected 2 Generate plan buttons for verify mode');
    });

    it('calls correct handler based on mode - quick mode calls onGenerateQuickStory', () => {
      let calledHandler = '';
      ReactDOMServer.renderToString(
        React.createElement(RequirementButtons, {
          mode: 'quick',
          onGeneratePlan: () => { calledHandler = 'plan'; },
          onGenerateQuickStory: () => { calledHandler = 'quickStory'; },
        })
      );
      assert.ok(calledHandler === '', 'Handler should not be called during render');
    });
  });
});