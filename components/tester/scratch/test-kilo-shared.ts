import { spawn } from 'child_process';
import * as path from 'path';

// Let's spawn kilo acp directly and talk to it via JSON-RPC 2.0 to test session isolation
async function testKiloShared() {
  const kilo = spawn('kilo', ['acp'], {
    cwd: '/tmp',
    env: { ...process.env, KILO_YOLO: '1', OPENCODE_YOLO: '1' }
  });

  let stdoutData = '';
  kilo.stdout.on('data', (chunk) => {
    stdoutData += chunk.toString();
    const lines = stdoutData.split('\n');
    stdoutData = lines.pop() || '';
    for (const line of lines) {
      if (line.trim()) {
        console.log('<-', line);
      }
    }
  });

  kilo.stderr.on('data', (chunk) => {
    console.error('STDERR:', chunk.toString());
  });

  const send = (msg: any) => {
    console.log('->', JSON.stringify(msg));
    kilo.stdin.write(JSON.stringify(msg) + '\n');
  };

  // Wait 1 second
  await new Promise((resolve) => setTimeout(resolve, 1000));

  // Initialize
  send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: 1 } });

  await new Promise((resolve) => setTimeout(resolve, 1000));

  // Create session 1
  send({ jsonrpc: '2.0', id: 2, method: 'session/new', params: { cwd: '/tmp' } });

  await new Promise((resolve) => setTimeout(resolve, 1000));

  // Wait for it to close
  kilo.kill();
}

testKiloShared().catch(console.error);
