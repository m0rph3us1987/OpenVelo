import * as React from 'react';
import { Check, ChevronDown, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { MobileSheet } from '@/components/ui/mobile-sheet';
import { MobileConfirmDialog } from '@/components/ui/mobile-confirm-dialog';
import { useToast } from '@/context/ToastContext';
import { cn } from '@/lib/utils';
import type { Job } from '@/lib/types';

function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

export interface MobileAddJobSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: number;
  jobs: Job[];
  onCreated: () => void;
  editJob?: Job;
}

export function MobileAddJobSheet({
  open,
  onOpenChange,
  projectId,
  jobs,
  onCreated,
  editJob,
}: MobileAddJobSheetProps) {
  const isEdit = !!editJob;
  const { showToast } = useToast();
  const [title, setTitle] = React.useState('');
  const [description, setDescription] = React.useState('');
  const [jobType, setJobType] = React.useState<'implementation' | 'test'>('implementation');
  const [selectedDeps, setSelectedDeps] = React.useState<string[]>([]);
  const [depSearch, setDepSearch] = React.useState('');
  const [depDropdownOpen, setDepDropdownOpen] = React.useState(false);
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [confirmDiscardOpen, setConfirmDiscardOpen] = React.useState(false);

  React.useEffect(() => {
    if (open && editJob) {
      setTitle(editJob.title ?? '');
      setDescription(stripHtml(editJob.description ?? ''));
      setJobType(editJob.type === 'test' ? 'test' : 'implementation');
      const deps = editJob.depends_on
        ? (() => {
            try {
              return JSON.parse(editJob.depends_on!) as string[];
            } catch {
              return [editJob.depends_on!];
            }
          })()
        : [];
      setSelectedDeps(deps);
    } else if (!open) {
      setTitle('');
      setDescription('');
      setJobType('implementation');
      setSelectedDeps([]);
      setDepSearch('');
      setDepDropdownOpen(false);
      setError(null);
      setIsSubmitting(false);
    }
  }, [open, editJob]);

  const dropdownRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!depDropdownOpen) return;
    function handleClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDepDropdownOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [depDropdownOpen]);

  const dirty = React.useMemo(() => {
    if (isEdit) {
      if (!editJob) return false;
      if ((title ?? '') !== (editJob.title ?? '')) return true;
      const baseDesc = stripHtml(editJob.description ?? '');
      if ((description ?? '') !== baseDesc) return true;
      const baseType: 'implementation' | 'test' = editJob.type === 'test' ? 'test' : 'implementation';
      if (jobType !== baseType) return true;
      const baseDeps = editJob.depends_on
        ? (() => {
            try {
              return JSON.parse(editJob.depends_on!) as string[];
            } catch {
              return [editJob.depends_on!];
            }
          })()
        : [];
      if (selectedDeps.length !== baseDeps.length) return true;
      for (let i = 0; i < selectedDeps.length; i += 1) {
        if (selectedDeps[i] !== baseDeps[i]) return true;
      }
      return false;
    }
    return title.trim().length > 0 || description.trim().length > 0 || selectedDeps.length > 0 || jobType !== 'implementation';
  }, [isEdit, editJob, title, description, selectedDeps, jobType]);

  function handleCloseRequest(next: boolean) {
    if (!next && dirty) {
      setConfirmDiscardOpen(true);
      return;
    }
    onOpenChange(next);
  }

  const filteredJobs = React.useMemo(() => {
    const q = depSearch.toLowerCase();
    return jobs
      .filter((j) => j.id !== editJob?.id)
      .filter((j) => j.title?.toLowerCase().includes(q) || String(j.id).toLowerCase().includes(q));
  }, [jobs, depSearch, editJob?.id]);

  function toggleDep(jobId: string) {
    setSelectedDeps((prev) =>
      prev.includes(jobId) ? prev.filter((id) => id !== jobId) : [...prev, jobId]
    );
  }

  function removeDep(jobId: string) {
    setSelectedDeps((prev) => prev.filter((id) => id !== jobId));
  }

  const selectedJobTitles = React.useMemo(
    () => jobs.filter((j) => selectedDeps.includes(String(j.id))).map((j) => j.title ?? String(j.id)),
    [jobs, selectedDeps]
  );

  async function handleSubmit() {
    if (!title.trim()) {
      setError('Title is required.');
      return;
    }
    setIsSubmitting(true);
    setError(null);
    try {
      const body = {
        title: title.trim(),
        description: description.trim() || null,
        dependsOn: selectedDeps.length > 0 ? selectedDeps : null,
        type: jobType,
      };

      const res = isEdit
        ? await fetch(`/api/projects/${projectId}/jobs/${editJob!.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          })
        : await fetch(`/api/projects/${projectId}/jobs`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          });

      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setError(data.error ?? `Failed to ${isEdit ? 'update' : 'create'} job (${res.status})`);
        return;
      }

      showToast(isEdit ? 'Job updated.' : 'Job created.', 'success');
      onOpenChange(false);
      onCreated();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unexpected error');
    } finally {
      setIsSubmitting(false);
    }
  }

  const footer = (
    <>
      <Button
        type="button"
        variant="outline"
        onClick={() => handleCloseRequest(false)}
        disabled={isSubmitting}
        className="tap-target flex-1"
      >
        Cancel
      </Button>
      <Button
        type="button"
        onClick={handleSubmit}
        disabled={isSubmitting || !title.trim()}
        className="tap-target flex-1"
      >
        {isSubmitting ? (isEdit ? 'Saving…' : 'Creating…') : isEdit ? 'Save' : 'Create Job'}
      </Button>
    </>
  );

  return (
    <>
      <MobileSheet
        open={open}
        onOpenChange={handleCloseRequest}
        title={isEdit ? 'Edit job' : 'Add job'}
        variant="bottom"
        footer={footer}
      >
        <div className="flex flex-col gap-4 py-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="mobile-job-title">Title</Label>
            <Input
              id="mobile-job-title"
              placeholder="Enter job title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="tap-target text-mobile-body"
              autoFocus
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="mobile-job-description">Description</Label>
            <Textarea
              id="mobile-job-description"
              placeholder="Enter a description"
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="text-mobile-body"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="mobile-job-type">Job Type</Label>
            <Select value={jobType} onValueChange={(v) => setJobType(v === 'test' ? 'test' : 'implementation')}>
              <SelectTrigger id="mobile-job-type" className="tap-target text-mobile-body"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="implementation">Implementation</SelectItem>
                <SelectItem value="test">Test</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>Depends on</Label>
            <div ref={dropdownRef} className="relative">
              <div
                role="combobox"
                aria-expanded={depDropdownOpen}
                aria-haspopup="listbox"
                tabIndex={0}
                onClick={() => setDepDropdownOpen((o) => !o)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    setDepDropdownOpen((o) => !o);
                  }
                  if (e.key === 'Escape') setDepDropdownOpen(false);
                }}
                className="tap-target flex min-h-11 w-full cursor-pointer select-none items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-mobile-body"
              >
                <div className="flex flex-1 flex-wrap gap-1 min-w-0">
                  {selectedDeps.length === 0 ? (
                    <span className="text-muted-foreground">Select dependencies…</span>
                  ) : (
                    selectedJobTitles.map((depTitle, i) => (
                      <span
                        key={selectedDeps[i]}
                        className="inline-flex items-center gap-1 rounded bg-muted px-2 py-0.5 text-mobile-caption font-medium text-foreground"
                      >
                        <span className="max-w-[160px] truncate">{depTitle}</span>
                        <span
                          role="button"
                          tabIndex={0}
                          aria-label={`Remove ${depTitle}`}
                          className="tap-target inline-flex shrink-0 cursor-pointer items-center justify-center rounded text-muted-foreground active:text-destructive"
                          onClick={(e) => {
                            e.stopPropagation();
                            removeDep(selectedDeps[i]);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              e.stopPropagation();
                              removeDep(selectedDeps[i]);
                            }
                          }}
                        >
                          <X className="h-4 w-4" />
                        </span>
                      </span>
                    ))
                  )}
                </div>
                <ChevronDown
                  className={cn(
                    'ml-2 h-4 w-4 shrink-0 text-muted-foreground transition-transform',
                    depDropdownOpen && 'rotate-180'
                  )}
                />
              </div>

              {depDropdownOpen && (
                <div
                  role="listbox"
                  aria-multiselectable="true"
                  className="absolute z-50 mt-1 w-full rounded-md border border-border bg-popover shadow-md"
                >
                  <div className="p-2">
                    <Input
                      placeholder="Search jobs…"
                      value={depSearch}
                      onChange={(e) => setDepSearch(e.target.value)}
                      onClick={(e) => e.stopPropagation()}
                      className="tap-target"
                    />
                  </div>
                  <div className="max-h-48 overflow-y-auto">
                    {filteredJobs.length === 0 ? (
                      <p className="px-3 py-2 text-mobile-caption text-muted-foreground">No jobs found.</p>
                    ) : (
                      filteredJobs.map((job) => {
                        const isSelected = selectedDeps.includes(String(job.id));
                        return (
                          <button
                            key={job.id}
                            type="button"
                            role="option"
                            aria-selected={isSelected}
                            onClick={() => toggleDep(String(job.id))}
                            className="tap-target flex w-full items-center gap-2 px-3 py-2 text-left text-mobile-body active:bg-accent"
                          >
                            <span
                              className={cn(
                                'flex h-5 w-5 shrink-0 items-center justify-center rounded border border-input',
                                isSelected && 'border-primary bg-primary text-primary-foreground'
                              )}
                            >
                              {isSelected && <Check className="h-3 w-3" />}
                            </span>
                            <span className="flex-1 truncate">{job.title ?? String(job.id)}</span>
                            <span className="shrink-0 text-mobile-caption text-muted-foreground">#{job.id}</span>
                          </button>
                        );
                      })
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>

          {error && (
            <p role="alert" className="text-mobile-caption text-destructive">
              {error}
            </p>
          )}
        </div>
      </MobileSheet>

      <MobileConfirmDialog
        open={confirmDiscardOpen}
        onOpenChange={setConfirmDiscardOpen}
        title="Discard changes?"
        description="You have unsaved changes. They will be lost if you close this sheet now."
        confirmLabel="Discard"
        cancelLabel="Keep editing"
        variant="destructive"
        onConfirm={() => onOpenChange(false)}
      />
    </>
  );
}
