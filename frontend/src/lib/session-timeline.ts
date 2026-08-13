// Folds a live `SessionEvent` stream into the `TimelineEvent[]` shape the
// agent components render. Deltas upsert in place keyed by the backend's
// own ids, so streaming text, tool calls, and approvals each update one
// row instead of appending duplicates.

import type { ToolResultKind } from "@/components/agents/tool-result"
import type {
  ContentPart,
  PermissionKind,
  SessionEvent,
  ToolOutput,
  ToolRef,
} from "@/lib/orchd"
import type {
  PermissionEvent,
  TimelineEvent,
  ToolResultEvent,
} from "@/lib/timeline"

// Computed client-side from the live event stream, mirroring the server's
// `sync_context_usage`, so the indicator updates mid-turn instead of
// waiting on a REST refetch.
export interface SessionUsage {
  input_tokens: number
  output_tokens: number
  cache_creation_input_tokens: number
  cache_read_input_tokens: number
}

export interface SessionTimelineState {
  events: TimelineEvent[]
  busy: boolean
  // Set when `busy` flips true, cleared when it flips false, so the
  // working indicator spans the whole turn rather than one event.
  turnStartedAt: string | null
  // `null` until `session_init`; callers fall back to `SessionRecord`.
  model: string | null
  // `null` until the first `usage_update`; same fallback as `model`.
  usage: SessionUsage | null
}

export const initialSessionTimelineState: SessionTimelineState = {
  events: [],
  busy: false,
  turnStartedAt: null,
  model: null,
  usage: null,
}

export type SessionTimelineAction =
  | { type: "reset" }
  // `isLive` is false during resume catch-up. Only live text deltas
  // should typewriter-reveal.
  | { type: "apply_event"; event: SessionEvent; isLive: boolean }
  | { type: "append_user_message"; id: string; text: string; ts: string }
  | { type: "set_busy"; busy: boolean }
  | {
      type: "set_permission_status"
      id: string
      status: PermissionEvent["status"]
    }

function upsert(
  events: TimelineEvent[],
  id: string,
  make: (existing: TimelineEvent | undefined) => TimelineEvent
): TimelineEvent[] {
  const index = events.findIndex((event) => event.id === id)
  if (index === -1) return [...events, make(undefined)]
  const next = events.slice()
  next[index] = make(next[index])
  return next
}

function toolResultKind(canonical: ToolRef["canonical"]): ToolResultKind {
  switch (canonical) {
    case "shell_exec":
      return "terminal"
    case "web_fetch":
      return "request"
    default:
      return "custom"
  }
}

function contentPartsToText(content: ContentPart[]): string {
  return content
    .map((part) => (part.type === "text" ? part.text : `/${part.name}`))
    .join("\n")
}

// Thinking is a "working on it" indicator, not a transcript entry, so its
// shimmer must not linger once real content lands or the turn ends.
function dropThinking(events: TimelineEvent[]): TimelineEvent[] {
  return events.some((event) => event.kind === "thinking")
    ? events.filter((event) => event.kind !== "thinking")
    : events
}

function toolOutputText(output: ToolOutput): string {
  switch (output.kind) {
    case "text":
      return output.text
    case "json":
      return JSON.stringify(output.value, null, 2)
    case "file_diff":
      return output.diff
  }
}

function permissionParameters(detail: unknown) {
  if (!detail || typeof detail !== "object") return []
  const d = detail as Record<string, unknown>
  const params: { id: string; label: string; value: string }[] = []
  if (typeof d.command === "string") {
    params.push({ id: "command", label: "Command", value: d.command })
  }
  if (Array.isArray(d.paths) && d.paths.length > 0) {
    params.push({ id: "paths", label: "Paths", value: d.paths.join(", ") })
  }
  if (typeof d.url === "string") {
    params.push({ id: "url", label: "URL", value: d.url })
  }
  return params
}

function permissionKindPattern(detail: unknown): string | undefined {
  if (!detail || typeof detail !== "object") return undefined
  const d = detail as Record<string, unknown>
  if (typeof d.command === "string") return d.command
  if (Array.isArray(d.paths) && typeof d.paths[0] === "string")
    return d.paths[0] as string
  if (typeof d.url === "string") return d.url
  return undefined
}

const DECISION_TO_STATUS: Record<string, PermissionEvent["status"]> = {
  allow: "approved",
  allow_always: "approved",
  modify: "approved",
  deny: "denied",
}

