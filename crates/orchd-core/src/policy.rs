use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::{
  command::PolicyPatch,
  permission::{PermissionKind, PermissionRequest, PermissionScope},
  tool::CanonicalTool,
};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RuleAction {
  Allow,
  Deny,
}

/// One ordered allow/deny rule: matches a `PermissionKind` plus an optional
/// glob pattern against the request's subject (path for file rules, command
/// for shell, host for network). A `None` pattern matches any subject of
/// that kind.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct PolicyRule {
  pub action: RuleAction,
  pub kind: PermissionKind,
  pub pattern: Option<String>,
}

/// Blanket modes layered on top of the ordered rule list: the hard defaults
/// every session starts with. Server-configured only; `UpdatePolicy` can't
/// adjust them yet.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct PolicyModes {
  /// Auto-allow tool calls the adapter identified as read-only
  /// (`CanonicalTool::FileRead` / `Search`) when no explicit rule already
  /// decided them.
  pub auto_approve_reads: bool,
  /// Auto-deny anything gated under `PermissionKind::NetworkAccess`,
  /// regardless of rules.
  pub deny_network: bool,
  /// Auto-deny file writes/edits whose path resolves outside the
  /// session's `cwd`, regardless of rules. Best-effort: only enforced
  /// when the adapter's detail actually carries a path.
  pub writes_confined_to_cwd: bool,
}

impl Default for PolicyModes {
  fn default() -> Self {
    Self { auto_approve_reads: true, deny_network: false, writes_confined_to_cwd: true }
  }
}

#[derive(Clone, Debug)]
pub enum Verdict {
  AutoAllow,
  AutoDeny(String),
  AskHuman,
}

/// Per-session policy state: the actor owns one instance, mutates it via
/// `allow_always`/`apply_patch`, and persists `to_json()` after each change
/// so a respawned actor can reload the same rules.
pub struct PolicyEngine {
  rules: Vec<PolicyRule>,
  modes: PolicyModes,
}

impl PolicyEngine {
  pub fn new(modes: PolicyModes) -> Self {
    Self { rules: Vec::new(), modes }
  }

  pub fn with_rules(modes: PolicyModes, rules: Vec<PolicyRule>) -> Self {
    Self { rules, modes }
  }

  pub fn rules(&self) -> &[PolicyRule] {
    &self.rules
  }

  /// Deny-by-default: hard mode boundaries win over rules, explicit
  /// rules win over the `auto_approve_reads` fallback, and anything
  /// still undecided is asked of a human.
  pub fn evaluate(&self, req: &PermissionRequest, cwd: &Path) -> Verdict {
    let kind = req.kind;

    if kind == PermissionKind::NetworkAccess && self.modes.deny_network {
      return Verdict::AutoDeny("network access denied by policy".to_string());
    }

    if kind == PermissionKind::FileWrite && self.modes.writes_confined_to_cwd {
      if let Some(path) = subject(kind, &req.detail) {
        if !path_within(cwd, &path) {
          return Verdict::AutoDeny(format!(
            "write to '{path}' is outside the session workspace"
          ));
        }
      }
    }

    for rule in &self.rules {
      if rule.kind != kind {
        continue;
      }
      let matched = match (&rule.pattern, subject(kind, &req.detail)) {
        (None, _) => true,
        (Some(pattern), Some(subj)) => glob_match(pattern, &subj),
        (Some(_), None) => false,
      };
      if matched {
        return match rule.action {
          RuleAction::Allow => Verdict::AutoAllow,
          RuleAction::Deny => Verdict::AutoDeny(format!(
            "denied by policy rule matching '{}'",
            rule.pattern.clone().unwrap_or_else(|| "*".to_string())
          )),
        };
      }
    }

    if self.modes.auto_approve_reads {
      let is_read = matches!(
        req.tool.as_ref().map(|t| &t.canonical),
        Some(CanonicalTool::FileRead) | Some(CanonicalTool::Search)
      );
      if is_read {
        return Verdict::AutoAllow;
      }
    }

    Verdict::AskHuman
  }

