use std::time::Duration;

use axum::{
  Json, Router,
  extract::{FromRequestParts, Path, Request, State},
  http::{StatusCode, header, request::Parts},
  middleware::Next,
  response::{IntoResponse, Response},
  routing::{delete, get, post},
};
use orchd_store::ClientSessionRecord;
use serde::{Deserialize, Serialize};
use tower_governor::{
  GovernorLayer, governor::GovernorConfigBuilder, key_extractor::SmartIpKeyExtractor,
};

use crate::{error::ApiError, state::AppState};

const SESSION_COOKIE: &str = "orchd_session";

/// Single-owner, multi-device auth: boot-time and on-demand pairing tokens
/// exchanged for revocable per-device sessions.
#[derive(Clone, Copy, Debug)]
pub struct AuthConfig {
  pub pairing_token_ttl: Duration,
  pub session_ttl: Duration,
  pub ws_ticket_ttl: Duration,
  /// Only meaningful when the daemon is reachable over HTTPS. Leave off for
  /// plain HTTP on a private network, where `Secure` would just make the
  /// browser silently drop the cookie.
  pub cookie_secure: bool,
}

impl Default for AuthConfig {
  fn default() -> Self {
    Self {
      pairing_token_ttl: Duration::from_secs(15 * 60),
      session_ttl: Duration::from_secs(30 * 24 * 3600),
      ws_ticket_ttl: Duration::from_secs(60),
      cookie_secure: false,
    }
  }
}

impl AuthConfig {
  pub fn from_env() -> Self {
    let mut config = Self::default();
    if let Some(secs) = env_u64("ORCHD_PAIRING_TOKEN_TTL_SECS") {
      config.pairing_token_ttl = Duration::from_secs(secs);
    }
    if let Some(secs) = env_u64("ORCHD_SESSION_TTL_SECS") {
      config.session_ttl = Duration::from_secs(secs);
    }
    if let Some(secs) = env_u64("ORCHD_WS_TICKET_TTL_SECS") {
      config.ws_ticket_ttl = Duration::from_secs(secs);
    }
    config.cookie_secure =
      matches!(std::env::var("ORCHD_COOKIE_SECURE").as_deref(), Ok("true") | Ok("1"));
    config
  }
}

fn env_u64(key: &str) -> Option<u64> {
  std::env::var(key).ok().and_then(|s| s.parse().ok())
}

/// `POST /auth/pairing` is the one unauthenticated route in the API, since
/// it's the bootstrap into auth, so it's isolated behind its own IP-keyed
/// rate limit instead of `require_session`. `SmartIpKeyExtractor` reads
/// `X-Forwarded-For`/`X-Real-Ip`/`Forwarded` before the peer address, so the
/// limit stays meaningful behind a reverse proxy or tunnel, which is what
/// makes exposing this route publicly safe.
pub fn pairing_router() -> Router<AppState> {
  let governor_conf = GovernorConfigBuilder::default()
    .per_second(1)
    .burst_size(5)
    .key_extractor(SmartIpKeyExtractor)
    .finish()
    .expect("static governor config is always valid");

  Router::new()
    .route("/auth/pairing", post(exchange_pairing_token))
    .layer(GovernorLayer::new(governor_conf))
}

/// Auth-management endpoints that themselves require an already-valid
/// session, so they mount inside the `require_session`-gated router.
pub fn management_router() -> Router<AppState> {
  Router::new()
    .route("/auth/pairing-tokens", post(mint_pairing_token))
    .route("/auth/sessions", get(list_sessions))
    .route("/auth/sessions/{id}", delete(revoke_session))
    .route("/auth/websocket-ticket", post(issue_websocket_ticket))
}

#[derive(Deserialize)]
struct PairingRequest {
  pairing_token: String,
  device_label: Option<String>,
}

#[derive(Serialize)]
struct PairingResponse {
  session: ClientSessionRecord,
  /// Also set as `Set-Cookie` for browser clients; returned in the body for
  /// non-browser clients that send it back as `Authorization: Bearer`.
  session_token: String,
}

