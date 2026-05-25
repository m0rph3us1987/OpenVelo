import { describe, it } from 'node:test';
import assert from 'assert';
import { classifyVerifyError, VerifyErrorCause } from '@/lib/workflow/verify-error-classifier';

describe('verify-error-classifier', () => {
  const allCauses: VerifyErrorCause[] = [
    'missing_repository',
    'session_start_failure',
    'llm_timeout',
    'llm_error',
    'parse_failure',
    'missing_requirement_file',
    'missing_original_requirement',
    'unknown',
  ];

  it('maps each defined error cause to the correct error type', () => {
    for (const cause of allCauses) {
      const result = classifyVerifyError(cause);
      assert.strictEqual(result.errorType, cause, `cause ${cause} should map to errorType ${cause}`);
    }
  });

  it('missing_repository returns the specific message', () => {
    const result = classifyVerifyError('missing_repository');
    assert.strictEqual(result.message, 'No repository found — run implementation first');
  });

  it('all other error types return a generic message', () => {
    const genericMessage = 'An error occurred during verification. Please try again.';
    const otherCauses = allCauses.filter(c => c !== 'missing_repository');
    for (const cause of otherCauses) {
      const result = classifyVerifyError(cause);
      assert.strictEqual(result.message, genericMessage, `cause ${cause} should return generic message`);
    }
  });

  it('unknown cause defaults to unknown error type', () => {
    const result = classifyVerifyError('unknown');
    assert.strictEqual(result.errorType, 'unknown');
    assert.strictEqual(result.message, 'An error occurred during verification. Please try again.');
  });

  it('does not throw for any known cause', () => {
    for (const cause of allCauses) {
      assert.doesNotThrow(() => classifyVerifyError(cause), `should not throw for cause ${cause}`);
    }
  });
});