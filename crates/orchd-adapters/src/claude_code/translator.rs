use std::{
  collections::HashMap,
  io::{Read, Seek, SeekFrom},
  path::PathBuf,
};

use orchd_core::{
  AdapterError, AgentCapabilities, AgentKind, AgentMode, ApprovalId, BlockId,
  CanonicalTool, ContentPart, Decision, ErrorScope, EventPayload, Frame,
  PermissionRequest, SessionCommand, StopReason, ToolCallId, ToolOutput, ToolRef,
  Translator, TurnId,
};
use serde_json::{Value, json};
use time::OffsetDateTime;
use uuid::Uuid;

/// A `tool_use` block whose input is still arriving as `input_json_delta`
/// chunks. Parsed and emitted at `content_block_stop`.
struct PendingToolCall {
  native_id: String,
  name: String,
  input_json: String,
}

/// Token usage for a single model call, captured from `message_start`. This is
/// the real context occupancy, unlike `result.usage`, which sums every
/// internal call the CLI made working through a turn's tool loop and so
/// balloons with the number of tool round trips.
#[derive(Clone, Copy, Default)]
struct MessageUsage {
  input_tokens: u64,
  cache_creation_input_tokens: u64,
  cache_read_input_tokens: u64,
}

/// Stateful native-to-canonical translator for one `claude -p` stream-json
/// subprocess.
///
/// The wire shapes below were captured from a running CLI (v2.1.223) rather
/// than documentation, and drift across versions.
pub struct ClaudeCodeTranslator {
  native_session_id: Option<String>,
  sent_session_init: bool,
  capabilities: AgentCapabilities,
  /// Needed to locate the CLI's own on-disk transcript for title extraction.
  cwd: PathBuf,
  title: Option<String>,
  /// Byte length of the transcript file as of the last `refresh_title` read,
  /// so an unchanged file is skipped without reparsing it.
  title_read_len: u64,
  /// Content-block index to canonical block id, for text and thinking blocks
  /// open in the assistant message being streamed.
  text_blocks: HashMap<u32, BlockId>,
  tool_calls: HashMap<u32, PendingToolCall>,
  /// Native `tool_use` id to canonical call id, so a later `tool_result`
  /// (keyed by the native id) matches back to our `ToolCallId`.
  call_ids: HashMap<String, ToolCallId>,
  /// Canonical approval id to native control-request id, so `encode_decision`
  /// knows which `control_response` to send.
  pending_approvals: HashMap<ApprovalId, String>,
  /// Usage from the most recent `message_start`. Needs no reset: a fresh
  /// `message_start` always precedes the `result` that reads it.
  last_message_usage: Option<MessageUsage>,
  /// Set once a `control_request { interrupt }` is sent and cleared on the
  /// `result` it produces. The CLI reports a user-requested stop exactly like
  /// a real failure (`is_error: true`, `subtype: "error_during_execution"`),
  /// so this flag is the only way `decode_result` can tell them apart. Also
  /// cleared when a new turn starts, so a too-late interrupt can't mislabel a
  /// later turn's genuine error.
  interrupt_requested: bool,
}

impl ClaudeCodeTranslator {
  pub fn new(
    capabilities: AgentCapabilities,
    resume_native_session_id: Option<String>,
    cwd: PathBuf,
  ) -> Self {
    Self {
      native_session_id: resume_native_session_id,
      sent_session_init: false,
      capabilities,
      cwd,
      title: None,
      title_read_len: 0,
      text_blocks: HashMap::new(),
      tool_calls: HashMap::new(),
      call_ids: HashMap::new(),
      pending_approvals: HashMap::new(),
      last_message_usage: None,
      interrupt_requested: false,
    }
  }

