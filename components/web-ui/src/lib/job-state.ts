import type { WebSocket } from 'ws';
import type { JobStatus, JobStatusPlanEntry, JobStatusUsage } from './types';

const STATE_REQUEST_TIMEOUT_MS = 3000;

export interface JobStateResponse {
    state: JobStatus | null;
    plan: JobStatusPlanEntry[] | null;
    usage: JobStatusUsage | null;
}

type Resolver = (response: JobStateResponse) => void;
const pendingStateRequests = new Map<number, Resolver>();

export function resolvePendingStateRequest(
    jobId: number,
    state: JobStatus | null,
    plan: JobStatusPlanEntry[] | null = null,
    usage: JobStatusUsage | null = null,
): boolean {
    const resolver = pendingStateRequests.get(jobId);
    if (!resolver) return false;
    pendingStateRequests.delete(jobId);
    resolver({ state, plan, usage });
    return true;
}

export function requestJobState(ws: WebSocket, jobId: number): Promise<JobStateResponse> {
    return new Promise((resolve) => {
        const existing = pendingStateRequests.get(jobId);
        if (existing) {
            pendingStateRequests.delete(jobId);
            existing({ state: null, plan: null, usage: null });
        }
        const timer = setTimeout(() => {
            if (pendingStateRequests.get(jobId) === resolve) {
                pendingStateRequests.delete(jobId);
                resolve({ state: null, plan: null, usage: null });
            }
        }, STATE_REQUEST_TIMEOUT_MS);
        pendingStateRequests.set(jobId, (response) => {
            clearTimeout(timer);
            resolve(response);
        });
        try {
            ws.send(JSON.stringify({ type: 'get_job_state', jobId }));
        } catch {
            clearTimeout(timer);
            pendingStateRequests.delete(jobId);
            resolve({ state: null, plan: null, usage: null });
        }
    });
}
