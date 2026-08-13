use serde::{Deserialize, Serialize};

use crate::command::ThinkingEffort;

#[derive(Clone, Copy, Debug, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ModelProvider {
  Anthropic,
  OpenAi,
}

/// A model orchd knows how to run, along with the numbers a client needs to
/// render a context-usage indicator: `context_window` is the total tokens a
/// turn's prompt (input + cached) can hold, `max_output_tokens` is the cap
/// on a single response.
#[derive(Clone, Copy, Debug, Serialize, Deserialize)]
pub struct ModelInfo {
  pub id: &'static str,
  pub display_name: &'static str,
  pub provider: ModelProvider,
  pub context_window: u32,
  pub max_output_tokens: u32,
  #[serde(skip_deserializing)]
  pub supported_reasoning_efforts: &'static [ThinkingEffort],
  pub default_reasoning_effort: ThinkingEffort,
  pub supports_fast_mode: bool,
}

const CLAUDE_REASONING_EFFORTS: &[ThinkingEffort] = &[
  ThinkingEffort::Low,
  ThinkingEffort::Medium,
  ThinkingEffort::High,
  ThinkingEffort::Xhigh,
  ThinkingEffort::Max,
];

const CODEX_REASONING_EFFORTS: &[ThinkingEffort] = &[
  ThinkingEffort::Low,
  ThinkingEffort::Medium,
  ThinkingEffort::High,
  ThinkingEffort::Xhigh,
];

const CODEX_MAX_REASONING_EFFORTS: &[ThinkingEffort] = &[
  ThinkingEffort::Low,
  ThinkingEffort::Medium,
  ThinkingEffort::High,
  ThinkingEffort::Xhigh,
  ThinkingEffort::Max,
];

const CODEX_ULTRA_REASONING_EFFORTS: &[ThinkingEffort] = &[
  ThinkingEffort::Low,
  ThinkingEffort::Medium,
  ThinkingEffort::High,
  ThinkingEffort::Xhigh,
  ThinkingEffort::Max,
  ThinkingEffort::Ultra,
];

