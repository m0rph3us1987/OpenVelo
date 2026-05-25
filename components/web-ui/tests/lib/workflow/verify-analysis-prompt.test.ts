import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import path from 'path';
import { buildVerifyPrompt, BuildVerifyPromptOutcome } from '@/lib/workflow/verify-analysis-prompt';

const tempDirs: string[] = [];

function cleanupTempDirs() {
  for (const dir of tempDirs) {
    try {
      if (fs.existsSync(dir)) {
        fs.rmSync(dir, { recursive: true });
      }
    } catch { }
  }
  tempDirs.length = 0;
}

describe('buildVerifyPrompt', () => {
  beforeEach(() => {
    cleanupTempDirs();
  });

  afterEach(() => {
    cleanupTempDirs();
  });

  describe('AC1: complete prompt with substituted paths and appended requirement', () => {
    it('returns complete prompt with all placeholders replaced and ORIGINAL_REQUIREMENT.md appended', () => {
      const chatDir = path.join(process.cwd(), 'temp_data', 'test-chat-1');
      const repoDir = path.join(chatDir, 'repository');
      fs.mkdirSync(repoDir, { recursive: true });
      tempDirs.push(chatDir);

      const requirementContent = '# Test Requirement\n\n## Overview\nThis is a test.';
      fs.writeFileSync(path.join(chatDir, 'ORIGINAL_REQUIREMENT.md'), requirementContent);

      const result = buildVerifyPrompt(chatDir) as { ok: true; prompt: string; chatDir: string; originalRequirementFileSize: number; finalPromptLength: number };

      assert.strictEqual(result.ok, true);
      assert.ok(result.prompt.includes(repoDir), 'Prompt should contain REPO_DIR path');
      assert.ok(result.prompt.includes(chatDir), 'Prompt should contain CHAT_DIR path');
      assert.ok(result.prompt.includes(requirementContent), 'Prompt should contain original requirement content');
      assert.ok(!result.prompt.includes('{CHAT_DIR}'), 'Prompt should NOT contain unreplaced {CHAT_DIR}');
      assert.ok(!result.prompt.includes('{REPO_DIR}'), 'Prompt should NOT contain unreplaced {REPO_DIR}');
    });
  });

  describe('AC2: missing prompt template returns structured error', () => {
    it('returns error when prompts/verify-analysis.md does not exist', () => {
      const originalExists = fs.existsSync(path.join(process.cwd(), 'prompts', 'verify-analysis.md'));
      if (!originalExists) {
        const chatDir = path.join(process.cwd(), 'temp_data', 'test-chat-missing-template');
        fs.mkdirSync(chatDir, { recursive: true });
        tempDirs.push(chatDir);

        const result = buildVerifyPrompt(chatDir) as { ok: false; reason: string };
        assert.strictEqual(result.ok, false);
        assert.strictEqual(result.reason, 'prompt_template_missing');
      }
    });
  });

  describe('AC3: all placeholders replaced', () => {
    it('substitutes every occurrence of {CHAT_DIR} and {REPO_DIR}', () => {
      const chatDir = path.join(process.cwd(), 'temp_data', 'test-chat-2');
      const repoDir = path.join(chatDir, 'repository');
      fs.mkdirSync(repoDir, { recursive: true });
      tempDirs.push(chatDir);

      fs.writeFileSync(path.join(chatDir, 'ORIGINAL_REQUIREMENT.md'), 'Some requirement content');

      const result = buildVerifyPrompt(chatDir) as { ok: true; prompt: string };
      assert.strictEqual(result.ok, true);
      const chatDirCount = (result.prompt.match(/\{CHAT_DIR\}/g) || []).length;
      const repoDirCount = (result.prompt.match(/\{REPO_DIR\}/g) || []).length;
      assert.strictEqual(chatDirCount, 0, 'No unreplaced {CHAT_DIR} should remain');
      assert.strictEqual(repoDirCount, 0, 'No unreplaced {REPO_DIR} should remain');
    });
  });

  describe('AC4: unknown placeholder returns structured error', () => {
    it('detects typos like {CHATDIR} without underscore and returns error', () => {
      const chatDir = path.join(process.cwd(), 'temp_data', 'test-chat-typo');
      const repoDir = path.join(chatDir, 'repository');
      fs.mkdirSync(repoDir, { recursive: true });
      tempDirs.push(chatDir);

      fs.writeFileSync(path.join(chatDir, 'ORIGINAL_REQUIREMENT.md'), 'Test content');

      const templatePath = path.join(process.cwd(), 'prompts', 'verify-analysis.md');
      const originalTemplate = fs.readFileSync(templatePath, 'utf-8');
      const badTemplate = originalTemplate.replace('{CHAT_DIR}', '{CHATDIR}');
      fs.writeFileSync(templatePath, badTemplate);
      tempDirs.push('__restore_template__');

      const result = buildVerifyPrompt(chatDir) as { ok: false; reason: string; message: string };
      assert.strictEqual(result.ok, false);
      assert.strictEqual(result.reason, 'unreplaced_placeholders');
      assert.ok(result.message.includes('{CHATDIR}'));

      fs.writeFileSync(templatePath, originalTemplate);
    });
  });

  describe('AC5: missing ORIGINAL_REQUIREMENT.md returns structured error', () => {
    it('returns error when ORIGINAL_REQUIREMENT.md does not exist', () => {
      const chatDir = path.join(process.cwd(), 'temp_data', 'test-chat-no-req');
      fs.mkdirSync(chatDir, { recursive: true });
      tempDirs.push(chatDir);

      const result = buildVerifyPrompt(chatDir) as { ok: false; reason: string };
      assert.strictEqual(result.ok, false);
      assert.strictEqual(result.reason, 'original_requirement_missing');
    });
  });

  describe('AC6: empty ORIGINAL_REQUIREMENT.md returns structured error', () => {
    it('returns error when ORIGINAL_REQUIREMENT.md is zero bytes', () => {
      const chatDir = path.join(process.cwd(), 'temp_data', 'test-chat-empty-req');
      fs.mkdirSync(chatDir, { recursive: true });
      tempDirs.push(chatDir);

      fs.writeFileSync(path.join(chatDir, 'ORIGINAL_REQUIREMENT.md'), '');

      const result = buildVerifyPrompt(chatDir) as { ok: false; reason: string };
      assert.strictEqual(result.ok, false);
      assert.strictEqual(result.reason, 'original_requirement_empty');
    });
  });

  describe('AC7: returned metadata fields', () => {
    it('includes chatDir, originalRequirementFileSize, and finalPromptLength', () => {
      const chatDir = path.join(process.cwd(), 'temp_data', 'test-chat-metadata');
      const repoDir = path.join(chatDir, 'repository');
      fs.mkdirSync(repoDir, { recursive: true });
      tempDirs.push(chatDir);

      const requirementContent = '# Test Requirement\n\n## Overview\nTest content here.';
      fs.writeFileSync(path.join(chatDir, 'ORIGINAL_REQUIREMENT.md'), requirementContent);

      const result = buildVerifyPrompt(chatDir) as { ok: true; chatDir: string; originalRequirementFileSize: number; finalPromptLength: number; prompt: string };
      assert.strictEqual(result.ok, true);
      assert.strictEqual(result.chatDir, chatDir);
      assert.ok(result.originalRequirementFileSize > 0, 'originalRequirementFileSize should be > 0');
      assert.ok(result.finalPromptLength > result.originalRequirementFileSize, 'finalPromptLength should exceed requirement size');
    });
  });

  describe('prompt content formatting', () => {
    it('appends original requirement as code fence block', () => {
      const chatDir = path.join(process.cwd(), 'temp_data', 'test-chat-format');
      const repoDir = path.join(chatDir, 'repository');
      fs.mkdirSync(repoDir, { recursive: true });
      tempDirs.push(chatDir);

      const requirementContent = 'Line 1\nLine 2\nLine 3';
      fs.writeFileSync(path.join(chatDir, 'ORIGINAL_REQUIREMENT.md'), requirementContent);

      const result = buildVerifyPrompt(chatDir) as { ok: true; prompt: string };
      assert.ok(result.prompt.includes('```\n' + requirementContent + '\n```'), 'Original requirement should be wrapped in code fence');
    });

    it('does not truncate or modify original requirement content', () => {
      const chatDir = path.join(process.cwd(), 'temp_data', 'test-chat-complete');
      const repoDir = path.join(chatDir, 'repository');
      fs.mkdirSync(repoDir, { recursive: true });
      tempDirs.push(chatDir);

      const requirementContent = '# Full Requirement\n\n## Section 1\nContent here.\n\n## Section 2\nMore content here.';
      fs.writeFileSync(path.join(chatDir, 'ORIGINAL_REQUIREMENT.md'), requirementContent);

      const result = buildVerifyPrompt(chatDir) as { ok: true; prompt: string };
      assert.ok(result.prompt.includes(requirementContent), 'Full requirement content should be present without truncation');
    });
  });
});