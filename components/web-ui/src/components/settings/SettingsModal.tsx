import * as React from 'react';
import { Settings, Palette, Type } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
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
import { ScrollArea } from '@/components/ui/scroll-area';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { useThemeContext } from '@/components/theme/ThemeProvider';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { ModelsTab } from '@/components/models/ModelsTab';
import { UsersTab } from '@/components/settings/UsersTab';
import { GroupsTab } from '@/components/settings/GroupsTab';

const BASE_TABS = ['general', 'models'] as const;
const ADMIN_TABS = ['general', 'users', 'groups', 'models'] as const;

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

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground pb-1 border-b border-border">
      {children}
    </p>
  );
}

export function SettingsModal() {
  const { theme, setTheme, themes, appTitle, setAppTitle } = useThemeContext();
  const { isAdmin } = useAuth();
  const { showToast } = useToast();
  const [open, setOpen] = React.useState(false);
  const [titleDraft, setTitleDraft] = React.useState(appTitle);
  const [activeTab, setActiveTab] = React.useState<string>('general');
  const [debugSseConsole, setDebugSseConsole] = React.useState(false);
  const [securityEnabled, setSecurityEnabled] = React.useState(false);

  const TABS = isAdmin ? ADMIN_TABS : BASE_TABS;
  const availableThemes = themes.length > 0 ? themes : Object.keys(THEME_LABELS);

  React.useEffect(() => {
    if (!open) return;
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

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
          aria-label="Open settings"
        >
          <Settings className="h-5 w-5" />
        </button>
      </DialogTrigger>
      <DialogContent className="min-w-[800px] max-w-[800px] h-[85vh] flex flex-col" onInteractOutside={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
        </DialogHeader>
        <div className="flex flex-1 overflow-hidden">
          <Tabs value={activeTab} onValueChange={setActiveTab} orientation="vertical" className="flex w-full overflow-hidden">
            <div className="w-[180px] border-r border-border pr-2 py-1 flex flex-col gap-1 shrink-0">
              <TabsList className="flex flex-col h-auto bg-transparent p-0 gap-1">
                {TABS.map((tab) => (
                  <TabsTrigger key={tab} value={tab} className="flex items-center justify-start px-4 py-2 text-sm font-medium transition-colors hover:bg-muted/50 data-[state=active]:bg-muted data-[state=active]:text-foreground rounded-md w-full text-left capitalize">
                    {tab}
                  </TabsTrigger>
                ))}
              </TabsList>
            </div>
            <div className="flex-1 overflow-hidden relative">
              <ScrollArea className="h-full px-6">
                <div className="py-2 space-y-6">
                  <TabsContent value="general" className="mt-0 space-y-6">

                    {/* General */}
                    <div className="space-y-3">
                      <SectionHeading>General</SectionHeading>
                      <div className="space-y-1.5">
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
                          className="max-w-xs"
                        />
                        <p className="text-xs text-muted-foreground">Displayed in the header. Saved to the database.</p>
                      </div>
                    </div>

                    {/* Appearance */}
                    <div className="space-y-3">
                      <SectionHeading>Appearance</SectionHeading>
                      <div className="space-y-1.5">
                        <Label htmlFor="theme-select" className="flex items-center gap-2">
                          <Palette className="h-3.5 w-3.5 text-muted-foreground" />
                          Theme
                        </Label>
                        <Select value={theme} onValueChange={setTheme}>
                          <SelectTrigger id="theme-select" className="w-[200px] h-8 text-xs">
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
                        <p className="text-xs text-muted-foreground">
                          Add custom themes by placing{' '}
                          <code className="text-xs bg-muted px-1 rounded">*.json</code> files in{' '}
                          <code className="text-xs bg-muted px-1 rounded">public/themes/</code>.
                          Set a <code className="text-xs bg-muted px-1 rounded">"logo"</code> field to a public path to use a custom logo.
                        </p>
                      </div>
                    </div>

                    {/* Security */}
                    {isAdmin && (
                      <div className="space-y-3">
                        <SectionHeading>Security</SectionHeading>
                        <div className="flex items-center justify-between">
                          <div className="space-y-0.5">
                            <Label htmlFor="security-enabled" className="flex items-center gap-2">
                              Security enabled
                            </Label>
                            <p className="text-xs text-muted-foreground">
                              When enabled, all pages and API routes require authentication.
                            </p>
                          </div>
                          <Switch
                            id="security-enabled"
                            checked={securityEnabled}
                            onCheckedChange={handleSecurityEnabledChange}
                          />
                        </div>
                      </div>
                    )}

                    {/* Debug */}
                    <div className="space-y-3">
                      <SectionHeading>Debug</SectionHeading>
                      <div className="flex items-center justify-between">
                        <div className="space-y-0.5">
                          <Label htmlFor="debug-sse-console" className="flex items-center gap-2">
                            Show raw SSE events in console
                          </Label>
                          <p className="text-xs text-muted-foreground">
                            Logs each SSE block to the browser console when processing agent responses.
                          </p>
                        </div>
                        <Switch
                          id="debug-sse-console"
                          checked={debugSseConsole}
                          onCheckedChange={handleDebugSseConsoleChange}
                        />
                      </div>
                    </div>

                  </TabsContent>
                  <TabsContent value="users" className="mt-0 h-full">
                    <UsersTab />
                  </TabsContent>
                  <TabsContent value="groups" className="mt-0 h-full">
                    <GroupsTab />
                  </TabsContent>
                  <TabsContent value="models" className="mt-0 h-full">
                    <ModelsTab />
                  </TabsContent>
                </div>
              </ScrollArea>
            </div>
          </Tabs>
        </div>
      </DialogContent>
    </Dialog>
  );
}