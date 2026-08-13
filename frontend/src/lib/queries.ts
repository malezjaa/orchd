import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { api } from "@/lib/api"
import { setAuthToken, useAuthToken } from "@/lib/auth"
import { DEFAULT_CODE_THEME } from "@/lib/code-themes"
import type {
  AgentKind,
  FileContentsResponse,
  GitAction,
  ProjectRecord,
  ProcessInventory,
  SessionRecord,
  SettingsPatch,
  SettingsRecord,
} from "@/lib/orchd"

export const queryKeys = {
  projects: ["projects"] as const,
  sessions: ["sessions"] as const,
  archivedSessions: ["sessions", "archived"] as const,
  models: ["models"] as const,
  settings: ["settings"] as const,
}

export function useSettings() {
  const token = useAuthToken()
  return useQuery({
    queryKey: queryKeys.settings,
    queryFn: api.getSettings,
    enabled: token !== null,
    staleTime: Infinity,
  })
}

/// The resolved code block theme key, defaulting to `DEFAULT_CODE_THEME` when
/// the setting is unset or settings haven't loaded yet.
export function useCodeTheme(): string {
  const { data: settings } = useSettings()
  return settings?.code_theme ?? DEFAULT_CODE_THEME
}

export function useUpdateSettings() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (patch: SettingsPatch) => api.updateSettings(patch),
    // Applied optimistically so a picker (and anything reading the same
    // setting live, like the code block preview) updates the instant a user
    // makes a choice, rather than waiting on the round trip.
    onMutate: async (patch) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.settings })
      const previous = queryClient.getQueryData<SettingsRecord>(
        queryKeys.settings
      )
      if (previous) {
        queryClient.setQueryData<SettingsRecord>(queryKeys.settings, {
          ...previous,
          ...patch,
        })
      }
      return { previous }
    },
    onError: (_err, _patch, context) => {
      if (context?.previous) {
        queryClient.setQueryData<SettingsRecord>(
          queryKeys.settings,
          context.previous
        )
      }
    },
    onSuccess: (record) => {
      queryClient.setQueryData<SettingsRecord>(queryKeys.settings, record)
    },
  })
}

// The catalog is hardcoded server-side and never changes at runtime.
export function useModels() {
  const token = useAuthToken()
  return useQuery({
    queryKey: queryKeys.models,
    queryFn: api.listModels,
    enabled: token !== null,
    staleTime: Infinity,
  })
}

export function useProjectSkills(
  path: string | undefined,
  agentKind: AgentKind,
  enabled: boolean
) {
  const token = useAuthToken()
  return useQuery({
    queryKey: ["skills", path ?? "__none__", agentKind],
    queryFn: () => api.listSkills(path as string, agentKind),
    enabled: enabled && token !== null && Boolean(path),
    staleTime: 30_000,
  })
}

export function usePairDevice() {
  return useMutation({
    mutationFn: ({
      pairingToken,
      deviceLabel,
    }: {
      pairingToken: string
      deviceLabel?: string
    }) => api.pair(pairingToken, deviceLabel),
    onSuccess: (result) => setAuthToken(result.session_token),
  })
}

export function useProjects() {
  const token = useAuthToken()
  return useQuery({
    queryKey: queryKeys.projects,
    queryFn: api.listProjects,
    enabled: token !== null,
  })
}

export function useCreateProject() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ name, path }: { name: string; path: string }) =>
      api.createProject(name, path),
    onSuccess: (record) => {
      queryClient.setQueryData<ProjectRecord[]>(
        queryKeys.projects,
        (current) => [record, ...(current ?? [])]
      )
    },
  })
}

export function useSessions() {
  const token = useAuthToken()
  return useQuery({
    queryKey: queryKeys.sessions,
    queryFn: api.listSessions,
    enabled: token !== null,
    // Catches status changes with no live socket open, such as a session
    // closed from another device.
    refetchInterval: 20_000,
  })
}

