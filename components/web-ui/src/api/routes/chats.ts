import { Router, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import {
  createChatSession,
  getChatSessionsByProject,
  getChatSession,
  insertChatMessage,
  getChatMessages,
  deleteChatMessage,
  getMessageOptions,
  getChatDir,
  getChatMessage,
  isUserAuthorizedForProject,
  updateChatSession,
  deleteRequirementSectionsByChatId,
  deleteRequirementOutlinesByChatId,
  deletePlanDataByChatId,
  getRequirementOutlines,
} from '@/lib/db';
import { transitionTo, runWorkflow } from '@/lib/workflow';
import { requireProjectAccess } from '../middleware/auth';
import { serveRegistry } from '@/lib/opencode-serve-registry';
import { wsManager } from '@/lib/websocket-manager';
import { stageWsManager } from '@/lib/stage-ws-manager';

export const chatsRouter = Router();

interface ChatCreateBody {
  mode: 'plan' | 'quick' | 'verify';
  name: string;
  project_id: number;
}

chatsRouter.get('/', requireProjectAccess, async (req, res) => {
  const projectId = req.query.projectId;
  if (!projectId) {
    res.status(400).json({ error: 'projectId is required' });
    return;
  }
  const chats = getChatSessionsByProject(Number(projectId));
  res.json(chats);
});

chatsRouter.post('/chatCreate', requireProjectAccess, async (req, res) => {
  console.log(`[${new Date().toISOString()}] POST /api/chatCreate - body:`, JSON.stringify(req.body));
  const { mode, name, project_id } = req.body as ChatCreateBody;
  if (!mode || !name || !project_id) {
    res.status(400).json({ error: 'mode, name, and project_id are required' });
    return;
  }
  if (!['plan', 'quick', 'verify'].includes(mode)) {
    res.status(400).json({ error: 'mode must be plan, quick, or verify' });
    return;
  }
  const chat = createChatSession({ mode, name, project_id });
  console.log(`[${new Date().toISOString()}] chatCreate - created chat id=${chat.id}`);
  res.status(201).json(chat);
});

interface ChatMessageBody {
  chat_id: number;
  project_id: number;
  stage: string;
  role: 'user' | 'system';
  message: string;
}

chatsRouter.post('/chatMessage', requireProjectAccess, async (req, res) => {
  console.log(`[${new Date().toISOString()}] POST /api/chatMessage - body:`, JSON.stringify(req.body));
  const { chat_id, project_id, stage, role, message } = req.body as ChatMessageBody;
  if (!chat_id || !project_id || !stage || !role || !message) {
    res.status(400).json({ error: 'chat_id, project_id, stage, role, and message are required' });
    return;
  }
  if (!['user', 'system'].includes(role)) {
    res.status(400).json({ error: 'role must be user or system' });
    return;
  }
  const chat = getChatSession(chat_id);
  if (!chat) {
    res.status(404).json({ error: 'Chat session not found' });
    return;
  }
  const chatMessage = insertChatMessage({ chat_id, project_id, stage, role, message });
  console.log(`[${new Date().toISOString()}] chatMessage - created message id=${chatMessage.id} for chat ${chat_id}`);
  res.status(201).json(chatMessage);
});

chatsRouter.get('/chatMessages', requireProjectAccess, async (req, res) => {
  const chatId = req.query.chatId;
  if (!chatId) {
    res.status(400).json({ error: 'chatId is required' });
    return;
  }
  const messages = getChatMessages(Number(chatId));
  const messagesWithOptions = messages.map(msg => ({
    ...msg,
    options: getMessageOptions(msg.id),
  }));
  res.json(messagesWithOptions);
});

chatsRouter.delete('/chatMessage', async (req, res) => {
  console.log(`[${new Date().toISOString()}] DELETE /api/chatMessage - body:`, JSON.stringify(req.body));
  const { id } = req.body as { id?: number };
  if (!id) {
    res.status(400).json({ error: 'id is required' });
    return;
  }

  if (req.user?.role !== 'admin') {
    const msg = getChatMessage(id);
    if (msg && !isUserAuthorizedForProject(req.user!.id, msg.project_id)) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }
  }

  deleteChatMessage(id);
  console.log(`[${new Date().toISOString()}] chatMessage - deleted message id=${id}`);
  res.json({ success: true });
});

chatsRouter.post('/collectNext', requireProjectAccess, async (req, res) => {
  console.log(`[${new Date().toISOString()}] POST /api/collectNext - body:`, JSON.stringify(req.body));
  const { chatId } = req.body as { chatId?: number };
  if (!chatId) {
    res.status(400).json({ error: 'chatId is required' });
    return;
  }
  const chat = getChatSession(Number(chatId));
  if (!chat) {
    res.status(404).json({ error: 'Chat session not found' });
    return;
  }
  transitionTo(Number(chatId), 'collecting', 'system');
  console.log(`[${new Date().toISOString()}] collectNext - triggered for chat ${chatId}`);
  res.json({ success: true });
});

