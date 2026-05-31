
import * as React from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ProjectForm } from './ProjectForm';
import type { Project, ProjectFormData } from '@/lib/types';
import type { Model } from '@/lib/db';
import { Loader2, CheckCircle2, XCircle, AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

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

const VALIDATION_STEPS: ValidationStep[] = [
  { id: 'name', label: 'Project Name Availability', tab: 'general', fieldId: 'name', relevantFields: ['name'] },
  { id: 'port', label: 'Port Availability', tab: 'general', fieldId: 'port', relevantFields: ['port'] },
  { id: 'models', label: 'Model Configuration', tab: 'models', fieldId: 'default_model', relevantFields: ['default_model', 'execution_model', 'analyzer_model', 'chat_model', 'requirement_model', 'planning_model', 'blueprint_model', 'review_model', 'documentation_model'] },
  { id: 'repo', label: 'Repository Connection', tab: 'repo', fieldId: 'repo_url', relevantFields: ['repo_url', 'repo_pat'] },
  { id: 'docker', label: 'Docker Image', tab: 'execution', fieldId: 'docker_image', relevantFields: ['docker_image'] },
];

function hasRelevantFieldsChanged(initial: ProjectFormData, current: ProjectFormData, fields?: (keyof ProjectFormData)[]): boolean {
  if (!fields) return false;
  return fields.some(field => String(initial[field]) !== String(current[field]));
}

export function EditProjectDialog({ project, projectId, open, onOpenChange, onUpdated }: EditProjectDialogProps) {
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [validationOpen, setValidationOpen] = React.useState(false);
  const [validationSteps, setValidationSteps] = React.useState<ValidationStep[]>(VALIDATION_STEPS);
  const [activeTabOverride, setActiveTabOverride] = React.useState<string | null>(null);
  const [focusFieldOverride, setFocusFieldOverride] = React.useState<string | null>(null);
  const [models, setModels] = React.useState<Model[]>([]);
  const [freshProject, setFreshProject] = React.useState<Project | null>(null);

  React.useEffect(() => {
    if (!open) {
      setFreshProject(null);
      setActiveTabOverride(null);
      setFocusFieldOverride(null);
      setValidationSteps(VALIDATION_STEPS);
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

  async function handleSubmit(data: ProjectFormData) {
    setIsSubmitting(true);
    setValidationOpen(true);

    const initialData: ProjectFormData = {
      password: '',
      name: project.name,
      port: project.port,
      repo_host: project.repo_host || 'github',
      repo_url: project.repo_url,
      repo_pat: project.repo_pat || '',
      docker_image: project.docker_image,
      backend: project.backend,
      default_model: project.default_model ?? '',
      execution_model: project.execution_model ?? '',
      analyzer_model: project.analyzer_model ?? '',
      chat_model: project.chat_model ?? '',
      requirement_model: project.requirement_model ?? '',
      planning_model: project.planning_model ?? '',
      blueprint_model: project.blueprint_model ?? '',
      review_model: project.review_model ?? '',
      documentation_model: project.documentation_model ?? '',
      build_cmd: project.build_cmd ?? '',
      test_cmd: project.test_cmd ?? '',
      staging_branch: project.staging_branch,
      poll_interval: project.poll_interval,
      agent_max_timeout: project.agent_max_timeout,
      max_parallel_jobs: project.max_parallel_jobs,
      max_retries: project.max_retries ?? 3,
      agent_max_retries: project.agent_max_retries ?? 3,
      remove_deleted_containers: (project.remove_deleted_containers ?? 1) === 1,
    };

    const stepsToValidate = VALIDATION_STEPS.map(step => ({
      ...step,
      status: hasRelevantFieldsChanged(initialData, data, step.relevantFields) ? 'pending' as const : 'skipped' as const,
    }));

    setValidationSteps(stepsToValidate);

    const pendingSteps = stepsToValidate.filter(s => s.status === 'pending');
    
    if (pendingSteps.length === 0) {
      setValidationOpen(false);
      try {
        const updateRes = await fetch(`/api/projects/${project.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
        });

        if (updateRes.ok) {
          onOpenChange(false);
          onUpdated();
        } else {
          const updateResult = await updateRes.json();
          console.error('Update failed:', updateResult.error);
        }
      } catch (err) {
        console.error('Update error:', err);
      } finally {
        setIsSubmitting(false);
      }
      return;
    }

    try {
      for (let i = 0; i < stepsToValidate.length; i++) {
        const step = stepsToValidate[i];
        
        if (step.status === 'skipped') continue;

        setValidationSteps(prev => prev.map((s, idx) => i === idx ? { ...s, status: 'running' } : s));

        const res = await fetch('/api/projects/validate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...data, id: project.id, step: step.id }),
        });
        
        const result = await res.json();
        
        if (result.success) {
          setValidationSteps(prev => prev.map((s, idx) => i === idx ? { ...s, status: 'success' } : s));
        } else {
          setValidationSteps(prev => prev.map((s, idx) => i === idx ? { ...s, status: 'error', message: result.message } : s));
          
          setFocusFieldOverride(step.fieldId || null);
          setActiveTabOverride(step.tab || null);
          setIsSubmitting(false);
          return;
        }
      }

      const updateRes = await fetch(`/api/projects/${project.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });

      const updateResult = await updateRes.json();
      if (updateRes.ok) {
        setValidationOpen(false);
        onOpenChange(false);
        onUpdated();
      } else {
        setValidationSteps(prev => prev.map(s => ({
          ...s,
          status: s.status === 'running' ? 'error' : s.status,
          message: s.status === 'running' ? (updateResult.error || 'Save failed') : s.message,
        })));
      }
    } catch (err) {
      console.error('Validation/Update error:', err);
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
                    step.status === 'error' ? "text-destructive" : step.status === 'skipped' ? "text-muted-foreground" : "text-foreground"
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
