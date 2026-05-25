import * as React from 'react';

interface User {
  id: number;
  username: string;
  role: string;
}

interface AuthContextValue {
  user: User | null;
  isAdmin: boolean;
  isSecurityEnabled: boolean;
  logout: () => Promise<void>;
  loading: boolean;
}

const AuthContext = React.createContext<AuthContextValue | null>(null);

export function useAuth() {
  const ctx = React.useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

interface AuthProviderProps {
  children: React.ReactNode;
}

export function AuthProvider({ children }: AuthProviderProps) {
  const [user, setUser] = React.useState<User | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [isSecurityEnabled, setIsSecurityEnabled] = React.useState(false);

  const isAdmin = user?.role === 'admin';

  React.useEffect(() => {
    let userData: User | null = null;

    Promise.all([
      fetch('/api/auth/me'),
      fetch('/api/settings'),
    ])
      .then((responses) => {
        return Promise.all(
          responses.map((res) => {
            if (res.status === 204 || res.status === 404) return null;
            return res.json().catch(() => null);
          })
        );
      })
      .then(([authData, settingsData]) => {
        if (authData && typeof authData === 'object' && 'user' in authData) {
          const u = authData.user as User | null;
          if (u && u.id !== undefined) {
            userData = u;
            localStorage.setItem('openvelo-auth', JSON.stringify({ id: u.id, username: u.username, role: u.role }));
          }
        }
        if (settingsData && typeof settingsData === 'object' && 'securityEnabled' in settingsData) {
          setIsSecurityEnabled(settingsData.securityEnabled as boolean);
        }
      })
      .catch(() => {})
      .finally(() => {
        if (userData) {
          setUser(userData);
        }
        setLoading(false);
      });
  }, []);

  const logout = React.useCallback(async () => {
    await fetch('/api/auth/logout', { method: 'DELETE' });
    localStorage.removeItem('openvelo-auth');
    setUser(null);
    window.location.href = '/login';
  }, []);

  const value = React.useMemo(() => ({ user, isAdmin, isSecurityEnabled, logout, loading }), [user, isAdmin, isSecurityEnabled, logout, loading]);

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}