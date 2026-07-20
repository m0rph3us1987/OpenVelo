
import * as React from 'react';
import { Check, ChevronDown, X } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
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
import { cn } from '@/lib/utils';
import type { Job } from '@/lib/types';

/** Strip HTML tags so stored ADO HTML is shown as plain text in the edit form. */
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

interface AddJobDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: number;
  /** All jobs in this project, used to populate the dependency dropdown. */
  jobs: Job[];
  onCreated: () => void;
  /** When provided, the dialog operates in edit mode. */
  editJob?: Job;
}

export function AddJobDialog({
  open,
  onOpenChange,
  projectId,
  jobs,
  onCreated,
  editJob,
}: AddJobDialogProps) {
  const isEdit = !!editJob;

  const [title, setTitle] = React.useState('');
  const [description, setDescription] = React.useState('');
  const [jobType, setJobType] = React.useState<'implementation' | 'test'>('implementation');
  const [selectedDeps, setSelectedDeps] = React.useState<string[]>([]);
  const [depSearch, setDepSearch] = React.useState('');
  const [depDropdownOpen, setDepDropdownOpen] = React.useState(false);
  const [isCreating, setIsCreating] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // Pre-fill form when editing
  React.useEffect(() => {
    if (open && editJob) {
      setTitle(editJob.title ?? '');
      // Strip HTML tags for plain-text editing
      setDescription(stripHtml(editJob.description ?? ''));
      setJobType(editJob.type === 'test' ? 'test' : 'implementation');
      const deps = editJob.depends_on
        ? (() => { try { return JSON.parse(editJob.depends_on!) as string[]; } catch { return [editJob.depends_on!]; } })()
        : [];
      setSelectedDeps(deps);
    } else if (!open) {
      // Reset handled in handleOpenChange
    }
  }, [open, editJob]);

  const dropdownRef = React.useRef<HTMLDivElement>(null);

  // Close dropdown on outside click
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

  function resetForm() {
    setTitle('');
    setDescription('');
    setJobType('implementation');
    setSelectedDeps([]);
    setDepSearch('');
    setDepDropdownOpen(false);
    setError(null);
  }

  function handleOpenChange(next: boolean) {
    if (!next) resetForm();
    onOpenChange(next);
  }

  const filteredJobs = React.useMemo(() => {
    const q = depSearch.toLowerCase();
    return jobs
      .filter((j) => j.id !== editJob?.id) // exclude self from dependency list
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

  async function handleCreate() {
    if (!title.trim()) {
      setError('Title is required.');
      return;
    }
    setIsCreating(true);
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

      resetForm();
      onOpenChange(false);
      onCreated();
    } finally {
      setIsCreating(false);
    }
  }

  const disabled = jobs.length === 0;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      {/* aria-describedby={undefined} suppresses the missing-description console warning */}
      <DialogContent className="max-w-lg" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Edit Job' : 'Add Job'}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-1">
          {/* Title */}
          <div className="space-y-1.5">
            <Label htmlFor="add-job-title">Title</Label>
            <Input
              id="add-job-title"
              placeholder="Enter job title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>

          {/* Description */}
          <div className="space-y-1.5">
            <Label htmlFor="add-job-description">Description</Label>
            <Textarea
              id="add-job-description"
              placeholder="Enter a description"
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          {/* Job Type */}
          <div className="space-y-1.5">
            <Label htmlFor="add-job-type">Job Type</Label>
            <Select value={jobType} onValueChange={(v) => setJobType(v === 'test' ? 'test' : 'implementation')}>
              <SelectTrigger id="add-job-type"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="implementation">Implementation</SelectItem>
                <SelectItem value="test">Test</SelectItem>
              </SelectContent>
            </Select>
          </div>



          {/* Dependencies — uses a div trigger to avoid nested <button> */}
          <div className="space-y-1.5">
            <Label>Depends On</Label>
            <div ref={dropdownRef} className="relative">
              {/* Trigger: div acting as a combobox to avoid nesting <button> inside <button> */}
              <div
                role="combobox"
                aria-expanded={depDropdownOpen}
                aria-haspopup="listbox"
                tabIndex={disabled ? -1 : 0}
                onClick={() => { if (!disabled) setDepDropdownOpen((o) => !o); }}
                onKeyDown={(e) => {
                  if (disabled) return;
                  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setDepDropdownOpen((o) => !o); }
                  if (e.key === 'Escape') setDepDropdownOpen(false);
                }}
                className={cn(
                  'flex min-h-10 w-full cursor-pointer select-none items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                  disabled && 'cursor-not-allowed opacity-50'
                )}
                title={disabled ? 'No jobs available in this project' : undefined}
              >
                <div className="flex flex-wrap gap-1 flex-1 min-w-0">
                  {selectedDeps.length === 0 ? (
                    <span className="text-muted-foreground">
                      {disabled ? 'No jobs available' : 'Select dependencies…'}
                    </span>
                  ) : (
                    selectedJobTitles.map((depTitle, i) => (
                      <span
                        key={selectedDeps[i]}
                        className="inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-xs font-medium text-foreground"
                      >
                        <span className="max-w-[160px] truncate">{depTitle}</span>
                        {/* span acting as remove button — avoids nested <button> */}
                        <span
                          role="button"
                          tabIndex={0}
                          aria-label={`Remove ${depTitle}`}
                          className="shrink-0 cursor-pointer hover:text-destructive focus:outline-none"
                          onClick={(e) => { e.stopPropagation(); removeDep(selectedDeps[i]); }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              e.stopPropagation();
                              removeDep(selectedDeps[i]);
                            }
                          }}
                        >
                          <X className="h-3 w-3" />
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

              {/* Dropdown */}
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
                      autoFocus
                    />
                  </div>
                  <div className="max-h-48 overflow-y-auto">
                    {filteredJobs.length === 0 ? (
                      <p className="px-3 py-2 text-sm text-muted-foreground">No jobs found.</p>
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
                            className={cn(
                              'flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-accent hover:text-accent-foreground',
                              isSelected && 'bg-accent/30'
                            )}
                          >
                            <div
                              className={cn(
                                'flex h-4 w-4 shrink-0 items-center justify-center rounded border border-input',
                                isSelected && 'border-primary bg-primary text-primary-foreground'
                              )}
                            >
                              {isSelected && <Check className="h-3 w-3" />}
                            </div>
                            <span className="flex-1 truncate">{job.title ?? String(job.id)}</span>
                            <span className="shrink-0 text-xs text-muted-foreground">#{job.id}</span>
                          </button>
                        );
                      })
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Error */}
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)} disabled={isCreating}>
            Cancel
          </Button>
          <Button onClick={handleCreate} disabled={isCreating}>
            {isCreating ? (isEdit ? 'Saving…' : 'Creating…') : (isEdit ? 'Edit Job' : 'Create Job')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
