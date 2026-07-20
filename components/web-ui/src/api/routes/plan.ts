import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import {
  getPlanJobs,
  getPlanBlocks,
  getChatSession,
  updateChatSession,
  getChatDir,
  deletePlanDataByChatId,
  getDb,
  getPlanJob,
  updatePlanJob,
  deletePlanJob,
  removeAndRewritePlanJobDependencies
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

planRouter.get('/:chatId/test-jobs', requireProjectAccess, (req, res) => {
  const chatId = Number(req.params.chatId);
  try {
    // Returns test rows joined to their parent implementation row, sorted by
    // the impl row's job_index so they appear in implementation order in the UI.
    const db = getDb();
    const rows = db.prepare(`
      SELECT
        test.id              AS id,
        test.job_index       AS job_index,
        test.title           AS title,
        test.description     AS description,
        test.status          AS status,
        test.logs            AS logs,
        test.implements_job_id AS implements_job_id,
        impl.job_index       AS impl_job_index
      FROM plan_jobs test
      LEFT JOIN plan_jobs impl ON impl.id = test.implements_job_id
      WHERE test.chat_id = ? AND test.implements_job_id IS NOT NULL
      ORDER BY impl.job_index ASC, test.id ASC
    `).all(chatId);
    res.json(rows);
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

planRouter.post('/:chatId/generate-tests', requireProjectAccess, (req, res) => {
  const { chatId } = req.params;
  const chat = getChatSession(Number(chatId));
  if (!chat) {
    res.status(404).json({ error: 'Chat not found' });
    return;
  }

  updateChatSession(Number(chatId), { running: false });
  transitionTo(Number(chatId), 'plan', 'test');

  res.json({ success: true });
});

planRouter.patch('/:chatId/jobs/:jobId', requireProjectAccess, (req, res) => {
  const chatId = Number(req.params.chatId);
  const jobId = Number(req.params.jobId);
  if (!chatId || !jobId) {
    res.status(400).json({ error: 'chatId and jobId are required' });
    return;
  }

  const job = getPlanJob(jobId);
  if (!job || job.chat_id !== chatId) {
    res.status(404).json({ error: 'Plan job not found' });
    return;
  }

  const body = req.body ?? {};
  const updates: { title?: string; description?: string; depends_on?: string; content?: string | null; test_plan_markdown?: string } = {};

  if (body.title !== undefined) {
    if (typeof body.title !== 'string') {
      res.status(400).json({ error: 'title must be a string' });
      return;
    }
    updates.title = body.title;
  }
  if (body.description !== undefined) {
    if (typeof body.description !== 'string') {
      res.status(400).json({ error: 'description must be a string' });
      return;
    }
    updates.description = body.description;
  }
  if (body.content !== undefined) {
    if (body.content !== null && typeof body.content !== 'string') {
      res.status(400).json({ error: 'content must be a string or null' });
      return;
    }
    updates.content = body.content;
  }
  if (body.test_plan_markdown !== undefined) {
    if (typeof body.test_plan_markdown !== 'string') {
      res.status(400).json({ error: 'test_plan_markdown must be a string' });
      return;
    }
    updates.test_plan_markdown = body.test_plan_markdown;
  }
  if (body.depends_on !== undefined) {
    if (!Array.isArray(body.depends_on)) {
      res.status(400).json({ error: 'depends_on must be an array' });
      return;
    }
    if (body.depends_on.length > 1) {
      res.status(400).json({ error: 'plan entries may have at most one dependency' });
      return;
    }
    for (const dep of body.depends_on) {
      if (typeof dep !== 'number' || !Number.isInteger(dep)) {
        res.status(400).json({ error: 'depends_on entries must be integer job ids' });
        return;
      }
      if (dep === jobId) {
        res.status(400).json({ error: 'a plan entry cannot depend on itself' });
        return;
      }
    }
    if (body.depends_on.length === 1) {
      const otherId = body.depends_on[0];
      const other = getPlanJob(otherId);
      if (!other || other.chat_id !== chatId) {
        res.status(400).json({ error: 'dependency target job not found in this chat' });
        return;
      }
    }
    updates.depends_on = body.depends_on.length === 0
      ? '[]'
      : JSON.stringify(body.depends_on);
  }

  try {
    const updated = updatePlanJob(jobId, updates);
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

planRouter.delete('/:chatId/jobs/:jobId', requireProjectAccess, (req, res) => {
  const chatId = Number(req.params.chatId);
  const jobId = Number(req.params.jobId);
  if (!chatId || !jobId) {
    res.status(400).json({ error: 'chatId and jobId are required' });
    return;
  }

  const job = getPlanJob(jobId);
  if (!job || job.chat_id !== chatId) {
    res.status(404).json({ error: 'Plan job not found' });
    return;
  }

  try {
    const deletedDependsOn = job.depends_on;
    deletePlanJob(jobId, chatId);
    const rewrittenJobIds = removeAndRewritePlanJobDependencies(chatId, jobId, deletedDependsOn);
    res.json({ success: true, rewrittenJobIds });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});