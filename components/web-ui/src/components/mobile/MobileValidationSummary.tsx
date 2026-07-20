import * as React from 'react';
import { AlertCircle, CheckCircle2, Loader2 } from 'lucide-react';
import type { ValidationStep } from '@/lib/project-validation';
import { cn } from '@/lib/utils';

interface MobileValidationSummaryProps {
  steps: ValidationStep[];
}

export function MobileValidationSummary({ steps }: MobileValidationSummaryProps) {
  if (steps.every((s) => !s.status || s.status === 'pending')) return null;
  return (
    <ul className="flex flex-col gap-1 mt-2" aria-label="Validation status">
      {steps.map((step) => {
        if (!step.status || step.status === 'pending') return null;
        return (
          <li
            key={step.id}
            className={cn(
              'flex items-start gap-2 text-mobile-caption',
              step.status === 'error' ? 'text-destructive' : 'text-muted-foreground'
            )}
          >
            <span className="mt-0.5 shrink-0">
              {step.status === 'running' && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {step.status === 'success' && <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />}
              {step.status === 'error' && <AlertCircle className="h-3.5 w-3.5" />}
              {step.status === 'skipped' && <span className="block h-3.5 w-3.5 rounded-full border border-muted-foreground/40" />}
            </span>
            <span className="flex-1">
              {step.label}
              {step.status === 'skipped' && ' (unchanged)'}
              {step.message ? `: ${step.message}` : ''}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
