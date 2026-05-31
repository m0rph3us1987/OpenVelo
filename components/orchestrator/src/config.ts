import dotenv from 'dotenv';
import path from 'path';
import * as fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../.env.local') });

const rawTempData = process.env.OPENVELO_TEMP_DATA_PATH
    || path.resolve(process.cwd(), 'temp_data');

const rawHostPath = process.env.OPENVELO_TEMP_DATA_HOST_PATH || rawTempData;
const resolvedHostPath = (process.platform !== 'win32' && !path.isAbsolute(rawHostPath))
    ? path.resolve(rawHostPath)
    : rawHostPath;

let rawSkillsHostPath = process.env.OPENVELO_SKILLS_HOST_PATH;
if (!rawSkillsHostPath) {
    const cwdSkills = path.resolve(process.cwd(), 'data', 'SKILLS');
    const parentSkills = path.resolve(process.cwd(), '..', '..', 'data', 'SKILLS');
    if (fs.existsSync(cwdSkills)) {
        rawSkillsHostPath = cwdSkills;
    } else if (fs.existsSync(parentSkills)) {
        rawSkillsHostPath = parentSkills;
    } else {
        rawSkillsHostPath = cwdSkills;
    }
}
const resolvedSkillsHostPath = (process.platform !== 'win32' && !path.isAbsolute(rawSkillsHostPath))
    ? path.resolve(rawSkillsHostPath)
    : rawSkillsHostPath;

export interface ProjectConfig {
    id: number;
    port: number;
    repo_url: string;
    repo_host: string;
    repo_pat: string | null;
    docker_image: string;
    backend: string;
    execution_model: string | null;
    blueprint_model: string | null;
    review_model: string | null;
    documentation_model: string | null;
    build_cmd: string | null;
    test_cmd: string | null;
    staging_branch: string;
    poll_interval: number;
    agent_max_timeout: number;
    max_parallel_jobs: number;
    max_retries: number;
    agent_max_retries: number;
    remove_deleted_containers: boolean;
}

export const CONFIG = {
    // Container / networking
    CONTAINER_MODE: process.env.OPENVELO_CONTAINER_MODE === 'true',
    WEB_UI_URL: (process.env.WEB_UI_URL || 'ws://localhost:3000').replace(/\/$/, ''),
    TEMP_DATA_PATH: rawTempData,
    TEMP_DATA_HOST_PATH: resolvedHostPath,
    SKILLS_HOST_PATH: resolvedSkillsHostPath,

    // Repo
    REPO_URL: process.env.REPO_URL || '',
    REPO_HOST: process.env.REPO_HOST || 'github',
    REPO_PAT: process.env.REPO_PAT || '',

    // Backend
    BACKEND: process.env.BACKEND || 'opencode',
    BACKEND_MODEL: process.env.BACKEND_MODEL || '',
    BACKEND_BLUEPRINT_MODEL: '',
    BACKEND_REVIEW_MODEL: '',
    BACKEND_DOCUMENTATION_MODEL: '',

    // Docker / agents
    DOCKER_IMAGE: process.env.DOCKER_IMAGE || 'openvelo-agent:linux',
    AGENT_MAX_TIMEOUT: parseInt(process.env.AGENT_MAX_TIMEOUT || '1800000', 10),
    MAX_PARALLEL_JOBS: parseInt(process.env.MAX_PARALLEL_JOBS || '1', 10),
    MAX_RETRIES: parseInt(process.env.MAX_RETRIES || '3', 10),
    AGENT_MAX_RETRIES: parseInt(process.env.AGENT_MAX_RETRIES || '3', 10),
    POLL_INTERVAL: parseInt(process.env.POLL_INTERVAL || '60000', 10),

    // Build / test
    BUILD_CMD: process.env.BUILD_CMD ?? '',
    TEST_CMD: process.env.TEST_CMD ?? '',
    STAGING_BRANCH: process.env.STAGING_BRANCH || 'staging',
    REMOVE_DELETED_CONTAINERS: process.env.REMOVE_DELETED_CONTAINERS !== 'false', // Default to true

    // Project (applied at runtime from web-ui configure message)
    PROJECT_ID: null as number | null,
};

export function generateFinalRepoURL(repoUrl: string, repoPat: string): string {
    if (!repoPat || !repoUrl) return repoUrl;
    try {
        const url = new URL(repoUrl);
        url.username = repoPat;
        url.password = '';
        return url.toString();
    } catch {
        return repoUrl;
    }
}

export function applyProjectConfig(project: ProjectConfig): void {
    CONFIG.REPO_URL = generateFinalRepoURL(project.repo_url, project.repo_pat ?? '');
    CONFIG.REPO_HOST = project.repo_host || 'github';
    CONFIG.REPO_PAT = project.repo_pat ?? '';
    CONFIG.BACKEND = project.backend;
    CONFIG.BACKEND_MODEL = project.execution_model ?? '';
    CONFIG.BACKEND_BLUEPRINT_MODEL = project.blueprint_model ?? '';
    CONFIG.BACKEND_REVIEW_MODEL = project.review_model ?? '';
    CONFIG.BACKEND_DOCUMENTATION_MODEL = project.documentation_model ?? '';
    CONFIG.DOCKER_IMAGE = project.docker_image;
    CONFIG.BUILD_CMD = project.build_cmd ?? '';
    CONFIG.TEST_CMD = project.test_cmd ?? '';
    CONFIG.STAGING_BRANCH = project.staging_branch;
    CONFIG.POLL_INTERVAL = project.poll_interval;
    CONFIG.AGENT_MAX_TIMEOUT = project.agent_max_timeout;
    CONFIG.MAX_PARALLEL_JOBS = project.max_parallel_jobs;
    CONFIG.MAX_RETRIES = project.max_retries ?? 3;
    CONFIG.AGENT_MAX_RETRIES = project.agent_max_retries ?? 3;
    CONFIG.REMOVE_DELETED_CONTAINERS = project.remove_deleted_containers ?? true;
    CONFIG.PROJECT_ID = project.id;
}
