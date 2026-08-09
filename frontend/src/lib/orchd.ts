// TS mirror of the wire shapes from orchd-core / orchd-store (snake_case
// serde, internally-tagged enums via `type`). Keep this in sync with
// crates/orchd-core/src/{event,command,agent,tool,permission}.rs and
// crates/orchd-store/src/models.rs.

import {Bot} from "lucide-react"
import type {ComponentType, SVGProps} from "react"
import {ClaudeLogo} from "@/components/icons/claude-logo"
import {OpenAiLogo} from "@/components/icons/openai-logo"

export type AgentKind = "claude_code" | "codex"

export const DISABLED_AGENT_KINDS: readonly AgentKind[] = ["codex"]

export type SessionStatus =
  | "creating"
  | "running"
  | "interrupted"
  | "failed"
  | "closed"

export interface SessionContext {
  used_tokens: number
  context_window: number
  max_output_tokens: number
}

export interface SessionRecord {
  id: string
  agent_kind: string
  project_id: string | null
  cwd: string
  status: SessionStatus
  native_session_id: string | null
  // Adapters name conversations asynchronously; `null` until one reports.
  title: string | null
  // `null` until `session_init`, or forever for adapters that never report.
  model: string | null
  // `null` until the first `usage_update`.
  context_tokens_used: number | null
  // `model` resolved against the server's catalog with usage folded in.
  context: SessionContext | null
  // `null` while active. `listSessions` excludes archived sessions.
  archived_at: string | null
  // Runtime-only, so `false` for any session with no live actor. This is
  // the "agent is actually working" signal; `status` only tracks the
  // process lifecycle and stays `running` whether busy or idle.
  busy: boolean
  created_at: string
  updated_at: string
  // Client-only, mirrored in from the open session panel so the sidebar
  // row shows the same working indicator. Wiped by the next refetch.
  titleRegenerating?: boolean
  // Client-only, mirrored in from the open session panel so the row's
  // indicator counts from the turn's start rather than from mount.
  turnStartedAt?: string | null
}

export function basename(path: string): string {
  return path.replace(/\/+$/, "").split("/").pop() || path
}

export function sessionDisplayName(session: SessionRecord): string {
  return session.title || basename(session.cwd)
}

export interface ProjectRecord {
  id: string
  name: string
  path: string
  created_at: string
  updated_at: string
}

export interface SettingsRecord {
  interface_font: string | null
  interface_font_size: string | null
  mono_font: string | null
  mono_font_size: string | null
  time_format: string | null
  code_theme: string | null
  updated_at: string
}

export interface SettingsPatch {
  interface_font?: string | null
  interface_font_size?: string | null
  mono_font?: string | null
  mono_font_size?: string | null
  time_format?: string | null
  code_theme?: string | null
}

// Bump alongside the workspace version in the root Cargo.toml when cutting a release.
export const APP_VERSION = "0.1.0"

export interface FsEntry {
  name: string
  path: string
}

export interface FsBrowseResponse {
  path: string
  parent: string | null
  entries: FsEntry[]
}

export type GitStatus =
  | "added"
  | "deleted"
  | "ignored"
  | "modified"
  | "renamed"
  | "untracked"

export interface GitStatusEntry {
  path: string
  status: GitStatus
}

export interface FileTreeResponse {
  path: string
  files: string[]
  git: GitStatusEntry[] | null
}


export type ModelProvider = "anthropic" | "open_ai"

export interface ModelInfo {
  id: string
  display_name: string
  provider: ModelProvider
  context_window: number
  max_output_tokens: number
}

// Mirrors `claude_code::DEFAULT_MODEL`, the model a new session actually
// launches with. Seeds the draft composer before a live session reports
// its own, so the picker doesn't show the catalog's first entry instead.
export const DEFAULT_ANTHROPIC_MODEL = "claude-sonnet-5"

export const MODEL_PROVIDER_LABEL: Record<ModelProvider, string> = {
  anthropic: "Anthropic",
  open_ai: "OpenAI",
}

export const MODEL_PROVIDER_ICON: Record<
  ModelProvider,
  ComponentType<SVGProps<SVGSVGElement>>
> = {
  anthropic: ClaudeLogo,
  open_ai: OpenAiLogo,
}

export function formatContextSize(tokens: number): string {
  if (tokens >= 1_000_000) {
    const millions = tokens / 1_000_000
    return `${millions % 1 === 0 ? millions : millions.toFixed(1)}M`
  }
  if (tokens >= 1_000) {
    const thousands = tokens / 1_000
    return `${thousands % 1 === 0 ? thousands : thousands.toFixed(1)}K`
  }
  return `${tokens}`
}

export interface ClientSessionRecord {
  id: string
  device_label: string | null
  created_at: string
  last_seen_at: string
  expires_at: string
  revoked_at: string | null
}

export const AGENT_LABEL: Record<AgentKind, string> = {
  claude_code: "Claude Code",
  codex: "Codex",
}

