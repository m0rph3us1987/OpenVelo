import * as React from 'react';
import type { ChatSession } from '@/lib/types';
import { useStageWebSocket } from '@/hooks/useStageWebSocket';
import { TextLog } from '@/components/ui/text-log';
import { ParallelLogViewer } from './ParallelLogViewer';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/context/ToastContext';
import {
  AlertCircle,
  Play,
  Settings,
  ChevronRight,
  Trash2,
  X as XIcon,
  Plus
} from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useIsMobile } from '@/hooks/useIsMobile';

interface ChatPlanProps {
  chat: ChatSession;
  onHeaderInfo?: (info: { title: string; showSpinner: boolean }) => void;
  viewOnly?: boolean;
  overrideSubStage?: string;
}

export function ChatPlan({ chat, onHeaderInfo, viewOnly, overrideSubStage }: ChatPlanProps) {
  const { subStage: wsSubStage, progress } = useStageWebSocket({ chatId: chat.id, stage: 'plan', enabled: !viewOnly });
  const subStage = viewOnly ? (overrideSubStage ?? 'plan') : wsSubStage;
  const [actionLoading, setActionLoading] = React.useState(false);

  React.useEffect(() => {
    const titleMap: Record<string, string> = {
      'discovery': 'Discovering jobs...',
      'generation': 'Generating job specifications...',
      'test': 'Evaluating tests...',
      'plan': 'Plan ready',
      'error': 'Error',
    };
    let subtitle = titleMap[subStage] ?? 'Plan';

    if (progress) {
      subtitle = progress;
    }

    let showSpinner = ['discovery', 'generation', 'test'].includes(subStage);
    if (chat.running === 0) {
      subtitle = 'Stopped';
      showSpinner = false;
    }

    onHeaderInfo?.({
      title: `${chat.name} - ${subtitle}`,
      showSpinner,
    });
  }, [chat.id, subStage, progress, chat.name, onHeaderInfo, chat.running]);

  const handleStop = async () => {
    setActionLoading(true);
    try {
      await fetch(`/api/chats/${chat.id}/stop`, { method: 'POST' });
    } catch (err) {
      console.error('Failed to stop:', err);
    } finally {
      setActionLoading(false);
    }
  };

  const handleResume = async () => {
    setActionLoading(true);
    try {
      await fetch(`/api/chats/${chat.id}/resume`, { method: 'POST' });
    } catch (err) {
      console.error('Failed to resume:', err);
    } finally {
      setActionLoading(false);
    }
  };

  const renderStopResumeOverlay = () => {
    if (viewOnly) return null;
    const isGenerating = ['discovery', 'generation', 'test'].includes(subStage);
    if (!isGenerating && chat.running !== 0) return null;

    return (
      <div className="absolute top-4 right-4 z-50">
        {chat.running === 1 ? (
          <Button
            variant="destructive"
            size="sm"
            onClick={handleStop}
            disabled={actionLoading}
            className="shadow-md"
          >
            Stop
          </Button>
        ) : (
          <Button
            variant="default"
            size="sm"
            onClick={handleResume}
            disabled={actionLoading}
            className="bg-emerald-600 hover:bg-emerald-700 text-white shadow-md"
          >
            Resume
          </Button>
        )}
      </div>
    );
  };

  if (subStage === 'discovery') {
    return (
      <div className="relative w-full h-full">
        {renderStopResumeOverlay()}
        <TextLog key={chat.id} chatId={chat.id} />
      </div>
    );
  }

  if (subStage === 'generation') {
    return (
      <div className="relative w-full h-full">
        {renderStopResumeOverlay()}
        <ParallelLogViewer chatId={chat.id} type="plan" />
      </div>
    );
  }

  if (subStage === 'test') {
    return (
      <div className="relative w-full h-full">
        {renderStopResumeOverlay()}
        <ParallelLogViewer chatId={chat.id} type="test" />
      </div>
    );
  }

  if (subStage === 'error') {
    const handleRetry = async () => {
      await fetch(`/api/plan/${chat.id}/retry`, { method: 'POST' });
    };
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 text-muted-foreground">
        <AlertCircle className="h-10 w-10 text-destructive" />
        <span>Error generating plan</span>
        <Button onClick={handleRetry} variant="outline">Retry</Button>
      </div>
    );
  }

  return <PlanView chat={chat} viewOnly={viewOnly} />;
}

interface PlanBlock {
  id: number;
  block_index: number;
  title: string;
  description: string;
}

interface PlanJob {
  id: number;
  job_index: number;
  title: string;
  description: string;
  requirement_line_mapping: string;
  content: string | null;
  test_plan_markdown: string;
  implements_job_id: number | null;
  build_cmd: string;
  test_cmd: string;
  block_id: number | null;
  block_sequence: number;
  depends_on: number[];
}

