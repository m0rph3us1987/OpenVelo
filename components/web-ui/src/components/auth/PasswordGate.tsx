
import * as React from 'react';
import { Lock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';

interface PasswordGateProps {
  projectId: number;
  children: React.ReactNode;
}

export function PasswordGate({ projectId, children }: PasswordGateProps) {
  const storageKey = `openvelo-auth-${projectId}`;
  const [authenticated, setAuthenticated] = React.useState(() => {
    if (typeof window === 'undefined') return false;
    return sessionStorage.getItem(storageKey) === 'true';
  });
  const [password, setPassword] = React.useState('');
  const [error, setError] = React.useState('');
  const [isLoading, setIsLoading] = React.useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setIsLoading(true);
    setError('');
    try {
      const res = await fetch(`/api/auth/${projectId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      const data = (await res.json()) as { valid: boolean };
      if (data.valid) {
        sessionStorage.setItem(storageKey, 'true');
        setAuthenticated(true);
      } else {
        setError('Invalid password');
      }
    } catch {
      setError('Authentication failed');
    } finally {
      setIsLoading(false);
    }
  }

  if (authenticated) return <>{children}</>;

  return (
    <div className="flex items-center justify-center min-h-screen bg-background">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <div className="flex justify-center mb-2">
            <Lock className="h-8 w-8 text-muted-foreground" />
          </div>
          <CardTitle>Protected Project</CardTitle>
          <CardDescription>Enter the password to access this project</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter password"
                autoFocus
              />
            </div>
            {error && <p className="text-sm text-red-400">{error}</p>}
            <Button type="submit" className="w-full" disabled={isLoading}>
              {isLoading ? 'Checking...' : 'Unlock'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}