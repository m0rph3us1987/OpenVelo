import * as React from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { MobileShell } from './MobileShell';
import { MobileTabBar } from './MobileTabBar';
import { MobileProjectForm, mobileToFormData } from './MobileProjectForm';
import { MobileValidationSummary } from './MobileValidationSummary';
import { MobileFieldValidationBanners } from './MobileFieldValidationBanners';
import {
  runUpdateValidation,
  EDIT_VALIDATION_STEPS,
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

export function MobileProjectEdit() {
  const { id } = useParams<{ id: string }>();
  const projectId = parseInt(id ?? '', 10);
  const navigate = useNavigate();
  const { showToast } = useToast();
  const [open, setOpen] = React.useState(false);
  const [project, setProject] = React.useState<Project | null>(null);
  const [models, setModels] = React.useState<Model[]>([]);
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [activeSection, setActiveSection] = React.useState<string>('general');
  const [steps, setSteps] = React.useState<ValidationStep[]>(
    EDIT_VALIDATION_STEPS.map((s) => ({ ...s, status: 'pending' as const }))
  );
  const [form, setForm] = React.useState<ProjectFormData | null>(null);

  React.useEffect(() => {
    if (!projectId) return;
    fetch(`/api/projects/${projectId}`)
      .then((r) => r.json())
      .then((data: Project) => {
        setProject(data);
        setForm(mobileToFormData(data));
      })
      .catch(() => {});
    fetch('/api/models')
      .then((r) => r.json())
      .then((data: Model[]) => setModels(data))
      .catch(() => {});
  }, [projectId]);

  async function handleSubmit() {
    if (!project || !form) return;
    setIsSubmitting(true);
    setSteps(EDIT_VALIDATION_STEPS.map((s) => ({ ...s, status: 'pending' as const })));

    await runUpdateValidation(project, form, {
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
      onNoChanges: () => {},
      onComplete: () => {
        showToast('Project saved', 'success');
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
      title="Edit Project"
      onBack={() => navigate(-1)}
    >
      {project && form && (
        <MobileTabBar
          items={SECTION_TABS.map((s) => ({ id: s.id, label: s.title }))}
          activeId={activeSection}
          onChange={setActiveSection}
        />
      )}
      <div className="flex flex-col pb-safe-bottom">
        {project && form ? (
          <div className="px-4 pt-4">
            <MobileProjectForm
              value={form}
              onChange={setForm}
              activeSection={activeSection}
              focusFieldOverride={null}
              models={models}
              hasInitial
            />
            <MobileFieldValidationBanners steps={steps} activeSection={activeSection} />
          </div>
        ) : (
          <div className="px-4 py-6 text-mobile-body text-muted-foreground">Loading project…</div>
        )}
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
            disabled={isSubmitting || !project}
            onClick={handleSubmit}
          >
            {isSubmitting ? 'Saving…' : 'Save Changes'}
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
