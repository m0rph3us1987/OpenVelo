import { createServer, type IncomingMessage, type ServerResponse } from 'http';
import path from 'path';
import { execSync } from 'child_process';
import fs from 'fs';
import net from 'net';
import { WebSocketServer, WebSocket } from 'ws';
import express from 'express';
import cors from 'cors';
import multer from 'multer';
import { apiRouter } from './src/api/router';
import {
    registerOrchestrator,
    getOrchestrator,
    removeOrchestrator,
} from './src/lib/orch-registry';
import { wsManager, WsKeys } from './src/lib/websocket-manager';
import { stageWsManager, StageWsKeys } from './src/lib/stage-ws-manager';
import {
    initDb,
    getProject,
    getJob,
    getProjectModels,
    markProjectStopped,
    markProjectRunning,
    getRunningJobsByProject,
    resetAllRunningJobs,
    resetAllRunningChatSessions,
    updateJobRunning,
    updateJobCompleted,
    updateJobFailed,
    updateJobStopped,
    updateJobStage,
    incrementJobRetry,
    updateJobContainerId,
    setJobStatus,
    setJobStarted,
    getUiSetting,
    getUserById,
    getChatSession,
    getNextRunnableJobs,
    setJobsRunning,
    refreshModels,
    isUserAuthorizedForProject,
    updateJob,
    resetJob,
    insertLocalJob,
    getDb,
} from './src/lib/db';
import { verifyJwt } from './src/lib/auth';
import { getSessionSecret } from './src/lib/session';
import type { User, JobStatus } from './src/lib/types';
import { resolvePendingStateRequest } from './src/lib/job-state';
import { resolvePendingAgentStatusRequest } from './src/lib/agent-status';
import { assertGbfsInstalled } from './src/lib/gbfs-check';

// ── gbfs availability check ──────────────────────────────────────────────────
// gbfs is a hard runtime dependency: every code path that talks to the
// orchestrator / agent / tester ends up needing it. Fail fast at startup
// rather than letting a missing binary surface deep inside a workflow.
assertGbfsInstalled('web-ui');

function parseSqliteDate(dateStr: string | null | undefined): Date | null {
    if (!dateStr) return null;
    let normalized = dateStr;
    if (!normalized.includes('T') && !normalized.includes('Z')) {
        normalized = normalized.replace(' ', 'T') + 'Z';
    }
    return new Date(normalized);
}

// Ensure all unhandled errors appear in `docker logs` rather than silently disappearing
process.on('uncaughtException', (err) => {
    console.error('[uncaughtException]', err);
});
process.on('unhandledRejection', (reason) => {
    console.error('[unhandledRejection]', reason);
});

// ── Data directory defaults ────────────────────────────────────────────────────
// When no .env is provided, default OPENVELO_DATA_DIR to .\data (Windows) or ./data (Linux).
// All other data-related env vars are derived from it when not explicitly set.
if (!process.env.OPENVELO_DATA_DIR) {
    // Default to <repo-root>/data — two levels up from components/web-ui/server.ts.
    // This matches `./data` relative to the repo root, the same default used by docker-compose.
    process.env.OPENVELO_DATA_DIR = path.join(__dirname, '..', '..', 'data');
}
const dataDir = path.resolve(process.env.OPENVELO_DATA_DIR);
fs.mkdirSync(dataDir, { recursive: true });
if (!process.env.OPENVELO_DB_PATH && !process.env.OLYMP_DB_PATH) {
    process.env.OPENVELO_DB_PATH = path.join(dataDir, 'openvelo.sqlite');
}
if (!process.env.OPENVELO_TEMP_DATA_PATH && !process.env.OLYMP_TEMP_DATA) {
    process.env.OPENVELO_TEMP_DATA_PATH = path.join(dataDir, 'temp_data');
}

console.log(`[startup] Data directory: ${process.env.OPENVELO_DATA_DIR}`);
console.log(`[startup] Temp data directory: ${process.env.OPENVELO_TEMP_DATA_PATH}`);
console.log(`[startup] DB path: ${process.env.OPENVELO_DB_PATH}`);

const port = parseInt(process.env.PORT || '3000', 10);

// Ensure DB is initialised before handling any requests
initDb();