function parseDependsOn(raw: unknown): number[] {
  if (Array.isArray(raw)) {
    return raw
      .map(v => Number(v))
      .filter(v => Number.isInteger(v) && v > 0)
      .slice(0, 1);
  }
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed
          .map(v => Number(v))
          .filter(v => Number.isInteger(v) && v > 0)
          .slice(0, 1);
      }
      const n = Number(parsed);
      if (Number.isInteger(n) && n > 0) return [n];
    } catch { /* ignore */ }
  }
  return [];
}

function sortByDeps(jobs: PlanJob[]): PlanJob[] {
  if (jobs.length === 0) return jobs;
  const byId = new Map(jobs.map(j => [j.id, j]));
  const childrenOf = new Map<number, PlanJob[]>();
  const indeg = new Map<number, number>();
  for (const j of jobs) {
    indeg.set(j.id, 0);
    const parentId = j.depends_on[0];
    if (parentId && parentId !== j.id && byId.has(parentId)) {
      const list = childrenOf.get(parentId) ?? [];
      list.push(j);
      childrenOf.set(parentId, list);
      indeg.set(j.id, (indeg.get(j.id) ?? 0) + 1);
    }
  }
  const queue: PlanJob[] = jobs
    .filter(j => (indeg.get(j.id) ?? 0) === 0)
    .slice()
    .sort((a, b) => a.job_index - b.job_index);
  const out: PlanJob[] = [];
  while (queue.length) {
    const j = queue.shift()!;
    out.push(j);
    const kids = (childrenOf.get(j.id) ?? [])
      .slice()
      .sort((a, b) => a.job_index - b.job_index);
    for (const k of kids) {
      const next = (indeg.get(k.id) ?? 0) - 1;
      indeg.set(k.id, next);
      if (next === 0) {
        const pos = queue.findIndex(x => x.job_index > k.job_index);
        queue.splice(pos === -1 ? queue.length : pos, 0, k);
      }
    }
  }
  if (out.length < jobs.length) {
    const seen = new Set(out.map(j => j.id));
    const leftover = jobs
      .filter(j => !seen.has(j.id))
      .sort((a, b) => a.job_index - b.job_index);
    out.push(...leftover);
  }
  return out;
}

function collectDescendants(jobs: PlanJob[], rootId: number): Set<number> {
  const childMap = new Map<number, number[]>();
  for (const j of jobs) {
    const parentId = j.depends_on[0];
    if (parentId && parentId !== j.id) {
      const list = childMap.get(parentId) ?? [];
      list.push(j.id);
      childMap.set(parentId, list);
    }
  }
  const out = new Set<number>();
  const stack = [rootId];
  while (stack.length) {
    const cur = stack.pop()!;
    const kids = childMap.get(cur) ?? [];
    for (const k of kids) {
      if (!out.has(k)) {
        out.add(k);
        stack.push(k);
      }
    }
  }
  return out;
}

