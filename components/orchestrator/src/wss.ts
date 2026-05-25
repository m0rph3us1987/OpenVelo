import { WebSocket } from 'ws';
import { CONFIG } from './config.js';
import { dockerManager } from './docker.js';
import { send } from './ws-client.js';

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

export async function connectToAgent(jobId: number, containerId: string, host: string, port: number, jobTitle: string = '', story?: string): Promise<void> {
    const url = `ws://${host}:${port}`;
    let retries = 0;
    const maxRetries = 10;
    const delay = 1000;

    const connect = (): Promise<WebSocket> => {
        return new Promise((resolve, reject) => {
            console.log(`Attempting to connect to agent at ${url} (Attempt ${retries + 1}/${maxRetries})...`);
            const ws = new WebSocket(url);

            ws.on('open', async () => {
                console.log(`Connected to agent for job ${jobId}. Sending handshake...`);
                ws.send(JSON.stringify({
                    type: 'handshake',
                    job_id: jobId,
                    config: {
                        repo_url: CONFIG.REPO_URL,
                        repo_host: CONFIG.REPO_HOST,
                        repo_pat: CONFIG.REPO_PAT,
                        backend: CONFIG.BACKEND,
                        execution_model: CONFIG.BACKEND_MODEL,
                        build_cmd: CONFIG.BUILD_CMD,
                        test_cmd: CONFIG.TEST_CMD,
                        staging_branch: CONFIG.STAGING_BRANCH,
                        job_title: jobTitle,
                        story,
                    }
                }));
                resolve(ws);
            });

            ws.on('error', (err) => {
                if (retries < maxRetries) {
                    retries++;
                    setTimeout(() => connect().then(resolve).catch(reject), delay);
                } else {
                    reject(new Error(`Failed to connect to agent after ${maxRetries} attempts: ${err.message}`));
                }
            });
        });
    };

    const ws = await connect();
    activeAgents.set(jobId, ws);

    let finishedCleanly = false;
    let jobStatus = 'unknown';
    let inactivityHandle: ReturnType<typeof setTimeout> | null = null;

    const clearInactivity = () => {
        if (inactivityHandle !== null) clearTimeout(inactivityHandle);
    };

    const handleInactivityTimeout = async () => {
        console.warn(`[JOB ${jobId}] No log output for ${CONFIG.AGENT_MAX_TIMEOUT}ms. Sending checkpoint...`);

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
                        ws.off('message', checkpointListener);
                        resolve();
                    }
                } catch { /* ignore */ }
            };
            ws.on('message', checkpointListener);
            if (ws.readyState === ws.OPEN) {
                ws.send(JSON.stringify({ type: 'checkpoint' }));
            } else {
                clearTimeout(grace);
                resolve();
            }
        });

        ws.close();
        // Tell web-ui to retry this job
        send({ type: 'job_retry', jobId });
    };

    const resetInactivityTimer = () => {
        clearInactivity();
        inactivityHandle = setTimeout(handleInactivityTimeout, CONFIG.AGENT_MAX_TIMEOUT);
    };

    resetInactivityTimer();

    // Return a Promise that resolves only when the WS session ends (close event).
    // This keeps activeContainers populated for the duration of the job so stopAllContainers works.
    return new Promise<void>((resolve) => {
        ws.on('close', () => {
            clearInactivity();
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
                dockerManager.stopAgent(containerId);
                send({ type: 'job_retry', jobId });
            }

            resolve();
        });

        ws.on('message', async (data: string) => {
            const payload = JSON.parse(data) as Record<string, unknown>;

            if (payload.type === 'status' || payload.type === 'info' || payload.type === 'error' || payload.type === 'warn' || payload.type === 'stdout' || payload.type === 'stderr') {
                resetInactivityTimer();
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

            if (payload.type === 'stage') {
                resetInactivityTimer();
                console.log(`[JOB ${jobId}] [STAGE] ${payload.stage}`);
                send({
                    type: 'job_update',
                    jobId,
                    status: 'RUNNING',
                    stage: payload.stage,
                    agentAttempt: payload.attempt,
                    agentMaxRetries: payload.max_retries,
                    timestamp: new Date().toISOString(),
                });
            }

            if (payload.type === 'finish') {
                clearInactivity();
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
                    send({ type: 'job_retry', jobId });
                    ws.close();
                    return;
                }

                send({
                    type: 'job_update',
                    jobId,
                    status: 'COMPLETED',
                    branch: payload.branch,
                    timestamp: new Date().toISOString(),
                });

                ws.close();
            }
        });
    });
}
