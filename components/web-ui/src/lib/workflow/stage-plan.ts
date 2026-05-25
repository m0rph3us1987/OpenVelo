import fs from 'fs';
import path from 'path';
import { getChatSession, getProject, getChatDir, getProjectModels, getPlanEpics, getPlanEpicWithoutFeatures, insertPlanEpic, insertPlanFeature, insertPlanStory, getPlanFeatures, getPlanStories, updatePlanStoryDependsOn, deletePlanDataByChatId, deletePlanFeature } from '@/lib/db';
import { serveRegistry } from '@/lib/opencode-serve-registry';
import { transitionTo } from './index';
import { stageWsManager } from '@/lib/stage-ws-manager';
import { loggerService } from '@/lib/logger-service';
import { getSkillsDir } from '@/lib/skills';

// Manifest types — small JSON the LLM returns in its response text
interface EpicManifest {
  build_cmd: string;
  test_cmd: string;
  epic_files: string[];
}

interface FeatureManifest {
  feature_files: string[];
}

interface StoryManifest {
  story_files: string[];
}

interface DependencyManifest {
  dependency_file: string;
}

// File content types — what each individual JSON file on disk contains
interface EpicFileContent {
  index: number;
  title: string;
  description: string;
  content: string;
}

interface FeatureFileContent {
  epic_index: number;
  epic_title: string;
  feature_index: number;
  title: string;
  description: string;
  content: string;
}

interface StoryFileContent {
  epic_index: number;
  epic_title: string;
  feature_index: number;
  feature_title: string;
  story_index: number;
  title: string;
  description: string;
  acceptance_criteria: string;
}

interface DependenciesResult {
  dependencies: Array<{
    story_title: string;
    depends_on: string[];
  }>;
}

function readPlanFile<T>(planDir: string, filename: string, chatId: number): T | null {
  const filePath = path.join(planDir, filename);
  if (!fs.existsSync(filePath)) {
    loggerService.appendVerbose(chatId, 'workflow:plan', `Plan file not found: ${filePath}`);
    return null;
  }
  try {
    const content = fs.readFileSync(filePath, 'utf-8').trim();
    return JSON.parse(content) as T;
  } catch (err) {
    loggerService.appendVerbose(chatId, 'workflow:plan', `Failed to parse plan file ${filePath}: ${err}`);
    return null;
  }
}

function ensurePlanDir(chatDir: string): string {
  const planDir = path.join(chatDir, 'plan');
  if (!fs.existsSync(planDir)) {
    fs.mkdirSync(planDir, { recursive: true });
  }
  return planDir;
}

function cleanPlanDir(planDir: string): void {
  if (fs.existsSync(planDir)) {
    const files = fs.readdirSync(planDir);
    for (const file of files) {
      fs.unlinkSync(path.join(planDir, file));
    }
  }
}

async function parseJsonWithRetry<T>(
  client: { sendMessage: (sessionId: string, prompt: string, model: string) => Promise<{ parts: Array<{ type: string; text?: string }> }> },
  sessionId: string,
  resultText: string,
  expectedKey: string,
  modelKey: keyof { analyzer_model: string; planning_model: string; requirement_model: string; chat_model: string },
  models: { analyzer_model: string; planning_model: string; requirement_model: string; chat_model: string },
  maxAttempts: number = 3
): Promise<{ parsed: T | null; finalText: string }> {
  const extractJson = (text: string): T | null => {
    // Strip markdown code fences if present
    const stripped = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();

    try {
      return JSON.parse(stripped) as T;
    } catch {
      const jsonMatch = stripped.match(new RegExp(`\\{[\\s\\S]*"${expectedKey}"[\\s\\S]*\\}`));
      if (jsonMatch) {
        try {
          return JSON.parse(jsonMatch[0]) as T;
        } catch {
          return null;
        }
      }
      return null;
    }
  };

  const parsed = extractJson(resultText);
  if (parsed) {
    return { parsed, finalText: resultText };
  }

  const correctionModel = models[modelKey];

  for (let attempt = 1; attempt < maxAttempts; attempt++) {
    loggerService.appendVerbose(0, 'workflow:plan', `JSON parse failed, attempt ${attempt}/${maxAttempts}, requesting correction`);
    const correctionPrompt = `The JSON you returned was malformed or incomplete. Return ONLY valid JSON with no additional text. Previous response was:\n${resultText.substring(0, 2000)}\n\nReturn only the corrected JSON.`;

    try {
      const corrected = await client.sendMessage(sessionId, correctionPrompt, correctionModel);
      const correctedText = corrected.parts.find((p: { type?: string }) => p.type === 'text')?.text?.trim() ?? '';
      const correctedParsed = extractJson(correctedText);
      if (correctedParsed) {
        return { parsed: correctedParsed, finalText: correctedText };
      }
    } catch (err) {
      loggerService.appendVerbose(0, 'workflow:plan', `Correction request failed: ${err}`);
    }
  }

  return { parsed: null, finalText: resultText };
}

