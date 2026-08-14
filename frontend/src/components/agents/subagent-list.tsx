import { Users } from "lucide-react"
import { Button } from "@/components/ui/button"
import type { SubagentRecord } from "@/lib/orchd"
import {
  subagentLabel,
  subagentStatusIcon,
  subagentStatusLabel,
  subagentTone,
} from "@/lib/subagent"
import { cn } from "@/lib/utils"

interface SubagentListProps {
  subagents: SubagentRecord[]
  activeThreadId: string | null
  onInspect: (threadId: string) => void
}

export function SubagentList({
  subagents,
  activeThreadId,
  onInspect,
}: SubagentListProps) {
  return (
    <div className="min-h-0 overflow-y-auto p-2">
      {subagents.length > 0 ? (
        <div className="space-y-0.5">
          {subagents.map((agent) => {
            const name = subagentLabel(agent)
            const status = subagentStatusLabel(agent.status)
            const StatusIcon = subagentStatusIcon(agent.status)
            const active = activeThreadId === agent.thread_id

            return (
              <Button
                key={agent.thread_id}
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => onInspect(agent.thread_id)}
                aria-current={active ? "page" : undefined}
                aria-label={`Open ${name}, ${status}`}
                title={`${name} · ${status}`}
                className={cn(
                  "h-auto w-full justify-start gap-3 rounded-xl px-2.5 py-2 text-left",
                  active &&
                    "bg-muted/80 text-foreground ring-1 ring-border/80 hover:bg-muted"
                )}
              >
                <span
                  className={cn(
                    "grid size-8 shrink-0 place-items-center rounded-lg",
                    subagentTone(agent.status)
                  )}
                >
                  <StatusIcon className="size-4" aria-hidden="true" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">
                    {name}
                  </span>
                  <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
                    {status}
                  </span>
                </span>
              </Button>
            )
          })}
        </div>
      ) : (
        <div className="flex flex-col items-center gap-2 px-5 py-10 text-center">
          <Users
            className="size-5 text-muted-foreground/70"
            aria-hidden="true"
          />
          <p className="text-sm font-medium text-foreground">
            No subagents yet
          </p>
          <p className="text-xs leading-5 text-muted-foreground">
            They will appear here when the agent delegates work.
          </p>
        </div>
      )}
    </div>
  )
}
