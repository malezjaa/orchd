use std::{
  collections::{HashMap, VecDeque},
  path::PathBuf,
};

use orchd_core::{
  AdapterError, AgentCapabilities, AgentKind, ApprovalId, BlockId, CanonicalTool,
  ContentPart, Decision, ErrorScope, EventPayload, FILE_MENTION_INSTRUCTIONS, Frame,
  PermissionRequest, SessionCommand, StopReason, SubagentStatus, ThinkingEffort,
  ToolCallId, ToolOutput, ToolRef, Translator, TurnId,
};
use serde_json::{Value, json};
use time::OffsetDateTime;
use uuid::Uuid;

const JSON_RPC_VERSION: &str = "2.0";

#[derive(Clone)]
enum PendingRequest {
  Initialize,
  StartThread,
  ResumeThread,
  StartTurn,
  Interrupt,
  UpdateThreadSettings,
  StartSubagentTurn { thread_id: String },
  InterruptSubagent { thread_id: String },
  ReadSubagent { thread_id: String },
}

struct PendingApproval {
  native_id: Value,
  method: String,
}

struct SubagentState {
  nickname: Option<String>,
  role: Option<String>,
  prompt: Option<String>,
  model: Option<String>,
  effort: Option<String>,
  status: SubagentStatus,
  can_accept_direct_input: Option<bool>,
  active_turn_id: Option<String>,
  summary: String,
  last_emitted_summary: Option<String>,
}

impl Default for SubagentState {
  fn default() -> Self {
    Self {
      nickname: None,
      role: None,
      prompt: None,
      model: None,
      effort: None,
      status: SubagentStatus::Pending,
      can_accept_direct_input: None,
      active_turn_id: None,
      summary: String::new(),
      last_emitted_summary: None,
    }
  }
}

/// Stateful translator for the Codex app-server v2 JSON-RPC protocol.
pub struct CodexTranslator {
  native_session_id: Option<String>,
  sent_session_init: bool,
  capabilities: AgentCapabilities,
  cwd: PathBuf,
  next_request_id: u64,
  pending_requests: HashMap<String, PendingRequest>,
  outgoing: VecDeque<Frame>,
  pending_messages: VecDeque<(Uuid, Vec<ContentPart>)>,
  pending_approvals: HashMap<ApprovalId, PendingApproval>,
  native_calls: HashMap<String, ToolCallId>,
  native_inputs: HashMap<String, Value>,
  blocks: HashMap<String, BlockId>,
  active_turn_id: Option<String>,
  interrupt_requested: bool,
  model: Option<String>,
  effort: Option<ThinkingEffort>,
  fast_mode: Option<bool>,
  subagents: HashMap<String, SubagentState>,
}

impl CodexTranslator {
  pub fn new(
    capabilities: AgentCapabilities,
    cwd: PathBuf,
    resume_native_session_id: Option<String>,
    model: Option<String>,
  ) -> Self {
    Self {
      native_session_id: resume_native_session_id,
      sent_session_init: false,
      capabilities,
      cwd,
      next_request_id: 1,
      pending_requests: HashMap::new(),
      outgoing: VecDeque::new(),
      pending_messages: VecDeque::new(),
      pending_approvals: HashMap::new(),
      native_calls: HashMap::new(),
      native_inputs: HashMap::new(),
      blocks: HashMap::new(),
      active_turn_id: None,
      interrupt_requested: false,
      model,
      effort: None,
      fast_mode: None,
      subagents: HashMap::new(),
    }
  }

  fn queue_request(
    &mut self,
    method: &str,
    params: Value,
    pending: PendingRequest,
  ) -> Result<(), AdapterError> {
    let id = self.next_request_id;
    self.next_request_id += 1;
    self.pending_requests.insert(id.to_string(), pending);
    self.outgoing.push_back(Frame::from_json(&json!({
      "jsonrpc": JSON_RPC_VERSION,
      "id": id,
      "method": method,
      "params": params,
    }))?);
    Ok(())
  }

  fn queue_notification(
    &mut self,
    method: &str,
    params: Value,
  ) -> Result<(), AdapterError> {
    self.outgoing.push_back(Frame::from_json(&json!({
      "jsonrpc": JSON_RPC_VERSION,
      "method": method,
      "params": params,
    }))?);
    Ok(())
  }

  fn queue_thread_request(&mut self) -> Result<(), AdapterError> {
    let mut params = if let Some(thread_id) = &self.native_session_id {
      json!({
        "threadId": thread_id,
        "cwd": self.cwd,
        "approvalPolicy": "on-request",
        "sandbox": "workspace-write",
        "developerInstructions": FILE_MENTION_INSTRUCTIONS,
      })
    } else {
      json!({
        "cwd": self.cwd,
        "approvalPolicy": "on-request",
        "sandbox": "workspace-write",
        "developerInstructions": FILE_MENTION_INSTRUCTIONS,
      })
    };
    if let Some(fast_mode) = self.fast_mode {
      params["serviceTier"] = if fast_mode { json!("priority") } else { Value::Null };
    }
    let (method, pending) = if self.native_session_id.is_some() {
      ("thread/resume", PendingRequest::ResumeThread)
    } else {
      ("thread/start", PendingRequest::StartThread)
    };
    self.queue_request(method, params, pending)
  }

  fn queue_turn(
    &mut self,
    client_msg_id: Uuid,
    content: Vec<ContentPart>,
  ) -> Result<(), AdapterError> {
    let Some(thread_id) = self.native_session_id.clone() else {
      self.pending_messages.push_back((client_msg_id, content));
      return Ok(());
    };

    self.queue_turn_for_thread(&thread_id, Some(client_msg_id), content)
  }

  fn queue_turn_for_thread(
    &mut self,
    thread_id: &str,
    client_msg_id: Option<Uuid>,
    content: Vec<ContentPart>,
  ) -> Result<(), AdapterError> {
    let skills = content
      .iter()
      .filter_map(|part| match part {
        ContentPart::Skill { name, path: Some(path) } => Some(json!({
          "type": "skill",
          "name": name,
          "path": path,
        })),
        _ => None,
      })
      .collect::<Vec<_>>();
    let mut input = Vec::new();
    let mut text = String::new();
    for part in content {
      match part {
        ContentPart::Text { text: value } => text.push_str(&value),
        // Codex's native skill marker is `$name`. The structured item below
        // gives the app-server the skill file path when the UI discovered it.
        ContentPart::Skill { name, .. } => text.push_str(&format!("${name}")),
        ContentPart::Image { media_type, data, .. } => {
          if !text.is_empty() {
            input.push(json!({ "type": "text", "text": std::mem::take(&mut text) }));
          }
          input.push(json!({
            "type": "image",
            "url": format!("data:{media_type};base64,{data}"),
          }));
        }
      }
    }
    if !text.is_empty() || input.is_empty() {
      input.push(json!({ "type": "text", "text": text }));
    }
    input.extend(skills);

    let mut params = json!({
      "threadId": thread_id,
      "input": input,
    });
    if let Some(client_msg_id) = client_msg_id {
      params["clientUserMessageId"] = json!(client_msg_id.to_string());
    }
    if let Some(model) = &self.model {
      params["model"] = json!(model);
    }
    if let Some(effort) = self.effort {
      params["effort"] = json!(effort_name(effort));
    }
    if let Some(fast_mode) = self.fast_mode {
      params["serviceTier"] = if fast_mode { json!("priority") } else { Value::Null };
    }
    let pending = if client_msg_id.is_some()
      && self.native_session_id.as_deref() == Some(thread_id)
    {
      PendingRequest::StartTurn
    } else {
      PendingRequest::StartSubagentTurn { thread_id: thread_id.to_string() }
    };
    self.queue_request("turn/start", params, pending)
  }