export async function handlePlan(chatId: number): Promise<void> {
  loggerService.appendVerbose(chatId, 'workflow:plan', `Initializing`);
  const chat = getChatSession(chatId);
  if (!chat) {
    loggerService.appendVerbose(chatId, 'workflow:plan', `Chat ${chatId} not found`);
    return;
  }

  const chatDir = getChatDir(chatId, chat.project_id);
  const project = getProject(chat.project_id);
  if (!project) {
    loggerService.appendVerbose(chatId, 'workflow:plan', `Project ${chat.project_id} not found`);
    return;
  }

  const repoDir = path.join(chatDir, 'repository');

  if (!fs.existsSync(chatDir) || !fs.existsSync(repoDir)) {
    loggerService.appendVerbose(chatId, 'workflow:plan', `chat dir or repo dir missing`);
    transitionTo(chatId, 'plan', 'error');
    return;
  }

  if (chat.sub_stage === '') {
    loggerService.appendVerbose(chatId, 'workflow:plan', `Starting plan generation`);
    transitionTo(chatId, 'plan', 'epics');
    stageWsManager.broadcastToStage(chatId, 'plan', { type: 'sub_stage', sub_stage: 'epics' });
    return;
  }

  if (chat.sub_stage === 'epics') {
    await handleEpics(chatId, chatDir, repoDir, project.id);
    return;
  }

  if (chat.sub_stage === 'features') {
    await handleFeatures(chatId, chatDir, repoDir, project.id);
    return;
  }

  if (chat.sub_stage === 'stories') {
    await handleStories(chatId, chatDir, repoDir, project.id);
    return;
  }

  if (chat.sub_stage === 'dependencies') {
    await handleDependencies(chatId, chatDir, repoDir, project.id);
    return;
  }

  if (chat.sub_stage === 'plan') {
    loggerService.appendVerbose(chatId, 'workflow:plan', `Plan ready - waiting for user`);
    return;
  }

  if (chat.sub_stage === 'error') {
    loggerService.appendVerbose(chatId, 'workflow:plan', `Error state`);
    return;
  }
}

