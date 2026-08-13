import { useCallback, useMemo, useState, type ReactNode } from "react"
import type { ProjectRecord, SessionRecord } from "@/lib/orchd"
import { useArchivedSessions, useProjects, useSessions } from "@/lib/queries"
import {
  WorkspaceContext,
  type CurrentTab,
  type DraftSession,
  type WorkspaceContextValue,
} from "@/lib/workspace-context"

const EMPTY_VIEW_KEY = "__empty__"
const DRAFT_VIEW_KEY = "__draft__"

interface SessionViewState {
  openedFiles: string[]
  expandedTreePaths: string[]
  currentTab: CurrentTab
}

function createSessionView(): SessionViewState {
  return {
    openedFiles: [],
    expandedTreePaths: [],
    currentTab: { type: "session" },
  }
}

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const { data: sessions = [], isLoading: sessionsLoading } = useSessions()
  const { data: projects = [] } = useProjects()
  const { data: archivedSessions = [] } = useArchivedSessions(true)
  const [activeId, setActiveId] = useState<string | null>(null)
  const [draft, setDraft] = useState<DraftSession | null>(null)
  const [sessionViews, setSessionViews] = useState<
    Record<string, SessionViewState>
  >({})
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
  const viewKey = activeId ?? (draft ? DRAFT_VIEW_KEY : EMPTY_VIEW_KEY)
  const { currentTab, openedFiles, expandedTreePaths } =
    sessionViews[viewKey] ?? createSessionView()

  const selectSession = useCallback((id: string) => {
    setDraft(null)
    setActiveId(id)
  }, [])
  const startDraft = useCallback((project: ProjectRecord) => {
    setActiveId(null)
    setDraft({ project })
  }, [])
  const sessionCreated = useCallback((session: SessionRecord) => {
    setDraft(null)
    setActiveId(session.id)
  }, [])
  const sessionDeleted = useCallback(
    (id: string) => {
      setSessionViews((views) => {
        if (!views[id]) return views
        const next = { ...views }
        delete next[id]
        return next
      })
      if (activeId !== id) return
      setActiveId(null)
      setDraft(null)
    },
    [activeId]
  )
  const switchActiveTab = useCallback(
    (tab: CurrentTab) => {
      setSessionViews((views) => {
        const current = views[viewKey] ?? createSessionView()
        const opened =
          tab.type === "path" && !current.openedFiles.includes(tab.file)
            ? [...current.openedFiles, tab.file]
            : current.openedFiles

        return {
          ...views,
          [viewKey]: { ...current, openedFiles: opened, currentTab: tab },
        }
      })
    },
    [viewKey]
  )
  const closeFile = useCallback(
    (file: string) => {
      setSessionViews((views) => {
        const current = views[viewKey] ?? createSessionView()
        return {
          ...views,
          [viewKey]: {
            ...current,
            openedFiles: current.openedFiles.filter(
              (openFile) => openFile !== file
            ),
            currentTab:
              current.currentTab.type === "path" &&
              current.currentTab.file === file
                ? { type: "session" }
                : current.currentTab,
          },
        }
      })
    },
    [viewKey]
  )
  const setExpandedTreePaths = useCallback(
    (paths: readonly string[]) => {
      setSessionViews((views) => {
        const current = views[viewKey] ?? createSessionView()
        const nextPaths = [...paths]
        if (
          current.expandedTreePaths.length === nextPaths.length &&
          current.expandedTreePaths.every(
            (path, index) => path === nextPaths[index]
          )
        ) {
          return views
        }

        return {
          ...views,
          [viewKey]: { ...current, expandedTreePaths: nextPaths },
        }
      })
    },
    [viewKey]
  )
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
      treeRoot,
      currentTab,
      openedFiles,
      expandedTreePaths,
      newSessionOpen,
      newProjectOpen,
      selectSession,
      startDraft,
      sessionCreated,
      sessionDeleted,
      switchActiveTab,
      closeFile,
      setExpandedTreePaths,
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
      treeRoot,
      currentTab,
      openedFiles,
      expandedTreePaths,
      newSessionOpen,
      newProjectOpen,
      selectSession,
      startDraft,
      sessionCreated,
      sessionDeleted,
      switchActiveTab,
      closeFile,
      setExpandedTreePaths,
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
