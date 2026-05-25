import fs from 'fs';
import path from 'path';
import { getChatSession, getProject, getChatDir, getChatMessages, getProjectModels, getRequirementOutlines, insertRequirementOutline, insertRequirementSection, getRequirementSections, deleteRequirementOutlinesByChatId, deleteRequirementSectionsByChatId } from '@/lib/db';
import { getSkillsDir } from '@/lib/skills';
import { serveRegistry } from '@/lib/opencode-serve-registry';
import { transitionTo } from './index';
import { stageWsManager } from '@/lib/stage-ws-manager';
import { loggerService } from '@/lib/logger-service';
import { execSync } from 'child_process';

interface OutlineSection {
  index: number;
  title: string;
  scope: string;
}

interface OutlineResult {
  title: string;
  sections: OutlineSection[];
}

async function parseJsonWithRetry(
  client: { sendMessage: (sessionId: string, prompt: string, model: string) => Promise<{ parts: Array<{ type: string; text?: string }> }> },
  sessionId: string,
  resultText: string,
  expectedKey: string,
  modelKey: keyof { analyzer_model: string; planning_model: string; requirement_model: string; chat_model: string },
  models: { analyzer_model: string; planning_model: string; requirement_model: string; chat_model: string },
  chatDir: string,
  chatId: number,
  maxAttempts: number = 3
): Promise<{ parsed: OutlineResult | null; finalText: string }> {
  const extractJson = (text: string): OutlineResult | null => {
    const stripped = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();

    try {
      return JSON.parse(stripped) as OutlineResult;
    } catch {
      const jsonMatch = stripped.match(new RegExp(`\\{[\\s\\S]*"${expectedKey}"[\\s\\S]*\\}`));
      if (jsonMatch) {
        try {
          return JSON.parse(jsonMatch[0]) as OutlineResult;
        } catch {
          return null;
        }
      }
      return null;
    }
  };

  const validateWithNode = (jsonStr: string): boolean => {
    try {
      const tempFile = path.join(chatDir, 'requirement_outline_temp.json');
      fs.writeFileSync(tempFile, jsonStr, 'utf-8');
      execSync(`node -e "JSON.parse(require('fs').readFileSync('${tempFile}', 'utf8'))"`);
      return true;
    } catch {
      return false;
    }
  };

  const parsed = extractJson(resultText);
  if (parsed && validateWithNode(JSON.stringify(parsed))) {
    return { parsed, finalText: resultText };
  }

  const correctionModel = models[modelKey];

  for (let attempt = 1; attempt < maxAttempts; attempt++) {
    loggerService.appendVerbose(chatId, 'workflow:requirement', `JSON parse failed, attempt ${attempt}/${maxAttempts}, requesting correction`);
    const correctionPrompt = `The JSON you returned was malformed or incomplete. Return ONLY valid JSON with no additional text. Previous response was:\n${resultText.substring(0, 2000)}\n\nReturn only the corrected JSON.`;

    try {
      const corrected = await client.sendMessage(sessionId, correctionPrompt, correctionModel);
      const correctedText = corrected.parts.find((p: { type?: string }) => p.type === 'text')?.text?.trim() ?? '';
      const correctedParsed = extractJson(correctedText);
      if (correctedParsed && validateWithNode(JSON.stringify(correctedParsed))) {
        return { parsed: correctedParsed, finalText: correctedText };
      }
    } catch (err) {
      loggerService.appendVerbose(chatId, 'workflow:requirement', `Correction request failed: ${err}`);
    }
  }

  return { parsed: null, finalText: resultText };
}

export async function handleRequirement(chatId: number): Promise<void> {
  loggerService.appendVerbose(chatId, 'workflow:requirement', `Initializing`);
  const chat = getChatSession(chatId);
  if (!chat) {
    loggerService.appendVerbose(chatId, 'workflow:requirement', `Chat ${chatId} not found`);
    return;
  }

  const chatDir = getChatDir(chatId, chat.project_id);
  const project = getProject(chat.project_id);
  if (!project) {
    loggerService.appendVerbose(chatId, 'workflow:requirement', `Project ${chat.project_id} not found`);
    return;
  }

  const repoDir = path.join(chatDir, 'repository');

  if (!fs.existsSync(chatDir) || !fs.existsSync(repoDir)) {
    loggerService.appendVerbose(chatId, 'workflow:requirement', `chat dir or repo dir missing`);
    transitionTo(chatId, 'requirement', 'error');
    return;
  }

  if (chat.sub_stage === '') {
    loggerService.appendVerbose(chatId, 'workflow:requirement', `Starting requirement generation`);
    transitionTo(chatId, 'requirement', 'outline');
    stageWsManager.broadcastToStage(chatId, 'requirement', { type: 'sub_stage', sub_stage: 'outline' });
    return;
  }

  if (chat.sub_stage === 'outline') {
    await handleOutline(chatId, chatDir, repoDir, project.id);
    return;
  }

  if (chat.sub_stage === 'sections') {
    await handleSections(chatId, chatDir, repoDir, project.id);
    return;
  }

  if (chat.sub_stage === 'generate') {
    await handleGenerate(chatId, chatDir);
    return;
  }

  if (chat.sub_stage === 'requirement') {
    loggerService.appendVerbose(chatId, 'workflow:requirement', `Ready state - waiting for user`);
    return;
  }

  if (chat.sub_stage === 'error') {
    loggerService.appendVerbose(chatId, 'workflow:requirement', `Error state`);
    return;
  }
}

