import { getChatSession, updateChatSession } from '@/lib/db';
import { wsManager } from '@/lib/websocket-manager';
import { stageWsManager } from '@/lib/stage-ws-manager';
import { handleInit } from './stage-init';
import { handleAnalyzing } from './stage-analyzing';
import { handleCollecting } from './stage-collecting';
import { handleDomain } from './stage-domain';
import { handleFinalAssessment } from './stage-final-assessment';
import { handleRequirement } from './stage-requirement';
import { handlePlan } from './stage-plan';
import { handleVerify } from './stage-verify';

type WorkflowHandler = (chatId: number) => void;

export function getHandler(stage: string, subStage: string): WorkflowHandler | null {
  if (stage === 'init' && subStage === '') return handleInit;
  if (stage === 'analyzing' && subStage === '') return handleAnalyzing;
  if (stage === 'analyzing' && subStage === 'analyzing') return handleAnalyzing;
  if (stage === 'collecting' && subStage === '') return handleCollecting;
  if (stage === 'collecting' && subStage === 'new') return handleCollecting;
  if (stage === 'collecting' && subStage === 'system') return handleCollecting;
  if (stage === 'collecting' && subStage === 'user') return handleCollecting;
  if (stage === 'domain' && subStage === 'plan') return handleDomain;
  if (stage === 'domain' && subStage === 'quiz') return handleDomain;
  if (stage === 'final_assessment' && subStage === 'analysis') return handleFinalAssessment;
  if (stage === 'final_assessment' && subStage === 'system') return handleFinalAssessment;
  if (stage === 'final_assessment' && subStage === 'user') return handleFinalAssessment;
  if (stage === 'requirement') return handleRequirement;
  if (stage === 'plan') return handlePlan;
  if (stage === 'verify') return handleVerify;
  return null;
}

export function runWorkflow(chatId: number): void {
  const chat = getChatSession(chatId);
  if (!chat) {
    console.log(`[workflow] Chat ${chatId} not found`);
    return;
  }

  if (chat.running) {
    console.log(`[workflow] Chat ${chatId} is already running - skipping`);
    return;
  }

  const updated = updateChatSession(chatId, { running: true });
  if (!updated) {
    console.log(`[workflow] Chat ${chatId} could not be updated`);
    return;
  }

  wsManager.broadcastToProject(updated.project_id, {
    type: 'chat_updated',
    chatId: chatId,
    stage: updated.stage,
    sub_stage: updated.sub_stage,
    running: 1,
  });
  stageWsManager.broadcastToStage(chatId, updated.stage, {
    type: 'running_status',
    running: true,
  });

  console.log(`[workflow] Running for chat ${chatId}, stage=${chat.stage}, sub_stage=${chat.sub_stage}`);

  const handler = getHandler(chat.stage, chat.sub_stage);
  if (!handler) {
    console.log(`[workflow] No handler for stage=${chat.stage}, sub_stage=${chat.sub_stage} - workflow complete`);
    return;
  }

  setImmediate(() => {
    handler(chatId);
  });
}

export interface TransitionOptions {
  errorType?: string;
}

export function transitionTo(chatId: number, newStage: string, newSubStage: string, options?: TransitionOptions): void {
  const chat = getChatSession(chatId);
  if (!chat) return;

  if (chat.stage === newStage && chat.sub_stage === newSubStage && !options?.errorType) {
    return;
  }

  const updateData: { stage: string; sub_stage: string; sub_stage_pre_error?: string; error_type?: string } = {
    stage: newStage,
    sub_stage: newSubStage,
  };

  if (newSubStage !== 'error') {
    updateData.sub_stage_pre_error = newSubStage;
  }

  if (newSubStage === 'error' && options?.errorType) {
    updateData.error_type = options.errorType;
  }

  const updated = updateChatSession(chatId, updateData);
  if (updated) {
    console.log(`[workflow] Chat ${chatId} transitioned to stage=${newStage}, sub_stage=${newSubStage}`);

    wsManager.broadcastToProject(updated.project_id, {
      type: 'chat_updated',
      chatId: chatId,
      stage: newStage,
      sub_stage: newSubStage,
      sub_stage_pre_error: updated.sub_stage_pre_error,
      error_type: updated.error_type,
    });

    const broadcastPayload: Record<string, unknown> = {
      type: 'sub_stage',
      sub_stage: newSubStage,
    };
    if (newSubStage === 'error' && options?.errorType) {
      broadcastPayload.errorType = options.errorType;
    }

    stageWsManager.broadcastToStage(chatId, newStage, broadcastPayload);

    updateChatSession(chatId, { running: false });

    if (newSubStage !== 'error' && (newStage !== 'verify' || (newStage === 'verify' && newSubStage === 'analysis'))) {
      setImmediate(() => {
        const currentChat = getChatSession(chatId);
        if (currentChat && currentChat.running) {
          console.log(`[workflow] Chat ${chatId} is already running - skipping`);
          return;
        }
        runWorkflow(chatId);
      });
    }
  }
}

export { handleInit } from './stage-init';
export { handleAnalyzing } from './stage-analyzing';
export { handleCollecting } from './stage-collecting';
export { handleDomain } from './stage-domain';
export { handleFinalAssessment } from './stage-final-assessment';
export { handleRequirement } from './stage-requirement';
export { handlePlan } from './stage-plan';
export { handleVerify } from './stage-verify';