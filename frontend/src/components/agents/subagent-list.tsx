import { Bot, Users } from "lucide-react"
import { Button } from "@/components/ui/button"
import type { SubagentRecord } from "@/lib/orchd"
import { subagentLabel, subagentTone } from "@/lib/subagent"
import { cn } from "@/lib/utils"

interface SubagentListProps {
  subagents: SubagentRecord[]
  onInspect: (threadId: string) => void
}

export function SubagentList({ subagents, onInspect }: SubagentListProps) {
  return (
    <div className="min-h-0 overflow-y-auto p-2">
      {subagents.length > 0 ? (
        <div className="space-y-0.5">
          {subagents.map((agent) => (
            <Button
              key={agent.thread_id}
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => onInspect(agent.thread_id)}
              className="h-auto w-full justify-start gap-3 rounded-xl px-2.5 py-2 text-left"
            >
              <span
                className={cn(
                  "grid size-8 shrink-0 place-items-center rounded-lg",
                  subagentTone(agent.status)
                )}
              >
                <Bot className="size-4" aria-hidden="true" />
              </span>
              <span className="min-w-0 truncate text-sm font-medium">
                {subagentLabel(agent)}
              </span>
            </Button>
          ))}
        </div>
      ) : (
        <p className="px-2 py-8 text-center text-xs leading-5 text-muted-foreground">
          No subagents yet.
        </p>
      )}
    </div>
  )
}
