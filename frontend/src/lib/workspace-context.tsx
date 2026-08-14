import { createContext, useContext } from "react"
import type { ProjectRecord, SessionRecord } from "@/lib/orchd"

export type CurrentTab =
  | { type: "session" }
  | { type: "path"; file: string }
  | { type: "subagent"; threadId: string }

export interface DraftSession {
  project: ProjectRecord
}

export interface WorkspaceContextValue {
  sessions: SessionRecord[]
  projects: ProjectRecord[]
  sessionsLoading: boolean
  activeId: string | null
  activeSession: SessionRecord | null
  draft: DraftSession | null
  treeRoot: string | null
  currentTab: CurrentTab
  openedFiles: string[]
  expandedTreePaths: string[]
  newSessionOpen: boolean
  newProjectOpen: boolean
  selectSession: (id: string) => void
  startDraft: (project: ProjectRecord) => void
  sessionCreated: (session: SessionRecord) => void
  sessionDeleted: (id: string) => void
  switchActiveTab: (tab: CurrentTab) => void
  closeFile: (file: string) => void
  setExpandedTreePaths: (paths: readonly string[]) => void
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
