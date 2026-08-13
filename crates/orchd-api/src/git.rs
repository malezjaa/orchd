use std::{path::PathBuf, time::Duration};

use axum::{Json, extract::Query};
use serde::{Deserialize, Serialize};

use crate::error::ApiError;

const GIT_COMMAND_TIMEOUT: Duration = Duration::from_secs(30);

#[derive(Deserialize)]
pub struct GitPathQuery {
  pub path: String,
}

#[derive(Serialize)]
pub struct GitBranch {
  pub name: String,
  pub current: bool,
}

#[derive(Serialize)]
pub struct GitCommit {
  pub hash: String,
  pub short_hash: String,
  pub subject: String,
  pub author: String,
  pub authored_at: String,
}

#[derive(Serialize)]
pub struct GitInfoResponse {
  pub path: String,
  pub branch: Option<String>,
  pub branches: Vec<GitBranch>,
  pub commits: Vec<GitCommit>,
}

#[derive(Deserialize)]
#[serde(tag = "action", rename_all = "snake_case")]
pub enum GitAction {
  Commit { message: String },
  Restore,
  RevertCommit { commit: String },
  CreateBranch { name: String },
  DeleteBranch { name: String },
  SwitchBranch { name: String },
  Push,
  Pull,
}

#[derive(Deserialize)]
pub struct GitActionRequest {
  pub path: String,
  #[serde(flatten)]
  pub action: GitAction,
}

#[derive(Serialize)]
pub struct GitActionResponse {
  pub message: String,
}

async fn resolve_repo(path: &str) -> Result<PathBuf, ApiError> {
  let requested = PathBuf::from(path);
  let canonical = tokio::task::spawn_blocking(move || std::fs::canonicalize(requested))
    .await
    .map_err(|_| ApiError::internal("filesystem task failed"))?
    .map_err(|err| ApiError::bad_request(format!("cannot open project: {err}")))?;

  if !canonical.is_dir() {
    return Err(ApiError::bad_request("project path is not a directory"));
  }

  let output = run_git(&canonical, &["rev-parse", "--show-toplevel"]).await?;
  let root = PathBuf::from(output.trim());
  if !root.is_dir() {
    return Err(ApiError::bad_request("path is not a git repository"));
  }
  Ok(root)
}

async fn run_git(cwd: &PathBuf, args: &[&str]) -> Result<String, ApiError> {
  let child = tokio::process::Command::new("git")
    .current_dir(cwd)
    .args(args)
    .kill_on_drop(true)
    .output();
  let output = tokio::time::timeout(GIT_COMMAND_TIMEOUT, child)
    .await
    .map_err(|_| ApiError::bad_request("git command timed out"))?
    .map_err(|err| ApiError::bad_request(format!("could not run git: {err}")))?;

  if !output.status.success() {
    let message = String::from_utf8_lossy(&output.stderr).trim().to_owned();
    return Err(ApiError::bad_request(if message.is_empty() {
      "git command failed".to_owned()
    } else {
      message
    }));
  }

  Ok(String::from_utf8_lossy(&output.stdout).into_owned())
}

fn validate_branch_name(name: &str) -> Result<(), ApiError> {
  if name.trim().is_empty() || name.starts_with('-') || name.contains('\n') {
    return Err(ApiError::bad_request("invalid branch name"));
  }
  Ok(())
}

pub async fn git_info(
  Query(query): Query<GitPathQuery>,
) -> Result<Json<GitInfoResponse>, ApiError> {
  let root = resolve_repo(&query.path).await?;
  let branch_output = run_git(&root, &["branch", "--show-current"]).await?;
  let branch = match branch_output.trim() {
    "" => None,
    name => Some(name.to_owned()),
  };

  let branch_output = run_git(&root, &["branch", "--format=%(refname:short)"]).await?;
  let branches = branch_output
    .lines()
    .filter(|name| !name.is_empty())
    .map(|name| GitBranch {
      name: name.to_owned(),
      current: branch.as_deref() == Some(name),
    })
    .collect();

  let commits = if run_git(&root, &["rev-parse", "--verify", "HEAD"]).await.is_ok() {
    let log_output =
      run_git(&root, &["log", "-n", "12", "--format=%H%x00%h%x00%s%x00%an%x00%aI"])
        .await?;
    log_output
      .lines()
      .filter_map(|line| {
        let mut fields = line.split('\0');
        Some(GitCommit {
          hash: fields.next()?.to_owned(),
          short_hash: fields.next()?.to_owned(),
          subject: fields.next()?.to_owned(),
          author: fields.next()?.to_owned(),
          authored_at: fields.next()?.to_owned(),
        })
      })
      .collect()
  } else {
    Vec::new()
  };

  Ok(Json(GitInfoResponse {
    path: root.to_string_lossy().into_owned(),
    branch,
    branches,
    commits,
  }))
}

pub async fn git_action(
  Json(request): Json<GitActionRequest>,
) -> Result<Json<GitActionResponse>, ApiError> {
  let root = resolve_repo(&request.path).await?;
  let (args, message): (Vec<String>, String) = match request.action {
    GitAction::Commit { message } => {
      let message = message.trim().to_owned();
      if message.is_empty() {
        return Err(ApiError::bad_request("commit message cannot be empty"));
      }
      run_git(&root, &["add", "-A"]).await?;
      (
        vec!["commit".into(), "-m".into(), message.clone()],
        format!("Committed: {message}"),
      )
    }
    GitAction::Restore => (
      vec![
        "restore".into(),
        "--source=HEAD".into(),
        "--staged".into(),
        "--worktree".into(),
        "--".into(),
        ".".into(),
      ],
      "Restored tracked changes".into(),
    ),
    GitAction::RevertCommit { commit } => {
      if commit.trim().is_empty()
        || commit.starts_with('-')
        || commit.contains(char::is_whitespace)
      {
        return Err(ApiError::bad_request("invalid commit"));
      }
      (
        vec!["revert".into(), "--no-edit".into(), "--".into(), commit],
        "Reverted commit".into(),
      )
    }
    GitAction::CreateBranch { name } => {
      validate_branch_name(&name)?;
      (
        vec!["switch".into(), "-c".into(), name.clone()],
        format!("Created and switched to {name}"),
      )
    }
    GitAction::DeleteBranch { name } => {
      validate_branch_name(&name)?;
      (vec!["branch".into(), "-d".into(), name.clone()], format!("Deleted branch {name}"))
    }
    GitAction::SwitchBranch { name } => {
      validate_branch_name(&name)?;
      (vec!["switch".into(), name.clone()], format!("Switched to {name}"))
    }
    GitAction::Push => (vec!["push".into()], "Pushed current branch".into()),
    GitAction::Pull => {
      (vec!["pull".into(), "--ff-only".into()], "Pulled current branch".into())
    }
  };

  let args = args.iter().map(String::as_str).collect::<Vec<_>>();
  let output = run_git(&root, &args).await?;
  let output = output.trim();
  let message = if output.is_empty() { message } else { output.to_owned() };
  Ok(Json(GitActionResponse { message }))
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn deserializes_flat_git_actions() {
    let request: GitActionRequest = serde_json::from_str(
      r#"{"path":"/tmp/project","action":"commit","message":"save work"}"#,
    )
    .expect("git action request should deserialize");

    assert_eq!(request.path, "/tmp/project");
    assert!(
      matches!(request.action, GitAction::Commit { message } if message == "save work")
    );
  }
}
