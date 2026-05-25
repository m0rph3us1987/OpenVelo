import { Router, Request, Response } from 'express';
import path from 'path';
import fs from 'fs';
import { requireAuth } from '../middleware/auth';
import { requireProjectAccess } from '../middleware/auth';
import { getChatSession, getChatDir } from '@/lib/db';
import { transitionTo } from '@/lib/workflow';

export const uploadRouter = Router();

uploadRouter.post('/chatUpload', requireAuth, (req: Request, res: Response) => {
  const upload = req.app.get('upload') as ReturnType<typeof import('multer')['default']>;
  if (!upload) {
    res.status(500).json({ error: 'Upload middleware not configured' });
    return;
  }

  upload.single('file')(req, res, (err) => {
    if (err) {
      console.error(`[upload] chatUpload error: ${err.message}`);
      res.status(400).json({ error: err.message });
      return;
    }

    const { chatId } = req.body as { chatId?: string };
    const file = req.file;

    if (!chatId || !file) {
      res.status(400).json({ error: 'chatId and file are required' });
      return;
    }

    const chatIdNum = Number(chatId);
    const chat = getChatSession(chatIdNum);
    if (!chat) {
      res.status(404).json({ error: 'Chat session not found' });
      return;
    }

    const chatDir = getChatDir(chatIdNum, chat.project_id);
    const uploadsDir = path.join(chatDir, 'uploads');

    if (!fs.existsSync(uploadsDir)) {
      fs.mkdirSync(uploadsDir, { recursive: true });
    }

    const filename = file.originalname;
    const filepath = path.join(uploadsDir, filename);

    try {
      fs.writeFileSync(filepath, file.buffer);
      console.log(`[upload] chatUpload - saved file ${filename} for chat ${chatIdNum} to ${filepath}`);
      res.json({ success: true, path: filepath, filename });
    } catch (saveErr) {
      console.error(`[upload] chatUpload - failed to save file: ${saveErr}`);
      res.status(500).json({ error: 'Failed to save file' });
    }
  });
});

uploadRouter.get('/chatFiles', requireAuth, (req: Request, res: Response) => {
  const chatId = parseInt(req.query.chatId as string, 10);
  if (!chatId || isNaN(chatId)) {
    res.status(400).json({ error: 'chatId is required' });
    return;
  }

  const chat = getChatSession(chatId);
  if (!chat) {
    res.status(404).json({ error: 'Chat session not found' });
    return;
  }

  const chatDir = getChatDir(chatId, chat.project_id);
  const uploadsDir = path.join(chatDir, 'uploads');

  if (!fs.existsSync(uploadsDir)) {
    res.json({ files: [] });
    return;
  }

  try {
    const files = fs.readdirSync(uploadsDir).filter((f) => fs.statSync(path.join(uploadsDir, f)).isFile());
    res.json({ files });
  } catch (err) {
    console.error(`[upload] chatFiles - failed to read directory: ${err}`);
    res.status(500).json({ error: 'Failed to read files' });
  }
});

uploadRouter.delete('/chatFile', requireAuth, (req: Request, res: Response) => {
  const { chatId, filename } = req.body as { chatId?: number | string; filename?: string };
  if (!chatId || !filename) {
    res.status(400).json({ error: 'chatId and filename are required' });
    return;
  }

  const chatIdNum = Number(chatId);
  const chat = getChatSession(chatIdNum);
  if (!chat) {
    res.status(404).json({ error: 'Chat session not found' });
    return;
  }

  const chatDir = getChatDir(chatIdNum, chat.project_id);
  const filepath = path.join(chatDir, 'uploads', filename);

  if (!fs.existsSync(filepath)) {
    res.status(404).json({ error: 'File not found' });
    return;
  }

  try {
    fs.unlinkSync(filepath);
    console.log(`[upload] chatFile - deleted ${filepath}`);
    res.json({ success: true });
  } catch (err) {
    console.error(`[upload] chatFile - failed to delete file: ${err}`);
    res.status(500).json({ error: 'Failed to delete file' });
  }
});

uploadRouter.post('/uploadOldRequirement', requireProjectAccess, (req: Request, res: Response) => {
  const upload = req.app.get('upload') as ReturnType<typeof import('multer')['default']>;
  if (!upload) {
    res.status(500).json({ error: 'Upload middleware not configured' });
    return;
  }

  upload.single('file')(req, res, (err) => {
    if (err) {
      console.error(`[upload] uploadOldRequirement error: ${err.message}`);
      res.status(400).json({ error: err.message });
      return;
    }

    const { chatId } = req.body as { chatId?: string | number };
    const file = req.file;

    if (!chatId || !file) {
      res.status(400).json({ error: 'chatId and file are required' });
      return;
    }

    const chatIdNum = Number(chatId);
    const chat = getChatSession(chatIdNum);
    if (!chat) {
      res.status(404).json({ error: 'Chat session not found' });
      return;
    }

    if (chat.stage !== 'verify' || chat.sub_stage !== 'upload') {
      res.status(400).json({ error: 'Chat is not in the upload phase' });
      return;
    }

    const ext = path.extname(file.originalname).toLowerCase();
    if (ext !== '.md' && ext !== '.txt') {
      res.status(400).json({ error: 'Only .md and .txt files are allowed' });
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      res.status(400).json({ error: 'File too large' });
      return;
    }

    if (!file.buffer || file.buffer.length === 0) {
      res.status(400).json({ error: 'File must not be empty' });
      return;
    }

    const chatDir = getChatDir(chatIdNum, chat.project_id);

    if (!fs.existsSync(chatDir)) {
      res.status(500).json({ error: 'Chat directory not found' });
      return;
    }

    const filepath = path.join(chatDir, 'OLD_REQUIREMENT.md');

    try {
      fs.writeFileSync(filepath, file.buffer);
      console.log(`[upload] uploadOldRequirement - saved file for chat ${chatIdNum} to ${filepath}`);

      transitionTo(chatIdNum, 'verify', 'analysis');

      res.status(201).json({ success: true, path: filepath, filename: 'OLD_REQUIREMENT.md' });
    } catch (saveErr) {
      console.error(`[upload] uploadOldRequirement - failed to save file: ${saveErr}`);
      res.status(500).json({ error: 'Failed to save file' });
    }
  });
});