async function handleOutline(chatId: number, chatDir: string, repoDir: string, projectId: number): Promise<void> {
  loggerService.appendVerbose(chatId, 'workflow:requirement', `Generating outline`);

  deleteRequirementSectionsByChatId(chatId);
  deleteRequirementOutlinesByChatId(chatId);

  const client = serveRegistry.getOrCreate(chatId, chatDir, process.env);

  await client.ensureStarted().catch((err) => {
    loggerService.appendVerbose(chatId, 'workflow:requirement', `Server start failed: ${err.message}`);
    transitionTo(chatId, 'requirement', 'error');
    return;
  });

  const models = getProjectModels(projectId);
  const sessionId = await client.createSession();

  const repoContextPath = path.join(repoDir, 'REPOSITORY.md');
  let repoContext = '';
  if (fs.existsSync(repoContextPath)) {
    repoContext = fs.readFileSync(repoContextPath, 'utf-8');
  }

  const messages = getChatMessages(chatId);

  const chatQA = messages
    .map(m => m.role === 'system' ? `Q: ${m.message}` : `A: ${m.message}`)
    .join('\n');

  const promptTemplate = fs.readFileSync(
    path.join(process.cwd(), 'prompts', 'plan-requirement-outline.md'),
    'utf-8'
  );

  const prompt = promptTemplate
    .replace(/{CHAT_DIR}/g, chatDir)
    .replace(/{REPO_DIR}/g, repoDir)
    .replace(/{UPLOAD_DIR}/g, path.join(chatDir, 'uploads'))
    .replace(/{REPO_CONTEXT}/g, repoContext)
    .replace(/{CHAT_QA}/g, chatQA)
    .replace(/{SKILLS_DIR}/g, getSkillsDir());

  loggerService.appendVerbose(chatId, 'workflow:requirement', 'Sending outline prompt');

  try {
    const result = await client.sendMessage(sessionId, prompt, models.requirement_model);

    const textPart = result.parts.find((p: { type?: string }) => p.type === 'text');
    const resultText = textPart?.text?.trim() ?? '';

    const { parsed, finalText } = await parseJsonWithRetry(
      client,
      sessionId,
      resultText,
      'sections',
      'requirement_model',
      models,
      chatDir,
      chatId
    );

    if (!parsed) {
      loggerService.appendVerbose(chatId, 'workflow:requirement', `Failed to parse outline JSON. Raw response: ${finalText}`);
      transitionTo(chatId, 'requirement', 'error');
      return;
    }

    if (!parsed.sections || !Array.isArray(parsed.sections) || parsed.sections.length === 0) {
      loggerService.appendVerbose(chatId, 'workflow:requirement', `Invalid outline: no sections found`);
      transitionTo(chatId, 'requirement', 'error');
      return;
    }

    for (const section of parsed.sections) {
      insertRequirementOutline({
        chat_id: chatId,
        section_index: section.index,
        title: section.title,
        scope: section.scope,
      });
    }

    loggerService.appendVerbose(chatId, 'workflow:requirement', `Outline generated with ${parsed.sections.length} sections`);
    transitionTo(chatId, 'requirement', 'sections');
    stageWsManager.broadcastToStage(chatId, 'requirement', { type: 'sub_stage', sub_stage: 'sections' });
  } catch (err) {
    loggerService.appendVerbose(chatId, 'workflow:requirement', `sendMessage failed: ${err}`);
    transitionTo(chatId, 'requirement', 'error');
  }
}

