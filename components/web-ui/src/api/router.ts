import { Router, Request, Response, NextFunction } from 'express';
import fs from 'fs';
import { requireAuth, requireAdmin, requireProjectAccess } from './middleware/auth';
import { authRouter } from './routes/auth';
import { settingsRouter } from './routes/settings';
import { themesRouter } from './routes/themes';
import { projectsRouter } from './routes/projects';
import { modelsRouter } from './routes/models';
import { usersRouter } from './routes/users';
import { groupsRouter } from './routes/groups';
import { chatsRouter } from './routes/chats';
import { domainsRouter } from './routes/domains';
import { planRouter } from './routes/plan';
import { uploadRouter } from './routes/uploads';
import { createChatSession, getChatSession, deleteChatSession, getChatDir } from '../lib/db';
import { runWorkflow } from '../lib/workflow';
import { serveRegistry } from '../lib/opencode-serve-registry';
import { wsManager } from '../lib/websocket-manager';

export const apiRouter = Router();

apiRouter.use((req: Request, res: Response, next: NextFunction) => {
  const path = req.path;
  const method = req.method;

  if (path === '/auth/login' && method === 'POST') { next(); return; }
  if (path === '/auth/logout' && method === 'DELETE') { next(); return; }
  if (path === '/settings' && method === 'GET') { next(); return; }
  if (path.startsWith('/themes') && method === 'GET') { next(); return; }
  if (path.startsWith('/models') && method === 'GET') { next(); return; }

  requireAuth(req, res, next);
});

apiRouter.use('/auth', authRouter);
apiRouter.use('/settings', settingsRouter);
apiRouter.use('/themes', themesRouter);
apiRouter.use('/projects', projectsRouter);
apiRouter.use('/models', modelsRouter);
apiRouter.use('/users', requireAuth, usersRouter);
apiRouter.use('/groups', requireAuth, requireAdmin, groupsRouter);
apiRouter.use('/chats', chatsRouter);
apiRouter.use('/domains', domainsRouter);
apiRouter.use('/plan', planRouter);
apiRouter.use('/uploads', uploadRouter);

// Direct endpoint routes for /api/chatCreate and /api/chatOpen (frontend expects these paths)
apiRouter.post('/chatCreate', requireProjectAccess, (req: Request, res: Response) => {
  const body = req.body;
  console.log(`[${new Date().toISOString()}] POST /api/chatCreate - body:`, JSON.stringify(body));

  const { mode, name, project_id } = body;
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
  
  // Broadcast new chat to all WebSocket clients watching this project
  wsManager.broadcastToProject(project_id, {
    type: 'chat_created',
    chat,
  });
  
  res.status(201).json(chat);
});

apiRouter.post('/chatOpen', requireProjectAccess, (req: Request, res: Response) => {
  const body = req.body;
  console.log(`[${new Date().toISOString()}] POST /api/chatOpen - body:`, JSON.stringify(body));

  const { id, project_id } = body;
  if (!id || !project_id) {
    res.status(400).json({ error: 'id and project_id are required' });
    return;
  }

  const chat = getChatSession(Number(id));
  if (!chat) {
    res.status(404).json({ error: 'Chat session not found' });
    return;
  }
  console.log(`[${new Date().toISOString()}] chatOpen - opened chat id=${id}, project_id=${project_id}`);

  // Trigger workflow in background after giving frontend time to establish WebSocket
  setTimeout(() => runWorkflow(Number(id)), 300);

  res.json({ success: true, chat });
});

apiRouter.post('/chatDelete', requireProjectAccess, (req: Request, res: Response) => {
  const body = req.body;
  console.log(`[${new Date().toISOString()}] POST /api/chatDelete - body:`, JSON.stringify(body));

  const { id } = body;
  if (!id) {
    res.status(400).json({ error: 'id is required' });
    return;
  }

  const chatId = Number(id);
  const chat = getChatSession(chatId);
  if (!chat) {
    res.status(404).json({ error: 'Chat session not found' });
    return;
  }

  console.log(`[${new Date().toISOString()}] chatDelete - cleaning up chat ${chatId}`);

  // 1. Kill opencode server if running
  console.log(`[${new Date().toISOString()}] chatDelete - killing opencode server for chat ${chatId}`);
  serveRegistry.shutdown(chatId);

  // 2. Delete chat directory
  const chatDir = getChatDir(chatId, chat.project_id);
  console.log(`[${new Date().toISOString()}] chatDelete - deleting chat directory: ${chatDir}`);
  if (fs.existsSync(chatDir)) {
    fs.rmSync(chatDir, { recursive: true, force: true });
  }

  // 3. Delete DB record
  const projectId = chat.project_id;
  deleteChatSession(chatId);
  console.log(`[${new Date().toISOString()}] chatDelete - deleted chat id=${chatId}`);
  
  // Broadcast chat deletion to all WebSocket clients watching this project
  wsManager.broadcastToProject(projectId, {
    type: 'chat_deleted',
    chatId: chatId,
  });
  
  res.json({ success: true });
});