async function handleEpics(chatId: number, chatDir: string, repoDir: string, projectId: number): Promise<void> {
  loggerService.appendVerbose(chatId, 'workflow:plan', `Generating epics`);

  deletePlanDataByChatId(chatId);

  const planDir = ensurePlanDir(chatDir);
  cleanPlanDir(planDir);

  const client = serveRegistry.getOrCreate(chatId, chatDir, process.env);

  await client.ensureStarted().catch((err) => {
    loggerService.appendVerbose(chatId, 'workflow:plan', `Server start failed: ${err.message}`);
    transitionTo(chatId, 'plan', 'error');
    return;
  });

  const models = getProjectModels(projectId);
  const sessionId = await client.createSession();
  serveRegistry.setSession(chatId, 'plan-epics', sessionId);

  const repoContextPath = path.join(repoDir, 'REPOSITORY.md');
  let repoContext = '';
  if (fs.existsSync(repoContextPath)) {
    repoContext = fs.readFileSync(repoContextPath, 'utf-8');
  }

  const requirementPath = path.join(chatDir, 'REQUIREMENT.md');
  if (!fs.existsSync(requirementPath)) {
    loggerService.appendVerbose(chatId, 'workflow:plan', `REQUIREMENT.md not found`);
    transitionTo(chatId, 'plan', 'error');
    return;
  }

  const promptTemplate = fs.readFileSync(
    path.join(process.cwd(), 'prompts', 'plan-epic.md'),
    'utf-8'
  );

  const prompt = promptTemplate
    .replace(/{CHAT_DIR}/g, chatDir)
    .replace(/{REPO_DIR}/g, repoDir)
    .replace(/{UPLOAD_DIR}/g, path.join(chatDir, 'uploads'))
    .replace(/{REPO_CONTEXT}/g, repoContext)
    .replace(/{REQUIREMENT_MD_PATH}/g, requirementPath)
    .replace(/{SKILLS_DIR}/g, getSkillsDir());

  loggerService.appendVerbose(chatId, 'workflow:plan', 'Sending epic prompt');

  try {
    const result = await client.sendMessage(sessionId, prompt, models.planning_model);

    const textPart = result.parts.find((p: { type?: string }) => p.type === 'text');
    const resultText = textPart?.text?.trim() ?? '';

    const { parsed, finalText } = await parseJsonWithRetry<EpicManifest>(
      client, sessionId, resultText, 'epic_files', 'planning_model', models
    );

    if (!parsed) {
      loggerService.appendVerbose(chatId, 'workflow:plan', `Failed to parse epic manifest JSON after retries. Raw response: ${finalText}`);
      transitionTo(chatId, 'plan', 'error');
      return;
    }

    if (!parsed.epic_files || !Array.isArray(parsed.epic_files) || parsed.epic_files.length === 0) {
      loggerService.appendVerbose(chatId, 'workflow:plan', `Invalid epic manifest: no epic_files found`);
      transitionTo(chatId, 'plan', 'error');
      return;
    }

    for (const filename of parsed.epic_files) {
      const epic = readPlanFile<EpicFileContent>(planDir, filename, chatId);
      if (!epic) {
        loggerService.appendVerbose(chatId, 'workflow:plan', `Failed to read epic file: ${filename}`);
        transitionTo(chatId, 'plan', 'error');
        return;
      }
      insertPlanEpic({
        chat_id: chatId,
        epic_index: epic.index,
        title: epic.title,
        description: epic.description,
        content: epic.content,
        build_cmd: parsed.build_cmd || '',
        test_cmd: parsed.test_cmd || '',
      });
    }

    loggerService.appendVerbose(chatId, 'workflow:plan', `Generated ${parsed.epic_files.length} epics`);
    transitionTo(chatId, 'plan', 'features');
    stageWsManager.broadcastToStage(chatId, 'plan', { type: 'sub_stage', sub_stage: 'features' });
  } catch (err) {
    loggerService.appendVerbose(chatId, 'workflow:plan', `sendMessage failed: ${err}`);
    transitionTo(chatId, 'plan', 'error');
  }
}

