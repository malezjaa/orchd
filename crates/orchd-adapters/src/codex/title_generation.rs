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
  #[error("title-generation subprocess exited with an error")]
  ModelError,
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
  drop(pipes.stderr);

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
    .map_err(|_| TitleGenerationError::NoTitle)?
    .map_err(TitleGenerationError::Io)?;

  parse_title(&stdout_bytes).ok_or(TitleGenerationError::NoTitle)
}
