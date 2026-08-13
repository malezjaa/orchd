/// Shared output-format guidance for file references in agent responses.
pub const FILE_MENTION_INSTRUCTIONS: &str =
  "When you mention a file path in your response, prefix the repository-relative path \
   with `@`. For example, write `@src/main.rs` or `@LICENSE`, not `src/main.rs` or \
   `LICENSE`.";
