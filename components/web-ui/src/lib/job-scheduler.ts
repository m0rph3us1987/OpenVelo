import { getProject, getRunningJobsByProject, getPendingJobsByProject, setJobStarted, getJobsByProject } from './db';
import { sendToOrchestrator, isOrchestratorConnected } from './orch-registry';
import type { Job } from './types';

// Per-project lock — prevents concurrent scheduleJobs calls from double-dispatching the same job
const schedulingLocks = new Set<number>();

export async function scheduleJobs(projectId: number): Promise<void> {
    if (schedulingLocks.has(projectId)) return;
    schedulingLocks.add(projectId);
    try {
        await _scheduleJobs(projectId);
    } finally {
        schedulingLocks.delete(projectId);
    }
}

async function _scheduleJobs(projectId: number): Promise<void> {
    if (!isOrchestratorConnected(projectId)) return;

    const project = getProject(projectId);
    if (!project) return;

    const maxParallel = project.max_parallel_jobs ?? 1;
    const runningJobs = getRunningJobsByProject(projectId);
    let runningCount = runningJobs.length;
    if (runningCount >= maxParallel) return;

    const pendingJobs = getPendingJobsByProject(projectId);
    const allJobs = getJobsByProject(projectId);

    for (const job of pendingJobs) {
        if (runningCount >= maxParallel) break;

        // Dependency check (always local mode now)
        if (job.depends_on) {
            let predecessorIds: string[];
            try {
                predecessorIds = JSON.parse(job.depends_on);
            } catch {
                predecessorIds = [job.depends_on];
            }

            let blocked = false;
            for (const predId of predecessorIds) {
                const predJob = allJobs.find((j: Job) => String(j.id) === predId);
                if (!predJob || predJob.status !== 'COMPLETED') {
                    blocked = true;
                    break;
                }
            }
            if (blocked) continue;
        }

        const sent = sendToOrchestrator(projectId, {
            type: 'assign_job',
            job: {
                id: job.id,
                title: job.title,
                description: job.description,
                retry_count: (job as unknown as { retry_count?: number }).retry_count ?? 0,
            },
        });

        if (sent) {
            setJobStarted(job.id);
            runningCount++;
        }
    }
}
