import { WebSocket } from 'ws';
import { CONFIG } from './config.js';
import { dockerManager } from './docker.js';
import { send } from './ws-client.js';
import {
    initJobStatus,
    updateJobStatusStage,
    incrementJobStatusRetry,
    getJobStatus,
    setJobPlan,
    updateJobUsage,
    type PlanEntry,
    type UsageSnapshot,
} from './job-status.js';

const activeAgents = new Map<number, WebSocket>();
const stoppedJobs = new Set<number>();

export let wssShuttingDown = false;
export function setWssShuttingDown(value: boolean) {
    wssShuttingDown = value;
}

export function markJobAsStoppedByUser(jobId: number): void {
    stoppedJobs.add(jobId);
    const ws = activeAgents.get(jobId);
    if (ws) {
        ws.close();
    }
}

export async function checkpointAllAgents(): Promise<void> {
    const pending: Promise<void>[] = [];
    for (const [jobId, ws] of activeAgents.entries()) {
        if (ws.readyState !== ws.OPEN) continue;
        pending.push(new Promise<void>((resolve) => {
            const grace = setTimeout(() => {
                console.warn(`[JOB ${jobId}] Checkpoint grace period elapsed.`);
                ws.off('message', listener);
                resolve();
            }, 60_000);

            const listener = (data: unknown) => {
                try {
                    const payload = JSON.parse(data as string) as { type?: string };
                    if (payload.type === 'checkpoint_done') {
                        clearTimeout(grace);
                        ws.off('message', listener);
                        console.log(`[JOB ${jobId}] Checkpoint acknowledged.`);
                        resolve();
                    }
                } catch { /* ignore */ }
            };
            ws.on('message', listener);
            ws.send(JSON.stringify({ type: 'checkpoint' }));
        }));
    }
    await Promise.all(pending);
}

