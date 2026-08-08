"use client"

import { ChevronRight } from "lucide-react"
import { type ReactNode, useEffect, useRef, useState } from "react"
import { WorkingIndicator } from "@/components/agents/loading-states/working-indicator"
import { formatDuration } from "@/lib/format-duration"
import { cn } from "@/lib/utils"

export interface TurnWorkProps {
  status: "working" | "complete"
  startedAt?: string
  // Frozen duration once complete.
  seconds?: number
  children: ReactNode
}

// A turn's thinking, tool calls and prompts, tucked behind one line.
// Expanded while in progress so live work stays visible, collapsed the
// instant it finishes. No motion by design: this is a status line.
export function TurnWork({
  status,
  startedAt,
  seconds,
  children,
}: TurnWorkProps) {
  const working = status === "working"
  const [open, setOpen] = useState(false)
  const wasWorking = useRef(working)

  useEffect(() => {
    if (wasWorking.current && !working) setOpen(false)
    wasWorking.current = working
  }, [working])

  const expanded = working || open

  return (
    <div className="w-full text-xs">
      {working ? (
        <div role="status" className="flex h-6 items-center">
          <WorkingIndicator startedAt={startedAt}>Working</WorkingIndicator>
        </div>
      ) : (
        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => setOpen((v) => !v)}
          className="flex h-6 items-center gap-1 text-muted-foreground transition-colors hover:text-foreground"
        >
          <ChevronRight
            className={cn("size-3.5 shrink-0", expanded && "rotate-90")}
          />
          <span>
            Worked
            {seconds !== undefined ? ` for ${formatDuration(seconds)}` : ""}
          </span>
        </button>
      )}
      {expanded ? <div className="space-y-0.5 py-1.5">{children}</div> : null}
    </div>
  )
}
