import { Router, Request, Response } from 'express';
import { execSync } from 'child_process';
import { getAllModels, refreshModels } from '@/lib/db';

export const modelsRouter = Router();

modelsRouter.get('/', (_req: Request, res: Response) => {
  const models = getAllModels();
  res.json(models);
});

modelsRouter.post('/refresh', (_req: Request, res: Response) => {
  try {
    const output = execSync('kilo models', { encoding: 'utf-8', timeout: 30000 });
    const models = refreshModels(output);
    res.json(models);
  } catch (err) {
    console.error('[models] Failed to refresh models:', err);
    res.status(500).json({ error: 'Failed to refresh models: ' + String(err) });
  }
});