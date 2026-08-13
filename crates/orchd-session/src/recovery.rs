use std::time::Duration;

use crate::config::BackoffPolicy;

/// The decision made after one subprocess attempt fails.
pub(crate) struct RetryPlan {
  pub(crate) attempt: u32,
  pub(crate) delay: Duration,
}

/// Owns bounded crash recovery for one Session. The actor still performs the
/// process work and waits for Close commands; this module decides only whether
/// another attempt is safe and what backoff applies.
#[derive(Default)]
pub(crate) struct RecoveryState {
  failures: u32,
}

impl RecoveryState {
  /// A native session can only be retried when its adapter supports resume.
  /// Before a native ID exists, a fresh process is safe because no prior agent
  /// conversation has been established.
  pub(crate) fn next_retry(
    &mut self,
    policy: BackoffPolicy,
    has_native_session: bool,
    supports_resume: bool,
  ) -> Option<RetryPlan> {
    if self.failures >= policy.max_retries {
      return None;
    }
    if has_native_session && !supports_resume {
      return None;
    }

    let plan =
      RetryPlan { attempt: self.failures + 1, delay: policy.delay_for(self.failures) };
    self.failures += 1;
    Some(plan)
  }

  pub(crate) fn reset(&mut self) {
    self.failures = 0;
  }
}

#[cfg(test)]
mod tests {
  use std::time::Duration;

  use super::RecoveryState;
  use crate::config::BackoffPolicy;

  fn policy(max_retries: u32) -> BackoffPolicy {
    BackoffPolicy {
      base: Duration::from_millis(100),
      max: Duration::from_millis(250),
      max_retries,
    }
  }

  #[test]
  fn retries_fresh_processes_with_capped_backoff() {
    let mut recovery = RecoveryState::default();
    let policy = policy(3);

    let first = recovery.next_retry(policy, false, false).expect("first retry");
    let second = recovery.next_retry(policy, false, false).expect("second retry");
    let third = recovery.next_retry(policy, false, false).expect("third retry");

    assert_eq!(first.attempt, 1);
    assert_eq!(first.delay, Duration::from_millis(100));
    assert_eq!(second.attempt, 2);
    assert_eq!(second.delay, Duration::from_millis(200));
    assert_eq!(third.attempt, 3);
    assert_eq!(third.delay, Duration::from_millis(250));
    assert!(recovery.next_retry(policy, false, false).is_none());
  }

  #[test]
  fn native_session_requires_resume_support() {
    let mut recovery = RecoveryState::default();

    assert!(recovery.next_retry(policy(3), true, false).is_none());
    assert!(recovery.next_retry(policy(3), true, true).is_some());
  }

  #[test]
  fn clean_start_resets_the_recovery_streak() {
    let mut recovery = RecoveryState::default();
    let policy = policy(2);

    recovery.next_retry(policy, false, false).expect("retry");
    recovery.reset();

    let retry = recovery.next_retry(policy, false, false).expect("retry after reset");
    assert_eq!(retry.attempt, 1);
    assert_eq!(retry.delay, Duration::from_millis(100));
  }
}
