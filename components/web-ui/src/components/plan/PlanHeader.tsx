import { Loader2 } from 'lucide-react';
import type { ChatSession, ChatMode } from '@/lib/types';

interface PlanHeaderProps {
  title: string;
  showSpinner: boolean;
  chatSession?: ChatSession | null;
  onStageClick?: (stage: string, subStage: string) => void;
  viewingStage?: string | null;
}

interface StageStep {
  label: string;
  stage: string;
  subStage?: string;          // match exact sub_stage (undefined = any)
  subStageNot?: string;       // match any sub_stage except this value
  clickable?: boolean;        // whether this step is clickable when done
}

const PLAN_STEPS: StageStep[] = [
  { label: 'Analysis', stage: 'analyzing' },
  { label: 'Collecting', stage: 'collecting', clickable: true },
  { label: 'Domain', stage: 'domain', subStageNot: 'quiz' },
  { label: 'Quiz', stage: 'domain', subStage: 'quiz', clickable: true },
  { label: 'Final Assessment', stage: 'final_assessment', clickable: true },
  { label: 'Plan', stage: 'plan', clickable: true },
];

const REQUIREMENT_STEPS: StageStep[] = [
  { label: 'Analysis', stage: 'analyzing' },
  { label: 'Upload', stage: 'verify', subStage: 'upload', clickable: true },
  { label: 'Requirement', stage: 'requirement', clickable: true },
  { label: 'Plan', stage: 'plan', clickable: true },
];

const STEPS_BY_MODE: Record<ChatMode, StageStep[]> = {
  plan: PLAN_STEPS,
  requirement: REQUIREMENT_STEPS,
};

function isAllDone(mode: ChatMode, stage: string, subStage: string): boolean {
  if (stage === 'plan' && subStage === 'plan') return true;
  return false;
}

function matchesStep(step: StageStep, stage: string, subStage: string): boolean {
  if (step.stage !== stage) return false;
  if (step.subStage !== undefined) return step.subStage === subStage;
  if (step.subStageNot !== undefined) return step.subStageNot !== subStage;
  return true;
}

function getActiveIndex(mode: ChatMode, stage: string, subStage: string): { steps: StageStep[]; activeIndex: number; allDone: boolean } {
  const steps = STEPS_BY_MODE[mode] ?? PLAN_STEPS;
  const allDone = isAllDone(mode, stage, subStage);
  if (allDone) return { steps, activeIndex: -1, allDone: true };

  for (let i = 0; i < steps.length; i++) {
    if (matchesStep(steps[i], stage, subStage)) {
      return { steps, activeIndex: i, allDone: false };
    }
  }

  return { steps, activeIndex: -1, allDone: false };
}

export function PlanHeader({ title, showSpinner, chatSession, onStageClick, viewingStage }: PlanHeaderProps) {
  const showProgress = chatSession && chatSession.stage !== 'init';

  let steps: StageStep[] = [];
  let activeIndex = -1;
  let allDone = false;

  if (showProgress) {
    const result = getActiveIndex(chatSession.mode, chatSession.stage, chatSession.sub_stage);
    steps = result.steps;
    activeIndex = result.activeIndex;
    allDone = result.allDone;
  }

  return (
    <div className="flex items-center justify-between h-14 px-3 border-b border-border">
      <div className="flex items-center gap-2">
        <span className="font-medium">{title}</span>
        {showSpinner && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
      </div>
      {showProgress && (
        <div className="flex items-center gap-1 text-xs">
          {steps.map((step, i) => {
            const isDone = allDone || (activeIndex >= 0 && i < activeIndex);
            const isActive = !allDone && i === activeIndex;
            const isClickableDone = isDone && step.clickable && onStageClick;
            const isClickableActive = isActive && viewingStage && onStageClick;
            const isBeingViewed = viewingStage === step.stage;

            const handleClick = () => {
              if (isClickableDone) {
                const targetStage = step.stage;
                const targetSubStage = step.subStage ?? '';
                onStageClick(targetStage, targetSubStage);
              } else if (isClickableActive) {
                onStageClick('', '');
              }
            };

            const labelClasses = isDone
              ? isBeingViewed
                ? 'underline'
                : ''
              : isActive
                ? 'font-bold'
                : 'text-muted-foreground';

            const clickClasses = (isClickableDone || isClickableActive)
              ? ' cursor-pointer hover:underline'
              : '';

            return (
              <span key={step.label} className="flex items-center gap-1">
                {i > 0 && <span className="text-muted-foreground mx-0.5">{'\u2192'}</span>}
                <span
                  className={labelClasses + clickClasses}
                  onClick={handleClick}
                  role={(isClickableDone || isClickableActive) ? 'button' : undefined}
                >
                  {isDone ? '\u2713' : isActive ? '\u25CF' : '\u25CB'}
                  {' '}
                  {step.label}
                </span>
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}
