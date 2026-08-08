use serde::{Deserialize, Serialize};
use time::OffsetDateTime;

use crate::{
  ids::{ApprovalId, ToolCallId},
  tool::ToolRef,
};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PermissionKind {
  FileWrite,
  ShellExec,
  NetworkAccess,
  ToolUse,
  Custom,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct PermissionScope {
  pub kind: PermissionKind,
  /// Glob/pattern this rule applies to (path glob, command prefix, host), if
  /// any.
  pub pattern: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct PermissionRequest {
  pub request_id: ApprovalId,
  pub call_id: Option<ToolCallId>,
  /// Canonical tool identity, when the adapter could determine one. Lets
  /// the policy engine distinguish e.g. a read-only tool ask from a
  /// generic `ToolUse` ask without depending on adapter-specific naming.
  pub tool: Option<ToolRef>,
  pub kind: PermissionKind,
  pub summary: String,
  pub detail: serde_json::Value,
  pub suggested: Option<Decision>,
  #[serde(with = "time::serde::rfc3339")]
  pub expires_at: OffsetDateTime,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Decision {
  Allow,
  AllowAlways { scope: PermissionScope },
  Deny { reason: Option<String> },
  Modify { updated_input: serde_json::Value },
}
