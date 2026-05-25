import { describe, it } from 'node:test';
import assert from 'assert';
import { parseVerifyResponse } from '@/lib/workflow/verify-response-parser';

describe('verify-response-parser', () => {
  describe('parseVerifyResponse', () => {
    it('returns satisfied=true with parseMethod=direct when JSON is clean', () => {
      const result = parseVerifyResponse('{ "satisfied": true }');
      assert.strictEqual(result.satisfied, true);
      assert.strictEqual(result.parseMethod, 'direct');
      assert.strictEqual(result.error, null);
    });

    it('returns satisfied=false with parseMethod=direct for { "satisfied": false }', () => {
      const result = parseVerifyResponse('{ "satisfied": false }');
      assert.strictEqual(result.satisfied, false);
      assert.strictEqual(result.parseMethod, 'direct');
      assert.strictEqual(result.error, null);
    });

    it('extracts JSON from markdown code fence using regex fallback', () => {
      const result = parseVerifyResponse('```json\n{ "satisfied": true }\n```');
      assert.strictEqual(result.satisfied, true);
      assert.strictEqual(result.parseMethod, 'regex');
      assert.strictEqual(result.error, null);
    });

    it('extracts JSON from plain text using regex fallback', () => {
      const result = parseVerifyResponse('Here is the response: { "satisfied": true } thanks!');
      assert.strictEqual(result.satisfied, true);
      assert.strictEqual(result.parseMethod, 'regex');
      assert.strictEqual(result.error, null);
    });

    it('returns error "unparseable response" when text is not JSON and no match', () => {
      const result = parseVerifyResponse('This is not JSON at all');
      assert.strictEqual(result.satisfied, null);
      assert.strictEqual(result.parseMethod, null);
      assert.strictEqual(result.error, 'unparseable response');
    });

    it('returns error "invalid field type" when satisfied is not a boolean', () => {
      const result = parseVerifyResponse('{ "satisfied": "yes" }');
      assert.strictEqual(result.satisfied, null);
      assert.strictEqual(result.parseMethod, 'direct');
      assert.strictEqual(result.error, 'invalid field type');
    });

    it('returns error "invalid field type" when satisfied is missing', () => {
      const result = parseVerifyResponse('{ "other": "field" }');
      assert.strictEqual(result.satisfied, null);
      assert.strictEqual(result.parseMethod, 'direct');
      assert.strictEqual(result.error, 'invalid field type');
    });

    it('returns error "unparseable response" for empty string', () => {
      const result = parseVerifyResponse('');
      assert.strictEqual(result.satisfied, null);
      assert.strictEqual(result.parseMethod, null);
      assert.strictEqual(result.error, 'unparseable response');
    });

    it('returns error "unparseable response" for whitespace-only string', () => {
      const result = parseVerifyResponse('   \n\t  ');
      assert.strictEqual(result.satisfied, null);
      assert.strictEqual(result.parseMethod, null);
      assert.strictEqual(result.error, 'unparseable response');
    });

    it('returns rawResponse in result for successful parse', () => {
      const input = '{ "satisfied": true }';
      const result = parseVerifyResponse(input);
      assert.strictEqual(result.rawResponse, input);
    });

    it('returns rawResponse in result for failed parse', () => {
      const input = 'not json';
      const result = parseVerifyResponse(input);
      assert.strictEqual(result.rawResponse, input);
    });

    it('handles JSON with extra fields', () => {
      const result = parseVerifyResponse('{ "satisfied": true, "extra": "field" }');
      assert.strictEqual(result.satisfied, true);
      assert.strictEqual(result.parseMethod, 'direct');
      assert.strictEqual(result.error, null);
    });

    it('extracts first matching JSON object with satisfied key', () => {
      const result = parseVerifyResponse('Some text { "satisfied": false } then { "satisfied": true }');
      assert.strictEqual(result.satisfied, false);
      assert.strictEqual(result.parseMethod, 'regex');
    });
  });
});