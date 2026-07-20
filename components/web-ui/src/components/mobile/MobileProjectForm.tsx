import * as React from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { ModelSelect } from '@/components/ui/model-select';
import { cn } from '@/lib/utils';
import type { ProjectFormData, Project } from '@/lib/types';
import type { Model } from '@/lib/db';

export const MOBILE_DEFAULTS: ProjectFormData = {
  name: '',
  password: '',
  port: 3001,
  repo_host: 'github',
  repo_url: '',
  repo_pat: '',
  docker_image: 'openvelo-agent:linux',
  docker_image_tester: 'openvelo-tester:linux',
  backend: 'opencode',
  default_model: '',
  execution_model: '',
  analyzer_model: '',
  chat_model: '',
  requirement_model: '',
  planning_model: '',
  blueprint_model: '',
  review_model: '',
  documentation_model: '',
  build_cmd: '',
  test_cmd: '',
  staging_branch: 'staging',
  poll_interval: 60000,
  agent_max_timeout: 300,
  max_parallel_jobs: 1,
  max_retries: 3,
  agent_max_retries: 3,
  remove_deleted_containers: true,
};

export function mobileToFormData(project: Project): ProjectFormData {
  return {
    name: project.name,
    password: '',
    port: project.port,
    repo_host: project.repo_host || 'github',
    repo_url: project.repo_url,
    repo_pat: project.repo_pat || '',
    docker_image: project.docker_image,
    docker_image_tester: project.docker_image_tester,
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
}

interface MobileProjectFormProps {
  value: ProjectFormData;
  onChange: (next: ProjectFormData) => void;
  activeSection: string;
  focusFieldOverride?: string | null;
  models: Model[];
  hasInitial: boolean;
}

interface FieldProps {
  label: string;
  id: string;
  type?: string;
  value: string | number;
  onChange: (v: string) => void;
  placeholder?: string;
  required?: boolean;
}

function Field({ label, id, type = 'text', value, onChange, placeholder, required }: FieldProps) {
  const [show, setShow] = React.useState(false);
  const isPassword = type === 'password';
  const inputType = isPassword ? (show ? 'text' : 'password') : type;

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
            className={cn('tap-target w-full', isPassword && 'pr-9 font-mono')}
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
      </div>
    </div>
  );
}

