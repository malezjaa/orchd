"use client"

import { Image as ImageIcon } from "lucide-react"
import { useState } from "react"
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog"
import { cn } from "@/lib/utils"

export interface ImageMentionProps {
  src: string
  name?: string
  className?: string
}

/** A compact image reference. The source is only displayed in the lightbox. */
export function ImageMention({ src, name = "image", className }: ImageMentionProps) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <button
        type="button"
        title={`Open ${name}`}
        aria-label={`Open image ${name}`}
        onClick={() => setOpen(true)}
        className={cn(
          "not-typeset mx-0.5 inline-flex max-w-full translate-y-0.5 items-center gap-1 rounded-md border border-violet-500/30 bg-violet-500/10 px-1.5 py-0.5 align-baseline font-mono text-[0.85em] leading-none text-violet-700 transition-colors hover:border-violet-500/50 hover:bg-violet-500/15 hover:text-violet-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/40 active:scale-[0.98] dark:border-violet-400/30 dark:bg-violet-400/10 dark:text-violet-300 dark:hover:border-violet-400/50 dark:hover:bg-violet-400/15 dark:hover:text-violet-200",
          className
        )}
      >
        <ImageIcon className="size-3 shrink-0" />
        <span className="min-w-0 truncate">{name}</span>
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-5xl border-none bg-black/90 p-2">
          <DialogTitle className="sr-only">{name}</DialogTitle>
          <img
            src={src}
            alt={name}
            className="max-h-[85vh] w-full rounded-2xl object-contain"
          />
        </DialogContent>
      </Dialog>
    </>
  )
}