async function handleFeatures(chatId: number, chatDir: string, repoDir: string, projectId: number): Promise<void> {
  const epics = getPlanEpics(chatId);
  if (epics.length === 0) {
    loggerService.appendVerbose(chatId, 'workflow:plan', `No epics found`);
    transitionTo(chatId, 'plan', 'error');
    return;
  }

  const planDir = ensurePlanDir(chatDir);
  const client = serveRegistry.getOrCreate(chatId, chatDir, process.env);

  await client.ensureStarted().catch((err) => {
    loggerService.appendVerbose(chatId, 'workflow:plan', `Server start failed: ${err.message}`);
    transitionTo(chatId, 'plan', 'error');
    return;
  });

  const models = getProjectModels(projectId);
  const sessionId = await client.createSession();
  serveRegistry.setSession(chatId, 'plan-features', sessionId);

  const repoContextPath = path.join(repoDir, 'REPOSITORY.md');
  let repoContext = '';
  if (fs.existsSync(repoContextPath)) {
    repoContext = fs.readFileSync(repoContextPath, 'utf-8');
  }

  const requirementPath = path.join(chatDir, 'REQUIREMENT.md');
  if (!fs.existsSync(requirementPath)) {
    loggerService.appendVerbose(chatId, 'workflow:plan', `REQUIREMENT.md not found`);
    transitionTo(chatId, 'plan', 'error');
    return;
  }

  const promptTemplate = fs.readFileSync(
    path.join(process.cwd(), 'prompts', 'plan-feature.md'),
    'utf-8'
  );

  while (true) {
    const epic = getPlanEpicWithoutFeatures(chatId);
    if (!epic) {
      loggerService.appendVerbose(chatId, 'workflow:plan', `All features generated, transitioning to stories`);
      transitionTo(chatId, 'plan', 'stories');
      stageWsManager.broadcastToStage(chatId, 'plan', { type: 'sub_stage', sub_stage: 'stories' });
      return;
    }

    const currentIndex = epics.findIndex(e => e.id === epic.id) + 1;
    loggerService.appendVerbose(chatId, 'workflow:plan', `Generating features for epic ${currentIndex}/${epics.length}: ${epic.title}`);

    stageWsManager.broadcastToStage(chatId, 'plan', {
      type: 'sub_stage',
      sub_stage: 'features',
      progress: `Generating features for ${epic.title} (${currentIndex}/${epics.length})`
    });

    // Build existing features context for deduplication
    const existingFeatures = getPlanFeatures(chatId);
    let existingFeaturesText = 'None yet.';
    if (existingFeatures.length > 0) {
      existingFeaturesText = existingFeatures
        .map(f => {
          const parentEpic = epics.find(e => e.id === f.epic_id);
          return `- [Epic: ${parentEpic?.title || 'Unknown'}] Feature: ${f.title} — ${f.description}`;
        })
        .join('\n');
    }

    const prompt = promptTemplate
      .replace(/{CHAT_DIR}/g, chatDir)
      .replace(/{REPO_DIR}/g, repoDir)
      .replace(/{UPLOAD_DIR}/g, path.join(chatDir, 'uploads'))
      .replace(/{REPO_CONTEXT}/g, repoContext)
      .replace(/{REQUIREMENT_MD_PATH}/g, requirementPath)
      .replace(/{SKILLS_DIR}/g, getSkillsDir())
      .replace(/{EPIC_INDEX}/g, String(epic.epic_index))
      .replace(/{EPIC_TITLE}/g, epic.title)
      .replace(/\{EPIC_CONTENT\}/g, epic.content)
      .replace(/\{EXISTING_FEATURES\}/g, existingFeaturesText);

    loggerService.appendVerbose(chatId, 'workflow:plan', `Sending feature prompt for ${epic.title}`);

    try {
      const result = await client.sendMessage(sessionId, prompt, models.planning_model);

      const textPart = result.parts.find((p: { type?: string }) => p.type === 'text');
      const resultText = textPart?.text?.trim() ?? '';

      const { parsed, finalText } = await parseJsonWithRetry<FeatureManifest>(
        client, sessionId, resultText, 'feature_files', 'planning_model', models
      );

      if (!parsed) {
        loggerService.appendVerbose(chatId, 'workflow:plan', `Failed to parse feature manifest JSON after retries. Raw response: ${finalText}`);
        transitionTo(chatId, 'plan', 'error');
        return;
      }

      if (!parsed.feature_files || !Array.isArray(parsed.feature_files) || parsed.feature_files.length === 0) {
        loggerService.appendVerbose(chatId, 'workflow:plan', `Invalid feature manifest: no feature_files found for epic ${epic.title}`);
        transitionTo(chatId, 'plan', 'error');
        return;
      }

      for (const filename of parsed.feature_files) {
        const feature = readPlanFile<FeatureFileContent>(planDir, filename, chatId);
        if (!feature) {
          loggerService.appendVerbose(chatId, 'workflow:plan', `Failed to read feature file: ${filename}`);
          transitionTo(chatId, 'plan', 'error');
          return;
        }
        insertPlanFeature({
          chat_id: chatId,
          epic_id: epic.id,
          feature_index: feature.feature_index,
          title: feature.title,
          description: feature.description,
          content: feature.content,
        });
      }

      loggerService.appendVerbose(chatId, 'workflow:plan', `Generated ${parsed.feature_files.length} features for epic ${epic.title}`);
    } catch (err) {
      loggerService.appendVerbose(chatId, 'workflow:plan', `sendMessage failed: ${err}`);
      transitionTo(chatId, 'plan', 'error');
      return;
    }
  }
}

