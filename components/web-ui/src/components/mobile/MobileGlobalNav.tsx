import * as React from 'react';
import { KeyRound, LogOut, Settings } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuth } from '@/context/AuthContext';
import { ChangePasswordModal } from '@/components/auth/ChangePasswordModal';

interface MobileGlobalNavProps {
  onOpenSettings: () => void;
}

type GlobalRowId = 'settings' | 'changePassword' | 'logout';

interface GlobalRow {
  id: GlobalRowId;
  label: string;
  icon: React.ElementType;
  onSelect: (handlers: {
    onOpenSettings: () => void;
    onOpenChangePassword: () => void;
    onLogout: () => void;
  }) => void;
}

const ROWS: GlobalRow[] = [
  {
    id: 'settings',
    label: 'Settings',
    icon: Settings,
    onSelect: ({ onOpenSettings }) => onOpenSettings(),
  },
  {
    id: 'changePassword',
    label: 'Change Password',
    icon: KeyRound,
    onSelect: ({ onOpenChangePassword }) => onOpenChangePassword(),
  },
  {
    id: 'logout',
    label: 'Log out',
    icon: LogOut,
    onSelect: ({ onLogout }) => {
      void onLogout();
    },
  },
];

export function MobileGlobalNav({ onOpenSettings }: MobileGlobalNavProps) {
  const { user, isSecurityEnabled, logout } = useAuth();
  const [changePasswordOpen, setChangePasswordOpen] = React.useState(false);

  const showAuthRows = isSecurityEnabled && user !== null;
  const visibleRows = showAuthRows
    ? ROWS
    : ROWS.filter((row) => row.id === 'settings');

  return (
    <nav aria-label="Global navigation" className="flex flex-col">
      <div className="px-4 pt-4 pb-2 text-mobile-caption uppercase tracking-wide text-muted-foreground">
        Global
      </div>
      <ul className="flex flex-col">
        {visibleRows.map((row) => {
          const Icon = row.icon;
          return (
            <li key={row.id}>
              <button
                type="button"
                onClick={() =>
                  row.onSelect({
                    onOpenSettings,
                    onOpenChangePassword: () => setChangePasswordOpen(true),
                    onLogout: logout,
                  })
                }
                className={cn(
                  'tap-target w-full text-left px-4 py-3 text-base flex items-center gap-3 active:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring text-foreground'
                )}
              >
                <Icon className="h-5 w-5 shrink-0" />
                <span>{row.label}</span>
              </button>
            </li>
          );
        })}
      </ul>
      <ChangePasswordModal
        open={changePasswordOpen}
        onOpenChange={setChangePasswordOpen}
      />
    </nav>
  );
}