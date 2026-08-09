import { useState } from "react"
import {
  CircleCheckIcon,
  InfoIcon,
  Loader2Icon,
  OctagonXIcon,
  TriangleAlertIcon,
} from "lucide-react"
import { Toaster as Sonner, type ToasterProps } from "sonner"
import { AppSidebar } from "@/components/sidebar/app-sidebar.tsx"
import {
  AnimatedSidebarInset,
  AnimatedSidebarProvider,
} from "@/components/motion/animated-sidebar"
import { NewProjectPalette } from "@/components/project/new-project-palette"
import { NewSessionPalette } from "@/components/session/new-session-palette"
import {
  type DraftSession,
  SessionPanel,
} from "@/components/session/session-panel"
import { SettingsEffects } from "@/components/settings/settings-effects"
import { useTheme } from "@/components/theme-provider"
import type { AgentKind, ProjectRecord, SessionRecord } from "@/lib/orchd"
import { useArchivedSessions, useProjects, useSessions } from "@/lib/queries"

export function AppShell() {
  const { data: sessions = [], isLoading } = useSessions()
  const { data: projects = [] } = useProjects()
  const [activeId, setActiveId] = useState<string | null>(null)
  const [draft, setDraft] = useState<DraftSession | null>(null)
  const [newSessionOpen, setNewSessionOpen] = useState(false)
  const [newProjectOpen, setNewProjectOpen] = useState(false)
  const { theme } = useTheme()

  // The normal list excludes archived sessions, but the History view
  // opens exactly those, so the lookup has to search both lists or an
  // archived session resolves to nothing and the panel shows empty.
  const { data: archivedSessions = [] } = useArchivedSessions(true)

  const activeSession =
    sessions.find((session) => session.id === activeId) ??
    archivedSessions.find((session) => session.id === activeId) ??
    null

  const handleSelect = (id: string) => {
    setDraft(null)
    setActiveId(id)
  }

  const handleDraftStart = (project: ProjectRecord, agentKind: AgentKind) => {
    setActiveId(null)
    setDraft({ project, agentKind })
  }

  const handleSessionCreated = (session: SessionRecord) => {
    setDraft(null)
    setActiveId(session.id)
  }

  return (
    <AnimatedSidebarProvider className="h-svh overflow-hidden">
      <SettingsEffects />
      <AppSidebar
        sessions={sessions}
        projects={projects}
        activeId={activeId}
        onSelect={handleSelect}
        onCreate={() => setNewSessionOpen(true)}
        onCreateProject={() => setNewProjectOpen(true)}
        loading={isLoading}
      />
      <AnimatedSidebarInset>
        <SessionPanel
          session={activeSession}
          draft={draft}
          onSessionCreated={handleSessionCreated}
        />
      </AnimatedSidebarInset>

      <NewSessionPalette
        open={newSessionOpen}
        onClose={() => setNewSessionOpen(false)}
        onDraftStart={handleDraftStart}
      />

      <NewProjectPalette
        open={newProjectOpen}
        onOpenChange={setNewProjectOpen}
        onCreated={() => setNewProjectOpen(false)}
      />

      <Sonner
        theme={theme as ToasterProps["theme"]}
        className="toaster group"
        icons={{
          success: <CircleCheckIcon className="size-4" />,
          info: <InfoIcon className="size-4" />,
          warning: <TriangleAlertIcon className="size-4" />,
          error: <OctagonXIcon className="size-4" />,
          loading: <Loader2Icon className="size-4 animate-spin" />,
        }}
        style={
          {
            "--normal-bg": "var(--popover)",
            "--normal-text": "var(--popover-foreground)",
            "--normal-border": "var(--border)",
            "--border-radius": "var(--radius)",
          } as React.CSSProperties
        }
        toastOptions={{
          classNames: {
            toast: "cn-toast",
          },
        }}
      />
    </AnimatedSidebarProvider>
  )
}
