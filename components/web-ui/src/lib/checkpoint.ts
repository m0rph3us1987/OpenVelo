import fs from 'fs';
import path from 'path';

export interface PipelineCheckpoint {
  pipeline: string;
  completedSteps: string[];
  currentStep: string | null;
  partialResults: Record<string, unknown>;
  lastActivity: string;
}

function getCheckpointPath(chatDir: string): string {
  return path.join(chatDir, '.pipeline-checkpoint.json');
}

export function writeCheckpoint(chatDir: string, checkpoint: PipelineCheckpoint): void {
  try {
    fs.writeFileSync(getCheckpointPath(chatDir), JSON.stringify(checkpoint, null, 2), 'utf-8');
  } catch { /* ignore */ }
}

export function readCheckpoint(chatDir: string): PipelineCheckpoint | null {
  const p = getCheckpointPath(chatDir);
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf-8')) as PipelineCheckpoint;
  } catch { return null; }
}

export function clearCheckpoint(chatDir: string): void {
  try {
    const p = getCheckpointPath(chatDir);
    if (fs.existsSync(p)) fs.unlinkSync(p);
  } catch { /* ignore */ }
}

export function updateCheckpointStep(
  chatDir: string,
  pipeline: string,
  stepName: string,
  result?: Record<string, unknown>,
): void {
  const existing = readCheckpoint(chatDir) ?? {
    pipeline,
    completedSteps: [],
    currentStep: null,
    partialResults: {},
    lastActivity: new Date().toISOString(),
  };
  if (!existing.completedSteps.includes(stepName)) {
    existing.completedSteps.push(stepName);
  }
  existing.currentStep = stepName;
  existing.lastActivity = new Date().toISOString();
  if (result) {
    existing.partialResults[stepName] = result;
  }
  writeCheckpoint(chatDir, existing);
}
