use thiserror::Error;

#[derive(Debug, Error)]
pub enum AdapterError {
  #[error("failed to decode agent frame: {0}")]
  Decode(String),
  #[error("failed to encode command: {0}")]
  Encode(String),
  #[error("adapter protocol violation: {0}")]
  Protocol(String),
}
