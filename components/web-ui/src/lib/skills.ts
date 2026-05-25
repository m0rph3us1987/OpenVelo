import path from 'path';
import fs from 'fs';

/**
 * Resolves the absolute path to the SKILLS directory.
 * Logic matches stage-init.ts whitelist logic.
 */
export function getSkillsDir(): string {
  const dbPath = process.env.OPENVELO_DB_PATH;
  
  if (dbPath) {
    return path.join(path.dirname(dbPath), 'SKILLS');
  }
  
  const localSkills = path.resolve(process.cwd(), 'data', 'SKILLS');
  if (fs.existsSync(localSkills)) {
    return localSkills;
  }
  
  const parentSkills = path.resolve(process.cwd(), '..', '..', 'data', 'SKILLS');
  return parentSkills;
}
