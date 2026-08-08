//! Fake, in-process "adapter" that exercises the session-actor, event-log and
//! streaming spine without a subprocess or a protocol: it echoes the user's
//! text back as word-chunked `TextDelta`s so clients see real incremental
//! streaming.

use orchd_core::ContentPart;

pub fn extract_text(content: &[ContentPart]) -> String {
  content
    .iter()
    .map(|p| match p {
      ContentPart::Text { text } => text.as_str(),
    })
    .collect::<Vec<_>>()
    .join("\n")
}

/// Splits into word-ish chunks (word plus trailing whitespace) so streaming
/// `TextDelta` events have something to demonstrate.
pub fn chunk_words(text: &str) -> Vec<String> {
  let mut chunks = Vec::new();
  let mut current = String::new();
  for ch in text.chars() {
    current.push(ch);
    if ch.is_whitespace() {
      chunks.push(std::mem::take(&mut current));
    }
  }
  if !current.is_empty() {
    chunks.push(current);
  }
  if chunks.is_empty() {
    chunks.push(String::new());
  }
  chunks
}