export async function connectToAgent(jobId: number, containerId: string, host: string, port: number, jobTitle: string = '', story?: string, retryCount: number = 0): Promise<void> {
    const url = `ws://${host}:${port}`;
    initJobStatus(jobId, new Date().toISOString(), CONFIG.MAX_RETRIES + 1, retryCount);
    let retries = 0;
    const maxRetries = 10;
    const delay = 1000;

    let ws: WebSocket | null = null;
    let finishedCleanly = false;
    let jobStatus = 'unknown';

    let countdown = CONFIG.AGENT_MAX_TIMEOUT;
    let intervalId: ReturnType<typeof setInterval> | null = null;

    const clearCountdown = () => {
        if (intervalId !== null) {
            clearInterval(intervalId);
            intervalId = null;
        }
    };

    const handleInactivityTimeout = async () => {
        console.warn(`[JOB ${jobId}] Agent inactivity timeout reached.`);
        finishedCleanly = true;
        clearCountdown();

        // Try sending checkpoint
        await new Promise<void>((resolve) => {
            const grace = setTimeout(() => {
                console.warn(`[JOB ${jobId}] Checkpoint grace period elapsed.`);
                resolve();
            }, 60_000);

            const checkpointListener = (data: unknown) => {
                try {
                    const payload = JSON.parse(data as string) as { type?: string };
                    if (payload.type === 'checkpoint_done') {
                        clearTimeout(grace);
                        if (ws) ws.off('message', checkpointListener);
                        resolve();
                    }
                } catch { /* ignore */ }
            };
            if (ws) {
                ws.on('message', checkpointListener);
                if (ws.readyState === ws.OPEN) {
                    ws.send(JSON.stringify({ type: 'checkpoint' }));
                } else {
                    clearTimeout(grace);
                    resolve();
                }
            } else {
                clearTimeout(grace);
                resolve();
            }
        });

        // Send job_update status FAILED with error
        send({
            type: 'job_update',
            jobId,
            status: 'FAILED',
            error: 'Agent inactivity timeout',
            timestamp: new Date().toISOString(),
        });

        // Check if we can retry
        const status = getJobStatus(jobId);
        const maxRetriesReached = status ? status.attempt >= status.maxAttempts : true;
        if (!maxRetriesReached) {
            incrementJobStatusRetry(jobId);
            send({ type: 'job_retry', jobId });
        } else {
            console.log(`Job ${jobId} reached max retries, not retrying.`);
        }

        if (ws) ws.close();
    };

    const startCountdown = () => {
        clearCountdown();
        countdown = CONFIG.AGENT_MAX_TIMEOUT;
        intervalId = setInterval(async () => {
            countdown--;
            if (countdown <= 0) {
                clearCountdown();
                await handleInactivityTimeout();
            }
        }, 1000);
    };

    const resetCountdown = () => {
        countdown = CONFIG.AGENT_MAX_TIMEOUT;
    };

    startCountdown();

    const connect = (): Promise<WebSocket> => {
        return new Promise((resolve, reject) => {
            console.log(`Attempting to connect to agent at ${url} (Attempt ${retries + 1}/${maxRetries})...`);
            const wsInstance = new WebSocket(url);

            wsInstance.on('open', async () => {
                console.log(`Connected to agent for job ${jobId}. Sending handshake...`);
                wsInstance.send(JSON.stringify({
                    type: 'handshake',
                    job_id: jobId,
                    config: {
                        repo_url: CONFIG.REPO_URL,
                        repo_host: CONFIG.REPO_HOST,
                        repo_pat: CONFIG.REPO_PAT,
                        backend: CONFIG.BACKEND,
                        execution_model: CONFIG.BACKEND_MODEL,
                        blueprint_model: CONFIG.BACKEND_BLUEPRINT_MODEL,
                        review_model: CONFIG.BACKEND_REVIEW_MODEL,
                        documentation_model: CONFIG.BACKEND_DOCUMENTATION_MODEL,
                        build_cmd: CONFIG.BUILD_CMD,
                        test_cmd: CONFIG.TEST_CMD,
                        staging_branch: CONFIG.STAGING_BRANCH,
                        job_title: jobTitle,
                        story,
                        agent_max_timeout: CONFIG.AGENT_MAX_TIMEOUT,
                    }
                }));
                resolve(wsInstance);
            });

            wsInstance.on('error', (err) => {
                if (retries < maxRetries) {
                    retries++;
                    setTimeout(() => connect().then(resolve).catch(reject), delay);
                } else {
                    reject(new Error(`Failed to connect to agent after ${maxRetries} attempts: ${err.message}`));
                }
            });
        });
    };

    let wsObj: WebSocket;
    try {
        wsObj = await connect();
        ws = wsObj;
    } catch (err) {
        clearCountdown();
        throw err;
    }

    activeAgents.set(jobId, ws);

    // Return a Promise that resolves only when the WS session ends (close event).
    // This keeps activeContainers populated for the duration of the job so stopAllContainers works.
    return new Promise<void>((resolve) => {
        ws!.on('close', () => {
            clearCountdown();
            activeAgents.delete(jobId);

            if (stoppedJobs.has(jobId)) {
                stoppedJobs.delete(jobId);
                // Stopped by user, do not retry!
                if (CONFIG.REMOVE_DELETED_CONTAINERS) {
                    dockerManager.removeAgent(containerId);
                } else {
                    dockerManager.stopAgent(containerId);
                }
            } else if (finishedCleanly) {
                if (jobStatus === 'success' && CONFIG.REMOVE_DELETED_CONTAINERS) {
                    dockerManager.removeAgent(containerId);
                }
            } else if (!wssShuttingDown) {
                // Leave the failed-attempt container running/present so the
                // user can inspect it with `docker ps -a` / `docker logs` /
                // `docker exec`. Only the next-attempt `job_retry` is sent.
                incrementJobStatusRetry(jobId);
                send({ type: 'job_retry', jobId });
            }

            resolve();
        });

        ws!.on('message', async (data: string) => {
            const payload = JSON.parse(data) as Record<string, unknown>;

            if (payload.type === 'status' || payload.type === 'info' || payload.type === 'error' || payload.type === 'warn' || payload.type === 'stdout' || payload.type === 'stderr') {
                resetCountdown();
                if (payload.type === 'stdout' || payload.type === 'stderr') {
                    send({
                        type: 'job_log_chunk',
                        jobId,
                        chunk: payload.message as string,
                        logType: payload.type,
                    });
                } else {
                    send({
                        type: 'log',
                        jobId,
                        logType: payload.type,
                        message: payload.message,
                    });
                }
            }

            if (payload.type === 'plan') {
                const entries = (payload.entries as PlanEntry[] | undefined) ?? [];
                setJobPlan(jobId, entries);
                send({
                    type: 'job_plan_update',
                    jobId,
                    entries,
                    timestamp: new Date().toISOString(),
                });
            }

            if (payload.type === 'usage') {
                const usage = (payload.usage as Partial<UsageSnapshot> | undefined) ?? {};
                const snapshot = updateJobUsage(jobId, usage);
                send({
                    type: 'job_usage_update',
                    jobId,
                    totalTokens: snapshot.totalTokens,
                    inputTokens: snapshot.inputTokens,
                    outputTokens: snapshot.outputTokens,
                    cachedReadTokens: snapshot.cachedReadTokens,
                    cachedWriteTokens: snapshot.cachedWriteTokens,
                    cost: snapshot.cost,
                    timestamp: new Date().toISOString(),
                });
            }

            if (payload.type === 'context') {
                const patch: Partial<UsageSnapshot> = {};
                if (typeof payload.used === 'number') patch.used = payload.used;
                if (typeof payload.size === 'number') patch.size = payload.size;
                const cost = payload.cost as { amount: number; currency: string } | undefined;
                if (cost && typeof cost === 'object') patch.cost = cost;
                const snapshot = updateJobUsage(jobId, patch);
                send({
                    type: 'job_usage_update',
                    jobId,
                    used: snapshot.used,
                    size: snapshot.size,
                    cost: snapshot.cost,
                    timestamp: new Date().toISOString(),
                });
            }

            if (payload.type === 'stage') {
                console.log(`[JOB ${jobId}] [STAGE] ${payload.stage}`);
                const jobStatus = updateJobStatusStage(
                    jobId,
                    payload.stage as string,
                    payload.attempt as number,
                    payload.max_retries as number
                );
                send({
                    type: 'job_update',
                    jobId,
                    status: 'RUNNING',
                    stage: payload.stage,
                    agentAttempt: payload.attempt,
                    agentMaxRetries: payload.max_retries,
                    startDateTime: jobStatus?.startDateTime,
                    attempt: jobStatus?.attempt,
                    maxAttempts: jobStatus?.maxAttempts,
                    timestamp: new Date().toISOString(),
                });
            }

            if (payload.type === 'finish') {
                clearCountdown();
                finishedCleanly = true;
                jobStatus = payload.status as string;
                console.log(`Job ${jobId} finished with status: ${payload.status}`);

                if (payload.status !== 'success') {
                    send({
                        type: 'job_update',
                        jobId,
                        status: 'FAILED',
                        error: payload.error,
                        timestamp: new Date().toISOString(),
                    });
                    if (!payload.maxRetriesReached) {
                        incrementJobStatusRetry(jobId);
                        send({ type: 'job_retry', jobId });
                    } else {
                        console.log(`Job ${jobId} reached max retries, not retrying.`);
                    }
                    ws!.close();
                    return;
                }

                send({
                    type: 'job_update',
                    jobId,
                    status: 'COMPLETED',
                    branch: payload.branch,
                    timestamp: new Date().toISOString(),
                });

                ws!.close();
            }
        });
    });
}
