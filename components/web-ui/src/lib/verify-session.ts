import { getChatDir, getProjectModels, getChatSession } from '@/lib/db';
import { serveRegistry } from '@/lib/opencode-serve-registry';
import { loggerService } from '@/lib/logger-service';
import type { OpenCodeServeClient } from './opencode-serve-client';

export interface VerifySessionResult {
  ok: true;
  client: OpenCodeServeClient;
  sessionId: string;
}

export interface VerifySessionError {
  ok: false;
  reason: 'model_not_configured' | 'server_start_failed' | 'session_creation_failed';
  message: string;
}

export type VerifySessionOutcome = VerifySessionResult | VerifySessionError;

export async function createVerifySession(chatId: number): Promise<VerifySessionOutcome> {
  const chat = getChatSession(chatId);
  if (!chat) {
    return {
      ok: false,
      reason: 'model_not_configured',
      message: 'Chat session not found',
    };
  }

  const projectId = chat.project_id;

  let models: ReturnType<typeof getProjectModels>;
  try {
    models = getProjectModels(projectId);
  } catch {
    return {
      ok: false,
      reason: 'model_not_configured',
      message: 'No analyzer_model configured for this project',
    };
  }

  if (!models.analyzer_model) {
    return {
      ok: false,
      reason: 'model_not_configured',
      message: 'No analyzer_model configured for this project',
    };
  }

  const actualChatDir = getChatDir(chatId, projectId);

  const existingSessionId = serveRegistry.getSession(chatId, 'verify');
  if (existingSessionId) {
    const existingClient = serveRegistry.getClient(chatId);
    if (existingClient && existingClient.isRunning) {
      return {
        ok: true,
        client: existingClient,
        sessionId: existingSessionId,
      };
    }
    await terminateVerifySession(chatId);
  }

  const client = serveRegistry.getOrCreate(chatId, actualChatDir, process.env);

  try {
    await client.ensureStarted();
  } catch (err) {
    loggerService.append(chatId, `[verify-session] Server start failed: ${err}`);
    return {
      ok: false,
      reason: 'server_start_failed',
      message: `Failed to start OpenCode server: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  let sessionId: string;
  try {
    sessionId = await client.createSession();
  } catch (err) {
    loggerService.append(chatId, `[verify-session] Session creation failed: ${err}`);
    return {
      ok: false,
      reason: 'session_creation_failed',
      message: `Failed to create session: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  serveRegistry.setSession(chatId, 'verify', sessionId);

  return {
    ok: true,
    client,
    sessionId,
  };
}

export async function terminateVerifySession(chatId: number): Promise<void> {
  const existingSessionId = serveRegistry.getSession(chatId, 'verify');
  if (existingSessionId) {
    const client = serveRegistry.getClient(chatId);
    if (client) {
      await client.abortSession(existingSessionId);
    }
    serveRegistry.setSession(chatId, 'verify', '');
  }
}

export async function teardownVerifySession(chatId: number): Promise<void> {
  await terminateVerifySession(chatId);
}

export function isVerifySessionHealthy(chatId: number): boolean {
  const client = serveRegistry.getClient(chatId);
  if (!client) return false;
  return client.isRunning;
}