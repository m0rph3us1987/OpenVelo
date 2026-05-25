import { Router } from 'express';
import { getSettings, saveSettings } from '@/lib/settings';
import { rotateSessionSecret } from '@/lib/session';
import { initDb, getUiSetting, setUiSetting, countEnabledAdmins } from '@/lib/db';

export const settingsRouter = Router();

// GET /api/settings — always returns all fields (securityEnabled is not sensitive)
settingsRouter.get('/', (_req, res) => {
  initDb();
  const settings = getSettings();
  const theme = getUiSetting('theme') ?? 'light';
  const securityEnabled = getUiSetting('security_enabled') === 'true';

  res.json({
    appTitle: settings.appTitle,
    theme,
    securityEnabled,
    debugSseConsole: settings.debugSseConsole,
  });
});

// PUT /api/settings — protected (middleware applied in router.ts)
settingsRouter.put('/', async (req, res) => {
  try {
    initDb();
    const body = req.body as { appTitle?: string; theme?: string; debugSseConsole?: boolean; securityEnabled?: boolean };
    if (body.securityEnabled !== undefined) {
      if (req.user.role !== 'admin') {
        res.status(403).json({ error: 'Only admins can toggle securityEnabled' });
        return;
      }
      if (body.securityEnabled === true && countEnabledAdmins() === 0) {
        res.status(400).json({ error: 'Cannot enable security when no admin exists' });
        return;
      }
      const current = getSettings().securityEnabled;
      if (current !== body.securityEnabled) {
        rotateSessionSecret();
      }
    }
    const updates: Parameters<typeof saveSettings>[0] = {};
    if (body.appTitle !== undefined) updates.appTitle = body.appTitle.trim() || 'OpenVelo';
    if (body.securityEnabled !== undefined) updates.securityEnabled = body.securityEnabled;
    if (body.debugSseConsole !== undefined) updates.debugSseConsole = body.debugSseConsole;
    const newSettings = saveSettings(updates);
    if (body.theme !== undefined) setUiSetting('theme', body.theme || 'light');
    const theme = getUiSetting('theme') ?? 'light';
    res.json({ appTitle: newSettings.appTitle, theme, securityEnabled: newSettings.securityEnabled, debugSseConsole: newSettings.debugSseConsole });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});
