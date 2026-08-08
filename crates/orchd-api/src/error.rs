use axum::{
  Json,
  http::StatusCode,
  response::{IntoResponse, Response},
};
use orchd_session::RegistryError;
use serde_json::json;

pub struct ApiError(StatusCode, String);

impl From<RegistryError> for ApiError {
  fn from(err: RegistryError) -> Self {
    let status = match &err {
      RegistryError::NotFound(_) | RegistryError::ProjectNotFound(_) => {
        StatusCode::NOT_FOUND
      }
      RegistryError::ActorGone => StatusCode::GONE,
      RegistryError::Store(_) => StatusCode::INTERNAL_SERVER_ERROR,
    };
    ApiError(status, err.to_string())
  }
}

impl From<orchd_store::StoreError> for ApiError {
  fn from(err: orchd_store::StoreError) -> Self {
    let status = match &err {
      orchd_store::StoreError::SessionNotFound(_)
      | orchd_store::StoreError::ProjectNotFound(_)
      | orchd_store::StoreError::ClientSessionNotFound(_) => StatusCode::NOT_FOUND,
      _ => StatusCode::INTERNAL_SERVER_ERROR,
    };
    ApiError(status, err.to_string())
  }
}

impl ApiError {
  pub fn bad_request(msg: impl Into<String>) -> Self {
    ApiError(StatusCode::BAD_REQUEST, msg.into())
  }

  pub fn unauthorized(msg: impl Into<String>) -> Self {
    ApiError(StatusCode::UNAUTHORIZED, msg.into())
  }
}

impl IntoResponse for ApiError {
  fn into_response(self) -> Response {
    (self.0, Json(json!({ "error": self.1 }))).into_response()
  }
}
