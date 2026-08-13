import { createContext, useContext } from "react"
import type { AgentKind, ProjectRecord, SessionRecord } from "@/lib/orchd"

export type CurrentTab = { type: "session" } | { type: "path"; file: string }

export interface DraftSession {
  project: ProjectRecord
  agentKind: AgentKind
}

export interface WorkspaceContextValue {
  sessions: SessionRecord[]
  projects: ProjectRecord[]
  sessionsLoading: boolean
  activeId: string | null
  activeSession: SessionRecord | null
  draft: DraftSession | null
  treeOpen: boolean
  treeRoot: string | null
  treeTitle: string
  currentTab: CurrentTab
  openedFiles: string[]
  newSessionOpen: boolean
  newProjectOpen: boolean
  selectSession: (id: string) => void
  startDraft: (project: ProjectRecord, agentKind: AgentKind) => void
  sessionCreated: (session: SessionRecord) => void
  sessionDeleted: (id: string) => void
  closeTree: () => void
  switchActiveTab: (tab: CurrentTab) => void
  closeFile: (file: string) => void
  openNewSession: () => void
  closeNewSession: () => void
  setNewProjectOpen: (open: boolean) => void
}

export const WorkspaceContext = createContext<WorkspaceContextValue | null>(
  null
)

export function useWorkspace() {
  const context = useContext(WorkspaceContext)
  if (!context) {
    throw new Error("useWorkspace must be used inside WorkspaceProvider")
  }
  return context
}
