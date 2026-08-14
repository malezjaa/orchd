import {
  CircleAlert,
  CircleCheck,
  CircleDashed,
  CircleStop,
  LoaderCircle,
  Power,
  SearchX,
  type LucideIcon,
} from "lucide-react"
import type { SubagentRecord, SubagentStatus } from "@/lib/orchd"

export function subagentLabel(agent: SubagentRecord): string {
  if (agent.nickname) return agent.nickname
  const bold = /^\s*\*\*([^*]+)\*\*/.exec(agent.prompt ?? "")
  return (
    bold?.[1]?.trim() || agent.role || `Agent ${agent.thread_id.slice(0, 8)}`
  )
}

export function subagentTone(status: SubagentStatus): string {
  switch (status) {
    case "running":
      return "bg-sky-500/10 text-sky-600 ring-1 ring-inset ring-sky-500/20 dark:text-sky-300"
    case "pending":
      return "bg-amber-500/10 text-amber-600 ring-1 ring-inset ring-amber-500/20 dark:text-amber-300"
    case "completed":
      return "bg-emerald-500/10 text-emerald-600 ring-1 ring-inset ring-emerald-500/20 dark:text-emerald-300"
    case "errored":
    case "not_found":
      return "bg-rose-500/10 text-rose-600 ring-1 ring-inset ring-rose-500/20 dark:text-rose-300"
    case "interrupted":
    case "shutdown":
      return "bg-muted text-muted-foreground ring-1 ring-inset ring-border/70"
  }
}

export function subagentStatusLabel(status: SubagentStatus): string {
  switch (status) {
    case "pending":
      return "Pending"
    case "running":
      return "Running"
    case "completed":
      return "Completed"
    case "errored":
      return "Failed"
    case "not_found":
      return "Not found"
    case "interrupted":
      return "Interrupted"
    case "shutdown":
      return "Shut down"
  }
}

export function subagentStatusDescription(status: SubagentStatus): string {
  switch (status) {
    case "pending":
      return "Waiting to start."
    case "running":
      return "Working on the assigned task."
    case "completed":
      return "The child thread finished."
    case "errored":
      return "The child thread stopped with an error."
    case "not_found":
      return "The child thread could not be found."
    case "interrupted":
      return "The child thread was interrupted."
    case "shutdown":
      return "The child thread is shut down."
  }
}

export function subagentStatusIcon(status: SubagentStatus): LucideIcon {
  switch (status) {
    case "pending":
      return CircleDashed
    case "running":
      return LoaderCircle
    case "completed":
      return CircleCheck
    case "errored":
      return CircleAlert
    case "not_found":
      return SearchX
    case "interrupted":
      return CircleStop
    case "shutdown":
      return Power
  }
}
