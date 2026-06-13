import * as React from 'react';
import { Loader2, CheckCircle2, XCircle, Clock } from 'lucide-react';

interface Task {
  id: number;
  section_index?: number;
  job_index?: number;
  title: string;
  scope?: string;
  description?: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  logs: string;
}

interface ParallelLogViewerProps {
  chatId: number;
  type: 'requirement' | 'plan';
}

export function ParallelLogViewer({ chatId, type }: ParallelLogViewerProps) {
  const [tasks, setTasks] = React.useState<Task[]>([]);
  const [selectedTaskId, setSelectedTaskId] = React.useState<number | null>(null);
  const [loading, setLoading] = React.useState(true);
  
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);
  const userScrolledAwayRef = React.useRef(false);

  const fetchUrl = type === 'requirement' 
    ? `/api/chats/${chatId}/requirement/outlines`
    : `/api/plan/jobs?chatId=${chatId}`;

  const fetchTasks = React.useCallback(async () => {
    try {
      const res = await fetch(fetchUrl);
      if (res.ok) {
        const data = (await res.json()) as Task[];
        // Sort by index
        const sorted = data.sort((a, b) => {
          const idxA = a.section_index ?? a.job_index ?? 0;
          const idxB = b.section_index ?? b.job_index ?? 0;
          return idxA - idxB;
        });
        setTasks(sorted);
      }
    } catch (err) {
      console.error('Failed to fetch tasks:', err);
    } finally {
      setLoading(false);
    }
  }, [fetchUrl]);

  // Initial load
  React.useEffect(() => {
    fetchTasks();
  }, [fetchTasks]);

  // Polling while any task is running or pending
  React.useEffect(() => {
    const hasActiveTasks = tasks.some(t => t.status === 'running' || t.status === 'pending');
    if (!hasActiveTasks) return;

    const timer = setInterval(() => {
      fetchTasks();
    }, 1500);

    return () => clearInterval(timer);
  }, [tasks, fetchTasks]);

  // Auto-select active task
  React.useEffect(() => {
    if (tasks.length === 0) return;
    if (selectedTaskId !== null && tasks.some(t => t.id === selectedTaskId)) return;

    // Try selecting the first running task
    const running = tasks.find(t => t.status === 'running');
    if (running) {
      setSelectedTaskId(running.id);
      return;
    }

    // Fallback to first task
    setSelectedTaskId(tasks[0].id);
  }, [tasks, selectedTaskId]);

  const selectedTask = tasks.find(t => t.id === selectedTaskId);

  // Auto-scroll log viewport
  React.useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    if (!userScrolledAwayRef.current) {
      textarea.scrollTop = textarea.scrollHeight;
    }
  }, [selectedTask?.logs]);

  React.useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    const handleScroll = () => {
      const maxScroll = textarea.scrollHeight - textarea.clientHeight;
      if (maxScroll <= 0) return;
      const threshold = Math.min(50, maxScroll);
      const atBottom = textarea.scrollTop >= maxScroll - threshold;
      userScrolledAwayRef.current = !atBottom;
    };

    textarea.addEventListener('scroll', handleScroll);
    return () => textarea.removeEventListener('scroll', handleScroll);
  }, [selectedTaskId]);

  if (loading && tasks.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-2 text-muted-foreground">
        <Loader2 className="h-8 w-8 animate-spin" />
        <span>Loading tasks...</span>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-[300px_1fr] h-full overflow-hidden bg-background">
      {/* Left panel: Task list */}
      <div className="border-r border-border overflow-y-auto flex flex-col bg-card">
        <div className="p-4 border-b border-border font-semibold text-sm text-foreground uppercase tracking-wider">
          Planning Tasks
        </div>
        <div className="flex-1 divide-y divide-border">
          {tasks.map((task) => {
            const index = task.section_index ?? task.job_index ?? 0;
            const isSelected = task.id === selectedTaskId;
            
            return (
              <button
                key={task.id}
                onClick={() => setSelectedTaskId(task.id)}
                className={`w-full text-left p-4 flex flex-col gap-1 transition-colors hover:bg-accent/50 ${
                  isSelected ? 'bg-accent border-l-4 border-primary' : 'border-l-4 border-transparent'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="font-medium text-sm text-foreground line-clamp-1">
                    {index}. {task.title}
                  </span>
                  <StatusIcon status={task.status} />
                </div>
                <span className="text-xs text-muted-foreground line-clamp-2">
                  {task.scope ?? task.description ?? 'No details available'}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Right panel: Log viewer */}
      <div className="flex flex-col h-full overflow-hidden bg-background">
        {selectedTask ? (
          <>
            <div className="p-4 border-b border-border flex items-center justify-between">
              <div className="flex flex-col">
                <span className="font-semibold text-foreground text-sm">
                  {(selectedTask.section_index ?? selectedTask.job_index ?? 0)}. {selectedTask.title}
                </span>
                <span className="text-xs text-muted-foreground capitalize">
                  Status: {selectedTask.status}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <StatusIcon status={selectedTask.status} />
                <span className="text-xs font-mono text-muted-foreground uppercase">
                  Session Logs
                </span>
              </div>
            </div>
            <div className="flex-1 p-4 overflow-hidden relative">
              <textarea
                ref={textareaRef}
                value={selectedTask.logs || 'No logs available for this task yet.'}
                readOnly
                className="w-full h-full bg-black/10 dark:bg-black/40 border border-border rounded-lg p-4 font-mono text-sm text-primary resize-none focus:outline-none focus:ring-0 overflow-y-auto"
                placeholder="Logs will appear here once the sub-agent starts..."
              />
            </div>
          </>
        ) : (
          <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
            Select a task on the left to view its logs
          </div>
        )}
      </div>
    </div>
  );
}

function StatusIcon({ status }: { status: Task['status'] }) {
  switch (status) {
    case 'completed':
      return <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />;
    case 'failed':
      return <XCircle className="h-4 w-4 text-rose-500 shrink-0" />;
    case 'running':
      return <Loader2 className="h-4 w-4 text-blue-500 animate-spin shrink-0" />;
    case 'pending':
    default:
      return <Clock className="h-4 w-4 text-muted-foreground shrink-0" />;
  }
}
