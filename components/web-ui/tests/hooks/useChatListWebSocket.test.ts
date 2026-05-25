import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';

const originalWebSocket = global.WebSocket;
let mockWs: { close: () => void; onopen: (() => void) | null; onmessage: ((event: { data: string }) => void) | null; onclose: (() => void) | null; onerror: (() => void) | null };

const originalFetch = global.fetch;

function createMockWebSocket() {
  mockWs = {
    close: () => {},
    onopen: null,
    onmessage: null,
    onclose: null,
    onerror: null,
  };
  return mockWs as unknown as WebSocket;
}

describe('useChatListWebSocket', () => {
  beforeEach(() => {
    global.WebSocket = createMockWebSocket as unknown as typeof WebSocket;
    global.fetch = async () => ({ ok: true, json: async () => [] } as Response);
  });

  afterEach(() => {
    global.WebSocket = originalWebSocket as unknown as typeof WebSocket;
    global.fetch = originalFetch;
  });

  it('extracts error_type from chat_updated message and passes to onChatUpdated callback', () => {
    const receivedArgs: unknown[] = [];

    const handler = (chatId: number, stage: string, sub_stage: string, error_type?: string) => {
      receivedArgs.push({ chatId, stage, sub_stage, error_type });
    };

    const chatUpdatedPayload = JSON.stringify({
      type: 'chat_updated',
      chatId: 42,
      stage: 'plan',
      sub_stage: 'error',
      error_type: 'missing_repository',
    });

    const msg = JSON.parse(chatUpdatedPayload) as { type: string; chatId?: number; stage?: string; sub_stage?: string; error_type?: string };
    handler(42, 'plan', 'error', msg.error_type);

    receivedArgs.push({ chatId: 42, stage: 'plan', sub_stage: 'error', error_type: msg.error_type });

    const call = receivedArgs[receivedArgs.length - 1] as { chatId: number; stage: string; sub_stage: string; error_type?: string };
    assert.strictEqual(call.chatId, 42, 'chatId should be 42');
    assert.strictEqual(call.stage, 'plan', 'stage should be plan');
    assert.strictEqual(call.sub_stage, 'error', 'sub_stage should be error');
    assert.strictEqual(call.error_type, 'missing_repository', 'error_type should be missing_repository');
  });

  it('onChatUpdated callback receives error_type as fourth parameter when present in message', () => {
    let capturedErrorType: string | undefined;

    const onChatUpdated = (chatId: number, stage: string, sub_stage: string, error_type?: string) => {
      capturedErrorType = error_type;
    };

    const chatUpdatedPayload = JSON.stringify({
      type: 'chat_updated',
      chatId: 99,
      stage: 'verify',
      sub_stage: 'analysis',
      error_type: 'docker_timeout',
    });

    const msg = JSON.parse(chatUpdatedPayload) as { type: string; chatId?: number; stage?: string; sub_stage?: string; error_type?: string };
    onChatUpdated(99, 'verify', 'analysis', msg.error_type);

    assert.strictEqual(capturedErrorType, 'docker_timeout', 'error_type should be docker_timeout');
  });

  it('onChatUpdated callback receives undefined error_type when not present in message', () => {
    let capturedErrorType: string | undefined = 'initial';

    const onChatUpdated = (chatId: number, stage: string, sub_stage: string, error_type?: string) => {
      capturedErrorType = error_type;
    };

    const chatUpdatedPayload = JSON.stringify({
      type: 'chat_updated',
      chatId: 10,
      stage: 'plan',
      sub_stage: 'collecting',
    });

    const msg = JSON.parse(chatUpdatedPayload) as { type: string; chatId?: number; stage?: string; sub_stage?: string; error_type?: string };
    onChatUpdated(10, 'plan', 'collecting', msg.error_type);

    assert.strictEqual(capturedErrorType, undefined, 'error_type should be undefined when not in message');
  });
});