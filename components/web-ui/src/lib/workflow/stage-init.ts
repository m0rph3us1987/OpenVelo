import fs from 'fs';
import path from 'path';
import { getChatSession, getProject, getChatDir } from '@/lib/db';
import { serveRegistry } from '@/lib/opencode-serve-registry';
import { transitionTo } from './index';
import { stageWsManager } from '@/lib/stage-ws-manager';
import { loggerService } from '@/lib/logger-service';

export async function handleInit(chatId: number): Promise<void> {
  const chat = getChatSession(chatId);
  if (!chat) {
    loggerService.appendVerbose(chatId, 'workflow:init', `Chat ${chatId} not found`);
    return;
  }

  loggerService.appendVerbose(chatId, 'workflow:init', `Starting init for chat ${chatId}`);

  const chatDir = getChatDir(chatId, chat.project_id);
  const project = getProject(chat.project_id);

  if (!project) {
    loggerService.appendVerbose(chatId, 'workflow:init', `Project ${chat.project_id} not found for chat ${chatId}`);
    return;
  }

  transitionTo(chatId, 'init', 'preparing');
  stageWsManager.broadcastToStage(chatId, 'init', { type: 'sub_stage', sub_stage: 'preparing' });
  transitionTo(chatId, 'init', 'cloning');
  stageWsManager.broadcastToStage(chatId, 'init', { type: 'sub_stage', sub_stage: 'cloning' });
  transitionTo(chatId, 'init', 'mounting');
  stageWsManager.broadcastToStage(chatId, 'init', { type: 'sub_stage', sub_stage: 'mounting' });

  if (!project.repo_url) {
    loggerService.appendVerbose(chatId, 'workflow:init', `No repo_url for project ${chat.project_id}`);
    return;
  }

  const uploadsDir = path.join(chatDir, 'uploads');
  fs.mkdirSync(uploadsDir, { recursive: true });

  const dbPath = process.env.OPENVELO_DB_PATH;
  const whitelistedPaths: Record<string, string> = {
    '/openvelo/data/SKILLS': 'allow',
    '/openvelo/data/SKILLS/**': 'allow',
    'C:\\openvelo\\data\\SKILLS': 'allow',
    'C:\\openvelo\\data\\SKILLS\\**': 'allow',
    '/tmp': 'allow',
    '/tmp/**': 'allow'
  };

  if (dbPath) {
    const resolvedSkills = path.join(path.dirname(dbPath), 'SKILLS');
    whitelistedPaths[resolvedSkills] = 'allow';
    whitelistedPaths[`${resolvedSkills}/**`] = 'allow';
    whitelistedPaths[`${resolvedSkills}\\**`] = 'allow';
  } else {
    const localSkills = path.resolve(process.cwd(), 'data', 'SKILLS');
    whitelistedPaths[localSkills] = 'allow';
    whitelistedPaths[`${localSkills}/**`] = 'allow';
    whitelistedPaths[`${localSkills}\\**`] = 'allow';
    const parentSkills = path.resolve(process.cwd(), '..', '..', 'data', 'SKILLS');
    whitelistedPaths[parentSkills] = 'allow';
    whitelistedPaths[`${parentSkills}/**`] = 'allow';
    whitelistedPaths[`${parentSkills}\\**`] = 'allow';
  }

  const permissions = {
    "read": "allow",
    "write": "allow",
    "edit": "allow",
    "delete": "allow",
    "move": "allow",
    "search": "allow",
    "execute": "allow",
    "think": "allow",
    "fetch": "allow",
    "switch_mode": "allow",
    "bash": "allow",
    "grep": "allow",
    "glob": "allow",
    "todowrite": "allow",
    // Deny subagent spawning. The `task` tool launches a nested subagent
    // session whose work is opaque and produces no visible output for long
    // stretches — observed to hang phases (a pending `other`-kind tool call
    // that never completes). Kilo surfaces the deny as a normal tool
    // rejection, so the LLM falls back to direct tools instead.
    "task": "deny",
    "ask_user": "allow",
    "question": "deny",
    "*": "allow",
    "external_directory": whitelistedPaths
  };

  const agentConfig: Record<string, { permission: unknown }> = {};
  const agentsList = ['plan', 'code', 'build', 'general', 'explore', 'ask'];
  for (const name of agentsList) {
    agentConfig[name] = { permission: permissions };
  }

  const opencodeConfigPath = path.join(chatDir, 'opencode.json');
  fs.writeFileSync(opencodeConfigPath, JSON.stringify({
    "$schema": "https://opencode.ai/config.json",
    "permission": permissions,
    "agent": agentConfig
  }, null, 2));

  const kiloConfigPath = path.join(chatDir, 'kilo.json');
  fs.writeFileSync(kiloConfigPath, JSON.stringify({
    "$schema": "https://kilo.ai/config.json",
    "permission": permissions,
    "agent": agentConfig
  }, null, 2));

  transitionTo(chatId, 'init', 'starting');
  stageWsManager.broadcastToStage(chatId, 'init', { type: 'sub_stage', sub_stage: 'starting' });
  const client = serveRegistry.getOrCreate(chatId, chatDir, process.env);
  await client.ensureStarted();
  transitionTo(chatId, 'analyzing', '');
}
