
import * as React from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ProjectForm } from './ProjectForm';
import type { ProjectFormData, Project } from '@/lib/types';
import type { Model } from '@/lib/db';
import { Loader2, CheckCircle2, XCircle, AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

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

const INITIAL_STEPS: ValidationStep[] = [
  { id: 'name', label: 'Project Name Availability', status: 'pending', tab: 'general', fieldId: 'name' },
  { id: 'port', label: 'Port Availability', status: 'pending', tab: 'general', fieldId: 'port' },
  { id: 'models', label: 'Model Configuration', status: 'pending', tab: 'models', fieldId: 'default_model' },
  { id: 'repo', label: 'Repository Connection', status: 'pending', tab: 'repo', fieldId: 'repo_url' },
  { id: 'docker', label: 'Docker Image', status: 'pending', tab: 'execution', fieldId: 'docker_image' },
];

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

  async function handleSubmit(data: ProjectFormData) {
    setIsSubmitting(true);
    setValidationOpen(true);
    
    const steps = [...INITIAL_STEPS];
    setValidationSteps(steps.map(s => ({ ...s, status: 'pending' })));

    try {
      for (let i = 0; i < steps.length; i++) {
        const step = steps[i];
        
        // Mark current step as running
        setValidationSteps(prev => prev.map((s, idx) => i === idx ? { ...s, status: 'running' } : s));

        const res = await fetch('/api/projects/validate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...data, step: step.id }),
        });
        
        const result = await res.json();
        
        if (result.success) {
          setValidationSteps(prev => prev.map((s, idx) => i === idx ? { ...s, status: 'success' } : s));
        } else {
          setValidationSteps(prev => prev.map((s, idx) => i === idx ? { ...s, status: 'error', message: result.message } : s));
          
          setFocusFieldOverride(step.fieldId || null);
          setActiveTabOverride(step.tab || null);
          setTimeout(() => {
            setValidationOpen(false);
          }, 2000);
          setIsSubmitting(false);
          return;
        }
      }

      // If all validations passed, create the project
      const createRes = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });

      if (createRes.ok) {
        const project = await createRes.json() as Project;
        setValidationOpen(false);
        onOpenChange(false);
        onCreated();
        navigate(`/projects/${project.id}`);
      } else {
        const errData = await createRes.json();
        setValidationSteps(prev => [
          ...prev,
          { id: 'creation', label: 'Project Creation', status: 'error', message: errData.error || 'Failed to create project' }
        ]);
        setTimeout(() => {
          setValidationOpen(false);
        }, 3000);
      }
    } catch (err) {
      console.error('Validation/Creation error:', err);
      setValidationSteps(prev => [
        ...prev,
        { id: 'exception', label: 'System Error', status: 'error', message: String(err) }
      ]);
      setTimeout(() => {
        setValidationOpen(false);
      }, 3000);
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
