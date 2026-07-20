
import * as React from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Loader2, AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { MobileProjectForm, MOBILE_DEFAULTS } from './MobileProjectForm';
import { MobileTabBar } from './MobileTabBar';
import { MobileValidationStepsDialog } from './MobileValidationStepsDialog';
import {
  runCreateValidation,
  INITIAL_VALIDATION_STEPS,
  type ValidationStep,
} from '@/lib/project-validation';
import { useToast } from '@/context/ToastContext';
import type { ProjectFormData, Project } from '@/lib/types';
import type { Model } from '@/lib/db';

const SECTION_TABS = [
  { id: 'general', title: 'General' },
  { id: 'models', title: 'Models' },
  { id: 'repo', title: 'Repository' },
  { id: 'execution', title: 'Build & Exec' },
] as const;

interface MobileCreateProjectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
}

export function MobileCreateProjectDialog({ open, onOpenChange, onCreated }: MobileCreateProjectDialogProps) {
  const navigate = useNavigate();
  const { showToast } = useToast();
  const [activeSection, setActiveSection] = React.useState<string>('general');
  const [focusFieldOverride, setFocusFieldOverride] = React.useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [validationOpen, setValidationOpen] = React.useState(false);
  const [validationSteps, setValidationSteps] = React.useState<ValidationStep[]>(
    INITIAL_VALIDATION_STEPS.map((s) => ({ ...s, status: 'pending' as const }))
  );
  const [models, setModels] = React.useState<Model[]>([]);
  const [form, setForm] = React.useState<ProjectFormData>(MOBILE_DEFAULTS);

  React.useEffect(() => {
    if (!open) {
      setActiveSection('general');
      setFocusFieldOverride(null);
      setIsSubmitting(false);
      setValidationSteps(INITIAL_VALIDATION_STEPS.map((s) => ({ ...s, status: 'pending' as const })));
      setForm(MOBILE_DEFAULTS);
      return;
    }
    setForm(MOBILE_DEFAULTS);
    fetch('/api/projects/next-port')
      .then((r) => r.json())
      .then((data: { port?: number }) => {
        if (data.port) {
          setForm((prev) => ({ ...prev, port: data.port! }));
        }
      })
      .catch(() => {});
    fetch('/api/models')
      .then((r) => r.json())
      .then((data: Model[]) => setModels(data))
      .catch(() => {});
  }, [open]);

  async function handleSubmit() {
    setIsSubmitting(true);
    setValidationOpen(true);
    setValidationSteps(INITIAL_VALIDATION_STEPS.map((s) => ({ ...s, status: 'pending' as const })));

    await runCreateValidation(form, {
      onStepStatus: (index, status, message) => {
        setValidationSteps((prev) =>
          prev.map((s, idx) => (idx === index ? { ...s, status, message } : s))
        );
        const failed = validationStepsRef.current[index];
        if (status === 'error' && failed?.tab) {
          setActiveSection(failed.tab);
          setFocusFieldOverride(failed.fieldId ?? null);
        }
      },
      onValidationFailed: (step) => {
        if (step.tab) setActiveSection(step.tab);
        setFocusFieldOverride(step.fieldId ?? null);
        setIsSubmitting(false);
      },
      onComplete: (project: Project) => {
        showToast('Project created', 'success');
        setValidationOpen(false);
        onOpenChange(false);
        onCreated();
        navigate(`/projects/${project.id}`);
        setIsSubmitting(false);
      },
      onError: (message) => {
        showToast(message, 'error');
        setValidationOpen(false);
        setIsSubmitting(false);
      },
    });
  }

  const validationStepsRef = React.useRef<ValidationStep[]>(validationSteps);
  React.useEffect(() => {
    validationStepsRef.current = validationSteps;
  }, [validationSteps]);

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
            <DialogTitle>New Project</DialogTitle>
          </DialogHeader>
          <MobileTabBar
            items={SECTION_TABS.map((s) => ({ id: s.id, label: s.title }))}
            activeId={activeSection}
            onChange={setActiveSection}
          />
          <div className="flex-1 overflow-y-auto pt-4">
            <MobileProjectForm
              value={form}
              onChange={setForm}
              activeSection={activeSection}
              focusFieldOverride={focusFieldOverride}
              models={models}
              hasInitial={false}
            />
          </div>
          <div className="flex flex-col gap-2 pt-4 border-t border-border shrink-0">
            <Button
              type="button"
              className="tap-target w-full"
              disabled={isSubmitting}
              onClick={handleSubmit}
            >
              {isSubmitting ? (
                <span className="inline-flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Creating…
                </span>
              ) : (
                'Create Project'
              )}
            </Button>
            <Button
              type="button"
              variant="outline"
              className="tap-target w-full"
              disabled={isSubmitting}
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      <MobileValidationStepsDialog
        open={validationOpen}
        onOpenChange={(v) => !isSubmitting && setValidationOpen(v)}
        title={isSubmitting ? 'Project Validation' : 'Project Validation'}
        isRunning={isSubmitting}
        steps={validationSteps}
        errorIcon={<AlertCircle className="h-5 w-5 text-destructive" />}
      />
    </>
  );
}
