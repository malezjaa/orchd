// Folds a live `SessionEvent` stream into the `TimelineEvent[]` shape the
// agent components render. Deltas upsert in place keyed by the backend's
// own ids, so streaming text, tool calls, and approvals each update one
// row instead of appending duplicates.

import type { ToolResultKind } from "@/components/agents/tool-result"
import type { CitationItem } from "@/components/agents/citations"
import type {
  ContentPart,
  PermissionKind,
  SessionEvent,
  SubagentRecord,
  ToolOutput,
  ToolRef,
} from "@/lib/orchd"
import type {
  PermissionEvent,
  TimelineEvent,
  ToolResultEvent,
} from "@/lib/timeline"
import { getToolPresentation } from "@/lib/tool-presentation"

// Computed client-side from the live event stream, mirroring the server's
// `sync_context_usage`, so the indicator updates mid-turn instead of
// waiting on a REST refetch.
export interface SessionUsage {
  input_tokens: number
  output_tokens: number
  cache_creation_input_tokens: number
  cache_read_input_tokens: number
  cost_usd: number | null
}

export interface LongestTool {
  name: string
  durationSeconds: number
}

export interface SessionInsights {
  sessionCostUsd: number | null
  longestTool: LongestTool | null
}

export interface SubagentMessage {
  id: string
  role: "user" | "assistant"
  text: string
  ts: string
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
  insights: SessionInsights
  toolStarts: Record<
    string,
    {
      name: string
      startedAt: string
      canonical: ToolRef["canonical"]
      input: unknown
    }
  >
  citationsByTurn: Record<string, CitationItem[]>
  costByTurn: Record<string, number | null>
  subagents: Record<string, SubagentRecord>
  subagentMessages: Record<string, SubagentMessage[]>
}

export const initialSessionTimelineState: SessionTimelineState = {
  events: [],
  busy: false,
  turnStartedAt: null,
  model: null,
  usage: null,
  insights: {
    sessionCostUsd: null,
    longestTool: null,
  },
  toolStarts: {},
  citationsByTurn: {},
  costByTurn: {},
  subagents: {},
  subagentMessages: {},
}

export type SessionTimelineAction =
  | { type: "reset" }
  | { type: "hydrate_subagents"; records: SubagentRecord[] }
  | {
      type: "append_subagent_message"
      threadId: string
      message: SubagentMessage
    }
  // `isLive` is false during resume catch-up. Only live text deltas
  // should typewriter-reveal.
  | { type: "apply_event"; event: SessionEvent; isLive: boolean }
  | {
      type: "append_user_message"
      id: string
      text: string
      content: ContentPart[]
      ts: string
    }
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
    .map((part) => {
      if (part.type === "text") return part.text
      if (part.type === "skill") return `/${part.name}`
      return `[${part.name ?? "image"}]`
    })
    .join("")
}

