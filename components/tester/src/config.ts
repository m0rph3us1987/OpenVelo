import * as fs from 'fs';

const IS_WINDOWS = process.platform === 'win32';

function parseBoolEnv(raw: string | undefined, fallback: boolean): boolean {
    if (raw === undefined || raw === '') return fallback;
    const v = raw.trim().toLowerCase();
    if (v === 'true') return true;
    if (v === 'false') return false;
    return fallback;
}

export function isDebugMode(): boolean {
    return parseBoolEnv(process.env.TESTER_DEBUG, false);
}

export const CONFIG = {
    TESTER_PORT: parseInt(process.env.TESTER_PORT || process.env.AGENT_PORT || '8081', 10),
    JOB_ID: process.env.JOB_ID || '0',
    REPO_PATH: process.env.REPO_PATH || (IS_WINDOWS ? 'C:\\repo' : '/repo'),
    HOME_DIR: IS_WINDOWS ? (process.env.USERPROFILE || 'C:\\Users\\ContainerAdministrator') : '/root',

    VERDICT_PATH: process.env.VERDICT_PATH || '/tmp/verdict.json',
    VERDICTS_DIR: process.env.VERDICTS_DIR || '/tmp/verdicts',

    MAX_RETRIES: parseInt(process.env.AGENT_MAX_RETRIES || process.env.MAX_RETRIES || '1', 10),
    AGENT_MAX_TIMEOUT: parseInt(process.env.AGENT_MAX_TIMEOUT || process.env.MAX_TIMEOUT || '300', 10),
    ACP_TURN_INACTIVITY_TIMEOUT: parseInt(process.env.ACP_TURN_INACTIVITY_TIMEOUT || '180', 10),
    AGENT_PLATFORM: (process.env.AGENT_PLATFORM || (IS_WINDOWS ? 'windows' : 'linux')) as 'linux' | 'windows',

    CONTROLLER_PORT: parseInt(process.env.CONTROLLER_PORT || '8080', 10),
    // MCP server transport — mcp.py is spawned by entrypoint.sh
    // in HTTP/SSE mode (so debug mode can drive it directly with curl /
    // wscat / MCP Inspector). kilo acp attaches to it via the remote
    // HTTP/SSE shape of `session/new mcpServers`. Set MCP_TRANSPORT=stdio
    // to fall back to per-session stdio spawning instead.
    MCP_TRANSPORT: (process.env.MCP_TRANSPORT || 'streamable-http') as 'stdio' | 'sse' | 'streamable-http',
    MCP_HOST: process.env.MCP_HOST || process.env.MCP_BIND || '127.0.0.1',
    MCP_PORT: parseInt(process.env.MCP_PORT || '8765', 10),
    DISPLAY: process.env.DISPLAY || ':99',
    SCREEN_W: parseInt(process.env.SCREEN_W || '1280', 10),
    SCREEN_H: parseInt(process.env.SCREEN_H || '1024', 10),
    PORT_VNC: parseInt(process.env.PORT_VNC || '5900', 10),
    VNC_VIEW_ONLY: isDebugMode() ? false : parseBoolEnv(process.env.VNC_VIEW_ONLY, true),

    // Populated via handshake message from the Orchestrator (TesterHandshakeConfig)
    REPO_URL: '',
    REPO_HOST: 'github',
    REPO_PAT: '',
    REPO_BRANCH: '',
    BACKEND: '',
    BACKEND_MODEL: '',
    BUILD_CMD: '',
    TEST_CMD: '',
    TEST_PLAN: '',
    JOB_TITLE: '',
    STORY_CONTENT: '',
    PASSED_TESTS: '',
};

export interface TesterHandshakeConfig {
    repo_url: string;
    repo_host?: string;
    repo_pat?: string;
    repo_branch?: string;
    backend: string;
    execution_model?: string;
    build_cmd: string;
    test_cmd: string;
    test_plan: string;
    job_title?: string;
    story?: string;
    agent_max_timeout?: number;
    passed_tests?: string;
}