async function handleStories(chatId: number, chatDir: string, repoDir: string, projectId: number): Promise<void> {
  const allFeatures = getPlanFeatures(chatId);
  if (allFeatures.length === 0) {
    loggerService.appendVerbose(chatId, 'workflow:plan', `No features found`);
    transitionTo(chatId, 'plan', 'error');
    return;
  }

  const planDir = ensurePlanDir(chatDir);
  const client = serveRegistry.getOrCreate(chatId, chatDir, process.env);

  await client.ensureStarted().catch((err) => {
    loggerService.appendVerbose(chatId, 'workflow:plan', `Server start failed: ${err.message}`);
    transitionTo(chatId, 'plan', 'error');
    return;
  });

  const models = getProjectModels(projectId);
  const sessionId = await client.createSession();
  serveRegistry.setSession(chatId, 'plan-stories', sessionId);

  const repoContextPath = path.join(repoDir, 'REPOSITORY.md');
  let repoContext = '';
  if (fs.existsSync(repoContextPath)) {
    repoContext = fs.readFileSync(repoContextPath, 'utf-8');
  }

  const requirementPath = path.join(chatDir, 'REQUIREMENT.md');
  if (!fs.existsSync(requirementPath)) {
    loggerService.appendVerbose(chatId, 'workflow:plan', `REQUIREMENT.md not found`);
    transitionTo(chatId, 'plan', 'error');
    return;
  }

  const epics = getPlanEpics(chatId);

  const promptTemplate = fs.readFileSync(
    path.join(process.cwd(), 'prompts', 'plan-story.md'),
    'utf-8'
  );

  for (let i = 0; i < allFeatures.length; i++) {
    const feature = allFeatures[i];

    loggerService.appendVerbose(chatId, 'workflow:plan', `Generating stories for feature ${i + 1}/${allFeatures.length}: ${feature.title}`);

    stageWsManager.broadcastToStage(chatId, 'plan', {
      type: 'sub_stage',
      sub_stage: 'stories',
      progress: `Generating stories for ${feature.title} (${i + 1}/${allFeatures.length})`
    });

    const epic = epics.find(e => e.id === feature.epic_id);

    // Build existing stories context for deduplication
    const existingStories = getPlanStories(chatId);
    let existingStoriesText = 'None yet.';
    if (existingStories.length > 0) {
      existingStoriesText = existingStories
        .map(s => {
          const parentFeature = allFeatures.find(f => f.id === s.feature_id);
          const parentEpic = epics.find(e => e.id === parentFeature?.epic_id);
          return `- [Epic: ${parentEpic?.title || 'Unknown'} > Feature: ${parentFeature?.title || 'Unknown'}] Story: ${s.title}`;
        })
        .join('\n');
    }

    const prompt = promptTemplate
      .replace(/{CHAT_DIR}/g, chatDir)
      .replace(/{REPO_DIR}/g, repoDir)
      .replace(/{UPLOAD_DIR}/g, path.join(chatDir, 'uploads'))
      .replace(/{REPO_CONTEXT}/g, repoContext)
      .replace(/{REQUIREMENT_MD_PATH}/g, requirementPath)
      .replace(/{SKILLS_DIR}/g, getSkillsDir())
      .replace(/{EPIC_INDEX}/g, String(epic?.epic_index || 0))
      .replace(/{EPIC_TITLE}/g, epic?.title || '')
      .replace(/{FEATURE_INDEX}/g, String(feature.feature_index))
      .replace(/{FEATURE_TITLE}/g, feature.title)
      .replace(/\{FEATURE_CONTENT\}/g, feature.content)
      .replace(/\{EXISTING_STORIES\}/g, existingStoriesText);

    loggerService.appendVerbose(chatId, 'workflow:plan', `Sending story prompt for ${feature.title}`);

    try {
      const result = await client.sendMessage(sessionId, prompt, models.planning_model);

      const textPart = result.parts.find((p: { type?: string }) => p.type === 'text');
      const resultText = textPart?.text?.trim() ?? '';

      const { parsed, finalText } = await parseJsonWithRetry<StoryManifest>(
        client, sessionId, resultText, 'story_files', 'planning_model', models
      );

      if (!parsed) {
        loggerService.appendVerbose(chatId, 'workflow:plan', `Failed to parse story manifest JSON after retries. Raw response: ${finalText}`);
        transitionTo(chatId, 'plan', 'error');
        return;
      }

      if (!parsed.story_files || !Array.isArray(parsed.story_files) || parsed.story_files.length === 0) {
        loggerService.appendVerbose(chatId, 'workflow:plan', `No story files found for feature ${feature.title}, deleting feature`);
        deletePlanFeature(feature.id);
        continue;
      }

      for (const filename of parsed.story_files) {
        const story = readPlanFile<StoryFileContent>(planDir, filename, chatId);
        if (!story) {
          loggerService.appendVerbose(chatId, 'workflow:plan', `Failed to read story file: ${filename}`);
          transitionTo(chatId, 'plan', 'error');
          return;
        }
        insertPlanStory({
          chat_id: chatId,
          feature_id: feature.id,
          story_index: story.story_index,
          title: story.title,
          description: story.description,
          acceptance_criteria: story.acceptance_criteria,
          depends_on: '[]',
        });
      }

      loggerService.appendVerbose(chatId, 'workflow:plan', `Generated ${parsed.story_files.length} stories for feature ${feature.title}`);
    } catch (err) {
      loggerService.appendVerbose(chatId, 'workflow:plan', `sendMessage failed: ${err}`);
      transitionTo(chatId, 'plan', 'error');
      return;
    }
  }

  loggerService.appendVerbose(chatId, 'workflow:plan', `All stories generated, transitioning to dependencies`);
  transitionTo(chatId, 'plan', 'dependencies');
  stageWsManager.broadcastToStage(chatId, 'plan', {
    type: 'sub_stage',
    sub_stage: 'dependencies'
  });
}

