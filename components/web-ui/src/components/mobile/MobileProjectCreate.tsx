import * as React from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { MobileShell } from './MobileShell';
import { MobileTabBar } from './MobileTabBar';
import { MobileProjectForm, MOBILE_DEFAULTS } from './MobileProjectForm';
import { MobileValidationSummary } from './MobileValidationSummary';
import { MobileFieldValidationBanners } from './MobileFieldValidationBanners';
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

export function MobileProjectCreate() {
  const navigate = useNavigate();
  const { showToast } = useToast();
  const [open, setOpen] = React.useState(false);
  const [models, setModels] = React.useState<Model[]>([]);
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [activeSection, setActiveSection] = React.useState<string>('general');
  const [steps, setSteps] = React.useState<ValidationStep[]>(
    INITIAL_VALIDATION_STEPS.map((s) => ({ ...s, status: 'pending' as const }))
  );
  const [form, setForm] = React.useState<ProjectFormData>(MOBILE_DEFAULTS);

  React.useEffect(() => {
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
  }, []);

  async function handleSubmit() {
    setIsSubmitting(true);
    setSteps(INITIAL_VALIDATION_STEPS.map((s) => ({ ...s, status: 'pending' as const })));

    await runCreateValidation(form, {
      onStepStatus: (index, status, message) => {
        setSteps((prev) =>
          prev.map((s, idx) => (idx === index ? { ...s, status, message } : s))
        );
        const failed = steps[index];
        if (status === 'error' && failed?.tab) {
          setActiveSection(failed.tab);
        }
      },
      onValidationFailed: (step) => {
        if (step.tab) setActiveSection(step.tab);
        setIsSubmitting(false);
      },
      onComplete: (project: Project) => {
        showToast('Project created', 'success');
        navigate(`/projects/${project.id}`);
        setIsSubmitting(false);
      },
      onError: (message) => {
        showToast(message, 'error');
        setIsSubmitting(false);
      },
    });
  }

  return (
    <MobileShell
      open={open}
      onOpenChange={setOpen}
      title="New Project"
      onBack={() => navigate(-1)}
    >
      <MobileTabBar
        items={SECTION_TABS.map((s) => ({ id: s.id, label: s.title }))}
        activeId={activeSection}
        onChange={setActiveSection}
      />
      <div className="flex flex-col pb-safe-bottom">
        <div className="px-4 pt-4">
          <MobileProjectForm
            value={form}
            onChange={setForm}
            activeSection={activeSection}
            focusFieldOverride={null}
            models={models}
            hasInitial={false}
          />
          <MobileFieldValidationBanners steps={steps} activeSection={activeSection} />
        </div>
        <details className="px-4 pt-2 text-mobile-caption text-muted-foreground">
          <summary className="tap-target inline-flex items-center cursor-pointer">
            All validation steps
          </summary>
          <MobileValidationSummary steps={steps} />
        </details>
        <div className="flex flex-col gap-2 px-4 pt-4 pb-safe-bottom">
          <Button
            type="button"
            className="tap-target w-full"
            disabled={isSubmitting}
            onClick={handleSubmit}
          >
            {isSubmitting ? 'Creating…' : 'Create Project'}
          </Button>
          <Button
            type="button"
            variant="outline"
            className="tap-target w-full"
            disabled={isSubmitting}
            onClick={() => navigate(-1)}
          >
            Cancel
          </Button>
        </div>
      </div>
    </MobileShell>
  );
}