// Reset any RUNNING chat sessions left over from a previous server run
const staleChatSessions = resetAllRunningChatSessions();
if (staleChatSessions > 0) console.log(`[startup] Reset ${staleChatSessions} stale RUNNING chat session(s)`);

// Reset any RUNNING jobs left over from a previous server run — no orchestrators are connected yet
const staleCount = resetAllRunningJobs();
if (staleCount > 0) console.log(`[startup] Reset ${staleCount} stale RUNNING job(s) to PENDING`);

// Express app handles all /api/* routes and serves the Vite SPA
const expressApp = express();
expressApp.use(cors());
expressApp.use(express.json({ limit: '50mb' }));
expressApp.use(express.urlencoded({ extended: true }));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ext === '.md' || ext === '.txt') {
      cb(null, true);
    } else {
      cb(new Error('Only .md and .txt files are accepted'));
    }
  }
});
expressApp.set('upload', upload);

// Request logging — prints every API call to stdout so you're not flying blind
// expressApp.use((req, _res, next) => {
//     console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
//     next();
// });

expressApp.use('/api', apiRouter);

// In production, serve the Vite build output and SPA fallback.
// In dev, Vite runs its own dev server on port 5173 with HMR — no static serving needed here.
if (process.env['NODE_ENV'] === 'production') {
    const distPath = path.join(process.cwd(), 'dist');
    expressApp.use(express.static(distPath));
    expressApp.use((_req, res) => {
        res.sendFile(path.join(distPath, 'index.html'));
    });
}

const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    expressApp(req as express.Request, res as express.Response);
});
// CLI sessions can take up to 2 minutes to start — prevent Node's default 5s socket timeout
server.timeout = 0;
server.keepAliveTimeout = 0;

const wss = new WebSocketServer({ noServer: true });
const orchWss = new WebSocketServer({ noServer: true });

server.on('upgrade', async (req, socket, head) => {
    // console.log(`[UPGRADE] ${req.method} ${req.url}`);

    const url = new URL(req.url ?? '/', `http://localhost`);
    const { pathname } = url;
    const query = Object.fromEntries(url.searchParams) as Record<string, string>;

    if (pathname === '/api/orchestrator/ws') {
        // Orchestrator operates as an internal backend service without user session cookies
        try {
            orchWss.handleUpgrade(req, socket, head, (ws) => {
                handleOrchestratorConnection(ws, query);
            });
        } catch (err) {
            console.error('[UPGRADE] orchWss.handleUpgrade error:', err);
        }
        return;
    }

    const user = await authenticateUpgrade(req);
    if (!user) {
        console.log('[UPGRADE] Authentication failed');
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
        return;
    }

    if (pathname === '/ws') {
        const chatId = parseInt(String(query.chatId ?? '0'));
        const projectId = parseInt(String(query.projectId ?? '0'));
        const jobId = parseInt(String(query.jobId ?? '0'));
        if (!chatId && !projectId && !jobId) { socket.destroy(); return; }

        socket.on('error', (err) => {
            console.error('[WS] Socket error before upgrade:', err.message);
        });

        wss.handleUpgrade(req, socket, head, (ws) => {
            try {
                if (chatId) {
                    wsManager.register(WsKeys.chatKey(chatId), ws);
                    ws.send(JSON.stringify({ type: 'connected', timestamp: new Date().toISOString() }));
                } else if (projectId) {
                    wsManager.register(WsKeys.projectKey(projectId), ws);
                    ws.send(JSON.stringify({ type: 'connected', timestamp: new Date().toISOString() }));
                } else if (jobId) {
                    wsManager.register(WsKeys.jobKey(jobId), ws);
                    ws.send(JSON.stringify({ type: 'connected', timestamp: new Date().toISOString() }));
                }
            } catch (err) {
                console.error('[WS] Error in upgrade callback:', err);
                ws.close();
            }
        });
    } else if (pathname.startsWith('/ws/stage/')) {
        const stage = pathname.replace('/ws/stage/', '');
        const chatId = parseInt(String(query.chatId ?? '0'));
        if (!chatId) { socket.destroy(); return; }

        socket.on('error', (err) => {
            console.error('[StageWS] Socket error before upgrade:', err.message);
        });

        wss.handleUpgrade(req, socket, head, (ws) => {
            try {
                stageWsManager.register(StageWsKeys.stageKey(chatId, stage), ws);
                ws.send(JSON.stringify({ type: 'connected', timestamp: new Date().toISOString() }));

                ws.on('message', (raw: Buffer) => {
                    let data: Record<string, unknown>;
                    try { data = JSON.parse(raw.toString()); } catch { return; }

                    if (data.type === 'get_state') {
                        const chat = getChatSession(chatId);
                        ws.send(JSON.stringify({
                            type: 'sub_stage',
                            sub_stage: chat?.sub_stage ?? '',
                        }));
                    }
                });
            } catch (err) {
                console.error('[StageWS] Error in upgrade callback:', err);
                ws.close();
            }
        });
    } else if (pathname.startsWith('/api/vnc/')) {
        const jobId = parseInt(pathname.replace('/api/vnc/', '').split('/')[0] || '0', 10);
        if (!jobId) {
            console.log('[VNC] Rejecting upgrade: missing jobId');
            socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
            socket.destroy();
            return;
        }
        socket.on('error', (err) => {
            console.error('[VNC] Socket error before upgrade:', err.message);
        });
        handleVncUpgrade(req, socket, head, jobId, user);
    } else {
        socket.destroy();
    }
});

