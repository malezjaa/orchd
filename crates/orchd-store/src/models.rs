use orchd_core::{AgentKind, ProjectId, SessionId, SubagentStatus};
use serde::{Deserialize, Serialize};
use time::OffsetDateTime;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SessionStatus {
  Creating,
  Running,
  Interrupted,
  Failed,
  Closed,
}

impl SessionStatus {
  pub fn as_str(&self) -> &'static str {
    match self {
      SessionStatus::Creating => "creating",
      SessionStatus::Running => "running",
      SessionStatus::Interrupted => "interrupted",
      SessionStatus::Failed => "failed",
      SessionStatus::Closed => "closed",
    }
  }

  pub fn parse(s: &str) -> Self {
    match s {
      "creating" => SessionStatus::Creating,
      "running" => SessionStatus::Running,
      "interrupted" => SessionStatus::Interrupted,
      "failed" => SessionStatus::Failed,
      "closed" => SessionStatus::Closed,
      other => panic!("unknown session status in store: {other}"),
    }
  }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ApprovalStatus {
  Pending,
  Allowed,
  Denied,
  Expired,
}

impl ApprovalStatus {
  pub fn as_str(&self) -> &'static str {
    match self {
      ApprovalStatus::Pending => "pending",
      ApprovalStatus::Allowed => "allowed",
      ApprovalStatus::Denied => "denied",
      ApprovalStatus::Expired => "expired",
    }
  }
}

fn agent_kind_str(kind: AgentKind) -> &'static str {
  match kind {
    AgentKind::Echo => "echo",
    AgentKind::ClaudeCode => "claude_code",
    AgentKind::Codex => "codex",
    AgentKind::Aider => "aider",
    AgentKind::Cursor => "cursor",
  }
}

fn parse_agent_kind(s: &str) -> AgentKind {
  match s {
    "echo" => AgentKind::Echo,
    "claude_code" => AgentKind::ClaudeCode,
    "codex" => AgentKind::Codex,
    "aider" => AgentKind::Aider,
    "cursor" => AgentKind::Cursor,
    other => panic!("unknown agent kind in store: {other}"),
  }
}

pub(crate) fn agent_kind_to_sql(kind: AgentKind) -> &'static str {
  agent_kind_str(kind)
}

