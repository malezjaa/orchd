use std::sync::{
  Arc,
  atomic::{AtomicBool, Ordering},
};

use orchd_core::{AgentKind, SessionCommand, SessionEvent, SessionId};
use tokio::sync::{Notify, broadcast, mpsc};

use crate::error::RegistryError;

const CMD_CHANNEL_DEPTH: usize = 64;
const EVENT_BROADCAST_DEPTH: usize = 256;

/// A cheap, cloneable reference to a live session actor. Holding one does not
/// keep the actor alive; that's the registry's job.
#[derive(Clone)]
pub struct SessionHandle {
  pub id: SessionId,
  pub agent_kind: AgentKind,
  cmd_tx: mpsc::Sender<SessionCommand>,
  events_tx: broadcast::Sender<SessionEvent>,
  /// Mirrors the actor's `turn_in_flight` so callers outside the actor can
  /// report whether the agent is working without a command round-trip.
  busy: Arc<AtomicBool>,
  stopped: Arc<Notify>,
}

impl SessionHandle {
  pub(crate) fn new_pair(
    id: SessionId,
    agent_kind: AgentKind,
  ) -> (
    Self,
    mpsc::Receiver<SessionCommand>,
    broadcast::Sender<SessionEvent>,
    Arc<AtomicBool>,
    Arc<Notify>,
  ) {
    let (cmd_tx, cmd_rx) = mpsc::channel(CMD_CHANNEL_DEPTH);
    let (events_tx, _) = broadcast::channel(EVENT_BROADCAST_DEPTH);
    let busy = Arc::new(AtomicBool::new(false));
    let stopped = Arc::new(Notify::new());
    let handle = Self {
      id,
      agent_kind,
      cmd_tx,
      events_tx: events_tx.clone(),
      busy: busy.clone(),
      stopped: stopped.clone(),
    };
    (handle, cmd_rx, events_tx, busy, stopped)
  }

  /// Whether a turn is currently in flight for this session.
  pub fn is_busy(&self) -> bool {
    self.busy.load(Ordering::Relaxed)
  }

  /// A flooding client blocks on this send; it never blocks the actor,
  /// since the channel is bounded and the actor is the only receiver.
  pub async fn send(&self, cmd: SessionCommand) -> Result<(), RegistryError> {
    self.cmd_tx.send(cmd).await.map_err(|_| RegistryError::ActorGone)
  }

  /// Live tail only. Callers that need history first must replay from
  /// the store, then subscribe to catch anything appended concurrently.
  pub fn subscribe(&self) -> broadcast::Receiver<SessionEvent> {
    self.events_tx.subscribe()
  }

  pub async fn wait_stopped(&self) {
    self.stopped.notified().await;
  }

  /// A sender into this same session's command channel, handed to the actor
  /// so its own background tasks can route work back through the normal
  /// command path.
  pub(crate) fn command_sender(&self) -> mpsc::Sender<SessionCommand> {
    self.cmd_tx.clone()
  }
}
