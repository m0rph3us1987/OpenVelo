import fs from 'fs';
import path from 'path';
import { loggerService } from '@/lib/logger-service';

/**
 * Remove partial artifacts produced by an in-flight plan generation that was
 * cancelled. Called from the /api/chats/:chatId/stop route so the chat's
 * on-disk state matches its UI status and a fresh /resume starts clean.
 */
export function cleanupCancelledPlanArtifacts(chatId: number, chatDir: string, stage: string): void {
  try {
    if (stage === 'plan') {
      const planDir = path.join(chatDir, 'plan');
      if (fs.existsSync(planDir)) {
        for (const file of fs.readdirSync(planDir)) {
          if (file.startsWith('job-') && file.endsWith('.json')) {
            try {
              fs.unlinkSync(path.join(planDir, file));
            } catch { /* ignore */ }
          }
        }
      }
    } else if (stage === 'requirement') {
      const sectionsDir = path.join(chatDir, 'requirement-sections');
      if (fs.existsSync(sectionsDir)) {
        for (const file of fs.readdirSync(sectionsDir)) {
          if (file.startsWith('section-') && file.endsWith('.md')) {
            try {
              fs.unlinkSync(path.join(sectionsDir, file));
            } catch { /* ignore */ }
          }
        }
      }
    }
  } catch (err) {
    loggerService.appendVerbose(chatId, 'workflow:stop', `cleanupCancelledPlanArtifacts failed: ${err}`);
  }
}