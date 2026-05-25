import fs from 'fs';
import path from 'path';
import { getSkillsDir } from '@/lib/skills';

export interface BuildVerifyPromptResult {
  ok: true;
  prompt: string;
  chatDir: string;
  originalRequirementFileSize: number;
  finalPromptLength: number;
  warnings: string[];
}

export interface BuildVerifyPromptError {
  ok: false;
  reason: 'prompt_template_missing' | 'original_requirement_missing' | 'original_requirement_empty' | 'unreplaced_placeholders';
  message: string;
}

export type BuildVerifyPromptOutcome = BuildVerifyPromptResult | BuildVerifyPromptError;

function loadPromptTemplate(): string | BuildVerifyPromptError {
  const templatePath = path.join(process.cwd(), 'prompts', 'verify-analysis.md');
  if (!fs.existsSync(templatePath)) {
    return {
      ok: false,
      reason: 'prompt_template_missing',
      message: 'Prompt template file prompts/verify-analysis.md not found',
    };
  }
  try {
    return fs.readFileSync(templatePath, 'utf-8');
  } catch {
    return {
      ok: false,
      reason: 'prompt_template_missing',
      message: 'Failed to read prompt template file prompts/verify-analysis.md',
    };
  }
}

function validatePlaceholders(prompt: string): null | BuildVerifyPromptError {
  const unreplaced: string[] = [];
  const placeholderRegex = /\{[A-Z_]+\}/g;
  let match;
  while ((match = placeholderRegex.exec(prompt)) !== null) {
    const placeholder = match[0];
    if (placeholder === '{CHAT_DIR}' || placeholder === '{REPO_DIR}' || placeholder === '{ORIGINAL_REQUIREMENT_CONTENT}' || placeholder === '{SKILLS_DIR}') {
      continue;
    }
    unreplaced.push(placeholder);
  }
  if (unreplaced.length > 0) {
    return {
      ok: false,
      reason: 'unreplaced_placeholders',
      message: `Unknown placeholder(s) found in prompt: ${[...new Set(unreplaced)].join(', ')}`,
    };
  }
  return null;
}

export function buildVerifyPrompt(chatDir: string): BuildVerifyPromptOutcome {
  const repoDir = path.join(chatDir, 'repository');

  const originalRequirementPath = path.join(chatDir, 'ORIGINAL_REQUIREMENT.md');
  if (!fs.existsSync(originalRequirementPath)) {
    return {
      ok: false,
      reason: 'original_requirement_missing',
      message: 'Original requirement file not found at ' + originalRequirementPath,
    };
  }

  let originalRequirementContent: string;
  try {
    originalRequirementContent = fs.readFileSync(originalRequirementPath, 'utf-8');
  } catch {
    return {
      ok: false,
      reason: 'original_requirement_missing',
      message: 'Failed to read original requirement file at ' + originalRequirementPath,
    };
  }

  if (originalRequirementContent.length === 0) {
    return {
      ok: false,
      reason: 'original_requirement_empty',
      message: 'Original requirement file is empty',
    };
  }

  const originalRequirementFileSize = Buffer.byteLength(originalRequirementContent, 'utf-8');

  const warnings: string[] = [];
  if (originalRequirementFileSize > 1000000) {
    warnings.push('Original requirement file is unusually large (>1MB)');
  }

  const templateResult = loadPromptTemplate();
  if (typeof templateResult === 'object' && templateResult.ok === false) {
    return templateResult;
  }
  const template = templateResult as string;

  const substituted = template
    .replace(/{CHAT_DIR}/g, chatDir)
    .replace(/{REPO_DIR}/g, repoDir)
    .replace(/{SKILLS_DIR}/g, getSkillsDir())
    .replace(/{ORIGINAL_REQUIREMENT_CONTENT}/g, originalRequirementContent);

  const placeholderValidation = validatePlaceholders(substituted);
  if (placeholderValidation !== null) {
    return placeholderValidation;
  }

  return {
    ok: true,
    prompt: substituted,
    chatDir,
    originalRequirementFileSize,
    finalPromptLength: substituted.length,
    warnings,
  };
}