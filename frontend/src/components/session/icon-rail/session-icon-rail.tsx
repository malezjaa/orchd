import { useEffect, useRef, useState } from "react"
import { AnimatePresence, motion, useReducedMotion } from "motion/react"
import { Cpu, Files, GitBranch, Loader2, SquareTerminal } from "lucide-react"
import { TooltipIcon } from "@/components/tooltip-icon.tsx"
import { EASE_DRAWER } from "@/lib/ease.ts"
import { cn } from "@/lib/utils.ts"
import { basename } from "@/lib/orchd"
import { ProjectTreePanel } from "@/components/session/project-tree.tsx"
import { GitPanel } from "./git-panel.tsx"
import { ProcessesPanel } from "./processes-panel.tsx"
import { TerminalPanel } from "./terminal-panel.tsx"

function GithubIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
      aria-hidden="true"
    >
      <path d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.57.1.78-.25.78-.55 0-.27-.01-1.16-.02-2.11-3.2.7-3.87-1.36-3.87-1.36-.53-1.33-1.29-1.69-1.29-1.69-1.05-.72.08-.7.08-.7 1.17.08 1.78 1.2 1.78 1.2 1.03 1.77 2.71 1.26 3.37.96.1-.75.4-1.26.73-1.55-2.55-.29-5.24-1.28-5.24-5.68 0-1.26.45-2.28 1.19-3.08-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.18 1.18a11.1 11.1 0 0 1 5.79 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.11 3.05.74.8 1.19 1.82 1.19 3.08 0 4.41-2.69 5.38-5.25 5.67.41.36.78 1.06.78 2.14 0 1.54-.01 2.79-.01 3.17 0 .3.2.66.79.55A10.51 10.51 0 0 0 23.5 12C23.5 5.65 18.35.5 12 .5Z" />
    </svg>
  )
}

interface RailAction {
  id: string
  label: string
  icon: (props: { className?: string }) => React.ReactNode
  render: (sessionId: string | null, rootPath: string | null) => React.ReactNode
}

function DeferredGitPanel({ rootPath }: { rootPath: string }) {
  const [ready, setReady] = useState(false)

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => setReady(true))
    return () => window.cancelAnimationFrame(frame)
  }, [])

  if (!ready) {
    return (
      <div className="grid min-h-0 flex-1 place-items-center text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
      </div>
    )
  }

  return <GitPanel rootPath={rootPath} />
}

const RAIL_ACTIONS: RailAction[] = [
  {
    id: "files",
    label: "Files",
    icon: (p) => <Files className={p.className} />,
    render: (sessionId, rootPath) =>
      rootPath ? (
        <ProjectTreePanel
          key={sessionId ?? rootPath}
          rootPath={rootPath}
          title={basename(rootPath)}
        />
      ) : null,
  },
  {
    id: "git",
    label: "Git",
    icon: (p) => <GitBranch className={p.className} />,
    render: (_sessionId, rootPath) =>
      rootPath ? <DeferredGitPanel rootPath={rootPath} /> : null,
  },
  {
    id: "github",
    label: "GitHub",
    icon: (p) => <GithubIcon className={p.className} />,
    render: () => null,
  },
  {
    id: "terminal",
    label: "Terminal",
    icon: (p) => <SquareTerminal className={p.className} />,
    render: (sessionId) =>
      sessionId ? <TerminalPanel sessionId={sessionId} /> : null,
  },
  {
    id: "processes",
    label: "Processes",
    icon: (p) => <Cpu className={p.className} />,
    render: (sessionId) =>
      sessionId ? <ProcessesPanel sessionId={sessionId} /> : null,
  },
]

const PANEL_MIN_WIDTH = 200
const PANEL_MAX_WIDTH = 720
const PANEL_DEFAULT_WIDTH = 360
const PANEL_WIDTH_STORAGE_KEY = "session-panel:width"

function clampPanelWidth(width: number) {
  return Math.min(PANEL_MAX_WIDTH, Math.max(PANEL_MIN_WIDTH, width))
}

function getStoredPanelWidth() {
  const stored = window.localStorage.getItem(PANEL_WIDTH_STORAGE_KEY)
  const parsed = stored ? Number(stored) : Number.NaN
  return Number.isFinite(parsed) ? clampPanelWidth(parsed) : PANEL_DEFAULT_WIDTH
}

const PANEL_TRANSITION = {
  duration: 0.3,
  ease: EASE_DRAWER,
} as const

