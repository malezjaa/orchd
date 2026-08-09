import { Settings } from "lucide-react"
import { useState } from "react"
import { SettingsDialog } from "@/components/settings/settings-dialog"
import {
  AnimatedSidebar,
  AnimatedSidebarContent,
  AnimatedSidebarFooter,
  AnimatedSidebarRail,
  useAnimatedSidebarPanel,
} from "@/components/motion/animated-sidebar.tsx"
import { ProjectTreePanel } from "@/components/session/project-tree.tsx"
import { SessionList } from "@/components/sidebar/session-list.tsx"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { useArchivedSessions } from "@/lib/queries.ts"
import { cn } from "@/lib/utils.ts"
import type { ProjectRecord, SessionRecord } from "@/lib/orchd.ts"

export interface AppSidebarProps {
  sessions: SessionRecord[]
  projects: ProjectRecord[]
  activeId: string | null
  onSelect: (id: string) => void
  onCreate: () => void
  onCreateProject: () => void
  loading?: boolean
  treeOpen: boolean
  treeRoot: string | null
  treeTitle: string
  onTreeBack: () => void
}

function SidebarSettingsButton({ onOpen }: { onOpen: () => void }) {
  const { collapsed } = useAnimatedSidebarPanel()
  const label = "Settings"

  const trigger = (
    <button
      type="button"
      aria-label={label}
      title={collapsed ? label : undefined}
      onClick={onOpen}
      className={cn(
        "flex min-h-9 w-full items-center gap-2.5 rounded-xl px-3 text-left text-sm font-medium text-muted-foreground transition-colors outline-none hover:bg-muted/60 hover:text-foreground focus-visible:bg-muted/70 focus-visible:ring-2 focus-visible:ring-ring",
        collapsed && "justify-center px-0"
      )}
    >
      <span className="grid size-5 shrink-0 place-items-center">
        <Settings className="size-4" />
      </span>
      {!collapsed ? <span className="truncate">{label}</span> : null}
    </button>
  )

  if (!collapsed) return trigger

  return (
    <Tooltip>
      <TooltipTrigger render={trigger} />
      <TooltipContent side="top">{label}</TooltipContent>
    </Tooltip>
  )
}

export function AppSidebar({
  sessions,
  projects,
  activeId,
  onSelect,
  onCreate,
  onCreateProject,
  loading,
  treeOpen,
  treeRoot,
  treeTitle,
  onTreeBack,
}: AppSidebarProps) {
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState("")
  const [historyOnly, setHistoryOnly] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const archivedSessions = useArchivedSessions(historyOnly)

  return (
    <AnimatedSidebar
      ariaLabel="Agent workspace"
      collapsible="offcanvas"
      className="min-h-0"
      panelClassName="h-full bg-sidebar text-sidebar-foreground"
    >
      <AnimatedSidebarContent className="gap-4 overflow-hidden px-2 py-4">
        {treeOpen && treeRoot ? (
          <ProjectTreePanel
            rootPath={treeRoot}
            title={treeTitle}
            onBack={onTreeBack}
          />
        ) : (
          <SessionList
            sessions={historyOnly ? (archivedSessions.data ?? []) : sessions}
            projects={projects}
            activeId={activeId}
            onSelect={onSelect}
            searchOpen={searchOpen}
            searchQuery={searchQuery}
            onSearchQueryChange={setSearchQuery}
            loading={historyOnly ? archivedSessions.isLoading : loading}
            onCreate={onCreate}
            onToggleSearch={() => setSearchOpen((open) => !open)}
            onCreateProject={onCreateProject}
            historyOnly={historyOnly}
            onToggleHistory={() => setHistoryOnly((only) => !only)}
          />
        )}
      </AnimatedSidebarContent>

      <AnimatedSidebarFooter>
        <SidebarSettingsButton onOpen={() => setSettingsOpen(true)} />
      </AnimatedSidebarFooter>

      <AnimatedSidebarRail />

      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
    </AnimatedSidebar>
  )
}