function contentPartsToMarkdown(content: ContentPart[]): string {
  return content
    .map((part) => {
      if (part.type === "text") return part.text
      if (part.type === "skill") return `/${part.name}`
      const name = (part.name ?? "image").replaceAll("]", "\\]")
      return `![${name}](data:${part.media_type};base64,${part.data})`
    })
    .join("")
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

function applySubagentEvent(
  current: Record<string, SubagentRecord>,
  event: SessionEvent
): Record<string, SubagentRecord> {
  if (event.type === "subagent_started") {
    const previous = current[event.thread_id]
    return {
      ...current,
      [event.thread_id]: {
        parent_session_id: event.session_id,
        thread_id: event.thread_id,
        nickname: event.nickname,
        role: event.role,
        prompt: event.prompt,
        model: event.model,
        effort: event.effort,
        status: event.status,
        message: previous?.message ?? null,
        summary: previous?.summary ?? null,
        can_accept_direct_input: event.can_accept_direct_input,
        active_turn_id: event.active_turn_id,
        created_at: previous?.created_at ?? event.ts,
        updated_at: event.ts,
      },
    }
  }
  if (event.type === "subagent_status_changed") {
    const previous = current[event.thread_id]
    if (!previous) {
      return {
        ...current,
        [event.thread_id]: {
          parent_session_id: event.session_id,
          thread_id: event.thread_id,
          nickname: null,
          role: null,
          prompt: null,
          model: null,
          effort: null,
          status: event.status,
          message: event.message,
          summary: null,
          can_accept_direct_input: event.can_accept_direct_input,
          active_turn_id: event.active_turn_id,
          created_at: event.ts,
          updated_at: event.ts,
        },
      }
    }
    return {
      ...current,
      [event.thread_id]: {
        ...previous,
        status: event.status,
        message: event.message ?? previous.message,
        can_accept_direct_input:
          event.can_accept_direct_input ?? previous.can_accept_direct_input,
        active_turn_id: event.active_turn_id ?? previous.active_turn_id,
        updated_at: event.ts,
      },
    }
  }
  if (event.type === "subagent_result") {
    const previous = current[event.thread_id]
    if (!previous) {
      return {
        ...current,
        [event.thread_id]: {
          parent_session_id: event.session_id,
          thread_id: event.thread_id,
          nickname: null,
          role: null,
          prompt: null,
          model: null,
          effort: null,
          status: "completed",
          message: null,
          summary: event.summary,
          can_accept_direct_input: null,
          active_turn_id: null,
          created_at: event.ts,
          updated_at: event.ts,
        },
      }
    }
    return {
      ...current,
      [event.thread_id]: {
        ...previous,
        // A result is terminal even if the adapter omitted a separate
        // completed-status notification.
        status: "completed",
        active_turn_id: null,
        summary: event.summary,
        updated_at: event.ts,
      },
    }
  }
  return current
}

function applySubagentResult(
  current: Record<string, SubagentMessage[]>,
  event: Extract<SessionEvent, { type: "subagent_result" }>
): Record<string, SubagentMessage[]> {
  const messages = current[event.thread_id] ?? []
  const last = messages[messages.length - 1]

  // `thread/read` and repeated Codex completion notifications can return the
  // same bounded, cumulative child summary. Update the existing summary
  // message instead of rendering another copy.
  if (last?.role === "assistant") {
    if (last.text === event.summary) return current
    if (event.summary.startsWith(last.text)) {
      return {
        ...current,
        [event.thread_id]: [
          ...messages.slice(0, -1),
          {
            ...last,
            id: `${event.thread_id}:${event.seq}`,
            text: event.summary,
            ts: event.ts,
          },
        ],
      }
    }
  }

  return {
    ...current,
    [event.thread_id]: [
      ...messages,
      {
        id: `${event.thread_id}:${event.seq}`,
        role: "assistant",
        text: event.summary,
        ts: event.ts,
      },
    ],
  }
}

function applyMentionedSubagentNames(
  current: Record<string, SubagentRecord>,
  events: TimelineEvent[]
): Record<string, SubagentRecord> {
  const next = { ...current }
  const pattern = /\[\[subagent:([^|\]\s]+)\|([^\]]+)\]\]/g
  for (const event of events) {
    if (event.kind !== "assistant_text") continue
    pattern.lastIndex = 0
    let match: RegExpExecArray | null
    while ((match = pattern.exec(event.text)) !== null) {
      const agent = next[match[1]]
      if (agent && !agent.nickname) {
        next[match[1]] = { ...agent, nickname: match[2].trim() }
      }
    }
  }
  return next
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

const URL_PATTERN = /https?:\/\/[^\s<>"')\]]+/gi
const CITATION_URL_KEYS = ["url", "uri", "link", "href", "source_url", "sourceUrl"]
const CITATION_TITLE_KEYS = [
  "title",
  "name",
  "headline",
  "site_name",
  "siteName",
]

function normalizeCitationUrl(value: string): string | null {
  const cleaned = value.trim().replace(/[),.;:!?]+$/, "")
  try {
    const url = new URL(cleaned)
    return url.protocol === "http:" || url.protocol === "https:"
      ? url.toString()
      : null
  } catch {
    return null
  }
}

function citationDomain(url: string): string | undefined {
  try {
    return new URL(url).hostname.replace(/^www\./, "") || undefined
  } catch {
    return undefined
  }
}

function citationTitle(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined
  const title = value.trim()
  return title && title.length <= 160 ? title : undefined
}

