/**
 * Registry that maps chatId → OpenCodeServeClient.
 *
 * Manages one serve process per chat directory.
 * Tracks sessions per stage - each stage has its own dedicated session.
 * Sessions are kept when a stage ends (not deleted) so they can be
 * reused later if needed.
 */

import { OpenCodeServeClient } from '@/lib/opencode-serve-client';

interface ActiveEntry {
  client: OpenCodeServeClient;
  /** Map<stage, sessionId> - one session per stage */
  sessions: Map<string, string>;
}

class OpenCodeServeRegistry {
  private entries = new Map<number, ActiveEntry>();

  /**
   * Get or create a client for the given chatId/chatDir.
   * The client's server is not started yet — call ensureStarted() separately.
   */
  getOrCreate(chatId: number, chatDir: string, env: Record<string, string | undefined>): OpenCodeServeClient {
    let entry = this.entries.get(chatId);
    if (!entry) {
      const client = new OpenCodeServeClient(chatId, chatDir, env);
      entry = { client, sessions: new Map() };
      this.entries.set(chatId, entry);
    } else if (entry.client.chatDir !== chatDir) {
      entry.client.shutdown();
      const client = new OpenCodeServeClient(chatId, chatDir, env);
      entry = { client, sessions: new Map() };
      this.entries.set(chatId, entry);
    }
    return entry.client;
  }

  getClient(chatId: number): OpenCodeServeClient | undefined {
    return this.entries.get(chatId)?.client;
  }

  /**
   * Store a session for a given stage.
   * Overwrites any existing session for that stage.
   */
  setSession(chatId: number, stage: string, sessionId: string): void {
    if (sessionId) {
      let entry = this.entries.get(chatId);
      if (!entry) {
        entry = { client: null as unknown as OpenCodeServeClient, sessions: new Map() };
        this.entries.set(chatId, entry);
      }
      entry.sessions.set(stage, sessionId);
    } else {
      const entry = this.entries.get(chatId);
      if (entry) {
        entry.sessions.delete(stage);
      }
    }
  }

  /**
   * Get the session for a given stage, or null if none exists.
   */
  getSession(chatId: number, stage: string): string | null {
    return this.entries.get(chatId)?.sessions.get(stage) ?? null;
  }

  /**
   * Abort a specific session.
   */
  async abortSession(chatId: number, sessionId: string): Promise<void> {
    const entry = this.entries.get(chatId);
    if (entry) {
      await entry.client.abortSession(sessionId);
    }
  }

  /**
   * Tear down the server for a given chat (e.g. when the chat is closed).
   */
  shutdown(chatId: number): void {
    const entry = this.entries.get(chatId);
    if (entry) {
      entry.client.shutdown();
      this.entries.delete(chatId);
    }
  }

  /** Shut down all running servers. */
  shutdownAll(): void {
    for (const [, entry] of this.entries) {
      if (entry.client) {
        entry.client.shutdown();
      }
    }
    this.entries.clear();
  }
}

export const serveRegistry = new OpenCodeServeRegistry();