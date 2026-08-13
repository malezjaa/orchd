use std::time::Duration;

use axum::Json;
use serde::{Deserialize, Serialize};

use crate::error::ApiError;

const GH_COMMAND_TIMEOUT: Duration = Duration::from_secs(10);

#[derive(Serialize)]
#[serde(rename_all = "snake_case")]
pub enum GitHubAccountStatus {
  Authenticated,
  LoggedOut,
  Unavailable,
}

#[derive(Serialize)]
pub struct GitHubAccountResponse {
  pub status: GitHubAccountStatus,
  pub login: Option<String>,
  pub name: Option<String>,
  pub avatar_url: Option<String>,
  pub message: Option<String>,
}

#[derive(Deserialize)]
struct GitHubUser {
  login: String,
  name: Option<String>,
  avatar_url: Option<String>,
}

pub async fn account() -> Result<Json<GitHubAccountResponse>, ApiError> {
  let output = tokio::time::timeout(
    GH_COMMAND_TIMEOUT,
    tokio::process::Command::new("gh")
      .args([
        "api",
        "user",
        "--hostname",
        "github.com",
        "--jq",
        "{login: .login, name: .name, avatar_url: .avatar_url}",
      ])
      .kill_on_drop(true)
      .output(),
  )
  .await
  .map_err(|_| ApiError::internal("GitHub CLI command timed out"))?;

  let output = match output {
    Ok(output) => output,
    Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
      return Ok(Json(unavailable_response()));
    }
    Err(error) => {
      return Err(ApiError::internal(format!("could not run GitHub CLI: {error}")));
    }
  };

  if !output.status.success() {
    return Ok(Json(logged_out_response()));
  }

  let user = serde_json::from_slice::<GitHubUser>(&output.stdout)
    .map_err(|_| ApiError::internal("GitHub CLI returned invalid user data"))?;

  Ok(Json(GitHubAccountResponse {
    status: GitHubAccountStatus::Authenticated,
    login: Some(user.login),
    name: user.name,
    avatar_url: user.avatar_url,
    message: None,
  }))
}

fn logged_out_response() -> GitHubAccountResponse {
  GitHubAccountResponse {
    status: GitHubAccountStatus::LoggedOut,
    login: None,
    name: None,
    avatar_url: None,
    message: Some("Run gh auth login to connect your GitHub account.".into()),
  }
}

fn unavailable_response() -> GitHubAccountResponse {
  GitHubAccountResponse {
    status: GitHubAccountStatus::Unavailable,
    login: None,
    name: None,
    avatar_url: None,
    message: Some("Install GitHub CLI, then run gh auth login.".into()),
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn serializes_logged_out_status() {
    let response =
      serde_json::to_value(logged_out_response()).expect("response should serialize");

    assert_eq!(response["status"], "logged_out");
    assert_eq!(response["message"], "Run gh auth login to connect your GitHub account.");
  }
}
