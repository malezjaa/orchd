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
      return "bg-sky-500/10 text-sky-600 dark:text-sky-300"
    case "pending":
      return "bg-amber-500/10 text-amber-600 dark:text-amber-300"
    case "completed":
      return "bg-emerald-500/10 text-emerald-600 dark:text-emerald-300"
    case "errored":
    case "not_found":
      return "bg-rose-500/10 text-rose-600 dark:text-rose-300"
    case "interrupted":
    case "shutdown":
      return "bg-muted text-muted-foreground"
  }
}
