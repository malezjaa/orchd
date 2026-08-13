use std::{
  collections::VecDeque,
  sync::{Arc, atomic::AtomicBool},
};

use orchd_core::{EventPayload, SessionEvent, SessionId, StopReason, TurnId};
use orchd_store::Store;
use tokio::sync::broadcast;
use uuid::Uuid;

const DEDUP_WINDOW: usize = 256;

/// Owns the lifecycle rules shared by every session execution mode.
///
/// A Turn begins only after the actor accepts a new client message. The same
/// Turn ID is then used for the user event, agent events, and completion. The
/// actor remains the only caller, so this module does not need synchronization
/// for its own state; the atomic flag is only the read-only busy projection.
pub(crate) struct SessionLifecycle {
  seen_client_msgs: VecDeque<Uuid>,
  current_turn: TurnId,
  turn_in_flight: bool,
  busy: Arc<AtomicBool>,
}

impl SessionLifecycle {
  pub(crate) fn new(busy: Arc<AtomicBool>) -> Self {
    Self {
      seen_client_msgs: VecDeque::with_capacity(DEDUP_WINDOW),
      current_turn: TurnId::new(),
      turn_in_flight: false,
      busy,
    }
  }

  /// Accepts a message once and starts its Turn. Retries with the same client
  /// id are rejected before they can create another event or Turn.
  pub(crate) fn start_turn(&mut self, client_msg_id: Uuid) -> Option<TurnId> {
    if self.seen_client_msgs.contains(&client_msg_id) {
      return None;
    }
    if self.seen_client_msgs.len() >= DEDUP_WINDOW {
      self.seen_client_msgs.pop_front();
    }
    self.seen_client_msgs.push_back(client_msg_id);

    self.current_turn = TurnId::new();
    self.set_turn_in_flight(true);
    Some(self.current_turn)
  }

  pub(crate) fn current_turn(&self) -> TurnId {
    self.current_turn
  }

  /// Completes the current Turn and returns the canonical completion payload.
  /// Agent adapters may provide a placeholder Turn ID, so the actor always
  /// supplies this result when sealing the event.
  pub(crate) fn complete_turn(
    &mut self,
    stop_reason: StopReason,
  ) -> (TurnId, EventPayload) {
    let turn = self.current_turn;
    self.set_turn_in_flight(false);
    (turn, EventPayload::TurnCompleted { turn, stop_reason })
  }

  /// Closes an active Turn after a process interruption. No new Turn is
  /// created when the process exits while the session is idle.
  pub(crate) fn interrupt_turn(&mut self) -> Option<(TurnId, EventPayload)> {
    if !self.turn_in_flight {
      return None;
    }
    Some(self.complete_turn(StopReason::Interrupted))
  }

  fn set_turn_in_flight(&mut self, value: bool) {
    self.turn_in_flight = value;
    self.busy.store(value, std::sync::atomic::Ordering::Relaxed);
  }
}

/// Owns transcript sequencing and the durability ordering for one Session.
/// The actor still owns the Store for other session records, but all canonical
/// events cross this module before reaching live subscribers.
pub(crate) struct SessionTranscript {
  session_id: SessionId,
  store: Store,
  events_tx: broadcast::Sender<SessionEvent>,
  next_seq: u64,
}

impl SessionTranscript {
  pub(crate) fn new(
    session_id: SessionId,
    store: Store,
    events_tx: broadcast::Sender<SessionEvent>,
    next_seq: u64,
  ) -> Self {
    Self { session_id, store, events_tx, next_seq }
  }

  pub(crate) fn next_seq(&self) -> u64 {
    self.next_seq
  }

  /// Seals, persists, then publishes one event. A failed append is not
  /// published because the durable transcript is the source of truth.
  pub(crate) async fn append(&mut self, payload: EventPayload, turn: TurnId) {
    let seq = self.next_seq;
    self.next_seq += 1;

    let event = SessionEvent {
      session_id: self.session_id,
      seq,
      ts: time::OffsetDateTime::now_utc(),
      turn,
      payload,
    };

    if let Err(err) = self.store.append_event(&event).await {
      tracing::error!(session = %self.session_id, seq, error = %err, "failed to persist event");
      return;
    }

    let _ = self.events_tx.send(event);
  }
}

#[cfg(test)]
mod tests {
  use std::sync::{Arc, atomic::AtomicBool};

  use orchd_core::{EventPayload, StopReason};
  use uuid::Uuid;

  use super::SessionLifecycle;

  #[test]
  fn accepted_message_starts_one_busy_turn() {
    let busy = Arc::new(AtomicBool::new(false));
    let mut lifecycle = SessionLifecycle::new(busy.clone());
    let client_msg_id = Uuid::new_v4();

    let turn = lifecycle.start_turn(client_msg_id).expect("message is new");

    assert_eq!(lifecycle.current_turn(), turn);
    assert!(lifecycle.turn_in_flight);
    assert!(busy.load(std::sync::atomic::Ordering::Relaxed));
  }

  #[test]
  fn duplicate_message_does_not_start_another_turn() {
    let busy = Arc::new(AtomicBool::new(false));
    let mut lifecycle = SessionLifecycle::new(busy);
    let client_msg_id = Uuid::new_v4();
    let turn = lifecycle.start_turn(client_msg_id).expect("message is new");

    assert!(lifecycle.start_turn(client_msg_id).is_none());
    assert_eq!(lifecycle.current_turn(), turn);
    assert!(lifecycle.turn_in_flight);
  }

  #[test]
  fn completion_reuses_turn_and_clears_busy() {
    let busy = Arc::new(AtomicBool::new(false));
    let mut lifecycle = SessionLifecycle::new(busy.clone());
    let turn = lifecycle.start_turn(Uuid::new_v4()).expect("message is new");

    let (completed_turn, payload) = lifecycle.complete_turn(StopReason::EndTurn);

    assert_eq!(completed_turn, turn);
    assert!(
      matches!(payload, EventPayload::TurnCompleted { turn: payload_turn, stop_reason: StopReason::EndTurn } if payload_turn == turn)
    );
    assert!(!lifecycle.turn_in_flight);
    assert!(!busy.load(std::sync::atomic::Ordering::Relaxed));
  }

  #[test]
  fn idle_process_exit_does_not_create_a_completion() {
    let busy = Arc::new(AtomicBool::new(false));
    let mut lifecycle = SessionLifecycle::new(busy);

    assert!(lifecycle.interrupt_turn().is_none());
  }
}