  fn queue_subagent_interrupt(&mut self, thread_id: &str) -> Result<(), AdapterError> {
    let Some(turn_id) =
      self.subagents.get(thread_id).and_then(|s| s.active_turn_id.clone())
    else {
      return Err(AdapterError::Protocol(format!(
        "subagent {thread_id} has no active turn"
      )));
    };
    self.queue_request(
      "turn/interrupt",
      json!({ "threadId": thread_id, "turnId": turn_id }),
      PendingRequest::InterruptSubagent { thread_id: thread_id.to_string() },
    )
  }

  fn queue_subagent_read(&mut self, thread_id: &str) -> Result<(), AdapterError> {
    self.queue_request(
      "thread/read",
      json!({ "threadId": thread_id, "includeTurns": true }),
      PendingRequest::ReadSubagent { thread_id: thread_id.to_string() },
    )
  }

  fn flush_pending_messages(&mut self) -> Result<(), AdapterError> {
    while let Some((client_msg_id, content)) = self.pending_messages.pop_front() {
      self.queue_turn(client_msg_id, content)?;
    }
    Ok(())
  }

  fn handle_response(
    &mut self,
    value: &Value,
  ) -> Result<Vec<EventPayload>, AdapterError> {
    let Some(id) = value.get("id") else { return Ok(vec![]) };
    let key = request_id_key(id);
    let Some(request) = self.pending_requests.remove(&key) else {
      return Ok(vec![]);
    };

    if let Some(error) = value.get("error") {
      let message = error
        .get("message")
        .and_then(Value::as_str)
        .unwrap_or("Codex request failed")
        .to_string();
      return Ok(vec![EventPayload::Error {
        scope: ErrorScope::Adapter,
        code: "codex_rpc_error".to_string(),
        message,
        recoverable: !matches!(request, PendingRequest::Initialize),
      }]);
    }

    match request {
      PendingRequest::Initialize => {
        self.queue_notification("initialized", json!({}))?;
        self.queue_thread_request()?;
        Ok(vec![])
      }
      PendingRequest::StartThread | PendingRequest::ResumeThread => {
        let result = value.get("result").cloned().unwrap_or(Value::Null);
        let events = self.handle_thread_started(&result)?;
        self.flush_pending_messages()?;
        if self.interrupt_requested {
          self.queue_interrupt()?;
        }
        Ok(events)
      }
      PendingRequest::StartTurn => {
        let turn_id =
          value.pointer("/result/turn/id").and_then(Value::as_str).map(str::to_string);
        self.active_turn_id = turn_id;
        if self.interrupt_requested {
          self.queue_interrupt()?;
        }
        Ok(vec![])
      }
      PendingRequest::StartSubagentTurn { thread_id } => {
        let turn_id =
          value.pointer("/result/turn/id").and_then(Value::as_str).map(str::to_string);
        if let Some(state) = self.subagents.get_mut(&thread_id) {
          state.active_turn_id = turn_id.clone();
          state.status = SubagentStatus::Running;
        }
        Ok(vec![EventPayload::SubagentStatusChanged {
          thread_id,
          status: SubagentStatus::Running,
          message: None,
          can_accept_direct_input: Some(true),
          active_turn_id: turn_id,
        }])
      }
      PendingRequest::Interrupt => Ok(vec![]),
      PendingRequest::InterruptSubagent { thread_id } => {
        Ok(vec![EventPayload::SubagentStatusChanged {
          thread_id,
          status: SubagentStatus::Interrupted,
          message: None,
          can_accept_direct_input: Some(true),
          active_turn_id: None,
        }])
      }
      PendingRequest::ReadSubagent { thread_id } => {
        let result = value.get("result").unwrap_or(&Value::Null);
        let mut events = self.decode_subagent_metadata(&thread_id, result);
        let summary = extract_thread_summary(result);
        if let Some(event) = self.subagent_result(&thread_id, summary) {
          events.push(event);
        }
        Ok(events)
      }
      PendingRequest::UpdateThreadSettings => Ok(vec![]),
    }
  }

  fn queue_thread_settings_update(&mut self) -> Result<(), AdapterError> {
    let Some(thread_id) = self.native_session_id.clone() else {
      return Ok(());
    };
    if !self.sent_session_init {
      return Ok(());
    }

    let mut params = json!({ "threadId": thread_id });
    if let Some(model) = &self.model {
      params["model"] = json!(model);
    }
    if let Some(effort) = self.effort {
      params["effort"] = json!(effort_name(effort));
    }
    if let Some(fast_mode) = self.fast_mode {
      params["serviceTier"] = if fast_mode { json!("priority") } else { Value::Null };
    }
    self.queue_request(
      "thread/settings/update",
      params,
      PendingRequest::UpdateThreadSettings,
    )
  }

  fn handle_thread_started(
    &mut self,
    result: &Value,
  ) -> Result<Vec<EventPayload>, AdapterError> {
    let thread = result.get("thread").unwrap_or(result);
    if let Some(parent_thread_id) = thread.get("parentThreadId").and_then(Value::as_str) {
      let thread_id = thread.get("id").and_then(Value::as_str).unwrap_or_default();
      if thread_id.is_empty() {
        return Ok(vec![]);
      }
      let state = self.subagents.entry(thread_id.to_string()).or_default();
      if let Some(nickname) = thread.get("agentNickname").and_then(Value::as_str) {
        state.nickname = Some(nickname.to_string());
      }
      if let Some(role) = thread.get("agentRole").and_then(Value::as_str) {
        state.role = Some(role.to_string());
      }
      if let Some(model) = thread.get("model").and_then(Value::as_str) {
        state.model = Some(model.to_string());
      }
      state.can_accept_direct_input =
        thread.get("canAcceptDirectInput").and_then(Value::as_bool);
      if state.nickname.is_none() {
        state.nickname = infer_spawn_nickname(state.prompt.as_deref());
      }
      if let Some(preview) = thread.get("preview").and_then(Value::as_str) {
        state.prompt = Some(preview.to_string());
      }
      if state.nickname.is_none() {
        state.nickname = infer_spawn_nickname(state.prompt.as_deref());
      }
      state.status = SubagentStatus::Running;
      let _ = parent_thread_id;
      return Ok(vec![EventPayload::SubagentStarted {
        thread_id: thread_id.to_string(),
        nickname: state.nickname.clone(),
        role: state.role.clone(),
        prompt: state.prompt.clone(),
        model: state.model.clone(),
        effort: None,
        status: state.status.clone(),
        can_accept_direct_input: state.can_accept_direct_input,
        active_turn_id: state.active_turn_id.clone(),
      }]);
    }
    if let Some(id) = thread.get("id").and_then(Value::as_str) {
      self.native_session_id = Some(id.to_string());
    }
    let reported_model = result
      .get("model")
      .and_then(Value::as_str)
      .or_else(|| thread.get("model").and_then(Value::as_str))
      .map(str::to_string);
    let model = self.model.clone().or(reported_model);
    self.model = model.clone();
    if self.sent_session_init {
      return Ok(vec![]);
    }
    self.sent_session_init = true;
    Ok(vec![EventPayload::SessionInit {
      agent: AgentKind::Codex,
      native_session_id: self.native_session_id.clone(),
      model,
      capabilities: self.capabilities.clone(),
    }])
  }

