import { Request, Response, NextFunction } from 'express';
import { getUiSetting, getUserById, isUserAuthorizedForProject, getChatSession } from '@/lib/db';
import { getSessionSecret } from '@/lib/session';
import { verifyJwt } from '@/lib/auth';

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const securityEnabled = getUiSetting('security_enabled') === 'true';

  if (!securityEnabled) {
    req.user = { id: 0, username: 'system', role: 'admin' } as unknown as import('@/lib/types').User;
    next();
    return;
  }

  const cookieHeader = req.headers.cookie ?? '';
  const cookies = cookieHeader.split(';').map(c => c.trim().split('='));
  const tokenEntry = cookies.find(([k]) => k === 'openvelo-token');
  const token = tokenEntry?.[1];

  if (!token) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const secret = getSessionSecret();

  verifyJwt(token, secret)
    .then(payload => {
      const user = getUserById(payload.userId);
      if (!user || !user.enabled) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }
      req.user = user;
      next();
    })
    .catch(() => {
      res.status(401).json({ error: 'Unauthorized' });
    });
}

export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  requireAuth(req, res, () => {
    if (req.user && req.user.role !== 'admin') {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }
    next();
  });
}

export function requireProjectAccess(req: Request, res: Response, next: NextFunction): void {
  requireAuth(req, res, () => {
    if (!req.user) return; // requireAuth already sent 401
    if (req.user.role === 'admin') {
      next();
      return;
    }

    let projectId = req.params.id ? parseInt(req.params.id) : null;
    if (!projectId && req.query.projectId) projectId = parseInt(req.query.projectId as string);
    if (!projectId && req.body.project_id) projectId = parseInt(req.body.project_id);

    // If still no projectId, try to resolve from chatId
    if (!projectId) {
      let chatId = req.params.chatId ? parseInt(req.params.chatId) : null;
      if (!chatId && req.query.chatId) chatId = parseInt(req.query.chatId as string);
      if (!chatId && req.body.chatId) chatId = parseInt(req.body.chatId);
      if (!chatId && req.body.chat_id) chatId = parseInt(req.body.chat_id);

      if (chatId) {
        const chat = getChatSession(chatId);
        if (chat) {
          projectId = chat.project_id;
        }
      }
    }

    if (!projectId || isNaN(projectId)) {
      res.status(400).json({ error: 'Missing or invalid project context (id, projectId, or chatId)' });
      return;
    }

    if (!isUserAuthorizedForProject(req.user.id, projectId)) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }

    next();
  });
}