// Thin typed wrapper around the daemon's REST surface. Requests go through
// the dev proxy so they're same-origin, and the bearer token is attached to
// every request except the pairing exchange itself.

import { clearAuthToken, getAuthToken } from "@/lib/auth"
import type {
  AgentKind,
  ClientSessionRecord,
  FsBrowseResponse,
  ModelInfo,
  ProjectRecord,
  SessionRecord,
  SettingsPatch,
  SettingsRecord,
} from "@/lib/orchd"

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message)
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
    throw new ApiError(res.status, body || res.statusText)
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

  archiveSession: (id: string) =>
    request<void>(`/sessions/${id}/archive`, { method: "POST" }),

  unarchiveSession: (id: string) =>
    request<void>(`/sessions/${id}/unarchive`, { method: "POST" }),

  createSession: (agentKind: AgentKind, projectId: string) =>
    request<SessionRecord>("/sessions", {
      method: "POST",
      body: JSON.stringify({ agent_kind: agentKind, project_id: projectId }),
    }),

  browseFolder: (path?: string) =>
    request<FsBrowseResponse>(
      `/fs/browse${path ? `?path=${encodeURIComponent(path)}` : ""}`
    ),

  listModels: () => request<ModelInfo[]>("/models"),

  getSettings: () => request<SettingsRecord>("/settings"),

  updateSettings: (patch: SettingsPatch) =>
    request<SettingsRecord>("/settings", {
      method: "PATCH",
      body: JSON.stringify(patch),
    }),
}
