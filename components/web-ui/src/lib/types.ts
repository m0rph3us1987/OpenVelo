export interface Project {
  id: number;
  name: string;
  password_hash: string | null;
  port: number;
  repo_host: string;
  repo_url: string;
  repo_pat: string | null;
  docker_image: string;
  backend: string;
  default_model: string;
  execution_model: string;
  blueprint_model: string;
  analyzer_model: string;
  chat_model: string;
  requirement_model: string;
  planning_model: string;
  review_model: string;
  documentation_model: string;
  build_cmd: string | null;
  test_cmd: string | null;
  staging_branch: string;
  poll_interval: number;
  agent_max_timeout: number;
  max_parallel_jobs: number;
  max_retries: number;
  agent_max_retries: number;
  remove_deleted_containers: number;
  status: 'stopped' | 'running' | 'paused';
  pid: number | null;
  created_at: string;
  updated_at: string;
}

export interface Job {
  id: number;
  project_id: number | null;
  depends_on: string | null;
  title: string;
  description: string | null;
  status: 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'STOPPED';
  feature_id: number | null;
  container_id: string | null;
  branch: string | null;
  retry_count: number;
  stage: string | null;
  agent_attempt: number | null;
  agent_max_retries: number | null;
  started_at: string | null;
  runtime: number;
  created_at: string;
  updated_at: string;
}

export interface WsLogMessage {
  type: 'log';
  jobId: number;
  logType: 'info' | 'error' | 'status' | 'warn';
  message: string;
}

export interface WsJobUpdateMessage {
  type: 'job_update';
  jobId: number;
  status: string;
  stage?: string;
  agentAttempt?: number;
  agentMaxRetries?: number;
  startDateTime?: string;
  attempt?: number;
  maxAttempts?: number;
  timestamp: string;
}

export type PlanEntryStatus = 'pending' | 'in_progress' | 'completed';
export type PlanEntryPriority = 'high' | 'medium' | 'low';

export interface JobStatusPlanEntry {
  content: string;
  status: PlanEntryStatus;
  priority: PlanEntryPriority;
}

export interface JobStatusUsage {
  used?: number;
  size?: number;
  totalTokens?: number;
  inputTokens?: number;
  outputTokens?: number;
  cachedReadTokens?: number;
  cachedWriteTokens?: number;
  cost?: { amount: number; currency: string };
}

export interface WsJobUsageUpdateMessage {
  type: 'job_usage_update';
  jobId: number;
  used?: number;
  size?: number;
  totalTokens?: number;
  inputTokens?: number;
  outputTokens?: number;
  cachedReadTokens?: number;
  cachedWriteTokens?: number;
  cost?: { amount: number; currency: string };
  timestamp: string;
}

export interface WsJobPlanUpdateMessage {
  type: 'job_plan_update';
  jobId: number;
  entries: JobStatusPlanEntry[];
  timestamp: string;
}

export interface JobStatus {
  jobId: number;
  startDateTime: string;
  stage: string;
  attempt: number;
  maxAttempts: number;
  agentAttempt?: number;
  agentMaxRetries?: number;
  usage?: JobStatusUsage;
  plan?: JobStatusPlanEntry[];
}

interface WsConnectedMessage {
  type: 'connected';
  timestamp: string;
}

export type WsMessage =
  | WsLogMessage
  | WsJobUpdateMessage
  | WsJobUsageUpdateMessage
  | WsJobPlanUpdateMessage
  | WsConnectedMessage;

export interface ProjectModels {
  default_model: string;
  execution_model: string;
  blueprint_model: string;
  analyzer_model: string;
  chat_model: string;
  requirement_model: string;
  planning_model: string;
  review_model: string;
  documentation_model: string;
}

export interface ProjectFormData {
  name: string;
  password: string;
  port: number;
  repo_host: string;
  repo_url: string;
  repo_pat: string;
  docker_image: string;
  backend: string;
  default_model: string;
  execution_model: string;
  analyzer_model: string;
  chat_model: string;
  requirement_model: string;
  planning_model: string;
  blueprint_model: string;
  review_model: string;
  documentation_model: string;
  build_cmd: string;
  test_cmd: string;
  staging_branch: string;
  poll_interval: number;
  agent_max_timeout: number;
  max_parallel_jobs: number;
  max_retries: number;
  agent_max_retries: number;
  remove_deleted_containers: boolean;
}

export interface ThemeColors {
  background: string;
  foreground: string;
  card: string;
  'card-foreground': string;
  popover: string;
  'popover-foreground': string;
  primary: string;
  'primary-foreground': string;
  secondary: string;
  'secondary-foreground': string;
  muted: string;
  'muted-foreground': string;
  accent: string;
  'accent-foreground': string;
  destructive: string;
  'destructive-foreground': string;
  border: string;
  input: string;
  ring: string;
  radius: string;
}

export interface ThemeDefinition {
  name: string;
  logo?: string;
  colors: ThemeColors;
}

export interface ThemeInfo {
  key: string;
  name: string;
}

export interface User {
  id: number;
  username: string;
  password_hash: string;
  role: 'admin' | 'user';
  enabled: boolean;
  password_reset_required: boolean;
  failed_attempts: number;
  last_failed_attempt: string | null;
  created_at: string;
  updated_at: string;
}

export interface Group {
  id: number;
  name: string;
  description: string | null;
  created_at: string;
  updated_at: string;
}

export interface GroupWithRelations extends Group {
  members: User[];
  projects: Project[];
}

export type ChatMode = 'plan' | 'quick' | 'verify';

export interface ChatSession {
  id: number;
  mode: ChatMode;
  project_id: string;
  name: string;
  stage: string;
  sub_stage: string;
  sub_stage_pre_error: string;
  error_type?: string | null;
  running?: number;
  created_at: string;
  updated_at: string;
}