import { CONFIG, applyProjectConfig } from './config.js';
import { connect, onMessage, send, getNextJobs } from './ws-client.js';
import { setPaused, setShuttingDown, processSingleJob, stopAllContainers, stopSingleJobContainer, getActiveJobCount, getMaxParallelJobs, isPaused, isShuttingDown } from './workflow.js';
import { checkpointAllAgents, markJobAsStoppedByUser, setWssShuttingDown } from './wss.js';
import { getJobStatus, getJobPlan, getJobUsage } from './job-status.js';
import type { JobPayload } from './workflow.js';
import type { ProjectConfig } from './config.js';

const projectIdArg = process.argv.find(arg => arg.startsWith('--project-id='));
const projectId = projectIdArg
    ? parseInt(projectIdArg.split('=')[1] ?? '0')
    : process.env.PROJECT_ID ? parseInt(process.env.PROJECT_ID) : null;

if (projectId === null || isNaN(projectId)) {
    console.error('Error: --project-id=<id> argument or PROJECT_ID env var is required.');
    process.exit(1);
}

CONFIG.PROJECT_ID = projectId;

console.log('Starting OpenVelo Orchestrator...');
console.log(`Project ID: ${projectId}`);

let configured = false;

onMessage(async (data) => {
    const type = data.type as string;

    if (type === 'configure') {
        console.log(`[CONFIG] Received project configuration from web-ui.`);
        applyProjectConfig(data.config as ProjectConfig);
        configured = true;
        send({ type: 'ready' });
    }

    if (type === 'job_list') {
        const jobs = data.jobs as JobPayload[];
        if (!jobs || jobs.length === 0) {
            return;
        }
        console.log(`[POLL] Received ${jobs.length} job(s) from web-ui`);
        for (const job of jobs) {
            if (getActiveJobCount() >= getMaxParallelJobs()) {
                console.log(`[POLL] Max parallel jobs reached, stopping polling for this cycle`);
                break;
            }
            console.log(`[JOB ${job.id}] Starting job for story`);
            processSingleJob(job).catch(err => console.error('processSingleJob error:', err));
        }
    }

    if (type === 'pause') {
        console.log('[CTRL] Pausing orchestrator...');
        setPaused(true);
        setShuttingDown(true);
        setWssShuttingDown(true);
        await stopAllContainers();
        setShuttingDown(false);
        setWssShuttingDown(false);
        console.log('[CTRL] Orchestrator paused.');
    }

    if (type === 'resume') {
        console.log('[CTRL] Resuming orchestrator...');
        setPaused(false);
    }

    if (type === 'shutdown') {
        console.log('[CTRL] Shutdown requested.');
        setPaused(true);
        setShuttingDown(true);
        setWssShuttingDown(true);
        const checkpoint = data.checkpoint as boolean | undefined;
        if (checkpoint) {
            console.log('[CTRL] Checkpointing agents before shutdown...');
            await checkpointAllAgents().catch(() => {});
        }
        await stopAllContainers();
        send({ type: 'goodbye' });
        console.log('[CTRL] Orchestrator shut down cleanly.');
        setTimeout(() => process.exit(0), 500);
    }

    if (type === 'stop_job') {
        const jobId = data.jobId as number;
        console.log(`[CTRL] Stop requested for job ${jobId}`);
        markJobAsStoppedByUser(jobId);
        await stopSingleJobContainer(jobId);
        send({ type: 'job_update', jobId, status: 'STOPPED', timestamp: new Date().toISOString() });
    }

    if (type === 'get_job_state') {
        const jobId = data.jobId as number;
        const state = getJobStatus(jobId) ?? null;
        const plan = getJobPlan(jobId) ?? null;
        const usage = getJobUsage(jobId) ?? null;
        send({ type: 'job_state', jobId, state, plan, usage });
    }

    if (type === 'get_job_agent_status') {
        const jobId = data.jobId as number;
        const state = getJobStatus(jobId) ?? null;
        const plan = getJobPlan(jobId) ?? null;
        const usage = getJobUsage(jobId) ?? null;
        send({ type: 'job_agent_status', jobId, state, plan, usage });
    }
});

const shutdown = async () => {
    console.log('Received shutdown signal.');
    setPaused(true);
    setShuttingDown(true);
    setWssShuttingDown(true);
    await checkpointAllAgents().catch(() => {});
    await stopAllContainers();
    process.exit(0);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

function pollForJobs(): void {
    if (!configured) return;
    if (isPaused || isShuttingDown) return;

    const activeCount = getActiveJobCount();
    const maxParallel = getMaxParallelJobs();

    if (activeCount >= maxParallel) {
        return;
    }

    const freeSlots = maxParallel - activeCount;
    console.log(`[POLL] Asking for ${freeSlots} job(s) (active=${activeCount}, max=${maxParallel})`);
    getNextJobs(freeSlots);
}

connect(projectId);

setInterval(pollForJobs, 1000);