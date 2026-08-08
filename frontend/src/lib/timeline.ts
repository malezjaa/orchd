// The rendering-side counterpart to the backend's `EventPayload` enum.
// Each variant maps to one agent component.

import type { AgentCodeLanguage } from "@/components/agents/agent-code"
import type {
  AgentActivityItem,
  AgentActivityStatus,
} from "@/components/agents/agent-activity"
import type { CitationItem } from "@/components/agents/citations"
import type { CodeBlockStatus } from "@/components/agents/code-block"
import type {
  FileDiffLine,
  FileDiffStatus,
} from "@/components/agents/file-diff"
import type {
  ToolApprovalParameter,
  ToolApprovalStatus,
} from "@/components/agents/tool-approval"
import type {
  ToolResultKind,
  ToolResultStatus,
} from "@/components/agents/tool-result"
import type { TodoItem } from "@/components/agents/todo-list"
import type { PermissionKind, PermissionScope } from "@/lib/orchd"

export interface UserMessageEvent {
  id: string
  kind: "user_message"
  text: string
  ts?: string
}

export interface AssistantTextEvent {
  id: string
  kind: "assistant_text"
  text: string
  streaming?: boolean
  sources?: CitationItem[]
  // Timestamp of the most recent delta, which approximates when the
  // response finished once streaming stops.
  ts?: string
  // A turn can produce several text blocks, split by tool calls between
  // them. Used to find the last one so the footer shows only once.
  turn?: string
  // True when deltas arrived on a live socket rather than during replay,
  // so a session's backlog doesn't typewriter-reveal on open.
  live?: boolean
}

export interface ThinkingEvent {
  id: string
  kind: "thinking"
  label?: string
}

export interface ActivityEvent {
  id: string
  kind: "activity"
  status: AgentActivityStatus
  items: AgentActivityItem[]
  duration?: number
}

export interface PermissionEvent {
  id: string
  kind: "permission"
  tool: string
  title: string
  description?: string
  status: ToolApprovalStatus
  parameters?: ToolApprovalParameter[]
  // Carried through so "always allow" can build an `allow_always` scope.
  permissionKind: PermissionKind
  suggestedScope?: PermissionScope
}

export interface ToolResultEvent {
  id: string
  kind: "tool_result"
  tool: string
  title: string
  status: ToolResultStatus
  resultKind: ToolResultKind
  output: string
  meta?: string
}

export interface FileDiffEvent {
  id: string
  kind: "file_diff"
  file: string
  lines: FileDiffLine[]
  status: FileDiffStatus
}

export interface CodeEvent {
  id: string
  kind: "code"
  filename?: string
  language: AgentCodeLanguage
  code: string
  status?: CodeBlockStatus
}

// Mirrors a `TodoWrite`-style skill invocation.
export interface TodoEvent {
  id: string
  kind: "todo"
  title?: string
  items: TodoItem[]
}

export type TimelineEvent =
  | UserMessageEvent
  | AssistantTextEvent
  | ThinkingEvent
  | ActivityEvent
  | PermissionEvent
  | ToolResultEvent
  | FileDiffEvent
  | CodeEvent
  | TodoEvent

// Meta calls the CLI makes on itself rather than on the user's project.
// They carry nothing useful in the transcript.
const HIDDEN_TOOL_CALLS = new Set(["ToolSearch", "ExitPlanMode"])

export function isHiddenToolCall(event: TimelineEvent): boolean {
  return event.kind === "tool_result" && HIDDEN_TOOL_CALLS.has(event.tool)
}

// The footer should show once per turn, on the last text segment, not on
// every intermediate one.
export function finalAssistantTextIds(events: TimelineEvent[]): Set<string> {
  const lastForTurn = new Map<string, string>()
  for (const event of events) {
    if (event.kind === "assistant_text") {
      lastForTurn.set(event.turn ?? event.id, event.id)
    }
  }
  return new Set(lastForTurn.values())
}