  fn queue_interrupt(&mut self) -> Result<(), AdapterError> {
    let (Some(thread_id), Some(turn_id)) =
      (self.native_session_id.clone(), self.active_turn_id.clone())
    else {
      return Ok(());
    };
    self.queue_request(
      "turn/interrupt",
      json!({ "threadId": thread_id, "turnId": turn_id }),
      PendingRequest::Interrupt,
    )?;
    self.interrupt_requested = false;
    Ok(())
  }

  fn decode_notification(
    &mut self,
    value: &Value,
  ) -> Result<Vec<EventPayload>, AdapterError> {
    let Some(method) = value.get("method").and_then(Value::as_str) else {
      return Ok(vec![]);
    };
    let params = value.get("params").unwrap_or(&Value::Null);
    match method {
      "thread/started" => self.handle_thread_started(params),
      "thread/name/updated" => Ok(
        params
          .get("threadName")
          .and_then(Value::as_str)
          .map(|title| vec![EventPayload::TitleUpdated { title: title.to_string() }])
          .unwrap_or_default(),
      ),
      "turn/started" => {
        let thread_id = params.get("threadId").and_then(Value::as_str).unwrap_or("");
        let turn_id =
          params.pointer("/turn/id").and_then(Value::as_str).map(str::to_string);
        if !thread_id.is_empty()
          && thread_id != self.native_session_id.as_deref().unwrap_or("")
        {
          if let Some(state) = self.subagents.get_mut(thread_id) {
            state.active_turn_id = turn_id.clone();
            state.status = SubagentStatus::Running;
          }
          Ok(vec![EventPayload::SubagentStatusChanged {
            thread_id: thread_id.to_string(),
            status: SubagentStatus::Running,
            message: None,
            can_accept_direct_input: Some(true),
            active_turn_id: turn_id,
          }])
        } else {
          self.active_turn_id = turn_id;
          Ok(vec![])
        }
      }
      "turn/completed" => self.decode_turn_completed_for_thread(
        params.get("threadId").and_then(Value::as_str).unwrap_or(""),
        params,
      ),
      "thread/tokenUsage/updated" => self.decode_usage(params),
      "item/started" => self.decode_item_started(params),
      "item/completed" => self.decode_item_completed(params),
      "item/agentMessage/delta" => self.decode_agent_message_delta(params),
      "item/reasoning/summaryTextDelta" => self.decode_reasoning_delta(params),
      "item/commandExecution/outputDelta" | "item/fileChange/outputDelta" => {
        let Some(item_id) = params.get("itemId").and_then(Value::as_str) else {
          return Ok(vec![]);
        };
        let Some(&call_id) = self.native_calls.get(item_id) else {
          return Ok(vec![]);
        };
        Ok(vec![EventPayload::ToolCallProgress {
          call_id,
          chunk: json!({ "text": params.get("delta").cloned().unwrap_or(Value::Null) }),
        }])
      }
      "error" => {
        let message = params
          .pointer("/error/message")
          .and_then(Value::as_str)
          .or_else(|| params.get("message").and_then(Value::as_str))
          .unwrap_or("Codex reported an error")
          .to_string();
        Ok(vec![EventPayload::Error {
          scope: ErrorScope::Adapter,
          code: "codex_error".to_string(),
          message,
          recoverable: params.get("willRetry").and_then(Value::as_bool).unwrap_or(false),
        }])
      }
      _ => Ok(vec![]),
    }
  }

  fn decode_item_started(
    &mut self,
    params: &Value,
  ) -> Result<Vec<EventPayload>, AdapterError> {
    let Some(item) = params.get("item") else { return Ok(vec![]) };
    if item.get("type").and_then(Value::as_str) == Some("subAgentActivity") {
      return self.decode_subagent_activity(item);
    }
    if item.get("type").and_then(Value::as_str) == Some("collabAgentToolCall") {
      return self.decode_collab_item(item);
    }
    let Some(item_id) = item.get("id").and_then(Value::as_str) else {
      return Ok(vec![]);
    };
    let item_type = item.get("type").and_then(Value::as_str).unwrap_or_default();
    let (tool_name, canonical, input) = match item_type {
      "commandExecution" => (
        "commandExecution",
        CanonicalTool::ShellExec,
        json!({
          "command": item.get("command").cloned().unwrap_or(Value::Null),
          "cwd": item.get("cwd").cloned().unwrap_or(Value::Null),
        }),
      ),
      "fileChange" => (
        "fileChange",
        CanonicalTool::FileEdit,
        item.get("changes").cloned().unwrap_or_else(|| json!([])),
      ),
      "mcpToolCall" => (
        item.get("tool").and_then(Value::as_str).unwrap_or("mcpToolCall"),
        CanonicalTool::Mcp,
        item.get("arguments").cloned().unwrap_or(Value::Null),
      ),
      "webSearch" => (
        "webSearch",
        CanonicalTool::Search,
        json!({
          "query": item.get("query").cloned().unwrap_or(Value::Null),
          "action": item.get("action").cloned().unwrap_or(Value::Null),
        }),
      ),
      _ => return Ok(vec![]),
    };
    if canonical == CanonicalTool::ShellExec
      && input
        .get("command")
        .and_then(Value::as_str)
        .map(str::trim)
        .map(str::is_empty)
        .unwrap_or(true)
    {
      return Ok(vec![]);
    }
    let call_id = ToolCallId::new();
    self.native_calls.insert(item_id.to_string(), call_id);
    self.native_inputs.insert(item_id.to_string(), input.clone());
    Ok(vec![EventPayload::ToolCallRequested {
      call_id,
      tool: ToolRef {
        canonical,
        native_name: tool_name.to_string(),
        agent: AgentKind::Codex,
      },
      input,
      needs_approval: false,
    }])
  }

