import { Router } from 'express';
import path from 'path';
import fs from 'fs';

export const themesRouter = Router();

function getThemesDir(): string {
  const publicThemes = path.join(process.cwd(), 'public', 'themes');
  if (fs.existsSync(publicThemes)) return publicThemes;
  const webUiThemes = path.join(process.cwd(), 'themes');
  if (fs.existsSync(webUiThemes)) return webUiThemes;
  return path.join(process.cwd(), '..', '..', 'themes');
}

// GET /api/themes — list all themes
themesRouter.get('/', (_req, res) => {
  try {
    const dir = getThemesDir();
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
    const themes = files.map((f) => ({
      key: f.replace('.json', ''),
      name: f.replace('.json', '').charAt(0).toUpperCase() + f.replace('.json', '').slice(1),
    }));
    res.json(themes);
  } catch {
    res.json([{ key: 'dark', name: 'Dark' }, { key: 'light', name: 'Light' }]);
  }
});

// GET /api/themes/:theme — get theme JSON
themesRouter.get('/:theme', (req, res) => {
  try {
    const { theme } = req.params;
    const safeTheme = path.basename(theme);
    const dir = getThemesDir();
    const filePath = path.join(dir, `${safeTheme}.json`);
    if (!fs.existsSync(filePath)) {
      res.status(404).json({ error: 'Theme not found' });
      return;
    }
    const content = fs.readFileSync(filePath, 'utf-8');
    res.json(JSON.parse(content));
  } catch {
    res.status(500).json({ error: 'Failed to load theme' });
  }
});
