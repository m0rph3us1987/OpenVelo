import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import {
  getPlanJobs,
  getPlanBlocks,
  getChatSession,
  updateChatSession,
  isUserAuthorizedForProject,
  getChatDir,
  deletePlanDataByChatId
} from '@/lib/db';
import { transitionTo } from '@/lib/workflow';
import { requireProjectAccess } from '../middleware/auth';

export const planRouter = Router();

planRouter.get('/jobs', requireProjectAccess, (req, res) => {
  const chatId = req.query.chatId;
  if (!chatId) {
    res.status(400).json({ error: 'chatId is required' });
    return;
  }
  try {
    const jobs = getPlanJobs(Number(chatId));
    res.json(jobs);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

planRouter.get('/blocks', requireProjectAccess, (req, res) => {
  const chatId = req.query.chatId;
  if (!chatId) {
    res.status(400).json({ error: 'chatId is required' });
    return;
  }
  try {
    const blocks = getPlanBlocks(Number(chatId));
    res.json(blocks);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

planRouter.post('/:chatId/retry', requireProjectAccess, (req, res) => {
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

planRouter.post('/:chatId/regenerate', requireProjectAccess, (req, res) => {
  const { chatId } = req.params;
  const chat = getChatSession(Number(chatId));
  if (!chat) {
    res.status(404).json({ error: 'Chat not found' });
    return;
  }

  const chatDir = getChatDir(Number(chatId), chat.project_id);
  const planDir = path.join(chatDir, 'plan');
  if (fs.existsSync(planDir)) {
    try {
      fs.rmSync(planDir, { recursive: true, force: true });
    } catch (err) {
      console.error('Failed to delete planDir:', err);
    }
  }

  deletePlanDataByChatId(Number(chatId));

  updateChatSession(Number(chatId), { running: false });
  transitionTo(Number(chatId), 'plan', '');

  res.json({ success: true });
});