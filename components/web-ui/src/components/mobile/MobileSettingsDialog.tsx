import * as React from 'react';
import { Palette, Type } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { ModelsTab } from '@/components/models/ModelsTab';
import { MobileUsersTab } from './MobileUsersBody';
import { MobileGroupsTab } from './MobileGroupsBody';
import { useThemeContext } from '@/components/theme/ThemeProvider';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { cn } from '@/lib/utils';

interface MobileSettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const THEME_LABELS: Record<string, string> = {
  dark: 'Dark',
  light: 'Light',
  ocean: 'Ocean',
  forest: 'Forest',
  sunset: 'Sunset',
  midnight: 'Midnight',
  rose: 'Rose',
  amber: 'Amber',
  slate: 'Slate',
  nord: 'Nord',
};

type SectionId = 'general' | 'models' | 'users' | 'groups';

function getSections(isAdmin: boolean): SectionId[] {
  return isAdmin
    ? ['general', 'users', 'groups', 'models']
    : ['general', 'models'];
}

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-mobile-caption font-semibold uppercase tracking-wider text-muted-foreground pb-1 border-b border-border">
      {children}
    </p>
  );
}

export function MobileSettingsDialog({ open, onOpenChange }: MobileSettingsDialogProps) {
  const { theme, setTheme, themes, appTitle, setAppTitle } = useThemeContext();
  const { isAdmin } = useAuth();
  const { showToast } = useToast();

  const sections = React.useMemo(() => getSections(isAdmin), [isAdmin]);
  const [activeSection, setActiveSection] = React.useState<SectionId>('general');
  const [titleDraft, setTitleDraft] = React.useState(appTitle);
  const [debugSseConsole, setDebugSseConsole] = React.useState(false);
  const [securityEnabled, setSecurityEnabled] = React.useState(false);

  const availableThemes = themes.length > 0 ? themes : Object.keys(THEME_LABELS);

  React.useEffect(() => {
    if (!open) {
      setActiveSection('general');
      setTitleDraft(appTitle);
      return;
    }
    setTitleDraft(appTitle);
    fetch('/api/settings')
      .then((r) => r.json())
      .then((data: { debugSseConsole?: boolean; securityEnabled?: boolean }) => {
        if (data.debugSseConsole !== undefined) setDebugSseConsole(data.debugSseConsole);
        if (data.securityEnabled !== undefined) setSecurityEnabled(data.securityEnabled);
      })
      .catch(() => {});
  }, [open, appTitle]);

  function handleTitleBlur() {
    const trimmed = titleDraft.trim();
    if (trimmed && trimmed !== appTitle) setAppTitle(trimmed);
    else if (!trimmed) setTitleDraft(appTitle);
  }

  async function handleSecurityEnabledChange(checked: boolean) {
    setSecurityEnabled(checked);
    try {
      const res = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ securityEnabled: checked }),
      });
      if (!res.ok) {
        setSecurityEnabled(!checked);
        showToast('Failed to update security setting.', 'error');
        return;
      }
      showToast(checked ? 'Security enabled. Please log in.' : 'Security disabled.', 'success');
      onOpenChange(false);
      window.location.href = '/login';
    } catch {
      setSecurityEnabled(!checked);
      showToast('Failed to update security setting.', 'error');
    }
  }

  function handleDebugSseConsoleChange(checked: boolean) {
    setDebugSseConsole(checked);
    fetch('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ debugSseConsole: checked }),
    }).catch(() => {});
  }

  function handleCancel() {
    if (titleDraft !== appTitle) setTitleDraft(appTitle);
    onOpenChange(false);
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          className={cn(
            'inset-x-0 top-12 bottom-0 max-w-none translate-x-0 translate-y-0 rounded-t-2xl rounded-b-none h-auto pb-safe-bottom p-4',
            'flex flex-col'
          )}
        >
          <DialogHeader>
            <DialogTitle>Settings</DialogTitle>
          </DialogHeader>
          <nav
            aria-label="Settings sections"
            className="border-b border-border -mx-4 px-2 shrink-0"
          >
            <ul className="flex items-center gap-1 overflow-x-auto min-h-[48px]">
              {sections.map((id) => {
                const active = id === activeSection;
                const label = id.charAt(0).toUpperCase() + id.slice(1);
                return (
                  <li key={id}>
                    <button
                      type="button"
                      role="tab"
                      aria-selected={active}
                      onClick={() => setActiveSection(id)}
                      className={cn(
                        'tap-target inline-flex items-center justify-center whitespace-nowrap px-4 text-mobile-body rounded-md active:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                        active
                          ? 'bg-primary/10 text-primary font-semibold'
                          : 'text-foreground'
                      )}
                    >
                      {label}
                    </button>
                  </li>
                );
              })}
            </ul>
          </nav>
          <div className="flex-1 overflow-y-auto pt-4">
            {activeSection === 'general' && (
              <div className="flex flex-col gap-6">
                <div className="flex flex-col gap-3">
                  <SectionHeading>General</SectionHeading>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="app-title" className="flex items-center gap-2">
                      <Type className="h-3.5 w-3.5 text-muted-foreground" />
                      Application Title
                    </Label>
                    <Input
                      id="app-title"
                      value={titleDraft}
                      onChange={(e) => setTitleDraft(e.target.value)}
                      onBlur={handleTitleBlur}
                      onKeyDown={(e) => e.key === 'Enter' && handleTitleBlur()}
                      placeholder="OpenVelo"
                      className="tap-target w-full"
                    />
                    <p className="text-mobile-caption text-muted-foreground">Displayed in the header. Saved to the database.</p>
                  </div>
                </div>

                <div className="flex flex-col gap-3">
                  <SectionHeading>Appearance</SectionHeading>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="theme-select" className="flex items-center gap-2">
                      <Palette className="h-3.5 w-3.5 text-muted-foreground" />
                      Theme
                    </Label>
                    <Select value={theme} onValueChange={setTheme}>
                      <SelectTrigger id="theme-select" className="tap-target w-full">
                        <SelectValue placeholder="Select theme" />
                      </SelectTrigger>
                      <SelectContent>
                        {availableThemes.map((key) => (
                          <SelectItem key={key} value={key}>
                            {THEME_LABELS[key] ?? key}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                {isAdmin && (
                  <div className="flex flex-col gap-3">
                    <SectionHeading>Security</SectionHeading>
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex flex-col gap-0.5 flex-1">
                        <Label htmlFor="security-enabled">Security enabled</Label>
                        <p className="text-mobile-caption text-muted-foreground">
                          When enabled, all pages and API routes require authentication.
                        </p>
                      </div>
                      <Switch
                        id="security-enabled"
                        className="tap-target"
                        checked={securityEnabled}
                        onCheckedChange={handleSecurityEnabledChange}
                      />
                    </div>
                  </div>
                )}

                <div className="flex flex-col gap-3">
                  <SectionHeading>Debug</SectionHeading>
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex flex-col gap-0.5 flex-1">
                      <Label htmlFor="debug-sse-console">Show raw SSE events in console</Label>
                      <p className="text-mobile-caption text-muted-foreground">
                        Logs each SSE block to the browser console when processing agent responses.
                      </p>
                    </div>
                    <Switch
                      id="debug-sse-console"
                      className="tap-target"
                      checked={debugSseConsole}
                      onCheckedChange={handleDebugSseConsoleChange}
                    />
                  </div>
                </div>
              </div>
            )}
            {activeSection === 'models' && (
              <div className="[&_button]:min-h-11">
                <ModelsTab />
              </div>
            )}
            {activeSection === 'users' && isAdmin && (
              <div className="[&_button]:min-h-11 [&_.grid]:grid-cols-1">
                <MobileUsersTab />
              </div>
            )}
            {activeSection === 'groups' && isAdmin && (
              <div className="[&_button]:min-h-11">
                <MobileGroupsTab />
              </div>
            )}
          </div>
          <div className="flex flex-col gap-2 pt-4 border-t border-border shrink-0">
            <Button
              type="button"
              className="tap-target w-full"
              onClick={() => onOpenChange(false)}
            >
              Done
            </Button>
            <Button
              type="button"
              variant="outline"
              className="tap-target w-full"
              onClick={handleCancel}
            >
              Cancel
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}