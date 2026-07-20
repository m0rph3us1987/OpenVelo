import { describe, it } from 'node:test';
import assert from 'node:assert';
import * as os from 'os';
import { isWatchMode, stripWatchFlags, runCommand } from '../../src/shell.js';

describe('isWatchMode', () => {
    it('flags --watch', () => {
        assert.strictEqual(isWatchMode('vitest --watch'), true);
    });

    it('flags --watchAll', () => {
        assert.strictEqual(isWatchMode('jest --watchAll'), true);
    });

    it('flags a standalone -w', () => {
        assert.strictEqual(isWatchMode('tsc -w'), true);
    });

    it('does not flag a one-shot command', () => {
        assert.strictEqual(isWatchMode('vitest run'), false);
        assert.strictEqual(isWatchMode('npm test'), false);
    });

    it('does not flag -w embedded inside another token', () => {
        assert.strictEqual(isWatchMode('node --watchword script.js'), false);
    });
});

describe('stripWatchFlags', () => {
    it('removes --watch and trims', () => {
        assert.strictEqual(stripWatchFlags('vitest --watch'), 'vitest');
    });

    it('removes --watchAll', () => {
        assert.strictEqual(stripWatchFlags('jest --watchAll'), 'jest');
    });

    it('removes --watch=value forms', () => {
        assert.strictEqual(stripWatchFlags('jest --watchAll=true'), 'jest');
    });

    it('removes a standalone -w', () => {
        assert.strictEqual(stripWatchFlags('tsc -w'), 'tsc');
    });

    it('preserves the rest of the command and collapses whitespace', () => {
        assert.strictEqual(
            stripWatchFlags('jest --watch --coverage'),
            'jest --coverage',
        );
    });

    it('leaves a one-shot command unchanged', () => {
        assert.strictEqual(stripWatchFlags('vitest run'), 'vitest run');
    });
});

describe('runCommand bounded execution', () => {
    it('kills a blocking command at the timeout and reports failure', async () => {
        const start = Date.now();
        const res = await runCommand('bash', ['-c', 'sleep 30'], os.tmpdir(), 300);
        const elapsed = Date.now() - start;
        assert.strictEqual(res.code, 1);
        assert.match(res.output, /timed out/i);
        // Should be killed near the 300ms cap, never wait the full 30s.
        assert.ok(elapsed < 5000, `expected fast kill, took ${elapsed}ms`);
    });

    it('closes stdin so a command reading stdin does not hang', async () => {
        const start = Date.now();
        // `cat` with no file reads stdin; with stdin closed it gets EOF and exits.
        const res = await runCommand('bash', ['-c', 'cat'], os.tmpdir(), 5000);
        const elapsed = Date.now() - start;
        assert.strictEqual(res.code, 0);
        assert.ok(elapsed < 5000, `expected EOF exit, took ${elapsed}ms`);
    });

    it('returns the real exit code for a normal command', async () => {
        const res = await runCommand('bash', ['-c', 'exit 0'], os.tmpdir(), 5000);
        assert.strictEqual(res.code, 0);
    });
});
