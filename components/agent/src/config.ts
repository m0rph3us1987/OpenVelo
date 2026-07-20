import * as fs from 'fs';
import * as path from 'path';

const IS_WINDOWS = process.platform === 'win32';

// Execution runtime for the tool engine (kilo acp) and its child toolchain.
//   'linux' — kilo runs natively (default).
//   'wine'  — kilo runs under Wine using the Windows Node/npm environment. The
//             wrapper itself still runs on native Linux and operates on Linux
//             paths; only kilo-facing strings are converted to their Windows
//             (C:\...) form. The Wine image symlinks the work dirs into drive_c
//             (C:\repo == /repo, C:\SKILLS == /SKILLS, C:\data == /data,
//             C:\tmp == /tmp, C:\root == /root), so the two path views point at
//             the same files.
const AGENT_RUNTIME = (process.env.AGENT_RUNTIME || 'linux') as 'linux' | 'wine';

/**
 * Convert an absolute Linux path used by the wrapper into the path form the
 * `kilo acp` engine expects. In wine mode `/foo/bar` becomes `C:\foo\bar`
 * (drive_c mirrors `/`). In linux mode the path is returned unchanged.
 */
export function toAgentPath(linuxPath: string): string {
    if (AGENT_RUNTIME !== 'wine') return linuxPath;
    if (!linuxPath.startsWith('/')) return linuxPath;
    return 'C:' + linuxPath.replace(/\//g, '\\');
}

// Fields populated before the WebSocket handshake (from env or hardcoded defaults)
export const CONFIG = {
    AGENT_PORT: parseInt(process.env.AGENT_PORT || '3001', 10),
    JOB_ID: process.env.JOB_ID || '0',
    STORY_PATH: '/tmp/story.md',
    STORY_CONTENT: '',
    REPO_PATH: process.env.REPO_PATH || (IS_WINDOWS ? 'C:\\repo' : '/repo'),
    HOME_DIR: IS_WINDOWS ? (process.env.USERPROFILE || 'C:\\Users\\ContainerAdministrator') : '/root',
    MAX_RETRIES: parseInt(process.env.AGENT_MAX_RETRIES || process.env.MAX_RETRIES || '3', 10),
    AGENT_MAX_TIMEOUT: parseInt(process.env.AGENT_MAX_TIMEOUT || process.env.MAX_TIMEOUT || '300', 10),
    // Client-side per-turn inactivity timeout (seconds). If kilo acp produces
    // no session/update activity for this long while a turn is in flight, the
    // turn rejects locally with a clear error instead of hanging until the
    // orchestrator's AGENT_MAX_TIMEOUT fires. 0 disables the local timer.
    ACP_TURN_INACTIVITY_TIMEOUT: parseInt(process.env.ACP_TURN_INACTIVITY_TIMEOUT || '180', 10),
    AGENT_PLATFORM: (process.env.AGENT_PLATFORM || (IS_WINDOWS ? 'windows' : 'linux')) as 'linux' | 'windows',
    AGENT_RUNTIME,

    // Populated via handshake message from the Orchestrator
    REPO_URL: '',
    REPO_HOST: 'github',
    REPO_PAT: '',
    JOB_TITLE: '',
    BACKEND: '',
    BACKEND_MODEL: '',
    BACKEND_BLUEPRINT_MODEL: '',
    BACKEND_REVIEW_MODEL: '',
    BACKEND_DOCUMENTATION_MODEL: '',
    BUILD_CMD: '',
    TEST_CMD: '',
    STAGING_BRANCH: 'staging',
};

export interface HandshakeConfig {
    repo_url: string;
    repo_host?: string;
    repo_pat?: string;
    backend: string;
    execution_model?: string;
    blueprint_model?: string;
    review_model?: string;
    documentation_model?: string;
    build_cmd: string;
    test_cmd: string;
    staging_branch: string;
    job_title?: string;
    story?: string;
    agent_max_timeout?: number;
}

export function applyHandshake(data: HandshakeConfig): void {
    CONFIG.REPO_URL = data.repo_url;
    CONFIG.REPO_HOST = data.repo_host ?? 'github';
    CONFIG.REPO_PAT = data.repo_pat ?? '';
    CONFIG.BACKEND = data.backend;
    CONFIG.BACKEND_MODEL = data.execution_model ?? '';
    CONFIG.BACKEND_BLUEPRINT_MODEL = data.blueprint_model ?? '';
    CONFIG.BACKEND_REVIEW_MODEL = data.review_model ?? '';
    CONFIG.BACKEND_DOCUMENTATION_MODEL = data.documentation_model ?? '';
    CONFIG.BUILD_CMD = data.build_cmd;
    CONFIG.TEST_CMD = data.test_cmd;
    CONFIG.STAGING_BRANCH = data.staging_branch;
    CONFIG.JOB_TITLE = data.job_title ?? '';
    CONFIG.STORY_CONTENT = data.story ?? '';
    if (typeof data.agent_max_timeout === 'number' && data.agent_max_timeout > 0) {
        CONFIG.AGENT_MAX_TIMEOUT = data.agent_max_timeout;
    }

    if (data.story) {
        try {
            fs.writeFileSync(CONFIG.STORY_PATH, data.story, 'utf-8');
        } catch (err) {
            console.error(`Failed to write story to ${CONFIG.STORY_PATH}: ${err}`);
        }
    }
}
