use std::{path::Path, time::Duration};

use orchd_core::{SpawnSpec, TITLE_MAX_CHARS, sanitize_title};
use orchd_proc::ManagedProcess;
use serde::Deserialize;
use tokio::io::AsyncReadExt;

/// Used by a dedicated, one-shot `claude -p` call for naming a session, not by
/// the interactive agent subprocess. `--safe-mode` drops the project's
/// CLAUDE.md, skills, plugins, hooks and MCP servers; `--tools ""` drops the
/// built-in tool schemas too. Measured on this repo's full config, a trivial
/// exchange costs ~21k tokens of fixed context and ~4k with both flags. Paired
/// with Haiku, at a fifth of Sonnet's per-token price, naming costs a fraction
/// of a cent instead of the ~$0.10 a full session context would add.
const TITLE_MODEL: &str = "claude-haiku-4-5";

const TITLE_GENERATION_TIMEOUT: Duration = Duration::from_secs(45);

const TITLE_JSON_SCHEMA: &str = r#"{"type":"object","properties":{"title":{"type":"string"}},"required":["title"],"additionalProperties":false}"#;

/// Keeps an otherwise unbounded transcript from ballooning a call that's
/// supposed to be cheap. Takes the last N chars: once there's a previous title
/// to anchor against, recent context matters more than the start.
const REGENERATION_CONTEXT_MAX_CHARS: usize = 6_000;

