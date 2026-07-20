import * as React from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Lock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { useThemeContext } from '@/components/theme/ThemeProvider';

export function MobileLogin() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { appTitle, logo } = useThemeContext();
  const [username, setUsername] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [error, setError] = React.useState('');
  const [isLoading, setIsLoading] = React.useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setIsLoading(true);
    setError('');
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      if (res.ok) {
        const data = (await res.json()) as { resetRequired?: boolean };
        if (data.resetRequired) {
          navigate(
            '/change-password?redirect=' +
              encodeURIComponent(searchParams.get('from') ?? '/'),
            { replace: true }
          );
        } else {
          const from = searchParams.get('from') ?? '/';
          navigate(from, { replace: true });
        }
      } else {
        const data = (await res.json()) as { error?: string };
        setError(data.error ?? 'Invalid credentials');
      }
    } catch {
      setError('Authentication failed');
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div
      role="main"
      className="min-h-screen flex flex-col items-center justify-center bg-background gap-6 p-4 pt-safe-top pb-safe-bottom"
    >
      <div className="flex items-center gap-3">
        <img
          src={logo || '/images/logo.svg'}
          alt={appTitle}
          className="h-12 w-12 object-contain"
        />
        <span className="text-mobile-h1 font-bold text-foreground">{appTitle}</span>
      </div>
      <Card className="w-full">
        <CardHeader className="text-center">
          <div className="flex justify-center mb-2">
            <Lock className="h-7 w-7 text-muted-foreground" />
          </div>
          <CardTitle>Sign In</CardTitle>
          <CardDescription>Enter your credentials to continue</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div className="space-y-2">
              <Label htmlFor="username">Username</Label>
              <Input
                id="username"
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="Username"
                autoFocus
                className="tap-target w-full"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Password"
                className="tap-target w-full"
              />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button
              type="submit"
              className="tap-target w-full"
              disabled={isLoading}
            >
              {isLoading ? 'Signing in…' : 'Sign In'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
