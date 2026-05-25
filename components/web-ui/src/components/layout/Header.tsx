import * as React from 'react';
import { Link } from 'react-router-dom';
import { SettingsModal } from '@/components/settings/SettingsModal';
import { ChangePasswordModal } from '@/components/auth/ChangePasswordModal';
import { useThemeContext } from '@/components/theme/ThemeProvider';
import { useAuth } from '@/context/AuthContext';
import { User } from 'lucide-react';
import { cn } from '@/lib/utils';

interface HeaderProps {
  projectName?: string;
  className?: string;
}

export function Header({ projectName, className }: HeaderProps) {
  const { logo, appTitle } = useThemeContext();
  const { user, isAdmin, isSecurityEnabled, logout } = useAuth();
  const [dropdownOpen, setDropdownOpen] = React.useState(false);
  const [changePasswordOpen, setChangePasswordOpen] = React.useState(false);

  const showSettings = isAdmin || !isSecurityEnabled;
  const showProfileDropdown = isSecurityEnabled && user !== null;

  return (
    <header className={cn('w-full z-50', className)}>
      <div className="relative h-[70px] bg-card overflow-visible">
        <div
          className="absolute top-0 left-0 right-0 h-2 z-10"
          style={{ backgroundColor: 'var(--color-primary)' }}
        />

        <Link
          to="/"
          className="absolute left-0 top-2 bottom-0 w-[200px] flex items-center justify-center z-30"
        >
          {logo && logo !== '/images/logo.svg' ? (
            <img src={logo} alt={appTitle} className="h-9 w-auto max-w-[140px] object-contain" />
          ) : (
            <span className="flex items-center gap-1.5 font-bold text-lg" style={{ color: 'var(--color-primary)' }}>
              <img src="/images/logo.svg" alt="OpenVelo Logo" className="h-8 w-8 shrink-0 object-contain" />
              <span className="hidden sm:inline">{appTitle}</span>
            </span>
          )}
        </Link>

        {projectName && (
          <div className="absolute left-[280px] right-[120px] top-2 bottom-0 flex items-center justify-center z-30">
            <span className="text-foreground font-semibold text-base truncate">{projectName}</span>
          </div>
        )}

        <div className="absolute right-4 top-2 flex items-center gap-1 z-30 h-[62px]">
          {showProfileDropdown && (
            <div className="relative">
              <button
                onClick={() => setDropdownOpen(!dropdownOpen)}
                className="flex items-center gap-2 px-3 py-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
              >
                <User className="h-5 w-5" />
                <span className="text-sm font-medium">{user?.username}</span>
              </button>
              {dropdownOpen && (
                <div className="absolute right-0 top-full mt-1 w-48 bg-popover border border-border rounded-md shadow-md z-50">
                  <button
                    className="w-full text-left px-4 py-2 text-sm text-foreground hover:bg-accent transition-colors"
                    onClick={() => {
                      setDropdownOpen(false);
                      setChangePasswordOpen(true);
                    }}
                  >
                    Change Password
                  </button>
                  <button
                    onClick={() => {
                      setDropdownOpen(false);
                      logout();
                    }}
                    className="w-full text-left px-4 py-2 text-sm text-foreground hover:bg-accent transition-colors"
                  >
                    Log out
                  </button>
                </div>
              )}
            </div>
          )}
          {showSettings && <SettingsModal />}
          <ChangePasswordModal open={changePasswordOpen} onOpenChange={setChangePasswordOpen} />
        </div>
      </div>
    </header>
  );
}