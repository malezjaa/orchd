// Thin typed wrapper around the daemon's REST surface. Requests go through
// the dev proxy so they're same-origin, and the bearer token is attached to
// every request except the pairing exchange itself.

import { clearAuthToken, getAuthToken } from "@/lib/auth"
import type {
  AgentKind,
  AgentSkill,
  ClientSessionRecord,
  FileContentsResponse,
  FileTreeResponse,
  FsBrowseResponse,
  GitStatusResponse,
  GitAction,
  GitInfoResponse,
  ModelInfo,
  ProjectRecord,
  ProcessInventory,
  SessionRecord,
  SettingsPatch,
  SettingsRecord,
} from "@/lib/orchd"

export class ApiError extends Error {
  public readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.status = status
    this.name = "ApiError"
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers)
  headers.set("Content-Type", "application/json")
  const token = getAuthToken()
  if (token) headers.set("Authorization", `Bearer ${token}`)

  const res = await fetch(path, { ...init, headers })

  if (res.status === 401) {
    clearAuthToken()
    throw new ApiError(401, "Session expired. Pair this device again.")
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "")
    let message = body
    try {
      const parsed = JSON.parse(body) as { error?: unknown }
      if (typeof parsed.error === "string") message = parsed.error
    } catch {
      // Keep the raw response when the server did not return JSON.
    }
    throw new ApiError(res.status, message || res.statusText)
  }
  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}

export interface PairingResult {
  session: ClientSessionRecord
  session_token: string
}

export const api = {
  health: () => request<string>("/health"),

  pair: (pairingToken: string, deviceLabel?: string) =>
    request<PairingResult>("/auth/pairing", {
      method: "POST",
      body: JSON.stringify({
        pairing_token: pairingToken,
        device_label: deviceLabel,
      }),
    }),

  websocketTicket: () =>
    request<{ ticket: string; expires_in_secs: number }>(
      "/auth/websocket-ticket",
      {
        method: "POST",
      }
    ),

  listProjects: () => request<ProjectRecord[]>("/projects"),

  createProject: (name: string, path: string) =>
    request<ProjectRecord>("/projects", {
      method: "POST",
      body: JSON.stringify({ name, path }),
    }),

  deleteProject: (id: string) =>
    request<void>(`/projects/${id}`, { method: "DELETE" }),

  archiveProject: (id: string) =>
    request<void>(`/projects/${id}/archive`, { method: "POST" }),

  listSessions: () => request<SessionRecord[]>("/sessions"),

  listArchivedSessions: () =>
    request<SessionRecord[]>("/sessions?archived=true"),

  getSession: (id: string) => request<SessionRecord>(`/sessions/${id}`),

  listSessionProcesses: (id: string) =>
    request<ProcessInventory>(`/sessions/${id}/processes`),

  archiveSession: (id: string) =>
    request<void>(`/sessions/${id}/archive`, { method: "POST" }),

  unarchiveSession: (id: string) =>
    request<void>(`/sessions/${id}/unarchive`, { method: "POST" }),

  pinSession: (id: string) =>
    request<void>(`/sessions/${id}/pin`, { method: "POST" }),

  unpinSession: (id: string) =>
    request<void>(`/sessions/${id}/unpin`, { method: "POST" }),

  renameSession: (id: string, title: string) =>
    request<void>(`/sessions/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ title }),
    }),

  deleteSession: (id: string) =>
    request<void>(`/sessions/${id}`, { method: "DELETE" }),

  regenerateSessionTitle: (id: string) =>
    request<void>(`/sessions/${id}/regenerate-title`, { method: "POST" }),

  createSession: (projectId: string) =>
    request<SessionRecord>("/sessions", {
      method: "POST",
      body: JSON.stringify({ project_id: projectId }),
    }),

  browseFolder: (path?: string) =>
    request<FsBrowseResponse>(
      `/fs/browse${path ? `?path=${encodeURIComponent(path)}` : ""}`
    ),

  fileContents: (cwd: string, file: string) =>
    request<FileContentsResponse>(
      `/fs/contents?cwd=${encodeURIComponent(cwd)}&path=${encodeURIComponent(file)}`
    ),

  writeFileContents: (cwd: string, file: string, contents: string) =>
    request<void>(`/fs/contents`, {
      method: "PUT",
      body: JSON.stringify({ cwd, path: file, contents }),
    }),

  fileTree: (path: string) =>
    request<FileTreeResponse>(`/fs/tree?path=${encodeURIComponent(path)}`),

  gitStatus: (path: string) =>
    request<GitStatusResponse>(
      `/fs/git-status?path=${encodeURIComponent(path)}`
    ),

  gitInfo: (path: string) =>
    request<GitInfoResponse>(`/git/info?path=${encodeURIComponent(path)}`),

  gitAction: (path: string, action: GitAction) =>
    request<{ message: string }>("/git/action", {
      method: "POST",
      body: JSON.stringify({ path, ...action }),
    }),

  listModels: () => request<ModelInfo[]>("/models"),

  listSkills: (path: string, agentKind: AgentKind) =>
    request<AgentSkill[]>(
      `/skills?path=${encodeURIComponent(path)}&agent_kind=${encodeURIComponent(agentKind)}`
    ),

  getSettings: () => request<SettingsRecord>("/settings"),

  updateSettings: (patch: SettingsPatch) =>
    request<SettingsRecord>("/settings", {
      method: "PATCH",
      body: JSON.stringify(patch),
    }),
}