function mergeCitations(
  current: CitationItem[] = [],
  additions: CitationItem[] = []
): CitationItem[] {
  const merged = new Map(current.map((citation) => [citation.id, citation]))
  for (const citation of additions) {
    if (!merged.has(citation.id)) merged.set(citation.id, citation)
  }
  return [...merged.values()]
}

function extractCitationItems(value: unknown): CitationItem[] {
  const citations: CitationItem[] = []
  const seen = new Set<unknown>()

  const add = (rawUrl: string, title?: string) => {
    const url = normalizeCitationUrl(rawUrl)
    if (!url) return
    citations.push({
      id: url,
      title: title ?? citationDomain(url) ?? url,
      domain: citationDomain(url),
      url,
    })
  }

  const visit = (candidate: unknown, fallbackTitle?: string) => {
    if (typeof candidate === "string") {
      for (const match of candidate.matchAll(URL_PATTERN)) {
        add(match[0], fallbackTitle)
      }
      return
    }
    if (!candidate || typeof candidate !== "object") return
    if (seen.has(candidate)) return
    seen.add(candidate)

    if (Array.isArray(candidate)) {
      for (const item of candidate) visit(item, fallbackTitle)
      return
    }

    const record = candidate as Record<string, unknown>
    const title =
      CITATION_TITLE_KEYS.map((key) => citationTitle(record[key])).find(
        Boolean
      ) ?? fallbackTitle
    for (const key of CITATION_URL_KEYS) {
      if (typeof record[key] === "string") add(record[key], title)
    }
    for (const [key, child] of Object.entries(record)) {
      if (CITATION_URL_KEYS.includes(key)) continue
      visit(child, title)
    }
  }

  visit(value)
  return mergeCitations([], citations)
}

function citationItemsFromTool(
  tool: {
    canonical: ToolRef["canonical"]
    nativeName: string
  },
  input: unknown,
  output: ToolOutput
): CitationItem[] {
  const nativeName = tool.nativeName.toLowerCase()
  const isLookup =
    tool.canonical === "search" ||
    tool.canonical === "web_fetch" ||
    nativeName.includes("websearch") ||
    nativeName.includes("web_search") ||
    nativeName.includes("webfetch") ||
    nativeName.includes("web_fetch")
  if (!isLookup) return []

  const outputValue =
    output.kind === "json"
      ? output.value
      : output.kind === "text"
        ? output.text
        : output.diff
  if (tool.canonical === "web_fetch") return extractCitationItems(input)

  return mergeCitations(
    extractCitationItems(input),
    extractCitationItems(outputValue)
  )
}

function withTurnCitations(
  events: TimelineEvent[],
  turn: string,
  citations: CitationItem[]
): TimelineEvent[] {
  return events.map((event) =>
    event.kind === "assistant_text" && event.turn === turn
      ? { ...event, sources: mergeCitations(event.sources, citations) }
      : event
  )
}

