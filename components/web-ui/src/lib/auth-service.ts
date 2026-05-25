import bcrypt from 'bcryptjs';
import type { User } from './types';
import { getUserByUsername, recordFailedLogin, resetFailedLogin } from './db';

export async function authenticateUser(
  username: string,
  password: string
): Promise<{ user: User; resetRequired: boolean } | null> {
  const user = getUserByUsername(username);
  if (!user || !user.enabled) {
    return null;
  }
  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) {
    recordFailedLogin(user.id);
    return null;
  }
  resetFailedLogin(user.id);
  return { user, resetRequired: user.password_reset_required };
}

export function getLoginDelay(username: string): number {
  const user = getUserByUsername(username);
  if (!user) return 0;
  
  const attempts = user.failed_attempts;
  return Math.min(1000 * Math.pow(2, attempts), 30000);
}