export function useSessionProcesses(sessionId: string | null) {
  const token = useAuthToken()
  return useQuery<ProcessInventory>({
    queryKey: ["session-processes", sessionId ?? "__none__"],
    queryFn: () => api.listSessionProcesses(sessionId as string),
    enabled: token !== null && Boolean(sessionId),
    refetchInterval: 500,
    staleTime: 250,
  })
}

// Lazily enabled so only switching to the History view fetches.
export function useArchivedSessions(enabled: boolean) {
  const token = useAuthToken()
  return useQuery({
    queryKey: queryKeys.archivedSessions,
    queryFn: api.listArchivedSessions,
    enabled: token !== null && enabled,
  })
}

export function useBrowseFolder(path: string | undefined, enabled: boolean) {
  const token = useAuthToken()
  return useQuery({
    queryKey: ["fs-browse", path ?? "__home__"],
    queryFn: () => api.browseFolder(path),
    enabled: enabled && token !== null,
    staleTime: 30_000,
  })
}

// The project file tree plus git status, for the explorer shown when a session
// is opened. Keyed by path so switching sessions refetches.
export function useProjectTree(path: string | undefined, enabled: boolean) {
  const token = useAuthToken()
  return useQuery({
    queryKey: ["fs-tree", path ?? "__none__"],
    queryFn: () => api.fileTree(path as string),
    enabled: enabled && token !== null && Boolean(path),
    staleTime: 30_000,
  })
}

export function useGitStatus(path: string | undefined, enabled: boolean) {
  const token = useAuthToken()
  return useQuery({
    queryKey: ["git-status", path ?? "__none__"],
    queryFn: () => api.gitStatus(path as string),
    enabled: enabled && token !== null && Boolean(path),
    staleTime: 10_000,
  })
}

export function useGitInfo(path: string | undefined, enabled: boolean) {
  const token = useAuthToken()
  return useQuery({
    queryKey: ["git-info", path ?? "__none__"],
    queryFn: () => api.gitInfo(path as string),
    enabled: enabled && token !== null && Boolean(path),
    staleTime: 10_000,
  })
}

export function useGitAction() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ path, action }: { path: string; action: GitAction }) =>
      api.gitAction(path, action),
    onSuccess: (_result, { path }) => {
      void queryClient.invalidateQueries({ queryKey: ["git-status", path] })
      void queryClient.invalidateQueries({ queryKey: ["git-info", path] })
      void queryClient.invalidateQueries({ queryKey: ["fs-tree", path] })
    },
  })
}

export function useFileContents(cwd: string | null, file: string | null) {
  const token = useAuthToken()
  return useQuery({
    queryKey: ["fs-contents", cwd ?? "__none__", file ?? "__none__"],
    queryFn: () => api.fileContents(cwd as string, file as string),
    enabled: token !== null && Boolean(cwd) && Boolean(file),
    staleTime: 30_000,
  })
}

/// Persist an edited file. Debounced on the caller; success updates the
/// contents cache in place (no refetch, so a live edit session is never
/// disturbed) and invalidates the tree so the explorer's git badges reflect
/// the change.
export function useWriteFileContents() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({
      cwd,
      path,
      contents,
    }: {
      cwd: string
      path: string
      contents: string
    }) => api.writeFileContents(cwd, path, contents),
    onSuccess: (_data, { cwd, path, contents }) => {
      queryClient.setQueryData<FileContentsResponse>(
        ["fs-contents", cwd, path],
        (old) => ({ current: contents, old: old?.old ?? null })
      )
      queryClient.invalidateQueries({ queryKey: ["fs-tree", cwd] })
      queryClient.invalidateQueries({ queryKey: ["git-status", cwd] })
    },
  })
}

export function useCreateSession() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ projectId }: { projectId: string }) =>
      api.createSession(projectId),
    onSuccess: (record) => {
      queryClient.setQueryData<SessionRecord[]>(
        queryKeys.sessions,
        (current) => [record, ...(current ?? [])]
      )
    },
  })
}

