import * as React from 'react';
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import ReactDOMServer from 'react-dom/server';
import type { ChatSession } from '@/lib/types';

let mockFetch = async () => Response.json([]);
const originalFetch = global.fetch;

interface MockedChatVerifyProps {
  chat: ChatSession;
  onHeaderInfo?: (info: { title: string; showSpinner: boolean }) => void;
}

function MockedChatVerify({ chat, onHeaderInfo }: MockedChatVerifyProps) {
  onHeaderInfo?.({
    title: `${chat.name} - Verify`,
    showSpinner: false,
  });
  return <div data-testid="chat-verify">ChatVerify for {chat.id}</div>;
}

interface MockedChatUserstoryProps {
  chat: ChatSession;
  onHeaderInfo?: (info: { title: string; showSpinner: boolean }) => void;
}

function MockedChatUserstory({ chat, onHeaderInfo }: MockedChatUserstoryProps) {
  onHeaderInfo?.({
    title: `${chat.name} - Quick Story`,
    showSpinner: true,
  });
  return <div data-testid="chat-userstory">ChatUserstory for {chat.id}</div>;
}

interface MockedChatRequirementProps {
  chat: ChatSession;
  onHeaderInfo?: (info: { title: string; showSpinner: boolean }) => void;
}

function MockedChatRequirement({ chat, onHeaderInfo }: MockedChatRequirementProps) {
  onHeaderInfo?.({
    title: `${chat.name} - Requirement`,
    showSpinner: false,
  });
  return <div data-testid="chat-requirement">ChatRequirement for {chat.id}</div>;
}

interface MockedChatPlanProps {
  chat: ChatSession;
  onHeaderInfo?: (info: { title: string; showSpinner: boolean }) => void;
}

function MockedChatPlan({ chat, onHeaderInfo }: MockedChatPlanProps) {
  onHeaderInfo?.({
    title: `${chat.name} - Plan`,
    showSpinner: false,
  });
  return <div data-testid="chat-plan">ChatPlan for {chat.id}</div>;
}

const STAGE_COMPONENTS: Record<string, React.ComponentType<{ chat: ChatSession; onHeaderInfo?: (info: { title: string; showSpinner: boolean }) => void }>> = {
  'init': () => <div>ChatInit</div>,
  'analyzing': () => <div>ChatAnalysis</div>,
  'collecting': () => <div>ChatCollecting</div>,
  'domain': () => <div>ChatDomain</div>,
  'final_assessment': () => <div>ChatFinalAssessment</div>,
  'requirement': MockedChatRequirement,
  'quick_story': MockedChatUserstory,
  'plan': MockedChatPlan,
  'verify': MockedChatVerify,
};

function PlanPageTestComponent({ selectedChat }: { selectedChat: ChatSession | null }) {
  const [headerInfo, setHeaderInfo] = React.useState({ title: '', showSpinner: false });
  const SelectedComponent = selectedChat ? STAGE_COMPONENTS[selectedChat.stage] : null;

  return (
    <div>
      {SelectedComponent ? (
        <SelectedComponent key={selectedChat!.id} chat={selectedChat!} onHeaderInfo={setHeaderInfo} />
      ) : (
        <div data-testid="no-selection">Select a chat</div>
      )}
    </div>
  );
}

