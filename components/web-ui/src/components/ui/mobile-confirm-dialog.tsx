import * as React from 'react';
import { Button } from '@/components/ui/button';
import { MobileSheet } from './mobile-sheet';
import { AlertTriangle } from 'lucide-react';

export interface MobileConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: React.ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  variant?: 'destructive' | 'default';
  onConfirm: () => void | Promise<void>;
  loading?: boolean;
}

export function MobileConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  cancelLabel = 'Cancel',
  variant = 'default',
  onConfirm,
  loading = false,
}: MobileConfirmDialogProps) {
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    if (!open) setBusy(false);
  }, [open]);

  async function handleConfirm() {
    if (busy || loading) return;
    setBusy(true);
    try {
      await onConfirm();
      onOpenChange(false);
    } catch {
      /* swallow; caller is responsible for surfacing errors via toast */
    } finally {
      setBusy(false);
    }
  }

  const isBusy = busy || loading;
  const isDestructive = variant === 'destructive';

  const footer = (
    <>
      <Button
        type="button"
        variant="outline"
        onClick={() => onOpenChange(false)}
        disabled={isBusy}
        className="tap-target flex-1"
      >
        {cancelLabel}
      </Button>
      <Button
        type="button"
        variant={isDestructive ? 'destructive' : 'default'}
        onClick={handleConfirm}
        disabled={isBusy}
        className="tap-target flex-1"
      >
        {isBusy ? 'Working…' : confirmLabel}
      </Button>
    </>
  );

  return (
    <MobileSheet
      open={open}
      onOpenChange={onOpenChange}
      title={
        <span className="flex items-center gap-2">
          {isDestructive && <AlertTriangle className="h-5 w-5 text-destructive" aria-hidden="true" />}
          <span>{title}</span>
        </span>
      }
      description={description}
      variant="bottom"
      footer={footer}
    >
      <div className="py-2" />
    </MobileSheet>
  );
}
