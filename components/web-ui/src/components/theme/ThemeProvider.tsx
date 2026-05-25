import * as React from 'react';
import type { ThemeDefinition } from '@/lib/types';

const APP_TITLE_KEY = 'openvelo-app-title';
const THEME_KEY = 'openvelo-theme';

interface ThemeContextValue {
  theme: string;
  setTheme: (name: string) => void;
  toggleDarkLight: () => void;
  isDark: boolean;
  themes: string[];
  logo: string | null;
  appTitle: string;
  setAppTitle: (title: string) => void;
}

const ThemeContext = React.createContext<ThemeContextValue>({
  theme: 'dark',
  setTheme: () => {},
  toggleDarkLight: () => {},
  isDark: true,
  themes: [],
  logo: null,
  appTitle: 'OpenVelo',
  setAppTitle: () => {},
});

export function useThemeContext() {
  return React.useContext(ThemeContext);
}

interface ThemeProviderProps {
  children: React.ReactNode;
}

export function ThemeProvider({ children }: ThemeProviderProps) {
  const [theme, setThemeState] = React.useState<string>('dark');
  const [themes, setThemes] = React.useState<string[]>([]);
  const [logo, setLogo] = React.useState<string | null>(null);
  const [appTitle, setAppTitleState] = React.useState<string>('OpenVelo');

  React.useEffect(() => {
    fetch('/api/settings')
      .then((r) => r.json())
      .then((data: { appTitle?: string; theme?: string }) => {
        if (data.theme) {
          setThemeState(data.theme);
          localStorage.setItem(THEME_KEY, data.theme);
        }
        if (data.appTitle) {
          setAppTitleState(data.appTitle);
          localStorage.setItem(APP_TITLE_KEY, data.appTitle);
        }
      })
      .catch(() => {});
  }, []);

  React.useEffect(() => {
    fetch('/api/themes')
      .then((r) => r.json())
      .then((data: { key: string }[]) => setThemes(data.map((t) => t.key)))
      .catch(() => {});
  }, []);

  React.useEffect(() => {
    fetch(`/api/themes/${theme}`)
      .then((r) => r.json())
      .then((data: ThemeDefinition) => {
        const root = document.documentElement;
        Object.entries(data.colors).forEach(([key, value]) => {
          if (key === 'radius') {
            root.style.setProperty('--radius', value);
          } else if (key !== 'logo') {
            root.style.setProperty(`--color-${key}`, value);
          }
        });
        const logoVal = data.logo ?? (data.colors as unknown as Record<string, string>).logo ?? null;
        setLogo(logoVal);
      })
      .catch(() => {});
  }, [theme]);

  const setTheme = React.useCallback((name: string) => {
    setThemeState(name);
    localStorage.setItem(THEME_KEY, name);
    fetch('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ theme: name }),
    }).catch(() => {});
  }, []);

  const isDark = theme.endsWith('-dark') || theme === 'dark' || theme === 'midnight' || theme === 'nord' || theme === 'ocean' || theme === 'slate';

  const toggleDarkLight = React.useCallback(() => {
    if (theme.endsWith('-light')) {
      setTheme(theme.replace(/-light$/, '-dark'));
    } else if (theme.endsWith('-dark')) {
      setTheme(theme.replace(/-dark$/, '-light'));
    } else if (theme === 'light') {
      setTheme('dark');
    } else if (theme === 'dark') {
      setTheme('light');
    } else {
      setTheme(isDark ? 'light' : 'dark');
    }
  }, [theme, isDark, setTheme]);

  const setAppTitle = React.useCallback((title: string) => {
    setAppTitleState(title);
    localStorage.setItem(APP_TITLE_KEY, title);
    fetch('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ appTitle: title }),
    }).catch(() => {});
  }, []);

  return (
    <ThemeContext.Provider value={{ theme, setTheme, toggleDarkLight, isDark, themes, logo, appTitle, setAppTitle }}>
      {children}
    </ThemeContext.Provider>
  );
}