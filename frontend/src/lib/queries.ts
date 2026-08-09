import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { api } from "@/lib/api"
import { setAuthToken, useAuthToken } from "@/lib/auth"
import { DEFAULT_CODE_THEME } from "@/lib/code-themes"
import type {
  AgentKind,
  ProjectRecord,
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

export function useCreateSession() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({
      agentKind,
      projectId,
    }: {
      agentKind: AgentKind
      projectId: string
    }) => api.createSession(agentKind, projectId),
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
