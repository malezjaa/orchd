mod title_generation;
mod translator;

use orchd_core::{
  AgentAdapter, AgentCapabilities, AgentKind, FILE_MENTION_INSTRUCTIONS, Framing,
  LaunchSpec, SpawnSpec, Translator,
};
pub use title_generation::{
  TitleGenerationError, generate_initial_title, regenerate_title,
};
pub use translator::ClaudeCodeTranslator;

/// Default binary name, resolved via `PATH`. Title generation uses this
/// constant rather than an adapter instance, since it runs in parallel with a
/// session's own agent subprocess.
pub const CLAUDE_BINARY: &str = "claude";

/// Pinned via `--model` on a brand-new session so it never silently launches
/// on whatever the CLI's built-in default happens to be.
const DEFAULT_MODEL: &str = "claude-sonnet-5";

/// Adapter for the `claude` CLI driven in headless stream-json mode.
///
/// Flags and protocol were verified against CLI version 2.1.223; they drift
/// between releases, so re-check them against whatever `claude --version`
/// reports on a deployment.
pub struct ClaudeCodeAdapter {
  /// Binary name or path. Overridable so tests can point at a stub.
  pub program: String,
}

impl Default for ClaudeCodeAdapter {
  fn default() -> Self {
    Self { program: CLAUDE_BINARY.to_string() }
  }
}

fn capabilities() -> AgentCapabilities {
  AgentCapabilities {
    thinking: true,
    structured_tools: true,
    resume: true,
    native_permissions: true,
    skills: true,
  }
}

impl AgentAdapter for ClaudeCodeAdapter {
  fn kind(&self) -> AgentKind {
    AgentKind::ClaudeCode
  }

  fn capabilities(&self) -> AgentCapabilities {
    capabilities()
  }

  fn spawn_spec(&self, launch: &LaunchSpec) -> SpawnSpec {
    let mut args = vec![
      "-p".to_string(),
      "--input-format".to_string(),
      "stream-json".to_string(),
      "--output-format".to_string(),
      "stream-json".to_string(),
      "--include-partial-messages".to_string(),
      "--verbose".to_string(),
      "--append-system-prompt".to_string(),
      FILE_MENTION_INSTRUCTIONS.to_string(),
      // The CLI blocks on its own `can_use_tool` control requests, which the
      // session actor answers from policy or a human decision, making the
      // server the real gate rather than the CLI's own prompts.
      "--permission-mode".to_string(),
      "default".to_string(),
    ];
    if let Some(id) = &launch.resume_native_session_id {
      args.push("--resume".to_string());
      args.push(id.clone());
    } else {
      // A resumed session omits `--model` so it keeps whatever it was last
      // switched to.
      args.push("--model".to_string());
      args.push(launch.model.as_deref().unwrap_or(DEFAULT_MODEL).to_string());
    }

    SpawnSpec {
      program: self.program.clone(),
      args,
      env: Vec::new(),
      cwd: launch.cwd.clone(),
    }
  }

  fn framing(&self) -> Framing {
    Framing::LineDelimitedJson
  }

  fn translator(&self, launch: &LaunchSpec) -> Box<dyn Translator> {
    Box::new(ClaudeCodeTranslator::new(
      capabilities(),
      launch.resume_native_session_id.clone(),
      launch.cwd.clone(),
    ))
  }
}
