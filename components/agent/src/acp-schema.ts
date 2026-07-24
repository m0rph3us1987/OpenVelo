// ACP (Agent Client Protocol) type definitions — subset of v1 that the
// ACPClient / ACPSession consume. Mirrors the types in
// @agentclientprotocol/sdk v0.21.0 (the version used by kilo).
//
// Spec: https://agentclientprotocol.com/protocol/overview
// Reference SDK: /home/m0rph3us1987/development/kilocode/packages/opencode/src/acp/agent.ts
// Reference types: @agentclientprotocol/sdk/dist/schema/types.gen.d.ts

// ---------------------------------------------------------------------------
// JSON-RPC 2.0 envelope
// ---------------------------------------------------------------------------

export interface JsonRpcRequest {
    jsonrpc: '2.0';
    id: number;
    method: string;
    params?: unknown;
}

export interface JsonRpcNotification {
    jsonrpc: '2.0';
    method: string;
    params?: unknown;
}

export interface JsonRpcResponse {
    jsonrpc: '2.0';
    id: number;
    result?: unknown;
    error?: { code: number; message: string; data?: unknown };
}

export type JsonRpcMessage = JsonRpcRequest | JsonRpcNotification | JsonRpcResponse;

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

export type ProtocolVersion = number;
export type SessionId = string;
export type ToolCallId = string;
export type PermissionOptionId = string;
export type SessionConfigId = string;
export type SessionConfigValueId = string;
export type SessionModeId = string;
export type ModelId = string;
export type StopReason = 'end_turn' | 'max_tokens' | 'max_turn_requests' | 'refusal' | 'cancelled';

// ---------------------------------------------------------------------------
// Annotations and Content
// ---------------------------------------------------------------------------

export interface Annotations {
    audience?: Array<'user' | 'assistant'>;
    lastModified?: string;
    priority?: number;
    _meta?: Record<string, unknown> | null;
}

export interface TextContent {
    type: 'text';
    text: string;
    annotations?: Annotations | null;
    _meta?: Record<string, unknown> | null;
}

export interface ImageContent {
    type: 'image';
    mimeType: string;
    data: string;
    uri?: string;
    annotations?: Annotations | null;
    _meta?: Record<string, unknown> | null;
}

export interface AudioContent {
    type: 'audio';
    mimeType: string;
    data: string;
    annotations?: Annotations | null;
    _meta?: Record<string, unknown> | null;
}

export interface EmbeddedResource {
    type: 'resource';
    resource:
        | { uri: string; mimeType?: string; text: string; _meta?: Record<string, unknown> | null }
        | { uri: string; mimeType?: string; blob: string; _meta?: Record<string, unknown> | null };
    annotations?: Annotations | null;
    _meta?: Record<string, unknown> | null;
}

export interface ResourceLink {
    type: 'resource_link';
    uri: string;
    name: string;
    mimeType?: string;
    size?: number;
    title?: string;
    description?: string;
    annotations?: Annotations | null;
    _meta?: Record<string, unknown> | null;
}

export type ContentBlock = TextContent | ImageContent | AudioContent | EmbeddedResource | ResourceLink;

// ---------------------------------------------------------------------------
// Tool calls
// ---------------------------------------------------------------------------

export type ToolKind = 'read' | 'edit' | 'delete' | 'move' | 'search' | 'execute' | 'think' | 'fetch' | 'switch_mode' | 'other';
export type ToolCallStatus = 'pending' | 'in_progress' | 'completed' | 'failed';

export interface ToolCallLocation {
    path: string;
    line?: number;
    _meta?: Record<string, unknown> | null;
}

export interface ToolCallContent {
    type: 'content';
    content: ContentBlock;
    _meta?: Record<string, unknown> | null;
}

export interface ToolCallContentDiff {
    type: 'diff';
    path: string;
    oldText?: string;
    newText: string;
    _meta?: Record<string, unknown> | null;
}

export interface ToolCallContentTerminal {
    type: 'terminal';
    terminalId: string;
    _meta?: Record<string, unknown> | null;
}

export type ToolCallContentUnion = ToolCallContent | ToolCallContentDiff | ToolCallContentTerminal;

