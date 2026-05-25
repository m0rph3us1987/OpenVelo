import { Router } from 'express';
import { getSettings, SESSION_COOKIE, COOKIE_MAX_AGE } from '@/lib/settings';
import { getSessionSecret } from '@/lib/session';
import { signJwt, verifyJwt } from '@/lib/auth';
import { authenticateUser, getLoginDelay } from '@/lib/auth-service';
import { getUserById } from '@/lib/db';

export const authRouter = Router();

authRouter.post('/login', async (req, res) => {
  const settings = getSettings();
  if (!settings.securityEnabled) {
    res.status(400).json({ error: 'Security is disabled' });
    return;
  }

  const { username, password } = req.body as { username: string; password: string };
  const delay = getLoginDelay(username);
  await new Promise(resolve => setTimeout(resolve, delay));

  const result = await authenticateUser(username, password);
  if (!result) {
    res.status(401).json({ error: 'Invalid credentials' });
    return;
  }

  const secret = getSessionSecret();
  const token = await signJwt(
    { userId: result.user.id, username: result.user.username, role: result.user.role },
    secret
  );

  const isSecure = req.headers['x-forwarded-proto'] === 'https' || req.protocol === 'https';

  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: isSecure,
    path: '/',
    maxAge: COOKIE_MAX_AGE,
  });

  res.json({
    user: { id: result.user.id, username: result.user.username, role: result.user.role },
    resetRequired: result.resetRequired,
  });
});

authRouter.delete('/logout', (req, res) => {
  res.clearCookie(SESSION_COOKIE);
  res.json({ ok: true });
});

authRouter.get('/me', async (req, res) => {
  const settings = getSettings();
  if (!settings.securityEnabled) {
    res.json({ user: { id: 0, username: 'system', role: 'admin' } });
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
  try {
    const payload = await verifyJwt(token, secret);
    const user = getUserById(payload.userId);
    if (!user || !user.enabled) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    req.user = user;
    res.json({ user: { id: user.id, username: user.username, role: user.role } });
  } catch {
    res.status(401).json({ error: 'Unauthorized' });
  }
});