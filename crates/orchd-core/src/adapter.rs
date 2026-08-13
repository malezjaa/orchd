use std::path::PathBuf;

use secrecy::SecretString;

use crate::{
  agent::{AgentCapabilities, AgentKind},
  command::SessionCommand,
  error::AdapterError,
  event::EventPayload,
  permission::{Decision, PermissionRequest},
};

/// One raw protocol message unit exchanged with an agent subprocess: one
/// line for `LineDelimitedJson`, one body for `ContentLengthJsonRpc`. Kept
/// as opaque bytes here; parsing is the translator's job, not the process
/// manager's.
#[derive(Clone, Debug)]
pub struct Frame(pub Vec<u8>);

impl Frame {
  pub fn from_json<T: serde::Serialize>(value: &T) -> Result<Self, AdapterError> {
    serde_json::to_vec(value)
      .map(Frame)
      .map_err(|err| AdapterError::Encode(err.to_string()))
  }

  pub fn as_bytes(&self) -> &[u8] {
    &self.0
  }
}

/// How raw subprocess stdout bytes are chunked into `Frame`s. Interpreted
/// by the process manager, not the adapter itself, so adapters stay free
/// of I/O concerns.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Framing {
  /// One JSON value per `\n`-terminated line (Claude Code, Cursor).
  LineDelimitedJson,
  /// `Content-Length: N\r\n\r\n<N bytes>` framing for JSON-RPC adapters
  /// that use a content-length transport.
  ContentLengthJsonRpc,
  /// No framing at all; the translator sees raw byte chunks.
  Raw,
}

/// What a session actor knows before a translator/process exists: where
/// the agent should run and whether it's resuming a prior native session.
pub struct LaunchSpec {
  pub cwd: PathBuf,
  pub resume_native_session_id: Option<String>,
}

/// Everything the process manager needs to spawn one adapter's subprocess.
/// Env values are secrecy-wrapped so API keys never land in `Debug`/logs;
/// they're injected via env, never argv (argv is world-readable in /proc).
pub struct SpawnSpec {
  pub program: String,
  pub args: Vec<String>,
  pub env: Vec<(String, SecretString)>,
  pub cwd: PathBuf,
}

/// Agent-native ⇄ canonical translation for one running session. A fresh
/// instance is created per session (see `AgentAdapter::translator`) and is
/// stateful: it tracks open content blocks, pending tool-call input
/// accumulation, and in-flight control requests across calls.
pub trait Translator: Send {
  /// Frames to send immediately after the subprocess starts. This is used by
  /// stateful protocols that require a handshake before the first command.
  fn initial_frames(&mut self) -> Result<Vec<Frame>, AdapterError> {
    Ok(vec![])
  }

  /// Agent → canonical. One inbound frame may yield zero or more
  /// canonical events.
  fn decode(&mut self, frame: Frame) -> Result<Vec<EventPayload>, AdapterError>;

  /// Frames queued while decoding an inbound message. JSON-RPC protocols can
  /// need to start a turn after the server assigns a thread id, for example.
  fn drain_outgoing(&mut self) -> Result<Vec<Frame>, AdapterError> {
    Ok(vec![])
  }

  /// Canonical command → agent-native frames written to stdin.
  fn encode(&mut self, cmd: &SessionCommand) -> Result<Vec<Frame>, AdapterError>;

  /// Map a resolved permission decision into whatever the agent expects
  /// (e.g. Claude's `can_use_tool` control-response, Codex's approval RPC).
  fn encode_decision(
    &mut self,
    req: &PermissionRequest,
    decision: &Decision,
  ) -> Result<Vec<Frame>, AdapterError>;

  /// The agent's own session id, once known (used for `--resume`-style
  /// flags on respawn). `None` until the agent has told us.
  fn native_session_id(&self) -> Option<String>;

  /// A best-effort, agent-generated session title, if this adapter's agent
  /// has any such mechanism (e.g. Claude Code names its own conversations
  /// asynchronously). `None` means "nothing yet", so callers keep whatever
  /// title they already have rather than clearing it. Checked after every
  /// `decode` call; adapters update their cached value there rather than
  /// doing I/O from this method.
  fn title(&self) -> Option<String> {
    None
  }
}

/// One adapter per agent CLI/SDK: how to launch it, how to frame its
/// stdout, and how to build a fresh translator for a session. Spawning
/// itself (sandboxing, process groups, reaping) is shared infrastructure
/// owned by `orchd-proc`, not the adapter.
pub trait AgentAdapter: Send + Sync + 'static {
  fn kind(&self) -> AgentKind;
  fn capabilities(&self) -> AgentCapabilities;

  /// Tell the process manager how to launch this agent for `launch`.
  fn spawn_spec(&self, launch: &LaunchSpec) -> SpawnSpec;

  fn framing(&self) -> Framing;

  /// Construct a fresh, stateful translator for one running session.
  fn translator(&self, launch: &LaunchSpec) -> Box<dyn Translator>;
}
