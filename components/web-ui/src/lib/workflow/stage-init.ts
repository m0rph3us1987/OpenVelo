import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
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

  // Step 1: Delete entire chatDir if it exists
  loggerService.appendVerbose(chatId, 'workflow:init', `Cleaning up chat directory: ${chatDir}`);
  if (fs.existsSync(chatDir)) {
    fs.rmSync(chatDir, { recursive: true, force: true });
  }

  // Step 2: Update sub_stage to 'cloning'
  transitionTo(chatId, 'init', 'cloning');
  stageWsManager.broadcastToStage(chatId, 'init', { type: 'sub_stage', sub_stage: 'cloning' });

  // Step 3: Clone repository
  const repoUrl = project.repo_url;
  if (!repoUrl) {
    loggerService.appendVerbose(chatId, 'workflow:init', `No repo_url for project ${chat.project_id}`);
    return;
  }

  const repoDir = path.join(chatDir, 'repository');
  fs.mkdirSync(repoDir, { recursive: true });

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

  const opencodeConfigPath = path.join(chatDir, 'opencode.json');
  fs.writeFileSync(opencodeConfigPath, JSON.stringify({
    "$schema": "https://opencode.ai/config.json",
    "permission": {
      "*": "allow",
      "ask_user": "deny",
      "question": "deny",
      "external_directory": whitelistedPaths
    }
  }, null, 2));

  const kiloConfigPath = path.join(chatDir, 'kilo.json');
  fs.writeFileSync(kiloConfigPath, JSON.stringify({
    "$schema": "https://kilo.ai/config.json",
    "permission": {
      "*": "allow",
      "ask_user": "deny",
      "question": "deny",
      "external_directory": whitelistedPaths
    }
  }, null, 2));

  loggerService.appendVerbose(chatId, 'workflow:init', `Cloning repository to ${repoDir}`);

  // Use git clone
  const gitArgs = ['clone'];
  if (project.repo_pat) {
    const urlWithCreds = addPatToUrl(repoUrl, project.repo_pat, project.repo_host);
    gitArgs.push(urlWithCreds, repoDir);
  } else {
    gitArgs.push(repoUrl, repoDir);
  }

  return new Promise((resolve, reject) => {
    const proc = spawn('git', gitArgs, {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stderr = '';
    proc.stderr?.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    proc.on('close', (code) => {
      if (code !== 0) {
        loggerService.appendVerbose(chatId, 'workflow:init', `git clone failed: ${stderr}`);
        reject(new Error(`git clone failed with code ${code}`));
        return;
      }

      loggerService.appendVerbose(chatId, 'workflow:init', `Repository cloned successfully`);

      const branch = project.staging_branch || 'staging';
      loggerService.appendVerbose(chatId, 'workflow:init', `Checking out branch: ${branch}`);
      const checkoutProc = spawn('git', ['checkout', branch], { cwd: repoDir, stdio: 'ignore' });
      
      checkoutProc.on('close', () => {
        // Step 4: Update sub_stage to 'starting' before spawning opencode server
        transitionTo(chatId, 'init', 'starting');
        stageWsManager.broadcastToStage(chatId, 'init', { type: 'sub_stage', sub_stage: 'starting' });

        // Step 5: Spawn opencode server
        const client = serveRegistry.getOrCreate(chatId, chatDir, process.env);
        client.ensureStarted().then(() => {
          // Step 6: Update stage to 'analyzing'
          transitionTo(chatId, 'analyzing', '');
          resolve();
        }).catch((err) => {
          loggerService.appendVerbose(chatId, 'workflow:init', `Failed to spawn opencode server: ${err.message}`);
          reject(err);
        });
      });
    });
  });
}

function addPatToUrl(url: string, pat: string, repoHost: string): string {
  try {
    const parsed = new URL(url);
    if (repoHost === 'bitbucket') {
      parsed.username = 'x-token-auth';
    } else {
      parsed.username = 'token';
    }
    parsed.password = pat;
    return parsed.toString();
  } catch {
    return url;
  }
}