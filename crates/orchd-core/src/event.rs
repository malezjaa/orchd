use serde::{Deserialize, Serialize};
use time::OffsetDateTime;
use uuid::Uuid;

use crate::{
  agent::{AgentCapabilities, AgentKind},
  command::ContentPart,
  ids::{ApprovalId, BlockId, SessionId, ToolCallId, TurnId},
  permission::{Decision, PermissionRequest},
  tool::{ToolOutput, ToolRef},
};

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum StopReason {
  EndTurn,
  MaxTokens,
  Interrupted,
  Error,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CloseReason {
  ClientRequested,
  Idle,
  AgentCrash,
  Error,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ErrorScope {
  Adapter,
  Process,
  Policy,
  Store,
  Transport,
}

/// A durable, ordered event in a session's transcript. `seq` is the replay
/// cursor: clients reconnect by asking for everything with `seq > last_seq`.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct SessionEvent {
  pub session_id: SessionId,
  pub seq: u64,
  #[serde(with = "time::serde::rfc3339")]
  pub ts: OffsetDateTime,
  pub turn: TurnId,
  #[serde(flatten)]
  pub payload: EventPayload,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum EventPayload {
  SessionInit {
    agent: AgentKind,
    native_session_id: Option<String>,
    model: Option<String>,
    capabilities: AgentCapabilities,
  },

  /// The user's own message, sealed into the log the moment the actor
  /// accepts the `SessionCommand` it mirrors. Alone among these variants
  /// it is never decoded from the agent; without it the log would record
  /// the agent's replies but not the turns they were replying to.
  /// `client_msg_id` matches the command's idempotency key, so a client
  /// that already rendered this optimistically can reconcile rather than
  /// duplicate it.
  UserMessage {
    client_msg_id: Uuid,
    content: Vec<ContentPart>,
  },

  TextDelta {
    block: BlockId,
    text: String,
  },

  ThinkingDelta {
    block: BlockId,
    text: String,
    redacted: bool,
  },

  ToolCallRequested {
    call_id: ToolCallId,
    tool: ToolRef,
    input: serde_json::Value,
    needs_approval: bool,
  },

  ToolCallProgress {
    call_id: ToolCallId,
    chunk: serde_json::Value,
  },

  ToolCallCompleted {
    call_id: ToolCallId,
    output: ToolOutput,
    is_error: bool,
  },

  SkillInvoked {
    skill: String,
    args: serde_json::Value,
  },

  PermissionRequested(PermissionRequest),

  PermissionResolved {
    request_id: ApprovalId,
    decision: Decision,
  },

  UsageUpdate {
    input_tokens: u64,
    output_tokens: u64,
    /// Tokens written to the prompt cache on this turn (billed, but only
    /// once per cache entry).
    cache_creation_input_tokens: u64,
    /// Tokens served from the prompt cache on this turn. Together with
    /// `input_tokens` and `cache_creation_input_tokens`, this is the full
    /// size of the prompt the model actually read, i.e. the number to
    /// compare against a model's context window for a "context used"
    /// indicator.
    cache_read_input_tokens: u64,
    cost_usd: Option<f64>,
  },

  Error {
    scope: ErrorScope,
    code: String,
    message: String,
    recoverable: bool,
  },

  TurnCompleted {
    turn: TurnId,
    stop_reason: StopReason,
  },

  /// The agent (or our own extraction of it, see `Translator::title`) has
  /// named this session, or renamed it since the last time it did.
  TitleUpdated {
    title: String,
  },

  SessionClosed {
    reason: CloseReason,
  },
}