function applyEvent(
  events: TimelineEvent[],
  event: SessionEvent,
  isLive: boolean,
  citationsByTurn: Record<string, CitationItem[]>
): TimelineEvent[] {
  switch (event.type) {
    case "session_init":
    case "tool_call_progress":
    case "usage_update":
    case "skill_invoked":
    case "subagent_started":
    case "subagent_status_changed":
    case "subagent_result":
      return events

    case "user_message":
      return upsert(events, event.client_msg_id, () => ({
        id: event.client_msg_id,
        kind: "user_message",
        text: contentPartsToMarkdown(event.content),
        copyText: contentPartsToText(event.content),
        content: event.content,
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
        sources:
          citationsByTurn[event.turn] ??
          (existing?.kind === "assistant_text" ? existing.sources : undefined),
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
      {
        const presentation = getToolPresentation(event.tool)
        return upsert(dropThinking(events), event.call_id, () => ({
          id: event.call_id,
          kind: "tool_result",
          tool: event.tool.native_name,
          title: presentation.label,
          iconName: presentation.icon,
          status: "running",
          resultKind: toolResultKind(event.tool.canonical),
          output: "",
        }))
      }

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
                iconName: "custom",
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

    case "hydrate_subagents": {
      const subagents = { ...state.subagents }
      for (const record of action.records) {
        // Live/replayed events have fresher sequence ordering than the REST
        // snapshot. Do not let a slower request overwrite those records.
        if (!subagents[record.thread_id]) subagents[record.thread_id] = record
      }
      return { ...state, subagents }
    }

    case "apply_event": {
      const event = action.event
      const startedTool =
        event.type === "tool_call_completed"
          ? state.toolStarts[event.call_id]
          : undefined
      const citations =
        event.type === "tool_call_completed" && startedTool
          ? citationItemsFromTool(
              {
                canonical: startedTool.canonical,
                nativeName: startedTool.name,
              },
              startedTool.input,
              event.output
            )
          : []
      const citationsByTurn = citations.length
        ? {
            ...state.citationsByTurn,
            [event.turn]: mergeCitations(
              state.citationsByTurn[event.turn],
              citations
            ),
          }
        : state.citationsByTurn
      let events = applyEvent(
        state.events,
        event,
        action.isLive,
        citationsByTurn
      )
      if (citations.length) {
        events = withTurnCitations(events, event.turn, citations)
      }
      const subagents = applyMentionedSubagentNames(
        applySubagentEvent(state.subagents, event),
        events
      )
      const subagentMessages =
        event.type === "subagent_result"
          ? applySubagentResult(state.subagentMessages, event)
          : state.subagentMessages
      const turnEnded =
        event.type === "turn_completed" || event.type === "session_closed"
      const busy = turnEnded ? false : state.busy
      const turnStartedAt = turnEnded ? null : state.turnStartedAt
      const model =
        event.type === "session_init" && event.model ? event.model : state.model
      const toolStarts = { ...state.toolStarts }
      let insights = state.insights

      if (event.type === "tool_call_requested") {
        toolStarts[event.call_id] = {
          name: event.tool.native_name,
          startedAt: event.ts,
          canonical: event.tool.canonical,
          input: event.input,
        }
      } else if (event.type === "tool_call_completed") {
        const started = toolStarts[event.call_id]
        delete toolStarts[event.call_id]
        if (started) {
          const durationSeconds =
            (Date.parse(event.ts) - Date.parse(started.startedAt)) / 1000
          if (
            Number.isFinite(durationSeconds) &&
            durationSeconds >= 0 &&
            (!insights.longestTool ||
              durationSeconds > insights.longestTool.durationSeconds)
          ) {
            insights = {
              ...insights,
              longestTool: {
                name: started.name,
                durationSeconds: Math.round(durationSeconds),
              },
            }
          }
        }
      }

      const costByTurn = { ...state.costByTurn }
      if (event.type === "usage_update") {
        // Usage updates carry a complete total for their turn. Store the
        // latest value so a streaming adapter cannot double-count a turn.
        costByTurn[event.turn] = event.cost_usd
      }
      const costs = Object.values(costByTurn)
      const sessionCostUsd = costs.some((cost) => cost !== null)
        ? costs.reduce<number>((total, cost) => total + (cost ?? 0), 0)
        : null
      insights = { ...insights, sessionCostUsd }
      const usage: SessionUsage | null =
        event.type === "usage_update"
          ? {
              input_tokens: event.input_tokens,
              output_tokens: event.output_tokens,
              cache_creation_input_tokens: event.cache_creation_input_tokens,
              cache_read_input_tokens: event.cache_read_input_tokens,
              cost_usd: event.cost_usd,
            }
          : state.usage
      return {
        events,
        busy,
        turnStartedAt,
        model,
        usage,
        insights,
        toolStarts,
        citationsByTurn,
        costByTurn,
        subagents,
        subagentMessages,
      }
    }

    case "append_subagent_message":
      return {
        ...state,
        subagentMessages: {
          ...state.subagentMessages,
          [action.threadId]: [
            ...(state.subagentMessages[action.threadId] ?? []),
            action.message,
          ],
        },
      }

    case "append_user_message":
      return {
        ...state,
        events: [
          ...state.events,
          {
            id: action.id,
            kind: "user_message",
            text: contentPartsToMarkdown(action.content),
            copyText: action.text,
            content: action.content,
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
