import { useCallback, useMemo, useState, type ReactNode } from "react"
import {
  basename,
  type AgentKind,
  type ProjectRecord,
  type SessionRecord,
} from "@/lib/orchd"
import { useArchivedSessions, useProjects, useSessions } from "@/lib/queries"
import {
  WorkspaceContext,
  type CurrentTab,
  type DraftSession,
  type WorkspaceContextValue,
} from "@/lib/workspace-context"

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const { data: sessions = [], isLoading: sessionsLoading } = useSessions()
  const { data: projects = [] } = useProjects()
  const { data: archivedSessions = [] } = useArchivedSessions(true)
  const [activeId, setActiveId] = useState<string | null>(null)
  const [draft, setDraft] = useState<DraftSession | null>(null)
  const [treeOpen, setTreeOpen] = useState(false)
  const [openedFiles, setOpenedFiles] = useState<string[]>([])
  const [currentTab, setCurrentTab] = useState<CurrentTab>({
    type: "session",
  })
  const [newSessionOpen, setNewSessionOpen] = useState(false)
  const [newProjectOpen, setNewProjectOpen] = useState(false)

  const activeSession =
    sessions.find((session) => session.id === activeId) ??
    archivedSessions.find((session) => session.id === activeId) ??
    null
  const activeProject = activeSession?.project_id
    ? (projects.find((project) => project.id === activeSession.project_id) ??
      null)
    : null
  const treeRoot = activeProject?.path ?? activeSession?.cwd ?? null
  const treeTitle =
    activeProject?.name ?? (activeSession ? basename(activeSession.cwd) : "")

  const selectSession = useCallback((id: string) => {
    setDraft(null)
    setTreeOpen(true)
    setActiveId(id)
  }, [])
  const startDraft = useCallback(
    (project: ProjectRecord, agentKind: AgentKind) => {
      setActiveId(null)
      setTreeOpen(false)
      setDraft({ project, agentKind })
    },
    []
  )
  const sessionCreated = useCallback((session: SessionRecord) => {
    setDraft(null)
    setTreeOpen(true)
    setActiveId(session.id)
  }, [])
  const sessionDeleted = useCallback(
    (id: string) => {
      if (activeId !== id) return
      setActiveId(null)
      setDraft(null)
      setTreeOpen(false)
      setOpenedFiles([])
      setCurrentTab({ type: "session" })
    },
    [activeId]
  )
  const switchActiveTab = useCallback((tab: CurrentTab) => {
    if (tab.type === "path") {
      setOpenedFiles((files) =>
        files.includes(tab.file) ? files : [...files, tab.file]
      )
    }
    setCurrentTab(tab)
  }, [])
  const closeFile = useCallback((file: string) => {
    setOpenedFiles((files) => files.filter((openFile) => openFile !== file))
    setCurrentTab((tab) =>
      tab.type === "path" && tab.file === file ? { type: "session" } : tab
    )
  }, [])
  const closeTree = useCallback(() => setTreeOpen(false), [])
  const openNewSession = useCallback(() => setNewSessionOpen(true), [])
  const closeNewSession = useCallback(() => setNewSessionOpen(false), [])

  const value = useMemo<WorkspaceContextValue>(
    () => ({
      sessions,
      projects,
      sessionsLoading,
      activeId,
      activeSession,
      draft,
      treeOpen,
      treeRoot,
      treeTitle,
      currentTab,
      openedFiles,
      newSessionOpen,
      newProjectOpen,
      selectSession,
      startDraft,
      sessionCreated,
      sessionDeleted,
      closeTree,
      switchActiveTab,
      closeFile,
      openNewSession,
      closeNewSession,
      setNewProjectOpen,
    }),
    [
      sessions,
      projects,
      sessionsLoading,
      activeId,
      activeSession,
      draft,
      treeOpen,
      treeRoot,
      treeTitle,
      currentTab,
      openedFiles,
      newSessionOpen,
      newProjectOpen,
      selectSession,
      startDraft,
      sessionCreated,
      sessionDeleted,
      closeTree,
      switchActiveTab,
      closeFile,
      openNewSession,
      closeNewSession,
    ]
  )

  return (
    <WorkspaceContext.Provider value={value}>
      {children}
    </WorkspaceContext.Provider>
  )
}
