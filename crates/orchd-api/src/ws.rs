use std::str::FromStr;

use axum::{
  Router,
  extract::{
    Path, Query, State,
    ws::{Message, WebSocket, WebSocketUpgrade},
  },
  response::{IntoResponse, Response},
  routing::get,
};
use futures::{SinkExt, StreamExt};
use orchd_core::{SessionCommand, SessionEvent, SessionId};
use serde::{Deserialize, Serialize};
use tokio::sync::broadcast;

use crate::state::AppState;

pub fn router() -> Router<AppState> {
  Router::new().route("/sessions/{id}/ws", get(handler))
}

/// Browsers can't set custom headers on a WS upgrade request, so the usual
/// `Authorization`/cookie check doesn't reach this route. The client instead
/// calls `POST /auth/websocket-ticket` behind the normal session middleware
/// and appends only the resulting short-lived, single-use ticket here, keeping
/// the durable credential out of socket URLs, server logs and browser history.
#[derive(Deserialize)]
struct WsAuthQuery {
  ticket: Option<String>,
}

/// Wire envelope from client to server. The first message should be `Resume`
/// (`last_seq: 0` for a brand-new client); it can be re-sent later to force a
/// resync.
#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum ClientMessage {
  Resume { last_seq: u64 },
  Command { payload: SessionCommand },
}

/// Wire envelope from server to client. Adjacently tagged because
/// `SessionEvent` flattens an `EventPayload` that is itself tagged `type`, so
/// internal tagging here would collide with that inner field.
#[derive(Serialize)]
#[serde(tag = "type", content = "payload", rename_all = "snake_case")]
enum ServerMessage {
  Event(SessionEvent),
  /// The live broadcast lagged and skipped events in memory; the log itself
  /// is intact and is about to be replayed.
  Resyncing {
    from_seq: u64,
  },
  /// History replay is done: every `Event` after this one is live. Replay and
  /// live delivery use an identical `Event` shape, so this is the only way a
  /// client can tell "this just happened" (worth animating) from "this is
  /// state being restored on reconnect".
  Resumed,
  Error {
    message: String,
  },
}

async fn handler(
  ws: WebSocketUpgrade,
  State(state): State<AppState>,
  Path(id): Path<String>,
  Query(auth): Query<WsAuthQuery>,
) -> Response {
  let Ok(session_id) = SessionId::from_str(&id) else {
    return axum::http::StatusCode::BAD_REQUEST.into_response();
  };

  let Some(ticket) = auth.ticket else {
    return axum::http::StatusCode::UNAUTHORIZED.into_response();
  };
  match state.registry.store().consume_ws_ticket(&ticket).await {
    Ok(Some(_)) => {}
    Ok(None) => return axum::http::StatusCode::UNAUTHORIZED.into_response(),
    Err(_) => return axum::http::StatusCode::INTERNAL_SERVER_ERROR.into_response(),
  }

  // Respawns an actor for a session that exists in the store but has none
  // (`interrupted` after a server restart), so a reconnecting client resumes
  // transparently.
  let handle = match state.registry.get_or_resume(session_id).await {
    Ok(handle) => Some(handle),
    Err(_) => {
      // `get_or_resume` refuses to reanimate closed/failed sessions, which is
      // right for commands but shouldn't block viewing the transcript. If the
      // session exists at all, attach read-only: replay works off the durable
      // log whether or not an actor is running.
      if state.registry.get_record(session_id).await.is_err() {
        return axum::http::StatusCode::NOT_FOUND.into_response();
      }
      None
    }
  };

  ws.on_upgrade(move |socket| run(socket, state, session_id, handle))
}