  fn decode_item_completed(
    &mut self,
    params: &Value,
  ) -> Result<Vec<EventPayload>, AdapterError> {
    let Some(item) = params.get("item") else { return Ok(vec![]) };
    if item.get("type").and_then(Value::as_str) == Some("subAgentActivity") {
      return self.decode_subagent_activity(item);
    }
    if item.get("type").and_then(Value::as_str) == Some("collabAgentToolCall") {
      return self.decode_collab_item(item);
    }
    let Some(item_id) = item.get("id").and_then(Value::as_str) else {
      return Ok(vec![]);
    };
    let Some(call_id) = self.native_calls.remove(item_id) else {
      return Ok(vec![]);
    };
    self.native_inputs.remove(item_id);
    let status = item.get("status").and_then(Value::as_str).unwrap_or_default();
    let output = match item.get("type").and_then(Value::as_str) {
      Some("commandExecution") => ToolOutput::Text {
        text: item
          .get("aggregatedOutput")
          .and_then(Value::as_str)
          .unwrap_or_default()
          .to_string(),
      },
      Some("fileChange") => ToolOutput::Json {
        value: item.get("changes").cloned().unwrap_or_else(|| json!([])),
      },
      Some("mcpToolCall") => {
        ToolOutput::Json { value: item.get("result").cloned().unwrap_or(Value::Null) }
      }
      Some("webSearch") => ToolOutput::Json {
        value: item.get("results").cloned().unwrap_or_else(|| item.clone()),
      },
      _ => return Ok(vec![]),
    };
    Ok(vec![EventPayload::ToolCallCompleted {
      call_id,
      output,
      is_error: matches!(status, "failed" | "declined"),
    }])
  }

  fn decode_agent_message_delta(
    &mut self,
    params: &Value,
  ) -> Result<Vec<EventPayload>, AdapterError> {
    let Some(item_id) = params.get("itemId").and_then(Value::as_str) else {
      return Ok(vec![]);
    };
    let thread_id = params.get("threadId").and_then(Value::as_str).unwrap_or("");
    if !thread_id.is_empty()
      && thread_id != self.native_session_id.as_deref().unwrap_or("")
    {
      let state = self.subagents.entry(thread_id.to_string()).or_default();
      state
        .summary
        .push_str(params.get("delta").and_then(Value::as_str).unwrap_or_default());
      if state.summary.len() > 8_000 {
        state.summary.truncate(8_000);
      }
      return Ok(vec![]);
    }
    let block = *self.blocks.entry(item_id.to_string()).or_default();
    Ok(vec![EventPayload::TextDelta {
      block,
      text: params.get("delta").and_then(Value::as_str).unwrap_or_default().to_string(),
    }])
  }

  fn decode_reasoning_delta(
    &mut self,
    params: &Value,
  ) -> Result<Vec<EventPayload>, AdapterError> {
    let Some(item_id) = params.get("itemId").and_then(Value::as_str) else {
      return Ok(vec![]);
    };
    let key = format!("reasoning:{item_id}");
    let thread_id = params.get("threadId").and_then(Value::as_str).unwrap_or("");
    if !thread_id.is_empty()
      && thread_id != self.native_session_id.as_deref().unwrap_or("")
    {
      return Ok(vec![]);
    }
    let block = *self.blocks.entry(key).or_default();
    Ok(vec![EventPayload::ThinkingDelta {
      block,
      text: params.get("delta").and_then(Value::as_str).unwrap_or_default().to_string(),
      redacted: false,
    }])
  }

  fn decode_usage(&self, params: &Value) -> Result<Vec<EventPayload>, AdapterError> {
    let usage = params.pointer("/tokenUsage/last").unwrap_or(&Value::Null);
    Ok(vec![EventPayload::UsageUpdate {
      input_tokens: number_u64(usage.get("inputTokens")),
      output_tokens: number_u64(usage.get("outputTokens")),
      cache_creation_input_tokens: number_u64(usage.get("cacheWriteInputTokens")),
      cache_read_input_tokens: number_u64(usage.get("cachedInputTokens")),
      cost_usd: None,
    }])
  }

  fn decode_turn_completed(
    &mut self,
    params: &Value,
  ) -> Result<Vec<EventPayload>, AdapterError> {
    let turn = params.get("turn").unwrap_or(&Value::Null);
    self.active_turn_id = None;
    let status = turn.get("status").and_then(Value::as_str).unwrap_or("failed");
    let mut events = Vec::new();
    if status == "failed" {
      let message = turn
        .pointer("/error/message")
        .and_then(Value::as_str)
        .unwrap_or("Codex turn failed")
        .to_string();
      events.push(EventPayload::Error {
        scope: ErrorScope::Adapter,
        code: "codex_turn_failed".to_string(),
        message,
        recoverable: true,
      });
    }
    let stop_reason = match status {
      "completed" => StopReason::EndTurn,
      "interrupted" => StopReason::Interrupted,
      _ => StopReason::Error,
    };
    events.push(EventPayload::TurnCompleted { turn: TurnId::new(), stop_reason });
    Ok(events)
  }

  fn decode_server_request(
    &mut self,
    value: &Value,
  ) -> Result<Vec<EventPayload>, AdapterError> {
    let Some(method) = value.get("method").and_then(Value::as_str) else {
      return Ok(vec![]);
    };
    let Some(native_id) = value.get("id") else { return Ok(vec![]) };
    let params = value.get("params").unwrap_or(&Value::Null);
    let (kind, tool_name, canonical, mut detail) = match method {
      "item/commandExecution/requestApproval" => {
        let command = params.get("command").and_then(Value::as_str).unwrap_or_default();
        (
          CanonicalTool::ShellExec.permission_kind(),
          "commandExecution",
          CanonicalTool::ShellExec,
          json!({ "command": command, "cwd": params.get("cwd"), "raw": params }),
        )
      }
      "item/fileChange/requestApproval" => {
        let paths = params
          .get("itemId")
          .and_then(Value::as_str)
          .and_then(|item_id| self.native_inputs.get(item_id))
          .map(file_change_paths)
          .unwrap_or_default();
        (
          CanonicalTool::FileEdit.permission_kind(),
          "fileChange",
          CanonicalTool::FileEdit,
          json!({ "paths": paths, "raw": params }),
        )
      }
      "item/permissions/requestApproval" => (
        orchd_core::PermissionKind::Custom,
        "permissions",
        CanonicalTool::Custom,
        json!({ "cwd": params.get("cwd"), "raw": params }),
      ),
      _ => {
        self.outgoing.push_back(Frame::from_json(&json!({
          "jsonrpc": JSON_RPC_VERSION,
          "id": native_id,
          "error": { "code": -32601, "message": "unsupported Codex server request" },
        }))?);
        return Ok(vec![]);
      }
    };
    if let Some(thread_id) = params.get("threadId").and_then(Value::as_str) {
      detail["thread_id"] = json!(thread_id);
      if self.native_session_id.as_deref() != Some(thread_id) {
        if let Some(parent_thread_id) = &self.native_session_id {
          detail["parent_thread_id"] = json!(parent_thread_id);
        }
      }
    }
    let approval_id = ApprovalId::new();
    self.pending_approvals.insert(
      approval_id,
      PendingApproval { native_id: native_id.clone(), method: method.to_string() },
    );
    let call_id = params
      .get("itemId")
      .and_then(Value::as_str)
      .and_then(|item_id| self.native_calls.get(item_id).copied());
    let summary = params
      .get("reason")
      .and_then(Value::as_str)
      .map(str::to_string)
      .unwrap_or_else(|| format!("{tool_name} requires permission"));
    Ok(vec![EventPayload::PermissionRequested(PermissionRequest {
      request_id: approval_id,
      call_id,
      tool: Some(ToolRef {
        canonical,
        native_name: tool_name.to_string(),
        agent: AgentKind::Codex,
      }),
      kind,
      summary,
      detail,
      suggested: None,
      expires_at: OffsetDateTime::now_utc() + time::Duration::minutes(5),
    })])
  }

