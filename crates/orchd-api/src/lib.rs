mod auth;
mod error;
mod file_tree;
mod http;
mod state;
mod terminal;
mod ws;

use std::sync::Arc;

pub use auth::AuthConfig;
use axum::{Router, middleware, routing::get};
use orchd_session::SessionRegistry;
pub use state::AppState;
use terminal::TerminalRegistry;
use tower_http::trace::TraceLayer;

/// Two zones. `public` needs no session: `/health`, plus `POST /auth/pairing`,
/// which bootstraps into auth and is rate-limited instead. Everything else is
/// behind `auth::require_session`, except the WS routes, which do their own
/// ticket check because a header/cookie check can't reach a socket upgrade.
pub fn app(registry: Arc<SessionRegistry>, auth_config: AuthConfig) -> Router {
  let state = AppState {
    registry,
    auth: Arc::new(auth_config),
    terminals: Arc::new(TerminalRegistry::new()),
  };

  let public = Router::new().route("/health", get(health)).merge(auth::pairing_router());

  let protected = Router::new()
    .merge(http::router())
    .merge(auth::management_router())
    .layer(middleware::from_fn_with_state(state.clone(), auth::require_session));

  Router::new()
    .merge(public)
    .merge(protected)
    .merge(ws::router())
    .merge(terminal::router())
    .layer(TraceLayer::new_for_http())
    .with_state(state)
}

async fn health() -> &'static str {
  "ok"
}