export interface ToolCall {
    _meta?: Record<string, unknown> | null;
    content?: ToolCallContentUnion[];
    kind?: ToolKind;
    locations?: ToolCallLocation[];
    rawInput?: unknown;
    rawOutput?: unknown;
    status?: ToolCallStatus;
    title: string;
    toolCallId: ToolCallId;
}

export type ToolCallUpdate = {
    _meta?: Record<string, unknown> | null;
    content?: ToolCallContentUnion[] | null;
    kind?: ToolKind | null;
    locations?: ToolCallLocation[] | null;
    rawInput?: unknown;
    rawOutput?: unknown;
    status?: ToolCallStatus | null;
    title?: string | null;
    toolCallId: ToolCallId;
};

// ---------------------------------------------------------------------------
// Permissions
// ---------------------------------------------------------------------------

export type PermissionOptionKind = 'allow_once' | 'allow_always' | 'reject_once' | 'reject_always';

export interface PermissionOption {
    optionId: PermissionOptionId;
    name: string;
    kind: PermissionOptionKind;
    _meta?: Record<string, unknown> | null;
}

export type RequestPermissionOutcome =
    | { outcome: 'cancelled' }
    | { outcome: 'selected'; optionId: PermissionOptionId };

// ---------------------------------------------------------------------------
// Plans
// ---------------------------------------------------------------------------

export type PlanEntryPriority = 'high' | 'medium' | 'low';
export type PlanEntryStatus = 'pending' | 'in_progress' | 'completed';

export interface PlanEntry {
    content: string;
    priority: PlanEntryPriority;
    status: PlanEntryStatus;
    _meta?: Record<string, unknown> | null;
}

export interface Plan {
    entries: PlanEntry[];
    _meta?: Record<string, unknown> | null;
}

// ---------------------------------------------------------------------------
// Usage
// ---------------------------------------------------------------------------

export interface Usage {
    totalTokens?: number;
    inputTokens?: number;
    outputTokens?: number;
    thoughtTokens?: number;
    cachedReadTokens?: number;
    cachedWriteTokens?: number;
    _meta?: Record<string, unknown> | null;
}

export interface UsageUpdate {
    used: number;
    size: number;
    cost?: { amount: number; currency: string };
    _meta?: Record<string, unknown> | null;
}

// ---------------------------------------------------------------------------
// MCP servers
// ---------------------------------------------------------------------------

export interface EnvVariable {
    name: string;
    value: string;
    _meta?: Record<string, unknown> | null;
}

export type McpServer =
    | {
          name: string;
          command: string;
          args: Array<string>;
          env: Array<EnvVariable>;
          _meta?: Record<string, unknown> | null;
      }
    | {
          name: string;
          url: string;
          type?: 'http' | 'sse' | null;
          headers: Array<{ name: string; value: string; _meta?: Record<string, unknown> | null }>;
          _meta?: Record<string, unknown> | null;
      };

// ---------------------------------------------------------------------------
// Session config (model / effort / mode selectors)
// ---------------------------------------------------------------------------

export interface SessionConfigSelectOption {
    value: SessionConfigValueId;
    name: string;
    description?: string | null;
    _meta?: Record<string, unknown> | null;
}

export type SessionConfigSelectOptions = SessionConfigSelectOption[];

export interface SessionConfigSelect {
    currentValue: SessionConfigValueId;
    options: SessionConfigSelectOptions;
}

export interface SessionConfigOption extends SessionConfigSelect {
    type: 'select';
    id: SessionConfigId;
    name: string;
    description?: string;
    _meta?: Record<string, unknown> | null;
}

// ---------------------------------------------------------------------------
// Sessions: modes / models
// ---------------------------------------------------------------------------

export interface SessionModeState {
    availableModes: Array<{ id: SessionModeId; name: string; description?: string }>;
    currentModeId: SessionModeId;
    _meta?: Record<string, unknown> | null;
}

export interface SessionModelState {
    currentModelId: ModelId;
    availableModels: Array<{ modelId: ModelId; name: string; description?: string }>;
    _meta?: Record<string, unknown> | null;
}

// ---------------------------------------------------------------------------
// session/update discriminator — the main notification payload
// ---------------------------------------------------------------------------

export interface ContentChunk {
    content: ContentBlock;
    _meta?: Record<string, unknown> | null;
}