export const AGENT_ICON: Record<
  AgentKind,
  ComponentType<SVGProps<SVGSVGElement>>
> = {
  claude_code: ClaudeLogo,
  codex: OpenAiLogo,
}

// Falls back for legacy kinds (e.g. `echo` test sessions) still on disk.
export function agentLabel(kind: string): string {
  return AGENT_LABEL[kind as AgentKind] ?? kind
}

export function agentIcon(
  kind: string
): ComponentType<SVGProps<SVGSVGElement>> {
  return AGENT_ICON[kind as AgentKind] ?? Bot
}

export type CanonicalTool =
  | "file_read"
  | "file_write"
  | "file_edit"
  | "shell_exec"
  | "search"
  | "web_fetch"
  | "mcp"
  | "custom"

export interface ToolRef {
  canonical: CanonicalTool
  native_name: string
  agent: string
}

export type ToolOutput =
  | { kind: "text"; text: string }
  | { kind: "json"; value: unknown }
  | { kind: "file_diff"; path: string; diff: string }

export type PermissionKind =
  | "file_write"
  | "shell_exec"
  | "network_access"
  | "tool_use"
  | "custom"

export interface PermissionScope {
  kind: PermissionKind
  pattern: string | null
}

export interface PermissionRequest {
  request_id: string
  call_id: string | null
  tool: ToolRef | null
  kind: PermissionKind
  summary: string
  detail: unknown
  suggested: Decision | null
  expires_at: string
}

export type Decision =
  | { type: "allow" }
  | { type: "allow_always"; scope: PermissionScope }
  | { type: "deny"; reason: string | null }
  | { type: "modify"; updated_input: unknown }

export type RuleAction = "allow" | "deny"

// Matched in order before falling back to asking a human.
// `pattern: null` matches any subject of that kind.
export interface PolicyRule {
  action: RuleAction
  kind: PermissionKind
  pattern: string | null
}

export type ContentPart = { type: "text"; text: string }

// Plan researches and proposes without making changes. Independent of the
// policy engine, which gates what's auto-approved, not what's attempted.
export type AgentMode = "build" | "plan"

// Extended-thinking depth, in Claude Code's own `--effort` vocabulary.
export type ThinkingEffort = "low" | "medium" | "high" | "xhigh" | "max"

export type SessionCommand =
  | { type: "user_message"; client_msg_id: string; content: ContentPart[] }
  | { type: "resolve_approval"; request_id: string; decision: Decision }
  | { type: "interrupt" }
  | { type: "update_policy"; rules: PolicyRule[] }
  | { type: "set_mode"; mode: AgentMode }
  | { type: "set_model"; model: string | null; effort: ThinkingEffort | null }
  | { type: "close"; reason: CloseReason }
  | { type: "regenerate_title" }

export type StopReason = "end_turn" | "max_tokens" | "interrupted" | "error"
export type CloseReason = "client_requested" | "idle" | "agent_crash" | "error"
export type ErrorScope =
  | "adapter"
  | "process"
  | "policy"
  | "store"
  | "transport"

export interface AgentCapabilities {
  thinking: boolean
  structured_tools: boolean
  resume: boolean
  native_permissions: boolean
  skills: boolean
}

export type EventPayload =
  | {
      type: "session_init"
      agent: string
      native_session_id: string | null
      model: string | null
      capabilities: AgentCapabilities
    }
  | { type: "user_message"; client_msg_id: string; content: ContentPart[] }
  | { type: "text_delta"; block: string; text: string }
  | { type: "thinking_delta"; block: string; text: string; redacted: boolean }
  | {
      type: "tool_call_requested"
      call_id: string
      tool: ToolRef
      input: unknown
      needs_approval: boolean
    }
  | { type: "tool_call_progress"; call_id: string; chunk: unknown }
  | {
      type: "tool_call_completed"
      call_id: string
      output: ToolOutput
      is_error: boolean
    }
  | { type: "skill_invoked"; skill: string; args: unknown }
  | ({ type: "permission_requested" } & PermissionRequest)
  | { type: "permission_resolved"; request_id: string; decision: Decision }
  | {
      type: "usage_update"
      input_tokens: number
      output_tokens: number
      cache_creation_input_tokens: number
      // Summed with the two input counts above, this is the full prompt
      // size the model read this turn, comparable to `context_window`.
      cache_read_input_tokens: number
      cost_usd: number | null
    }
  | {
      type: "error"
      scope: ErrorScope
      code: string
      message: string
      recoverable: boolean
    }
  | { type: "turn_completed"; turn: string; stop_reason: StopReason }
  | { type: "title_updated"; title: string }
  | { type: "session_closed"; reason: CloseReason }

// `#[serde(flatten)]` on the Rust side merges the payload's `type` tag
// into this object, so there's no nested `payload`: `event.type` narrows
// the whole thing directly.
export type SessionEvent = {
  session_id: string
  seq: number
  ts: string
  turn: string
} & EventPayload
