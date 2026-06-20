import * as React from 'react';
import { useOutletContext } from 'react-router-dom';
import { ChatList } from '@/components/plan/ChatList';
import { NewChatButton } from '@/components/plan/NewChatButton';
import { ChatInit } from '@/components/plan/ChatInit';
import { ChatAnalysis } from '@/components/plan/ChatAnalysis';
import { ChatCollecting } from '@/components/plan/ChatCollecting';
import { ChatDomain } from '@/components/plan/ChatDomain';
import { ChatFinalAssessment } from '@/components/plan/ChatFinalAssessment';
import { ChatRequirement } from '@/components/plan/ChatRequirement';
import { ChatPlan } from '@/components/plan/ChatPlan';
import { ChatVerify } from '@/components/plan/ChatVerify';
import { ChatRequirementUpload } from '@/components/plan/ChatRequirementUpload';
import { PlanHeader } from '@/components/plan/PlanHeader';
import type { ChatSession, Project } from '@/lib/types';

interface ProjectContext {
  project: Project;
  projectId: number;
  liveStatus: 'running' | 'stopped' | undefined;
}

interface HeaderInfo {
  title: string;
  showSpinner: boolean;
}

const STAGE_COMPONENTS: Record<string, React.ComponentType<{ chat: ChatSession; onHeaderInfo?: (info: HeaderInfo) => void; viewOnly?: boolean; overrideSubStage?: string }>> = {
  'init': ChatInit,
  'analyzing': ChatAnalysis,
  'collecting': ChatCollecting,
  'domain': ChatDomain,
  'final_assessment': ChatFinalAssessment,
  'requirement': ChatRequirement,
  'plan': ChatPlan,
  'verify': ChatVerify,
};

const STAGE_DISPATCH: { component: React.ComponentType<{ chat: ChatSession; onHeaderInfo?: (info: HeaderInfo) => void; viewOnly?: boolean; overrideSubStage?: string }>; match: (c: ChatSession) => boolean }[] = [
  { component: ChatRequirementUpload, match: (c) => c.mode === 'requirement' && c.stage === 'verify' && c.sub_stage === 'upload' },
  { component: ChatVerify,             match: (c) => c.stage === 'verify' && c.sub_stage === 'upload' },
  { component: ChatInit,               match: (c) => c.stage === 'init' },
  { component: ChatAnalysis,           match: (c) => c.stage === 'analyzing' },
  { component: ChatCollecting,         match: (c) => c.stage === 'collecting' },
  { component: ChatDomain,             match: (c) => c.stage === 'domain' },
  { component: ChatFinalAssessment,    match: (c) => c.stage === 'final_assessment' },
  { component: ChatRequirement,        match: (c) => c.stage === 'requirement' },
  { component: ChatPlan,               match: (c) => c.stage === 'plan' },
  { component: ChatVerify,             match: (c) => c.stage === 'verify' },
];

const STAGE_DEFAULTS: Record<string, string> = {
  'analyzing': 'analyzing',
  'collecting': 'user',
  'domain': 'quiz',
  'final_assessment': 'user',
  'requirement': 'requirement',
  'plan': 'plan',
  'verify': 'satisfied',
};

export function PlanPage() {
  const { projectId } = useOutletContext<ProjectContext>();
  const [selectedChat, setSelectedChat] = React.useState<ChatSession | null>(null);
  const [headerInfo, setHeaderInfo] = React.useState<HeaderInfo>({ title: '', showSpinner: false });
  const [newChatModalOpen, setNewChatModalOpen] = React.useState(false);
  const [viewingStage, setViewingStage] = React.useState<{ stage: string; subStage: string } | null>(null);

  const isViewingHistory = viewingStage !== null;
  const displayStage = isViewingHistory ? viewingStage.stage : selectedChat?.stage;

  const chatForDispatch = React.useMemo(() => {
    if (!selectedChat) return null;
    if (!isViewingHistory) return selectedChat;
    return {
      ...selectedChat,
      stage: viewingStage.stage,
      sub_stage: viewingStage.subStage || STAGE_DEFAULTS[viewingStage.stage] || '',
    };
  }, [selectedChat, isViewingHistory, viewingStage]);

  const SelectedComponent = displayStage
    ? (chatForDispatch ? STAGE_DISPATCH.find((d) => d.match(chatForDispatch))?.component ?? STAGE_COMPONENTS[displayStage] : STAGE_COMPONENTS[displayStage])
    : null;

  const handleStageClick = React.useCallback((stage: string, subStage: string) => {
    if (stage === '') {
      setViewingStage(null);
    } else {
      setViewingStage({ stage, subStage });
    }
  }, []);

  React.useEffect(() => {
    if (selectedChat === null) {
      setHeaderInfo({ title: '', showSpinner: false });
    }
  }, [selectedChat]);

  React.useEffect(() => {
    setViewingStage(null);
  }, [selectedChat?.id]);

  return (
    <div className="grid grid-cols-[300px_1fr] grid-rows-[56px_1fr] h-full overflow-hidden" style={{ gridTemplateColumns: '300px 1fr', gridTemplateRows: '56px 1fr' }}>
      <div className="border-r border-b border-border">
        <NewChatButton onClick={() => setNewChatModalOpen(true)} />
      </div>
      <div className="border-b border-border">
        <PlanHeader
          title={headerInfo.title}
          showSpinner={headerInfo.showSpinner}
          chatSession={selectedChat}
          onStageClick={handleStageClick}
          viewingStage={viewingStage?.stage ?? null}
        />
      </div>
      <div className="border-r border-border overflow-hidden">
        <ChatList 
          projectId={projectId} 
          onChatSelect={setSelectedChat} 
          onChatDataUpdated={setSelectedChat}
          selectedChatId={selectedChat?.id} 
          newChatModalOpen={newChatModalOpen} 
          onNewChatModalChange={setNewChatModalOpen} 
        />
      </div>
      <div className="flex flex-col h-full overflow-hidden">
        {SelectedComponent && chatForDispatch ? (
          <SelectedComponent
            key={isViewingHistory ? `${chatForDispatch.id}-${viewingStage.stage}` : chatForDispatch.id}
            chat={chatForDispatch}
            onHeaderInfo={setHeaderInfo}
            viewOnly={isViewingHistory}
            overrideSubStage={isViewingHistory ? (viewingStage.subStage || undefined) : undefined}
          />
        ) : (
          <div className="flex items-center justify-center h-full text-muted-foreground">
            Select a chat or create a new one
          </div>
        )}
      </div>
    </div>
  );
}
