use std::{
    str::FromStr,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
};

use axum::{
    extract::{
        ws::{Message, WebSocket, WebSocketUpgrade},
        Path, Query, State,
    },
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::get,
    Router,
};
use dashmap::{mapref::entry::Entry, DashMap};
use futures::{SinkExt, StreamExt};
use orchd_core::SessionId;
use orchd_proc::{PtyError, PtySession};
use serde::Deserialize;
use tokio::sync::broadcast;

use crate::{
    state::AppState,
    ws::verify_ws_ticket,
};

/// A raw PTY running the daemon owner's own shell, scoped to a session's
/// `cwd`. Unlike `/sessions/{id}/ws`, this carries no canonical event/command
/// protocol: bytes in are keystrokes, bytes out are terminal output, exactly
/// like the ghostty-web demo server it mirrors. It shares that route's
/// ticket-based auth because a WS upgrade can't carry the usual
/// bearer/cookie header either.
pub fn router() -> Router<AppState> {
  Router::new().route("/sessions/{id}/terminal/ws", get(handler))
}

/// How much recent output a reconnecting client gets replayed. This is a
/// flat byte cap on the raw PTY stream (escape sequences included), not a
/// line count: replaying it through the client's terminal emulator
/// reconstructs the visible screen (and reasonably deep scrollback) the way
/// a real terminal's own scrollback buffer would, without orchd needing to
/// track cursor/screen state itself.
const REPLAY_BUFFER_CAP: usize = 512 * 1024;
const BROADCAST_CAPACITY: usize = 256;

#[derive(Clone)]
enum TermEvent {
  Data(Vec<u8>),
  /// The shell process exited. Sent explicitly rather than relying on the
  /// broadcast channel's `Closed` error, because the channel's sender lives
  /// in the registry entry for the terminal's whole lifetime; it's never
  /// dropped just because the shell died.
  Closed,
}

struct TerminalEntry {
  pty: PtySession,
  output_tx: broadcast::Sender<TermEvent>,
  buffer: Mutex<Vec<u8>>,
  alive: AtomicBool,
}

/// A live terminal, shared by every client currently attached to it (usually
/// zero or one, but nothing stops two tabs opening the same session's
/// terminal and sharing it like a real multiplexer session).
#[derive(Clone)]
pub struct TerminalHandle(Arc<TerminalEntry>);

impl TerminalHandle {
  fn write(&self, data: &[u8]) -> Result<(), PtyError> {
    self.0.pty.write(data)
  }

  fn resize(&self, cols: u16, rows: u16) -> Result<(), PtyError> {
    self.0.pty.resize(cols, rows)
  }

  /// Snapshot of recent output plus a fresh subscription to everything from
  /// here on, taken together so nothing written between the two can be
  /// missed or duplicated.
  fn attach(&self) -> (Vec<u8>, broadcast::Receiver<TermEvent>) {
    let rx = self.0.output_tx.subscribe();
    let buffer = self.0.buffer.lock().expect("terminal buffer lock poisoned").clone();
    (buffer, rx)
  }

  fn is_alive(&self) -> bool {
    self.0.alive.load(Ordering::Acquire)
  }
}

/// In-memory registry of live terminals, one per session, independent of any
/// client connection: the shell keeps running (and its recent output keeps
/// buffering) for as long as the daemon is up, exactly like the session
/// actors in `orchd-session`. A dropped WS connection detaches without
/// killing anything; reconnecting (tab switch, session switch, a flaky
/// socket) re-attaches to the same shell and replays what was missed.
#[derive(Default)]
pub struct TerminalRegistry {
  terminals: DashMap<SessionId, TerminalHandle>,
}

impl TerminalRegistry {
  pub fn new() -> Self {
    Self::default()
  }

  /// Returns the session's existing terminal if one is still alive, or
  /// spawns a fresh one in `cwd`. Spawning happens inside the dashmap
  /// entry so two connections racing to attach to a brand-new session can
  /// never both spawn a shell and leak one.
  pub fn get_or_spawn(
    &self,
    session_id: SessionId,
    cwd: &str,
    cols: u16,
    rows: u16,
  ) -> Result<TerminalHandle, PtyError> {
    match self.terminals.entry(session_id) {
      Entry::Occupied(mut occupied) => {
        if occupied.get().is_alive() {
          Ok(occupied.get().clone())
        } else {
          let handle = spawn_terminal(cwd, cols, rows)?;
          occupied.insert(handle.clone());
          Ok(handle)
        }
      }
      Entry::Vacant(vacant) => {
        let handle = spawn_terminal(cwd, cols, rows)?;
        vacant.insert(handle.clone());
        Ok(handle)
      }
    }
  }
}

