use serde::{Deserialize, Serialize};

use crate::{agent::AgentKind, permission::PermissionKind};

/// Agent-agnostic tool identity. Adapters map their native tool names onto
/// this where they can; anything unmapped stays `Custom` so no information
/// is lost, it just doesn't get special UI treatment.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CanonicalTool {
  FileRead,
  FileWrite,
  FileEdit,
  ShellExec,
  Search,
  WebFetch,
  Mcp,
  Custom,
}

impl CanonicalTool {
  /// The `PermissionKind` bucket the policy engine gates this tool under.
  /// Reads/search have no dedicated `PermissionKind` (most agents don't
  /// gate them at all); they fall back to `ToolUse`, distinguishable from
  /// a genuine `ToolUse` ask by the request's `tool` field when present.
  pub fn permission_kind(&self) -> PermissionKind {
    match self {
      CanonicalTool::FileWrite | CanonicalTool::FileEdit => PermissionKind::FileWrite,
      CanonicalTool::ShellExec => PermissionKind::ShellExec,
      CanonicalTool::WebFetch => PermissionKind::NetworkAccess,
      CanonicalTool::FileRead | CanonicalTool::Search | CanonicalTool::Mcp => {
        PermissionKind::ToolUse
      }
      CanonicalTool::Custom => PermissionKind::Custom,
    }
  }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ToolRef {
  pub canonical: CanonicalTool,
  pub native_name: String,
  pub agent: AgentKind,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ToolOutput {
  Text { text: String },
  Json { value: serde_json::Value },
  FileDiff { path: String, diff: String },
}
