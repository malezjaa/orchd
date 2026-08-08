// Groups a flat `TimelineEvent[]` into per-turn clusters: the user's
// message, the work tucked behind one "Worked for Ns" line, then the
// report. Turns are inferred from adjacency rather than a shared turn id
// because not every event kind carries one, and a user message always
// starts a new turn anyway.

import type {
  AssistantTextEvent,
  TimelineEvent,
  UserMessageEvent,
} from "@/lib/timeline"

export interface TimelineTurnGroup {
  key: string
  user?: UserMessageEvent
  // Thinking, tool calls, permission prompts, diffs.
  work: TimelineEvent[]
  texts: AssistantTextEvent[]
}

export function groupTimelineByTurn(
  events: TimelineEvent[]
): TimelineTurnGroup[] {
  const groups: TimelineTurnGroup[] = []
  let current: TimelineTurnGroup | null = null

  for (const event of events) {
    if (event.kind === "user_message") {
      current = { key: event.id, user: event, work: [], texts: [] }
      groups.push(current)
      continue
    }
    if (!current) {
      current = { key: "leading", work: [], texts: [] }
      groups.push(current)
    }
    if (event.kind === "assistant_text") current.texts.push(event)
    else current.work.push(event)
  }

  return groups
}

// Derived from backend timestamps so a replayed turn reads the same as a
// live one. `undefined` when either end is missing.
export function turnDurationSeconds(
  group: TimelineTurnGroup
): number | undefined {
  const startTs = group.user?.ts
  const endTs = group.texts.at(-1)?.ts
  if (!startTs || !endTs) return undefined

  const seconds = (Date.parse(endTs) - Date.parse(startTs)) / 1000
  return Number.isFinite(seconds) ? Math.max(0, Math.round(seconds)) : undefined
}
