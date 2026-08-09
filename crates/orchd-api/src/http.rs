use std::str::FromStr;

use axum::{
  Json, Router,
  extract::{Path, Query, State},
  http::StatusCode,
  routing::{get, post},
};
use orchd_core::{AgentKind, ModelInfo, ProjectId, SessionId};
use orchd_store::{ProjectRecord, SessionRecord, SettingsPatch, SettingsRecord};
use serde::{Deserialize, Serialize};

use crate::{
  error::ApiError,
  file_tree::{browse_fs, file_tree},
  state::AppState,
};

/// Everything here sits behind the `require_session` middleware. `/health` is
/// deliberately not in this router, since it must stay reachable without a
/// session.
pub fn router() -> Router<AppState> {
  Router::new()
    .route("/sessions", post(create_session).get(list_sessions))
    .route("/sessions/{id}", get(get_session))
    .route("/sessions/{id}/archive", post(archive_session))
    .route("/sessions/{id}/unarchive", post(unarchive_session))
    .route("/projects", post(create_project).get(list_projects))
    .route("/projects/{id}", get(get_project).delete(delete_project))
    .route("/projects/{id}/archive", post(archive_project))
    .route("/projects/{id}/sessions", get(list_project_sessions))
    .route("/fs/browse", get(browse_fs))
    .route("/fs/tree", get(file_tree))
    .route("/models", get(list_models))
    .route("/settings", get(get_settings).patch(update_settings))
}

async fn list_models() -> Json<&'static [ModelInfo]> {
  Json(orchd_core::SUPPORTED_MODELS)
}

#[derive(Deserialize)]
pub struct CreateSessionRequest {
  #[serde(default = "default_agent_kind")]
  pub agent_kind: AgentKind,
  pub project_id: ProjectId,
}

fn default_agent_kind() -> AgentKind {
  AgentKind::Echo
}

/// Usage resolved against the static model catalog, so a client gets
/// ready-to-render numbers instead of fetching `/models` and doing the lookup
/// itself.
#[derive(Serialize)]
struct SessionContext {
  used_tokens: i64,
  context_window: u32,
  max_output_tokens: u32,
}

/// A `SessionRecord` plus state the store can't supply: `busy` is runtime-only
/// and comes from the registry, `context` needs a model-catalog lookup.
#[derive(Serialize)]
struct SessionResponse {
  #[serde(flatten)]
  record: SessionRecord,
  busy: bool,
  context: Option<SessionContext>,
}

impl SessionResponse {
  fn from(state: &AppState, record: SessionRecord) -> Self {
    let busy = state.registry.is_busy(record.id);
    let context = record.context_tokens_used.and_then(|used_tokens| {
      let model = orchd_core::find_model(record.model.as_deref()?)?;
      Some(SessionContext {
        used_tokens,
        context_window: model.context_window,
        max_output_tokens: model.max_output_tokens,
      })
    });
    Self { record, busy, context }
  }
}

async fn create_session(
  State(state): State<AppState>,
  Json(req): Json<CreateSessionRequest>,
) -> Result<Json<SessionResponse>, ApiError> {
  let record = state.registry.create_session(req.agent_kind, req.project_id).await?;
  Ok(Json(SessionResponse::from(&state, record)))
}

#[derive(Deserialize)]
pub struct ListSessionsQuery {
  #[serde(default)]
  pub archived: bool,
}

async fn list_sessions(
  State(state): State<AppState>,
  Query(query): Query<ListSessionsQuery>,
) -> Result<Json<Vec<SessionResponse>>, ApiError> {
  let records = if query.archived {
    state.registry.list_archived().await?
  } else {
    state.registry.list().await?
  };
  Ok(Json(records.into_iter().map(|r| SessionResponse::from(&state, r)).collect()))
}

