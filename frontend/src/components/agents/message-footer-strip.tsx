"use client"
// beui.dev/components/agents/message-footer-strip

import { Check, Copy } from "lucide-react"
import { motion, useReducedMotion } from "motion/react"
import { useCallback, useEffect, useRef, useState } from "react"
import { EASE_OUT, SPRING_PRESS } from "@/lib/ease"
import { resolveTimeFormat, type TimeFormat } from "@/lib/appearance"
import { useSettings } from "@/lib/queries"
import { cn } from "@/lib/utils"

export interface MessageFooterStripProps {
  // Plain-text value copied by the built-in copy action.
  copyText: string
  // ISO timestamp shown once the message is sent or finished streaming.
  timestamp?: string
  align?: "start" | "end"
  className?: string
}

function formatTime(iso: string, format: TimeFormat) {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return null
  return date.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
    hour12: format === "12h",
  })
}

// A thin hover strip beneath a message: hovering reveals a copy action and the
// message's timestamp, kept out of the way otherwise.
export function MessageFooterStrip({
  copyText,
  timestamp,
  align = "start",
  className,
}: MessageFooterStripProps) {
  const reduce = useReducedMotion() ?? false
  const [copied, setCopied] = useState(false)
  const copyTimer = useRef<number | undefined>(undefined)
  const { data: settings } = useSettings()
  const timeFormat = resolveTimeFormat(settings?.time_format)
  const time = timestamp ? formatTime(timestamp, timeFormat) : null

  useEffect(
    () => () => {
      if (copyTimer.current) window.clearTimeout(copyTimer.current)
    },
    []
  )

  const handleCopy = useCallback(async () => {
    await navigator.clipboard?.writeText(copyText)
    setCopied(true)
    if (copyTimer.current) window.clearTimeout(copyTimer.current)
    copyTimer.current = window.setTimeout(() => setCopied(false), 1600)
  }, [copyText])

  return (
    <motion.div
      data-slot="message-footer-strip"
      initial="rest"
      whileHover="hover"
      animate={copied ? "hover" : "rest"}
      className={cn(
        "flex h-4 w-full items-center px-1",
        align === "end" ? "justify-end" : "justify-start",
        className
      )}
    >
      <motion.div
        variants={{
          rest: { opacity: 0, y: reduce ? 0 : -2 },
          hover: { opacity: 1, y: 0 },
        }}
        transition={{ duration: reduce ? 0.1 : 0.16, ease: EASE_OUT }}
        className={cn(
          "flex items-center gap-1.5 text-[11px] text-muted-foreground",
          align === "end" ? "flex-row-reverse" : "flex-row"
        )}
      >
        <motion.button
          type="button"
          aria-label={copied ? "Copied" : "Copy message"}
          title={copied ? "Copied" : "Copy message"}
          onClick={handleCopy}
          whileTap={reduce ? undefined : { scale: 0.9 }}
          transition={SPRING_PRESS}
          className="grid size-5 place-items-center rounded-md transition-colors outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
        >
          {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
        </motion.button>
        {time ? <span className="tabular-nums">{time}</span> : null}
      </motion.div>
    </motion.div>
  )
}
