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
import { SessionPanel } from "@/components/session/session-panel"
import { SettingsEffects } from "@/components/settings/settings-effects"
import { useTheme } from "@/components/theme-provider"
import { ActiveSessionProvider } from "@/lib/active-session-provider"
import { useWorkspace } from "@/lib/workspace-context"
import { WorkspaceProvider } from "@/lib/workspace-provider"

export function AppShell() {
  return (
    <WorkspaceProvider>
      <WorkspaceLayout />
    </WorkspaceProvider>
  )
}

function WorkspaceLayout() {
  const {
    activeSession,
    newProjectOpen,
    newSessionOpen,
    closeNewSession,
    setNewProjectOpen,
    startDraft,
  } = useWorkspace()
  const { theme } = useTheme()

  return (
    <AnimatedSidebarProvider className="h-svh overflow-hidden">
      <SettingsEffects />
      <AppSidebar />
      <AnimatedSidebarInset>
        <ActiveSessionProvider sessionId={activeSession?.id ?? null}>
          <SessionPanel />
        </ActiveSessionProvider>
      </AnimatedSidebarInset>

      <NewSessionPalette
        open={newSessionOpen}
        onClose={closeNewSession}
        onDraftStart={startDraft}
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
