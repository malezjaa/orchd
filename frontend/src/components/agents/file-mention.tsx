"use client"

import { cn } from "@/lib/utils"
import { getFileIcon } from "@/lib/file-icon.tsx"

export interface FileMentionProps {
  path: string
  kind: "file" | "folder"
  onOpen?: (path: string) => void
  className?: string
}

export function FileMention({
  path,
  kind,
  onOpen,
  className,
}: FileMentionProps) {
  const Icon = getFileIcon(path, kind === "folder")
  const label = path.split("/").filter(Boolean).pop() || path
  const interactive = Boolean(onOpen && kind === "file")
  const content = (
    <>
      <Icon className="size-3 shrink-0 text-muted-foreground" />
      <span className="min-w-0 truncate">{label}</span>
    </>
  )
  const classNames = cn(
    "not-typeset mx-0.5 inline-flex max-w-full translate-y-0.5 items-center gap-1 rounded-md border border-foreground/20 bg-muted/60 px-1.5 py-0.5 align-baseline font-mono text-[0.85em] leading-none text-foreground/80 transition-colors dark:border-foreground/25",
    interactive &&
      "cursor-pointer hover:border-foreground/35 hover:bg-muted hover:text-foreground active:scale-[0.98]",
    className
  )

  if (!interactive) {
    return (
      <span className={classNames} title={path}>
        {content}
      </span>
    )
  }

  return (
    <button
      type="button"
      title={path}
      aria-label={`Open ${path}`}
      onClick={() => onOpen?.(path)}
      className={classNames}
    >
      {content}
    </button>
  )
}
