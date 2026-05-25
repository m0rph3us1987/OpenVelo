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
import { ChatUserstory } from '@/components/plan/ChatUserstory';
import { ChatVerify } from '@/components/plan/ChatVerify';
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
  'quick_story': ChatUserstory,
  'plan': ChatPlan,
  'verify': ChatVerify,
};

export function PlanPage() {
  const { projectId } = useOutletContext<ProjectContext>();
  const [selectedChat, setSelectedChat] = React.useState<ChatSession | null>(null);
  const [headerInfo, setHeaderInfo] = React.useState<HeaderInfo>({ title: '', showSpinner: false });
  const [newChatModalOpen, setNewChatModalOpen] = React.useState(false);
  const [viewingStage, setViewingStage] = React.useState<{ stage: string; subStage: string } | null>(null);

  const isViewingHistory = viewingStage !== null;
  const displayStage = isViewingHistory ? viewingStage.stage : selectedChat?.stage;
  const SelectedComponent = displayStage ? STAGE_COMPONENTS[displayStage] : null;

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
        {SelectedComponent && selectedChat ? (
          <SelectedComponent
            key={isViewingHistory ? `${selectedChat.id}-${viewingStage.stage}` : selectedChat.id}
            chat={selectedChat}
            onHeaderInfo={setHeaderInfo}
            viewOnly={isViewingHistory}
            overrideSubStage={isViewingHistory ? viewingStage.subStage : undefined}
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
