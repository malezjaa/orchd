use std::{path::Path, time::Duration};

use orchd_core::{SpawnSpec, TITLE_MAX_CHARS, sanitize_title};
use orchd_proc::ManagedProcess;
use serde::Deserialize;
use serde_json::Value;
use tokio::io::AsyncReadExt;

/// Title generation is a separate Codex invocation so the session's active
/// app-server model and context are not disturbed.
const TITLE_MODEL: &str = "gpt-5.6-luna";
const TITLE_REASONING_EFFORT: &str = "medium";
const TITLE_GENERATION_TIMEOUT: Duration = Duration::from_secs(45);

const REGENERATION_CONTEXT_MAX_CHARS: usize = 6_000;

#[derive(Debug, thiserror::Error)]
pub enum TitleGenerationError {
  #[error("failed to spawn title-generation subprocess: {0}")]
  Spawn(#[source] orchd_proc::ProcError),
  #[error("failed to read title-generation output: {0}")]
  Io(#[source] std::io::Error),
  #[error("title-generation subprocess timed out")]
  Timeout,
  #[error("title-generation subprocess failed: {0}")]
  ModelError(String),
  #[error("title-generation returned no usable title")]
  NoTitle,
}

#[derive(Deserialize)]
struct StructuredOutput {
  title: String,
}

pub async fn generate_initial_title(
  program: &str,
  cwd: &Path,
  first_message: &str,
) -> Result<String, TitleGenerationError> {
  run(program, cwd, &initial_prompt(first_message)).await
}

pub async fn regenerate_title(
  program: &str,
  cwd: &Path,
  previous_title: &str,
  transcript: &str,
) -> Result<String, TitleGenerationError> {
  let transcript = tail_chars(transcript, REGENERATION_CONTEXT_MAX_CHARS);
  run(program, cwd, &regeneration_prompt(previous_title, &transcript)).await
}

fn initial_prompt(message: &str) -> String {
  format!(
    "Generate a short title that will help someone recognize this coding session weeks \
     later. Return JSON with exactly one key: title, whose value is a plain text \
     string. Do not use tools.\n\nEditorial rules:\n- 3-8 words, under \
     {TITLE_MAX_CHARS} characters.\n- Name the subject and the desired outcome, not the \
     process used to get there.\n- Do not copy or truncate the message verbatim.\n- No \
     quotes, labels, or trailing punctuation.\n\nUser message:\n{message}"
  )
}

fn regeneration_prompt(previous_title: &str, transcript: &str) -> String {
  format!(
    "Regenerate the title for an existing coding session so it stays recognizable as \
     the conversation has evolved. The previous title was {previous_title:?}. Return \
     JSON with exactly one key: title, whose value is a plain text string. Do not use \
     tools.\n\n Editorial rules:\n- 3-8 words, under {TITLE_MAX_CHARS} characters.\n- \
     Preserve the durable subject; a session moving through planning, implementation, \
     and review hasn't usually changed subjects.\n- Replace the previous title only if \
     it's generic, inaccurate, or the topic has genuinely moved on.\n- No quotes, \
     labels, or trailing punctuation.\n\n Session so far:\n{transcript}"
  )
}

fn tail_chars(text: &str, max_chars: usize) -> String {
  let count = text.chars().count();
  if count <= max_chars {
    return text.to_string();
  }
  text.chars().skip(count - max_chars).collect()
}

fn parse_title(output: &[u8]) -> Option<String> {
  let mut title = None;
  for line in String::from_utf8_lossy(output).lines() {
    let Ok(value) = serde_json::from_str::<Value>(line) else { continue };
    if value.get("type").and_then(Value::as_str) != Some("item.completed") {
      continue;
    }
    let Some(item) = value.get("item") else { continue };
    if item.get("type").and_then(Value::as_str) != Some("agent_message") {
      continue;
    }
    if let Some(text) = item.get("text").and_then(Value::as_str) {
      title = Some(text.to_string());
    }
  }

  let title = title?;
  let text = title.trim();
  let text = text
    .strip_prefix("```json")
    .and_then(|value| value.strip_suffix("```"))
    .unwrap_or(text)
    .trim();
  let raw = serde_json::from_str::<StructuredOutput>(&text)
    .map(|value| value.title)
    .unwrap_or_else(|_| text.to_string());
  sanitize_title(raw.trim())
}

const TITLE_ERROR_MAX_CHARS: usize = 1_000;

fn compact_diagnostic(text: &str) -> Option<String> {
  let text = text.split_whitespace().collect::<Vec<_>>().join(" ");
  if text.is_empty() {
    return None;
  }
  let mut text: String = text.chars().take(TITLE_ERROR_MAX_CHARS).collect();
  if text.chars().count() == TITLE_ERROR_MAX_CHARS {
    text.push('…');
  }
  Some(text)
}

fn value_message(value: &Value) -> Option<String> {
  match value {
    Value::String(text) => {
      if let Ok(nested) = serde_json::from_str::<Value>(text) {
        if let Some(message) = value_message(&nested) {
          return Some(message);
        }
      }
      compact_diagnostic(text)
    }
    Value::Object(object) => object
      .get("message")
      .and_then(value_message)
      .or_else(|| object.get("error").and_then(value_message)),
    _ => None,
  }
}

fn extract_error_message(output: &[u8]) -> Option<String> {
  let mut message = None;
  for line in String::from_utf8_lossy(output).lines() {
    let Ok(value) = serde_json::from_str::<Value>(line) else { continue };
    let candidate = match value.get("type").and_then(Value::as_str) {
      Some("item.completed") => value
        .get("item")
        .filter(|item| item.get("type").and_then(Value::as_str) == Some("error"))
        .and_then(|item| item.get("message"))
        .and_then(value_message),
      Some("error") => value.get("message").and_then(value_message),
      Some("turn.failed") => value.get("error").and_then(value_message),
      _ => None,
    };
    if candidate.is_some() {
      message = candidate;
    }
  }
  message
}

async fn run(
  program: &str,
  cwd: &Path,
  prompt: &str,
) -> Result<String, TitleGenerationError> {
  let spec = SpawnSpec {
    program: program.to_string(),
    args: vec![
      "exec".to_string(),
      "--json".to_string(),
      "--ephemeral".to_string(),
      "--sandbox".to_string(),
      "read-only".to_string(),
      "--skip-git-repo-check".to_string(),
      "--ignore-rules".to_string(),
      "--model".to_string(),
      TITLE_MODEL.to_string(),
      "-c".to_string(),
      format!("model_reasoning_effort=\"{TITLE_REASONING_EFFORT}\""),
      prompt.to_string(),
    ],
    env: Vec::new(),
    cwd: cwd.to_path_buf(),
  };

  let (mut process, pipes) =
    ManagedProcess::spawn(&spec).map_err(TitleGenerationError::Spawn)?;
  drop(pipes.stdin);

  let mut stdout = pipes.stdout;
  let stdout_task = tokio::spawn(async move {
    let mut buf = Vec::new();
    stdout.read_to_end(&mut buf).await.map(|_| buf)
  });
  let mut stderr = pipes.stderr;
  let stderr_task = tokio::spawn(async move {
    let mut buf = Vec::new();
    stderr.read_to_end(&mut buf).await.map(|_| buf)
  });

  let outcome = tokio::time::timeout(TITLE_GENERATION_TIMEOUT, process.wait()).await;
  let Ok(wait_result) = outcome else {
    let _ = process.kill().await;
    stdout_task.abort();
    stderr_task.abort();
    return Err(TitleGenerationError::Timeout);
  };
  let status = wait_result.map_err(TitleGenerationError::Spawn)?;
  let stdout_bytes = stdout_task
    .await
    .map_err(|_| {
      TitleGenerationError::Io(std::io::Error::other("stdout reader task panicked"))
    })?
    .map_err(TitleGenerationError::Io)?;
  let stderr_bytes = stderr_task
    .await
    .map_err(|_| {
      TitleGenerationError::Io(std::io::Error::other("stderr reader task panicked"))
    })?
    .map_err(TitleGenerationError::Io)?;

  if let Some(message) = extract_error_message(&stdout_bytes) {
    return Err(TitleGenerationError::ModelError(message));
  }
  if !status.success() {
    let message = compact_diagnostic(&String::from_utf8_lossy(&stderr_bytes));
    return Err(TitleGenerationError::ModelError(format!(
      "{} ({})",
      message.unwrap_or_else(|| "subprocess exited without a diagnostic".to_string()),
      status,
    )));
  }

  parse_title(&stdout_bytes).ok_or(TitleGenerationError::NoTitle)
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn extracts_latest_codex_error_message() {
    let output = br#"
{"type":"item.completed","item":{"type":"error","message":"model metadata unavailable"}}
{"type":"turn.failed","error":{"message":"{\"type\":\"error\",\"message\":\"provider unavailable\"}"}}
"#;

    assert_eq!(extract_error_message(output).as_deref(), Some("provider unavailable"));
  }
}
