import { Router } from 'express';
import { getPlanEpics, getPlanFeatures, getPlanStories, getPlanStory, updatePlanStory, getChatSession, updateChatSession, isUserAuthorizedForProject } from '@/lib/db';
import { transitionTo } from '@/lib/workflow';
import { requireProjectAccess } from '../middleware/auth';

export const planRouter = Router();

planRouter.get('/epics', requireProjectAccess, (req, res) => {
  const chatId = req.query.chatId;
  if (!chatId) {
    res.status(400).json({ error: 'chatId is required' });
    return;
  }
  try {
    const epics = getPlanEpics(Number(chatId));
    res.json(epics);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

planRouter.get('/features', requireProjectAccess, (req, res) => {
  const chatId = req.query.chatId;
  if (!chatId) {
    res.status(400).json({ error: 'chatId is required' });
    return;
  }
  try {
    const features = getPlanFeatures(Number(chatId));
    res.json(features);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

planRouter.get('/stories', requireProjectAccess, (req, res) => {
  const chatId = req.query.chatId;
  if (!chatId) {
    res.status(400).json({ error: 'chatId is required' });
    return;
  }
  try {
    const stories = getPlanStories(Number(chatId));
    res.json(stories);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

planRouter.put('/stories/:id', async (req, res) => {
  const { id } = req.params;
  const { title, description, acceptance_criteria, depends_on } = req.body;
  try {
    const story = getPlanStory(Number(id));
    if (!story) {
      res.status(404).json({ error: 'Story not found' });
      return;
    }

    if (req.user?.role !== 'admin') {
      const chat = getChatSession(story.chat_id);
      if (chat && !isUserAuthorizedForProject(req.user!.id, chat.project_id)) {
        res.status(403).json({ error: 'Forbidden' });
        return;
      }
    }

    updatePlanStory(Number(id), { title, description, acceptance_criteria, depends_on });
    res.json({ success: true });
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