/// Every model an adapter may report via `SessionInit.model` or accept via
/// `--model`, newest first within each tier.
///
/// A hardcoded snapshot, not a live lookup: neither adapter exposes a stable
/// cross-provider model catalog that orchd can query, so this has to be
/// maintained by hand and re-verified as new models ship.
pub const SUPPORTED_MODELS: &[ModelInfo] = &[
  ModelInfo {
    id: "claude-fable-5",
    display_name: "Claude Fable 5",
    provider: ModelProvider::Anthropic,
    context_window: 1_000_000,
    max_output_tokens: 128_000,
    supported_reasoning_efforts: CLAUDE_REASONING_EFFORTS,
    default_reasoning_effort: ThinkingEffort::Medium,
    supports_fast_mode: false,
  },
  ModelInfo {
    id: "claude-opus-5",
    display_name: "Claude Opus 5",
    provider: ModelProvider::Anthropic,
    context_window: 1_000_000,
    max_output_tokens: 128_000,
    supported_reasoning_efforts: CLAUDE_REASONING_EFFORTS,
    default_reasoning_effort: ThinkingEffort::Medium,
    supports_fast_mode: false,
  },
  ModelInfo {
    id: "claude-opus-4-8",
    display_name: "Claude Opus 4.8",
    provider: ModelProvider::Anthropic,
    context_window: 1_000_000,
    max_output_tokens: 128_000,
    supported_reasoning_efforts: CLAUDE_REASONING_EFFORTS,
    default_reasoning_effort: ThinkingEffort::Medium,
    supports_fast_mode: false,
  },
  ModelInfo {
    id: "claude-opus-4-7",
    display_name: "Claude Opus 4.7",
    provider: ModelProvider::Anthropic,
    context_window: 1_000_000,
    max_output_tokens: 128_000,
    supported_reasoning_efforts: CLAUDE_REASONING_EFFORTS,
    default_reasoning_effort: ThinkingEffort::Medium,
    supports_fast_mode: false,
  },
  ModelInfo {
    id: "claude-opus-4-6",
    display_name: "Claude Opus 4.6",
    provider: ModelProvider::Anthropic,
    context_window: 1_000_000,
    max_output_tokens: 128_000,
    supported_reasoning_efforts: CLAUDE_REASONING_EFFORTS,
    default_reasoning_effort: ThinkingEffort::Medium,
    supports_fast_mode: false,
  },
  ModelInfo {
    id: "claude-opus-4-5",
    display_name: "Claude Opus 4.5",
    provider: ModelProvider::Anthropic,
    context_window: 200_000,
    max_output_tokens: 64_000,
    supported_reasoning_efforts: CLAUDE_REASONING_EFFORTS,
    default_reasoning_effort: ThinkingEffort::Medium,
    supports_fast_mode: false,
  },
  ModelInfo {
    id: "claude-opus-4-1",
    display_name: "Claude Opus 4.1",
    provider: ModelProvider::Anthropic,
    context_window: 200_000,
    max_output_tokens: 32_000,
    supported_reasoning_efforts: CLAUDE_REASONING_EFFORTS,
    default_reasoning_effort: ThinkingEffort::Medium,
    supports_fast_mode: false,
  },
  ModelInfo {
    id: "claude-sonnet-5",
    display_name: "Claude Sonnet 5",
    provider: ModelProvider::Anthropic,
    context_window: 1_000_000,
    max_output_tokens: 128_000,
    supported_reasoning_efforts: CLAUDE_REASONING_EFFORTS,
    default_reasoning_effort: ThinkingEffort::Medium,
    supports_fast_mode: false,
  },
  ModelInfo {
    id: "claude-sonnet-4-6",
    display_name: "Claude Sonnet 4.6",
    provider: ModelProvider::Anthropic,
    context_window: 1_000_000,
    max_output_tokens: 128_000,
    supported_reasoning_efforts: CLAUDE_REASONING_EFFORTS,
    default_reasoning_effort: ThinkingEffort::Medium,
    supports_fast_mode: false,
  },
  ModelInfo {
    id: "claude-sonnet-4-5",
    display_name: "Claude Sonnet 4.5",
    provider: ModelProvider::Anthropic,
    context_window: 200_000,
    max_output_tokens: 64_000,
    supported_reasoning_efforts: CLAUDE_REASONING_EFFORTS,
    default_reasoning_effort: ThinkingEffort::Medium,
    supports_fast_mode: false,
  },
  ModelInfo {
    id: "claude-haiku-4-5",
    display_name: "Claude Haiku 4.5",
    provider: ModelProvider::Anthropic,
    context_window: 200_000,
    max_output_tokens: 64_000,
    supported_reasoning_efforts: CLAUDE_REASONING_EFFORTS,
    default_reasoning_effort: ThinkingEffort::Medium,
    supports_fast_mode: false,
  },
  ModelInfo {
    id: "gpt-5.6-sol",
    display_name: "GPT-5.6 Sol",
    provider: ModelProvider::OpenAi,
    context_window: 272_000,
    max_output_tokens: 128_000,
    supported_reasoning_efforts: CODEX_ULTRA_REASONING_EFFORTS,
    default_reasoning_effort: ThinkingEffort::Low,
    supports_fast_mode: true,
  },
  ModelInfo {
    id: "gpt-5.6-terra",
    display_name: "GPT-5.6 Terra",
    provider: ModelProvider::OpenAi,
    context_window: 272_000,
    max_output_tokens: 128_000,
    supported_reasoning_efforts: CODEX_ULTRA_REASONING_EFFORTS,
    default_reasoning_effort: ThinkingEffort::Medium,
    supports_fast_mode: true,
  },
  ModelInfo {
    id: "gpt-5.6-luna",
    display_name: "GPT-5.6 Luna",
    provider: ModelProvider::OpenAi,
    context_window: 272_000,
    max_output_tokens: 128_000,
    supported_reasoning_efforts: CODEX_MAX_REASONING_EFFORTS,
    default_reasoning_effort: ThinkingEffort::Medium,
    supports_fast_mode: true,
  },
  ModelInfo {
    id: "gpt-5.5",
    display_name: "GPT-5.5",
    provider: ModelProvider::OpenAi,
    context_window: 272_000,
    max_output_tokens: 128_000,
    supported_reasoning_efforts: CODEX_REASONING_EFFORTS,
    default_reasoning_effort: ThinkingEffort::Medium,
    supports_fast_mode: true,
  },
  ModelInfo {
    id: "gpt-5.4",
    display_name: "GPT-5.4",
    provider: ModelProvider::OpenAi,
    context_window: 272_000,
    max_output_tokens: 128_000,
    supported_reasoning_efforts: CODEX_REASONING_EFFORTS,
    default_reasoning_effort: ThinkingEffort::Medium,
    supports_fast_mode: true,
  },
  ModelInfo {
    id: "gpt-5.4-mini",
    display_name: "GPT-5.4 Mini",
    provider: ModelProvider::OpenAi,
    context_window: 272_000,
    max_output_tokens: 128_000,
    supported_reasoning_efforts: CODEX_REASONING_EFFORTS,
    default_reasoning_effort: ThinkingEffort::Medium,
    supports_fast_mode: false,
  },
];

/// Looks up a model by its canonical id (as reported in `SessionInit.model`
/// or passed to `--model`). Case-sensitive and exact, with no alias
/// resolution (`opus`, `sonnet`, …), since that's the agent CLI's own job.
pub fn find_model(id: &str) -> Option<ModelInfo> {
  SUPPORTED_MODELS.iter().copied().find(|m| m.id == id)
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn catalog_exposes_model_specific_reasoning_and_speed_support() {
    let sol = find_model("gpt-5.6-sol").unwrap();
    assert_eq!(sol.default_reasoning_effort, ThinkingEffort::Low);
    assert!(sol.supported_reasoning_efforts.contains(&ThinkingEffort::Ultra));
    assert!(sol.supports_fast_mode);

    let mini = find_model("gpt-5.4-mini").unwrap();
    assert!(!mini.supported_reasoning_efforts.contains(&ThinkingEffort::Ultra));
    assert!(!mini.supports_fast_mode);
  }
}
