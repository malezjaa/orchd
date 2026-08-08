"use client"
// beui.dev/components/blocks/command-palette

import { motion, useReducedMotion } from "motion/react"
import { Search } from "lucide-react"
import {
  type ComponentType,
  type ReactNode,
  type SVGProps,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react"
import { createPortal } from "react-dom"
import { EASE_OUT } from "@/lib/ease"
import { cn } from "@/lib/utils"

export type CommandItem = {
  id: string
  label: string
  // Secondary line rendered under the label, e.g. a full path.
  description?: ReactNode
  group?: string
  hint?: string
  keywords?: string[]
  icon?: ComponentType<SVGProps<SVGSVGElement>>
  badge?: ReactNode
  // Runs onSelect but leaves the palette open, for drilling into a submenu
  // instead of completing the flow.
  keepOpen?: boolean
  disabled?: boolean
  onSelect: () => void
}

export interface CommandPaletteProps {
  items: CommandItem[]
  // Opens with Cmd/Ctrl + this key. Default "k". `null` skips the global
  // hotkey so unrelated palettes mounted elsewhere don't all toggle on the
  // same keystroke.
  shortcut?: string | null
  placeholder?: string
  emptyMessage?: string
  open?: boolean
  onOpenChange?: (open: boolean) => void
  // Controlled search text, so a multi-step flow can reset or prefill the
  // query when it swaps the item list without remounting the palette.
  query?: string
  onQueryChange?: (query: string) => void
}

function fuzzyMatch(needle: string, hay: string) {
  if (!needle) return true
  needle = needle.toLowerCase()
  hay = hay.toLowerCase()
  let i = 0
  for (const ch of hay) {
    if (ch === needle[i]) i++
    if (i === needle.length) return true
  }
  return false
}

// Opened by keyboard many times a day, so the entrance must read as instant.
// Tight spring, even faster exit.
const PANEL_SPRING = {
  type: "spring",
  stiffness: 560,
  damping: 40,
  mass: 0.5,
} as const

export function CommandPalette({
  items,
  shortcut = "k",
  placeholder = "Type a command or search…",
  emptyMessage = "No results found.",
  open: controlledOpen,
  onOpenChange,
  query: controlledQuery,
  onQueryChange,
}: CommandPaletteProps) {
  const [internalOpen, setInternalOpen] = useState(false)
  const controlled = controlledOpen !== undefined
  const open = controlled ? controlledOpen : internalOpen
  const setOpen = useCallback(
    (v: boolean) => {
      if (!controlled) setInternalOpen(v)
      onOpenChange?.(v)
    },
    [controlled, onOpenChange]
  )

  const [internalQuery, setInternalQuery] = useState("")
  const queryControlled = controlledQuery !== undefined
  const query = queryControlled ? controlledQuery : internalQuery
  const [active, setActive] = useState(0)
  // Portal target only exists client-side; render nothing during SSR/hydration.
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  const uid = useId()
  const reduce = useReducedMotion()
  const updateQuery = useCallback(
    (value: string) => {
      if (!queryControlled) setInternalQuery(value)
      onQueryChange?.(value)
    },
    [queryControlled, onQueryChange]
  )
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  // Any query change, typed locally or pushed in by a controlling parent,
  // lands back on the first result. Adjusted during render, not an effect,
  // per https://react.dev/learn/you-might-not-need-an-effect.
  const [prevQuery, setPrevQuery] = useState(query)
  if (query !== prevQuery) {
    setPrevQuery(query)
    setActive(0)
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (
        shortcut &&
        (e.metaKey || e.ctrlKey) &&
        e.key.toLowerCase() === shortcut.toLowerCase()
      ) {
        e.preventDefault()
        setOpen(!open)
        return
      }
      if (e.key === "Escape" && open) {
        e.preventDefault()
        setOpen(false)
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [open, shortcut, setOpen])

  useEffect(() => {
    if (open) {
      updateQuery("")
      setActive(0)
      requestAnimationFrame(() => inputRef.current?.focus())
    }
  }, [open, updateQuery])

  useEffect(() => {
    if (!open) return
    const root = document.documentElement
    const previousRootOverflow = root.style.overflow
    const previousBodyOverflow = document.body.style.overflow
    root.style.overflow = "hidden"
    document.body.style.overflow = "hidden"
    return () => {
      root.style.overflow = previousRootOverflow
      document.body.style.overflow = previousBodyOverflow
    }
  }, [open])

  const filtered = useMemo(() => {
    if (!query) return items
    return items.filter((it) => {
      const haystacks = [it.label, it.group ?? "", ...(it.keywords ?? [])]
      return haystacks.some((h) => fuzzyMatch(query, h))
    })
  }, [items, query])

  // Reserve the icon column only when at least one item brings an icon, so
  // icon-less lists don't render a dead gap before every label.
  const hasIcons = useMemo(() => items.some((it) => it.icon), [items])

  const grouped = useMemo(() => {
    const map = new Map<string, CommandItem[]>()
    filtered.forEach((it) => {
      const g = it.group ?? "Results"
      const groupItems = map.get(g) ?? []
      groupItems.push(it)
      map.set(g, groupItems)
    })
    return Array.from(map.entries())
  }, [filtered])

  const nextEnabledIndex = (from: number, dir: 1 | -1) => {
    let i = from
    for (let step = 0; step < filtered.length; step++) {
      i += dir
      if (i < 0 || i >= filtered.length) return from
      if (!filtered[i].disabled) return i
    }
    return from
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault()
      setActive((a) => nextEnabledIndex(a, 1))
    } else if (e.key === "ArrowUp") {
      e.preventDefault()
      setActive((a) => nextEnabledIndex(a, -1))
    } else if (e.key === "Enter") {
      e.preventDefault()
      const it = filtered[active]
      if (it && !it.disabled) {
        it.onSelect()
        if (!it.keepOpen) setOpen(false)
      }
    }
  }

  useEffect(() => {
    if (!open) return
    const el = listRef.current?.querySelector<HTMLButtonElement>(
      `[data-index="${active}"]`
    )
    el?.scrollIntoView({ block: "nearest" })
  }, [active, open])

  let cursor = 0

  if (!mounted) return null

  // Always-mounted container; pointer events fully disabled when closed so clicks
  // pass through to the page. Portaled to <body> so ancestors with transforms,
  // filters, or fixed positioning can't trap the overlay in their stacking context.
  return createPortal(
    <div
      aria-hidden={!open}
      inert={!open}
      className={cn(
        "fixed inset-0 z-[100]",
        open ? "pointer-events-auto" : "pointer-events-none"
      )}
    >
      <motion.button
        type="button"
        aria-label="Close command palette"
        initial={false}
        animate={{ opacity: open ? 1 : 0 }}
        transition={{ duration: open ? 0.18 : 0.12, ease: EASE_OUT }}
        onClick={() => setOpen(false)}
        className={cn(
          "absolute inset-0 bg-background/5 [backdrop-filter:blur(12px)_saturate(140%)] [-webkit-backdrop-filter:blur(12px)_saturate(140%)]",
          open ? "pointer-events-auto" : "pointer-events-none"
        )}
      />
      <div className="pointer-events-none absolute inset-0 flex items-start justify-center p-4 pt-[18vh]">
        <motion.div
          role="dialog"
          aria-modal="true"
          aria-label="Command palette"
          initial={false}
          animate={{
            opacity: open ? 1 : 0,
            y: open || reduce ? 0 : -8,
            scale: open || reduce ? 1 : 0.97,
          }}
          transition={
            reduce
              ? { duration: 0.1 }
              : open
                ? PANEL_SPRING
                : { duration: 0.12, ease: EASE_OUT }
          }
          onKeyDown={onKeyDown}
          className={cn(
            "w-full max-w-xl overflow-hidden rounded-2xl border border-border bg-card shadow-2xl will-change-transform",
            open ? "pointer-events-auto" : "pointer-events-none"
          )}
        >
          <div className="flex items-center gap-3 border-b border-border px-4">
            <Search className="h-4 w-4 text-muted-foreground" />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => updateQuery(e.target.value)}
              placeholder={placeholder}
              tabIndex={open ? 0 : -1}
              role="combobox"
              aria-expanded={open}
              aria-controls={`${uid}-list`}
              aria-activedescendant={
                filtered.length > 0 ? `${uid}-opt-${active}` : undefined
              }
              aria-autocomplete="list"
              className="h-12 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
            />
            <kbd className="hidden rounded border border-border bg-background px-1.5 py-0.5 text-[10px] text-muted-foreground sm:inline-block">
              ESC
            </kbd>
          </div>
          <div
            ref={listRef}
            id={`${uid}-list`}
            role="listbox"
            aria-label="Commands"
            className="max-h-[60vh] [scrollbar-width:none] overflow-y-auto overscroll-contain p-2 [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
          >
            {filtered.length === 0 ? (
              <div className="p-8 text-center text-sm text-muted-foreground">
                {emptyMessage}
              </div>
            ) : (
              grouped.map(([group, list]) => (
                <div key={group} className="mb-1 last:mb-0">
                  <div
                    aria-hidden
                    className="px-2 py-1.5 text-[10px] font-semibold tracking-wider text-muted-foreground uppercase"
                  >
                    {group}
                  </div>
                  {list.map((it) => {
                    const idx = cursor++
                    const isActive = idx === active
                    const Icon = it.icon
                    return (
                      <button
                        key={it.id}
                        type="button"
                        id={`${uid}-opt-${idx}`}
                        role="option"
                        aria-selected={isActive}
                        aria-disabled={it.disabled}
                        disabled={it.disabled}
                        data-index={idx}
                        onMouseEnter={() => {
                          if (!it.disabled) setActive(idx)
                        }}
                        onClick={() => {
                          if (it.disabled) return
                          it.onSelect()
                          if (!it.keepOpen) setOpen(false)
                        }}
                        tabIndex={open ? 0 : -1}
                        className={cn(
                          "relative isolate flex w-full items-center gap-3 rounded-md px-2 py-2 text-left text-sm transition-colors",
                          it.disabled
                            ? "cursor-not-allowed text-muted-foreground/50"
                            : isActive
                              ? "text-foreground"
                              : "text-muted-foreground"
                        )}
                      >
                        {isActive ? (
                          <motion.span
                            layoutId={`${uid}-active`}
                            className="absolute inset-0 z-0 rounded-md bg-primary/[0.05]"
                            transition={
                              reduce
                                ? { duration: 0 }
                                : // Tracks rapid arrow-key navigation, tighter than
                                  // SPRING_LAYOUT so it never lags the active row.
                                  {
                                    type: "spring",
                                    stiffness: 480,
                                    damping: 38,
                                  }
                            }
                          />
                        ) : null}
                        {Icon ? (
                          <Icon className="relative z-10 h-4 w-4" />
                        ) : hasIcons ? (
                          <span className="relative z-10 h-4 w-4" />
                        ) : null}
                        <span className="relative z-10 flex min-w-0 flex-1 flex-col">
                          <span className="truncate">{it.label}</span>
                          {it.description ? (
                            <span className="truncate text-xs text-muted-foreground">
                              {it.description}
                            </span>
                          ) : null}
                        </span>
                        {it.badge ? (
                          <span className="relative z-10 shrink-0">
                            {it.badge}
                          </span>
                        ) : null}
                        {it.hint ? (
                          <kbd className="relative z-10 rounded border border-border bg-background px-1.5 py-0.5 text-[10px] text-muted-foreground">
                            {it.hint}
                          </kbd>
                        ) : null}
                      </button>
                    )
                  })}
                </div>
              ))
            )}
          </div>
        </motion.div>
      </div>
    </div>,
    document.body
  )
}
