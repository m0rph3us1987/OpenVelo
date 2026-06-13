import fs from 'fs';
import path from 'path';
import { getChatSession, getProject, getChatDir, getChatMessages, getProjectModels, getRequirementOutlines, insertRequirementOutline, insertRequirementSection, getRequirementSections, deleteRequirementOutlinesByChatId, deleteRequirementSectionsByChatId, updateRequirementOutlineStatus, updateRequirementOutlineLogs } from '@/lib/db';
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
    const currentChat = getChatSession(chatId);
    if (currentChat && !currentChat.running) {
      return;
    }
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
    const currentChat = getChatSession(chatId);
    if (currentChat && !currentChat.running) {
      return;
    }
    transitionTo(chatId, 'requirement', 'error');
  }
}

async function runWithLimit<T>(limit: number, items: T[], fn: (item: T) => Promise<void>): Promise<void> {
  const executing = new Set<Promise<void>>();
  for (const item of items) {
    const p = Promise.resolve().then(() => fn(item));
    executing.add(p);
    const clean = () => executing.delete(p);
    p.then(clean, clean);
    if (executing.size >= limit) {
      await Promise.race(executing);
    }
  }
  await Promise.all(executing);
}

async function handleSections(chatId: number, chatDir: string, repoDir: string, projectId: number): Promise<void> {
  loggerService.appendVerbose(chatId, 'workflow:requirement', `Stage 2: Requirement Section Generation`);

  deleteRequirementSectionsByChatId(chatId);

  const outlines = getRequirementOutlines(chatId);
  if (outlines.length === 0) {
    loggerService.appendVerbose(chatId, 'workflow:requirement', `No outlines found`);
    transitionTo(chatId, 'requirement', 'error');
    return;
  }

  // Reset status and logs in database
  for (const outline of outlines) {
    updateRequirementOutlineStatus(outline.id, 'pending');
    updateRequirementOutlineLogs(outline.id, '');
  }

  const progressMsg = `Generating requirement sections in batches of max 4 parallel sub-agents...`;
  stageWsManager.broadcastToStage(chatId, 'requirement', {
    type: 'sub_stage',
    sub_stage: 'sections',
    progress: progressMsg
  });

  const client = serveRegistry.getOrCreate(chatId, chatDir, process.env);
  await client.ensureStarted().catch((err) => {
    loggerService.appendVerbose(chatId, 'workflow:requirement', `Server start failed: ${err.message}`);
    const currentChat = getChatSession(chatId);
    if (currentChat && !currentChat.running) {
      return;
    }
    transitionTo(chatId, 'requirement', 'error');
    return;
  });

  const models = getProjectModels(projectId);

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
    path.join(process.cwd(), 'prompts', 'plan-requirement-section-runner.md'),
    'utf-8'
  );

  const sectionsDir = path.join(chatDir, 'requirement-sections');
  if (!fs.existsSync(sectionsDir)) {
    fs.mkdirSync(sectionsDir, { recursive: true });
  } else {
    // Clean existing files if any
    const files = fs.readdirSync(sectionsDir);
    for (const file of files) {
      try {
        fs.unlinkSync(path.join(sectionsDir, file));
      } catch (err) {
        // ignore
      }
    }
  }

  try {
    // Run outlines concurrently up to a limit of 4
    await runWithLimit(4, outlines, async (outline) => {
      updateRequirementOutlineStatus(outline.id, 'running');
      stageWsManager.broadcastToStage(chatId, 'requirement', {
        type: 'sub_stage',
        sub_stage: 'sections',
        progress: progressMsg
      });

      const sectionPrompt = promptTemplate
        .replace(/{CHAT_DIR}/g, chatDir)
        .replace(/{REPO_DIR}/g, repoDir)
        .replace(/{REPO_CONTEXT}/g, repoContext)
        .replace(/{CHAT_QA}/g, chatQA)
        .replace(/{SKILLS_DIR}/g, getSkillsDir())
        .replace(/{SECTION_INDEX}/g, String(outline.section_index))
        .replace(/{SECTION_TITLE}/g, outline.title)
        .replace(/{SECTION_SCOPE}/g, outline.scope);

      const sessionId = await client.createSession();

      // Periodically reconstruct and save logs to the database while running
      const interval = setInterval(async () => {
        try {
          const logs = await client.reconstructSessionLogs(sessionId);
          updateRequirementOutlineLogs(outline.id, logs);
          stageWsManager.broadcastToStage(chatId, 'requirement', {
            type: 'sub_stage',
            sub_stage: 'sections',
            progress: progressMsg
          });
        } catch {
          // ignore
        }
      }, 1000);

      try {
        await client.sendMessage(sessionId, sectionPrompt, models.requirement_model, true);
        
        clearInterval(interval);
        const finalLogs = await client.reconstructSessionLogs(sessionId);
        updateRequirementOutlineLogs(outline.id, finalLogs);

        const sectionFile = path.join(sectionsDir, `section-${outline.section_index}.md`);
        if (fs.existsSync(sectionFile)) {
          updateRequirementOutlineStatus(outline.id, 'completed');
        } else {
          loggerService.appendVerbose(chatId, 'workflow:requirement', `Section file missing for index ${outline.section_index} after sub-agent run`);
          updateRequirementOutlineStatus(outline.id, 'failed');
          throw new Error(`Section file section-${outline.section_index}.md was not generated`);
        }
      } catch (err) {
        clearInterval(interval);
        updateRequirementOutlineStatus(outline.id, 'failed');
        throw err;
      } finally {
        try {
          await client.deleteSession(sessionId);
        } catch {
          // ignore
        }
        stageWsManager.broadcastToStage(chatId, 'requirement', {
          type: 'sub_stage',
          sub_stage: 'sections',
          progress: progressMsg
        });
      }
    });

    // Sync generated section files from disk to the database
    const sectionContents: Array<{ outline: typeof outlines[number]; content: string }> = [];
    for (const outline of outlines) {
      const sectionFile = path.join(sectionsDir, `section-${outline.section_index}.md`);
      if (fs.existsSync(sectionFile)) {
        try {
          const content = fs.readFileSync(sectionFile, 'utf-8');
          insertRequirementSection({
            chat_id: chatId,
            outline_id: outline.id,
            content: content,
          });
          sectionContents.push({ outline, content });
        } catch (err) {
          loggerService.appendVerbose(chatId, 'workflow:requirement', `Failed to read section file for index ${outline.section_index}: ${err}`);
          transitionTo(chatId, 'requirement', 'error');
          return;
        }
      } else {
        loggerService.appendVerbose(chatId, 'workflow:requirement', `Section file missing for index ${outline.section_index}`);
        transitionTo(chatId, 'requirement', 'error');
        return;
      }
    }

    // Combine section files into REQUIREMENT.md on the backend.
    const combined = combineSectionMarkdowns(
      outlines.map((o) => ({ index: o.section_index, title: o.title, content: sectionContents.find((s) => s.outline.id === o.id)?.content ?? '' })),
    );
    const requirementPath = path.join(chatDir, 'REQUIREMENT.md');
    fs.writeFileSync(requirementPath, combined, 'utf-8');
    loggerService.appendVerbose(chatId, 'workflow:requirement', `REQUIREMENT.md written (${combined.length} chars, ${outlines.length} sections combined)`);

    loggerService.appendVerbose(chatId, 'workflow:requirement', `All sections synced. REQUIREMENT.md verified. Requirement ready.`);
    transitionTo(chatId, 'requirement', 'requirement');
    stageWsManager.broadcastToStage(chatId, 'requirement', { type: 'sub_stage', sub_stage: 'requirement', progress: `Requirement` });
  } catch (err) {
    loggerService.appendVerbose(chatId, 'workflow:requirement', `Requirement sections orchestration failed: ${err}`);
    const currentChat = getChatSession(chatId);
    if (currentChat && !currentChat.running) {
      return;
    }
    transitionTo(chatId, 'requirement', 'error');
  }
}

