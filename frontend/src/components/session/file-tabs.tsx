import { MessageSquare, XIcon } from "lucide-react"
import { getFileIcon } from "@/lib/file-icon.tsx"
import { cn } from "@/lib/utils.ts"
import { Separator } from "@/components/ui/separator.tsx"
import { useWorkspace, type CurrentTab } from "@/lib/workspace-context"
import type { SubagentRecord } from "@/lib/orchd"
import {
  subagentLabel,
  subagentStatusIcon,
  subagentStatusLabel,
  subagentTone,
} from "@/lib/subagent"

function OpenedFile({
  file,
  currentTab,
  switchActiveTab,
  onClose,
}: {
  file: string
  currentTab: CurrentTab
  switchActiveTab: (tab: CurrentTab) => void
  onClose: (file: string) => void
}) {
  const Icon = getFileIcon(file)
  const active = currentTab.type === "path" && currentTab.file === file

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`Open ${file}`}
      title={file}
      onClick={() => {
        switchActiveTab({ type: "path", file })
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault()
          switchActiveTab({ type: "path", file })
        }
      }}
      className={cn(
        "group/tab inline-flex h-7 shrink-0 items-center gap-1.5 rounded-lg px-2 text-[13px] font-medium whitespace-nowrap transition-colors outline-none select-none",
        "focus-visible:ring-2 focus-visible:ring-ring",
        active
          ? "bg-muted/70 text-foreground"
          : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
      )}
    >
      <span className="grid size-4 shrink-0 place-items-center">
        <Icon className="size-3.5" aria-hidden />
      </span>
      <span className="max-w-55 truncate">{file}</span>
      <button
        type="button"
        aria-label={`Close ${file}`}
        className={cn(
          "grid size-4 shrink-0 place-items-center rounded text-muted-foreground transition-colors outline-none",
          "hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40",
          active ? "opacity-100" : "opacity-0 group-hover/tab:opacity-100"
        )}
        onClick={(e) => {
          e.stopPropagation()
          onClose(file)
        }}
      >
        <XIcon className="size-3" />
      </button>
    </div>
  )
}

export function FileTabs({ subagents = [] }: { subagents?: SubagentRecord[] }) {
  const { currentTab, switchActiveTab, openedFiles, closeFile } = useWorkspace()

  return (
    <div className="flex h-10 min-w-0 shrink-0 items-center gap-1 overflow-hidden border-b border-border px-2">
      <button
        type="button"
        aria-current={currentTab.type === "session" ? "page" : undefined}
        onClick={() => switchActiveTab({ type: "session" })}
        className={cn(
          "inline-flex h-7 shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-[13px] font-medium whitespace-nowrap transition-colors outline-none select-none",
          "focus-visible:ring-2 focus-visible:ring-ring",
          currentTab.type === "session"
            ? "bg-muted/70 text-foreground"
            : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
        )}
      >
        <MessageSquare className="size-3.5" />
        <span>Conversation</span>
      </button>

      {openedFiles.length > 0 ? (
        <Separator orientation="vertical" className="my-2" />
      ) : null}

      {subagents.length > 0 ? (
        <div
          role="tablist"
          aria-label="Open subagents"
          className="flex max-w-[42%] min-w-0 shrink scrollbar-none items-center gap-1 overflow-x-auto"
        >
          {subagents.map((agent) => {
            const active =
              currentTab.type === "subagent" &&
              currentTab.threadId === agent.thread_id
            const name = subagentLabel(agent)
            const status = subagentStatusLabel(agent.status)
            const StatusIcon = subagentStatusIcon(agent.status)

            return (
              <button
                key={`subagent-${agent.thread_id}`}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() =>
                  switchActiveTab({
                    type: "subagent",
                    threadId: agent.thread_id,
                  })
                }
                title={`${name} · ${status}`}
                aria-label={`${name}, ${status}`}
                className={cn(
                  "inline-flex h-7 max-w-52 shrink-0 items-center gap-1.5 rounded-lg px-2 text-[13px] font-medium whitespace-nowrap transition-colors outline-none select-none",
                  "focus-visible:ring-2 focus-visible:ring-ring",
                  active
                    ? "bg-muted/70 text-foreground"
                    : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                )}
              >
                <span
                  className={cn(
                    "grid size-5 shrink-0 place-items-center rounded-md",
                    subagentTone(agent.status)
                  )}
                >
                  <StatusIcon className="size-3.5" aria-hidden="true" />
                </span>
                <span className="truncate">{name}</span>
              </button>
            )
          })}
        </div>
      ) : null}

      {subagents.length > 0 && openedFiles.length > 0 ? (
        <Separator orientation="vertical" className="my-2" />
      ) : null}

      <div className="flex h-full min-w-0 flex-1 scrollbar-none items-center gap-1 overflow-x-auto">
        {openedFiles.map((file, index) => (
          <OpenedFile
            key={`file-${file}-${index}`}
            file={file}
            currentTab={currentTab}
            switchActiveTab={switchActiveTab}
            onClose={closeFile}
          />
        ))}
      </div>
    </div>
  )
}