pub(crate) fn agent_kind_from_sql(s: &str) -> AgentKind {
  parse_agent_kind(s)
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ProjectRecord {
  pub id: ProjectId,
  pub name: String,
  /// Absolute path on disk. Every session opened under this project
  /// resolves its `cwd` from here rather than accepting one directly from
  /// the client.
  pub path: String,
  /// `None` for active projects. Archiving hides a project (and its
  /// sessions) from the default list without the hard FK-rejection
  /// `delete_project` applies while sessions still reference it.
  #[serde(with = "time::serde::rfc3339::option")]
  pub archived_at: Option<OffsetDateTime>,
  #[serde(with = "time::serde::rfc3339")]
  pub created_at: OffsetDateTime,
  #[serde(with = "time::serde::rfc3339")]
  pub updated_at: OffsetDateTime,
}

/// A paired device. The bearer/cookie token itself is never stored or
/// returned again after the exchange that created it: only its hash lives
/// in the store, and this record type carries neither.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ClientSessionRecord {
  pub id: String,
  pub device_label: Option<String>,
  #[serde(with = "time::serde::rfc3339")]
  pub created_at: OffsetDateTime,
  #[serde(with = "time::serde::rfc3339")]
  pub last_seen_at: OffsetDateTime,
  #[serde(with = "time::serde::rfc3339")]
  pub expires_at: OffsetDateTime,
  #[serde(with = "time::serde::rfc3339::option")]
  pub revoked_at: Option<OffsetDateTime>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct SettingsRecord {
  pub interface_font: Option<String>,
  pub interface_font_size: Option<String>,
  pub mono_font: Option<String>,
  pub mono_font_size: Option<String>,
  pub time_format: Option<String>,
  pub code_theme: Option<String>,
  pub model: Option<String>,
  pub reasoning_effort: Option<String>,
  #[serde(with = "time::serde::rfc3339")]
  pub updated_at: OffsetDateTime,
}

/// A partial update to `SettingsRecord`. Each field is `Option<Option<_>>`
/// so the outer `None` means "leave this setting alone" while `Some(None)`
/// means "clear it back to the default", a plain `Option<String>` can't
/// tell those two apart.
#[derive(Clone, Debug, Default, Deserialize)]
pub struct SettingsPatch {
  #[serde(default)]
  pub interface_font: Option<Option<String>>,
  #[serde(default)]
  pub interface_font_size: Option<Option<String>>,
  #[serde(default)]
  pub mono_font: Option<Option<String>>,
  #[serde(default)]
  pub mono_font_size: Option<Option<String>>,
  #[serde(default)]
  pub time_format: Option<Option<String>>,
  #[serde(default)]
  pub code_theme: Option<Option<String>>,
  #[serde(default)]
  pub model: Option<Option<String>>,
  #[serde(default)]
  pub reasoning_effort: Option<Option<String>>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct SessionRecord {
  pub id: SessionId,
  pub agent_kind: AgentKind,
  /// `None` only for sessions created before projects existed; every
  /// session created going forward always has one.
  pub project_id: Option<ProjectId>,
  pub cwd: String,
  pub status: SessionStatus,
  /// The underlying agent CLI's own session id, once known (e.g. Claude
  /// Code's `--resume` target). `None` until the adapter's translator has
  /// reported one, and for adapters that don't support resume at all.
  pub native_session_id: Option<String>,
  /// The OS process-group id of the currently (or last) spawned
  /// subprocess, persisted so a fresh server boot can reap it if the
  /// previous `orchd` process died without a chance to kill its children.
  pub pgid: Option<i64>,
  /// Best-effort, adapter-dependent session title (e.g. Claude Code's own
  /// generated `ai-title`). `None` until the adapter reports one, and for
  /// adapters that don't have such a mechanism at all.
  pub title: Option<String>,
  /// The model the agent is actually running, as reported in
  /// `SessionInit.model`. `None` until the adapter reports one, and for
  /// adapters (like the echo test adapter) that never report a model.
  pub model: Option<String>,
  /// Running total of context tokens the model has read as of the latest
  /// `UsageUpdate` (input + cache-read + cache-creation), to compare
  /// against `orchd_core::find_model(model).context_window` for a "context
  /// used" indicator. `None` until the first `UsageUpdate`.
  pub context_tokens_used: Option<i64>,
  /// `None` for active sessions. Archiving hides a session from the
  /// default list without touching `status` or its live process, the
  /// session-level analog of `ProjectRecord::archived_at`.
  #[serde(with = "time::serde::rfc3339::option")]
  pub archived_at: Option<OffsetDateTime>,
  /// `None` for unpinned sessions. Pinned sessions are listed first in the
  /// sidebar while retaining their creation order within each group.
  #[serde(with = "time::serde::rfc3339::option")]
  pub pinned_at: Option<OffsetDateTime>,
  #[serde(with = "time::serde::rfc3339")]
  pub created_at: OffsetDateTime,
  #[serde(with = "time::serde::rfc3339")]
  pub updated_at: OffsetDateTime,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct SubagentRecord {
  pub parent_session_id: SessionId,
  pub thread_id: String,
  pub nickname: Option<String>,
  pub role: Option<String>,
  pub prompt: Option<String>,
  pub model: Option<String>,
  pub effort: Option<String>,
  pub status: SubagentStatus,
  pub message: Option<String>,
  pub summary: Option<String>,
  pub can_accept_direct_input: Option<bool>,
  pub active_turn_id: Option<String>,
  #[serde(with = "time::serde::rfc3339")]
  pub created_at: OffsetDateTime,
  #[serde(with = "time::serde::rfc3339")]
  pub updated_at: OffsetDateTime,
}