async function handleSections(chatId: number, chatDir: string, repoDir: string, projectId: number): Promise<void> {
  deleteRequirementSectionsByChatId(chatId);

  const client = serveRegistry.getOrCreate(chatId, chatDir, process.env);

  await client.ensureStarted().catch((err) => {
    loggerService.appendVerbose(chatId, 'workflow:requirement', `Server start failed: ${err.message}`);
    transitionTo(chatId, 'requirement', 'error');
    return;
  });

  const models = getProjectModels(projectId);
  const sessionId = await client.createSession();

  const repoContextPath = path.join(repoDir, 'REPOSITORY.md');
  let repoContext = '';
  if (fs.existsSync(repoContextPath)) {
    repoContext = fs.readFileSync(repoContextPath, 'utf-8');
  }

  const messages = getChatMessages(chatId);

  const chatQA = messages
    .map(m => m.role === 'system' ? `Q: ${m.message}` : `A: ${m.message}`)
    .join('\n');

  const outlines = getRequirementOutlines(chatId);
  if (outlines.length === 0) {
    loggerService.appendVerbose(chatId, 'workflow:requirement', `No outlines found`);
    transitionTo(chatId, 'requirement', 'error');
    return;
  }

  stageWsManager.broadcastToStage(chatId, 'requirement', {
    type: 'sub_stage',
    sub_stage: 'sections',
    progress: `Generating section ${outlines[0].title} (1/${outlines.length})`
  });

  for (let i = 0; i < outlines.length; i++) {
    const outline = outlines[i];
    const existingSections = getRequirementSections(chatId);
    const previousSections: string[] = [];
    for (const o of outlines) {
      if (o.id === outline.id) break;
      const existing = existingSections.find(s => s.outline_id === o.id);
      if (existing) {
        previousSections.push(`Section ${o.section_index}: ${o.title}`);
      }
    }
    const previousSectionsText = previousSections.length > 0
      ? `The following sections have already been written:\n${previousSections.join('\n')}\n\nDo not repeat content from these sections.`
      : '';

    const promptTemplate = fs.readFileSync(
      path.join(process.cwd(), 'prompts', 'plan-requirement-section.md'),
      'utf-8'
    );

    const prompt = promptTemplate
      .replace(/{CHAT_DIR}/g, chatDir)
      .replace(/{REPO_DIR}/g, repoDir)
      .replace(/{UPLOAD_DIR}/g, path.join(chatDir, 'uploads'))
      .replace(/{REPO_CONTEXT}/g, repoContext)
      .replace(/{CHAT_QA}/g, chatQA)
      .replace(/{SECTION_INDEX}/g, String(outline.section_index))
      .replace(/{SECTION_TITLE}/g, outline.title)
      .replace(/{SECTION_SCOPE}/g, outline.scope)
      .replace(/{PREVIOUS_SECTIONS}/g, previousSectionsText)
      .replace(/{SKILLS_DIR}/g, getSkillsDir());

    loggerService.appendVerbose(chatId, 'workflow:requirement', `Generating section ${outline.section_index}: ${outline.title}`);

    try {
      const result = await client.sendMessage(sessionId, prompt, models.requirement_model);

      const textPart = result.parts.find((p: { type?: string }) => p.type === 'text');
      const sectionContent = textPart?.text?.trim() ?? '';

      if (!sectionContent) {
        loggerService.appendVerbose(chatId, 'workflow:requirement', `Empty section content received for section ${outline.section_index}`);
        transitionTo(chatId, 'requirement', 'error');
        return;
      }

      insertRequirementSection({
        chat_id: chatId,
        outline_id: outline.id,
        content: sectionContent,
      });

      loggerService.appendVerbose(chatId, 'workflow:requirement', `Section ${outline.section_index} generated`);

      if (i < outlines.length - 1) {
        stageWsManager.broadcastToStage(chatId, 'requirement', {
          type: 'sub_stage',
          sub_stage: 'sections',
          progress: `Generating section ${outlines[i + 1].title} (${i + 2}/${outlines.length})`
        });
      }
    } catch (err) {
      loggerService.appendVerbose(chatId, 'workflow:requirement', `sendMessage failed for section ${outline.section_index}: ${err}`);
      transitionTo(chatId, 'requirement', 'error');
      return;
    }
  }

  loggerService.appendVerbose(chatId, 'workflow:requirement', `All ${outlines.length} sections generated, transitioning to generate`);
  transitionTo(chatId, 'requirement', 'generate');
  stageWsManager.broadcastToStage(chatId, 'requirement', {
    type: 'sub_stage',
    sub_stage: 'generate'
  });
}

async function handleGenerate(chatId: number, chatDir: string): Promise<void> {
  loggerService.appendVerbose(chatId, 'workflow:requirement', `Generating final REQUIREMENT.md`);

  const outlines = getRequirementOutlines(chatId);
  const sections = getRequirementSections(chatId);

  if (sections.length === 0) {
    loggerService.appendVerbose(chatId, 'workflow:requirement', `No sections found`);
    transitionTo(chatId, 'requirement', 'error');
    return;
  }

  const outlineById = new Map(outlines.map(o => [o.id, o]));
  const sectionsByOutlineId = new Map<number, string>();
  for (const s of sections) {
    sectionsByOutlineId.set(s.outline_id, s.content);
  }

  let markdown = `# ${outlineById.get(sections[0].outline_id)?.title || 'Requirements Document'}\n\n`;

  for (const outline of outlines) {
    const content = sectionsByOutlineId.get(outline.id);
    if (content) {
      markdown += content + '\n\n';
    }
  }

  const requirementPath = path.join(chatDir, 'REQUIREMENT.md');
  fs.writeFileSync(requirementPath, markdown, 'utf-8');

  loggerService.appendVerbose(chatId, 'workflow:requirement', `REQUIREMENT.md generated successfully`);
  transitionTo(chatId, 'requirement', 'requirement');
  stageWsManager.broadcastToStage(chatId, 'requirement', { type: 'sub_stage', sub_stage: 'requirement', progress: `Requirement` });
}
