import { describe, it } from 'node:test';
import assert from 'node:assert';
import { validatePasswordPolicy, signJwt, verifyJwt } from '@/lib/auth';

describe('validatePasswordPolicy', () => {
  it('accepts valid password', () => {
    const result = validatePasswordPolicy('Password1!');
    assert.strictEqual(result.valid, true);
  });

  it('rejects too short', () => {
    const result = validatePasswordPolicy('short');
    assert.strictEqual(result.valid, false);
    assert.ok(result.message?.includes('8 characters'));
  });

  it('rejects missing uppercase', () => {
    const result = validatePasswordPolicy('noupper1!');
    assert.strictEqual(result.valid, false);
    assert.ok(result.message?.includes('uppercase'));
  });

  it('rejects missing lowercase', () => {
    const result = validatePasswordPolicy('NOLOWER1!');
    assert.strictEqual(result.valid, false);
    assert.ok(result.message?.includes('lowercase'));
  });

  it('rejects missing number', () => {
    const result = validatePasswordPolicy('NoSpecial!');
    assert.strictEqual(result.valid, false);
    assert.ok(result.message?.includes('number'));
  });

  it('rejects missing special character', () => {
    const result = validatePasswordPolicy('NoSpecial1');
    assert.strictEqual(result.valid, false);
    assert.ok(result.message?.includes('special'));
  });
});

describe('signJwt and verifyJwt', () => {
  it('round-trip recovers payload', async () => {
    const payload = { userId: 42, username: 'alice', role: 'admin' };
    const secret = 'test-secret-key';
    const token = await signJwt(payload, secret);
    assert.strictEqual(typeof token, 'string');
    assert.ok(token.length > 0);
    const decoded = await verifyJwt(token, secret);
    assert.strictEqual(decoded.userId, 42);
    assert.strictEqual(decoded.username, 'alice');
    assert.strictEqual(decoded.role, 'admin');
  });
});