export function applyHandshake(data: TesterHandshakeConfig): void {
    CONFIG.REPO_URL = data.repo_url ?? '';
    CONFIG.REPO_HOST = data.repo_host ?? 'github';
    CONFIG.REPO_PAT = data.repo_pat ?? '';
    CONFIG.REPO_BRANCH = data.repo_branch ?? '';
    CONFIG.BACKEND = data.backend;
    CONFIG.BACKEND_MODEL = data.execution_model ?? '';
    CONFIG.BUILD_CMD = data.build_cmd ?? '';
    CONFIG.TEST_CMD = data.test_cmd ?? '';
    CONFIG.TEST_PLAN = data.test_plan ?? '';
    CONFIG.JOB_TITLE = data.job_title ?? '';
    CONFIG.STORY_CONTENT = data.story ?? '';
    CONFIG.PASSED_TESTS = data.passed_tests ?? '';
    if (typeof data.agent_max_timeout === 'number' && data.agent_max_timeout > 0) {
        CONFIG.AGENT_MAX_TIMEOUT = data.agent_max_timeout;
    }
}

// Populate the handshake-style CONFIG fields from process.env. Used in
// TESTER_DEBUG mode where the orchestrator WS handshake is not sent and
// every field has to come from the container's environment.
//
// Two equivalent naming conventions are accepted, in priority order:
//   1. DEBUG_* aliases (DEBUG_REPO_URL, DEBUG_BACKEND, DEBUG_EXECUTION_MODEL,
//      DEBUG_TEST_PLAN, …) — preferred for debug-mode docker-compose .env
//      files because they make it obvious which env vars only matter when
//      running standalone.
//   2. The legacy snake_case names (REPO_URL, BACKEND, EXECUTION_MODEL, …)
//      — kept for backwards compatibility with existing scripts.
//
// Env names mirror the handshake payload's snake_case keys.
export function applyEnvConfig(): void {
    const env = process.env;
    const pick = (legacyName: string, debugName: string): string | undefined => {
        return env[debugName] ?? env[legacyName];
    };
    // docker compose .env files don't support real multi-line values;
    // multi-line fields like DEBUG_TEST_PLAN / DEBUG_STORY encode newlines
    // as the literal two-character sequence "\n". Decode them on load so
    // the result matches the multi-line string the orchestrator would
    // send in the handshake.
    const decode = (raw: string): string => raw.replace(/\\n/g, '\n');
    const url = pick('REPO_URL', 'DEBUG_REPO_URL');
    if (url)               CONFIG.REPO_URL = url;
    const host = pick('REPO_HOST', 'DEBUG_REPO_HOST');
    if (host)              CONFIG.REPO_HOST = host;
    const pat = pick('REPO_PAT', 'DEBUG_REPO_PAT');
    if (pat)               CONFIG.REPO_PAT = pat;
    const branch = pick('REPO_BRANCH', 'DEBUG_REPO_BRANCH');
    if (branch)            CONFIG.REPO_BRANCH = branch;
    const backend = pick('BACKEND', 'DEBUG_BACKEND');
    if (backend)           CONFIG.BACKEND = backend;
    const model = pick('EXECUTION_MODEL', 'DEBUG_EXECUTION_MODEL');
    if (model)             CONFIG.BACKEND_MODEL = model;
    const build = pick('BUILD_CMD', 'DEBUG_BUILD_CMD');
    if (build)             CONFIG.BUILD_CMD = build;
    const test = pick('TEST_CMD', 'DEBUG_TEST_CMD');
    if (test)              CONFIG.TEST_CMD = test;
    const plan = pick('TEST_PLAN', 'DEBUG_TEST_PLAN');
    if (plan)              CONFIG.TEST_PLAN = decode(plan);
    const title = pick('JOB_TITLE', 'DEBUG_JOB_TITLE');
    if (title)             CONFIG.JOB_TITLE = title;
    const story = pick('STORY', 'DEBUG_STORY');
    if (story)             CONFIG.STORY_CONTENT = decode(story);
    const passedTests = pick('PASSED_TESTS', 'DEBUG_PASSED_TESTS');
    if (passedTests)       CONFIG.PASSED_TESTS = decode(passedTests);
    const amt = parseInt(pick('AGENT_MAX_TIMEOUT', 'DEBUG_AGENT_MAX_TIMEOUT') ?? '', 10);
    if (!Number.isNaN(amt) && amt > 0) CONFIG.AGENT_MAX_TIMEOUT = amt;
}
