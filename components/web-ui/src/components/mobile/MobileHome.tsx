import * as React from 'react';
import { MobileShell } from './MobileShell';
import { MobileProjectList } from './MobileProjectList';
import { MobileSettingsDialog } from './MobileSettingsDialog';

export function MobileHome() {
  const [open, setOpen] = React.useState(false);
  const [settingsOpen, setSettingsOpen] = React.useState(false);

  return (
    <>
      <MobileShell
        open={open}
        onOpenChange={setOpen}
        onTitleClick={null}
        onOpenSettings={() => setSettingsOpen(true)}
      >
        <div role="main" className="min-h-[60vh]">
          <MobileProjectList />
        </div>
      </MobileShell>
      <MobileSettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
    </>
  );
}