function normalizeHeadingSpacing(md: string): string {
  // Fix common LLM mistake: `##Heading` -> `## Heading`
  return md.replace(/^(#{1,6})([^\s#])/gm, '$1 $2');
}

/**
 * Combine per-section markdown files into a single REQUIREMENT.md.
 *
 * Contract (set by plan-requirement-section-runner.md):
 * - Each section-N.md starts with `## <Section Title>` on line 1.
 * - Body is in natural-language prose, no SRS-…/NFR-…/AC-… numbering.
 * - Each section's final sub-heading is `### Acceptance Criteria` with bullets.
 *
 * This combiner:
 * - Prepends `# Requirements Document`.
 * - Demotes each section's leading `##` so it becomes a top-level `##`
 *   section under the document title.
 * - Joins with blank lines and collapses runs of >2 newlines.
 */
function combineSectionMarkdowns(sections: Array<{ index: number; title: string; content: string }>): string {
  const parts: string[] = ['# Requirements Document', ''];

  for (const section of sections) {
    if (!section.content) continue;

    let body = normalizeHeadingSpacing(section.content).replace(/\r\n/g, '\n').trim();

    // Demote the section's leading `## <Title>` (or any leading H1/H2) by one level
    // so it nests under `# Requirements Document` as a top-level `##` section.
    body = body.replace(/^(#{1,2})\s+(.+?)\s*$/m, (_, hashes: string, title: string) => {
      return `## ${title.trim()}`;
    });

    parts.push(body, '');
  }

  return parts.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}

async function handleGenerate(chatId: number, chatDir: string): Promise<void> {
  loggerService.appendVerbose(chatId, 'workflow:requirement', `Legacy handleGenerate called, transitioning to requirement`);
  transitionTo(chatId, 'requirement', 'requirement');
  stageWsManager.broadcastToStage(chatId, 'requirement', { type: 'sub_stage', sub_stage: 'requirement', progress: `Requirement` });
}

