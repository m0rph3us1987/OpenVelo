import * as React from 'react';
import { ArrowDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/context/ToastContext';
import { ChatCollecting } from '@/components/plan/ChatCollecting';
import { ChatDomain } from '@/components/plan/ChatDomain';
import { ChatPlan } from '@/components/plan/ChatPlan';
import { ChatVerify } from '@/components/plan/ChatVerify';
import { ChatRequirement } from '@/components/plan/ChatRequirement';
import { ChatInit } from '@/components/plan/ChatInit';
import { ChatAnalysis } from '@/components/plan/ChatAnalysis';
import { ChatFinalAssessment } from '@/components/plan/ChatFinalAssessment';
import { ChatRequirementUpload } from '@/components/plan/ChatRequirementUpload';
import { MobileChatPanelHeader } from './MobileChatPanelHeader';
import { useSwipeBack } from './useSwipeBack';
import type { ChatSession } from '@/lib/types';

interface HeaderInfo {
  title: string;
  showSpinner: boolean;
}

interface MobileChatPanelViewProps {
  chat: ChatSession;
  onBack: () => void;
  onSwitchChat?: (chatId: number) => void;
  scrollPositionsRef: React.MutableRefObject<Map<number, number>>;
}

type StageComponentProps = {
  chat: ChatSession;
  onHeaderInfo?: (info: HeaderInfo) => void;
  viewOnly?: boolean;
  overrideSubStage?: string;
};

const STAGE_DISPATCH: {
  component: React.ComponentType<StageComponentProps>;
  match: (c: ChatSession) => boolean;
}[] = [
  { component: ChatRequirementUpload, match: (c) => c.mode === 'requirement' && c.stage === 'verify' && c.sub_stage === 'upload' },
  { component: ChatVerify, match: (c) => c.stage === 'verify' && c.sub_stage === 'upload' },
  { component: ChatInit, match: (c) => c.stage === 'init' },
  { component: ChatAnalysis, match: (c) => c.stage === 'analyzing' },
  { component: ChatCollecting, match: (c) => c.stage === 'collecting' },
  { component: ChatDomain, match: (c) => c.stage === 'domain' },
  { component: ChatFinalAssessment, match: (c) => c.stage === 'final_assessment' },
  { component: ChatRequirement, match: (c) => c.stage === 'requirement' },
  { component: ChatPlan, match: (c) => c.stage === 'plan' },
  { component: ChatVerify, match: (c) => c.stage === 'verify' },
];

function resolveStageComponent(chat: ChatSession): React.ComponentType<StageComponentProps> | null {
  for (const d of STAGE_DISPATCH) {
    if (d.match(chat)) return d.component;
  }
  return null;
}

export function MobileChatPanelView({
  chat,
  onBack,
  scrollPositionsRef,
}: MobileChatPanelViewProps) {
  const [headerInfo, setHeaderInfo] = React.useState<HeaderInfo>({ title: '', showSpinner: false });
  const [showJumpToLatest, setShowJumpToLatest] = React.useState(false);
  const scrollRef = React.useRef<HTMLDivElement | null>(null);
  const { showToast } = useToast();

  useSwipeBack({ enabled: true, onBack });

  React.useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const saved = scrollPositionsRef.current.get(chat.id) ?? 0;
    requestAnimationFrame(() => {
      el.scrollTop = saved;
      updateJumpVisibility();
    });

    function onScroll() {
      const node = scrollRef.current;
      if (!node) return;
      scrollPositionsRef.current.set(chat.id, node.scrollTop);
      updateJumpVisibility();
    }

    function updateJumpVisibility() {
      const node = scrollRef.current;
      if (!node) return;
      const distance = node.scrollHeight - node.scrollTop - node.clientHeight;
      setShowJumpToLatest(distance > 32);
    }

    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, [chat.id, scrollPositionsRef]);

  React.useEffect(() => {
    setHeaderInfo({ title: chat.name, showSpinner: false });
  }, [chat.id]);

  const SelectedComponent = resolveStageComponent(chat);

  function jumpToLatest() {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    setShowJumpToLatest(false);
  }

  return (
    <section
      role="region"
      aria-label={`Chat ${chat.name}`}
      className="flex h-full min-h-0 flex-col"
    >
      <MobileChatPanelHeader
        chat={chat}
        showSpinner={headerInfo.showSpinner || chat.running === 1}
        onBack={onBack}
      />

      <div
        ref={scrollRef}
        className="relative min-h-0 flex-1 overflow-x-hidden overflow-y-auto pb-safe-bottom"
        style={{ WebkitOverflowScrolling: 'touch' }}
        data-testid="mobile-chat-panel-scroll"
      >
        {!SelectedComponent && (
          <div className="flex h-full items-center justify-center p-6 text-center text-mobile-caption text-muted-foreground">
            <button
              type="button"
              onClick={() => showToast('This chat stage is not supported on mobile yet.', 'error')}
              className="tap-target rounded border border-border px-3 py-2 active:bg-muted"
            >
              Unsupported stage: {chat.stage}
            </button>
          </div>
        )}

        {SelectedComponent && (
          <SelectedComponent
            key={chat.id}
            chat={chat}
            onHeaderInfo={setHeaderInfo}
            viewOnly={false}
            overrideSubStage={undefined}
          />
        )}
      </div>

      {showJumpToLatest && (
        <div className="pointer-events-none absolute inset-x-0 bottom-20 flex justify-end px-4">
          <Button
            type="button"
            size="icon"
            variant="default"
            onClick={jumpToLatest}
            aria-label="Jump to latest"
            className="tap-target pointer-events-auto shadow-md"
          >
            <ArrowDown className="h-4 w-4" />
          </Button>
        </div>
      )}
    </section>
  );
}
