/// Shared output-format guidance for file and subagent references in responses.
pub const FILE_MENTION_INSTRUCTIONS: &str =
  "When you mention a file path in your response, prefix the repository-relative path \
   with `@`. For example, write `@src/main.rs` or `@LICENSE`, not `src/main.rs` or \
   `LICENSE`. When you mention a spawned subagent, use the exact native child thread ID \
   and its nickname in this form: `[[subagent:THREAD_ID|Nickname]]`. For example, write \
   `[[subagent:019abc...|Confucius]]`, not only bold text or the raw thread ID. Use \
   this form only for a real child thread that the parent spawned. Keep the nickname \
   consistent with the name used when spawning the child.";
