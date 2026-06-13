/**
 * Client for a single `opencode serve` process.
 *
 * Each instance owns one OS-level opencode server (one per chatDir).  
 * Callers create a fresh session per AI turn and delete it when done.
 * Reasoning events from the SSE stream are forwarded to `loggerService`
 * for distribution to subscribers.
 */

import { spawn, ChildProcess } from 'child_process';
import http from 'http';
import { loggerService } from '@/lib/logger-service';
import { getUiSetting } from './db';

// ---------------------------------------------------------------------------
// Types (mirrors the opencode REST API surface we actually use)
// ---------------------------------------------------------------------------

interface SessionInfo {
  id: string;
  [key: string]: unknown;
}

interface MessagePart {
  type: string;
  text?: string;
  [key: string]: unknown;
}

interface MessageResult {
  info: { id: string; [key: string]: unknown };
  parts: MessagePart[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function httpPost(url: string, body: unknown): Promise<{ status: number; data: unknown }> {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const parsed = new URL(url);
    const options: http.RequestOptions = {
      hostname: parsed.hostname,
      port: parseInt(parsed.port, 10),
      path: parsed.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
      },
    };
    const req = http.request(options, (res) => {
      let raw = '';
      res.on('data', (c) => { raw += c; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode ?? 0, data: JSON.parse(raw) }); }
        catch { resolve({ status: res.statusCode ?? 0, data: raw }); }
      });
      res.on('error', (err) => {
        reject(new Error(`Response stream error: ${err.message}`));
      });
    });
    req.setTimeout(1800_000);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error(`Request timed out after 1800s: ${url}`));
    });
    req.on('error', (err) => {
      console.log(`[httpPost] Connection error to ${url}: ${err.message}`);
      reject(err);
    });
    req.write(payload);
    req.end();
  });
}

function httpGet(url: string): Promise<{ status: number; data: unknown }> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const options: http.RequestOptions = {
      hostname: parsed.hostname,
      port: parseInt(parsed.port, 10),
      path: parsed.pathname,
      method: 'GET',
      headers: {
        'Accept': 'application/json',
      },
    };
    const req = http.request(options, (res) => {
      let raw = '';
      res.on('data', (c) => { raw += c; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode ?? 0, data: JSON.parse(raw) }); }
        catch { resolve({ status: res.statusCode ?? 0, data: raw }); }
      });
      res.on('error', (err) => {
        reject(new Error(`Response stream error: ${err.message}`));
      });
    });
    req.setTimeout(1800_000);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error(`Request timed out after 1800s: ${url}`));
    });
    req.on('error', (err) => {
      reject(err);
    });
    req.end();
  });
}