  /// Tails Claude Code's own on-disk transcript for the
  /// `{"type":"ai-title","aiTitle":"..."}` lines it writes to name
  /// conversations in its `--resume` picker. The on-disk format is
  /// undocumented and can drift across versions, so every failure here is
  /// swallowed: the session keeps working with whatever title it already had.
  fn refresh_title(&mut self) {
    let Some(native_id) = self.native_session_id.clone() else { return };
    let Some(home) = std::env::var_os("HOME") else { return };

    let encoded = self.cwd.to_string_lossy().replace('/', "-");
    let path = PathBuf::from(home)
      .join(".claude")
      .join("projects")
      .join(encoded)
      .join(format!("{native_id}.jsonl"));

    let Ok(mut file) = std::fs::File::open(&path) else { return };
    let Ok(len) = file.metadata().map(|m| m.len()) else { return };
    if len <= self.title_read_len {
      return;
    }
    self.title_read_len = len;

    // The CLI can re-emit an updated `ai-title` line later in the same
    // conversation, so re-read the whole transcript rather than only the
    // appended tail and take the last occurrence.
    if file.seek(SeekFrom::Start(0)).is_err() {
      return;
    }
    let mut contents = String::new();
    if file.read_to_string(&mut contents).is_err() {
      return;
    }

    for line in contents.lines().rev() {
      let Ok(value) = serde_json::from_str::<Value>(line) else { continue };
      if value.get("type").and_then(Value::as_str) != Some("ai-title") {
        continue;
      }
      if let Some(title) = value.get("aiTitle").and_then(Value::as_str) {
        self.title = Some(title.to_string());
      }
      return;
    }
  }

  fn decode_system(&mut self, value: &Value) -> Result<Vec<EventPayload>, AdapterError> {
    // The CLI re-emits `system`/`init` at the start of every turn, not just at
    // process start, so only the first one becomes a canonical `SessionInit`.
    if let Some(id) = value.get("session_id").and_then(Value::as_str) {
      self.native_session_id = Some(id.to_string());
    }

    if value.get("subtype").and_then(Value::as_str) != Some("init")
      || self.sent_session_init
    {
      return Ok(vec![]);
    }
    self.sent_session_init = true;

    Ok(vec![EventPayload::SessionInit {
      agent: AgentKind::ClaudeCode,
      native_session_id: self.native_session_id.clone(),
      model: value.get("model").and_then(Value::as_str).map(String::from),
      capabilities: self.capabilities.clone(),
    }])
  }

  fn decode_stream_event(
    &mut self,
    value: &Value,
  ) -> Result<Vec<EventPayload>, AdapterError> {
    let event = value
      .get("event")
      .ok_or_else(|| AdapterError::Decode("stream_event missing `event`".into()))?;

    match event.get("type").and_then(Value::as_str) {
      Some("content_block_start") => self.on_block_start(event),
      Some("content_block_delta") => self.on_block_delta(event),
      Some("content_block_stop") => self.on_block_stop(event),
      // Captures this individual call's context size; stop_reason still comes
      // from the richer `result` message at the end of the turn.
      Some("message_start") => self.on_message_start(event),
      _ => Ok(vec![]),
    }
  }

  fn on_message_start(
    &mut self,
    event: &Value,
  ) -> Result<Vec<EventPayload>, AdapterError> {
    let usage = event.get("message").and_then(|m| m.get("usage"));
    self.last_message_usage = Some(MessageUsage {
      input_tokens: usage
        .and_then(|u| u.get("input_tokens"))
        .and_then(Value::as_u64)
        .unwrap_or(0),
      cache_creation_input_tokens: usage
        .and_then(|u| u.get("cache_creation_input_tokens"))
        .and_then(Value::as_u64)
        .unwrap_or(0),
      cache_read_input_tokens: usage
        .and_then(|u| u.get("cache_read_input_tokens"))
        .and_then(Value::as_u64)
        .unwrap_or(0),
    });
    Ok(vec![])
  }