  fn decode_turn_completed_for_thread(
    &mut self,
    thread_id: &str,
    params: &Value,
  ) -> Result<Vec<EventPayload>, AdapterError> {
    if thread_id.is_empty()
      || thread_id == self.native_session_id.as_deref().unwrap_or("")
    {
      return self.decode_turn_completed(params);
    }
    let turn = params.get("turn").unwrap_or(&Value::Null);
    let status = turn.get("status").and_then(Value::as_str).unwrap_or("failed");
    let status = match status {
      "pendingInit" | "pending" | "pending_init" => SubagentStatus::Pending,
      "completed" => SubagentStatus::Completed,
      "interrupted" => SubagentStatus::Interrupted,
      "shutdown" => SubagentStatus::Shutdown,
      "notFound" | "not_found" => SubagentStatus::NotFound,
      "running" => SubagentStatus::Running,
      _ => SubagentStatus::Errored,
    };
    let message =
      turn.pointer("/error/message").and_then(Value::as_str).map(str::to_string);
    if let Some(state) = self.subagents.get_mut(thread_id) {
      state.active_turn_id = None;
      state.status = status.clone();
    }
    let mut events = vec![EventPayload::SubagentStatusChanged {
      thread_id: thread_id.to_string(),
      status,
      message,
      can_accept_direct_input: Some(true),
      active_turn_id: None,
    }];
    if let Some(event) = self.subagent_result(thread_id, String::new()) {
      events.push(event);
    }
    Ok(events)
  }

  fn subagent_result(
    &mut self,
    thread_id: &str,
    read_summary: String,
  ) -> Option<EventPayload> {
    let state = self.subagents.get_mut(thread_id)?;
    if !read_summary.is_empty() {
      state.summary = read_summary;
    }
    if state.summary.is_empty()
      || state.last_emitted_summary.as_deref() == Some(state.summary.as_str())
    {
      return None;
    }
    state.last_emitted_summary = Some(state.summary.clone());
    Some(EventPayload::SubagentResult {
      thread_id: thread_id.to_string(),
      summary: state.summary.clone(),
    })
  }

  fn decode_subagent_activity(
    &mut self,
    item: &Value,
  ) -> Result<Vec<EventPayload>, AdapterError> {
    let Some(thread_id) = item.get("agentThreadId").and_then(Value::as_str) else {
      return Ok(vec![]);
    };
    let status = match item.get("kind").and_then(Value::as_str) {
      Some("started") | Some("interacted") => SubagentStatus::Running,
      Some("completed") | Some("done") => SubagentStatus::Completed,
      Some("interrupted") => SubagentStatus::Interrupted,
      Some("errored") | Some("error") | Some("failed") => SubagentStatus::Errored,
      Some("shutdown") => SubagentStatus::Shutdown,
      _ => SubagentStatus::Pending,
    };
    let active_turn_id = if matches!(status, SubagentStatus::Running) {
      item.get("turnId").and_then(Value::as_str).map(str::to_string)
    } else {
      None
    };
    self.subagents.entry(thread_id.to_string()).or_default().status = status.clone();
    self.subagents.entry(thread_id.to_string()).or_default().active_turn_id =
      active_turn_id.clone();
    Ok(vec![EventPayload::SubagentStatusChanged {
      thread_id: thread_id.to_string(),
      status,
      message: None,
      can_accept_direct_input: None,
      active_turn_id,
    }])
  }

  fn decode_collab_item(
    &mut self,
    item: &Value,
  ) -> Result<Vec<EventPayload>, AdapterError> {
    let prompt = item.get("prompt").and_then(Value::as_str).map(str::to_string);
    let model = item.get("model").and_then(Value::as_str).map(str::to_string);
    let effort = item.get("reasoningEffort").and_then(Value::as_str).map(str::to_string);
    let nickname = item
      .get("agentNickname")
      .or_else(|| item.get("nickname"))
      .or_else(|| item.get("name"))
      .and_then(Value::as_str)
      .map(str::to_string)
      .or_else(|| infer_spawn_nickname(prompt.as_deref()));
    let mut events = Vec::new();
    let receivers = item
      .get("receiverThreadIds")
      .and_then(Value::as_array)
      .cloned()
      .unwrap_or_default();
    for receiver in receivers {
      let Some(thread_id) = receiver.as_str() else { continue };
      let first_seen = !self.subagents.contains_key(thread_id);
      let state = self.subagents.entry(thread_id.to_string()).or_default();
      if state.nickname.is_none() {
        state.nickname = nickname.clone();
      }
      state.prompt = prompt.clone();
      state.model = model.clone();
      state.effort = effort.clone();
      let status = item
        .pointer(&format!("/agentsStates/{thread_id}/status"))
        .and_then(Value::as_str)
        .map(parse_subagent_status)
        .unwrap_or(SubagentStatus::Pending);
      let message = item
        .pointer(&format!("/agentsStates/{thread_id}/message"))
        .and_then(Value::as_str)
        .map(str::to_string);
      state.status = status.clone();
      if first_seen {
        events.push(EventPayload::SubagentStarted {
          thread_id: thread_id.to_string(),
          nickname: state.nickname.clone(),
          role: state.role.clone(),
          prompt: state.prompt.clone(),
          model: state.model.clone(),
          effort: state.effort.clone(),
          status: status.clone(),
          can_accept_direct_input: state.can_accept_direct_input,
          active_turn_id: state.active_turn_id.clone(),
        });
      } else {
        events.push(EventPayload::SubagentStatusChanged {
          thread_id: thread_id.to_string(),
          status: status.clone(),
          message,
          can_accept_direct_input: state.can_accept_direct_input,
          active_turn_id: state.active_turn_id.clone(),
        });
      }
    }
    Ok(events)
  }

  fn decode_subagent_metadata(
    &mut self,
    thread_id: &str,
    result: &Value,
  ) -> Vec<EventPayload> {
    let thread = result.get("thread").unwrap_or(result);
    let state = self.subagents.entry(thread_id.to_string()).or_default();
    if let Some(nickname) = thread.get("agentNickname").and_then(Value::as_str) {
      state.nickname = Some(nickname.to_string());
    }
    if let Some(role) = thread.get("agentRole").and_then(Value::as_str) {
      state.role = Some(role.to_string());
    }
    if let Some(model) = thread.get("model").and_then(Value::as_str) {
      state.model = Some(model.to_string());
    }
    if let Some(preview) = thread.get("preview").and_then(Value::as_str) {
      state.prompt = Some(preview.to_string());
    }
    state.can_accept_direct_input = thread
      .get("canAcceptDirectInput")
      .and_then(Value::as_bool)
      .or(state.can_accept_direct_input);
    vec![EventPayload::SubagentStarted {
      thread_id: thread_id.to_string(),
      nickname: state.nickname.clone(),
      role: state.role.clone(),
      prompt: state.prompt.clone(),
      model: state.model.clone(),
      effort: state.effort.clone(),
      status: state.status.clone(),
      can_accept_direct_input: state.can_accept_direct_input,
      active_turn_id: state.active_turn_id.clone(),
    }]
  }
}

