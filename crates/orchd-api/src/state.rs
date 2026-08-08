use std::sync::Arc;

use orchd_session::SessionRegistry;

use crate::auth::AuthConfig;

#[derive(Clone)]
pub struct AppState {
  pub registry: Arc<SessionRegistry>,
  pub auth: Arc<AuthConfig>,
}
