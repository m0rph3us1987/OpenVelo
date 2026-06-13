import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { AgentStatus } from '../../src/agent-status.js';

describe('AgentStatus', () => {
    beforeEach(() => {
        AgentStatus.clearUsage();
    });

    describe('setUsage', () => {
        it('stores initial values on first call', () => {
            AgentStatus.setUsage({
                totalTokens: 100,
                inputTokens: 60,
                outputTokens: 30,
                thoughtTokens: 5,
                cachedReadTokens: 4,
                cachedWriteTokens: 1,
            });
            const u = AgentStatus.usage;
            // inputTokens folds in cache.read + cache.write.
            assert.strictEqual(u?.inputTokens, 60 + 4 + 1);
            // outputTokens folds in reasoning.
            assert.strictEqual(u?.outputTokens, 30 + 5);
            // Cache sub-fields are preserved separately for breakdown.
            assert.strictEqual(u?.cachedReadTokens, 4);
            assert.strictEqual(u?.cachedWriteTokens, 1);
            // totalTokens is the sum of the four cumulative sub-fields,
            // not the incoming `totalTokens` value (100 is ignored).
            assert.strictEqual(u?.totalTokens, 65 + 35 + 4 + 1);
        });

        it('accumulates per-turn deltas into cumulative totals, folding cache into input and reasoning into output', () => {
            // First turn: a "Hello"-style prompt. Kilo's ACP reports a
            // small uncached input (~100) plus a large cache.read (~6k)
            // because the system prompt is mostly cache hits. The Kilo
            // CLI's "Context" display sums all of them, so we do too.
            AgentStatus.setUsage({
                inputTokens: 100,
                outputTokens: 200,
                cachedReadTokens: 6000,
                cachedWriteTokens: 50,
            });
            // Second turn: another assistant turn with its own deltas.
            AgentStatus.setUsage({
                inputTokens: 50,
                outputTokens: 180,
                thoughtTokens: 20,
                cachedReadTokens: 1500,
                cachedWriteTokens: 0,
            });

            const u = AgentStatus.usage;
            // inputTokens = Σ(input + cache.read + cache.write)
            //            = (100+6000+50) + (50+1500+0) = 7700
            assert.strictEqual(u?.inputTokens, 7700);
            // outputTokens = Σ(output + thought) = (200+0) + (180+20) = 400
            assert.strictEqual(u?.outputTokens, 400);
            // Cache sub-fields are preserved separately for breakdown.
            assert.strictEqual(u?.cachedReadTokens, 7500);
            assert.strictEqual(u?.cachedWriteTokens, 50);
            // totalTokens is recomputed from the four cumulative sums.
            assert.strictEqual(u?.totalTokens, 7700 + 400 + 7500 + 50);
        });

        it('ignores the incoming totalTokens (Kilo sends the per-turn total)', () => {
            AgentStatus.setUsage({ inputTokens: 10, outputTokens: 5, totalTokens: 999999 });
            const u = AgentStatus.usage;
            // totalTokens is recomputed, not taken from the incoming value.
            assert.strictEqual(u?.totalTokens, 15);
        });

        it('treats missing fields as zero when adding', () => {
            AgentStatus.setUsage({ inputTokens: 100 });
            AgentStatus.setUsage({ outputTokens: 50 });
            const u = AgentStatus.usage;
            // First call: input full=100, output=0 → input=100, output=0 (omitted)
            // Second call: input full=0, output=50 → input=100, output=50
            assert.strictEqual(u?.inputTokens, 100);
            assert.strictEqual(u?.outputTokens, 50);
            assert.strictEqual(u?.cachedReadTokens, undefined);
            assert.strictEqual(u?.cachedWriteTokens, undefined);
            assert.strictEqual(u?.totalTokens, 150);
        });

        it('clearUsage resets to null', () => {
            AgentStatus.setUsage({ inputTokens: 100, outputTokens: 50 });
            AgentStatus.clearUsage();
            assert.strictEqual(AgentStatus.usage, null);
        });
    });
});