async fn run(
  socket: WebSocket,
  state: AppState,
  session_id: SessionId,
  handle: Option<orchd_session::SessionHandle>,
) {
  let (mut sender, mut receiver) = socket.split();

  // Subscribe before replaying from the store: an event appended while we're
  // reading history then shows up in this receiver and gets deduped by seq
  // below, rather than being missed entirely. `None` for a read-only session,
  // which has no live actor to broadcast anything.
  let mut live_rx = handle.as_ref().map(|h| h.subscribe());
  let mut last_sent_seq: u64 = 0;
  let mut attached = false;

  loop {
    tokio::select! {
        biased;

        client_msg = receiver.next() => {
            match client_msg {
                Some(Ok(Message::Text(txt))) => {
                    match serde_json::from_str::<ClientMessage>(&txt) {
                        Ok(ClientMessage::Resume { last_seq }) => {
                            attached = true;
                            if !replay_from(&state, session_id, last_seq, &mut last_sent_seq, &mut sender).await {
                                break;
                            }
                            if send_msg(&mut sender, &ServerMessage::Resumed).await.is_err() {
                                break;
                            }
                        }
                        Ok(ClientMessage::Command { payload }) => {
                            match &handle {
                                Some(handle) => {
                                    if let Err(err) = handle.send(payload).await {
                                        let _ = send_msg(&mut sender, &ServerMessage::Error { message: err.to_string() }).await;
                                    }
                                }
                                None => {
                                    let _ = send_msg(&mut sender, &ServerMessage::Error { message: "session is closed and read-only".into() }).await;
                                }
                            }
                        }
                        Err(err) => {
                            let _ = send_msg(&mut sender, &ServerMessage::Error { message: format!("bad message: {err}") }).await;
                        }
                    }
                }
                Some(Ok(Message::Close(_))) | None => {
                    // The session actor keeps running independently, so a
                    // client disconnect needs no cleanup.
                    break;
                }
                Some(Err(_)) => break,
                _ => {}
            }
        }

        live_event = recv_live(&mut live_rx), if attached => {
            match live_event {
                Ok(event) => {
                    if event.seq > last_sent_seq {
                        if send_msg(&mut sender, &ServerMessage::Event(event.clone())).await.is_err() {
                            break;
                        }
                        last_sent_seq = event.seq;
                    }
                }
                Err(broadcast::error::RecvError::Lagged(_)) => {
                    let _ = send_msg(&mut sender, &ServerMessage::Resyncing { from_seq: last_sent_seq }).await;
                    if !replay_from(&state, session_id, last_sent_seq, &mut last_sent_seq, &mut sender).await {
                        break;
                    }
                    if send_msg(&mut sender, &ServerMessage::Resumed).await.is_err() {
                        break;
                    }
                }
                Err(broadcast::error::RecvError::Closed) => break,
            }
        }
    }
  }
}

/// Awaits the live broadcast receiver when one exists. A read-only session has
/// none, so this never resolves and the client-message branch keeps driving
/// the loop.
async fn recv_live(
  rx: &mut Option<broadcast::Receiver<SessionEvent>>,
) -> Result<SessionEvent, broadcast::error::RecvError> {
  match rx {
    Some(rx) => rx.recv().await,
    None => std::future::pending().await,
  }
}

/// Forwards everything after `after_seq` from the durable log. Shared by a
/// fresh `Resume` and by catching up after a `Lagged` broadcast gap.
async fn replay_from(
  state: &AppState,
  session_id: SessionId,
  after_seq: u64,
  last_sent_seq: &mut u64,
  sender: &mut futures::stream::SplitSink<WebSocket, Message>,
) -> bool {
  let events = match state.registry.store().replay_events(session_id, after_seq).await {
    Ok(events) => events,
    Err(err) => {
      let _ = send_msg(sender, &ServerMessage::Error { message: err.to_string() }).await;
      return false;
    }
  };

  *last_sent_seq = after_seq;
  for event in events {
    let seq = event.seq;
    if send_msg(sender, &ServerMessage::Event(event)).await.is_err() {
      return false;
    }
    *last_sent_seq = seq;
  }
  true
}

async fn send_msg(
  sender: &mut futures::stream::SplitSink<WebSocket, Message>,
  msg: &ServerMessage,
) -> Result<(), axum::Error> {
  let text = serde_json::to_string(msg).expect("ServerMessage always serializes");
  sender.send(Message::Text(text.into())).await
}