  fn on_block_start(&mut self, event: &Value) -> Result<Vec<EventPayload>, AdapterError> {
    let Some(index) = block_index(event) else {
      return Ok(vec![]);
    };
    let block = event.get("content_block");

    if block.and_then(|b| b.get("type")).and_then(Value::as_str) == Some("tool_use") {
      let native_id = block
        .and_then(|b| b.get("id"))
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
      let name = block
        .and_then(|b| b.get("name"))
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
      self
        .tool_calls
        .insert(index, PendingToolCall { native_id, name, input_json: String::new() });
    } else {
      self.text_blocks.insert(index, BlockId::new());
    }
    Ok(vec![])
  }

  fn on_block_delta(&mut self, event: &Value) -> Result<Vec<EventPayload>, AdapterError> {
    let Some(index) = block_index(event) else {
      return Ok(vec![]);
    };
    let Some(delta) = event.get("delta") else {
      return Ok(vec![]);
    };

    match delta.get("type").and_then(Value::as_str) {
      Some("text_delta") => {
        let text =
          delta.get("text").and_then(Value::as_str).unwrap_or_default().to_string();
        let block = *self.text_blocks.entry(index).or_default();
        Ok(vec![EventPayload::TextDelta { block, text }])
      }
      Some("thinking_delta") => {
        let text =
          delta.get("thinking").and_then(Value::as_str).unwrap_or_default().to_string();
        let block = *self.text_blocks.entry(index).or_default();
        Ok(vec![EventPayload::ThinkingDelta { block, text, redacted: false }])
      }
      Some("input_json_delta") => {
        if let Some(chunk) = delta.get("partial_json").and_then(Value::as_str) {
          if let Some(pending) = self.tool_calls.get_mut(&index) {
            pending.input_json.push_str(chunk);
          }
        }
        Ok(vec![])
      }
      // signature_delta carries nothing the canonical schema models yet.
      _ => Ok(vec![]),
    }
  }

  fn on_block_stop(&mut self, event: &Value) -> Result<Vec<EventPayload>, AdapterError> {
    let Some(index) = block_index(event) else {
      return Ok(vec![]);
    };
    self.text_blocks.remove(&index);

    let Some(pending) = self.tool_calls.remove(&index) else {
      return Ok(vec![]);
    };

    let input: Value = if pending.input_json.trim().is_empty() {
      json!({})
    } else {
      serde_json::from_str(&pending.input_json)
        .map_err(|err| AdapterError::Decode(format!("bad tool_use input JSON: {err}")))?
    };

    let call_id = ToolCallId::new();
    self.call_ids.insert(pending.native_id, call_id);

    Ok(vec![EventPayload::ToolCallRequested {
      call_id,
      tool: ToolRef {
        canonical: canonical_tool(&pending.name),
        native_name: pending.name,
        agent: AgentKind::ClaudeCode,
      },
      input,
      // The CLI emits this before it knows whether it will ask permission;
      // the matching `control_request` arrives later, and clients correlate
      // the two by `call_id` rather than by this flag.
      needs_approval: false,
    }])
  }

  fn decode_user(&mut self, value: &Value) -> Result<Vec<EventPayload>, AdapterError> {
    let Some(items) = value.pointer("/message/content").and_then(Value::as_array) else {
      return Ok(vec![]);
    };

    let mut events = Vec::new();
    for item in items {
      if item.get("type").and_then(Value::as_str) != Some("tool_result") {
        continue;
      }
      let Some(native_id) = item.get("tool_use_id").and_then(Value::as_str) else {
        continue;
      };
      let Some(&call_id) = self.call_ids.get(native_id) else {
        continue;
      };
      let is_error = item.get("is_error").and_then(Value::as_bool).unwrap_or(false);
      events.push(EventPayload::ToolCallCompleted {
        call_id,
        output: tool_output_from(item.get("content")),
        is_error,
      });
    }
    Ok(events)
  }