chatsRouter.post('/startDomainPlanning', requireProjectAccess, async (req, res) => {
  const { chatId } = req.body as { chatId?: number };
  if (!chatId) {
    res.status(400).json({ error: 'chatId is required' });
    return;
  }
  const chat = getChatSession(Number(chatId));
  if (!chat) {
    res.status(404).json({ error: 'Chat session not found' });
    return;
  }
  transitionTo(Number(chatId), 'domain', 'plan');
  res.json({ success: true });
});

chatsRouter.post('/generateRequirement', requireProjectAccess, async (req, res) => {
  const { chatId } = req.body as { chatId?: number };
  if (!chatId) {
    res.status(400).json({ error: 'chatId is required' });
    return;
  }
  const chat = getChatSession(Number(chatId));
  if (!chat) {
    res.status(404).json({ error: 'Chat not found' });
    return;
  }
  transitionTo(Number(chatId), 'requirement', '');
  res.json({ success: true });
});

chatsRouter.post('/:chatId/requirement/regenerate', requireProjectAccess, async (req, res) => {
  const { chatId } = req.params;
  const chat = getChatSession(Number(chatId));
  if (!chat) {
    res.status(404).json({ error: 'Chat not found' });
    return;
  }

  const chatDir = getChatDir(Number(chatId), chat.project_id);
  const requirementPath = path.join(chatDir, 'REQUIREMENT.md');
  if (fs.existsSync(requirementPath)) {
    try {
      fs.unlinkSync(requirementPath);
    } catch (err) {
      console.error('Failed to delete REQUIREMENT.md:', err);
    }
  }

  const planDir = path.join(chatDir, 'plan');
  if (fs.existsSync(planDir)) {
    try {
      fs.rmSync(planDir, { recursive: true, force: true });
    } catch (err) {
      console.error('Failed to delete planDir:', err);
    }
  }

  deleteRequirementSectionsByChatId(Number(chatId));
  deleteRequirementOutlinesByChatId(Number(chatId));
  deletePlanDataByChatId(Number(chatId));

  updateChatSession(Number(chatId), { running: false });
  transitionTo(Number(chatId), 'requirement', 'outline');

  res.json({ success: true });
});

chatsRouter.post('/:chatId/requirement/retry', requireProjectAccess, (req, res) => {
  const { chatId } = req.params;
  const chat = getChatSession(Number(chatId));
  if (!chat) {
    res.status(404).json({ error: 'Chat not found' });
    return;
  }

  updateChatSession(Number(chatId), { running: false });
  transitionTo(Number(chatId), chat.stage, chat.sub_stage_pre_error);

  res.json({ success: true });
});

chatsRouter.post('/:chatId/verify/retry', requireProjectAccess, (req, res) => {
  const { chatId } = req.params;
  const chat = getChatSession(Number(chatId));
  if (!chat) {
    res.status(404).json({ error: 'Chat session not found' });
    return;
  }

  updateChatSession(Number(chatId), { running: false });
  transitionTo(Number(chatId), chat.stage, chat.sub_stage_pre_error);

  res.json({ success: true });
});

chatsRouter.post('/:chatId/final_assessment/retry', requireProjectAccess, (req, res) => {
  const { chatId } = req.params;
  const chat = getChatSession(Number(chatId));
  if (!chat) {
    res.status(404).json({ error: 'Chat session not found' });
    return;
  }

  updateChatSession(Number(chatId), { running: false });
  transitionTo(Number(chatId), chat.stage, chat.sub_stage_pre_error);

  res.json({ success: true });
});

chatsRouter.post('/continueFinalAssessment', requireProjectAccess, async (req, res) => {
  const { chatId } = req.body as { chatId?: number };
  if (!chatId) {
    res.status(400).json({ error: 'chatId is required' });
    return;
  }
  const chat = getChatSession(Number(chatId));
  if (!chat) {
    res.status(404).json({ error: 'Chat session not found' });
    return;
  }
  transitionTo(Number(chatId), 'final_assessment', 'system');
  res.json({ success: true });
});

chatsRouter.post('/generatePlan', requireProjectAccess, async (req, res) => {
  const { chatId } = req.body as { chatId?: number };
  if (!chatId) {
    res.status(400).json({ error: 'chatId is required' });
    return;
  }
  const chat = getChatSession(Number(chatId));
  if (!chat) {
    res.status(404).json({ error: 'Chat session not found' });
    return;
  }
  transitionTo(Number(chatId), 'plan', '');
  res.json({ success: true });
});

chatsRouter.get('/requirementFile', requireProjectAccess, async (req, res) => {
  const chatId = req.query.chatId;
  if (!chatId) {
    res.status(400).json({ error: 'chatId is required' });
    return;
  }
  const chat = getChatSession(Number(chatId));
  if (!chat) {
    res.status(404).json({ error: 'Chat not found' });
    return;
  }
  const chatDir = getChatDir(Number(chatId), chat.project_id);
  const requirementPath = path.join(chatDir, 'REQUIREMENT.md');
  if (!fs.existsSync(requirementPath)) {
    res.status(404).json({ error: 'Requirement file not found' });
    return;
  }
  const content = fs.readFileSync(requirementPath, 'utf-8');
  res.type('text/markdown').send(content);
});