server.listen(port, '0.0.0.0', () => {
    console.log(`> OpenVelo web-ui ready on http://0.0.0.0:${port}`);
    // Refresh models once on startup
    try {
        console.log('[startup] Refreshing available models...');
        const output = execSync('kilo models', { encoding: 'utf-8', timeout: 30000 });
        refreshModels(output);
        console.log('[startup] Models refreshed successfully.');
    } catch (err) {
        console.error('[startup] Failed to refresh models on startup:', err);
    }
});

// Graceful shutdown — stop accepting new connections and exit cleanly on Ctrl+C
function shutdown(sig: string): void {
    console.log(`\n[shutdown] Received ${sig} — closing server...`);
    server.close(() => {
        console.log('[shutdown] HTTP server closed.');
        process.exit(0);
    });
    // Force exit after 5s if graceful shutdown hangs
    setTimeout(() => { console.error('[shutdown] Force exiting.'); process.exit(1); }, 5000);
}

async function authenticateUpgrade(req: IncomingMessage): Promise<User | null> {
    const securityEnabled = getUiSetting('security_enabled') === 'true';
    if (!securityEnabled) {
        return { id: 0, username: 'system', role: 'admin', enabled: true } as User;
    }

    const cookieHeader = req.headers.cookie ?? '';
    const cookies = cookieHeader.split(';').map(c => c.trim().split('='));
    const tokenEntry = cookies.find(([k]) => k === 'openvelo-token');
    const token = tokenEntry?.[1];

    if (!token) return null;

    try {
        const secret = getSessionSecret();
        const payload = await verifyJwt(token, secret);
        const user = getUserById(payload.userId);
        if (!user || !user.enabled) return null;
        return user;
    } catch {
        return null;
    }
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

// -- Ping/pong heartbeat to detect dead orchestrator connections
const PING_INTERVAL_MS = 30_000;

function startHeartbeat(ws: WebSocket, onDead: () => void): ReturnType<typeof setInterval> {
    let alive = true;
    ws.on('pong', () => { alive = true; });
    return setInterval(() => {
        if (!alive) {
            ws.terminate();
            onDead();
            return;
        }
        alive = false;
        if ((ws.readyState as number) === 1) ws.ping();
    }, PING_INTERVAL_MS);
}

// -- Orchestrator connection handler
function handleOrchestratorConnection(ws: WebSocket, query: Record<string, string>): void {
    const projectId = parseInt(String(query.projectId ?? '0'));
    if (!projectId) { ws.close(1008, 'projectId required'); return; }

    console.log(`[ORCH] Orchestrator connected for project ${projectId}`);

    registerOrchestrator(projectId, ws);

    const heartbeat = startHeartbeat(ws, () => {
        console.warn(`[ORCH] Heartbeat failed for project ${projectId} -- treating as dead.`);
        handleOrchestratorDeath(projectId);
    });

    ws.on('message', (raw: Buffer) => {
        let data: Record<string, unknown>;
        try { data = JSON.parse(raw.toString()); } catch { return; }

        const type = data.type as string;
        if (type !== 'log' && type !== 'job_log_chunk') console.log(`[ORCH] Message from project ${projectId}: type=${type}`);

        try {
        if (type === 'hello') {
            const project = getProject(projectId);
            if (project) {
              const models = getProjectModels(projectId);
              const config = {
                ...project,
                execution_model: models.execution_model,
                blueprint_model: models.blueprint_model,
                review_model: models.review_model,
                documentation_model: models.documentation_model,
              };
              ws.send(JSON.stringify({ type: 'configure', config }));
            } else {
                console.error(`[ORCH] Project ${projectId} not found in DB — cannot send configure`);
            }
            // Reset any stale RUNNING jobs from a previous crash
            const staleJobs = getRunningJobsByProject(projectId);
            for (const job of staleJobs) {
                setJobStatus(job.id, 'PENDING');
                updateJobContainerId(job.id, null);
            }
            if (staleJobs.length > 0) {
                console.log(`[ORCH] Reset ${staleJobs.length} stale RUNNING job(s) for project ${projectId}`);
            }
        }

        if (type === 'ready') {
            // No-op in pull model - orchestrator polls via get_next_jobs
        }

        if (type === 'get_next_jobs') {
            const count = (data.count as number) || 1;
            const jobs = getNextRunnableJobs(projectId, count);
            if (jobs.length > 0) {
                const jobIds = jobs.map(j => j.id);
                setJobsRunning(jobIds);
            }
            const project = getProject(projectId);
            const implementerImage = project?.docker_image || 'openvelo-agent:linux';
            const testerImage = project?.docker_image_tester || 'openvelo-tester:linux';
            const jobsWithDispatch = jobs.map((j) => {
                const jobType = j.type === 'test' ? 'test' : 'implementation';
                return {
                    id: j.id,
                    title: j.title,
                    description: j.description,
                    retry_count: j.retry_count,
                    type: jobType,
                    docker_image: jobType === 'test' ? testerImage : implementerImage,
                    passed_tests: (j as any).passed_tests || null,
                };
            });
            ws.send(JSON.stringify({ type: 'job_list', jobs: jobsWithDispatch }));
        }

        if (type === 'job_update') {
            const jobId = data.jobId as number;
            const status = data.status as string;

            if (status === 'RUNNING') {
                if (data.containerId) {
                    // Latch the tester's view-only VNC port (if any) at the
                    // moment the container comes up, so the modal can show
                    // a `vnc://localhost:<port>` link while the test runs.
                    // A subsequent stage update for the same RUNNING job
                    // typically omits vncHostPort; we want to keep the
                    // first value, which is exactly what updateJobRunning
                    // does when vncHostPort is 0/undefined.
                    const vnc = typeof data.vncHostPort === 'number' ? data.vncHostPort : 0;
                    updateJobRunning(
                        jobId,
                        data.containerId as string,
                        data.startedAt as string | undefined,
                        vnc,
                    );
                } else {
                    // Only set started_at if not already set (stage updates don't reset the timer)
                    const existingJob = getJob(jobId);
                    if (!existingJob?.started_at) {
                        setJobStarted(jobId);
                    }
                }
                if (data.stage) {
                    updateJobStage(
                        jobId,
                        data.stage as string,
                        data.agentAttempt as number | undefined,
                        data.agentMaxRetries as number | undefined,
                    );
                }
            } else if (status === 'COMPLETED') {
                const completedJob = getJob(jobId);
                const d = parseSqliteDate(completedJob?.started_at);
                const startedAt = d ? d.getTime() : Date.now();
                const runtimeSeconds = Math.floor((Date.now() - startedAt) / 1000);
                updateJobCompleted(jobId, data.branch as string | undefined, runtimeSeconds);

                // Save verdict, summary, and passed_tests to database
                if (data.verdict || data.summary || data.passed_tests !== undefined) {
                    updateJob(jobId, {
                        verdict: data.verdict as string | null,
                        summary: data.summary as string | null,
                        passed_tests: data.passed_tests as string | null,
                    });
                }

                // Check if this was a failing test job that requires self-healing
                if (completedJob && completedJob.type === 'test' && data.verdict === 'fail') {
                    console.log(`[ORCH-HEAL] Test job ${jobId} failed. Spawning implementation fix job.`);
                    
                    // Find the original implementation job
                    const implJobId = completedJob.implements_job_id;
                    const implJob = implJobId ? getJob(implJobId) : null;

                    // Determine name of new implementation job (numeric versioning: e.g., Job 1.00 -> Job 1.01)
                    let baseTitle = implJob ? implJob.title : completedJob.title.replace(/^Test:\s*/i, '');
                    // Strip off legacy "-A" suffixes and any trailing version indicator " 1.\d\d"
                    baseTitle = baseTitle.replace(/-A$/, '').replace(/\s+1\.\d{2}$/, '').trim();

                    const db = getDb();
                    const existingJobs = db.prepare(
                        "SELECT title FROM jobs WHERE project_id = ? AND title LIKE ?"
                    ).all(completedJob.project_id, `${baseTitle}%`) as { title: string }[];

                    let maxIndex = -1;
                    const suffixRegex = /\s+1\.(\d{2})$/;
                    for (const ej of existingJobs) {
                        const match = ej.title.match(suffixRegex);
                        if (match) {
                            const val = parseInt(match[1], 10);
                            if (val > maxIndex) {
                                maxIndex = val;
                            }
                        }
                    }

                    let newSuffix = '1.00';
                    if (maxIndex !== -1) {
                        const nextVal = Math.min(99, maxIndex + 1);
                        newSuffix = `1.${String(nextVal).padStart(2, '0')}`;
                    }

                    const newTitle = `${baseTitle} ${newSuffix}`;

                    // Create Implementation Job A-A with failed verdict summary as instructions
                    const newImplJob = insertLocalJob(completedJob.project_id, {
                        title: newTitle,
                        description: data.summary || 'Fix negative verdict from test run.',
                        dependsOn: [],
                        type: 'implementation',
                    });

                    // Make original Test Job A depend on Implementation Job A-A and reset it to PENDING
                    resetJob(jobId, true);
                    updateJob(jobId, {
                        depends_on: JSON.stringify([String(newImplJob.id)]),
                        implements_job_id: newImplJob.id,
                    });

                    // Broadcast updates so UI refreshes immediately
                    wsManager.broadcast(WsKeys.projectKey(projectId), {
                        type: 'job_update',
                        jobId: newImplJob.id,
                        status: 'PENDING',
                        timestamp: new Date().toISOString(),
                    });
                    wsManager.broadcast(WsKeys.projectKey(projectId), {
                        type: 'job_update',
                        jobId: jobId,
                        status: 'PENDING',
                        timestamp: new Date().toISOString(),
                    });
                }
            } else if (status === 'FAILED') {
                const failedJob = getJob(jobId);
                const d = parseSqliteDate(failedJob?.started_at);
                const startedAt = d ? d.getTime() : Date.now();
                const runtimeSeconds = Math.floor((Date.now() - startedAt) / 1000);
                updateJobFailed(jobId, runtimeSeconds);

                // Save verdict, summary, and passed_tests to database
                if (data.verdict || data.summary || data.passed_tests !== undefined) {
                    updateJob(jobId, {
                        verdict: data.verdict as string | null,
                        summary: data.summary as string | null,
                        passed_tests: data.passed_tests as string | null,
                    });
                }
            } else if (status === 'STOPPED') {
                const stoppedJob = getJob(jobId);
                const d = parseSqliteDate(stoppedJob?.started_at);
                const startedAt = d ? d.getTime() : Date.now();
                const runtimeSeconds = Math.floor((Date.now() - startedAt) / 1000);
                updateJobStopped(jobId, runtimeSeconds);
                // User-initiated stop: clear container_id so the modal no
                // longer points at a container the orchestrator has torn down.
                updateJobContainerId(jobId, null);
            } else if (status === 'PENDING') {
                setJobStatus(jobId, 'PENDING');
                // Don't clear container_id on retry-driven PENDING: the
                // previous (failed) attempt's container is retained on the
                // Docker host and we want the modal to still link to its
                // logs. The container_id will be overwritten by the next
                // attempt's RUNNING update.
            }

            wsManager.broadcast(WsKeys.projectKey(projectId), { ...data, type: 'job_update' });
        }

        if (type === 'job_retry') {
            const jobId = data.jobId as number;
            const project = getProject(projectId);
            const maxRetries = project?.max_retries ?? 3;
            const newCount = incrementJobRetry(jobId);

            if (newCount < maxRetries) {
                console.log(`[ORCH] Job ${jobId} retry ${newCount}/${maxRetries} -- rescheduling.`);
                wsManager.broadcast(WsKeys.projectKey(projectId), {
                    type: 'job_update',
                    jobId,
                    status: 'PENDING',
                    retryCount: newCount,
                    timestamp: new Date().toISOString(),
                });
            } else {
                console.log(`[ORCH] Job ${jobId} exceeded max retries (${maxRetries}). Marking FAILED.`);
                updateJobFailed(jobId);
                wsManager.broadcast(WsKeys.projectKey(projectId), {
                    type: 'job_update',
                    jobId,
                    status: 'FAILED',
                    retryCount: newCount,
                    timestamp: new Date().toISOString(),
                });
            }
        }

        if (type === 'log') {
            const jobId = data.jobId as number;
            const message = data.message as string;
            const logType = data.logType as string || 'info';
            wsManager.broadcast(WsKeys.projectKey(projectId), { type: 'log', jobId, message, logType, timestamp: new Date().toISOString() });
        }

        if (type === 'job_log_chunk') {
            const jobId = data.jobId as number;
            const chunk = data.chunk as string;
            const logType = data.logType as string || 'stdout';
            wsManager.broadcast(WsKeys.jobKey(jobId), {
                type: 'chunk',
                chunk,
                logType,
                timestamp: new Date().toISOString()
            });
        }

        if (type === 'job_state') {
            const jobId = data.jobId as number;
            const state = (data.state as JobStatus | null) ?? null;
            const plan = (data.plan as JobStatus['plan'] | null) ?? null;
            const usage = (data.usage as JobStatus['usage'] | null) ?? null;
            if (state) {
                if (plan) state.plan = plan;
                if (usage) state.usage = usage;
            }
            resolvePendingStateRequest(jobId, state, plan, usage);
        }

        if (type === 'job_agent_status') {
            const jobId = data.jobId as number;
            const state = (data.state as JobStatus | null) ?? null;
            const plan = (data.plan as JobStatus['plan'] | null) ?? null;
            const usage = (data.usage as JobStatus['usage'] | null) ?? null;
            resolvePendingAgentStatusRequest(jobId, state, plan, usage);
        }

        if (type === 'job_plan_update') {
            wsManager.broadcast(WsKeys.projectKey(projectId), data);
        }

        if (type === 'job_usage_update') {
            wsManager.broadcast(WsKeys.projectKey(projectId), data);
        }

        if (type === 'goodbye') {
            // Reset any still-RUNNING jobs to PENDING before removing the orchestrator
            const runningJobs = getRunningJobsByProject(projectId);
            for (const job of runningJobs) {
                setJobStatus(job.id, 'PENDING');
                updateJobContainerId(job.id, null);
            }
            removeOrchestrator(projectId);
            wsManager.broadcast(WsKeys.projectKey(projectId), {
                type: 'orchestrator_stopped',
                projectId,
                timestamp: new Date().toISOString(),
            });
        }
        } catch (err) {
            console.error(`[ORCH] Error processing message type=${type} for project ${projectId}:`, err);
        }
    });

    ws.on('close', () => {
        clearInterval(heartbeat);
        if (getOrchestrator(projectId) === ws) {
            console.log(`[ORCH] Orchestrator for project ${projectId} disconnected unexpectedly.`);
            handleOrchestratorDeath(projectId);
        }
    });

    ws.on('error', (err) => {
        console.error(`[ORCH] Error for project ${projectId}:`, (err as Error).message);
    });
}

function handleOrchestratorDeath(projectId: number): void {
    removeOrchestrator(projectId);
    markProjectStopped(projectId);
    const runningJobs = getRunningJobsByProject(projectId);
    for (const job of runningJobs) {
        setJobStatus(job.id, 'PENDING');
        updateJobContainerId(job.id, null);
    }
    wsManager.broadcast(WsKeys.projectKey(projectId), {
        type: 'orchestrator_stopped',
        projectId,
        timestamp: new Date().toISOString(),
    });
}

// -- VNC proxy: websockify-style bridge between a browser noVNC client and the
// tester's x11vnc TCP port. The browser authenticates via the standard cookie
// and the port is looked up server-side from Job.vnc_host_port; the client never
// sees the port directly. We deliberately do not parse the RFB protocol — noVNC
// speaks it natively; this handler is a dumb bidirectional byte pipe.
const VNC_TCP_CONNECT_TIMEOUT_MS = 5_000;
const VNC_WS_HEARTBEAT_MS = 5_000;

function resolveVncDialHost(): string {
    // When web-ui runs inside Docker (default docker-compose setup), the
    // tester's published VNC port lives on the Docker host, not inside this
    // container. docker-compose adds `host.docker.internal:host-gateway` to
    // the web-ui service's extra_hosts, so it resolves correctly.
    if (process.env.OPENVELO_CONTAINER_MODE === 'true') {
        return 'host.docker.internal';
    }
    return '127.0.0.1';
}

function rejectVncUpgrade(socket: import('net').Socket, status: number, reason: string): void {
    const reasonText = reason.replace(/[\r\n]/g, ' ');
    socket.write(`HTTP/1.1 ${status} ${reasonText}\r\nConnection: close\r\n\r\n`);
    socket.destroy();
}

function handleVncUpgrade(
    req: IncomingMessage,
    socket: import('net').Socket,
    head: Buffer,
    jobId: number,
    user: User,
): void {
    const job = getJob(jobId);
    if (!job) {
        console.log(`[VNC] Rejecting jobId=${jobId} for user ${user.username}: not found`);
        rejectVncUpgrade(socket, 404, 'Not Found');
        return;
    }
    const projectId = job.project_id;
    if (projectId == null) {
        rejectVncUpgrade(socket, 409, 'Conflict');
        return;
    }
    if (user.role !== 'admin' && !isUserAuthorizedForProject(user.id, projectId)) {
        console.log(`[VNC] Rejecting jobId=${jobId}: user ${user.username} not authorized for project ${projectId}`);
        rejectVncUpgrade(socket, 403, 'Forbidden');
        return;
    }
    if (!job.vnc_host_port || job.vnc_host_port <= 0) {
        rejectVncUpgrade(socket, 409, 'Conflict: VNC not available for this job');
        return;
    }
    if (job.status !== 'RUNNING') {
        rejectVncUpgrade(socket, 409, 'Conflict: job is not running');
        return;
    }

    const dialHost = resolveVncDialHost();
    const dialPort = job.vnc_host_port;
    console.log(`[VNC] User ${user.username} -> job ${jobId} (tcp ${dialHost}:${dialPort})`);

    // Manual WS upgrade: we don't go through wss.handleUpgrade because we want
    // a local ws object that is not registered with any broadcast manager —
    // this is a 1:1 proxy, no fan-out.
    const wssLocal = new WebSocketServer({ noServer: true });
    try {
        wssLocal.handleUpgrade(req, socket, head, (ws) => {
            proxyVncBytes(ws, dialHost, dialPort);
            // Once we own the ws, wssLocal has no further work.
            wssLocal.close();
        });
    } catch (err) {
        console.error('[VNC] handleUpgrade error:', err);
        try { socket.destroy(); } catch {}
    }
}

function proxyVncBytes(ws: WebSocket, host: string, port: number): void {
    const tcp = net.createConnection({ host, port, timeout: VNC_TCP_CONNECT_TIMEOUT_MS });
    let opened = false;
    let wsClosed = false;
    let tcpClosed = false;

    const closeBoth = (code: number, reason: string): void => {
        try { ws.close(code, reason); } catch {}
        try { tcp.destroy(); } catch {}
    };

    tcp.on('connect', () => {
        opened = true;
        tcp.setTimeout(0);
        // Enable TCP keepalive so the backend→x11vnc NAT translation
        // (Docker userland-proxy, cloud VPC, etc.) doesn't get culled by
        // an idle timeout. Without this, a static remote screen means no
        // bytes flow on the upstream leg and the connection can drop
        // within 1-2 seconds. The interval/window values are small
        // because we want a fast response to NAT expiry; the OS still
        // gates actual probes by default TCP_KEEPCNT (~9), so a healthy
        // network incurs no extra traffic.
        try {
            tcp.setKeepAlive(true, 2_000);   // idle before first probe
            tcp.setNoDelay(true);             // keep small frames flowing
        } catch (err) {
            console.warn('[VNC] failed to set keepalive:', err);
        }
        try {
            ws.send(JSON.stringify({ type: 'connected', port }));
        } catch (err) {
            console.error('[VNC] ws.send connected failed:', err);
        }
    });

    tcp.on('timeout', () => {
        console.warn(`[VNC] TCP connect timeout to ${host}:${port}`);
        closeBoth(1011, 'vnc_unreachable');
    });

    tcp.on('error', (err) => {
        // Fail-fast before WS upgrade: surface a 502-style close code so noVNC
        // shows a meaningful error instead of a generic "disconnected".
        console.warn(`[VNC] TCP error to ${host}:${port}:`, err.message);
        try {
            if (!opened) {
                try { ws.send(JSON.stringify({ type: 'error', reason: 'vnc_unreachable' })); } catch {}
            }
        } catch {}
        closeBoth(1011, 'vnc_unreachable');
    });

    tcp.on('data', (chunk: Buffer) => {
        if (ws.readyState !== ws.OPEN) {
            tcp.destroy();
            return;
        }
        try {
            ws.send(chunk, { binary: true });
        } catch (err) {
            console.error('[VNC] ws.send binary failed:', err);
        }
    });

    tcp.on('close', () => {
        tcpClosed = true;
        if (!wsClosed) {
            try { ws.close(1000, 'vnc_closed'); } catch {}
        }
    });

    // Heartbeat: use ws ping/pong to detect a dead browser behind a NAT.
    let alive = true;
    ws.on('pong', () => { alive = true; });
    const heartbeat = setInterval(() => {
        if (!alive) {
            console.warn(`[VNC] WebSocket heartbeat failed; terminating`);
            try { ws.terminate(); } catch {}
            try { tcp.destroy(); } catch {}
            return;
        }
        alive = false;
        if ((ws.readyState as number) === 1) ws.ping();
    }, VNC_WS_HEARTBEAT_MS);

    ws.on('message', (raw: Buffer | Array<Buffer> | Buffer[]) => {
        alive = true;
        // Combine frames: ws.emit('message', ...) gives either a single Buffer
        // (binary RFB chunks) or an Array<Buffer> when the underlying ws
        // library coalesces multiple fragmented frames.
        const buf: Buffer = Array.isArray(raw) ? Buffer.concat(raw) : (raw as Buffer);
        // Application-level keepalive from the browser is a JSON text frame
        // (`{"type":"ping"}`). We must NOT forward these to x11vnc — that
        // would corrupt the RFB stream. The browser emits them every ~10 s so
        // NATs / proxies / Docker's userland port forwarding don't tear down
        // an idle WebSocket. Without this the VNC stream dies every ~30 s
        // when the remote screen is static.
        if (buf.length > 0 && buf[0] === 0x7B /* '{' */) {
            handleAppFrame(ws, buf);
            return;
        }
        forwardToVnc(tcp, ws, buf, closeBoth);
    });

    const cleanup = (): void => {
        clearInterval(heartbeat);
        try { ws.terminate(); } catch {}
        try { tcp.destroy(); } catch {}
    };

    ws.on('close', () => {
        wsClosed = true;
        if (!tcpClosed) tcp.destroy();
        cleanup();
    });

    ws.on('error', (err) => {
        console.error('[VNC] ws error:', (err as Error).message);
        cleanup();
    });
}

// Inspect a text frame from the browser and either reply to keepalive pings
// or silently drop known JSON application messages. Anything unparseable is
// ignored — never forwarded to x11vnc.
function handleAppFrame(ws: WebSocket, buf: Buffer): void {
    let msg: { type?: string } | null = null;
    try {
        msg = JSON.parse(buf.toString('utf-8')) as { type?: string };
    } catch {
        // Could be a non-JSON text frame — ignore silently.
        return;
    }
    if (msg && msg.type === 'ping') {
        try {
            if ((ws.readyState as number) === 1) {
                ws.send(JSON.stringify({ type: 'pong' }));
            }
        } catch (err) {
            console.error('[VNC] ws.send pong failed:', err);
        }
    }
    // All other JSON frames (e.g. our own `{type:"connected"}` never lands
    // here because the server is the sender; future app-level messages would
    // be added as additional cases).
}

function forwardToVnc(
    tcp: net.Socket,
    ws: WebSocket,
    buf: Buffer,
    closeBoth: (code: number, reason: string) => void,
): void {
    if (tcp.destroyed) {
        closeBoth(1006, 'tcp_closed');
        return;
    }
    tcp.write(buf);
    // Touching `ws` here would just be a no-op; included for symmetry / type
    // alignment.
    void ws;
}