impl Translator for CodexTranslator {
  fn initial_frames(&mut self) -> Result<Vec<Frame>, AdapterError> {
    self.queue_request(
      "initialize",
      json!({
        "clientInfo": { "name": "orchd", "title": "orchd", "version": "0.1.0" },
        "capabilities": { "experimentalApi": true },
      }),
      PendingRequest::Initialize,
    )?;
    Ok(self.outgoing.drain(..).collect())
  }

  fn decode(&mut self, frame: Frame) -> Result<Vec<EventPayload>, AdapterError> {
    let text = std::str::from_utf8(frame.as_bytes())
      .map_err(|err| AdapterError::Decode(err.to_string()))?;
    if text.trim().is_empty() {
      return Ok(vec![]);
    }
    let value: Value = serde_json::from_str(text).map_err(|err| {
      AdapterError::Decode(format!("invalid Codex JSON-RPC frame: {err}"))
    })?;
    if value.get("method").is_some() && value.get("id").is_some() {
      self.decode_server_request(&value)
    } else if value.get("method").is_some() {
      self.decode_notification(&value)
    } else if value.get("id").is_some() {
      self.handle_response(&value)
    } else {
      Ok(vec![])
    }
  }

  fn drain_outgoing(&mut self) -> Result<Vec<Frame>, AdapterError> {
    Ok(self.outgoing.drain(..).collect())
  }

  fn encode(&mut self, cmd: &SessionCommand) -> Result<Vec<Frame>, AdapterError> {
    match cmd {
      SessionCommand::UserMessage { client_msg_id, content } => {
        self.queue_turn(*client_msg_id, content.clone())?;
      }
      SessionCommand::SendSubagentInput { thread_id, content } => {
        if !self.subagents.contains_key(thread_id) {
          return Err(AdapterError::Protocol(format!("unknown subagent {thread_id}")));
        }
        self.queue_turn_for_thread(thread_id, None, content.clone())?;
      }
      SessionCommand::InterruptSubagent { thread_id } => {
        self.queue_subagent_interrupt(thread_id)?;
      }
      SessionCommand::InspectSubagent { thread_id } => {
        self.queue_subagent_read(thread_id)?;
      }
      SessionCommand::Interrupt => {
        self.interrupt_requested = true;
        self.queue_interrupt()?;
      }
      SessionCommand::SetModel { model, effort, fast_mode } => {
        if let Some(model) = model {
          self.model = Some(model.clone());
        }
        if let Some(effort) = effort {
          self.effort = Some(*effort);
        }
        if let Some(fast_mode) = fast_mode {
          self.fast_mode = Some(*fast_mode);
        }
        self.queue_thread_settings_update()?;
      }
      SessionCommand::SetMode { mode } => {
        // Codex does not have Claude's live permission-mode control request.
        // Build/plan remains a UI-level hint until a Codex plan API is added.
        let _ = mode;
      }
      SessionCommand::ResolveApproval { .. }
      | SessionCommand::UpdatePolicy(_)
      | SessionCommand::Close { .. }
      | SessionCommand::RenameTitle { .. }
      | SessionCommand::RegenerateTitle
      | SessionCommand::TitleGenerationCompleted { .. } => {}
    }
    Ok(self.outgoing.drain(..).collect())
  }

  fn encode_decision(
    &mut self,
    req: &PermissionRequest,
    decision: &Decision,
  ) -> Result<Vec<Frame>, AdapterError> {
    let pending = self.pending_approvals.remove(&req.request_id).ok_or_else(|| {
      AdapterError::Protocol("no pending Codex approval request".to_string())
    })?;
    let accepted = !matches!(decision, Decision::Deny { .. });
    let result = if pending.method == "item/permissions/requestApproval" {
      json!({
        "permissions": {
          "fileSystem": if accepted { Value::Null } else { json!({ "entries": [] }) },
          "network": if accepted { Value::Null } else { json!({ "enabled": false }) },
        },
        "scope": if matches!(decision, Decision::AllowAlways { .. }) { "session" } else { "turn" },
      })
    } else {
      json!({
        "decision": if accepted {
          if matches!(decision, Decision::AllowAlways { .. }) { "acceptForSession" } else { "accept" }
        } else { "decline" },
      })
    };
    Ok(vec![Frame::from_json(&json!({
      "jsonrpc": JSON_RPC_VERSION,
      "id": pending.native_id,
      "result": result,
    }))?])
  }

  fn native_session_id(&self) -> Option<String> {
    self.native_session_id.clone()
  }

  fn restore_subagent(&mut self, thread_id: &str, active_turn_id: Option<&str>) {
    let state = self.subagents.entry(thread_id.to_string()).or_default();
    state.active_turn_id = active_turn_id.map(str::to_string);
  }
}

fn request_id_key(value: &Value) -> String {
  match value {
    Value::String(value) => value.clone(),
    _ => value.to_string(),
  }
}

fn number_u64(value: Option<&Value>) -> u64 {
  value.and_then(Value::as_u64).unwrap_or(0)
}

fn file_change_paths(value: &Value) -> Vec<String> {
  value
    .as_array()
    .into_iter()
    .flatten()
    .filter_map(|change| change.get("path").and_then(Value::as_str).map(str::to_string))
    .collect()
}

fn effort_name(effort: ThinkingEffort) -> &'static str {
  match effort {
    ThinkingEffort::Low => "low",
    ThinkingEffort::Medium => "medium",
    ThinkingEffort::High => "high",
    ThinkingEffort::Xhigh => "xhigh",
    ThinkingEffort::Max => "max",
    ThinkingEffort::Ultra => "ultra",
  }
}

fn parse_subagent_status(status: &str) -> SubagentStatus {
  match status {
    "pendingInit" | "pending" | "pending_init" => SubagentStatus::Pending,
    "running" => SubagentStatus::Running,
    "interrupted" => SubagentStatus::Interrupted,
    "completed" => SubagentStatus::Completed,
    "errored" | "error" => SubagentStatus::Errored,
    "shutdown" => SubagentStatus::Shutdown,
    "notFound" | "not_found" => SubagentStatus::NotFound,
    _ => SubagentStatus::Pending,
  }
}

fn infer_spawn_nickname(prompt: Option<&str>) -> Option<String> {
  let prompt = prompt?.trim_start();
  let rest = prompt.strip_prefix("**")?;
  let end = rest.find("**")?;
  let name = rest[..end].trim();
  (!name.is_empty()).then(|| name.to_string())
}

fn extract_thread_summary(result: &Value) -> String {
  let mut summary = String::new();
  let Some(turns) = result
    .get("thread")
    .and_then(|t| t.get("turns"))
    .and_then(Value::as_array)
    .or_else(|| result.get("turns").and_then(Value::as_array))
  else {
    return summary;
  };
  for turn in turns {
    let Some(items) = turn.get("items").and_then(Value::as_array) else { continue };
    for item in items {
      if item.get("type").and_then(Value::as_str) != Some("agentMessage") {
        continue;
      }
      if let Some(text) = item.get("text").and_then(Value::as_str) {
        summary.push_str(text);
      }
      if summary.len() >= 8_000 {
        summary.truncate(8_000);
        return summary;
      }
    }
  }
  summary
}

