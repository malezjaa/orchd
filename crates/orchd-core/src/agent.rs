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
  #[serde(default)]
  pub subagents: bool,
}

#[cfg(test)]
mod tests {
  use super::AgentCapabilities;

  #[test]
  fn older_capabilities_default_subagents_to_disabled() {
    let capabilities: AgentCapabilities = serde_json::from_str(
      r#"{
        "thinking": true,
        "structured_tools": true,
        "resume": true,
        "native_permissions": true,
        "skills": true
      }"#,
    )
    .expect("legacy capabilities should remain readable");

    assert!(!capabilities.subagents);
  }
}