#[derive(Debug, thiserror::Error)]
pub enum TitleGenerationError {
  #[error("failed to spawn title-generation subprocess: {0}")]
  Spawn(#[source] orchd_proc::ProcError),
  #[error("failed to read title-generation output: {0}")]
  Io(#[source] std::io::Error),
  #[error("title-generation subprocess timed out")]
  Timeout,
  #[error("title-generation subprocess exited with an error")]
  ModelError,
  #[error("title-generation output was not valid JSON: {0}")]
  InvalidOutput(#[source] serde_json::Error),
  #[error("title-generation returned no usable title")]
  NoTitle,
}

#[derive(Deserialize)]
struct ResultEnvelope {
  #[serde(default)]
  is_error: bool,
  structured_output: Option<StructuredOutput>,
}

#[derive(Deserialize)]
struct StructuredOutput {
  title: String,
}

/// Generates a title from a session's first user message.
pub async fn generate_initial_title(
  program: &str,
  cwd: &Path,
  first_message: &str,
) -> Result<String, TitleGenerationError> {
  run(program, cwd, &initial_prompt(first_message)).await
}

/// Re-derives a title once the conversation has moved on, given the
/// title's current value and a transcript of what's been said so far.
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
     later. Return JSON with exactly one key: title, whose value is a plain text string \
     — never another JSON object, never wrapped in braces or quotes of its \
     own.\n\nEditorial rules:\n- 3-8 words, under {TITLE_MAX_CHARS} characters.\n- Name \
     the subject and the desired outcome, not the process used to get there.\n- Do not \
     copy or truncate the message verbatim.\n- No quotes, labels, or trailing \
     punctuation.\n\nUser message:\n{message}"
  )
}

fn regeneration_prompt(previous_title: &str, transcript: &str) -> String {
  format!(
    "Regenerate the title for an existing coding session so it stays recognizable as \
     the conversation has evolved. The previous title was {previous_title:?}. Return \
     JSON with exactly one key: title, whose value is a plain text string — never \
     another JSON object, never wrapped in braces or quotes of its own.\n\nEditorial \
     rules:\n- 3-8 words, under {TITLE_MAX_CHARS} characters.\n- Preserve the durable \
     subject; a session moving through planning, implementation, and review hasn't \
     usually changed subjects.\n- Replace the previous title only if it's generic, \
     inaccurate, or the topic has genuinely moved on.\n- No quotes, labels, or trailing \
     punctuation.\n\nSession so far:\n{transcript}"
  )
}

/// Defends against a rare model failure mode where the schema is followed
/// structurally but the `title` string's content is itself another
/// JSON-encoded `{"title": ...}` blob. Unwraps a few levels of that rather
/// than showing raw JSON to the user.
fn unwrap_nested_title(mut title: String) -> String {
  for _ in 0..3 {
    let trimmed = title.trim();
    if !trimmed.starts_with('{') {
      break;
    }
    let Ok(nested) = serde_json::from_str::<StructuredOutput>(trimmed) else {
      break;
    };
    title = nested.title;
  }
  title
}

fn tail_chars(text: &str, max_chars: usize) -> String {
  let count = text.chars().count();
  if count <= max_chars {
    return text.to_string();
  }
  text.chars().skip(count - max_chars).collect()
}

async fn run(
  program: &str,
  cwd: &Path,
  prompt: &str,
) -> Result<String, TitleGenerationError> {
  let spec = SpawnSpec {
    program: program.to_string(),
    args: vec![
      "-p".to_string(),
      "--model".to_string(),
      TITLE_MODEL.to_string(),
      "--safe-mode".to_string(),
      "--tools".to_string(),
      String::new(),
      "--output-format".to_string(),
      "json".to_string(),
      "--json-schema".to_string(),
      TITLE_JSON_SCHEMA.to_string(),
      "--permission-mode".to_string(),
      "default".to_string(),
      prompt.to_string(),
    ],
    env: Vec::new(),
    cwd: cwd.to_path_buf(),
  };

  let (mut process, pipes) =
    ManagedProcess::spawn(&spec).map_err(TitleGenerationError::Spawn)?;
  // The prompt is passed as an argument, so drop stdin: otherwise the
  // subprocess blocks waiting for input it will never receive.
  drop(pipes.stdin);
  drop(pipes.stderr);

  // Drain stdout concurrently with waiting for exit: a child that fills the
  // pipe buffer before exiting would deadlock against a parent blocked on
  // `wait()`.
  let mut stdout = pipes.stdout;
  let stdout_task = tokio::spawn(async move {
    let mut buf = Vec::new();
    stdout.read_to_end(&mut buf).await.map(|_| buf)
  });

  let outcome = tokio::time::timeout(TITLE_GENERATION_TIMEOUT, process.wait()).await;
  let Ok(wait_result) = outcome else {
    let _ = process.kill().await;
    return Err(TitleGenerationError::Timeout);
  };
  wait_result.map_err(TitleGenerationError::Spawn)?;

  let stdout_bytes = stdout_task
    .await
    .map_err(|_| {
      TitleGenerationError::Io(std::io::Error::other(
        "title-generation stdout reader task panicked",
      ))
    })?
    .map_err(TitleGenerationError::Io)?;

  let envelope: ResultEnvelope =
    serde_json::from_slice(&stdout_bytes).map_err(TitleGenerationError::InvalidOutput)?;
  if envelope.is_error {
    return Err(TitleGenerationError::ModelError);
  }

  let raw_title =
    envelope.structured_output.map(|s| s.title).ok_or(TitleGenerationError::NoTitle)?;
  let raw_title = unwrap_nested_title(raw_title);
  sanitize_title(&raw_title).ok_or(TitleGenerationError::NoTitle)
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn unwrap_nested_title_passes_plain_text_through() {
    assert_eq!(
      unwrap_nested_title("Update package.json".to_string()),
      "Update package.json"
    );
  }

  #[test]
  fn unwrap_nested_title_unwraps_one_level() {
    assert_eq!(
      unwrap_nested_title(r#"{"title": "Update package.json"}"#.to_string()),
      "Update package.json"
    );
  }

  #[test]
  fn unwrap_nested_title_unwraps_double_nesting() {
    assert_eq!(
      unwrap_nested_title(
        r#"{"title": "{\"title\": \"Update package.json\"}"}"#.to_string()
      ),
      "Update package.json"
    );
  }

  #[test]
  fn unwrap_nested_title_leaves_unparseable_braces_alone() {
    let text = "{not actually json} but starts with a brace";
    assert_eq!(unwrap_nested_title(text.to_string()), text);
  }
}
