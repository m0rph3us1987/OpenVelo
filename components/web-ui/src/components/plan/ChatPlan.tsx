import * as React from 'react';
import type { ChatSession } from '@/lib/types';
import { useStageWebSocket } from '@/hooks/useStageWebSocket';
import { TextLog } from '@/components/ui/text-log';
import { ParallelLogViewer } from './ParallelLogViewer';
import { Button } from '@/components/ui/button';
import { Check, ChevronRight, AlertCircle, Play, Settings } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';

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
      'plan': 'Plan ready',
      'error': 'Error',
    };
    let subtitle = titleMap[subStage] ?? 'Plan';

    if (progress) {
      subtitle = progress;
    }

    let showSpinner = ['discovery', 'generation'].includes(subStage);
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
    const isGenerating = ['discovery', 'generation'].includes(subStage);
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
  build_cmd: string;
  test_cmd: string;
  block_id: number | null;
  block_sequence: number;
}

function PlanView({ chat, viewOnly }: { chat: ChatSession; viewOnly?: boolean }) {
  const [jobs, setJobs] = React.useState<PlanJob[]>([]);
  const [blocks, setBlocks] = React.useState<PlanBlock[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [buildCmd, setBuildCmd] = React.useState('');
  const [testCmd, setTestCmd] = React.useState('');
  const [saving, setSaving] = React.useState(false);
  const [saved, setSaved] = React.useState(false);
  const [expandedJobs, setExpandedJobs] = React.useState<Set<number>>(new Set());
  const [creatingJobs, setCreatingJobs] = React.useState(false);
  const [showRegenConfirm, setShowRegenConfirm] = React.useState(false);

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
        setJobs(jobsData);
        setBlocks(blocksData);
        // Expand first job by default
        if (jobsData.length > 0) {
          setExpandedJobs(new Set([jobsData[0].id]));
        }
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

  const handleSaveBuildTest = async () => {
    if (saving || saved) return;
    setSaving(true);
    try {
      await fetch(`/api/projects/${chat.project_id}/updateBuildTest`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ build_cmd: buildCmd, test_cmd: testCmd }),
      });
      setSaved(true);
    } catch (err) {
      console.error('Failed to update build/test:', err);
    } finally {
      setSaving(false);
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

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground bg-background">
        Loading plan...
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-background text-foreground">
      {/* Header Controls */}
      <div className="flex items-center justify-between p-4 border-b border-border bg-card/50">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-3 text-xs text-muted-foreground bg-muted/40 px-3 py-1.5 rounded-lg border border-border">
            <Settings className="h-3.5 w-3.5" />
            {buildCmd && (
              <span>
                Build: <code className="bg-muted px-1 py-0.5 rounded font-mono text-[11px]">{buildCmd}</code>
              </span>
            )}
            {testCmd && (
              <span>
                Test: <code className="bg-muted px-1 py-0.5 rounded font-mono text-[11px]">{testCmd}</code>
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Button variant="outline" size="sm" className="hover:bg-destructive/10 hover:text-destructive border-border" onClick={handleRegeneratePlan}>
            Regenerate
          </Button>
          <Button variant="default" size="sm" className="gap-2 bg-primary text-primary-foreground hover:bg-primary/95" onClick={handleCreateJobs} disabled={creatingJobs}>
            <Play className="h-3.5 w-3.5 fill-current" />
            {creatingJobs ? 'Creating...' : 'Create Jobs'}
          </Button>
        </div>
      </div>

      {/* Main List */}
      <div className="flex-1 overflow-auto p-6 space-y-4 max-w-4xl mx-auto w-full">
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
              const blockJobs = jobs.filter(j => j.block_id === block.id);
              return (
                <div key={block.id} className="space-y-3">
                  <div className="border-b border-border/80 pb-2">
                    <h3 className="text-base font-bold text-foreground/90 flex items-center gap-2">
                      <span className="bg-primary/10 text-primary px-2 py-0.5 rounded text-xs font-mono">Block {block.block_index}</span>
                      {block.title}
                    </h3>
                    <p className="text-xs text-muted-foreground mt-1">{block.description}</p>
                  </div>
                  <div className="space-y-3 pl-4 border-l border-border/40">
                    {blockJobs.map(job => (
                      <JobCard
                        key={job.id}
                        job={job}
                        isExpanded={expandedJobs.has(job.id)}
                        onToggle={() => toggleJob(job.id)}
                      />
                    ))}
                    {blockJobs.length === 0 && (
                      <p className="text-xs text-muted-foreground italic pl-2">No jobs planned in this block.</p>
                    )}
                  </div>
                </div>
              );
            })}
            
            {/* Render any jobs that do not belong to a block */}
            {jobs.some(j => !j.block_id) && (
              <div className="space-y-3">
                <div className="border-b border-border/80 pb-2">
                  <h3 className="text-base font-bold text-foreground/90">Other / Uncategorized Jobs</h3>
                </div>
                <div className="space-y-3 pl-4 border-l border-border/40">
                  {jobs.filter(j => !j.block_id).map(job => (
                    <JobCard
                      key={job.id}
                      job={job}
                      isExpanded={expandedJobs.has(job.id)}
                      onToggle={() => toggleJob(job.id)}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            {jobs.map(job => (
              <JobCard
                key={job.id}
                job={job}
                isExpanded={expandedJobs.has(job.id)}
                onToggle={() => toggleJob(job.id)}
              />
            ))}
          </div>
        )}
      </div>

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
    </div>
  );
}

function JobCard({
  job,
  isExpanded,
  onToggle
}: {
  job: PlanJob;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="border border-border rounded-xl bg-card overflow-hidden shadow-sm hover:shadow-md transition-shadow">
      <button
        className="w-full flex items-center justify-between p-4 hover:bg-muted/30 transition-colors text-left"
        onClick={onToggle}
      >
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center h-7 w-7 rounded-lg bg-primary/10 text-primary font-bold text-xs border border-primary/20">
            {job.job_index}
          </div>
          <div>
            <h4 className="font-semibold text-sm leading-none mb-1.5">{job.title}</h4>
            <p className="text-xs text-muted-foreground line-clamp-1">{job.description}</p>
          </div>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <span className="text-[10px] uppercase font-mono px-2 py-0.5 rounded-full bg-muted border border-border text-muted-foreground">
            {job.requirement_line_mapping}
          </span>
          <ChevronRight className={`h-4 w-4 text-muted-foreground transition-transform duration-200 ${isExpanded ? 'rotate-90' : ''}`} />
        </div>
      </button>

      {isExpanded && (
        <div className="border-t border-border bg-muted/10 p-5">
          <h5 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Specifications</h5>
          {job.content ? (
            <div className="prose prose-sm dark:prose-invert max-w-none">
              <pre className="whitespace-pre-wrap font-sans text-sm text-foreground bg-muted/40 p-4 rounded-lg border border-border leading-relaxed">
                {job.content}
              </pre>
            </div>
          ) : (
            <div className="flex items-center gap-2 text-sm text-muted-foreground italic">
              <AlertCircle className="h-4 w-4 animate-pulse" />
              Generating specifications...
            </div>
          )}
        </div>
      )}
    </div>
  );
}