  fn decode_control_request(
    &mut self,
    value: &Value,
  ) -> Result<Vec<EventPayload>, AdapterError> {
    let Some(native_request_id) = value.get("request_id").and_then(Value::as_str) else {
      return Ok(vec![]);
    };
    let Some(request) = value.get("request") else {
      return Ok(vec![]);
    };
    if request.get("subtype").and_then(Value::as_str) != Some("can_use_tool") {
      // Other control subtypes aren't modeled in the canonical schema yet.
      return Ok(vec![]);
    }

    let approval_id = ApprovalId::new();
    self.pending_approvals.insert(approval_id, native_request_id.to_string());

    let call_id = request
      .get("tool_use_id")
      .and_then(Value::as_str)
      .and_then(|id| self.call_ids.get(id).copied());
    let tool_name = request.get("tool_name").and_then(Value::as_str).unwrap_or("tool");
    let canonical = canonical_tool(tool_name);
    let summary = request
      .get("description")
      .and_then(Value::as_str)
      .map(String::from)
      .unwrap_or_else(|| format!("{tool_name} requires permission"));

    Ok(vec![EventPayload::PermissionRequested(PermissionRequest {
      request_id: approval_id,
      call_id,
      tool: Some(ToolRef {
        canonical: canonical.clone(),
        native_name: tool_name.to_string(),
        agent: AgentKind::ClaudeCode,
      }),
      kind: canonical.permission_kind(),
      summary,
      detail: structured_detail(tool_name, request),
      suggested: None,
      expires_at: OffsetDateTime::now_utc() + time::Duration::minutes(5),
    })])
  }

  fn decode_result(&mut self, value: &Value) -> Result<Vec<EventPayload>, AdapterError> {
    let is_error = value.get("is_error").and_then(Value::as_bool).unwrap_or(false);
    let subtype = value.get("subtype").and_then(Value::as_str).unwrap_or_default();
    let was_interrupted = std::mem::take(&mut self.interrupt_requested);

    let mut events = Vec::new();

    // `result.usage` is a billing total summed over every internal model call
    // this turn, so it grows with the number of tool round trips rather than
    // with what's actually in context. Prefer the last `message_start`, and
    // fall back only for a turn that errored before producing one.
    let usage = value.get("usage");
    let context_usage = self.last_message_usage.unwrap_or(MessageUsage {
      input_tokens: usage
        .and_then(|u| u.get("input_tokens"))
        .and_then(Value::as_u64)
        .unwrap_or(0),
      cache_creation_input_tokens: usage
        .and_then(|u| u.get("cache_creation_input_tokens"))
        .and_then(Value::as_u64)
        .unwrap_or(0),
      cache_read_input_tokens: usage
        .and_then(|u| u.get("cache_read_input_tokens"))
        .and_then(Value::as_u64)
        .unwrap_or(0),
    });
    events.push(EventPayload::UsageUpdate {
      input_tokens: context_usage.input_tokens,
      output_tokens: usage
        .and_then(|u| u.get("output_tokens"))
        .and_then(Value::as_u64)
        .unwrap_or(0),
      cache_creation_input_tokens: context_usage.cache_creation_input_tokens,
      cache_read_input_tokens: context_usage.cache_read_input_tokens,
      cost_usd: value.get("total_cost_usd").and_then(Value::as_f64),
    });

    if is_error && !was_interrupted {
      let message = value
        .get("result")
        .and_then(Value::as_str)
        .map(String::from)
        .unwrap_or_else(|| format!("agent turn failed: {subtype}"));
      events.push(EventPayload::Error {
        scope: ErrorScope::Adapter,
        code: subtype.to_string(),
        message,
        recoverable: true,
      });
    }

    let stop_reason = match (is_error, was_interrupted, subtype) {
      (_, true, _) => StopReason::Interrupted,
      (false, _, _) => StopReason::EndTurn,
      (true, _, "error_max_turns") => StopReason::MaxTokens,
      (true, _, _) => StopReason::Error,
    };
    // `turn` is a placeholder: the session actor owns turn grouping and
    // overwrites this field before persisting.
    events.push(EventPayload::TurnCompleted { turn: TurnId::new(), stop_reason });

    Ok(events)
  }
}

