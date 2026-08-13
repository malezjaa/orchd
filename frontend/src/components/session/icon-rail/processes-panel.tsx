import { AnimatePresence, motion } from "motion/react"
import { useEffect, useRef, useState, type ReactNode } from "react"
import {
  CircleDot,
  Cpu,
  ChevronDown,
  FolderOpen,
  MemoryStick,
  Terminal,
} from "lucide-react"
import {
  Card,
  CardContent,
} from "@/components/ui/card"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { buttonVariants } from "@/components/ui/button"
import type { ProcessRecord, ProcessStatus } from "@/lib/orchd"
import { useSessionProcesses } from "@/lib/queries"
import { cn } from "@/lib/utils"

function formatBytes(bytes: number | null): string {
  if (bytes === null) return "—"
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${(bytes / (1024 * 1024)).toFixed(bytes >= 100 * 1024 * 1024 ? 0 : 1)} MB`
}

function statusLabel(status: ProcessStatus): string {
  switch (status) {
    case "running":
      return "Running"
    case "sleeping":
      return "Sleeping"
    case "stopped":
      return "Stopped"
    case "zombie":
      return "Zombie"
    default:
      return "Unknown"
  }
}

type ProcessActivity = "active" | "waiting" | "idle" | "stopped" | "zombie" | "unknown"

function activityLabel(activity: ProcessActivity): string {
  switch (activity) {
    case "active":
      return "Active"
    case "waiting":
      return "Waiting"
    case "idle":
      return "Idle"
    case "stopped":
      return "Stopped"
    case "zombie":
      return "Zombie"
    default:
      return "Unknown"
  }
}

function activityClassName(activity: ProcessActivity): string {
  switch (activity) {
    case "active":
      return "text-emerald-600 dark:text-emerald-400"
    case "waiting":
      return "text-sky-600 dark:text-sky-400"
    case "stopped":
      return "text-amber-600 dark:text-amber-400"
    case "zombie":
      return "text-rose-600 dark:text-rose-400"
    default:
      return "text-muted-foreground"
  }
}

function getActivity(
  process: ProcessRecord,
  sessionBusy: boolean,
  activePids: Set<number>
): ProcessActivity {
  if (process.status === "stopped") return "stopped"
  if (process.status === "zombie") return "zombie"
  if (process.status === "unknown") return "unknown"
  if (activePids.has(process.pid)) return "active"
  return sessionBusy ? "waiting" : "idle"
}

function ProcessRow({
  process,
  activity,
}: {
  process: ProcessRecord
  activity: ProcessActivity
}) {
  const [open, setOpen] = useState(false)
  const activityColor = activityClassName(activity)
  const location = process.path ?? process.executable ?? "Path unavailable"

  return (
    <motion.li
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -4 }}
      transition={{ duration: 0.16 }}
      className="group rounded-lg border border-transparent transition-colors hover:border-border"
    >
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger
          className={cn(
            buttonVariants({ variant: "ghost", size: "sm" }),
            "h-auto w-full justify-start rounded-lg px-2.5 py-2 text-left hover:bg-muted/45"
          )}
        >
          <span
            className={cn(
              "grid size-6 shrink-0 place-items-center rounded-md bg-muted/70",
              activityColor
            )}
            title={activityLabel(activity)}
          >
            {process.is_group_leader ? (
              <Terminal className="size-3.5 text-foreground" aria-hidden />
            ) : (
              <CircleDot className="size-3.5 text-foreground" aria-hidden />
            )}
            <span className="sr-only">{activityLabel(activity)}</span>
          </span>

          <span className="min-w-0 flex-1">
            <span className="block truncate text-[12px] font-medium text-foreground">
              {process.name}
            </span>
            <span className="mt-0.5 block truncate font-mono text-[10px] text-muted-foreground">
              PID {process.pid} · {formatBytes(process.memory_bytes)}
            </span>
          </span>

          <span
            className={cn(
              "w-16 shrink-0 self-center text-center text-[10px]",
              activityColor
            )}
          >
            {activityLabel(activity)}
          </span>

          <ChevronDown
            className={cn(
              "ml-1 size-3.5 shrink-0 text-muted-foreground transition-transform",
              open && "rotate-180"
            )}
            aria-hidden
          />
        </CollapsibleTrigger>

        <CollapsibleContent>
          <Card
            size="sm"
            className="mx-2 mb-2 rounded-lg border-border/60 bg-muted/20 py-0 shadow-none ring-0"
          >
            <CardContent className="grid gap-2 px-3 py-3">
              <ProcessDetail
                label="Activity"
                value={activityLabel(activity)}
              />
              <ProcessDetail
                label="Path"
                value={location}
                icon={<FolderOpen className="size-3" aria-hidden />}
                wrap
                code
              />
              <ProcessDetail
                label="Command"
                value={process.command ?? "Command unavailable"}
                mono
                wrap
                code
              />
              <ProcessDetail
                label="Executable"
                value={process.executable ?? "Executable unavailable"}
                mono
                wrap
                code
              />
              <div className="grid grid-cols-2 gap-2 border-t border-border/60 pt-2">
                <ProcessDetail label="PPID" value={String(process.ppid)} mono />
                <ProcessDetail label="PGID" value={String(process.pgid)} mono />
                <ProcessDetail
                  label="Kernel state"
                  value={`${statusLabel(process.status)} (${process.state})`}
                />
                <ProcessDetail
                  label="CPU ticks"
                  value={String(process.cpu_time_ticks)}
                  mono
                />
                <ProcessDetail
                  label="Role"
                  value={process.is_group_leader ? "Session leader" : "Child process"}
                />
              </div>
            </CardContent>
          </Card>
        </CollapsibleContent>
      </Collapsible>
    </motion.li>
  )
}

function ProcessDetail({
  label,
  value,
  icon,
  mono = false,
  wrap = false,
  code = false,
}: {
  label: string
  value: string
  icon?: ReactNode
  mono?: boolean
  wrap?: boolean
  code?: boolean
}) {
  return (
    <div className="min-w-0">
      <div className="flex items-center gap-1 text-[9px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
        {icon}
        <span>{label}</span>
      </div>
      <p
        className={cn(
          "mt-1 text-[10px] text-foreground/85",
          mono && "font-mono",
          code && "rounded-md border border-border/60 bg-muted/55 px-2 py-1.5",
          wrap
            ? "whitespace-pre-wrap break-words [overflow-wrap:anywhere]"
            : "truncate"
        )}
        title={value}
      >
        {code ? <code>{value}</code> : value}
      </p>
    </div>
  )
}

function ProcessSkeleton() {
  return (
    <div className="space-y-2 p-2" aria-label="Loading processes">
      {["w-4/5", "w-3/5", "w-2/3"].map((width) => (
        <div key={width} className="rounded-lg border border-border/60 p-3">
          <div className="flex gap-2.5">
            <div className="size-6 shrink-0 animate-pulse rounded-md bg-muted" />
            <div className="min-w-0 flex-1 space-y-2">
              <div className={cn("h-3 animate-pulse rounded bg-muted", width)} />
              <div className="h-2.5 w-1/2 animate-pulse rounded bg-muted" />
              <div className="h-2.5 w-4/5 animate-pulse rounded bg-muted" />
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}

export function ProcessesPanel({ sessionId }: { sessionId: string | null }) {
  const { data: inventory, isLoading, isError } =
    useSessionProcesses(sessionId)
  const processList = inventory?.processes ?? []
  const sessionBusy = inventory?.session_busy ?? false
  const previousCpuTicks = useRef(new Map<number, number>())
  const [activePids, setActivePids] = useState<Set<number>>(() => new Set())

  useEffect(() => {
    if (!inventory) return

    const nextActivePids = new Set<number>()
    const currentPids = new Set<number>()
    for (const process of inventory.processes) {
      currentPids.add(process.pid)
      const previous = previousCpuTicks.current.get(process.pid)
      if (previous !== undefined && process.cpu_time_ticks > previous) {
        nextActivePids.add(process.pid)
      }
      if (inventory.session_busy && process.is_group_leader) {
        nextActivePids.add(process.pid)
      }
      previousCpuTicks.current.set(process.pid, process.cpu_time_ticks)
    }
    for (const pid of previousCpuTicks.current.keys()) {
      if (!currentPids.has(pid)) previousCpuTicks.current.delete(pid)
    }
    setActivePids(nextActivePids)
  }, [inventory])

  const totalMemory = processList.reduce(
    (total, process) => total + (process.memory_bytes ?? 0),
    0
  )

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 border-b border-border/70 px-4 py-3">
        <Card
          size="sm"
          className="mt-3 rounded-lg border-border/70 bg-muted/20 py-0 shadow-none ring-0"
        >
          <CardContent className="grid grid-cols-2 divide-x divide-border/70 p-0">
            <div className="px-3 py-2">
              <p className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                Processes
              </p>
              <p className="mt-1 font-mono text-lg leading-none text-foreground">
                {processList.length}
              </p>
            </div>
            <div className="px-3 py-2">
              <p className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                RSS memory
              </p>
              <p className="mt-1 font-mono text-lg leading-none text-foreground">
                {formatBytes(totalMemory)}
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {isLoading ? <ProcessSkeleton /> : null}

        {!isLoading && isError ? (
          <div className="m-3 rounded-lg border border-rose-500/20 bg-rose-500/5 px-3 py-4 text-center">
            <Cpu className="mx-auto size-4 text-rose-500" aria-hidden />
            <p className="mt-2 text-xs font-medium text-foreground">
              Process data unavailable
            </p>
            <p className="mt-1 text-[11px] text-muted-foreground">
              The session may have ended. This panel will retry automatically.
            </p>
          </div>
        ) : null}

        {!isLoading && !isError && processList.length === 0 ? (
          <div className="grid min-h-[220px] place-items-center px-6 text-center">
            <div>
              <div className="mx-auto grid size-9 place-items-center rounded-lg border border-border/70 bg-muted/20 text-muted-foreground">
                <MemoryStick className="size-4" aria-hidden />
              </div>
              <p className="mt-3 text-xs font-medium text-foreground">
                No active processes
              </p>
              <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                Start a turn to see the agent and its child tools here.
              </p>
            </div>
          </div>
        ) : null}

        {!isLoading && !isError && processList.length > 0 ? (
          <ul className="space-y-0.5 p-2" aria-label="Session processes">
            <AnimatePresence initial={false} mode="popLayout">
              {processList.map((process) => (
                <ProcessRow
                  key={process.pid}
                  process={process}
                  activity={getActivity(process, sessionBusy, activePids)}
                />
              ))}
            </AnimatePresence>
          </ul>
        ) : null}
      </div>
    </div>
  )
}
