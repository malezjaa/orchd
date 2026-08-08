import { useState } from "react"
import {
  AnimatedSidebar,
  AnimatedSidebarContent,
  AnimatedSidebarFooter,
  AnimatedSidebarRail,
} from "@/components/motion/animated-sidebar.tsx"
import { SessionList } from "@/components/sidebar/session-list.tsx"
import { useArchivedSessions } from "@/lib/queries.ts"
import type { ProjectRecord, SessionRecord } from "@/lib/orchd.ts"

export interface AppSidebarProps {
  sessions: SessionRecord[]
  projects: ProjectRecord[]
  activeId: string | null
  onSelect: (id: string) => void
  onCreate: () => void
  onCreateProject: () => void
  loading?: boolean
}

export function AppSidebar({
  sessions,
  projects,
  activeId,
  onSelect,
  onCreate,
  onCreateProject,
  loading,
}: AppSidebarProps) {
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState("")
  const [historyOnly, setHistoryOnly] = useState(false)
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
      </AnimatedSidebarContent>

      <AnimatedSidebarFooter>
        <div className="flex gap-3 px-1"></div>
      </AnimatedSidebarFooter>

      <AnimatedSidebarRail />
    </AnimatedSidebar>
  )
}
