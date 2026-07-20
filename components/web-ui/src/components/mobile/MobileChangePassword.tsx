import * as React from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Lock, Zap } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { useThemeContext } from '@/components/theme/ThemeProvider';

export function MobileChangePassword() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { appTitle, logo } = useThemeContext();
  const [currentPassword, setCurrentPassword] = React.useState('');
  const [newPassword, setNewPassword] = React.useState('');
  const [confirmPassword, setConfirmPassword] = React.useState('');
  const [error, setError] = React.useState('');
  const [isLoading, setIsLoading] = React.useState(false);

  React.useEffect(() => {
    fetch('/api/auth/me')
      .then((r) => {
        if (!r.ok) throw new Error('Unauthorized');
        return r.json();
      })
      .catch(() => {
        navigate('/login', { replace: true });
      });
  }, [navigate]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');

    if (newPassword !== confirmPassword) {
      setError('New passwords do not match');
      return;
    }

    setIsLoading(true);
    try {
      const res = await fetch('/api/users/me/password', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      if (res.ok) {
        const redirect = searchParams.get('redirect') ?? '/';
        navigate(redirect, { replace: true });
      } else {
        const data = (await res.json()) as { error?: string };
        setError(data.error ?? 'Failed to change password');
      }
    } catch {
      setError('Password change failed');
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
        {logo ? (
          <img src={logo} alt={appTitle} className="h-12 w-12 object-contain" />
        ) : (
          <Zap className="h-12 w-12 text-primary" />
        )}
        <span className="text-mobile-h1 font-bold text-foreground">{appTitle}</span>
      </div>
      <Card className="w-full">
        <CardHeader className="text-center">
          <div className="flex justify-center mb-2">
            <Lock className="h-7 w-7 text-muted-foreground" />
          </div>
          <CardTitle>Change Password</CardTitle>
          <CardDescription>Enter your current password and choose a new one</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div className="space-y-2">
              <Label htmlFor="currentPassword">Current Password</Label>
              <Input
                id="currentPassword"
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                placeholder="Current password"
                autoFocus
                className="tap-target w-full"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="newPassword">New Password</Label>
              <Input
                id="newPassword"
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="New password"
                className="tap-target w-full"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirmPassword">Confirm New Password</Label>
              <Input
                id="confirmPassword"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Confirm new password"
                className="tap-target w-full"
              />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button
              type="submit"
              className="tap-target w-full"
              disabled={isLoading}
            >
              {isLoading ? 'Updating…' : 'Update Password'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
