use thiserror::Error;

#[derive(Debug, Error)]
pub enum StoreError {
  #[error("database error: {0}")]
  Database(#[from] sqlx::Error),
  #[error("migration error: {0}")]
  Migrate(#[from] sqlx::migrate::MigrateError),
  #[error("serialization error: {0}")]
  Serde(#[from] serde_json::Error),
  #[error("session not found: {0}")]
  SessionNotFound(orchd_core::SessionId),
  #[error("project not found: {0}")]
  ProjectNotFound(orchd_core::ProjectId),
  #[error("client session not found: {0}")]
  ClientSessionNotFound(String),
}