export function useArchiveSession() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.archiveSession(id),
    onSuccess: (_data, id) => {
      queryClient.setQueryData<SessionRecord[]>(queryKeys.sessions, (current) =>
        current?.filter((session) => session.id !== id)
      )
      queryClient.invalidateQueries({ queryKey: queryKeys.archivedSessions })
    },
  })
}

export function useUnarchiveSession() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.unarchiveSession(id),
    onSuccess: (_data, id) => {
      queryClient.setQueryData<SessionRecord[]>(
        queryKeys.archivedSessions,
        (current) => current?.filter((session) => session.id !== id)
      )
      queryClient.invalidateQueries({ queryKey: queryKeys.sessions })
    },
  })
}

function updateSessionCaches(
  queryClient: ReturnType<typeof useQueryClient>,
  id: string,
  update: (session: SessionRecord) => SessionRecord
) {
  for (const key of [queryKeys.sessions, queryKeys.archivedSessions]) {
    queryClient.setQueryData<SessionRecord[]>(key, (current) =>
      current?.map((session) => (session.id === id ? update(session) : session))
    )
  }
}

function sortSessions(sessions: SessionRecord[]) {
  return [...sessions].sort((a, b) => {
    const aPinned = a.pinned_at !== null
    const bPinned = b.pinned_at !== null

    if (aPinned !== bPinned) return aPinned ? -1 : 1

    if (aPinned && bPinned) {
      return b.pinned_at!.localeCompare(a.pinned_at!)
    }

    return b.created_at.localeCompare(a.created_at)
  })
}

export function usePinSession() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, pinned }: { id: string; pinned: boolean }) =>
      pinned ? api.pinSession(id) : api.unpinSession(id),
    onMutate: async ({ id, pinned }) => {
      await Promise.all(
        [queryKeys.sessions, queryKeys.archivedSessions].map((queryKey) =>
          queryClient.cancelQueries({ queryKey })
        )
      )

      const previousSessions = queryClient.getQueryData<SessionRecord[]>(
        queryKeys.sessions
      )
      const previousArchivedSessions = queryClient.getQueryData<SessionRecord[]>(
        queryKeys.archivedSessions
      )
      const pinnedAt = pinned ? new Date().toISOString() : null

      for (const queryKey of [
        queryKeys.sessions,
        queryKeys.archivedSessions,
      ]) {
        queryClient.setQueryData<SessionRecord[]>(queryKey, (current) => {
          if (!current) return current

          return sortSessions(
            current.map((session) =>
              session.id === id ? { ...session, pinned_at: pinnedAt } : session
            )
          )
        })
      }

      return { previousArchivedSessions, previousSessions }
    },
    onError: (_error, _variables, context) => {
      if (!context) return

      queryClient.setQueryData(
        queryKeys.sessions,
        context.previousSessions
      )
      queryClient.setQueryData(
        queryKeys.archivedSessions,
        context.previousArchivedSessions
      )
    },
  })
}

export function useRenameSession() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, title }: { id: string; title: string }) =>
      api.renameSession(id, title),
    onSuccess: (_data, { id, title }) => {
      updateSessionCaches(queryClient, id, (session) => ({ ...session, title }))
    },
  })
}

export function useDeleteSession() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.deleteSession(id),
    onSuccess: (_data, id) => {
      for (const key of [queryKeys.sessions, queryKeys.archivedSessions]) {
        queryClient.setQueryData<SessionRecord[]>(key, (current) =>
          current?.filter((session) => session.id !== id)
        )
      }
    },
  })
}

export function useRegenerateSessionTitle() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.regenerateSessionTitle(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.sessions })
      void queryClient.invalidateQueries({
        queryKey: queryKeys.archivedSessions,
      })
    },
  })
}
