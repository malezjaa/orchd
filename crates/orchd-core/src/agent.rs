use serde::{Deserialize, Serialize};

/// Which underlying agent CLI/SDK a session is bound to.
///
/// `Echo` is a fake, in-process adapter that exercises the session-actor /
/// event-log / streaming spine without needing a real subprocess.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AgentKind {
  Echo,
  ClaudeCode,
  Codex,
  Aider,
  Cursor,
}

/// What a given adapter can/can't do, so the gateway and UI can degrade
/// gracefully instead of assuming every agent behaves like Claude Code.
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct AgentCapabilities {
  pub thinking: bool,
  pub structured_tools: bool,
  pub resume: bool,
  pub native_permissions: bool,
  pub skills: bool,
}
