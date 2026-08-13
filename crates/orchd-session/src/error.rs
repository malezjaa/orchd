use orchd_core::{ProjectId, SessionId};
use thiserror::Error;

#[derive(Debug, Error)]
pub enum RegistryError {
  #[error(transparent)]
  Store(#[from] orchd_store::StoreError),
  #[error("session not found: {0}")]
  NotFound(SessionId),
  #[error("project not found: {0}")]
  ProjectNotFound(ProjectId),
  #[error("session actor is no longer running")]
  ActorGone,
  #[error("session title cannot be empty")]
  InvalidTitle,
}