chatsRouter.post('/saveRequirement', requireProjectAccess, async (req, res) => {
  const { chatId, content } = req.body as { chatId?: number; content?: string };
  if (!chatId) {
    res.status(400).json({ error: 'chatId is required' });
    return;
  }
  if (content === undefined) {
    res.status(400).json({ error: 'content is required' });
    return;
  }
  const chat = getChatSession(Number(chatId));
  if (!chat) {
    res.status(404).json({ error: 'Chat session not found' });
    return;
  }
  const chatDir = getChatDir(Number(chatId), chat.project_id);
  const requirementPath = path.join(chatDir, 'REQUIREMENT.md');
  fs.writeFileSync(requirementPath, content, 'utf-8');
  res.json({ success: true });
});

chatsRouter.post('/:chatId/upload-requirement', requireProjectAccess, async (req: Request, res: Response) => {
  const upload = req.app.get('upload') as ReturnType<typeof import('multer')['default']>;
  if (!upload) {
    res.status(500).json({ error: 'Upload middleware not configured' });
    return;
  }

  upload.single('requirement')(req, res, async (err) => {
    if (err) {
      console.error(`[upload] upload-requirement error: ${err.message}`);
      const multerErr = err as Error & { code?: string };
      if (multerErr.code === 'LIMIT_FILE_SIZE' || err.message.includes('File too large')) {
        res.status(413).json({ error: 'File too large' });
        return;
      }
      if (err.message === 'Only .md and .txt files are accepted') {
        res.status(400).json({ error: 'Only .md and .txt files are accepted' });
        return;
      }
      res.status(500).json({ error: 'Upload failed' });
      return;
    }

    const chatId = Number(req.params.chatId);
    const file = req.file;

    if (!file) {
      res.status(400).json({ error: 'No file uploaded' });
      return;
    }

    const chat = getChatSession(chatId);
    if (!chat) {
      res.status(404).json({ error: 'Chat session not found' });
      return;
    }

    const chatDir = getChatDir(chatId, chat.project_id);

    if (!fs.existsSync(chatDir)) {
      try {
        fs.mkdirSync(chatDir, { recursive: true });
      } catch (mkdirErr) {
        console.error(`[upload] upload-requirement - failed to create chat directory: ${mkdirErr}`);
        res.status(500).json({ error: 'Failed to create chat directory' });
        return;
      }
    }

    const destPath = path.join(chatDir, 'ORIGINAL_REQUIREMENT.md');
    const tmpPath = destPath + '.tmp';

    try {
      fs.writeFileSync(tmpPath, file.buffer);
      fs.renameSync(tmpPath, destPath);
    } catch (saveErr) {
      console.error(`[upload] upload-requirement - failed to save file: ${saveErr}`);
      if (fs.existsSync(tmpPath)) {
        try { fs.unlinkSync(tmpPath); } catch { /* ignore cleanup error */ }
      }
      res.status(500).json({ error: 'Failed to save file' });
      return;
    }

    try {
      transitionTo(chatId, 'verify', 'analysis');
    } catch (transitionErr) {
      console.error(`[upload] upload-requirement - transitionTo failed: ${transitionErr}`);
      try { fs.unlinkSync(destPath); } catch { /* ignore cleanup error */ }
      res.status(500).json({ error: 'Failed to update chat session' });
      return;
    }

    res.status(200).json({ success: true });
  });
});

chatsRouter.get('/:chatId/requirement/outlines', requireProjectAccess, (req, res) => {
  const { chatId } = req.params;
  try {
    const outlines = getRequirementOutlines(Number(chatId));
    res.json(outlines);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

chatsRouter.post('/:chatId/stop', requireProjectAccess, (req, res) => {
  const chatId = Number(req.params.chatId);
  const chat = getChatSession(chatId);
  if (!chat) {
    res.status(404).json({ error: 'Chat not found' });
    return;
  }

  serveRegistry.shutdown(chatId);
  updateChatSession(chatId, { running: 0 });

  wsManager.broadcastToProject(chat.project_id, {
    type: 'chat_updated',
    chatId: chatId,
    stage: chat.stage,
    sub_stage: chat.sub_stage,
    running: 0,
  });

  stageWsManager.broadcastToStage(chatId, chat.stage, {
    type: 'running_status',
    running: false,
  });

  res.json({ success: true });
});

chatsRouter.post('/:chatId/resume', requireProjectAccess, (req, res) => {
  const chatId = Number(req.params.chatId);
  const chat = getChatSession(chatId);
  if (!chat) {
    res.status(404).json({ error: 'Chat not found' });
    return;
  }

  runWorkflow(chatId);
  res.json({ success: true });
});

export default chatsRouter;