  /// Applies a `Decision::AllowAlways` scope. Inserted at the front so
  /// the most recently granted rule always takes priority over older,
  /// possibly conflicting ones.
  pub fn allow_always(&mut self, scope: PermissionScope) {
    self.rules.insert(
      0,
      PolicyRule { action: RuleAction::Allow, kind: scope.kind, pattern: scope.pattern },
    );
  }

  /// Replaces the entire rule list from a client-supplied `UpdatePolicy`
  /// patch. Modes aren't part of this wire schema yet, only the ordered
  /// allow/deny list is.
  pub fn apply_patch(&mut self, patch: &PolicyPatch) -> Result<(), serde_json::Error> {
    let rules: Vec<PolicyRule> = serde_json::from_value(patch.rules.clone())?;
    self.rules = rules;
    Ok(())
  }

  pub fn to_json(&self) -> serde_json::Value {
    serde_json::to_value(&self.rules).unwrap_or_else(|_| serde_json::Value::Array(vec![]))
  }
}

fn subject(kind: PermissionKind, detail: &serde_json::Value) -> Option<String> {
  match kind {
    PermissionKind::FileWrite => detail
      .get("paths")
      .and_then(serde_json::Value::as_array)
      .and_then(|a| a.first())
      .and_then(serde_json::Value::as_str)
      .map(String::from),
    PermissionKind::ShellExec => {
      detail.get("command").and_then(serde_json::Value::as_str).map(String::from)
    }
    PermissionKind::NetworkAccess => {
      detail.get("host").and_then(serde_json::Value::as_str).map(String::from)
    }
    PermissionKind::ToolUse | PermissionKind::Custom => {
      detail.get("tool").and_then(serde_json::Value::as_str).map(String::from)
    }
  }
}

fn path_within(cwd: &Path, candidate: &str) -> bool {
  let candidate_path = Path::new(candidate);
  let joined = if candidate_path.is_absolute() {
    candidate_path.to_path_buf()
  } else {
    cwd.join(candidate_path)
  };
  normalize_lexically(&joined).starts_with(normalize_lexically(cwd))
}

/// Resolves `.`/`..` components without touching the filesystem: writes may
/// target paths that don't exist yet, so `fs::canonicalize` can't be used.
fn normalize_lexically(path: &Path) -> PathBuf {
  let mut out = PathBuf::new();
  for component in path.components() {
    match component {
      std::path::Component::ParentDir => {
        out.pop();
      }
      std::path::Component::CurDir => {}
      other => out.push(other.as_os_str()),
    }
  }
  out
}

/// Minimal `*`-only glob matcher (full-string match). Rule counts and
/// pattern lengths are small and operator-authored, so the naive recursive
/// approach is fine.
pub fn glob_match(pattern: &str, subject: &str) -> bool {
  fn helper(p: &[u8], s: &[u8]) -> bool {
    match (p.first(), s.first()) {
      (None, None) => true,
      (Some(b'*'), _) => helper(&p[1..], s) || (!s.is_empty() && helper(p, &s[1..])),
      (Some(pc), Some(sc)) if pc == sc => helper(&p[1..], &s[1..]),
      _ => false,
    }
  }
  helper(pattern.as_bytes(), subject.as_bytes())
}

#[cfg(test)]
mod tests {
  use serde_json::json;
  use time::OffsetDateTime;

  use super::*;
  use crate::{agent::AgentKind, ids::ApprovalId, tool::ToolRef};

  fn request(
    kind: PermissionKind,
    detail: serde_json::Value,
    tool: Option<CanonicalTool>,
  ) -> PermissionRequest {
    PermissionRequest {
      request_id: ApprovalId::new(),
      call_id: None,
      tool: tool.map(|canonical| ToolRef {
        canonical,
        native_name: "Native".to_string(),
        agent: AgentKind::ClaudeCode,
      }),
      kind,
      summary: "test".to_string(),
      detail,
      suggested: None,
      expires_at: OffsetDateTime::now_utc() + time::Duration::minutes(5),
    }
  }