impl Translator for ClaudeCodeTranslator {
  fn decode(&mut self, frame: Frame) -> Result<Vec<EventPayload>, AdapterError> {
    let text = std::str::from_utf8(frame.as_bytes())
      .map_err(|err| AdapterError::Decode(err.to_string()))?;
    if text.trim().is_empty() {
      return Ok(vec![]);
    }

    let value: Value = serde_json::from_str(text)
      .map_err(|err| AdapterError::Decode(format!("invalid JSON line: {err}")))?;

    let result = match value.get("type").and_then(Value::as_str) {
      Some("system") => self.decode_system(&value),
      Some("stream_event") => self.decode_stream_event(&value),
      Some("user") => self.decode_user(&value),
      Some("control_request") => self.decode_control_request(&value),
      Some("result") => self.decode_result(&value),
      // "assistant" duplicates what stream_event already delivered
      // incrementally, "control_response" only answers requests we sent, and
      // "rate_limit_event"/"control_cancel_request" are informational.
      _ => Ok(vec![]),
    };
    // A no-op unless the transcript file grew, so per-frame is cheap enough.
    self.refresh_title();
    result
  }

  fn encode(&mut self, cmd: &SessionCommand) -> Result<Vec<Frame>, AdapterError> {
    match cmd {
      SessionCommand::UserMessage { content, .. } => {
        self.interrupt_requested = false;
        let text = content
          .iter()
          .map(|p| match p {
            ContentPart::Text { text } => text.as_str(),
          })
          .collect::<Vec<_>>()
          .join("\n");
        let frame = json!({
            "type": "user",
            "message": { "role": "user", "content": [{ "type": "text", "text": text }] },
        });
        Ok(vec![Frame::from_json(&frame)?])
      }
      SessionCommand::Interrupt => {
        self.interrupt_requested = true;
        let frame = json!({
            "type": "control_request",
            "request_id": Uuid::now_v7().to_string(),
            "request": { "subtype": "interrupt" },
        });
        Ok(vec![Frame::from_json(&frame)?])
      }
      // Verified against CLI 2.1.224: `set_permission_mode` takes a `mode`
      // matching one of `--permission-mode`'s own choices. Build maps to the
      // same value the adapter spawns with, so toggling back doesn't drift
      // from the spawn-time baseline.
      SessionCommand::SetMode { mode } => {
        let mode = match mode {
          AgentMode::Build => "default",
          AgentMode::Plan => "plan",
        };
        let frame = json!({
            "type": "control_request",
            "request_id": Uuid::now_v7().to_string(),
            "request": { "subtype": "set_permission_mode", "mode": mode },
        });
        Ok(vec![Frame::from_json(&frame)?])
      }
      // Verified against CLI 2.1.224: `set_model` accepts `model` and
      // `effort`, either omittable to leave it unchanged.
      SessionCommand::SetModel { model, effort, .. } => {
        let mut request = json!({ "subtype": "set_model" });
        if let Some(model) = model {
          request["model"] = json!(model);
        }
        if let Some(effort) = effort {
          request["effort"] = json!(effort);
        }
        let frame = json!({
            "type": "control_request",
            "request_id": Uuid::now_v7().to_string(),
            "request": request,
        });
        Ok(vec![Frame::from_json(&frame)?])
      }
      // Approvals go out via `encode_decision`; policy patches, close and
      // title generation are actor-local and produce no wire message.
      SessionCommand::ResolveApproval { .. }
      | SessionCommand::UpdatePolicy(_)
      | SessionCommand::Close { .. }
      | SessionCommand::RegenerateTitle
      | SessionCommand::TitleGenerationCompleted { .. } => Ok(vec![]),
    }
  }

