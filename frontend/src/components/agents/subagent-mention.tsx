import { Bot } from "lucide-react"
import type { SubagentStatus } from "@/lib/orchd"
import { subagentTone } from "@/lib/subagent"
import { cn } from "@/lib/utils"

export interface SubagentMentionProps {
  threadId: string
  name: string
  status?: SubagentStatus
  onOpen?: (threadId: string) => void
  className?: string
}

export function SubagentMention({
  threadId,
  name,
  status,
  onOpen,
  className,
}: SubagentMentionProps) {
  const interactive = Boolean(onOpen)
  const content = (
    <>
      <Bot className="size-3 shrink-0" />
      <span className="min-w-0 truncate">{name}</span>
    </>
  )
  const classNames = cn(
    "not-typeset mx-0.5 inline-flex max-w-full translate-y-0.5 items-center gap-1 rounded-md px-1.5 py-0.5 align-baseline text-[0.85em] leading-none transition-colors",
    subagentTone(status ?? "running"),
    interactive &&
      "cursor-pointer hover:brightness-110 active:scale-[0.98]",
    className
  )

  if (!interactive) {
    return (
      <span className={classNames} title={`Subagent ${threadId}`}>
        {content}
      </span>
    )
  }

  return (
    <button
      type="button"
      title={`Open ${name}`}
      aria-label={`Open subagent ${name}`}
      onClick={() => onOpen?.(threadId)}
      className={classNames}
    >
      {content}
    </button>
  )
}
