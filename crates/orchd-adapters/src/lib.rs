pub mod claude_code;
pub mod codex;

use orchd_core::{AgentAdapter, AgentKind};

/// Looks up the subprocess-backed adapter for `kind`. `Echo` intentionally has
/// none: it's an in-process fake the session actor handles directly.
pub fn adapter_for(kind: AgentKind) -> Option<Box<dyn AgentAdapter>> {
  match kind {
    AgentKind::ClaudeCode => Some(Box::new(claude_code::ClaudeCodeAdapter::default())),
    AgentKind::Codex => Some(Box::new(codex::CodexAdapter::default())),
    AgentKind::Echo | AgentKind::Aider | AgentKind::Cursor => None,
  }
}