  fn encode_decision(
    &mut self,
    req: &PermissionRequest,
    decision: &Decision,
  ) -> Result<Vec<Frame>, AdapterError> {
    let native_request_id =
      self.pending_approvals.remove(&req.request_id).ok_or_else(|| {
        AdapterError::Protocol("no pending control_request for this approval".into())
      })?;

    let response = match decision {
      Decision::Allow | Decision::AllowAlways { .. } => json!({ "behavior": "allow" }),
      Decision::Deny { reason } => json!({
          "behavior": "deny",
          "message": reason.clone().unwrap_or_default(),
      }),
      Decision::Modify { updated_input } => json!({
          "behavior": "allow",
          "updatedInput": updated_input,
      }),
    };

    let frame = json!({
        "type": "control_response",
        "response": {
            "subtype": "success",
            "request_id": native_request_id,
            "response": response,
        },
    });
    Ok(vec![Frame::from_json(&frame)?])
  }

  fn native_session_id(&self) -> Option<String> {
    self.native_session_id.clone()
  }

  fn title(&self) -> Option<String> {
    self.title.clone()
  }
}

fn block_index(event: &Value) -> Option<u32> {
  event.get("index").and_then(Value::as_u64).map(|i| i as u32)
}

fn canonical_tool(native_name: &str) -> CanonicalTool {
  match native_name {
    "Read" | "NotebookRead" => CanonicalTool::FileRead,
    "Write" => CanonicalTool::FileWrite,
    "Edit" | "NotebookEdit" => CanonicalTool::FileEdit,
    "Bash" | "BashOutput" | "KillShell" => CanonicalTool::ShellExec,
    "Grep" | "Glob" => CanonicalTool::Search,
    "WebFetch" | "WebSearch" => CanonicalTool::WebFetch,
    name if name.starts_with("mcp__") => CanonicalTool::Mcp,
    _ => CanonicalTool::Custom,
  }
}

/// Normalizes a native `can_use_tool` request into the paths/command/host
/// shape `PermissionRequest.detail` carries, so the policy engine can match
/// rules without knowing Claude's native field names. The full native request
/// is kept under `raw` so nothing is lost for UI display.
fn structured_detail(tool_name: &str, request: &Value) -> Value {
  let input = request.get("input").cloned().unwrap_or(Value::Null);

  let mut detail = match canonical_tool(tool_name) {
    CanonicalTool::FileWrite | CanonicalTool::FileEdit | CanonicalTool::FileRead => {
      let path =
        input.get("file_path").or_else(|| input.get("path")).and_then(Value::as_str);
      json!({ "tool": tool_name, "paths": path.map(|p| vec![p]).unwrap_or_default() })
    }
    CanonicalTool::ShellExec => {
      let command = input.get("command").and_then(Value::as_str).unwrap_or_default();
      json!({ "tool": tool_name, "command": command })
    }
    CanonicalTool::WebFetch => {
      let url = input.get("url").and_then(Value::as_str).unwrap_or_default();
      json!({ "tool": tool_name, "url": url, "host": extract_host(url) })
    }
    CanonicalTool::Search | CanonicalTool::Mcp | CanonicalTool::Custom => {
      json!({ "tool": tool_name })
    }
  };

  if let Value::Object(map) = &mut detail {
    map.insert("input".to_string(), input);
    map.insert("raw".to_string(), request.clone());
  }
  detail
}

/// Extracts the host from a URL without pulling in a URL-parsing dependency.
fn extract_host(url: &str) -> Option<String> {
  let without_scheme = url.split("://").nth(1).unwrap_or(url);
  let host = without_scheme.split(['/', '?', '#']).next()?;
  let host = host.rsplit('@').next()?;
  let host = host.split(':').next()?;
  if host.is_empty() { None } else { Some(host.to_string()) }
}

