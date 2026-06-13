export interface PlanEntry {
    content: string;
    status: 'pending' | 'in_progress' | 'completed';
    priority: 'high' | 'medium' | 'low';
}

export interface UsageSnapshot {
    used?: number;
    size?: number;
    totalTokens?: number;
    inputTokens?: number;
    outputTokens?: number;
    cachedReadTokens?: number;
    cachedWriteTokens?: number;
    cost?: { amount: number; currency: string };
}

export interface JobStatus {
    jobId: number;
    startDateTime: string;
    stage: string;
    attempt: number;
    maxAttempts: number;
    agentAttempt?: number;
    agentMaxRetries?: number;
}

const statuses = new Map<number, JobStatus>();
const retryCounts = new Map<number, number>();
const planByJob = new Map<number, PlanEntry[]>();
const usageByJob = new Map<number, UsageSnapshot>();

function computeAttempt(jobId: number): number {
    return (retryCounts.get(jobId) ?? 0) + 1;
}

export function initJobStatus(jobId: number, startedAtIso: string, maxAttempts: number): JobStatus {
    const status: JobStatus = {
        jobId,
        startDateTime: startedAtIso,
        stage: 'pending',
        attempt: computeAttempt(jobId),
        maxAttempts,
    };
    statuses.set(jobId, status);
    return status;
}

export function updateJobStatusStage(jobId: number, stage: string, agentAttempt?: number, agentMaxRetries?: number): JobStatus | undefined {
    const existing = statuses.get(jobId);
    if (!existing) return undefined;
    existing.stage = stage;
    existing.attempt = computeAttempt(jobId);
    if (agentAttempt !== undefined) existing.agentAttempt = agentAttempt;
    if (agentMaxRetries !== undefined) existing.agentMaxRetries = agentMaxRetries;
    return existing;
}

export function getJobStatus(jobId: number): JobStatus | undefined {
    return statuses.get(jobId);
}

export function setJobPlan(jobId: number, entries: PlanEntry[]): void {
    planByJob.set(jobId, entries);
}

export function getJobPlan(jobId: number): PlanEntry[] | undefined {
    return planByJob.get(jobId);
}

export function updateJobUsage(jobId: number, patch: Partial<UsageSnapshot>): UsageSnapshot {
    const existing = usageByJob.get(jobId) ?? {};
    const next: UsageSnapshot = { ...existing, ...patch };
    usageByJob.set(jobId, next);
    return next;
}

export function getJobUsage(jobId: number): UsageSnapshot | undefined {
    return usageByJob.get(jobId);
}

export function clearJobStatus(jobId: number): void {
    statuses.delete(jobId);
    retryCounts.delete(jobId);
    planByJob.delete(jobId);
    usageByJob.delete(jobId);
}

export function incrementJobStatusRetry(jobId: number): number {
    const next = (retryCounts.get(jobId) ?? 0) + 1;
    retryCounts.set(jobId, next);
    const status = statuses.get(jobId);
    if (status) {
        status.attempt = next + 1;
        status.stage = 'pending';
    }
    return next;
}
