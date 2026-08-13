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
import { SessionList } from "@/components/sidebar/session-list.tsx"
import { useArchivedSessions } from "@/lib/queries.ts"
import { TooltipIcon } from "@/components/tooltip-icon.tsx"
import { IconActionButton } from "@/components/icon-action-button.tsx"
import { useWorkspace } from "@/lib/workspace-context"

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

export function AppSidebar() {
  const {
    sessions,
    projects,
    activeId,
    sessionsLoading,
    selectSession,
    sessionDeleted,
    openNewSession,
    setNewProjectOpen,
  } = useWorkspace()
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
        <SessionList
          sessions={historyOnly ? (archivedSessions.data ?? []) : sessions}
          projects={projects}
          activeId={activeId}
          onSelect={selectSession}
          onDeleted={sessionDeleted}
          searchOpen={searchOpen}
          searchQuery={searchQuery}
          onSearchQueryChange={setSearchQuery}
          loading={historyOnly ? archivedSessions.isLoading : sessionsLoading}
          onCreate={openNewSession}
          onToggleSearch={() => setSearchOpen((open) => !open)}
          onCreateProject={() => setNewProjectOpen(true)}
          historyOnly={historyOnly}
          onToggleHistory={() => setHistoryOnly((only) => !only)}
        />
      </AnimatedSidebarContent>

      <AnimatedSidebarFooter>
        <SidebarSettingsButton onOpen={() => setSettingsOpen(true)} />
      </AnimatedSidebarFooter>

      <AnimatedSidebarRail />

      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
    </AnimatedSidebar>
  )
}
