mod translator;

use orchd_core::{
  AgentAdapter, AgentCapabilities, AgentKind, Framing, LaunchSpec, SpawnSpec, Translator,
};
pub use translator::CodexTranslator;

/// Default binary name, resolved via `PATH`.
pub const CODEX_BINARY: &str = "codex";

fn capabilities() -> AgentCapabilities {
  AgentCapabilities {
    thinking: true,
    structured_tools: true,
    resume: true,
    native_permissions: true,
    skills: true,
  }
}

/// Adapter for the Codex app-server JSON-RPC protocol.
///
/// The app-server uses newline-delimited JSON-RPC on stdio. The protocol is
/// experimental and can change with the Codex CLI, so the wire translation is
/// isolated in `translator`.
pub struct CodexAdapter {
  /// Binary name or path. Overridable so tests can point at a stub.
  pub program: String,
}

impl Default for CodexAdapter {
  fn default() -> Self {
    Self { program: CODEX_BINARY.to_string() }
  }
}

impl AgentAdapter for CodexAdapter {
  fn kind(&self) -> AgentKind {
    AgentKind::Codex
  }

  fn capabilities(&self) -> AgentCapabilities {
    capabilities()
  }

  fn spawn_spec(&self, launch: &LaunchSpec) -> SpawnSpec {
    SpawnSpec {
      program: self.program.clone(),
      args: vec!["app-server".to_string(), "--stdio".to_string()],
      env: Vec::new(),
      cwd: launch.cwd.clone(),
    }
  }

  fn framing(&self) -> Framing {
    Framing::LineDelimitedJson
  }

  fn translator(&self, launch: &LaunchSpec) -> Box<dyn Translator> {
    Box::new(CodexTranslator::new(
      capabilities(),
      launch.cwd.clone(),
      launch.resume_native_session_id.clone(),
    ))
  }
}
