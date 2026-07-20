import * as React from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Loader2, CheckCircle2, XCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ValidationStep } from '@/lib/project-validation';

interface MobileValidationStepsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  steps: ValidationStep[];
  isRunning: boolean;
  errorIcon?: React.ReactNode;
}

export function MobileValidationStepsDialog({
  open,
  onOpenChange,
  title,
  steps,
  isRunning,
  errorIcon,
}: MobileValidationStepsDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {isRunning ? (
              <Loader2 className="h-5 w-5 animate-spin text-primary" />
            ) : (
              errorIcon
            )}
            {title}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-4">
          {steps.map((step) => (
            <div key={step.id} className="flex items-start gap-3">
              <div className="mt-0.5">
                {step.status === 'running' && <Loader2 className="h-4 w-4 animate-spin text-primary" />}
                {step.status === 'success' && <CheckCircle2 className="h-4 w-4 text-green-500" />}
                {step.status === 'error' && <XCircle className="h-4 w-4 text-destructive" />}
                {step.status === 'skipped' && <div className="h-4 w-4 rounded-full border-2 border-muted opacity-50" />}
                {(!step.status || step.status === 'pending') && <div className="h-4 w-4 rounded-full border-2 border-muted" />}
              </div>
              <div className="flex-1 space-y-1">
                <p
                  className={cn(
                    'text-sm font-medium leading-none',
                    step.status === 'error'
                      ? 'text-destructive'
                      : step.status === 'skipped'
                        ? 'text-muted-foreground'
                        : 'text-foreground'
                  )}
                >
                  {step.label}
                  {step.status === 'skipped' && <span className="ml-2 text-xs">(unchanged)</span>}
                </p>
                {step.message && (
                  <p className="text-xs text-muted-foreground">{step.message}</p>
                )}
              </div>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