async fn exchange_pairing_token(
  State(state): State<AppState>,
  Json(req): Json<PairingRequest>,
) -> Result<Response, ApiError> {
  let exchanged = state
    .registry
    .store()
    .exchange_pairing_token(
      &req.pairing_token,
      req.device_label.as_deref(),
      state.auth.session_ttl,
    )
    .await?;
  let Some((session, token)) = exchanged else {
    return Err(ApiError::unauthorized("invalid or expired pairing token"));
  };

  let mut response =
    Json(PairingResponse { session, session_token: token.clone() }).into_response();
  let cookie = session_cookie(&token, state.auth.session_ttl, state.auth.cookie_secure);
  response.headers_mut().append(
    header::SET_COOKIE,
    cookie.parse().expect("cookie header value is always valid"),
  );
  Ok(response)
}

#[derive(Serialize)]
struct PairingTokenResponse {
  pairing_token: String,
  expires_in_secs: u64,
}

async fn mint_pairing_token(
  State(state): State<AppState>,
) -> Result<Json<PairingTokenResponse>, ApiError> {
  let token =
    state.registry.store().create_pairing_token(state.auth.pairing_token_ttl).await?;
  Ok(Json(PairingTokenResponse {
    pairing_token: token,
    expires_in_secs: state.auth.pairing_token_ttl.as_secs(),
  }))
}

async fn list_sessions(
  State(state): State<AppState>,
) -> Result<Json<Vec<ClientSessionRecord>>, ApiError> {
  Ok(Json(state.registry.store().list_client_sessions().await?))
}

async fn revoke_session(
  State(state): State<AppState>,
  Path(id): Path<String>,
) -> Result<StatusCode, ApiError> {
  state.registry.store().revoke_client_session(&id).await?;
  Ok(StatusCode::NO_CONTENT)
}

#[derive(Serialize)]
struct WsTicketResponse {
  ticket: String,
  expires_in_secs: u64,
}

async fn issue_websocket_ticket(
  State(state): State<AppState>,
  session: CurrentSession,
) -> Result<Json<WsTicketResponse>, ApiError> {
  let ticket = state
    .registry
    .store()
    .create_ws_ticket(&session.0.id, state.auth.ws_ticket_ttl)
    .await?;
  Ok(Json(WsTicketResponse {
    ticket,
    expires_in_secs: state.auth.ws_ticket_ttl.as_secs(),
  }))
}

fn session_cookie(token: &str, ttl: Duration, secure: bool) -> String {
  let secure_flag = if secure { "; Secure" } else { "" };
  format!(
    "{SESSION_COOKIE}={token}; Path=/; HttpOnly; SameSite=Lax; Max-Age={}{secure_flag}",
    ttl.as_secs()
  )
}

/// The authenticated caller, attached to request extensions by
/// `require_session`.
#[derive(Clone)]
pub struct CurrentSession(pub ClientSessionRecord);

impl<S> FromRequestParts<S> for CurrentSession
where
  S: Send + Sync,
{
  type Rejection = ApiError;

  async fn from_request_parts(
    parts: &mut Parts,
    _state: &S,
  ) -> Result<Self, Self::Rejection> {
    parts
      .extensions
      .get::<CurrentSession>()
      .cloned()
      .ok_or_else(|| ApiError::unauthorized("missing session credential"))
  }
}

/// Resolves an `Authorization: Bearer` header or `orchd_session` cookie to a
/// `ClientSessionRecord` and attaches it for downstream handlers. Applied to
/// every route except `/health` and `POST /auth/pairing`.
pub async fn require_session(
  State(state): State<AppState>,
  mut req: Request,
  next: Next,
) -> Result<Response, ApiError> {
  let token = bearer_token(&req).or_else(|| cookie_token(&req));
  let Some(token) = token else {
    return Err(ApiError::unauthorized("missing session credential"));
  };

  let session = state.registry.store().authenticate(&token).await?;
  let Some(session) = session else {
    return Err(ApiError::unauthorized("invalid or expired session"));
  };

  req.extensions_mut().insert(CurrentSession(session));
  Ok(next.run(req).await)
}

fn bearer_token(req: &Request) -> Option<String> {
  req
    .headers()
    .get(header::AUTHORIZATION)
    .and_then(|v| v.to_str().ok())
    .and_then(|v| v.strip_prefix("Bearer "))
    .map(str::to_string)
}

fn cookie_token(req: &Request) -> Option<String> {
  let raw = req.headers().get(header::COOKIE)?.to_str().ok()?;
  raw.split(';').find_map(|part| {
    part.trim().strip_prefix(&format!("{SESSION_COOKIE}=")).map(str::to_string)
  })
}