const PANEL_CLOSED = { width: 0, opacity: 0 }

export function SessionIconRail({
  sessionId,
  rootPath,
}: {
  sessionId: string | null
  rootPath: string | null
}) {
  const [active, setActive] = useState<string | null>("files")
  const [width, setWidthState] = useState(getStoredPanelWidth)
  const [resizing, setResizing] = useState(false)
  const reduce = useReducedMotion() ?? false

  const draggingRef = useRef(false)
  const startXRef = useRef(0)
  const startWidthRef = useRef(0)

  const handleClick = (id: string) =>
    setActive((current) => (current === id ? null : id))

  const activeAction = RAIL_ACTIONS.find((action) => action.id === active)

  const setWidth = (nextWidth: number) => {
    const clamped = clampPanelWidth(nextWidth)
    setWidthState(clamped)
    window.localStorage.setItem(PANEL_WIDTH_STORAGE_KEY, String(clamped))
  }

  const handleResizePointerDown = (
    event: React.PointerEvent<HTMLButtonElement>
  ) => {
    if (event.button !== 0) return
    draggingRef.current = true
    startXRef.current = event.clientX
    startWidthRef.current = width
    event.currentTarget.setPointerCapture(event.pointerId)
    setResizing(true)
    document.body.style.cursor = "col-resize"
    document.body.style.userSelect = "none"
  }

  const handleResizePointerMove = (
    event: React.PointerEvent<HTMLButtonElement>
  ) => {
    if (!draggingRef.current) return
    // Panel sits on the right edge, so dragging leftward grows it.
    const delta = startXRef.current - event.clientX
    setWidth(startWidthRef.current + delta)
  }

  const endResizeDrag = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (!draggingRef.current) return
    draggingRef.current = false
    setResizing(false)
    document.body.style.cursor = ""
    document.body.style.userSelect = ""
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }

  const panelTransition =
    reduce || resizing ? { duration: 0 } : PANEL_TRANSITION

  return (
    <div className="flex min-h-0 shrink-0">
      <AnimatePresence initial={false}>
        {activeAction ? (
          <motion.aside
            key={activeAction.id}
            aria-label={`${activeAction.label} panel`}
            initial={PANEL_CLOSED}
            animate={{ width, opacity: 1 }}
            exit={PANEL_CLOSED}
            transition={panelTransition}
            className={cn(
              "relative flex min-h-0 shrink-0 flex-col overflow-hidden bg-background"
            )}
          >
            <button
              type="button"
              aria-label={`Resize ${activeAction.label} panel`}
              tabIndex={-1}
              onPointerDown={handleResizePointerDown}
              onPointerMove={handleResizePointerMove}
              onPointerUp={endResizeDrag}
              onPointerCancel={endResizeDrag}
              className="absolute inset-y-0 left-0 z-20 w-1.5 cursor-col-resize outline-none after:absolute after:inset-y-0 after:left-1/2 after:w-px after:-translate-x-1/2 after:bg-transparent after:transition-colors hover:after:bg-border"
            />
            <div className="flex h-12 shrink-0 items-center gap-2.5 border-b border-l border-border px-4">
              <span
                aria-hidden="true"
                className="grid size-4 shrink-0 place-items-center text-muted-foreground"
              >
                {activeAction.icon({ className: "size-4" })}
              </span>
              <p className="text-xs font-medium text-foreground">
                {activeAction.label}
              </p>
            </div>
            <div className="grid min-h-0 flex-1 border-l border-border">
              {activeAction.render(sessionId, rootPath) ?? (
                <p
                  className="m-auto max-w-[200px] px-4 py-6 text-center text-xs text-muted-foreground"
                  id={`${activeAction.label}-panel`}
                >
                  {sessionId
                    ? `${activeAction.label} coming soon`
                    : "Available once the session is created"}
                </p>
              )}
            </div>
          </motion.aside>
        ) : null}
      </AnimatePresence>

      <aside
        aria-label="Session tools"
        className="flex w-11 shrink-0 flex-col items-center gap-1 border-l border-border py-3"
      >
        {RAIL_ACTIONS.map(({ id, label, icon }) => (
          <TooltipIcon
            key={id}
            label={label}
            active={active === id}
            onClick={() => handleClick(id)}
          >
            {icon({ className: "size-4" })}
          </TooltipIcon>
        ))}
      </aside>
    </div>
  )
}