function httpDelete(url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const options: http.RequestOptions = {
      hostname: parsed.hostname,
      port: parseInt(parsed.port, 10),
      path: parsed.pathname,
      method: 'DELETE',
    };
    const req = http.request(options, (res) => {
      res.resume();
      res.on('end', resolve);
    });
    req.on('error', reject);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Main class
// ---------------------------------------------------------------------------

export class OpenCodeServeClient {
  private chatId: number;
  private _chatDir: string;
  private env: Record<string, string | undefined>;

  private serverProcess: ChildProcess | null = null;
  private port = 0;
  private baseUrl = '';
  private startPromise: Promise<void> | null = null;

  // SSE state
  private sseRequest: http.ClientRequest | null = null;
  private currentActiveSessionId: string | null = null;
  private loggedToolCalls = new Set<string>();
  private sessionSseLogs = new Map<string, string[]>();

  private appendSessionSseLog(sessionId: string, log: string): void {
    let logs = this.sessionSseLogs.get(sessionId);
    if (!logs) {
      logs = [];
      this.sessionSseLogs.set(sessionId, logs);
    }
    logs.push(log);
  }

  constructor(chatId: number, chatDir: string, env: Record<string, string | undefined>) {
    this.chatId = chatId;
    this._chatDir = chatDir;
    this.env = env;
  }

  get chatDir(): string {
    return this._chatDir;
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  /** Ensure the server is running. Idempotent — safe to call multiple times. */
  async ensureStarted(): Promise<void> {
    if (this.startPromise) return this.startPromise;
    this.startPromise = this._start();
    return this.startPromise;
  }

  private async _start(): Promise<void> {
    return new Promise((resolve, reject) => {
      loggerService.append(this.chatId, `Starting kilo serve…`);

      const env: Record<string, string | undefined> = {
        ...this.env,
        KILO_YOLO: '1',
        OPENCODE_YOLO: '1',
      };

      let proc: ReturnType<typeof spawn> | null = null;
      try {
        proc = spawn('kilo', ['serve', '--port', '0'], {
          cwd: this.chatDir,
          env,
          shell: true,
          stdio: ['ignore', 'pipe', 'pipe'],
        });
      } catch (err) {
        loggerService.append(this.chatId, `spawn failed: ${err}`);
        reject(new Error(`Failed to spawn kilo: ${err}`));
        return;
      }

      this.serverProcess = proc;

      const timeout = setTimeout(() => {
        if (proc) proc.kill();
        reject(new Error('kilo serve did not report its port within 15 s'));
      }, 15_000);

      const tryParseLine = (line: string) => {
        const m = line.match(/listening on http:\/\/(127\.0\.0\.1|localhost):(\d+)/i);
        if (m) {
          clearTimeout(timeout);
          this.port = parseInt(m[2], 10);
          this.baseUrl = `http://127.0.0.1:${this.port}`;
          loggerService.append(this.chatId, `kilo serve ready on port ${this.port}`);
          void this._connectSse();
          resolve();
        }
      };

      let stdoutBuf = '';
      proc.stdout?.on('data', (chunk: Buffer) => {
        stdoutBuf += chunk.toString();
        const lines = stdoutBuf.split('\n');
        stdoutBuf = lines.pop() ?? '';
        for (const l of lines) tryParseLine(l);
      });

      let stderrBuf = '';
      proc.stderr?.on('data', (chunk: Buffer) => {
        stderrBuf += chunk.toString();
        const lines = stderrBuf.split('\n');
        stderrBuf = lines.pop() ?? '';
        for (const l of lines) {
          tryParseLine(l);
          loggerService.append(this.chatId, `[kilo stderr] ${l}`);
        }
      });

      proc.on('error', (err) => {
        clearTimeout(timeout);
        loggerService.append(this.chatId, `kilo serve error: ${err}`);
        reject(err);
      });

      proc.on('exit', (code) => {
        clearTimeout(timeout);
        loggerService.append(this.chatId, `kilo serve exited (code ${code})`);
        this.serverProcess = null;
        this.startPromise = null;
        this._disconnectSse();
        if (code !== 0 && code !== null) {
          reject(new Error(`kilo serve exited with code ${code}`));
        }
      });
    });
  }

  /** Kill the server and clean up. */
  shutdown(): void {
    this._disconnectSse();
    if (this.serverProcess) {
      try { this.serverProcess.kill(); } catch { /* ignore */ }
      this.serverProcess = null;
    }
    this.startPromise = null;
    this.port = 0;
    this.baseUrl = '';
  }

  get isRunning(): boolean {
    return this.serverProcess !== null && this.port > 0;
  }

  // ---------------------------------------------------------------------------
  // SSE — forwards reasoning deltas to loggerService for the thinking bubble
  // ---------------------------------------------------------------------------

  private _connectSse(): void {
    if (!this.baseUrl) return;
    this._disconnectSse();

    const parsed = new URL(`${this.baseUrl}/event`);
    const options: http.RequestOptions = {
      hostname: parsed.hostname,
      port: parseInt(parsed.port, 10),
      path: parsed.pathname,
      method: 'GET',
      headers: { Accept: 'text/event-stream' },
    };

    const req = http.request(options, (res) => {
      let buf = '';
      res.on('data', (chunk: Buffer) => {
        buf += chunk.toString();
        const blocks = buf.split('\n\n');
        buf = blocks.pop() ?? '';
        for (const block of blocks) {
          this._handleSseBlock(block);
        }
      });
      res.on('end', () => {
        setTimeout(() => {
          if (this.isRunning) void this._connectSse();
        }, 2_000);
      });
    });

    req.on('error', () => {
      setTimeout(() => {
        if (this.isRunning) void this._connectSse();
      }, 2_000);
    });

    req.end();
    this.sseRequest = req;
  }

  private _disconnectSse(): void {
    if (this.sseRequest) {
      try { this.sseRequest.destroy(); } catch { /* ignore */ }
      this.sseRequest = null;
    }
  }

  private _handleSseBlock(block: string): void {
    const lines = block.split('\n');
    const dataLine = lines.find(l => l.startsWith('data:'));
    if (!dataLine) return;

    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(dataLine.slice('data:'.length).trim()) as Record<string, unknown>;
    } catch {
      return;
    }

    const eventType = payload['type'] as string | undefined;
    const properties = payload['properties'] as Record<string, unknown> | undefined;
    if (!eventType || !properties) return;

    const sessionID = (properties?.['sessionID'] || properties?.['sessionId'] || payload['sessionID'] || payload['sessionId']) as string | undefined;

    // Only append raw SSE blocks to the main chat if it belongs to the active main session
    if (!sessionID || sessionID === this.currentActiveSessionId) {
      loggerService.appendRawSse(this.chatId, block);
    }

    if (getUiSetting('debug_sse_console') === 'true') {
      console.log('[SSE Block]', block);
    }

    if (eventType === 'message.part.updated') {
      // Tool part lifecycle is observed via polling /session/{id}/message
      // rather than SSE, because the `message.part.updated` event for tools
      // can fire with state.status === 'running' but state.input still empty
      // (e.g. while the model streams tool arguments). Logging it here would
      // mark the callID as seen and prevent the polling handler from emitting
      // the final log with the real input — resulting in "[READING] unknown".
      return;
    }

    if (eventType === 'message.part.delta') {
      const delta = properties?.['delta'] as string | undefined;
      if (delta) {
        if (!sessionID || sessionID === this.currentActiveSessionId) {
          loggerService.append(this.chatId, delta);
        }
      }
      return;
    }

    if (eventType === 'file.edited') {
      const file = properties?.['file'] as string | undefined;
      if (file) {
        if (sessionID) {
          this.appendSessionSseLog(sessionID, `\n[FILE EDITED] ${file}\n`);
        }
        if (!sessionID || sessionID === this.currentActiveSessionId) {
          loggerService.append(this.chatId, `\n[FILE EDITED] ${file}\n`);
        }
      }
      return;
    }

    if (eventType === 'permission.asked') {
      const permissionID = properties['id'] as string | undefined;
      const permSessionID = properties['sessionID'] as string | undefined;
      if (permissionID && permSessionID) {
        this.appendSessionSseLog(permSessionID, `[permission.asked] auto-granting ${permissionID}\n`);
        if (!permSessionID || permSessionID === this.currentActiveSessionId) {
          loggerService.append(this.chatId, `[permission.asked] auto-granting ${permissionID}\n`);
        }
        void httpPost(
          `${this.baseUrl}/session/${permSessionID}/permissions/${permissionID}`,
          { response: 'grant', remember: true },
        );
      }
      return;
    }

    if (eventType === 'session.diff') {
      // Do not log diff event details to avoid bloating the output
      return;
    }
  }

  // ---------------------------------------------------------------------------
  // Session management
  // ---------------------------------------------------------------------------

  async createSession(): Promise<string> {
    console.log(`[createSession] POST ${this.baseUrl}/session`);
    const result = await httpPost(`${this.baseUrl}/session`, {});
    console.log(`[createSession] Response status=${result.status}`);
    if (result.status >= 400) {
      throw new Error(`createSession HTTP ${result.status}: ${JSON.stringify(result.data)}`);
    }
    const data = result.data as SessionInfo;
    if (!data?.id) throw new Error(`createSession: unexpected response: ${JSON.stringify(data)}`);
    this.currentActiveSessionId = data.id;
    return data.id;
  }

  /**
   * Send a message to the given session.
   * Blocks until the AI turn is complete (opencode serve blocks the POST).
   *
   * @param sessionId  Fresh session created by createSession()
   * @param text       The full turn prompt
   * @param model      Optional "provider/model" string (e.g. "anthropic/claude-3-5-sonnet-20241022")
   */
  async sendMessage(sessionId: string, text: string, model?: string, skipMainLog = false): Promise<MessageResult> {
    if (!skipMainLog) {
      this.currentActiveSessionId = sessionId;
    }
    this.loggedToolCalls.clear();
    const [providerID, modelID] = model?.includes('/') ? model.split('/', 2) : [undefined, undefined];
    const modelObj = providerID && modelID ? { providerID, modelID } : undefined;

    const body: Record<string, unknown> = {
      role: 'user',
      parts: [{ type: 'text', text }],
      model: modelObj,
    };

    let pollInterval: NodeJS.Timeout | null = null;
    if (!skipMainLog) {
      pollInterval = setInterval(async () => {
        try {
          await this._pollToolCalls(sessionId);
        } catch {
          // ignore
        }
      }, 400);
    }

    try {
      const result = await httpPost(`${this.baseUrl}/session/${sessionId}/message`, body);
      if (result.status >= 400) {
        throw new Error(`sendMessage HTTP ${result.status}: ${JSON.stringify(result.data)}`);
      }
      return result.data as MessageResult;
    } finally {
      if (pollInterval) {
        clearInterval(pollInterval);
        pollInterval = null;
      }
      if (!skipMainLog) {
        try {
          await this._pollToolCalls(sessionId);
        } catch {
          // ignore
        }
      }
    }
  }

  async reconstructSessionLogs(sessionId: string): Promise<string> {
    if (!this.baseUrl) return '';
    try {
      const url = `${this.baseUrl}/session/${sessionId}/message`;
      const res = await httpGet(url);
      if (res.status !== 200) return '';
      const messages = res.data as any[];
      if (!messages || !Array.isArray(messages)) return '';

      const logLines: string[] = [];
      for (const msg of messages) {
        if (msg.info?.role === 'assistant' && msg.parts && Array.isArray(msg.parts)) {
          for (const part of msg.parts) {
            if (part.type === 'tool') {
              const toolName = part.tool ?? 'unknown';
              const state = part.state;
              const input = state?.['input'] as Record<string, unknown> | undefined;
              const status = state?.['status'] as string | undefined;
              const isFinished = status === 'completed' || status === 'failed';
              if (isFinished || !this.isToolInputIncomplete(String(toolName), input)) {
                logLines.push(`\n${this.formatToolLog(String(toolName), input)}\n`);
              }
            } else {
              const content = part.text || part.thought || part.reasoning || part.content;
              if (typeof content === 'string' && content) {
                logLines.push(content);
              }
            }
          }
        }
      }
      const sseLogs = this.sessionSseLogs.get(sessionId);
      if (sseLogs && sseLogs.length > 0) {
        logLines.push(...sseLogs);
      }
      return logLines.join('');
    } catch {
      return '';
    }
  }

  async abortSession(sessionId: string): Promise<void> {
    if (this.currentActiveSessionId === sessionId) {
      this.currentActiveSessionId = null;
    }
    this.sessionSseLogs.delete(sessionId);
    try {
      await httpPost(`${this.baseUrl}/session/${sessionId}/abort`, {});
    } catch { /* ignore — session may already be gone */ }
  }

  async deleteSession(sessionId: string): Promise<void> {
    if (this.currentActiveSessionId === sessionId) {
      this.currentActiveSessionId = null;
    }
    this.sessionSseLogs.delete(sessionId);
    try {
      await httpDelete(`${this.baseUrl}/session/${sessionId}`);
    } catch { /* ignore */ }
  }

  private formatToolLog(toolName: string, input?: Record<string, unknown>): string {
    switch (toolName) {
      case 'read':
        return `[READING] ${input?.['filePath'] ?? 'unknown'}`;

      case 'bash': {
        const description = input?.['description'] as string | undefined;
        const command = input?.['command'] as string | undefined;
        return `[BASH] ${description ?? ''}\n  - ${command ?? ''}`;
      }

      case 'glob':
        return `[GLOB] ${input?.['pattern'] ?? ''}`;

      case 'todowrite':
        return this.formatTodosLog(input);

      case 'write':
        return `[WRITING] ${input?.['filePath'] ?? 'unknown'}`;

      case 'grep': {
        const pattern = input?.['pattern'] as string | undefined;
        const path = input?.['path'] as string | undefined;
        return `[GREP] "${pattern ?? ''}" in ${path ?? '.'}`;
      }

      case 'edit':
        return `[EDIT] ${input?.['filePath'] ?? 'unknown'}`;

      case 'task': {
        const description = input?.['description'] as string | undefined;
        const subagentType = input?.['subagent_type'] as string | undefined;
        const taskId = input?.['task_id'] as string | undefined;
        const headline = description || (taskId ? `resuming ${taskId}` : 'subagent task');
        const tag = subagentType ? ` (@${subagentType})` : '';
        return `[TASK] ${headline}${tag}`;
      }

      default:
        return `[TOOL] ${toolName}: ${JSON.stringify(input ?? {})}`;
    }
  }

  private formatTodosLog(input?: Record<string, unknown>): string {
    const todos = input?.['todos'] as Array<{ content?: string; status?: string } | undefined>;
    if (!todos || !Array.isArray(todos)) return '[TODOS]';

    const lines: string[] = ['[TODOS]:'];
    for (const todo of todos) {
      if (!todo) continue;
      const status = (todo.status ?? 'pending').toUpperCase();
      const check = status === 'COMPLETED' ? '✓' : '○';
      lines.push(`  [${check}] ${todo.content ?? ''}`);
    }
    return lines.join('\n');
  }

  private async _pollToolCalls(sessionId: string): Promise<void> {
    if (!this.baseUrl) return;
    const url = `${this.baseUrl}/session/${sessionId}/message`;
    const res = await httpGet(url);
    if (res.status !== 200) return;
    const messages = res.data as Array<{
      info?: { role?: string };
      parts?: Array<{
        type: string;
        callID?: string;
        tool?: string;
        state?: Record<string, unknown>;
      }>;
    }>;
    if (!messages || !Array.isArray(messages)) return;

    for (const msg of messages) {
      if (msg.info?.role === 'assistant' && msg.parts && Array.isArray(msg.parts)) {
        for (const part of msg.parts) {
          if (part.type === 'tool') {
            const toolName = part.tool ?? 'unknown';
            if (toolName === 'diff') {
              continue;
            }
            const callID = part.callID;
            const state = part.state;
            if (callID && !this.loggedToolCalls.has(callID)) {
              const input = state?.['input'] as Record<string, unknown> | undefined;
              const status = state?.['status'] as string | undefined;
              const isFinished = status === 'completed' || status === 'failed';
              if (!isFinished && this.isToolInputIncomplete(String(toolName), input)) {
                continue;
              }
              this.loggedToolCalls.add(callID);
              loggerService.append(this.chatId, '\n' + this.formatToolLog(String(toolName), input) + '\n');
            }
          }
        }
      }
    }
  }

  private isToolInputIncomplete(toolName: string, input?: Record<string, unknown>): boolean {
    if (!input) return true;
    switch (toolName) {
      case 'read':
      case 'write':
      case 'edit':
        return !input['filePath'] || typeof input['filePath'] !== 'string';
      case 'bash':
        return !input['command'] || typeof input['command'] !== 'string';
      case 'glob':
        return !input['pattern'] || typeof input['pattern'] !== 'string';
      case 'grep':
        return !input['pattern'] || typeof input['pattern'] !== 'string';
      default:
        return false;
    }
  }
}
