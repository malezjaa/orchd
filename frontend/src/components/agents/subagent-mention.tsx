import { Bot } from "lucide-react"
import { cn } from "@/lib/utils"

export interface SubagentMentionProps {
  threadId: string
  name: string
  onOpen?: (threadId: string) => void
  className?: string
}

export function SubagentMention({
  threadId,
  name,
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
    "not-typeset mx-0.5 inline-flex max-w-full translate-y-0.5 items-center gap-1 rounded-md border border-sky-500/30 bg-sky-500/10 px-1.5 py-0.5 align-baseline text-[0.85em] leading-none text-sky-700 transition-colors dark:border-sky-400/30 dark:bg-sky-400/10 dark:text-sky-300",
    interactive &&
      "cursor-pointer hover:border-sky-500/50 hover:bg-sky-500/15 hover:text-sky-800 active:scale-[0.98] dark:hover:border-sky-400/50 dark:hover:bg-sky-400/15 dark:hover:text-sky-200",
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
