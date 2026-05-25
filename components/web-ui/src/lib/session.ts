import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

// Stored alongside the database (openvelo.sqlite) so that it survives
// Docker container restarts.  Deleting this file immediately invalidates
// all active sessions.
function getSecretPath(): string {
  // 1. Prefer the same directory that holds the SQLite database — this is
  //    guaranteed to be on a persistent volume in Docker.
  const dbPath = process.env.OPENVELO_DB_PATH;
  if (dbPath) {
    const dataDir = path.dirname(dbPath);
    if (fs.existsSync(dataDir)) return path.join(dataDir, 'openvelo.session');
  }

  // 2. Fallback for local (non-Docker) development: repo root, three levels up from __dirname.
  const repoRoot = path.resolve(__dirname, '..', '..', '..');
  const rootFile = path.join(repoRoot, 'openvelo.session');
  if (fs.existsSync(repoRoot)) return rootFile;

  // 3. Last resort: web-ui package directory (two levels up from __dirname).
  const webUiDir = path.resolve(__dirname, '..', '..');
  if (fs.existsSync(webUiDir)) return path.join(webUiDir, 'openvelo.session');

  return path.join(process.cwd(), 'openvelo.session');
}

let _cached: string | null = null;

export function getSessionSecret(): string {
  const secretPath = getSecretPath();
  if (_cached) {
    // Re-validate: if the file was deleted, rotate so existing tokens are invalid
    if (!fs.existsSync(secretPath)) {
      _cached = crypto.randomBytes(32).toString('hex');
      fs.writeFileSync(secretPath, _cached, 'utf-8');
    }
    return _cached;
  }
  if (fs.existsSync(secretPath)) {
    _cached = fs.readFileSync(secretPath, 'utf-8').trim();
    if (_cached) return _cached;
  }
  _cached = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(secretPath, _cached, 'utf-8');
  return _cached;
}

/** Rotate the secret — invalidates all active sessions. */
export function rotateSessionSecret(): void {
  _cached = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(getSecretPath(), _cached, 'utf-8');
}
