import { CONFIG } from './config.js';
import { dockerManager } from './docker.js';
import { connectToAgent } from './wss.js';
import { send } from './ws-client.js';
import { clearJobStatus } from './job-status.js';

export let isPaused = false;
export let isShuttingDown = false;
let activeJobCount = 0;

export function setPaused(value: boolean) {
    isPaused = value;
}

export function setShuttingDown(value: boolean) {
    isShuttingDown = value;
}

export function getActiveJobCount(): number {
    return activeJobCount;
}

export function getMaxParallelJobs(): number {
    return CONFIG.MAX_PARALLEL_JOBS;
}

export interface JobPayload {
    id: number;
    title: string | null;
    description: string | null;
    acceptance_criteria: string | null;
}

// Track container IDs so we can stop them on pause/shutdown
const activeContainers = new Map<number, { containerId: string }>();

// Track jobs currently being processed to prevent duplicate container spawns
const jobsInProgress = new Set<number>();

export async function stopAllContainers(): Promise<void> {
    const stops = [...activeContainers.entries()].map(async ([jobId, { containerId }]) => {
        console.log(`Stopping container ${containerId} (job ${jobId})`);
        await dockerManager.stopAgent(containerId).catch((err) => {
            console.error(`Failed to stop container ${containerId}:`, err);
        });
        send({ type: 'job_update', jobId, status: 'PENDING', containerId: null });
    });
    await Promise.allSettled(stops);
    activeContainers.clear();
}

export async function stopSingleJobContainer(jobId: number): Promise<boolean> {
    const containerInfo = activeContainers.get(jobId);
    if (containerInfo) {
        console.log(`Stopping container ${containerInfo.containerId} for job ${jobId}`);
        await dockerManager.stopAgent(containerInfo.containerId).catch((err) => {
            console.error(`Failed to stop container ${containerInfo.containerId}:`, err);
        });
        activeContainers.delete(jobId);
        return true;
    }
    return false;
}

export async function processSingleJob(job: JobPayload): Promise<void> {
    if (isPaused || isShuttingDown) {
        console.log(`[JOB ${job.id}] Orchestrator is paused/shutting down — ignoring assign_job.`);
        return;
    }

    if (jobsInProgress.has(job.id)) {
        console.log(`[JOB ${job.id}] Job is already being processed — ignoring duplicate.`);
        return;
    }
    jobsInProgress.add(job.id);

    console.log(`[JOB ${job.id}] Starting job for story`);
    activeJobCount++;

    // Notify web-ui we are starting
    send({ type: 'job_update', jobId: job.id, status: 'RUNNING', timestamp: new Date().toISOString() });

    const jobContent = formatJobMarkdownFromJob(job);

    let containerId: string;
    let host: string;
    let port: number;
    try {
        ({ containerId, host, port } = await dockerManager.spawnAgent(job.id));
    } catch (err) {
        console.error(`[JOB ${job.id}] Failed to spawn agent:`, err);
        send({ type: 'job_update', jobId: job.id, status: 'PENDING', containerId: null, timestamp: new Date().toISOString() });
        jobsInProgress.delete(job.id);
        activeJobCount--;
        send({ type: 'ready' });
        return;
    }

    activeContainers.set(job.id, { containerId });

    // Use orchestrator's own time as the start time (more reliable than querying Docker)
    const startedAt = new Date().toISOString();
    send({ type: 'job_update', jobId: job.id, status: 'RUNNING', containerId, startedAt, timestamp: new Date().toISOString() });

    try {
        await connectToAgent(job.id, containerId, host, port, job.title ?? '', jobContent);
    } catch (err) {
        console.error(`[JOB ${job.id}] Agent connection failed:`, err);
        send({ type: 'job_update', jobId: job.id, status: 'FAILED', error: String(err), timestamp: new Date().toISOString() });
    } finally {
        activeContainers.delete(job.id);
        jobsInProgress.delete(job.id);
        activeJobCount--;
        clearJobStatus(job.id);
        // Only signal readiness if not shutting down — prevents re-assigning jobs during stop
        if (!isPaused && !isShuttingDown) {
            send({ type: 'ready' });
        }
    }
}

function formatJobMarkdownFromJob(job: JobPayload): string {
    return `# Job ${job.id}: ${job.title || 'No Title'}\n\n## Description\n${job.description || 'No description provided.'}\n`;
}
