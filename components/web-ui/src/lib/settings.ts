import crypto from 'crypto';
import { getUiSetting, setUiSetting } from './db';

export interface AppSettings {
  appTitle: string;
  securityEnabled: boolean;
  debugSseConsole: boolean;
}

export interface SettingsUpdate {
  appTitle?: string;
  securityEnabled?: boolean;
  debugSseConsole?: boolean;
}

export function getSettings(): AppSettings {
  return {
    appTitle: getUiSetting('app_title') ?? 'OpenVelo',
    securityEnabled: getUiSetting('security_enabled') === 'true',
    debugSseConsole: getUiSetting('debug_sse_console') === 'true',
  };
}

export function saveSettings(updates: SettingsUpdate): AppSettings {
  if (updates.appTitle !== undefined) {
    setUiSetting('app_title', updates.appTitle || 'OpenVelo');
  }
  if (updates.securityEnabled !== undefined) {
    setUiSetting('security_enabled', updates.securityEnabled ? 'true' : 'false');
  }
  if (updates.debugSseConsole !== undefined) {
    setUiSetting('debug_sse_console', updates.debugSseConsole ? 'true' : 'false');
  }
  return getSettings();
}

export const SESSION_COOKIE = 'openvelo-token';
export const AUTH_MESSAGE = 'openvelo-authenticated';
export const COOKIE_MAX_AGE = 60 * 60 * 24 * 30 * 1000; // 30 days in milliseconds

export function computeToken(secret: string): string {
  return crypto.createHmac('sha256', secret).update(AUTH_MESSAGE).digest('hex');
}
