import { MessageSquare, XIcon } from "lucide-react"
import { getFileIcon } from "@/lib/file-icon.tsx"
import { cn } from "@/lib/utils.ts"
import { Separator } from "@/components/ui/separator.tsx"
import type { CurrentTab } from "@/components/app-shell.tsx"

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

export function FileTabs({
  currentTab,
  switchActiveTab,
  openedFiles,
  onClose,
}: {
  currentTab: CurrentTab
  switchActiveTab: (tab: CurrentTab) => void
  openedFiles: string[]
  onClose: (file: string) => void
}) {
  return (
    <div className="flex h-10 shrink-0 items-center gap-1 border-b border-border px-2">
      <button
        type="button"
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

      <div className="flex h-full min-w-0 flex-1 scrollbar-none items-center gap-1 overflow-x-auto">
        {openedFiles.map((file, index) => (
          <OpenedFile
            key={`file-${file}-${index}`}
            file={file}
            currentTab={currentTab}
            switchActiveTab={switchActiveTab}
            onClose={onClose}
          />
        ))}
      </div>
    </div>
  )
}
