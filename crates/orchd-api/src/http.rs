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
  file_tree::{
    browse_fs, file_contents, file_tree, git_status_response, write_file_contents,
  },
  state::AppState,
};

/// Everything here sits behind the `require_session` middleware. `/health` is
/// deliberately not in this router, since it must stay reachable without a
/// session.
pub fn router() -> Router<AppState> {
  Router::new()
    .route("/sessions", post(create_session).get(list_sessions))
    .route(
      "/sessions/{id}",
      get(get_session).delete(delete_session).patch(rename_session),
    )
    .route("/sessions/{id}/archive", post(archive_session))
    .route("/sessions/{id}/unarchive", post(unarchive_session))
    .route("/sessions/{id}/pin", post(pin_session))
    .route("/sessions/{id}/unpin", post(unpin_session))
    .route("/sessions/{id}/regenerate-title", post(regenerate_title))
    .route("/projects", post(create_project).get(list_projects))
    .route("/projects/{id}", get(get_project).delete(delete_project))
    .route("/projects/{id}/archive", post(archive_project))
    .route("/projects/{id}/sessions", get(list_project_sessions))
    .route("/fs/browse", get(browse_fs))
    .route("/fs/git-status", get(git_status_response))
    .route("/fs/tree", get(file_tree))
    .route("/fs/contents", get(file_contents).put(write_file_contents))
    .route("/models", get(list_models))
    .route("/skills", get(list_skills))
    .route("/settings", get(get_settings).patch(update_settings))
}

async fn list_models() -> Json<&'static [ModelInfo]> {
  Json(orchd_core::SUPPORTED_MODELS)
}

#[derive(Deserialize)]
pub struct ListSkillsQuery {
  pub path: String,
  #[serde(default = "default_skill_agent")]
  pub agent_kind: AgentKind,
}

fn default_skill_agent() -> AgentKind {
  AgentKind::ClaudeCode
}

#[derive(Clone, Serialize)]
pub struct SkillRecord {
  pub name: String,
  pub description: String,
  pub path: String,
}

/// Lists the skills visible to the selected agent for one project. The
/// directory scan runs off the async executor because skill files are local
/// user input and may live in several home/project roots.
async fn list_skills(
  Query(query): Query<ListSkillsQuery>,
) -> Result<Json<Vec<SkillRecord>>, ApiError> {
  let root = std::fs::canonicalize(&query.path)
    .map_err(|err| ApiError::bad_request(format!("cannot open project: {err}")))?;
  if !root.is_dir() {
    return Err(ApiError::bad_request("project path is not a directory"));
  }

  let agent = query.agent_kind;
  let skills = tokio::task::spawn_blocking(move || discover_skills(&root, agent))
    .await
    .map_err(|_| ApiError::internal("skill discovery task failed"))?;

  Ok(Json(skills))
}

fn discover_skills(root: &std::path::Path, agent: AgentKind) -> Vec<SkillRecord> {
  let home = dirs::home_dir();
  let mut roots = Vec::new();
  let mut add_root = |path: std::path::PathBuf| {
    if !roots.iter().any(|existing: &std::path::PathBuf| existing == &path) {
      roots.push(path);
    }
  };

  // The shared Agent Skills location is useful when one project is driven by
  // both agents. Agent-specific locations retain native discovery behavior.
  add_root(root.join(".agents/skills"));
  if let Some(home) = &home {
    add_root(home.join(".agents/skills"));
  }
  match agent {
    AgentKind::ClaudeCode => {
      add_root(root.join(".claude/skills"));
      if let Some(home) = &home {
        add_root(home.join(".claude/skills"));
      }
    }
    AgentKind::Codex => {
      add_root(root.join(".codex/skills"));
      if let Some(home) = &home {
        add_root(home.join(".codex/skills"));
      }
      if let Some(codex_home) = std::env::var_os("CODEX_HOME") {
        add_root(std::path::PathBuf::from(codex_home).join("skills"));
      }
    }
    _ => return Vec::new(),
  }

  discover_skills_from_roots(roots)
}

fn discover_skills_from_roots(roots: Vec<std::path::PathBuf>) -> Vec<SkillRecord> {
  let mut by_name = std::collections::BTreeMap::new();
  for skills_root in roots {
    for skill_path in skill_files(&skills_root) {
      let Ok(contents) = std::fs::read_to_string(&skill_path) else { continue };
      let Some((name, description)) = parse_skill_frontmatter(&contents) else {
        continue;
      };
      if by_name.contains_key(&name) {
        continue;
      }
      by_name.insert(
        name.clone(),
        SkillRecord {
          name,
          description,
          path: skill_path.to_string_lossy().into_owned(),
        },
      );
    }
  }
  by_name.into_values().collect()
}