export function MobileProjectForm({
  value,
  onChange,
  activeSection,
  focusFieldOverride,
  models,
  hasInitial,
}: MobileProjectFormProps) {
  React.useEffect(() => {
    if (focusFieldOverride) {
      const input = document.getElementById(focusFieldOverride);
      if (input) {
        setTimeout(() => input.focus(), 100);
      }
    }
  }, [focusFieldOverride, activeSection]);

  function set(key: keyof ProjectFormData) {
    return (v: string) => {
      onChange({ ...value, [key]: v });
    };
  }

  function setNum(key: keyof ProjectFormData) {
    return (v: string) => {
      onChange({ ...value, [key]: parseInt(v) || 0 });
    };
  }

  function setBool(key: keyof ProjectFormData) {
    return (v: boolean) => {
      onChange({ ...value, [key]: v });
    };
  }

  switch (activeSection) {
    case 'general':
      return (
        <div className="space-y-4">
          <Field label="Name" id="name" value={value.name} onChange={set('name')} required />
          <Field label="Port" id="port" type="number" value={value.port} onChange={setNum('port')} required />
        </div>
      );
    case 'repo':
      return (
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="repo_host">Repo Host</Label>
            <Select value={value.repo_host} onValueChange={set('repo_host')}>
              <SelectTrigger id="repo_host" className="tap-target w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="azure-devops">Azure DevOps</SelectItem>
                <SelectItem value="github">GitHub</SelectItem>
                <SelectItem value="gitea">Gitea</SelectItem>
                <SelectItem value="bitbucket">Bitbucket</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Field
            label="Repo URL"
            id="repo_url"
            value={value.repo_url}
            onChange={set('repo_url')}
            placeholder="https://your-host.com/owner/repo.git"
            required
          />
          <Field
            label="Repo Token"
            id="repo_pat"
            type="password"
            value={value.repo_pat}
            onChange={set('repo_pat')}
            placeholder={hasInitial ? '(unchanged)' : 'Personal Access Token'}
          />
          <Field
            label="Repo Working Branch"
            id="staging_branch"
            value={value.staging_branch}
            onChange={set('staging_branch')}
            placeholder="staging"
          />
        </div>
      );
    case 'execution':
      return (
        <div className="space-y-4">
          <Field
            label="Docker Image Implementer"
            id="docker_image"
            value={value.docker_image}
            onChange={set('docker_image')}
            placeholder="openvelo-agent:linux"
          />
          <Field
            label="Docker Image Tester"
            id="docker_image_tester"
            value={value.docker_image_tester}
            onChange={set('docker_image_tester')}
            placeholder="openvelo-tester:linux"
          />
          <Field
            label="Build CMD"
            id="build_cmd"
            value={value.build_cmd}
            onChange={set('build_cmd')}
            placeholder="make build"
          />
          <Field
            label="Test CMD"
            id="test_cmd"
            value={value.test_cmd}
            onChange={set('test_cmd')}
            placeholder="make test"
          />
          <Field
            label="Max Parallel Jobs"
            id="max_parallel_jobs"
            type="number"
            value={value.max_parallel_jobs}
            onChange={setNum('max_parallel_jobs')}
          />
          <Field
            label="Container Retries"
            id="max_retries"
            type="number"
            value={value.max_retries}
            onChange={setNum('max_retries')}
          />
          <Field
            label="Agent Build Retries"
            id="agent_max_retries"
            type="number"
            value={value.agent_max_retries}
            onChange={setNum('agent_max_retries')}
          />
          <Field
            label="Agent Inactivity Timeout (seconds)"
            id="agent_max_timeout"
            type="number"
            value={value.agent_max_timeout}
            onChange={setNum('agent_max_timeout')}
          />
          <Field
            label="Poll Interval (ms)"
            id="poll_interval"
            type="number"
            value={value.poll_interval}
            onChange={setNum('poll_interval')}
          />
          <div className="space-y-2">
            <Label htmlFor="remove_deleted_containers">Remove deleted containers</Label>
            <div className="flex items-center space-x-2 pt-1">
              <Switch
                id="remove_deleted_containers"
                checked={value.remove_deleted_containers}
                onCheckedChange={setBool('remove_deleted_containers')}
              />
              <span className="text-sm text-muted-foreground">
                {value.remove_deleted_containers ? 'Delete containers after stop/success' : 'Keep all containers'}
              </span>
            </div>
          </div>
        </div>
      );
    case 'models':
      return (
        <div className="space-y-4">
          <ModelSelect
            label="Default Model *"
            id="default_model"
            value={value.default_model}
            onChange={set('default_model')}
            models={models}
            required
          />
          <h3 className="text-sm font-semibold">Agent Models</h3>
          <ModelSelect
            label="Blueprint Model"
            id="blueprint_model"
            value={value.blueprint_model}
            onChange={set('blueprint_model')}
            models={models}
            includeDefaultOption
          />
          <ModelSelect
            label="Coding Model"
            id="execution_model"
            value={value.execution_model}
            onChange={set('execution_model')}
            models={models}
            includeDefaultOption
          />
          <ModelSelect
            label="Review Model"
            id="review_model"
            value={value.review_model}
            onChange={set('review_model')}
            models={models}
            includeDefaultOption
          />
          <ModelSelect
            label="Documentation Model"
            id="documentation_model"
            value={value.documentation_model}
            onChange={set('documentation_model')}
            models={models}
            includeDefaultOption
          />
          <h3 className="text-sm font-semibold">Web-UI Models</h3>
          <ModelSelect
            label="Analyzer Model"
            id="analyzer_model"
            value={value.analyzer_model}
            onChange={set('analyzer_model')}
            models={models}
            includeDefaultOption
          />
          <ModelSelect
            label="Chat Model"
            id="chat_model"
            value={value.chat_model}
            onChange={set('chat_model')}
            models={models}
            includeDefaultOption
          />
          <ModelSelect
            label="Requirement Model"
            id="requirement_model"
            value={value.requirement_model}
            onChange={set('requirement_model')}
            models={models}
            includeDefaultOption
          />
          <ModelSelect
            label="Planning Model"
            id="planning_model"
            value={value.planning_model}
            onChange={set('planning_model')}
            models={models}
            includeDefaultOption
          />
        </div>
      );
    default:
      return null;
  }
}
