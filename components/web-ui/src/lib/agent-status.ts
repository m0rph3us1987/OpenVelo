import type { WebSocket } from 'ws';
import type { JobStatus, JobStatusPlanEntry, JobStatusUsage } from './types';

const AGENT_STATUS_TIMEOUT_MS = 3000;

export interface AgentStatusResponse {
    state: JobStatus | null;
    plan: JobStatusPlanEntry[] | null;
    usage: JobStatusUsage | null;
}

type Resolver = (response: AgentStatusResponse) => void;
const pendingAgentStatusRequests = new Map<number, Resolver>();

export function resolvePendingAgentStatusRequest(
    jobId: number,
    state: JobStatus | null,
    plan: JobStatusPlanEntry[] | null,
    usage: JobStatusUsage | null,
): boolean {
    const resolver = pendingAgentStatusRequests.get(jobId);
    if (!resolver) return false;
    pendingAgentStatusRequests.delete(jobId);
    resolver({ state, plan, usage });
    return true;
}

export function requestJobAgentStatus(ws: WebSocket, jobId: number): Promise<AgentStatusResponse> {
    return new Promise((resolve) => {
        const existing = pendingAgentStatusRequests.get(jobId);
        if (existing) {
            pendingAgentStatusRequests.delete(jobId);
            existing({ state: null, plan: null, usage: null });
        }
        const timer = setTimeout(() => {
            if (pendingAgentStatusRequests.get(jobId) === resolve) {
                pendingAgentStatusRequests.delete(jobId);
                resolve({ state: null, plan: null, usage: null });
            }
        }, AGENT_STATUS_TIMEOUT_MS);
        pendingAgentStatusRequests.set(jobId, (response) => {
            clearTimeout(timer);
            resolve(response);
        });
        try {
            ws.send(JSON.stringify({ type: 'get_job_agent_status', jobId }));
        } catch {
            clearTimeout(timer);
            pendingAgentStatusRequests.delete(jobId);
            resolve({ state: null, plan: null, usage: null });
        }
    });
}
