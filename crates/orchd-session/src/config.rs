use std::time::Duration;

/// Governs how a session actor retries a crashed agent subprocess. The delay
/// doubles each attempt starting from `base`, capped at `max`; after
/// `max_retries` consecutive failures the session is marked `failed`.
#[derive(Clone, Copy, Debug)]
pub struct BackoffPolicy {
  pub base: Duration,
  pub max: Duration,
  pub max_retries: u32,
}

impl BackoffPolicy {
  /// Delay before the `attempt`-th retry (0-indexed: the first retry
  /// after the initial crash is `attempt = 0`).
  pub fn delay_for(&self, attempt: u32) -> Duration {
    let scale = 1u32.checked_shl(attempt).unwrap_or(u32::MAX);
    self.base.saturating_mul(scale).min(self.max)
  }
}

impl Default for BackoffPolicy {
  fn default() -> Self {
    Self {
      base: Duration::from_millis(500),
      max: Duration::from_secs(30),
      max_retries: 5,
    }
  }
}

/// What happens when a session sits idle for longer than `timeout`: a
/// background refactor should keep going, an interactive chat shouldn't burn
/// tokens unattended. A `Pause` tier (stop at the next turn boundary but keep
/// the process warm) is deliberately absent, since without a
/// subprocess-suspend mechanism it costs the same as `Close`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum IdleAction {
  Keep,
  Close,
}

#[derive(Clone, Copy, Debug)]
pub struct IdlePolicy {
  /// `None` disables idle enforcement entirely.
  pub timeout: Option<Duration>,
  pub action: IdleAction,
}

impl Default for IdlePolicy {
  fn default() -> Self {
    Self { timeout: None, action: IdleAction::Close }
  }
}

#[derive(Clone, Copy, Debug, Default)]
pub struct ActorConfig {
  pub backoff: BackoffPolicy,
  pub idle: IdlePolicy,
}

impl ActorConfig {
  /// Reads `ORCHD_IDLE_TIMEOUT_SECS` (unset or `0` disables idle
  /// enforcement), `ORCHD_IDLE_ACTION` (`keep` | `close`, default `close`),
  /// `ORCHD_BACKOFF_BASE_MS`, `ORCHD_BACKOFF_MAX_SECS`, and
  /// `ORCHD_MAX_RETRIES`. Malformed values fall back to defaults rather than
  /// failing startup: this tunes recovery behavior, not correctness.
  pub fn from_env() -> Self {
    let idle_timeout = std::env::var("ORCHD_IDLE_TIMEOUT_SECS")
      .ok()
      .and_then(|s| s.parse::<u64>().ok())
      .filter(|secs| *secs > 0)
      .map(Duration::from_secs);

    let idle_action = match std::env::var("ORCHD_IDLE_ACTION").as_deref() {
      Ok("keep") => IdleAction::Keep,
      _ => IdleAction::Close,
    };

    let mut backoff = BackoffPolicy::default();
    if let Some(ms) =
      std::env::var("ORCHD_BACKOFF_BASE_MS").ok().and_then(|s| s.parse::<u64>().ok())
    {
      backoff.base = Duration::from_millis(ms);
    }
    if let Some(secs) =
      std::env::var("ORCHD_BACKOFF_MAX_SECS").ok().and_then(|s| s.parse::<u64>().ok())
    {
      backoff.max = Duration::from_secs(secs);
    }
    if let Some(n) =
      std::env::var("ORCHD_MAX_RETRIES").ok().and_then(|s| s.parse::<u32>().ok())
    {
      backoff.max_retries = n;
    }

    Self { backoff, idle: IdlePolicy { timeout: idle_timeout, action: idle_action } }
  }
}
