import * as React from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ProjectForm } from './ProjectForm';
import type { ProjectFormData } from '@/lib/types';
import type { Model } from '@/lib/db';
import { Loader2, CheckCircle2, XCircle, AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { INITIAL_VALIDATION_STEPS, runCreateValidation } from '@/lib/project-validation';

interface CreateProjectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
}

interface ValidationStep {
  id: string;
  label: string;
  status: 'pending' | 'running' | 'success' | 'error';
  message?: string;
  tab?: string;
  fieldId?: string;
}

type CreateStepStatus = 'pending' | 'running' | 'success' | 'error';

const INITIAL_STEPS: ValidationStep[] = INITIAL_VALIDATION_STEPS.map((step) => ({
  id: step.id,
  label: step.label,
  status: 'pending',
  tab: step.tab,
  fieldId: step.fieldId,
}));

export function CreateProjectDialog({ open, onOpenChange, onCreated }: CreateProjectDialogProps) {
  const navigate = useNavigate();
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [suggestedPort, setSuggestedPort] = React.useState<number | null>(null);
  const [validationOpen, setValidationOpen] = React.useState(false);
  const [validationSteps, setValidationSteps] = React.useState<ValidationStep[]>(INITIAL_STEPS);
  const [activeTabOverride, setActiveTabOverride] = React.useState<string | null>(null);
  const [focusFieldOverride, setFocusFieldOverride] = React.useState<string | null>(null);
  const [models, setModels] = React.useState<Model[]>([]);

  React.useEffect(() => {
    if (!open) {
      setActiveTabOverride(null);
      setFocusFieldOverride(null);
      setValidationSteps(INITIAL_STEPS);
      return;
    }
    fetch('/api/projects/next-port')
      .then((r) => r.json())
      .then((data: { port?: number }) => { if (data.port) setSuggestedPort(data.port); })
      .catch(() => {});
    fetch('/api/models')
      .then((r) => r.json())
      .then((data: Model[]) => setModels(data))
      .catch(() => {});
  }, [open]);

  function setStepStatus(index: number, status: CreateStepStatus, message?: string) {
    setValidationSteps((prev) => prev.map((s, idx) =>
      idx === index ? { ...s, status, message: message ?? s.message } : s
    ));
  }

  function findStepIndex(id: string): number {
    return INITIAL_STEPS.findIndex((s) => s.id === id);
  }

  async function handleSubmit(data: ProjectFormData) {
    setIsSubmitting(true);
    setValidationOpen(true);
    setValidationSteps(INITIAL_STEPS.map((s) => ({ ...s, status: 'pending' })));

    try {
      await runCreateValidation(data, {
        onStepStatus: (index, status, message) => {
          if (status === 'skipped') return;
          setStepStatus(index, status as CreateStepStatus, message);
        },
        onValidationFailed: (step) => {
          const idx = findStepIndex(step.id);
          if (idx !== -1) setStepStatus(idx, 'error', step.message ?? undefined);
          setFocusFieldOverride(step.fieldId || null);
          setActiveTabOverride(step.tab || null);
          setTimeout(() => setValidationOpen(false), 2000);
          setIsSubmitting(false);
        },
        onCloneStepStart: () => {
          // status already set to 'running' by onStepStatus
        },
        onCloneStepProgress: (_step, message) => {
          const idx = findStepIndex('repo_clone');
          if (idx !== -1) {
            setValidationSteps((prev) => prev.map((s, i) =>
              i === idx ? { ...s, message } : s
            ));
          }
        },
        onComplete: (project) => {
          setValidationOpen(false);
          onOpenChange(false);
          onCreated();
          navigate(`/projects/${project.id}`);
        },
        onError: (message) => {
          setValidationSteps((prev) => [
            ...prev,
            { id: 'creation', label: 'Project Creation', status: 'error', message },
          ]);
          setTimeout(() => setValidationOpen(false), 3000);
        },
      });
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-4xl h-[85vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>New Project</DialogTitle>
          </DialogHeader>
          <div className="flex-1 overflow-hidden">
            <ProjectForm
              models={models}
              suggestedPort={suggestedPort ?? undefined}
              onSubmit={handleSubmit}
              onCancel={() => onOpenChange(false)}
              isSubmitting={isSubmitting}
              activeTabOverride={activeTabOverride ?? undefined}
              focusFieldOverride={focusFieldOverride}
            />
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={validationOpen} onOpenChange={(v) => !isSubmitting && setValidationOpen(v)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {isSubmitting ? (
                <Loader2 className="h-5 w-5 animate-spin text-primary" />
              ) : (
                <AlertCircle className="h-5 w-5 text-destructive" />
              )}
              Project Validation
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            {validationSteps.map((step) => (
              <div key={step.id} className="flex items-start gap-3">
                <div className="mt-0.5">
                  {step.status === 'running' && <Loader2 className="h-4 w-4 animate-spin text-primary" />}
                  {step.status === 'success' && <CheckCircle2 className="h-4 w-4 text-green-500" />}
                  {step.status === 'error' && <XCircle className="h-4 w-4 text-destructive" />}
                  {step.status === 'pending' && <div className="h-4 w-4 rounded-full border-2 border-muted" />}
                </div>
                <div className="flex-1 space-y-1">
                  <p className={cn(
                    "text-sm font-medium leading-none",
                    step.status === 'error' ? "text-destructive" : "text-foreground"
                  )}>
                    {step.label}
                  </p>
                  {step.message && (
                    <p className="text-xs text-muted-foreground">
                      {step.message}
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}