async fn get_session(
  State(state): State<AppState>,
  Path(id): Path<String>,
) -> Result<Json<SessionResponse>, ApiError> {
  let id =
    SessionId::from_str(&id).map_err(|_| ApiError::bad_request("invalid session id"))?;
  let record = state.registry.get_record(id).await?;
  Ok(Json(SessionResponse::from(&state, record)))
}

async fn archive_session(
  State(state): State<AppState>,
  Path(id): Path<String>,
) -> Result<StatusCode, ApiError> {
  let id =
    SessionId::from_str(&id).map_err(|_| ApiError::bad_request("invalid session id"))?;
  state.registry.archive_session(id).await?;
  Ok(StatusCode::NO_CONTENT)
}

async fn unarchive_session(
  State(state): State<AppState>,
  Path(id): Path<String>,
) -> Result<StatusCode, ApiError> {
  let id =
    SessionId::from_str(&id).map_err(|_| ApiError::bad_request("invalid session id"))?;
  state.registry.unarchive_session(id).await?;
  Ok(StatusCode::NO_CONTENT)
}

#[derive(Deserialize)]
pub struct CreateProjectRequest {
  pub name: String,
  pub path: String,
}

/// `path` is client-supplied input, so it's validated here and stored
/// canonicalized: always absolute, free of `..`/symlink ambiguity, and two
/// projects can't silently point at the same directory via different
/// spellings.
async fn create_project(
  State(state): State<AppState>,
  Json(req): Json<CreateProjectRequest>,
) -> Result<Json<ProjectRecord>, ApiError> {
  let canonical = std::fs::canonicalize(&req.path).map_err(|err| {
    ApiError::bad_request(format!("project path does not exist: {err}"))
  })?;
  if !canonical.is_dir() {
    return Err(ApiError::bad_request("project path is not a directory"));
  }

  let record =
    state.registry.create_project(&req.name, &canonical.to_string_lossy()).await?;
  Ok(Json(record))
}

async fn list_projects(
  State(state): State<AppState>,
) -> Result<Json<Vec<ProjectRecord>>, ApiError> {
  Ok(Json(state.registry.list_projects().await?))
}

async fn get_project(
  State(state): State<AppState>,
  Path(id): Path<String>,
) -> Result<Json<ProjectRecord>, ApiError> {
  let id =
    ProjectId::from_str(&id).map_err(|_| ApiError::bad_request("invalid project id"))?;
  Ok(Json(state.registry.get_project(id).await?))
}

async fn delete_project(
  State(state): State<AppState>,
  Path(id): Path<String>,
) -> Result<StatusCode, ApiError> {
  let id =
    ProjectId::from_str(&id).map_err(|_| ApiError::bad_request("invalid project id"))?;
  state.registry.delete_project(id).await?;
  Ok(StatusCode::NO_CONTENT)
}

async fn list_project_sessions(
  State(state): State<AppState>,
  Path(id): Path<String>,
) -> Result<Json<Vec<SessionResponse>>, ApiError> {
  let id =
    ProjectId::from_str(&id).map_err(|_| ApiError::bad_request("invalid project id"))?;
  let records = state.registry.list_sessions_by_project(id).await?;
  Ok(Json(records.into_iter().map(|r| SessionResponse::from(&state, r)).collect()))
}

async fn archive_project(
  State(state): State<AppState>,
  Path(id): Path<String>,
) -> Result<StatusCode, ApiError> {
  let id =
    ProjectId::from_str(&id).map_err(|_| ApiError::bad_request("invalid project id"))?;
  state.registry.archive_project(id).await?;
  Ok(StatusCode::NO_CONTENT)
}

async fn get_settings(
  State(state): State<AppState>,
) -> Result<Json<SettingsRecord>, ApiError> {
  Ok(Json(state.registry.get_settings().await?))
}

async fn update_settings(
  State(state): State<AppState>,
  Json(patch): Json<SettingsPatch>,
) -> Result<Json<SettingsRecord>, ApiError> {
  Ok(Json(state.registry.update_settings(patch).await?))
}
