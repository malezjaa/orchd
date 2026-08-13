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
import { useArchivedSessions } from "@/lib/queries.ts"
import type { ProjectRecord, SessionRecord } from "@/lib/orchd.ts"
import { TooltipIcon } from "@/components/tooltip-icon.tsx"
import { IconActionButton } from "@/components/icon-action-button.tsx"
import type { CurrentTab } from "@/components/app-shell.tsx"

export interface AppSidebarProps {
  sessions: SessionRecord[]
  projects: ProjectRecord[]
  activeId: string | null
  onSelect: (id: string) => void
  onDeleted: (id: string) => void
  onCreate: () => void
  onCreateProject: () => void
  loading?: boolean
  treeOpen: boolean
  treeRoot: string | null
  treeTitle: string
  onTreeBack: () => void
  currentTab: CurrentTab
  switchActiveTab: (tab: CurrentTab) => void
}

function SidebarSettingsButton({ onOpen }: { onOpen: () => void }) {
  const { collapsed } = useAnimatedSidebarPanel()

  if (collapsed) {
    return (
      <TooltipIcon label="Settings" onClick={onOpen}>
        <Settings className="size-4" />
      </TooltipIcon>
    )
  }

  return (
    <IconActionButton
      onClick={onOpen}
      className="w-full"
      icon={<Settings className="size-4" />}
      label={"Settings"}
    />
  )
}

export function AppSidebar({
  sessions,
  projects,
  activeId,
  onSelect,
  onDeleted,
  onCreate,
  onCreateProject,
  loading,
  treeOpen,
  treeRoot,
  treeTitle,
  onTreeBack,
  currentTab,
  switchActiveTab,
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
            currentTab={currentTab}
            switchActiveTab={switchActiveTab}
          />
        ) : (
          <SessionList
            sessions={historyOnly ? (archivedSessions.data ?? []) : sessions}
            projects={projects}
            activeId={activeId}
            onSelect={onSelect}
            onDeleted={onDeleted}
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
