import { createServer, type IncomingMessage, type ServerResponse } from 'http';
import path from 'path';
import fs from 'fs';
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
import { scheduleJobs } from './src/lib/job-scheduler';
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
} from './src/lib/db';
import { verifyJwt } from './src/lib/auth';
import { getSessionSecret } from './src/lib/session';
import type { User } from './src/lib/types';

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
    } else {
        socket.destroy();
    }
});

server.listen(port, '0.0.0.0', () => {
    console.log(`> OpenVelo web-ui ready on http://0.0.0.0:${port}`);
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
              const resolvedExecutionModel = models.execution_model;
              console.log(`[ORCH] Sending configure for project ${projectId}: resolved execution_model=${resolvedExecutionModel}`);
              const config = { ...project, execution_model: resolvedExecutionModel };
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
            ws.send(JSON.stringify({ type: 'job_list', jobs }));
        }

        if (type === 'job_update') {
            const jobId = data.jobId as number;
            const status = data.status as string;

            if (status === 'RUNNING') {
                if (data.containerId) {
                    updateJobRunning(jobId, data.containerId as string, data.startedAt as string | undefined);
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
            } else if (status === 'FAILED') {
                const failedJob = getJob(jobId);
                const d = parseSqliteDate(failedJob?.started_at);
                const startedAt = d ? d.getTime() : Date.now();
                const runtimeSeconds = Math.floor((Date.now() - startedAt) / 1000);
                updateJobFailed(jobId, runtimeSeconds);
            } else if (status === 'STOPPED') {
                const stoppedJob = getJob(jobId);
                const d = parseSqliteDate(stoppedJob?.started_at);
                const startedAt = d ? d.getTime() : Date.now();
                const runtimeSeconds = Math.floor((Date.now() - startedAt) / 1000);
                updateJobStopped(jobId, runtimeSeconds);
            } else if (status === 'PENDING') {
                setJobStatus(jobId, 'PENDING');
                updateJobContainerId(jobId, null);
            }

            wsManager.broadcast(WsKeys.projectKey(projectId), { ...data, type: 'job_update' });
        }

        if (type === 'job_retry') {
            const jobId = data.jobId as number;
            const project = getProject(projectId);
            const maxRetries = project?.max_retries ?? 3;
            const newCount = incrementJobRetry(jobId);

            if (newCount <= maxRetries) {
                console.log(`[ORCH] Job ${jobId} retry ${newCount}/${maxRetries} -- rescheduling.`);
                wsManager.broadcast(WsKeys.projectKey(projectId), {
                    type: 'job_update',
                    jobId,
                    status: 'PENDING',
                    timestamp: new Date().toISOString(),
                });
            } else {
                console.log(`[ORCH] Job ${jobId} exceeded max retries (${maxRetries}). Marking FAILED.`);
                updateJobFailed(jobId);
                wsManager.broadcast(WsKeys.projectKey(projectId), {
                    type: 'job_update',
                    jobId,
                    status: 'FAILED',
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