async function handleDependencies(chatId: number, chatDir: string, repoDir: string, projectId: number): Promise<void> {
  loggerService.appendVerbose(chatId, 'workflow:plan', `Resolving dependencies`);

  stageWsManager.broadcastToStage(chatId, 'plan', {
    type: 'sub_stage',
    sub_stage: 'dependencies',
    progress: `Solving dependencies...`
  });

  const stories = getPlanStories(chatId);
  if (stories.length === 0) {
    loggerService.appendVerbose(chatId, 'workflow:plan', `No stories found`);
    transitionTo(chatId, 'plan', 'error');
    return;
  }

  const client = serveRegistry.getOrCreate(chatId, chatDir, process.env);

  await client.ensureStarted().catch((err) => {
    loggerService.appendVerbose(chatId, 'workflow:plan', `Server start failed: ${err.message}`);
    transitionTo(chatId, 'plan', 'error');
    return;
  });

  const models = getProjectModels(projectId);
  const sessionId = await client.createSession();
  serveRegistry.setSession(chatId, 'plan-deps', sessionId);

  const repoContextPath = path.join(repoDir, 'REPOSITORY.md');
  let repoContext = '';
  if (fs.existsSync(repoContextPath)) {
    repoContext = fs.readFileSync(repoContextPath, 'utf-8');
  }

  const requirementPath = path.join(chatDir, 'REQUIREMENT.md');
  if (!fs.existsSync(requirementPath)) {
    loggerService.appendVerbose(chatId, 'workflow:plan', `REQUIREMENT.md not found`);
    transitionTo(chatId, 'plan', 'error');
    return;
  }

  const storiesJson = JSON.stringify(stories.map(s => ({
    id: s.id,
    title: s.title,
    description: s.description,
    content: s.description
  })), null, 2);

  const promptTemplate = fs.readFileSync(
    path.join(process.cwd(), 'prompts', 'plan-dependencies.md'),
    'utf-8'
  );

  const prompt = promptTemplate
    .replace(/{CHAT_DIR}/g, chatDir)
    .replace(/{REPO_DIR}/g, repoDir)
    .replace(/{SKILLS_DIR}/g, getSkillsDir())
    .replace(/{UPLOAD_DIR}/g, path.join(chatDir, 'uploads'))
    .replace(/{REPO_CONTEXT}/g, repoContext)
    .replace(/{REQUIREMENT_MD_PATH}/g, requirementPath)
    .replace(/{ALL_STORIES_JSON}/g, storiesJson);

  loggerService.appendVerbose(chatId, 'workflow:plan', 'Sending dependency prompt');

  try {
    const result = await client.sendMessage(sessionId, prompt, models.planning_model);

    const textPart = result.parts.find((p: { type?: string }) => p.type === 'text');
    const resultText = textPart?.text?.trim() ?? '';

    const { parsed, finalText } = await parseJsonWithRetry<DependencyManifest>(
      client, sessionId, resultText, 'dependency_file', 'planning_model', models
    );

    if (!parsed) {
      loggerService.appendVerbose(chatId, 'workflow:plan', `Failed to parse dependency manifest JSON after retries. Raw response: ${finalText}`);
      transitionTo(chatId, 'plan', 'error');
      return;
    }

    if (!parsed.dependency_file) {
      loggerService.appendVerbose(chatId, 'workflow:plan', `Invalid dependency manifest`);
      transitionTo(chatId, 'plan', 'error');
      return;
    }

    const planDir = ensurePlanDir(chatDir);
    const depResult = readPlanFile<DependenciesResult>(planDir, parsed.dependency_file, chatId);
    if (!depResult) {
      loggerService.appendVerbose(chatId, 'workflow:plan', `Failed to read dependency file: ${parsed.dependency_file}`);
      transitionTo(chatId, 'plan', 'error');
      return;
    }

    if (!depResult.dependencies || !Array.isArray(depResult.dependencies)) {
      loggerService.appendVerbose(chatId, 'workflow:plan', `Invalid dependency result in file`);
      transitionTo(chatId, 'plan', 'error');
      return;
    }

    // Build positional index map: title -> array index (matches order sent to LLM)
    const storyIndexByTitle = new Map(stories.map((s, i) => [s.title, i]));
    const storyByTitle = new Map(stories.map(s => [s.title, s]));

    for (const dep of depResult.dependencies) {
      const story = storyByTitle.get(dep.story_title);
      if (!story) continue;

      const storyIndex = storyIndexByTitle.get(dep.story_title) ?? -1;
      const rawDeps: string[] = dep.depends_on || [];

      // Defensive sanitization: strip any dep that points to itself, a forward index,
      // or an unknown title. A story at index i may only depend on stories at index j < i.
      const sanitizedDeps = rawDeps.filter(depTitle => {
        const depIndex = storyIndexByTitle.get(depTitle);
        if (depIndex === undefined) {
          loggerService.appendVerbose(chatId, 'workflow:plan', `Removed unknown dependency edge: "${dep.story_title}" -> "${depTitle}"`);
          return false;
        }
        if (depIndex >= storyIndex) {
          loggerService.appendVerbose(chatId, 'workflow:plan', `Removed invalid dependency edge (forward/self): "${dep.story_title}" [${storyIndex}] -> "${depTitle}" [${depIndex}]`);
          return false;
        }
        return true;
      });

      updatePlanStoryDependsOn(story.id, JSON.stringify(sanitizedDeps));
    }

    loggerService.appendVerbose(chatId, 'workflow:plan', `Resolved ${depResult.dependencies.length} dependencies`);
    transitionTo(chatId, 'plan', 'plan');
    stageWsManager.broadcastToStage(chatId, 'plan', { type: 'sub_stage', sub_stage: 'plan', progress: `Plan` });
  } catch (err) {
    loggerService.appendVerbose(chatId, 'workflow:plan', `sendMessage failed: ${err}`);
    transitionTo(chatId, 'plan', 'error');
  }
}
