import * as React from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ProjectForm } from './ProjectForm';
import type { Project, ProjectFormData } from '@/lib/types';
import type { Model } from '@/lib/db';
import { Loader2, CheckCircle2, XCircle, AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  EDIT_VALIDATION_STEPS,
  runUpdateValidation,
} from '@/lib/project-validation';

interface EditProjectDialogProps {
  project: Project;
  projectId: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUpdated: () => void;
}

interface ValidationStep {
  id: string;
  label: string;
  status?: 'pending' | 'running' | 'success' | 'error' | 'skipped';
  message?: string;
  tab?: string;
  fieldId?: string;
  relevantFields?: (keyof ProjectFormData)[];
}

export function EditProjectDialog({ project, projectId, open, onOpenChange, onUpdated }: EditProjectDialogProps) {
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [validationOpen, setValidationOpen] = React.useState(false);
  const [validationSteps, setValidationSteps] = React.useState<ValidationStep[]>(
    EDIT_VALIDATION_STEPS.map((s) => ({ ...s }))
  );
  const [activeTabOverride, setActiveTabOverride] = React.useState<string | null>(null);
  const [focusFieldOverride, setFocusFieldOverride] = React.useState<string | null>(null);
  const [models, setModels] = React.useState<Model[]>([]);
  const [freshProject, setFreshProject] = React.useState<Project | null>(null);

  React.useEffect(() => {
    if (!open) {
      setFreshProject(null);
      setActiveTabOverride(null);
      setFocusFieldOverride(null);
      setValidationSteps(EDIT_VALIDATION_STEPS.map((s) => ({ ...s })));
      return;
    }
    fetch(`/api/projects/${projectId}`)
      .then((r) => r.json())
      .then((data: Project) => setFreshProject(data))
      .catch(() => {});
    fetch('/api/models')
      .then((r) => r.json())
      .then((data: Model[]) => setModels(data))
      .catch(() => {});
  }, [open, projectId]);

  function setStepStatus(index: number, status: ValidationStep['status'], message?: string) {
    setValidationSteps((prev) => prev.map((s, idx) =>
      idx === index ? { ...s, status, message: message ?? s.message } : s
    ));
  }

  async function handleSubmit(data: ProjectFormData) {
    setIsSubmitting(true);
    setValidationOpen(true);

    try {
      await runUpdateValidation(project, data, {
        onStepStatus: (index, status, message) => setStepStatus(index, status, message),
        onValidationFailed: (step) => {
          const idx = EDIT_VALIDATION_STEPS.findIndex((s) => s.id === step.id);
          if (idx !== -1) setStepStatus(idx, 'error', step.message ?? undefined);
          setFocusFieldOverride(step.fieldId || null);
          setActiveTabOverride(step.tab || null);
          setIsSubmitting(false);
        },
        onCloneStepProgress: (_step, message) => {
          const idx = EDIT_VALIDATION_STEPS.findIndex((s) => s.id === 'repo_clone');
          if (idx !== -1) {
            setValidationSteps((prev) => prev.map((s, i) =>
              i === idx ? { ...s, message } : s
            ));
          }
        },
        onComplete: () => {
          setValidationOpen(false);
          onOpenChange(false);
          onUpdated();
        },
        onError: (message) => {
          setValidationSteps((prev) => prev.map((s) => ({
            ...s,
            status: s.status === 'running' ? 'error' : s.status,
            message: s.status === 'running' ? message : s.message,
          })));
        },
        onNoChanges: () => {
          // No validation needed; runUpdateValidation handles the PUT itself.
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
            <DialogTitle>Edit Project</DialogTitle>
            <DialogDescription className="sr-only">Edit the configuration of this project.</DialogDescription>
          </DialogHeader>
          <div className="flex-1 overflow-hidden">
            <ProjectForm
              initial={freshProject || project}
              models={models}
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
                  {step.status === 'skipped' && <div className="h-4 w-4 rounded-full border-2 border-muted opacity-50" />}
                  {step.status === 'pending' && <div className="h-4 w-4 rounded-full border-2 border-muted" />}
                </div>
                <div className="flex-1 space-y-1">
                  <p className={cn(
                    "text-sm font-medium leading-none",
                    step.status === "error" ? "text-destructive" : step.status === "skipped" ? "text-muted-foreground" : "text-foreground"
                  )}>
                    {step.label}
                    {step.status === 'skipped' && <span className="ml-2 text-xs">(unchanged)</span>}
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