function applyEvent(
  events: TimelineEvent[],
  event: SessionEvent,
  isLive: boolean
): TimelineEvent[] {
  switch (event.type) {
    case "session_init":
    case "tool_call_progress":
    case "usage_update":
    case "skill_invoked":
      return events

    case "user_message":
      return upsert(events, event.client_msg_id, () => ({
        id: event.client_msg_id,
        kind: "user_message",
        text: contentPartsToText(event.content),
        ts: event.ts,
      }))

    case "text_delta":
      return upsert(dropThinking(events), event.block, (existing) => ({
        id: event.block,
        kind: "assistant_text",
        streaming: true,
        text:
          (existing?.kind === "assistant_text" ? existing.text : "") +
          event.text,
        ts: event.ts,
        turn: event.turn,
        live:
          isLive ||
          (existing?.kind === "assistant_text" ? existing.live : false),
      }))

    case "thinking_delta":
      return upsert(events, event.block, () => ({
        id: event.block,
        kind: "thinking",
      }))

    case "tool_call_requested":
      return upsert(dropThinking(events), event.call_id, () => ({
        id: event.call_id,
        kind: "tool_result",
        tool: event.tool.native_name,
        title: event.tool.native_name,
        status: "running",
        resultKind: toolResultKind(event.tool.canonical),
        output: "",
      }))

    case "tool_call_completed":
      return upsert(events, event.call_id, (existing) => {
        const base: ToolResultEvent =
          existing?.kind === "tool_result"
            ? existing
            : {
                id: event.call_id,
                kind: "tool_result",
                tool: "tool",
                title: "Tool call",
                status: "running",
                resultKind: "custom",
                output: "",
              }
        return {
          ...base,
          status: event.is_error ? "error" : "success",
          output: toolOutputText(event.output),
        }
      })

    case "permission_requested":
      return upsert(events, event.request_id, () => ({
        id: event.request_id,
        kind: "permission",
        tool: event.tool?.native_name ?? event.kind,
        title: event.summary,
        status: "pending",
        parameters: permissionParameters(event.detail),
        permissionKind: event.kind as PermissionKind,
        suggestedScope: {
          kind: event.kind as PermissionKind,
          pattern: permissionKindPattern(event.detail) ?? null,
        },
      }))

    case "permission_resolved": {
      const status = DECISION_TO_STATUS[event.decision.type]
      const index = events.findIndex((e) => e.id === event.request_id)
      // Auto-allowed/denied requests never emit `permission_requested` (the
      // human was never asked), so there may be nothing to update here.
      if (index === -1 || !status) return events
      return upsert(events, event.request_id, (existing) =>
        existing?.kind === "permission" ? { ...existing, status } : existing!
      )
    }

    case "turn_completed":
      // Nothing else clears a lingering shimmer when a turn ends
      // mid-thinking, nor the `streaming` flag that gates footer actions.
      return dropThinking(events).map((existing) =>
        existing.kind === "assistant_text" && existing.streaming
          ? { ...existing, streaming: false, ts: event.ts }
          : existing
      )

    case "error":
    case "title_updated":
    case "session_closed":
      return events
  }
}

export function sessionTimelineReducer(
  state: SessionTimelineState,
  action: SessionTimelineAction
): SessionTimelineState {
  switch (action.type) {
    case "reset":
      return initialSessionTimelineState

    case "apply_event": {
      const event = action.event
      const events = applyEvent(state.events, event, action.isLive)
      const turnEnded =
        event.type === "turn_completed" || event.type === "session_closed"
      const busy = turnEnded ? false : state.busy
      const turnStartedAt = turnEnded ? null : state.turnStartedAt
      const model =
        event.type === "session_init" && event.model ? event.model : state.model
      const usage: SessionUsage | null =
        event.type === "usage_update"
          ? {
              input_tokens: event.input_tokens,
              output_tokens: event.output_tokens,
              cache_creation_input_tokens: event.cache_creation_input_tokens,
              cache_read_input_tokens: event.cache_read_input_tokens,
            }
          : state.usage
      return { events, busy, turnStartedAt, model, usage }
    }

    case "append_user_message":
      return {
        ...state,
        events: [
          ...state.events,
          {
            id: action.id,
            kind: "user_message",
            text: action.text,
            ts: action.ts,
          },
        ],
      }

    case "set_busy":
      return {
        ...state,
        busy: action.busy,
        turnStartedAt: action.busy ? new Date().toISOString() : null,
      }

    case "set_permission_status":
      return {
        ...state,
        events: upsert(state.events, action.id, (existing) =>
          existing?.kind === "permission"
            ? { ...existing, status: action.status }
            : existing!
        ),
      }
  }
}