export interface AvailableCommandsUpdate {
    availableCommands: Array<{ name: string; description?: string }>;
    _meta?: Record<string, unknown> | null;
}

export interface CurrentModeUpdate {
    modeId: SessionModeId;
    _meta?: Record<string, unknown> | null;
}

export interface ConfigOptionUpdate {
    configOptions: SessionConfigOption[];
    _meta?: Record<string, unknown> | null;
}

export interface SessionInfoUpdate {
    title?: string;
    updatedAt?: string;
    _meta?: Record<string, unknown> | null;
}

export type SessionUpdate =
    | (ContentChunk & { sessionUpdate: 'user_message_chunk' })
    | (ContentChunk & { sessionUpdate: 'agent_message_chunk' })
    | (ContentChunk & { sessionUpdate: 'agent_thought_chunk' })
    | (ToolCall & { sessionUpdate: 'tool_call' })
    | (ToolCallUpdate & { sessionUpdate: 'tool_call_update' })
    | (Plan & { sessionUpdate: 'plan' })
    | (AvailableCommandsUpdate & { sessionUpdate: 'available_commands_update' })
    | (CurrentModeUpdate & { sessionUpdate: 'current_mode_update' })
    | (ConfigOptionUpdate & { sessionUpdate: 'config_option_update' })
    | (SessionInfoUpdate & { sessionUpdate: 'session_info_update' })
    | (UsageUpdate & { sessionUpdate: 'usage_update' });

export interface SessionNotification {
    sessionId: SessionId;
    update: SessionUpdate;
    _meta?: Record<string, unknown> | null;
}

// ---------------------------------------------------------------------------
// Method param / result types
// ---------------------------------------------------------------------------

export interface Implementation {
    name: string;
    title?: string;
    version: string;
    _meta?: Record<string, unknown> | null;
}

export interface ClientCapabilities {
    _meta?: Record<string, unknown> | null;
    fs?: {
        readTextFile?: boolean;
        writeTextFile?: boolean;
    };
    terminal?: boolean;
}

export interface InitializeParams {
    protocolVersion: ProtocolVersion;
    clientCapabilities?: ClientCapabilities;
    clientInfo?: Implementation;
    _meta?: Record<string, unknown> | null;
}

export interface InitializeResult {
    protocolVersion: ProtocolVersion;
    agentCapabilities?: Record<string, unknown>;
    agentInfo?: Implementation;
    authMethods?: Array<{ id: string; name: string; description?: string; _meta?: Record<string, unknown> | null }>;
    _meta?: Record<string, unknown> | null;
}

export interface SessionNewParams {
    cwd: string;
    mcpServers: McpServer[];
    sessionId?: SessionId;
    _meta?: Record<string, unknown> | null;
}

export interface SessionNewResult {
    sessionId: SessionId;
    modes?: SessionModeState;
    models?: SessionModelState;
    configOptions?: SessionConfigOption[];
    _meta?: Record<string, unknown> | null;
}

export interface SessionPromptParams {
    sessionId: SessionId;
    prompt: ContentBlock[];
    _meta?: Record<string, unknown> | null;
}

export interface SessionPromptResult {
    stopReason: StopReason;
    _meta?: Record<string, unknown> | null;
}

export interface RequestPermissionParams {
    sessionId: SessionId;
    toolCall: ToolCallUpdate;
    options: PermissionOption[];
    _meta?: Record<string, unknown> | null;
}

export interface SetSessionModeParams {
    sessionId: SessionId;
    modeId: SessionModeId;
    _meta?: Record<string, unknown> | null;
}

export interface SetSessionConfigOptionParams {
    sessionId: SessionId;
    configId: SessionConfigId;
    value: SessionConfigValueId;
    _meta?: Record<string, unknown> | null;
}

export interface SetSessionConfigOptionResult {
    configOptions: SessionConfigOption[];
    _meta?: Record<string, unknown> | null;
}

export interface CancelNotification {
    sessionId: SessionId;
    _meta?: Record<string, unknown> | null;
}

export interface SessionCloseParams {
    sessionId: SessionId;
    _meta?: Record<string, unknown> | null;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class AcpError extends Error {
    code: number;
    data?: unknown;
    constructor(code: number, message: string, data?: unknown) {
        super(message);
        this.code = code;
        this.data = data;
    }
}