function PlanView({ chat, viewOnly }: { chat: ChatSession; viewOnly?: boolean }) {
  const isMobile = useIsMobile();
  const { showToast } = useToast();
  const MobileConfirmDialog = React.lazy(() =>
    import('@/components/ui/mobile-confirm-dialog').then((m) => ({ default: m.MobileConfirmDialog }))
  );
  const [jobs, setJobs] = React.useState<PlanJob[]>([]);
  const [blocks, setBlocks] = React.useState<PlanBlock[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [generatingTests, setGeneratingTests] = React.useState(false);
  const [buildCmd, setBuildCmd] = React.useState('');
  const [testCmd, setTestCmd] = React.useState('');
  const [expandedJobs, setExpandedJobs] = React.useState<Set<number>>(new Set());
  const [creatingJobs, setCreatingJobs] = React.useState(false);
  const [showRegenConfirm, setShowRegenConfirm] = React.useState(false);

  interface JobDraft {
    title: string;
    description: string;
    content: string;
    test_plan_markdown: string;
    specField: 'content' | 'test_plan_markdown';
    specPresent: boolean;
  }

  const [jobDrafts, setJobDrafts] = React.useState<Record<number, JobDraft>>({});
  const [jobSaveStatus, setJobSaveStatus] = React.useState<Record<number, 'idle' | 'saving' | 'error'>>({});
  const jobDraftsRef = React.useRef(jobDrafts);
  jobDraftsRef.current = jobDrafts;

  const seedDrafts = React.useCallback((list: PlanJob[]) => {
    setJobDrafts(prev => {
      const next: Record<number, JobDraft> = {};
      for (const j of list) {
        const isTest = j.implements_job_id !== null;
        const field: 'content' | 'test_plan_markdown' = isTest ? 'test_plan_markdown' : 'content';
        next[j.id] = prev[j.id] ?? {
          title: j.title,
          description: j.description,
          content: j.content ?? '',
          test_plan_markdown: j.test_plan_markdown ?? '',
          specField: field,
          specPresent: !isTest ? j.content != null && j.content !== '' : (j.test_plan_markdown ?? '') !== '',
        };
      }
      return next;
    });
  }, []);

  const [deletingJobId, setDeletingJobId] = React.useState<number | null>(null);
  const [isDeleting, setIsDeleting] = React.useState(false);

  const [pickerForJobId, setPickerForJobId] = React.useState<number | null>(null);
  const [savingDepsIds, setSavingDepsIds] = React.useState<Set<number>>(new Set());

  React.useEffect(() => {
    fetchPlanData();
    fetchProject();
  }, [chat.id]);

  const fetchPlanData = async () => {
    try {
      const [jobsRes, blocksRes] = await Promise.all([
        fetch(`/api/plan/jobs?chatId=${chat.id}`),
        fetch(`/api/plan/blocks?chatId=${chat.id}`)
      ]);
      if (jobsRes.ok && blocksRes.ok) {
        const jobsData = await jobsRes.json();
        const blocksData = await blocksRes.json();
        const normalized = (jobsData as Array<Record<string, unknown>>).map(j => ({
          ...(j as unknown as PlanJob),
          depends_on: parseDependsOn(j.depends_on),
        })) as PlanJob[];
        setJobs(normalized);
        seedDrafts(normalized);
        setBlocks(blocksData);
        setExpandedJobs(prev => {
          const next = new Set<number>();
          for (const id of prev) {
            if (normalized.some(j => j.id === id)) next.add(id);
          }
          if (next.size === 0 && normalized.length > 0) {
            next.add(normalized[0].id);
          }
          return next;
        });
      }
    } catch (err) {
      console.error('Failed to fetch plan data:', err);
    } finally {
      setLoading(false);
    }
  };

  const fetchProject = async () => {
    try {
      const res = await fetch(`/api/projects/${chat.project_id}`);
      if (res.ok) {
        const data = await res.json();
        setBuildCmd(data.build_cmd || '');
        setTestCmd(data.test_cmd || '');
      }
    } catch (err) {
      console.error('Failed to fetch project:', err);
    }
  };

  const toggleJob = (jobId: number) => {
    setExpandedJobs(prev => {
      const next = new Set(prev);
      if (next.has(jobId)) next.delete(jobId);
      else next.add(jobId);
      return next;
    });
  };

  const handleRegeneratePlan = () => {
    setShowRegenConfirm(true);
  };

  const handleGenerateTests = async () => {
    setGeneratingTests(true);
    try {
      const res = await fetch(`/api/plan/${chat.id}/generate-tests`, {
        method: 'POST',
      });
      if (!res.ok) {
        console.error('Failed to trigger test generation');
      }
    } catch (err) {
      console.error('Failed to trigger test generation:', err);
    } finally {
      setGeneratingTests(false);
    }
  };

  const confirmRegenerate = async () => {
    setShowRegenConfirm(false);
    try {
      await fetch(`/api/plan/${chat.id}/regenerate`, { method: 'POST' });
    } catch (err) {
      console.error('Failed to regenerate plan:', err);
    }
  };

  const handleCreateJobs = async () => {
    setCreatingJobs(true);
    try {
      const res = await fetch(`/api/projects/${chat.project_id}/create-jobs-from-stories`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chatId: chat.id }),
      });
      if (res.ok) {
        window.location.href = `/projects/${chat.project_id}`;
      }
    } catch (err) {
      console.error('Failed to create execution jobs:', err);
    } finally {
      setCreatingJobs(false);
    }
  };

  const updateJobLocal = (id: number, mut: (j: PlanJob) => PlanJob) => {
    setJobs(prev => prev.map(j => (j.id === id ? mut(j) : j)));
  };

  type SaveableDraft = Pick<JobDraft, 'title' | 'description' | 'specField' | 'content' | 'test_plan_markdown'>;

  const saveDraftField = React.useCallback(async (
    jobId: number,
    draft: SaveableDraft,
    fields: Array<'title' | 'description' | 'content' | 'test_plan_markdown'>
  ): Promise<boolean> => {
    setJobSaveStatus(prev => ({ ...prev, [jobId]: 'saving' }));
    const body: Record<string, unknown> = {};
    if (fields.includes('title')) {
      const trimmed = draft.title.trim();
      if (!trimmed) {
        setJobSaveStatus(prev => ({ ...prev, [jobId]: 'error' }));
        showToast('Title cannot be empty.', 'error');
        return false;
      }
      body.title = trimmed;
      body.description = draft.description;
    }
    if (fields.includes(draft.specField)) {
      if (draft.specField === 'content') {
        body.content = draft.content;
      } else {
        body.test_plan_markdown = draft.test_plan_markdown;
      }
    }
    try {
      const res = await fetch(`/api/plan/${chat.id}/jobs/${jobId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setJobSaveStatus(prev => ({ ...prev, [jobId]: 'error' }));
        showToast(err.error || 'Failed to save plan entry.', 'error');
        return false;
      }
      updateJobLocal(jobId, j => {
        const next = { ...j };
        if (fields.includes('title')) {
          next.title = String(body.title);
          next.description = String(body.description ?? draft.description);
        }
        if (fields.includes('content')) {
          next.content = draft.content;
        }
        if (fields.includes('test_plan_markdown')) {
          next.test_plan_markdown = draft.test_plan_markdown;
        }
        return next;
      });
      setJobSaveStatus(prev => ({ ...prev, [jobId]: 'idle' }));
      return true;
    } catch (err) {
      console.error('Failed to save plan entry:', err);
      setJobSaveStatus(prev => ({ ...prev, [jobId]: 'error' }));
      showToast('Failed to save plan entry.', 'error');
      return false;
    }
  }, [chat.id, showToast]);

  const debounceTimersRef = React.useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const scheduleSave = React.useCallback((
    jobId: number,
    draft: SaveableDraft,
    fields: Array<'title' | 'description' | 'content' | 'test_plan_markdown'>
  ) => {
    const key = `${jobId}:${fields.join(',')}`;
    const existing = debounceTimersRef.current[key];
    if (existing) clearTimeout(existing);
    debounceTimersRef.current[key] = setTimeout(() => {
      void saveDraftField(jobId, draft, fields);
    }, 500);
  }, [saveDraftField]);

  React.useEffect(() => {
    const timers = debounceTimersRef.current;
    return () => {
      for (const id of Object.keys(timers)) {
        clearTimeout(timers[id]);
      }
    };
  }, []);

  const updateDraft = React.useCallback((
    jobId: number,
    patch: Partial<Pick<JobDraft, 'title' | 'description' | 'content' | 'test_plan_markdown'>>
  ) => {
    setJobDrafts(prev => {
      const current = prev[jobId];
      if (!current) return prev;
      const nextDraft = { ...current, ...patch };
      const fieldsToSave: Array<'title' | 'description' | 'content' | 'test_plan_markdown'> = [];
      if (patch.title !== undefined || patch.description !== undefined) {
        fieldsToSave.push('title', 'description');
      }
      if (patch.content !== undefined && current.specField === 'content') {
        fieldsToSave.push('content');
      }
      if (patch.test_plan_markdown !== undefined && current.specField === 'test_plan_markdown') {
        fieldsToSave.push('test_plan_markdown');
      }
      if (fieldsToSave.length > 0) {
        scheduleSave(jobId, nextDraft, fieldsToSave);
      }
      return { ...prev, [jobId]: nextDraft };
    });
  }, [scheduleSave]);

  const flushDraft = React.useCallback(async (jobId: number, fields: Array<'title' | 'description' | 'content' | 'test_plan_markdown'>) => {
    const draft = jobDraftsRef.current[jobId];
    if (!draft) return;
    for (const f of fields) {
      const key = `${jobId}:${f}`;
      const t = debounceTimersRef.current[key];
      if (t) {
        clearTimeout(t);
        delete debounceTimersRef.current[key];
      }
    }
    const targetKey = `${jobId}:${fields.join(',')}`;
    const targetT = debounceTimersRef.current[targetKey];
    if (targetT) {
      clearTimeout(targetT);
      delete debounceTimersRef.current[targetKey];
    }
    await saveDraftField(jobId, draft, fields);
  }, [saveDraftField]);

  const saveDep = async (jobId: number, nextDep: number | null) => {
    setSavingDepsIds(prev => new Set(prev).add(jobId));
    const res = await fetch(`/api/plan/${chat.id}/jobs/${jobId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ depends_on: nextDep == null ? [] : [nextDep] }),
    });
    setSavingDepsIds(prev => {
      const next = new Set(prev);
      next.delete(jobId);
      return next;
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      showToast(err.error || 'Failed to save dependency.', 'error');
      return;
    }
    const deps: number[] = nextDep == null ? [] : [nextDep];
    updateJobLocal(jobId, j => ({ ...j, depends_on: deps }));
    // Re-sorting: re-fetch from server to ensure UI matches canonical order
    fetchPlanData();
  };

  const requestDelete = (jobId: number) => {
    setDeletingJobId(jobId);
  };

  const confirmDelete = async () => {
    if (deletingJobId == null) return;
    const jobId = deletingJobId;
    setIsDeleting(true);
    const res = await fetch(`/api/plan/${chat.id}/jobs/${jobId}`, {
      method: 'DELETE',
    });
    setIsDeleting(false);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      showToast(err.error || 'Failed to delete plan entry.', 'error');
      return;
    }
    setDeletingJobId(null);
    setExpandedJobs(prev => {
      const next = new Set(prev);
      next.delete(jobId);
      return next;
    });
    await fetchPlanData();
    showToast('Plan entry deleted.', 'success');
  };

  const sortedJobsAll = React.useMemo(() => sortByDeps(jobs), [jobs]);
  const jobsByBlock = React.useMemo(() => {
    const map = new Map<string | number, PlanJob[]>();
    for (const j of sortedJobsAll) {
      const key = j.block_id ?? '__uncategorized__';
      const list = map.get(key) ?? [];
      list.push(j);
      map.set(key, list);
    }
    return map;
  }, [sortedJobsAll]);

  const deleteTargetJob = React.useMemo(
    () => (deletingJobId == null ? null : jobs.find(j => j.id === deletingJobId) ?? null),
    [deletingJobId, jobs]
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground bg-background">
        Loading plan...
      </div>
    );
  }

  const renderJobsList = (list: PlanJob[]) => (
    <div className="space-y-3">
      {list.map(job => (
        <JobCard
          key={job.id}
          job={job}
          allJobs={sortedJobsAll}
          isExpanded={expandedJobs.has(job.id)}
          draft={jobDrafts[job.id]}
          saveStatus={jobSaveStatus[job.id] ?? 'idle'}
          isSavingDep={savingDepsIds.has(job.id)}
          viewOnly={!!viewOnly}
          onToggle={() => toggleJob(job.id)}
          onChangeTitle={(v) => updateDraft(job.id, { title: v })}
          onChangeDescription={(v) => updateDraft(job.id, { description: v })}
          onChangeSpec={(v) => {
            const field: 'content' | 'test_plan_markdown' = job.implements_job_id !== null ? 'test_plan_markdown' : 'content';
            updateDraft(job.id, { [field]: v } as Pick<JobDraft, 'content' | 'test_plan_markdown'>);
          }}
          onFlushMeta={() => { void flushDraft(job.id, ['title', 'description']); }}
          onFlushSpec={() => {
            const field: 'content' | 'test_plan_markdown' = job.implements_job_id !== null ? 'test_plan_markdown' : 'content';
            void flushDraft(job.id, [field]);
          }}
          onRequestDelete={() => requestDelete(job.id)}
          onOpenPicker={() => setPickerForJobId(job.id)}
          onClearDep={() => saveDep(job.id, null)}
        />
      ))}
    </div>
  );

  return (
    <div className="flex flex-col h-full bg-background text-foreground min-w-0">
      {/* Header Controls */}
      <div className="flex items-center justify-between gap-4 p-4 border-b border-border bg-card/50 flex-wrap">
        <div className="flex items-center gap-4 flex-wrap min-w-0">
          <div className="flex items-center gap-3 text-xs text-muted-foreground bg-muted/40 px-3 py-1.5 rounded-lg border border-border flex-wrap break-words">
            <Settings className="h-3.5 w-3.5" />
            {buildCmd && (
              <span>
                Build: <code className="bg-muted px-1 py-0.5 rounded font-mono text-[11px] break-all">{buildCmd}</code>
              </span>
            )}
            {testCmd && (
              <span>
                Test: <code className="bg-muted px-1 py-0.5 rounded font-mono text-[11px] break-all">{testCmd}</code>
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <Button variant="outline" size="sm" className="hover:bg-destructive/10 hover:text-destructive border-border" onClick={handleRegeneratePlan}>
            Regenerate
          </Button>
          {!viewOnly && (
            <Button variant="outline" size="sm" onClick={handleGenerateTests} disabled={generatingTests}>
              {generatingTests ? 'Generating...' : 'Generate Tests'}
            </Button>
          )}
          <Button variant="default" size="sm" className="gap-2 bg-primary text-primary-foreground hover:bg-primary/95" onClick={handleCreateJobs} disabled={creatingJobs}>
            <Play className="h-3.5 w-3.5 fill-current" />
            {creatingJobs ? 'Creating...' : 'Create Jobs'}
          </Button>
        </div>
      </div>

      {/* Main List */}
      <div className="flex-1 min-w-0 overflow-y-auto p-6 space-y-4 w-full">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-bold tracking-tight">Functional Jobs</h2>
          <span className="text-sm text-muted-foreground">
            {blocks.length > 0 ? `${blocks.length} blocks, ` : ''}
            {jobs.length} jobs planned
          </span>
        </div>

        {blocks.length > 0 ? (
          <div className="space-y-6">
            {blocks.map(block => {
              const blockJobs = jobsByBlock.get(block.id) ?? [];
              return (
                <div key={block.id} className="space-y-3">
                  <div className="border-b border-border/80 pb-2">
                    <h3 className="text-base font-bold text-foreground/90 flex items-center gap-2">
                      <span className="bg-primary/10 text-primary px-2 py-0.5 rounded text-xs font-mono">Block {block.block_index}</span>
                      {block.title}
                    </h3>
                    <p className="text-xs text-muted-foreground mt-1">{block.description}</p>
                  </div>
                  {blockJobs.length > 0 ? (
                    renderJobsList(blockJobs)
                  ) : (
                    <p className="text-xs text-muted-foreground italic pl-2">No jobs planned in this block.</p>
                  )}
                </div>
              );
            })}

            {(jobsByBlock.get('__uncategorized__') ?? []).length > 0 && (
              <div className="space-y-3">
                <div className="border-b border-border/80 pb-2">
                  <h3 className="text-base font-bold text-foreground/90">Other / Uncategorized Jobs</h3>
                </div>
                {renderJobsList(jobsByBlock.get('__uncategorized__') ?? [])}
              </div>
            )}
          </div>
        ) : (
          renderJobsList(sortedJobsAll)
        )}
      </div>

      {isMobile ? (
        <React.Suspense fallback={null}>
          <MobileConfirmDialog
            open={showRegenConfirm}
            onOpenChange={setShowRegenConfirm}
            title="Regenerate plan"
            description="Are you sure you want to regenerate the plan from scratch? This will delete all discovered jobs and their specifications."
            confirmLabel="Regenerate"
            variant="destructive"
            onConfirm={confirmRegenerate}
          />
        </React.Suspense>
      ) : (
        <Dialog open={showRegenConfirm} onOpenChange={setShowRegenConfirm}>
          <DialogContent className="border border-border bg-card">
            <DialogHeader>
              <DialogTitle>Regenerate Plan</DialogTitle>
              <DialogDescription>
                Are you sure you want to regenerate the plan from scratch? This will delete all discovered jobs and their specifications.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter className="gap-2 sm:gap-0">
              <Button variant="ghost" className="border border-border" onClick={() => setShowRegenConfirm(false)}>
                Cancel
              </Button>
              <Button variant="destructive" onClick={confirmRegenerate}>
                Regenerate
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {deleteTargetJob && (
        isMobile ? (
          <React.Suspense fallback={null}>
            <MobileConfirmDialog
              open={deletingJobId !== null}
              onOpenChange={(open) => { if (!open) setDeletingJobId(null); }}
              title="Delete plan entry?"
              description={
                <span>
                  This will delete <strong>#{deleteTargetJob.job_index} — {deleteTargetJob.title}</strong> and rewire any entry that depends on it.
                </span>
              }
              confirmLabel="Delete"
              variant="destructive"
              loading={isDeleting}
              onConfirm={confirmDelete}
            />
          </React.Suspense>
        ) : (
          <Dialog open={deletingJobId !== null} onOpenChange={(open) => { if (!open) setDeletingJobId(null); }}>
            <DialogContent className="border border-border bg-card">
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <Trash2 className="h-5 w-5 text-destructive" aria-hidden="true" />
                  Delete plan entry?
                </DialogTitle>
                <DialogDescription>
                  This will delete <strong>#{deleteTargetJob.job_index} — {deleteTargetJob.title}</strong> and rewire any entry that depends on it. This action cannot be undone.
                </DialogDescription>
              </DialogHeader>
              <DialogFooter className="gap-2 sm:gap-0">
                <Button variant="ghost" className="border border-border" onClick={() => setDeletingJobId(null)} disabled={isDeleting}>
                  Cancel
                </Button>
                <Button variant="destructive" onClick={confirmDelete} disabled={isDeleting}>
                  {isDeleting ? 'Deleting…' : 'Delete'}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )
      )}

      {pickerForJobId != null && (
        <DependencyPickerDialog
          open={pickerForJobId !== null}
          onOpenChange={(open) => { if (!open) setPickerForJobId(null); }}
          allJobs={sortedJobsAll}
          currentJobId={pickerForJobId}
          onPick={(pickedId) => {
            const targetId = pickerForJobId;
            setPickerForJobId(null);
            if (targetId != null) saveDep(targetId, pickedId);
          }}
        />
      )}
    </div>
  );
}

function DependencyPickerDialog({
  open,
  onOpenChange,
  allJobs,
  currentJobId,
  onPick,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  allJobs: PlanJob[];
  currentJobId: number;
  onPick: (pickedId: number) => void;
}) {
  const blockedIds = React.useMemo(() => collectDescendants(allJobs, currentJobId), [allJobs, currentJobId]);
  const picks = React.useMemo(
    () =>
      allJobs
        .filter(j => j.id !== currentJobId && !blockedIds.has(j.id))
        .slice()
        .sort((a, b) => a.job_index - b.job_index),
    [allJobs, currentJobId, blockedIds]
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border border-border bg-card">
        <DialogHeader>
          <DialogTitle>Choose one dependency</DialogTitle>
          <DialogDescription>
            Pick one other entry that this plan entry depends on. Entries it depends on (directly or transitively) are hidden.
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-72 overflow-y-auto border border-border rounded-md divide-y divide-border bg-background">
          {picks.length === 0 ? (
            <p className="text-sm text-muted-foreground italic p-4">No candidates available.</p>
          ) : (
            picks.map(j => (
              <button
                key={j.id}
                type="button"
                className="w-full text-left px-3 py-2 hover:bg-muted/40 transition-colors flex items-center gap-2"
                onClick={() => onPick(j.id)}
              >
                <span className="bg-primary/10 text-primary px-2 py-0.5 rounded text-xs font-mono shrink-0">
                  #{j.job_index}
                </span>
                <span className="text-sm truncate">{j.title}</span>
              </button>
            ))
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" className="border border-border" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function JobCard({
  job,
  allJobs,
  isExpanded,
  draft,
  saveStatus,
  isSavingDep,
  viewOnly,
  onToggle,
  onChangeTitle,
  onChangeDescription,
  onChangeSpec,
  onFlushMeta,
  onFlushSpec,
  onRequestDelete,
  onOpenPicker,
  onClearDep,
}: {
  job: PlanJob;
  allJobs: PlanJob[];
  isExpanded: boolean;
  draft?: { title: string; description: string; content: string; test_plan_markdown: string; specField: 'content' | 'test_plan_markdown'; specPresent: boolean };
  saveStatus: 'idle' | 'saving' | 'error';
  isSavingDep: boolean;
  viewOnly: boolean;
  onToggle: () => void;
  onChangeTitle: (v: string) => void;
  onChangeDescription: (v: string) => void;
  onChangeSpec: (v: string) => void;
  onFlushMeta: () => void;
  onFlushSpec: () => void;
  onRequestDelete: () => void;
  onOpenPicker: () => void;
  onClearDep: () => void;
}) {
  const currentDepId = job.depends_on[0];
  const currentDep = currentDepId != null ? allJobs.find(j => j.id === currentDepId) : null;

  const titleValue = draft?.title ?? job.title;
  const descriptionValue = draft?.description ?? job.description;
  const isTestSpec = job.implements_job_id !== null;
  const serverSpecValue = isTestSpec ? (job.test_plan_markdown ?? '') : (job.content ?? '');
  const specField: 'content' | 'test_plan_markdown' = isTestSpec ? 'test_plan_markdown' : 'content';
  const draftSpecValue = draft ? draft[specField] : serverSpecValue;
  const specPresentFromDraft = draft ? draft.specPresent : (serverSpecValue !== '');
  const titleDirty = draft != null && draft.title !== job.title;
  const descriptionDirty = draft != null && draft.description !== job.description;
  const specDirty = draft != null && draft[specField] !== serverSpecValue;
  const isDirty = titleDirty || descriptionDirty || specDirty;
  const statusLabel = !isDirty
    ? null
    : saveStatus === 'saving'
      ? 'Saving…'
      : saveStatus === 'error'
        ? 'Save failed'
        : null;

  return (
    <div className="border border-border rounded-xl bg-card overflow-hidden shadow-sm hover:shadow-md transition-shadow min-w-0">
      <button
        className="w-full flex items-center justify-between gap-3 p-4 hover:bg-muted/30 transition-colors text-left min-w-0"
        onClick={onToggle}
        type="button"
      >
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <div className="flex items-center justify-center h-7 w-7 rounded-lg bg-primary/10 text-primary font-bold text-xs border border-primary/20 shrink-0">
            {job.job_index}
          </div>
          <div className="min-w-0">
            <h4 className="font-semibold text-sm leading-none mb-1.5 break-words">{job.title}</h4>
            <p className="text-xs text-muted-foreground line-clamp-1 break-words">{job.description}</p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-[10px] uppercase font-mono px-2 py-0.5 rounded-full bg-muted border border-border text-muted-foreground max-w-[10rem] truncate hidden sm:inline-block">
            {job.requirement_line_mapping}
          </span>
          {!viewOnly && (
            <span
              role="button"
              tabIndex={0}
              aria-label="Delete plan entry"
              onClick={(e) => { e.stopPropagation(); onRequestDelete(); }}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); onRequestDelete(); } }}
              className="inline-flex items-center justify-center h-8 w-8 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 cursor-pointer"
            >
              <Trash2 className="h-4 w-4" aria-hidden="true" />
            </span>
          )}
          <ChevronRight className={`h-4 w-4 text-muted-foreground transition-transform duration-200 ${isExpanded ? 'rotate-90' : ''}`} />
        </div>
      </button>

      {isExpanded && (
        <div className="border-t border-border bg-muted/10 p-5 min-w-0 space-y-5">
          {!viewOnly && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <h5 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  Title &amp; description
                </h5>
                {statusLabel && (titleDirty || descriptionDirty) && (
                  <span
                    className={`text-xs ${saveStatus === 'error' ? 'text-destructive' : 'text-muted-foreground'}`}
                    aria-live="polite"
                  >
                    {statusLabel}
                  </span>
                )}
              </div>
              <div className="space-y-2">
                <Input
                  value={titleValue}
                  onChange={(e) => onChangeTitle(e.target.value)}
                  onBlur={onFlushMeta}
                  className="h-9"
                  aria-label="Title"
                  placeholder="Plan entry title"
                />
                <Textarea
                  value={descriptionValue}
                  onChange={(e) => onChangeDescription(e.target.value)}
                  onBlur={onFlushMeta}
                  rows={3}
                  className="text-sm"
                  aria-label="Description"
                  placeholder="Short description"
                />
              </div>
            </div>
          )}

          <div>
            <div className="flex items-center justify-between mb-2">
              <h5 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                {job.implements_job_id !== null ? 'Test Specifications' : 'Specifications'}
              </h5>
              {statusLabel && specDirty && !viewOnly && (
                <span
                  className={`text-xs ${saveStatus === 'error' ? 'text-destructive' : 'text-muted-foreground'}`}
                  aria-live="polite"
                >
                  {statusLabel}
                </span>
              )}
            </div>
            {!viewOnly ? (
              specPresentFromDraft || draftSpecValue !== '' ? (
                <Textarea
                  value={draftSpecValue}
                  onChange={(e) => onChangeSpec(e.target.value)}
                  onBlur={onFlushSpec}
                  rows={10}
                  className="text-sm font-mono leading-relaxed bg-background min-h-[12rem] whitespace-pre-wrap break-words [overflow-wrap:anywhere]"
                  aria-label={isTestSpec ? 'Test specification' : 'Specification'}
                  placeholder={isTestSpec ? 'Test specification (markdown)…' : 'Specification (markdown)…'}
                />
              ) : (
                <div className="flex items-center gap-2 text-sm text-muted-foreground italic border border-dashed border-border rounded-md px-3 py-2">
                  <AlertCircle className="h-4 w-4 animate-pulse" />
                  Generating specifications...
                </div>
              )
            ) : (job.content || (job.implements_job_id !== null && job.test_plan_markdown)) ? (
              <div className="prose prose-sm dark:prose-invert max-w-none min-w-0">
                <pre className="whitespace-pre-wrap break-words [overflow-wrap:anywhere] font-sans text-sm text-foreground bg-muted/40 p-4 rounded-lg border border-border leading-relaxed">
                  {job.content || job.test_plan_markdown}
                </pre>
              </div>
            ) : (
              <div className="flex items-center gap-2 text-sm text-muted-foreground italic">
                <AlertCircle className="h-4 w-4 animate-pulse" />
                Generating specifications...
              </div>
            )}
          </div>

          {!viewOnly && (
            <div>
              <h5 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                Depends on
              </h5>
              {currentDep ? (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="inline-flex items-center gap-1.5 text-sm bg-muted border border-border rounded-full pl-1 pr-1 py-0.5">
                    <span className="bg-primary/10 text-primary px-2 py-0.5 rounded-full text-[10px] font-mono">
                      #{currentDep.job_index}
                    </span>
                    <span className="max-w-[16rem] truncate">{currentDep.title}</span>
                    <span
                      role="button"
                      tabIndex={0}
                      aria-label="Remove dependency"
                      onClick={onClearDep}
                      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClearDep(); } }}
                      className="inline-flex items-center justify-center h-6 w-6 rounded-full text-muted-foreground hover:text-destructive hover:bg-destructive/10 cursor-pointer"
                      title={isSavingDep ? 'Saving…' : 'Remove'}
                    >
                      <XIcon className="h-3.5 w-3.5" aria-hidden="true" />
                    </span>
                  </span>
                </div>
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1"
                  onClick={onOpenPicker}
                  disabled={isSavingDep}
                >
                  <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                  Add dependency
                </Button>
              )}
              {isSavingDep && currentDep == null && (
                <span className="text-xs text-muted-foreground ml-2">Saving…</span>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
