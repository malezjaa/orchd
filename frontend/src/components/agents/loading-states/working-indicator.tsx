import type { ReactNode } from "react"
import { formatDuration } from "@/lib/format-duration"
import { useElapsedSeconds } from "@/lib/hooks/use-elapsed-seconds"
import { cn } from "@/lib/utils"

export interface WorkingIndicatorProps {
  children?: ReactNode
  // ISO timestamp the count starts from. Defaults to mount time, so pass this
  // when the work being timed may predate the indicator itself.
  startedAt?: string
  className?: string
}

// A live "N seconds and counting" readout, mounted for as long as the agent is
// actively working. Static and muted on purpose, since this is scaffolding
// around the eventual report, not the content itself.
export function WorkingIndicator({
  children = "Working",
  startedAt,
  className,
}: WorkingIndicatorProps) {
  const seconds = useElapsedSeconds(
    startedAt ? new Date(startedAt).getTime() : undefined
  )

  return (
    <span className={cn("text-xs text-muted-foreground", className)}>
      {children} <span className="tabular-nums">{formatDuration(seconds)}</span>
    </span>
  )
}