fn spawn_terminal(cwd: &str, cols: u16, rows: u16) -> Result<TerminalHandle, PtyError> {
  let (pty, mut output_rx) = PtySession::spawn(cwd, cols, rows)?;
  let (output_tx, _) = broadcast::channel(BROADCAST_CAPACITY);

  let entry = Arc::new(TerminalEntry {
    pty,
    output_tx: output_tx.clone(),
    buffer: Mutex::new(Vec::new()),
    alive: AtomicBool::new(true),
  });

  // Owns the PTY's mpsc receiver for the terminal's whole lifetime, fanning
  // each chunk out to every attached client and into the replay buffer.
  // Outlives any single WS connection by design.
  let task_entry = entry.clone();
  tokio::spawn(async move {
    while let Some(chunk) = output_rx.recv().await {
      {
        let mut buffer = task_entry.buffer.lock().expect("terminal buffer lock poisoned");
        buffer.extend_from_slice(&chunk);
        if buffer.len() > REPLAY_BUFFER_CAP {
          let excess = buffer.len() - REPLAY_BUFFER_CAP;
          buffer.drain(0..excess);
        }
      }
      let _ = task_entry.output_tx.send(TermEvent::Data(chunk));
    }
    task_entry.alive.store(false, Ordering::Release);
    let _ = task_entry.output_tx.send(TermEvent::Closed);
  });

  Ok(TerminalHandle(entry))
}

#[derive(Deserialize)]
struct TerminalQuery {
  ticket: Option<String>,
  #[serde(default = "default_cols")]
  cols: u16,
  #[serde(default = "default_rows")]
  rows: u16,
}

fn default_cols() -> u16 {
  80
}

fn default_rows() -> u16 {
  24
}

/// Resize control message, matching the ghostty-web demo's own wire format so
/// the frontend client logic can stay a straight port of it. Anything that
/// doesn't parse as this JSON shape is treated as raw keystroke input rather
/// than rejected, since terminal input legitimately contains `{`.
#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum ClientMessage {
  Resize { cols: u16, rows: u16 },
}

async fn handler(
  ws: WebSocketUpgrade,
  State(state): State<AppState>,
  Path(id): Path<String>,
  Query(query): Query<TerminalQuery>,
) -> Response {
  let Ok(session_id) = SessionId::from_str(&id) else {
    return StatusCode::BAD_REQUEST.into_response();
  };

  let Some(ticket) = query.ticket else {
    return StatusCode::UNAUTHORIZED.into_response();
  };
  if let Err(status) = verify_ws_ticket(state.registry.store(), &ticket).await {
    return status.into_response();
  }

  let record = match state.registry.get_record(session_id).await {
    Ok(record) => record,
    Err(_) => return StatusCode::NOT_FOUND.into_response(),
  };

  ws.on_upgrade(move |socket| run(socket, state, session_id, record.cwd, query.cols, query.rows))
}

async fn run(
  socket: WebSocket,
  state: AppState,
  session_id: SessionId,
  cwd: String,
  cols: u16,
  rows: u16,
) {
  let (mut sender, mut receiver) = socket.split();

  let handle = match state.terminals.get_or_spawn(session_id, &cwd, cols, rows) {
    Ok(handle) => handle,
    Err(err) => {
      let _ = sender
        .send(Message::Text(format!("\r\n\x1b[31mFailed to start shell: {err}\x1b[0m\r\n").into()))
        .await;
      return;
    }
  };
  // A reattaching client may have a different size than whoever last set
  // it (or than the shell was originally spawned with); sync it up front.
  let _ = handle.resize(cols, rows);

  let (replay, mut output_rx) = handle.attach();
  if !replay.is_empty() && sender.send(Message::Binary(replay.into())).await.is_err() {
    return;
  }

  loop {
    tokio::select! {
        client_msg = receiver.next() => {
            match client_msg {
                Some(Ok(Message::Text(txt))) => {
                    match serde_json::from_str::<ClientMessage>(&txt) {
                        Ok(ClientMessage::Resize { cols, rows }) => {
                            let _ = handle.resize(cols, rows);
                        }
                        Err(_) => {
                            let _ = handle.write(txt.as_bytes());
                        }
                    }
                }
                Some(Ok(Message::Binary(data))) => {
                    let _ = handle.write(&data);
                }
                Some(Ok(Message::Close(_))) | None => break,
                Some(Err(_)) => break,
                _ => {}
            }
        }

        event = output_rx.recv() => {
            match event {
                Ok(TermEvent::Data(bytes)) => {
                    // Sent as binary rather than decoded server-side: a
                    // multi-byte UTF-8 sequence can straddle two reads, and
                    // only the client's stateful `TextDecoder` (not a
                    // per-chunk lossy conversion) reassembles those
                    // correctly.
                    if sender.send(Message::Binary(bytes.into())).await.is_err() {
                        break;
                    }
                }
                Ok(TermEvent::Closed) => {
                    let _ = sender
                        .send(Message::Text("\r\n\x1b[33mShell exited\x1b[0m\r\n".into()))
                        .await;
                    break;
                }
                Err(broadcast::error::RecvError::Lagged(_)) => {
                    // A slow client just misses some intermediate output;
                    // the buffered replay on the next connection catches it
                    // back up. No durable log to resync from here, unlike
                    // the session event WS.
                }
                Err(broadcast::error::RecvError::Closed) => break,
            }
        }
    }
  }
}