  #[test]
  fn glob_matches_prefix_and_suffix_wildcards() {
    assert!(glob_match("*.env", "config.env"));
    assert!(glob_match("/etc/*", "/etc/passwd"));
    assert!(glob_match("*", "anything"));
    assert!(!glob_match("*.env", "config.json"));
  }

  #[test]
  fn deny_network_mode_overrides_everything() {
    let modes = PolicyModes { deny_network: true, ..PolicyModes::default() };
    let engine = PolicyEngine::new(modes);
    let req = request(
      PermissionKind::NetworkAccess,
      json!({ "host": "example.com" }),
      Some(CanonicalTool::WebFetch),
    );
    assert!(matches!(
      engine.evaluate(&req, Path::new("/workspace")),
      Verdict::AutoDeny(_)
    ));
  }

  #[test]
  fn writes_confined_to_cwd_denies_paths_outside_workspace() {
    let engine = PolicyEngine::new(PolicyModes::default());
    let req = request(
      PermissionKind::FileWrite,
      json!({ "paths": ["/etc/passwd"] }),
      Some(CanonicalTool::FileWrite),
    );
    assert!(matches!(
      engine.evaluate(&req, Path::new("/workspace")),
      Verdict::AutoDeny(_)
    ));
  }

  #[test]
  fn writes_confined_to_cwd_allows_paths_inside_via_explicit_rule() {
    let mut engine = PolicyEngine::new(PolicyModes::default());
    engine
      .allow_always(PermissionScope { kind: PermissionKind::FileWrite, pattern: None });
    let req = request(
      PermissionKind::FileWrite,
      json!({ "paths": ["src/main.rs"] }),
      Some(CanonicalTool::FileWrite),
    );
    assert!(matches!(engine.evaluate(&req, Path::new("/workspace")), Verdict::AutoAllow));
  }

  #[test]
  fn explicit_deny_rule_wins_over_missing_allow() {
    let mut engine = PolicyEngine::new(PolicyModes::default());
    engine.rules.push(PolicyRule {
      action: RuleAction::Deny,
      kind: PermissionKind::ShellExec,
      pattern: Some("rm *".to_string()),
    });
    let req = request(
      PermissionKind::ShellExec,
      json!({ "command": "rm -rf /" }),
      Some(CanonicalTool::ShellExec),
    );
    assert!(matches!(
      engine.evaluate(&req, Path::new("/workspace")),
      Verdict::AutoDeny(_)
    ));
  }

  #[test]
  fn unmatched_shell_exec_asks_a_human_by_default() {
    let engine = PolicyEngine::new(PolicyModes::default());
    let req = request(
      PermissionKind::ShellExec,
      json!({ "command": "ls" }),
      Some(CanonicalTool::ShellExec),
    );
    assert!(matches!(engine.evaluate(&req, Path::new("/workspace")), Verdict::AskHuman));
  }

  #[test]
  fn auto_approve_reads_mode_allows_file_reads() {
    let engine = PolicyEngine::new(PolicyModes::default());
    let req = request(
      PermissionKind::ToolUse,
      json!({ "tool": "Read" }),
      Some(CanonicalTool::FileRead),
    );
    assert!(matches!(engine.evaluate(&req, Path::new("/workspace")), Verdict::AutoAllow));
  }

  #[test]
  fn apply_patch_replaces_rule_set() {
    let mut engine = PolicyEngine::new(PolicyModes::default());
    let patch = PolicyPatch {
      rules: json!([{ "action": "allow", "kind": "shell_exec", "pattern": "git *" }]),
    };
    engine.apply_patch(&patch).expect("valid patch");
    let req = request(
      PermissionKind::ShellExec,
      json!({ "command": "git status" }),
      Some(CanonicalTool::ShellExec),
    );
    assert!(matches!(engine.evaluate(&req, Path::new("/workspace")), Verdict::AutoAllow));
  }
}
