"use client"

import { Sparkles } from "lucide-react"
import { cn } from "@/lib/utils"

export interface SkillMentionProps {
  name: string
  className?: string
}

export function SkillMention({ name, className }: SkillMentionProps) {
  return (
    <span
      className={cn(
        "not-typeset mx-0.5 inline-flex max-w-full translate-y-0.5 items-center gap-1 rounded-md border border-sky-500/30 bg-sky-500/10 px-1.5 py-0.5 align-baseline font-mono text-[0.85em] leading-none text-sky-700 transition-colors dark:border-sky-400/30 dark:bg-sky-400/10 dark:text-sky-300",
        className
      )}
      title={`Invoke ${name}`}
    >
      <Sparkles className="size-3 shrink-0" />
      <span className="min-w-0 truncate">/{name}</span>
    </span>
  )
}
