import * as React from 'react';
import { Eye, EyeOff, CheckCircle2, ChevronRight, Copy, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Switch } from '@/components/ui/switch';
import { ModelSelect } from '@/components/ui/model-select';
import { cn } from '@/lib/utils';
import type { ProjectFormData, Project } from '@/lib/types';
import type { Model } from '@/lib/db';

const DEFAULTS: ProjectFormData = {
  name: '',
  password: '',
  port: 3001,
  repo_host: 'github',
  repo_url: '',
  repo_pat: '',
  docker_image: 'openvelo-agent:linux',
  backend: 'opencode',
  default_model: '',
  execution_model: '',
  analyzer_model: '',
  chat_model: '',
  requirement_model: '',
  planning_model: '',
  build_cmd: '',
  test_cmd: '',
  staging_branch: 'staging',
  poll_interval: 60000,
  agent_max_timeout: 1800000,
  max_parallel_jobs: 1,
  max_retries: 3,
  agent_max_retries: 3,
  remove_deleted_containers: true,
};

const TABS = ['general', 'models', 'repo', 'execution'] as const;
type TabType = typeof TABS[number];

function toFormData(project: Project): ProjectFormData {
  return {
    name: project.name,
    password: '',
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
}

interface ProjectFormProps {
  initial?: Project;
  suggestedPort?: number;
  onSubmit: (data: ProjectFormData) => Promise<void>;
  onCancel: () => void;
  isSubmitting?: boolean;
  activeTabOverride?: string;
  focusFieldOverride?: string | null;
  models: Model[];
}

interface FieldProps {
  label: string;
  id: string;
  type?: string;
  value: string | number;
  onChange: (v: string) => void;
  placeholder?: string;
  required?: boolean;
  copyable?: boolean;
}

function Field({ label, id, type = 'text', value, onChange, placeholder, required, copyable }: FieldProps) {
  const [show, setShow] = React.useState(false);
  const [copied, setCopied] = React.useState(false);
  const isPassword = type === 'password';
  const inputType = isPassword ? (show ? 'text' : 'password') : type;

  const handleCopy = async () => {
    if (typeof value === 'string' && value) {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}{required && <span className="text-red-400 ml-1">*</span>}</Label>
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Input
            id={id}
            type={inputType}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={placeholder}
            required={required}
            className={cn(isPassword && "pr-9 font-mono")}
          />
          {isPassword && (
            <button
              type="button"
              onClick={() => setShow(!show)}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              tabIndex={-1}
            >
              {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          )}
        </div>
        {copyable && value && (
          <button
            type="button"
            onClick={handleCopy}
            className="text-muted-foreground hover:text-foreground shrink-0"
            tabIndex={-1}
          >
            {copied ? <Check className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
          </button>
        )}
      </div>
    </div>
  );
}

export function ProjectForm({ initial, suggestedPort, onSubmit, onCancel, isSubmitting, activeTabOverride, focusFieldOverride, models }: ProjectFormProps) {
  const [form, setForm] = React.useState<ProjectFormData>(
    initial ? toFormData(initial) : { ...DEFAULTS, port: suggestedPort ?? DEFAULTS.port }
  );
  const [activeTab, setActiveTab] = React.useState<string>('general');
  const [confirmedTabs, setConfirmedTabs] = React.useState<Set<TabType>>(new Set());

  React.useEffect(() => {
    if (activeTabOverride) {
      setActiveTab(activeTabOverride);
    }
  }, [activeTabOverride]);

  React.useEffect(() => {
    if (!initial && suggestedPort !== undefined) {
      setForm((prev) => ({ ...prev, port: suggestedPort }));
    }
  }, [suggestedPort, initial]);

  React.useEffect(() => {
    if (initial) {
      setForm(toFormData(initial));
    }
  }, [initial]);

  React.useEffect(() => {
    if (focusFieldOverride) {
      const input = document.getElementById(focusFieldOverride);
      if (input) {
        setTimeout(() => input.focus(), 100);
      }
    }
  }, [focusFieldOverride]);

  function set(key: keyof ProjectFormData) {
    return (value: string) => {
      setForm((prev) => ({ ...prev, [key]: value }));
    };
  }

  function setNum(key: keyof ProjectFormData) {
    return (value: string) => {
      setForm((prev) => ({ ...prev, [key]: parseInt(value) || 0 }));
    };
  }

  function setBool(key: keyof ProjectFormData) {
    return (value: boolean) => {
      setForm((prev) => ({ ...prev, [key]: value }));
    };
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    await onSubmit(form);
  }

  const isTabValid = (tab: TabType): boolean => {
    switch (tab) {
      case 'general':
        return !!form.name && !!form.port;
      case 'repo':
        return !!form.repo_url;
      case 'models':
        return !!form.default_model;
      default:
        return true;
    }
  };

  const handleNext = () => {
    const currentTab = activeTab as TabType;
    if (isTabValid(currentTab)) {
      setConfirmedTabs((prev) => new Set(prev).add(currentTab));
      const currentIndex = TABS.indexOf(currentTab);
      if (currentIndex < TABS.length - 1) {
        setActiveTab(TABS[currentIndex + 1]);
      }
    }
  };

  const tabClass = "flex items-center justify-start px-4 py-2 text-sm font-medium transition-colors hover:bg-muted/50 data-[state=active]:bg-muted data-[state=active]:text-foreground rounded-md w-full text-left relative";

  return (
    <form onSubmit={handleSubmit} className="flex flex-col h-full max-h-[80vh]">
      <div className="flex flex-1 overflow-hidden">
        <Tabs value={activeTab} onValueChange={setActiveTab} orientation="vertical" className="flex w-full overflow-hidden">
          {/* Sidebar */}
          <div className="w-[180px] border-r border-border pr-2 py-1 flex flex-col gap-1 shrink-0">
            <TabsList className="flex flex-col h-auto bg-transparent p-0 gap-1">
              {TABS.map((tab) => (
                <TabsTrigger key={tab} value={tab} className={tabClass}>
                  {confirmedTabs.has(tab) && isTabValid(tab) && (
                    <CheckCircle2 className="h-3.5 w-3.5 text-green-500 mr-2 shrink-0" />
                  )}
                  <span className="capitalize">{tab === 'repo' ? 'Repository' : tab === 'execution' ? 'Build & Exec' : tab === 'models' ? 'Models' : tab}</span>
                </TabsTrigger>
              ))}
            </TabsList>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-hidden relative">
            <ScrollArea className="h-full px-6">
              <div className="py-2 space-y-6">
                <TabsContent value="general" className="mt-0 space-y-4">
                  <div className="space-y-4">
                    <Field label="Name" id="name" value={form.name} onChange={set('name')} required />
                    <Field label="Port" id="port" type="number" value={form.port} onChange={setNum('port')} required />
                  </div>
                  {!initial && (
                    <div className="pt-4 flex justify-end">
                      <Button type="button" onClick={handleNext} className="gap-2" disabled={!isTabValid(activeTab as TabType)}>
                        Next <ChevronRight className="h-4 w-4" />
                      </Button>
                    </div>
                  )}
                </TabsContent>

                <TabsContent value="repo" className="mt-0 space-y-4">
                  <div className="space-y-4">
                    <div className="space-y-1.5">
                      <Label htmlFor="repo_host">Repo Host</Label>
                      <Select value={form.repo_host} onValueChange={set('repo_host')}>
                        <SelectTrigger id="repo_host"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="azure-devops">Azure DevOps</SelectItem>
                          <SelectItem value="github">GitHub</SelectItem>
                          <SelectItem value="gitea">Gitea</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <Field label="Repo URL" id="repo_url" value={form.repo_url} onChange={set('repo_url')}
                      placeholder="https://github.com/USER/REPO.git" required />
                    <Field label="Repo Token" id="repo_pat" type="password" value={form.repo_pat} onChange={set('repo_pat')}
                      placeholder={initial ? '(unchanged)' : 'Personal Access Token'} />
                    <Field label="Repo Working Branch" id="staging_branch" value={form.staging_branch}
                      onChange={set('staging_branch')} placeholder="staging" />
                  </div>
                  {!initial && (
                    <div className="pt-4 flex justify-end">
                      <Button type="button" onClick={handleNext} className="gap-2" disabled={!isTabValid(activeTab as TabType)}>
                        Next <ChevronRight className="h-4 w-4" />
                      </Button>
                    </div>
                  )}
                </TabsContent>

                <TabsContent value="execution" className="mt-0 space-y-4">
                  <div className="space-y-4">
                    <Field label="Docker Image" id="docker_image" value={form.docker_image} onChange={set('docker_image')}
                      placeholder="openvelo-agent:linux" />
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <Field label="Build CMD" id="build_cmd" value={form.build_cmd} onChange={set('build_cmd')}
                        placeholder="make build" />
                      <Field label="Test CMD" id="test_cmd" value={form.test_cmd} onChange={set('test_cmd')}
                        placeholder="make test" />
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <Field label="Max Parallel Jobs" id="max_parallel_jobs" type="number" value={form.max_parallel_jobs}
                        onChange={setNum('max_parallel_jobs')} />
                      <Field label="Container Retries" id="max_retries" type="number" value={form.max_retries}
                        onChange={setNum('max_retries')} />
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <Field label="Agent Build Retries" id="agent_max_retries" type="number" value={form.agent_max_retries}
                        onChange={setNum('agent_max_retries')} />
                      <Field label="Agent Inactivity Timeout (ms)" id="agent_max_timeout" type="number" value={form.agent_max_timeout}
                        onChange={setNum('agent_max_timeout')} />
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <Field label="Poll Interval (ms)" id="poll_interval" type="number" value={form.poll_interval}
                        onChange={setNum('poll_interval')} />
                      
                      <div className="space-y-2">
                        <Label htmlFor="remove_deleted_containers">Remove deleted containers</Label>
                        <div className="flex items-center space-x-2 pt-1">
                          <Switch
                            id="remove_deleted_containers"
                            checked={form.remove_deleted_containers}
                            onCheckedChange={setBool('remove_deleted_containers')}
                          />
                          <span className="text-sm text-muted-foreground">
                            {form.remove_deleted_containers ? 'Delete containers after stop/success' : 'Keep all containers'}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                  {!initial && (
                    <div className="pt-4 flex justify-end">
                      <Button type="button" onClick={handleNext} className="gap-2" disabled={!isTabValid(activeTab as TabType)}>
                        Next <ChevronRight className="h-4 w-4" />
                      </Button>
                    </div>
                  )}
                </TabsContent>

                <TabsContent value="models" className="mt-0 space-y-4">
                  <div className="space-y-4">
                    <ModelSelect
                      label="Default Model *"
                      id="default_model"
                      value={form.default_model}
                      onChange={set('default_model')}
                      models={models}
                      required
                    />
                    <ModelSelect
                      label="Execution Model"
                      id="execution_model"
                      value={form.execution_model}
                      onChange={set('execution_model')}
                      models={models}
                      includeDefaultOption
                    />
                    <ModelSelect
                      label="Analyzer Model"
                      id="analyzer_model"
                      value={form.analyzer_model}
                      onChange={set('analyzer_model')}
                      models={models}
                      includeDefaultOption
                    />
                    <ModelSelect
                      label="Chat Model"
                      id="chat_model"
                      value={form.chat_model}
                      onChange={set('chat_model')}
                      models={models}
                      includeDefaultOption
                    />
                    <ModelSelect
                      label="Requirement Model"
                      id="requirement_model"
                      value={form.requirement_model}
                      onChange={set('requirement_model')}
                      models={models}
                      includeDefaultOption
                    />
                    <ModelSelect
                      label="Planning Model"
                      id="planning_model"
                      value={form.planning_model}
                      onChange={set('planning_model')}
                      models={models}
                      includeDefaultOption
                    />
                  </div>
                  {!initial && (
                    <div className="pt-4 flex justify-end">
                      <Button type="button" onClick={handleNext} className="gap-2" disabled={!isTabValid(activeTab as TabType)}>
                        Next <ChevronRight className="h-4 w-4" />
                      </Button>
                    </div>
                  )}
                </TabsContent>

              </div>
            </ScrollArea>
          </div>
        </Tabs>
      </div>

      {/* Fixed Footer */}
      <div className="flex justify-end gap-2 pt-4 border-t border-border mt-4 shrink-0">
        <Button type="button" variant="outline" onClick={onCancel}>Cancel</Button>
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? 'Saving...' : initial ? 'Save Changes' : 'Create Project'}
        </Button>
      </div>
    </form>
  );
}
