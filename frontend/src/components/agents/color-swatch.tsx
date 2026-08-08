"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { cn } from "@/lib/utils"

export interface ColorSwatchProps {
  color: string
  className?: string
}

export function ColorSwatch({ color, className }: ColorSwatchProps) {
  const [copied, setCopied] = useState(false)
  const timer = useRef<number | undefined>(undefined)

  useEffect(
    () => () => {
      if (timer.current) window.clearTimeout(timer.current)
    },
    []
  )

  const handleClick = useCallback(async () => {
    await navigator.clipboard?.writeText(color)
    setCopied(true)
    if (timer.current) window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setCopied(false), 1600)
  }, [color])

  return (
    <button
      type="button"
      title={copied ? "Copied" : `Click to copy ${color}`}
      onClick={handleClick}
      className={cn(
        "not-typeset mx-0.5 inline-flex translate-y-[2px] items-center gap-1.5 rounded-md border border-border bg-muted/60 px-1.5 py-0.5 align-baseline font-mono text-[0.85em] leading-none text-foreground/80 transition-colors hover:bg-muted hover:text-foreground",
        className
      )}
    >
      <span
        aria-hidden="true"
        className="size-3 shrink-0 rounded-[3px] border border-black/10 dark:border-white/15"
        style={{ backgroundColor: color }}
      />
      <span className="min-w-0 truncate">{copied ? "Copied" : color}</span>
    </button>
  )
}
