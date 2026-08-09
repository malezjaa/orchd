use std::sync::Arc;

use orchd_session::SessionRegistry;

use crate::{auth::AuthConfig, terminal::TerminalRegistry};

#[derive(Clone)]
pub struct AppState {
  pub registry: Arc<SessionRegistry>,
  pub auth: Arc<AuthConfig>,
  pub terminals: Arc<TerminalRegistry>,
}
