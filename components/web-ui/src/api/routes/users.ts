import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { createUser, getUserById, getUserByUsername, getAllUsers, updateUser, countEnabledAdmins, getUserGroups } from '@/lib/db';
import { getSettings } from '@/lib/settings';
import { getSessionSecret } from '@/lib/session';
import { verifyJwt } from '@/lib/auth';
import { validatePasswordPolicy } from '@/lib/auth';
import { requireAdmin } from '@/api/middleware/auth';
import type { User } from '@/lib/types';

export const usersRouter = Router();

function omitPassword(user: User): Omit<User, 'password_hash'> {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { password_hash, ...rest } = user;
  return rest as Omit<User, 'password_hash'>;
}

async function getAuthenticatedUser(req: Request): Promise<User | null> {
  const settings = getSettings();
  if (!settings.securityEnabled) {
    return { id: 0, username: 'system', role: 'admin' } as User;
  }

  const cookieHeader = req.headers.cookie ?? '';
  const cookies = cookieHeader.split(';').map(c => c.trim().split('='));
  const tokenEntry = cookies.find(([k]) => k === 'openvelo-token');
  const token = tokenEntry?.[1];

  if (!token) return null;

  try {
    const secret = getSessionSecret();
    const payload = await verifyJwt(token, secret);
    const user = getUserById(payload.userId);
    if (!user || !user.enabled) return null;
    return user;
  } catch {
    return null;
  }
}

usersRouter.get('/', requireAdmin, async (_req: Request, res: Response) => {
  const users = getAllUsers();
  const usersWithGroups = users.map(user => ({
    ...omitPassword(user),
    groups: getUserGroups(user.id),
  }));
  res.json(usersWithGroups);
});

usersRouter.post('/', requireAdmin, async (req: Request, res: Response) => {
  const { username, password, role } = req.body as { username?: string; password?: string; role?: string };

  if (!username || !password || !role) {
    res.status(400).json({ error: 'username, password, and role are required' });
    return;
  }

  const policy = validatePasswordPolicy(password);
  if (!policy.valid) {
    res.status(400).json({ error: policy.message });
    return;
  }

  const existing = getUserByUsername(username);
  if (existing) {
    res.status(409).json({ error: 'Username already exists' });
    return;
  }

  const hash = await bcrypt.hash(password, 10);
  const user = createUser({
    username,
    password_hash: hash,
    role: role as 'admin' | 'user',
    enabled: true,
    password_reset_required: false,
  });

  res.status(201).json(omitPassword(user));
});

usersRouter.get('/:id', requireAdmin, async (req: Request, res: Response) => {
  const user = getUserById(Number(req.params.id));
  if (!user) {
    res.status(404).json({ error: 'User not found' });
    return;
  }
  res.json({
    ...omitPassword(user),
    groups: getUserGroups(user.id),
  });
});

usersRouter.put('/:id', requireAdmin, async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const { role, enabled } = req.body as { role?: string; enabled?: boolean };
  const existing = getUserById(id);
  if (!existing) {
    res.status(404).json({ error: 'User not found' });
    return;
  }

  if (enabled === false || role === 'user') {
    const currentAdmins = countEnabledAdmins();
    const isTargetAdmin = existing.role === 'admin' && existing.enabled;
    if (isTargetAdmin) {
      if (currentAdmins <= 1) {
        res.status(400).json({ error: 'Cannot disable the last enabled admin' });
        return;
      }
    }
  }

  const updateData: { role?: string; enabled?: boolean } = {};
  if (role !== undefined) updateData.role = role;
  if (enabled !== undefined) updateData.enabled = enabled;

  const updated = updateUser(id, updateData);
  res.json(omitPassword(updated!));
});

usersRouter.put('/me/password', async (req: Request, res: Response) => {
  const user = await getAuthenticatedUser(req);
  if (!user) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const { currentPassword, newPassword } = req.body as { currentPassword?: string; newPassword?: string };

  if (!currentPassword || !newPassword) {
    res.status(400).json({ error: 'currentPassword and newPassword are required' });
    return;
  }

  if (user.id !== 0) {
    const valid = await bcrypt.compare(currentPassword, user.password_hash);
    if (!valid) {
      res.status(403).json({ error: 'Current password is incorrect' });
      return;
    }
  }

  const policy = validatePasswordPolicy(newPassword);
  if (!policy.valid) {
    res.status(400).json({ error: policy.message });
    return;
  }

  const hash = await bcrypt.hash(newPassword, 10);
  updateUser(user.id, { password_hash: hash, password_reset_required: false });

  res.status(200).json({ ok: true });
});

usersRouter.put('/:id/password', requireAdmin, async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const { newPassword } = req.body as { newPassword?: string };

  const user = getUserById(id);
  if (!user) {
    res.status(404).json({ error: 'User not found' });
    return;
  }

  let password = newPassword;
  if (!password) {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*';
    let result = '';
    for (let i = 0; i < 12; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    password = result;
  }

  const policy = validatePasswordPolicy(password);
  if (!policy.valid) {
    res.status(400).json({ error: policy.message });
    return;
  }

  const hash = await bcrypt.hash(password, 10);
  updateUser(id, { password_hash: hash, password_reset_required: true });

  res.json({ newPassword: password });
});