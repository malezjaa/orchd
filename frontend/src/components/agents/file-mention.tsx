"use client"

import { getFileIcon } from "@/lib/file-icon"
import { cn } from "@/lib/utils"

export interface FileMentionProps {
  path: string
  kind: "file" | "folder"
  className?: string
}

export function FileMention({ path, kind, className }: FileMentionProps) {
  const Icon = getFileIcon(path, kind === "folder")
  const label = path.split("/").filter(Boolean).pop() || path

  return (
    <button
      type="button"
      title={path}
      className={cn(
        "not-typeset mx-0.5 inline-flex max-w-full translate-y-[2px] items-center gap-1 rounded-md border border-border bg-muted/60 px-1.5 py-0.5 align-baseline font-mono text-[0.85em] leading-none text-foreground/80 transition-colors hover:bg-muted hover:text-foreground",
        className
      )}
    >
      <Icon
        aria-hidden="true"
        className="size-3 shrink-0 text-muted-foreground"
      />
      <span className="min-w-0 truncate">{label}</span>
    </button>
  )
}
