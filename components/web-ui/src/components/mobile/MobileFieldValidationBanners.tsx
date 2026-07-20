import * as React from 'react';
import { Loader2, CheckCircle2, AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ValidationStep } from '@/lib/project-validation';

interface MobileFieldValidationBannersProps {
  steps: ValidationStep[];
  activeSection: string;
}

const BANNER_PREFIX = 'mobile-field-banner';

function bannerClassName(status: ValidationStep['status']): string {
  const base = 'mt-1 flex items-start gap-2 rounded-md px-3 py-2 text-mobile-caption';
  if (status === 'error') return cn(base, 'bg-destructive/10 text-destructive');
  if (status === 'success') return cn(base, 'bg-green-500/10 text-green-700 dark:text-green-400');
  if (status === 'running') return cn(base, 'bg-amber-500/10 text-amber-700 dark:text-amber-400');
  return cn(base, 'text-muted-foreground');
}

function StatusIcon({ status }: { status: ValidationStep['status'] }) {
  if (status === 'running') return <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0 mt-0.5" />;
  if (status === 'success') return <CheckCircle2 className="h-3.5 w-3.5 shrink-0 mt-0.5" />;
  if (status === 'error') return <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />;
  return null;
}

export function MobileFieldValidationBanners({ steps, activeSection }: MobileFieldValidationBannersProps) {
  const visibleSteps = React.useMemo(
    () => steps.filter((s) => s.tab === activeSection && s.fieldId),
    [steps, activeSection]
  );
  const [pendingSteps, setPendingSteps] = React.useState<ValidationStep[]>([]);

  React.useEffect(() => {
    if (typeof document === 'undefined') return;
    const queue: ValidationStep[] = [];

    visibleSteps.forEach((step) => {
      const field = document.getElementById(step.fieldId!);
      if (!field) {
        queue.push(step);
        return;
      }
      const parent = field.parentElement;
      if (!parent) return;

      const existing = parent.querySelector(`[data-banner-for="${step.id}"]`);
      if (existing) existing.remove();

      if (!step.status || step.status === 'pending') return;

      const banner = document.createElement('div');
      banner.setAttribute('data-banner-for', step.id);
      banner.setAttribute('data-banner-source', BANNER_PREFIX);
      banner.setAttribute('role', 'status');
      banner.setAttribute('aria-live', 'polite');
      banner.className = bannerClassName(step.status);

      const text = document.createElement('span');
      text.textContent = step.message ? `${step.label}: ${step.message}` : step.label;
      banner.appendChild(text);

      parent.insertBefore(banner, field.nextSibling);
    });

    setPendingSteps(queue);
  }, [visibleSteps, steps]);

  React.useEffect(() => {
    return () => {
      if (typeof document === 'undefined') return;
      document
        .querySelectorAll(`[data-banner-source="${BANNER_PREFIX}"]`)
        .forEach((el) => el.remove());
    };
  }, []);

  if (pendingSteps.length === 0) return null;

  return (
    <div className="px-1 pt-2 flex flex-col gap-1" aria-label="Validation steps pending field">
      {pendingSteps.map((step) => (
        <div
          key={step.id}
          className={cn(
            'flex items-start gap-2 rounded-md px-3 py-2 text-mobile-caption',
            step.status === 'error' && 'bg-destructive/10 text-destructive',
            step.status === 'success' && 'bg-green-500/10 text-green-700 dark:text-green-400',
            step.status === 'running' && 'bg-amber-500/10 text-amber-700 dark:text-amber-400',
            (!step.status || step.status === 'pending') && 'text-muted-foreground'
          )}
        >
          <StatusIcon status={step.status} />
          <span>
            {step.label}
            {step.message ? `: ${step.message}` : ''}
          </span>
        </div>
      ))}
    </div>
  );
}