#[cfg(test)]
mod tests {
  use super::*;

  fn translator() -> CodexTranslator {
    CodexTranslator::new(
      AgentCapabilities {
        thinking: true,
        structured_tools: true,
        resume: true,
        native_permissions: true,
        skills: true,
        subagents: true,
      },
      PathBuf::from("/tmp/project"),
      None,
      None,
    )
  }

  fn frame(value: Value) -> Frame {
    Frame::from_json(&value).unwrap()
  }

  #[test]
  fn starts_initialize_then_thread() {
    let mut translator = translator();
    let frames = translator.initial_frames().unwrap();
    let init: Value = serde_json::from_slice(frames[0].as_bytes()).unwrap();
    assert_eq!(init["method"], "initialize");

    translator.decode(frame(json!({ "jsonrpc": "2.0", "id": 1, "result": {} }))).unwrap();
    let frames = translator.drain_outgoing().unwrap();
    let thread: Value = serde_json::from_slice(frames[1].as_bytes()).unwrap();
    assert_eq!(thread["method"], "thread/start");
    assert_eq!(thread["params"]["cwd"], "/tmp/project");
  }

  #[test]
  fn queues_message_until_thread_exists() {
    let mut translator = translator();
    translator.initial_frames().unwrap();
    translator
      .encode(&SessionCommand::SetModel {
        model: Some("gpt-5.4".into()),
        effort: None,
        fast_mode: Some(true),
      })
      .unwrap();
    translator
      .encode(&SessionCommand::UserMessage {
        client_msg_id: Uuid::now_v7(),
        content: vec![ContentPart::Text { text: "hello".into() }],
      })
      .unwrap();
    assert!(translator.drain_outgoing().unwrap().is_empty());

    translator.decode(frame(json!({ "jsonrpc": "2.0", "id": 1, "result": {} }))).unwrap();
    translator.drain_outgoing().unwrap();
    translator
      .decode(frame(json!({
        "jsonrpc": "2.0",
        "id": 2,
        "result": { "thread": { "id": "thread-1" }, "model": "gpt-5.4" }
      })))
      .unwrap();
    let frames = translator.drain_outgoing().unwrap();
    assert_eq!(frames.len(), 1);
    let turn: Value = serde_json::from_slice(frames[0].as_bytes()).unwrap();
    assert_eq!(turn["method"], "turn/start");
    assert_eq!(turn["params"]["threadId"], "thread-1");
    assert_eq!(turn["params"]["model"], "gpt-5.4");
    assert_eq!(turn["params"]["serviceTier"], "priority");
  }

  #[test]
  fn encodes_ultra_reasoning_effort() {
    let mut translator = translator();
    translator.initial_frames().unwrap();
    translator
      .encode(&SessionCommand::SetModel {
        model: Some("gpt-5.6-sol".into()),
        effort: Some(ThinkingEffort::Ultra),
        fast_mode: Some(false),
      })
      .unwrap();
    translator
      .encode(&SessionCommand::UserMessage {
        client_msg_id: Uuid::now_v7(),
        content: vec![ContentPart::Text { text: "hello".into() }],
      })
      .unwrap();

    translator.decode(frame(json!({ "jsonrpc": "2.0", "id": 1, "result": {} }))).unwrap();
    translator.drain_outgoing().unwrap();
    translator
      .decode(frame(json!({
        "jsonrpc": "2.0",
        "id": 2,
        "result": { "thread": { "id": "thread-1" }, "model": "gpt-5.6-sol" }
      })))
      .unwrap();
    let frames = translator.drain_outgoing().unwrap();
    let turn: Value = serde_json::from_slice(frames[0].as_bytes()).unwrap();
    assert_eq!(turn["params"]["effort"], "ultra");
    assert!(turn["params"]["serviceTier"].is_null());
  }

  #[test]
  fn updates_thread_service_tier() {
    let mut translator = translator();
    translator.initial_frames().unwrap();
    translator.decode(frame(json!({ "jsonrpc": "2.0", "id": 1, "result": {} }))).unwrap();
    translator.drain_outgoing().unwrap();
    translator
      .decode(frame(json!({
        "jsonrpc": "2.0",
        "id": 2,
        "result": { "thread": { "id": "thread-1" }, "model": "gpt-5.4" }
      })))
      .unwrap();
    translator.drain_outgoing().unwrap();

    let frames = translator
      .encode(&SessionCommand::SetModel {
        model: None,
        effort: None,
        fast_mode: Some(true),
      })
      .unwrap();
    let update: Value = serde_json::from_slice(frames[0].as_bytes()).unwrap();
    assert_eq!(update["method"], "thread/settings/update");
    assert_eq!(update["params"]["threadId"], "thread-1");
    assert_eq!(update["params"]["serviceTier"], "priority");

    translator.decode(frame(json!({ "jsonrpc": "2.0", "id": 3, "result": {} }))).unwrap();
    let frames = translator
      .encode(&SessionCommand::SetModel {
        model: None,
        effort: None,
        fast_mode: Some(false),
      })
      .unwrap();
    let update: Value = serde_json::from_slice(frames[0].as_bytes()).unwrap();
    assert!(update["params"]["serviceTier"].is_null());
  }

  #[test]
  fn translates_text_and_usage_notifications() {
    let mut translator = translator();
    let text = translator
      .decode(frame(json!({
        "method": "item/agentMessage/delta",
        "params": { "itemId": "item-1", "delta": "Hello" }
      })))
      .unwrap();
    assert!(matches!(
      &text[0],
      EventPayload::TextDelta { text, .. } if text == "Hello"
    ));

    let usage = translator
      .decode(frame(json!({
        "method": "thread/tokenUsage/updated",
        "params": { "tokenUsage": { "last": {
          "inputTokens": 10,
          "cachedInputTokens": 20,
          "cacheWriteInputTokens": 3,
          "outputTokens": 5
        }}}
      })))
      .unwrap();
    assert!(matches!(
      usage[0],
      EventPayload::UsageUpdate {
        input_tokens: 10,
        cache_read_input_tokens: 20,
        cache_creation_input_tokens: 3,
        output_tokens: 5,
        ..
      }
    ));
  }

  #[test]
  fn translates_web_search_items() {
    let mut translator = translator();
    let started = translator
      .decode(frame(json!({
        "method": "item/started",
        "params": { "item": {
          "type": "webSearch",
          "id": "search-1",
          "query": "latest Rust release"
        }}
      })))
      .unwrap();
    assert!(matches!(
      &started[0],
      EventPayload::ToolCallRequested { tool, input, .. }
        if tool.canonical == CanonicalTool::Search
          && input["query"] == "latest Rust release"
    ));

    let completed = translator
      .decode(frame(json!({
        "method": "item/completed",
        "params": { "item": {
          "type": "webSearch",
          "id": "search-1",
          "query": "latest Rust release",
          "results": [{
            "title": "Rust releases",
            "url": "https://blog.rust-lang.org/releases/"
          }],
          "status": "completed"
        }}
      })))
      .unwrap();
    assert!(matches!(
      &completed[0],
      EventPayload::ToolCallCompleted {
        output: ToolOutput::Json { value },
        is_error: false,
        ..
      } if value[0]["url"] == "https://blog.rust-lang.org/releases/"
    ));
  }