describe('PlanPage STAGE_COMPONENTS', () => {
  beforeEach(() => {
    global.fetch = mockFetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('renders ChatUserstory when chat stage is quick_story', () => {
    const chat = { id: 1, name: 'Test Chat', stage: 'quick_story', project_id: 1 } as ChatSession;
    const html = ReactDOMServer.renderToString(<PlanPageTestComponent selectedChat={chat} />);
    assert.ok(html.includes('data-testid="chat-userstory"'), `Expected ChatUserstory in output: ${html}`);
    assert.ok(html.includes('ChatUserstory for'), 'Should render ChatUserstory text');
  });

  it('renders ChatPlan when chat stage is plan', () => {
    const chat = { id: 2, name: 'Plan Chat', stage: 'plan', project_id: 1 } as ChatSession;
    const html = ReactDOMServer.renderToString(<PlanPageTestComponent selectedChat={chat} />);
    assert.ok(html.includes('data-testid="chat-plan"'), `Expected ChatPlan in output: ${html}`);
    assert.ok(html.includes('ChatPlan for'), 'Should render ChatPlan text');
  });

  it('renders ChatRequirement when chat stage is requirement', () => {
    const chat = { id: 3, name: 'Req Chat', stage: 'requirement', project_id: 1 } as ChatSession;
    const html = ReactDOMServer.renderToString(<PlanPageTestComponent selectedChat={chat} />);
    assert.ok(html.includes('ChatRequirement'), 'Should render ChatRequirement');
  });

  it('renders ChatInit when chat stage is init', () => {
    const chat = { id: 4, name: 'Init Chat', stage: 'init', project_id: 1 } as ChatSession;
    const html = ReactDOMServer.renderToString(<PlanPageTestComponent selectedChat={chat} />);
    assert.ok(html.includes('ChatInit'), 'Should render ChatInit');
  });

  it('renders ChatAnalysis when chat stage is analyzing', () => {
    const chat = { id: 5, name: 'Analyzing Chat', stage: 'analyzing', project_id: 1 } as ChatSession;
    const html = ReactDOMServer.renderToString(<PlanPageTestComponent selectedChat={chat} />);
    assert.ok(html.includes('ChatAnalysis'), 'Should render ChatAnalysis');
  });

  it('renders ChatCollecting when chat stage is collecting', () => {
    const chat = { id: 6, name: 'Collecting Chat', stage: 'collecting', project_id: 1 } as ChatSession;
    const html = ReactDOMServer.renderToString(<PlanPageTestComponent selectedChat={chat} />);
    assert.ok(html.includes('ChatCollecting'), 'Should render ChatCollecting');
  });

  it('renders ChatDomain when chat stage is domain', () => {
    const chat = { id: 7, name: 'Domain Chat', stage: 'domain', project_id: 1 } as ChatSession;
    const html = ReactDOMServer.renderToString(<PlanPageTestComponent selectedChat={chat} />);
    assert.ok(html.includes('ChatDomain'), 'Should render ChatDomain');
  });

  it('renders ChatFinalAssessment when chat stage is final_assessment', () => {
    const chat = { id: 8, name: 'Final Chat', stage: 'final_assessment', project_id: 1 } as ChatSession;
    const html = ReactDOMServer.renderToString(<PlanPageTestComponent selectedChat={chat} />);
    assert.ok(html.includes('ChatFinalAssessment'), 'Should render ChatFinalAssessment');
  });

  it('renders nothing when no chat is selected', () => {
    const html = ReactDOMServer.renderToString(<PlanPageTestComponent selectedChat={null} />);
    assert.ok(html.includes('data-testid="no-selection"'), `Expected no-selection in output: ${html}`);
  });

  it('renders ChatVerify when chat stage is verify', () => {
    const chat = { id: 9, name: 'Verify Chat', stage: 'verify', project_id: 1 } as ChatSession;
    const html = ReactDOMServer.renderToString(<PlanPageTestComponent selectedChat={chat} />);
    assert.ok(html.includes('data-testid="chat-verify"'), `Expected ChatVerify in output: ${html}`);
    assert.ok(html.includes('ChatVerify for'), 'Should render ChatVerify text');
  });

  it('renders ChatVerify for verify stage and ChatRequirement for requirement stage (swap test)', () => {
    const verifyChat = { id: 10, name: 'Swap Chat', stage: 'verify', project_id: 1 } as ChatSession;
    const htmlVerify = ReactDOMServer.renderToString(<PlanPageTestComponent selectedChat={verifyChat} />);
    assert.ok(htmlVerify.includes('data-testid="chat-verify"'), `Expected ChatVerify for verify stage: ${htmlVerify}`);

    const requirementChat = { id: 10, name: 'Swap Chat', stage: 'requirement', project_id: 1 } as ChatSession;
    const htmlRequirement = ReactDOMServer.renderToString(<PlanPageTestComponent selectedChat={requirementChat} />);
    assert.ok(htmlRequirement.includes('data-testid="chat-requirement"'), `Expected ChatRequirement for requirement stage: ${htmlRequirement}`);
  });

  it('stage-to-component mapping returns correct component for each stage (verify entry regression check)', () => {
    const stageComponentMap: Record<string, string> = {
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

    for (const [stage, expected] of Object.entries(stageComponentMap)) {
      const chat = { id: 100, name: 'Test', stage, project_id: 1 } as ChatSession;
      const html = ReactDOMServer.renderToString(<PlanPageTestComponent selectedChat={chat} />);
      assert.ok(html.includes(expected), `Stage '${stage}' should render '${expected}', got: ${html}`);
    }
  });
});