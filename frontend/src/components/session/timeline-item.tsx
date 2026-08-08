import { type ReactNode, useEffect, useRef, useState } from "react"
import { AgentActivity } from "@/components/agents/agent-activity"
import { AgentMarkdown } from "@/components/agents/agent-markdown"
import { CodeBlock } from "@/components/agents/code-block"
import { FileDiff } from "@/components/agents/file-diff"
import { Message, MessageContent } from "@/components/agents/message"
import {
  MessageBubble,
  MessageBubbleContent,
} from "@/components/agents/message-bubble"
import { MessageFooterStrip } from "@/components/agents/message-footer-strip"
import { StreamingResponse } from "@/components/agents/streaming-response"
import { TodoList } from "@/components/agents/todo-list"
import { ToolApproval } from "@/components/agents/tool-approval"
import { ToolResult, ToolResultOutput } from "@/components/agents/tool-result"
import type { TimelineEvent } from "@/lib/timeline"

export interface TimelineItemProps {
  event: TimelineEvent
  // Only the turn's last text segment gets the footer, so it doesn't
  // repeat on every segment split out by tool calls.
  showFooter?: boolean
  onApprove?: (id: string) => void
  onAlwaysAllow?: (id: string) => void
  onDeny?: (id: string) => void
}

// Deltas arrive in coarse, uneven bursts, so rather than mirroring `text`
// this catches up to it within roughly `catchUpMs`: a burst reads as a
// quick type-in, and the display never drifts far behind the source.
//
// Deliberately ignores whether the turn has finished. `turn_completed`
// lands right as the last chunk arrives, so snapping on "not streaming"
// would cut the reveal short on exactly the chunk this exists to smooth.
// Nothing is lost by ignoring it: `text` only grows while streaming.
//
// `live` gates the reveal entirely, since replayed history arrives as a
// burst of deltas too and should not re-typewriter on every open.
function useStreamedText(text: string, live: boolean): string {
  const catchUpMs = 260
  const [display, setDisplay] = useState(text)
  const displayRef = useRef(text)
  const targetRef = useRef(text)
  const frameRef = useRef<number | null>(null)
  const lastTickRef = useRef(0)

  targetRef.current = text

  useEffect(() => {
    if (!live) {
      if (displayRef.current === text) return
      displayRef.current = text
      setDisplay(text)
      return
    }
    if (displayRef.current.length >= text.length) return
    if (frameRef.current !== null) return

    const tick = (now: number) => {
      const target = targetRef.current
      const shown = displayRef.current
      if (shown.length >= target.length) {
        frameRef.current = null
        return
      }
      const dt = lastTickRef.current ? now - lastTickRef.current : 16
      lastTickRef.current = now
      const remaining = target.length - shown.length
      const nextLen = Math.min(
        target.length,
        shown.length + Math.max(1, Math.ceil((remaining / catchUpMs) * dt))
      )
      displayRef.current = target.slice(0, nextLen)
      setDisplay(displayRef.current)
      frameRef.current = requestAnimationFrame(tick)
    }
    lastTickRef.current = 0
    frameRef.current = requestAnimationFrame(tick)
  }, [text])

  useEffect(() => {
    return () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current)
    }
  }, [])

  return display
}

function UserRow({ children }: { children: ReactNode }) {
  return (
    <Message from="user" animateIn>
      <MessageContent>{children}</MessageContent>
    </Message>
  )
}

export function TimelineItem({
  event,
  showFooter = true,
  onApprove,
  onAlwaysAllow,
  onDeny,
}: TimelineItemProps) {
  const displayText = useStreamedText(
    event.kind === "assistant_text" ? event.text : "",
    event.kind === "assistant_text" ? (event.live ?? false) : false
  )

  switch (event.kind) {
    case "user_message":
      return (
        <UserRow>
          <MessageBubble variant="soft">
            <MessageBubbleContent>{event.text}</MessageBubbleContent>
          </MessageBubble>
          <MessageFooterStrip
            copyText={event.text}
            timestamp={event.ts}
            align="end"
          />
        </UserRow>
      )

    case "assistant_text":
      return (
        <div className="flex w-full flex-col">
          <StreamingResponse
            status={event.streaming ? "streaming" : "complete"}
            showActions={!event.streaming}
            sources={event.sources}
          >
            {/* The reveal can still be catching up after `streaming`
            flips false, so keep the incomplete-markdown patching on
            until `displayText` is no longer a truncated prefix. */}
            <AgentMarkdown
              streaming={
                event.streaming || displayText.length < event.text.length
              }
            >
              {displayText}
            </AgentMarkdown>
          </StreamingResponse>
          {!event.streaming && showFooter ? (
            <MessageFooterStrip
              copyText={event.text}
              timestamp={event.ts}
              align="start"
            />
          ) : null}
        </div>
      )

    case "thinking":
      // Purely a signal to the reducer. The visible indicator is the
      // `TurnWork` wrapper, which survives tool calls instead of
      // disappearing at the first one.
      return null

    case "activity":
      return (
        <AgentActivity
          status={event.status}
          duration={event.duration}
          items={event.items}
        />
      )

    case "todo":
      return (
        <TodoList
          title={event.title}
          items={event.items}
          defaultOpen
          collapseOnComplete={false}
        />
      )

    case "permission":
      return (
        <ToolApproval
          tool={event.tool}
          title={event.title}
          description={event.description}
          parameters={event.parameters}
          status={event.status}
          defaultOpen
          onApprove={() => onApprove?.(event.id)}
          onAlwaysAllow={() => onAlwaysAllow?.(event.id)}
          onDeny={() => onDeny?.(event.id)}
        />
      )

    case "tool_result":
      return (
        <ToolResult
          tool={event.tool}
          title={event.title}
          status={event.status}
          kind={event.resultKind}
          meta={event.meta}
          defaultOpen={false}
          collapseOnComplete={false}
        >
          <ToolResultOutput>{event.output}</ToolResultOutput>
        </ToolResult>
      )

    case "file_diff":
      return (
        <FileDiff
          file={event.file}
          lines={event.lines}
          status={event.status}
          language="text"
          defaultOpen
          collapseOnComplete={false}
        />
      )

    case "code":
      return (
        <CodeBlock
          code={event.code}
          language={event.language}
          filename={event.filename}
          status={event.status}
        />
      )
  }
}
