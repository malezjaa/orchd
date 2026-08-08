/// Longest a session title is allowed to be, matching the short,
/// list-friendly length other chat UIs use. Applies to both the
/// first-message fallback and to LLM-generated titles, which aren't
/// schema-constrained on length.
pub const TITLE_MAX_CHARS: usize = 60;

/// Collapses arbitrary text into a short, single-line title: whitespace
/// squashed to single spaces, trimmed, and cut to `TITLE_MAX_CHARS` at a
/// word boundary with a trailing "…". `None` for empty/whitespace-only
/// text (nothing worth naming a session after).
pub fn sanitize_title(text: &str) -> Option<String> {
  let collapsed = text.split_whitespace().collect::<Vec<_>>().join(" ");
  if collapsed.is_empty() {
    return None;
  }
  if collapsed.chars().count() <= TITLE_MAX_CHARS {
    return Some(collapsed);
  }
  let mut truncated: String = collapsed.chars().take(TITLE_MAX_CHARS).collect();
  if let Some(last_space) = truncated.rfind(' ') {
    truncated.truncate(last_space);
  }
  truncated.push('…');
  Some(truncated)
}
