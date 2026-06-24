import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { WebSocketServer, WebSocket } from 'ws';
import { connectToAgent } from '../../src/wss.js';
import { CONFIG } from '../../src/config.js';
import { connect as connectWebUI } from '../../src/ws-client.js';

describe('Inactivity Watchdog Countdown', () => {
    let mockWebUiServer: WebSocketServer;
    let mockAgentServer: WebSocketServer;
    const receivedMessagesFromOrch: any[] = [];

    before(async () => {
        // Start a mock Web UI WS server
        mockWebUiServer = new WebSocketServer({ port: 9099 });
        mockWebUiServer.on('connection', (ws) => {
            ws.on('message', (data) => {
                const msg = JSON.parse(data.toString());
                receivedMessagesFromOrch.push(msg);
            });
        });

        // Set CONFIG Web UI URL to point to our mock server
        CONFIG.WEB_UI_URL = 'ws://localhost:9099';

        // Connect the ws-client to our mock Web UI
        connectWebUI(1);

        // Wait a bit for the connection to establish
        await new Promise((resolve) => setTimeout(resolve, 500));
    });

    after(() => {
        mockWebUiServer.close();
        if (mockAgentServer) mockAgentServer.close();
        setTimeout(() => process.exit(0), 100);
    });

    it('should time out and send FAILED status when countdown hits 0', async () => {
        // Start a mock Agent WebSocket server
        mockAgentServer = new WebSocketServer({ port: 9100 });
        
        mockAgentServer.on('connection', (ws) => {
            // Send dummy packets or accept handshake
            ws.on('message', (data) => {
                const payload = JSON.parse(data.toString());
                if (payload.type === 'handshake') {
                    // Send plan/usage to verify it does not reset timeout
                    ws.send(JSON.stringify({ type: 'plan', entries: [] }));
                } else if (payload.type === 'checkpoint') {
                    // Acknowledge checkpoint immediately
                    ws.send(JSON.stringify({ type: 'checkpoint_done' }));
                }
            });
        });

        // Configure a short timeout of 2 seconds
        CONFIG.AGENT_MAX_TIMEOUT = 2;

        // Start connection
        const connectPromise = connectToAgent(
            123, // jobId
            'dummy-container',
            'localhost',
            9100,
            'Test Job',
            'Some story'
        );

        // Wait for the timeout to trigger (should take 2 seconds)
        await new Promise((resolve) => setTimeout(resolve, 2500));

        // Find the job_update message in receivedMessagesFromOrch
        const jobUpdate = receivedMessagesFromOrch.find(
            (m) => m.type === 'job_update' && m.jobId === 123 && m.status === 'FAILED'
        );

        assert.ok(jobUpdate, 'Should have received a job_update with FAILED status');
        assert.strictEqual(jobUpdate.error, 'Agent inactivity timeout');

        // Clean up
        mockAgentServer.close();
        await connectPromise.catch(() => {});
    });
});