fn tool_output_from(content: Option<&Value>) -> ToolOutput {
  match content {
    Some(Value::String(s)) => ToolOutput::Text { text: s.clone() },
    Some(Value::Array(items)) => {
      let text = items
        .iter()
        .filter_map(|i| i.get("text").and_then(Value::as_str))
        .collect::<Vec<_>>()
        .join("\n");
      if text.is_empty() {
        ToolOutput::Json { value: Value::Array(items.clone()) }
      } else {
        ToolOutput::Text { text }
      }
    }
    Some(other) => ToolOutput::Json { value: other.clone() },
    None => ToolOutput::Text { text: String::new() },
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  fn translator() -> ClaudeCodeTranslator {
    ClaudeCodeTranslator::new(
      AgentCapabilities {
        thinking: true,
        structured_tools: true,
        resume: true,
        native_permissions: true,
        skills: true,
      },
      None,
      PathBuf::from("/tmp"),
    )
  }

  fn message_start_frame(input: u64, cache_creation: u64, cache_read: u64) -> Frame {
    Frame::from_json(&json!({
      "type": "stream_event",
      "event": {
        "type": "message_start",
        "message": {
          "usage": {
            "input_tokens": input,
            "cache_creation_input_tokens": cache_creation,
            "cache_read_input_tokens": cache_read,
            "output_tokens": 1,
          }
        }
      }
    }))
    .unwrap()
  }

  fn result_frame(
    input: u64,
    cache_creation: u64,
    cache_read: u64,
    output: u64,
  ) -> Frame {
    Frame::from_json(&json!({
      "type": "result",
      "subtype": "success",
      "is_error": false,
      "total_cost_usd": 0.5,
      "usage": {
        "input_tokens": input,
        "cache_creation_input_tokens": cache_creation,
        "cache_read_input_tokens": cache_read,
        "output_tokens": output,
      }
    }))
    .unwrap()
  }

  /// A turn with several internal tool-loop model calls ends with a `result`
  /// whose `usage` sums all of them, inflated far past what's in context.
  /// Reported context usage must follow the last `message_start` instead.
  #[test]
  fn context_usage_comes_from_last_message_start_not_cumulative_result() {
    let mut t = translator();

    // Simulate 3 internal model calls within one turn, each re-reading a
    // growing but still roughly-constant-sized cached prefix.
    t.decode(message_start_frame(2, 0, 36_000)).unwrap();
    t.decode(message_start_frame(5, 1_000, 37_000)).unwrap();
    t.decode(message_start_frame(12, 2_356, 40_000)).unwrap();

    // `result.usage` sums all three calls together, as the real CLI does.
    let events = t.decode(result_frame(19, 3_356, 113_000, 771)).unwrap();

    let usage = events
      .iter()
      .find_map(|e| match e {
        EventPayload::UsageUpdate {
          input_tokens,
          cache_creation_input_tokens,
          cache_read_input_tokens,
          output_tokens,
          ..
        } => Some((
          *input_tokens,
          *cache_creation_input_tokens,
          *cache_read_input_tokens,
          *output_tokens,
        )),
        _ => None,
      })
      .expect("decode_result must emit a UsageUpdate");

    // Context fields: the last message_start's numbers, not the cumulative
    // result total (12, 2_356, 40_000 vs the inflated 19, 3_356, 113_000).
    assert_eq!(usage, (12, 2_356, 40_000, 771));
  }

  /// If a turn errors before any `message_start` is ever observed, fall
  /// back to `result.usage` rather than reporting zero.
  #[test]
  fn context_usage_falls_back_to_result_when_no_message_start_seen() {
    let mut t = translator();
    let events = t.decode(result_frame(10, 20, 30, 5)).unwrap();

    let usage = events.iter().find_map(|e| match e {
      EventPayload::UsageUpdate {
        input_tokens,
        cache_creation_input_tokens,
        cache_read_input_tokens,
        ..
      } => Some((*input_tokens, *cache_creation_input_tokens, *cache_read_input_tokens)),
      _ => None,
    });

    assert_eq!(usage, Some((10, 20, 30)));
  }
}