  #[test]
  fn ignores_empty_command_items() {
    let mut translator = translator();
    let started = translator
      .decode(frame(json!({
        "method": "item/started",
        "params": { "item": {
          "type": "commandExecution",
          "id": "empty-command",
          "command": "  \n",
          "cwd": "/tmp/project"
        }}
      })))
      .unwrap();
    assert!(started.is_empty());

    let completed = translator
      .decode(frame(json!({
        "method": "item/completed",
        "params": { "item": {
          "type": "commandExecution",
          "id": "empty-command",
          "command": "  \n",
          "status": "completed",
          "aggregatedOutput": ""
        }}
      })))
      .unwrap();
    assert!(completed.is_empty());
  }

  #[test]
  fn translates_command_approval_and_encodes_decision() {
    let mut translator = translator();
    translator
      .decode(frame(json!({
        "method": "item/started",
        "params": { "item": {
          "type": "commandExecution",
          "id": "item-1",
          "command": "git status",
          "cwd": "/tmp/project"
        }}
      })))
      .unwrap();
    let events = translator
      .decode(frame(json!({
        "jsonrpc": "2.0",
        "id": 42,
        "method": "item/commandExecution/requestApproval",
        "params": {
          "itemId": "item-1",
          "threadId": "thread-1",
          "turnId": "turn-1",
          "command": "git status"
        }
      })))
      .unwrap();
    let request = match &events[0] {
      EventPayload::PermissionRequested(request) => request.clone(),
      other => panic!("expected permission request, got {other:?}"),
    };
    let frames = translator.encode_decision(&request, &Decision::Allow).unwrap();
    let response: Value = serde_json::from_slice(frames[0].as_bytes()).unwrap();
    assert_eq!(response["id"], 42);
    assert_eq!(response["result"]["decision"], "accept");
  }

  #[test]
  fn translates_child_thread_lifecycle_and_bounded_result() {
    let mut translator = translator();
    let started = translator
      .decode(frame(json!({
        "method": "thread/started",
        "params": { "thread": {
          "id": "child-1",
          "parentThreadId": "parent-1",
          "agentNickname": "researcher",
          "agentRole": "research",
          "preview": "Inspect the repository",
          "model": "gpt-5.4",
          "canAcceptDirectInput": true
        }}
      })))
      .unwrap();
    assert!(matches!(
      &started[0],
      EventPayload::SubagentStarted {
        thread_id,
        nickname: Some(nickname),
        prompt: Some(prompt),
        active_turn_id: None,
        ..
      } if thread_id == "child-1" && nickname == "researcher" && prompt == "Inspect the repository"
    ));

    let delta = "x".repeat(9_000);
    assert!(
      translator
        .decode(frame(json!({
          "method": "item/agentMessage/delta",
          "params": { "threadId": "child-1", "itemId": "message-1", "delta": delta }
        })))
        .unwrap()
        .is_empty()
    );
    let completed = translator
      .decode(frame(json!({
        "method": "turn/completed",
        "params": {
          "threadId": "child-1",
          "turn": { "id": "child-turn-1", "status": "completed" }
        }
      })))
      .unwrap();
    assert!(matches!(
      &completed[0],
      EventPayload::SubagentStatusChanged {
        thread_id,
        status: SubagentStatus::Completed,
        active_turn_id: None,
        ..
      } if thread_id == "child-1"
    ));
    assert!(matches!(
      &completed[1],
      EventPayload::SubagentResult { thread_id, summary }
        if thread_id == "child-1" && summary.len() == 8_000
    ));

    let repeated = translator
      .decode(frame(json!({
        "method": "turn/completed",
        "params": {
          "threadId": "child-1",
          "turn": { "id": "child-turn-1", "status": "completed" }
        }
      })))
      .unwrap();
    assert_eq!(repeated.len(), 1, "duplicate completion must not repeat the summary");
  }

  #[test]
  fn translates_multiple_child_agents_and_unknown_items() {
    let mut translator = translator();
    let events = translator
      .decode(frame(json!({
        "method": "item/started",
        "params": { "item": {
          "type": "collabAgentToolCall",
          "id": "collab-1",
          "prompt": "**Confucius** Review these files",
          "model": "gpt-5.4",
          "reasoningEffort": "high",
          "receiverThreadIds": ["child-1", "child-2"],
          "agentsStates": {
            "child-1": { "status": "running" },
            "child-2": { "status": "pendingInit" }
          }
        }}
      })))
      .unwrap();
    assert_eq!(events.len(), 2);
    assert!(events.iter().all(|event| matches!(
      event,
      EventPayload::SubagentStarted {
        prompt: Some(prompt),
        nickname: Some(nickname),
        ..
      } if prompt == "**Confucius** Review these files" && nickname == "Confucius"
    )));

    let unknown = translator
      .decode(frame(json!({
        "method": "item/started",
        "params": { "item": { "type": "futureCodexItem", "id": "future-1" } }
      })))
      .unwrap();
    assert!(unknown.is_empty());
  }

  #[test]
  fn routes_child_input_interrupt_and_inspection() {
    let mut translator = translator();
    translator
      .decode(frame(json!({
        "method": "thread/started",
        "params": { "thread": {
          "id": "child-1", "parentThreadId": "parent-1"
        }}
      })))
      .unwrap();

    let frames = translator
      .encode(&SessionCommand::SendSubagentInput {
        thread_id: "child-1".into(),
        content: vec![ContentPart::Text { text: "Continue".into() }],
      })
      .unwrap();
    let turn: Value = serde_json::from_slice(frames[0].as_bytes()).unwrap();
    assert_eq!(turn["method"], "turn/start");
    assert_eq!(turn["params"]["threadId"], "child-1");
    assert_eq!(turn["params"]["input"][0]["text"], "Continue");

    translator
      .decode(frame(json!({
        "jsonrpc": "2.0",
        "id": 1,
        "result": { "turn": { "id": "child-turn-1" } }
      })))
      .unwrap();
    let frames = translator
      .encode(&SessionCommand::InterruptSubagent { thread_id: "child-1".into() })
      .unwrap();
    let interrupt: Value = serde_json::from_slice(frames[0].as_bytes()).unwrap();
    assert_eq!(interrupt["method"], "turn/interrupt");
    assert_eq!(interrupt["params"]["threadId"], "child-1");
    assert_eq!(interrupt["params"]["turnId"], "child-turn-1");

    let frames = translator
      .encode(&SessionCommand::InspectSubagent { thread_id: "child-1".into() })
      .unwrap();
    let read: Value = serde_json::from_slice(frames[0].as_bytes()).unwrap();
    assert_eq!(read["method"], "thread/read");
    assert_eq!(read["params"]["threadId"], "child-1");
    assert_eq!(read["params"]["includeTurns"], true);
  }
}
