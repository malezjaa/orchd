use serde::{Deserialize, Serialize};

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
}

/// Every model an adapter may report via `SessionInit.model` or accept via
/// `--model`, newest first within each tier.
///
/// A hardcoded snapshot, not a live lookup: there is no `claude models
/// list` (or equivalent) to query, so this has to be maintained by hand and
/// re-verified against the Anthropic model catalog as new models ship.
pub const SUPPORTED_MODELS: &[ModelInfo] = &[
  ModelInfo {
    id: "claude-fable-5",
    display_name: "Claude Fable 5",
    provider: ModelProvider::Anthropic,
    context_window: 1_000_000,
    max_output_tokens: 128_000,
  },
  ModelInfo {
    id: "claude-opus-5",
    display_name: "Claude Opus 5",
    provider: ModelProvider::Anthropic,
    context_window: 1_000_000,
    max_output_tokens: 128_000,
  },
  ModelInfo {
    id: "claude-opus-4-8",
    display_name: "Claude Opus 4.8",
    provider: ModelProvider::Anthropic,
    context_window: 1_000_000,
    max_output_tokens: 128_000,
  },
  ModelInfo {
    id: "claude-opus-4-7",
    display_name: "Claude Opus 4.7",
    provider: ModelProvider::Anthropic,
    context_window: 1_000_000,
    max_output_tokens: 128_000,
  },
  ModelInfo {
    id: "claude-opus-4-6",
    display_name: "Claude Opus 4.6",
    provider: ModelProvider::Anthropic,
    context_window: 1_000_000,
    max_output_tokens: 128_000,
  },
  ModelInfo {
    id: "claude-opus-4-5",
    display_name: "Claude Opus 4.5",
    provider: ModelProvider::Anthropic,
    context_window: 200_000,
    max_output_tokens: 64_000,
  },
  ModelInfo {
    id: "claude-opus-4-1",
    display_name: "Claude Opus 4.1",
    provider: ModelProvider::Anthropic,
    context_window: 200_000,
    max_output_tokens: 32_000,
  },
  ModelInfo {
    id: "claude-sonnet-5",
    display_name: "Claude Sonnet 5",
    provider: ModelProvider::Anthropic,
    context_window: 1_000_000,
    max_output_tokens: 128_000,
  },
  ModelInfo {
    id: "claude-sonnet-4-6",
    display_name: "Claude Sonnet 4.6",
    provider: ModelProvider::Anthropic,
    context_window: 1_000_000,
    max_output_tokens: 128_000,
  },
  ModelInfo {
    id: "claude-sonnet-4-5",
    display_name: "Claude Sonnet 4.5",
    provider: ModelProvider::Anthropic,
    context_window: 200_000,
    max_output_tokens: 64_000,
  },
  ModelInfo {
    id: "claude-haiku-4-5",
    display_name: "Claude Haiku 4.5",
    provider: ModelProvider::Anthropic,
    context_window: 200_000,
    max_output_tokens: 64_000,
  },
];

/// Looks up a model by its canonical id (as reported in `SessionInit.model`
/// or passed to `--model`). Case-sensitive and exact, with no alias
/// resolution (`opus`, `sonnet`, …), since that's the agent CLI's own job.
pub fn find_model(id: &str) -> Option<ModelInfo> {
  SUPPORTED_MODELS.iter().copied().find(|m| m.id == id)
}