/// Skill roots normally contain skill directories directly. A small number
/// of installations use one grouping directory, such as `.system`, so allow
/// one nested level without walking arbitrary project content.
fn skill_files(root: &std::path::Path) -> Vec<std::path::PathBuf> {
  let Ok(entries) = std::fs::read_dir(root) else {
    return Vec::new();
  };
  let mut files = Vec::new();
  for entry in entries.flatten() {
    let path = entry.path();
    if !path.is_dir() {
      continue;
    }
    let skill_file = path.join("SKILL.md");
    if skill_file.is_file() {
      files.push(skill_file);
      continue;
    }
    let Ok(nested_entries) = std::fs::read_dir(path) else {
      continue;
    };
    for nested_entry in nested_entries.flatten() {
      let nested_path = nested_entry.path();
      if nested_path.is_dir() {
        let skill_file = nested_path.join("SKILL.md");
        if skill_file.is_file() {
          files.push(skill_file);
        }
      }
    }
  }
  files
}

fn parse_skill_frontmatter(contents: &str) -> Option<(String, String)> {
  let mut lines = contents.lines();
  if lines.next()?.trim() != "---" {
    return None;
  }
  let mut name = None;
  let mut description = None;
  for line in lines {
    let trimmed = line.trim();
    if trimmed == "---" {
      break;
    }
    let Some((key, value)) = trimmed.split_once(':') else { continue };
    let value = value.trim().trim_matches(['"', '\'']);
    match key.trim() {
      "name" if !value.is_empty() => name = Some(value.to_string()),
      "description" if !value.is_empty() => description = Some(value.to_string()),
      _ => {}
    }
  }
  Some((name?, description.unwrap_or_default()))
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn discovers_skills_in_a_grouped_root() {
    let root =
      std::env::temp_dir().join(format!("orchd-api-skills-{}", uuid::Uuid::new_v4()));
    let skill_dir = root.join(".system/example");
    std::fs::create_dir_all(&skill_dir).expect("create skill fixture");
    std::fs::write(
      skill_dir.join("SKILL.md"),
      "---\nname: example\ndescription: Test skill\n---\n",
    )
    .expect("write skill fixture");

    let skills = discover_skills_from_roots(vec![root.clone()]);

    assert_eq!(skills.len(), 1);
    assert_eq!(skills[0].name, "example");
    assert_eq!(skills[0].description, "Test skill");
    let _ = std::fs::remove_dir_all(root);
  }
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
pub struct RenameSessionRequest {
  pub title: String,
}

async fn rename_session(
  State(state): State<AppState>,
  Path(id): Path<String>,
  Json(req): Json<RenameSessionRequest>,
) -> Result<StatusCode, ApiError> {
  let id =
    SessionId::from_str(&id).map_err(|_| ApiError::bad_request("invalid session id"))?;
  if req.title.trim().is_empty() {
    return Err(ApiError::bad_request("session title cannot be empty"));
  }
  state.registry.rename_session(id, &req.title).await?;
  Ok(StatusCode::NO_CONTENT)
}

async fn pin_session(
  State(state): State<AppState>,
  Path(id): Path<String>,
) -> Result<StatusCode, ApiError> {
  let id =
    SessionId::from_str(&id).map_err(|_| ApiError::bad_request("invalid session id"))?;
  state.registry.set_session_pinned(id, true).await?;
  Ok(StatusCode::NO_CONTENT)
}

async fn unpin_session(
  State(state): State<AppState>,
  Path(id): Path<String>,
) -> Result<StatusCode, ApiError> {
  let id =
    SessionId::from_str(&id).map_err(|_| ApiError::bad_request("invalid session id"))?;
  state.registry.set_session_pinned(id, false).await?;
  Ok(StatusCode::NO_CONTENT)
}

async fn delete_session(
  State(state): State<AppState>,
  Path(id): Path<String>,
) -> Result<StatusCode, ApiError> {
  let id =
    SessionId::from_str(&id).map_err(|_| ApiError::bad_request("invalid session id"))?;
  state.registry.delete_session(id).await?;
  Ok(StatusCode::NO_CONTENT)
}

async fn regenerate_title(
  State(state): State<AppState>,
  Path(id): Path<String>,
) -> Result<StatusCode, ApiError> {
  let id =
    SessionId::from_str(&id).map_err(|_| ApiError::bad_request("invalid session id"))?;
  state.registry.regenerate_session_title(id).await?;
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
