use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{ids::ApprovalId, permission::Decision};

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ContentPart {
  Text {
    text: String,
  },
  /// A user-selected agent skill. The UI uses `/name`; adapters translate
  /// that product syntax to the native invocation syntax for each agent.
  Skill {
    name: String,
    #[serde(default)]
    path: Option<String>,
  },
  /// An image pasted or selected in the client. `data` is base64-encoded
  /// bytes without the data-URL prefix so each adapter can use its native
  /// image input shape.
  Image {
    media_type: String,
    data: String,
    #[serde(default)]
    name: Option<String>,
  },
}

/// Placeholder for the auto-approve policy DSL; carried through the command
/// enum now so the wire schema doesn't need to change once it lands.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct PolicyPatch {
  pub rules: serde_json::Value,
}

/// How the agent is willing to act. Independent of the policy engine
/// (`PolicyPatch`/`UpdatePolicy`), which gates what gets auto-approved
/// rather than what the agent attempts in the first place. Maps to Claude
/// Code's own `--permission-mode`/`set_permission_mode` values (verified
/// against the installed CLI, 2.1.224); the native string for each variant
/// lives in the adapter's translator, not here.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AgentMode {
  /// Acts directly, subject to the policy engine's own gating.
  Build,
  /// Researches and proposes a plan without making changes.
  Plan,
}

/// Extended-thinking depth. Adapters forward the selected value using the
/// vocabulary advertised by the selected model. Claude Code currently uses
/// the first five values; Codex also advertises `ultra` for some models.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ThinkingEffort {
  Low,
  Medium,
  High,
  Xhigh,
  Max,
  Ultra,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum SessionCommand {
  /// `client_msg_id` is the idempotency key: the actor dedups on it so a
  /// client retry after a flaky connection can't double-send a message.
  UserMessage {
    client_msg_id: Uuid,
    content: Vec<ContentPart>,
  },
  ResolveApproval {
    request_id: ApprovalId,
    decision: Decision,
  },
  Interrupt,
  UpdatePolicy(PolicyPatch),
  /// Switches build/plan mode for a live session. Sent immediately (not
  /// bundled with the next `UserMessage`) so the effect is visible before
  /// the next turn starts. A no-op for adapters that don't support it
  /// (`AgentCapabilities` doesn't currently model this, so it's silently
  /// dropped by `encode` rather than surfaced as an error).
  SetMode {
    mode: AgentMode,
  },
  /// Switches the running model and/or thinking effort for a live session.
  /// Either field may be omitted to leave that one alone, mirroring Claude
  /// Code's own `set_model` control request.
  SetModel {
    model: Option<String>,
    effort: Option<ThinkingEffort>,
    /// Codex Fast mode. `None` leaves the current service-tier preference
    /// unchanged, while `Some(false)` explicitly requests standard speed.
    #[serde(default)]
    fast_mode: Option<bool>,
  },
  Close {
    reason: crate::event::CloseReason,
  },
  /// Sets a user-authored title. The REST API persists it first, then routes
  /// this command through a live actor so the open session receives the same
  /// `title_updated` event as generated titles.
  RenameTitle {
    title: String,
  },
  /// Client-triggered: re-derive the session's title from how the
  /// conversation has evolved, replacing whatever title is set now (see
  /// the sidebar's "Regenerate title" action).
  RegenerateTitle,
  SendSubagentInput {
    thread_id: String,
    content: Vec<ContentPart>,
  },
  InterruptSubagent {
    thread_id: String,
  },
  InspectSubagent {
    thread_id: String,
  },
  /// Internal: the actor sends this to itself when a background
  /// title-generation subprocess completes (see
  /// `SessionActor::spawn_title_generation`). `epoch` is compared against
  /// the actor's own counter so a slow, superseded generation can't
  /// clobber a newer one; a stale or unmatched epoch is silently ignored.
  /// That same check makes it harmless if a client sends it directly.
  TitleGenerationCompleted {
    epoch: u64,
    title: Option<String>,
  },
}
