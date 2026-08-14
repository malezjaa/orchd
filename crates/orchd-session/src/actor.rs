use std::{
  collections::HashMap,
  path::{Path, PathBuf},
  sync::{Arc, atomic::AtomicBool},
  time::{Duration, Instant},
};

use futures::StreamExt;
use orchd_core::{
  AgentAdapter, AgentCapabilities, AgentKind, ApprovalId, BlockId, CloseReason, Decision,
  ErrorScope, EventPayload, Frame, LaunchSpec, PermissionRequest, PolicyEngine,
  PolicyModes, SessionCommand, SessionEvent, SessionId, StopReason, Translator, TurnId,
  Verdict,
};
use orchd_proc::{ChildPipes, ManagedProcess};
use orchd_store::{ApprovalStatus, SessionStatus, Store};
use time::OffsetDateTime;
use tokio::{
  io::{AsyncBufReadExt, AsyncWriteExt, BufReader},
  process::{ChildStderr, ChildStdin},
  sync::{broadcast, mpsc},
  task::JoinHandle,
};

use crate::{
  config::{ActorConfig, IdleAction},
  echo::{chunk_words, extract_text},
  lifecycle::{SessionLifecycle, SessionTranscript},
  recovery::RecoveryState,
};

const COMPACTION_THRESHOLD: u64 = 300;
/// Events within this many seq numbers of the live edge are never compacted,
/// so an in-progress reconnect can't race a compaction pass against events it
/// hasn't replayed yet.
const COMPACTION_TAIL: u64 = 50;

struct PendingApproval {
  request: PermissionRequest,
  timeout: JoinHandle<()>,
}

enum TitleGenerationKind {
  Initial { message: String },
  Regeneration { previous_title: String, transcript: String },
}

/// The result of one spawn-through-exit cycle of the agent subprocess.
enum AttemptOutcome {
  /// Done for good; `finish`/`fail` has already been called.
  Stopped,
  /// The subprocess is gone but the actor keeps running; the caller decides
  /// whether to retry, based on `should_retry`.
  Crashed,
}

/// The single writer for one session: owns the agent and routes execution
/// through the lifecycle and transcript modules so durable state stays ahead
/// of live subscribers.
pub struct SessionActor {
  id: SessionId,
  agent_kind: AgentKind,
  model: Option<String>,
  cwd: String,
  store: Store,
  cmd_rx: mpsc::Receiver<SessionCommand>,
  /// A sender into this actor's own `cmd_rx`, so background tasks can route
  /// work back through the normal command path.
  self_tx: mpsc::Sender<SessionCommand>,
  transcript: SessionTranscript,
  lifecycle: SessionLifecycle,
  policy: PolicyEngine,
  pending_approvals: HashMap<ApprovalId, PendingApproval>,
  config: ActorConfig,
  /// The agent CLI's own session id, needed to `--resume` after a crash or a
  /// server restart.
  native_session_id: Option<String>,
  /// Tracked so an unchanged title doesn't re-persist/re-emit on every
  /// decoded frame.
  current_title: Option<String>,
  /// Bumped on every background generation call so a slow, superseded
  /// generation can't clobber a result that arrived first.
  title_generation_epoch: u64,
  recovery: RecoveryState,
  stopped: Arc<tokio::sync::Notify>,
  last_activity: Instant,
  /// The highest seq already folded by `maybe_compact`.
  compacted_up_to: u64,
}

impl SessionActor {
  #[allow(clippy::too_many_arguments)]
  pub async fn new(
    id: SessionId,
    agent_kind: AgentKind,
    model: Option<String>,
    cwd: String,
    store: Store,
    cmd_rx: mpsc::Receiver<SessionCommand>,
    self_tx: mpsc::Sender<SessionCommand>,
    events_tx: broadcast::Sender<SessionEvent>,
    busy: Arc<AtomicBool>,
    stopped: Arc<tokio::sync::Notify>,
    config: ActorConfig,
    native_session_id: Option<String>,
    initial_title: Option<String>,
  ) -> Result<Self, orchd_store::StoreError> {
    let next_seq = store.max_seq(id).await? + 1;
    let rules = match store.load_policy_rules(id).await? {
      Some(value) => serde_json::from_value(value).unwrap_or_default(),
      None => Vec::new(),
    };
    Ok(Self {
      id,
      agent_kind,
      model,
      cwd,
      store: store.clone(),
      cmd_rx,
      self_tx,
      transcript: SessionTranscript::new(id, store.clone(), events_tx.clone(), next_seq),
      lifecycle: SessionLifecycle::new(busy),
      policy: PolicyEngine::with_rules(PolicyModes::default(), rules),
      pending_approvals: HashMap::new(),
      config,
      native_session_id,
      current_title: initial_title,
      title_generation_epoch: 0,
      recovery: RecoveryState::default(),
      stopped,
      last_activity: Instant::now(),
      compacted_up_to: 0,
    })
  }

  pub async fn run(self) {
    if let Err(err) = self.store.set_session_status(self.id, SessionStatus::Running).await
    {
      tracing::error!(session = %self.id, error = %err, "failed to persist running status");
    }

    match orchd_adapters::adapter_for(self.agent_kind) {
      Some(adapter) => self.run_agent(adapter).await,
      None if self.agent_kind == AgentKind::Echo => self.run_echo().await,
      None => self.run_unsupported().await,
    }
  }
}

impl Drop for SessionActor {
  fn drop(&mut self) {
    self.stopped.notify_one();
  }
}

impl SessionActor {
  // ---- Echo (fake) adapter ---------------------------------------------

  async fn run_echo(mut self) {
    let init_turn = TurnId::new();
    self
      .emit(
        EventPayload::SessionInit {
          agent: self.agent_kind,
          native_session_id: None,
          model: None,
          capabilities: AgentCapabilities {
            thinking: false,
            structured_tools: false,
            resume: false,
            native_permissions: false,
            skills: false,
            subagents: false,
          },
        },
        init_turn,
      )
      .await;

    loop {
      let idle_sleep = tokio::time::sleep_until(self.idle_deadline());
      tokio::select! {
          cmd = self.cmd_rx.recv() => {
              match cmd {
                  Some(cmd) => {
                      self.last_activity = Instant::now();
                      if self.handle_echo_command(cmd).await {
                          break;
                      }
                  }
                  None => {
                      // All handles dropped without an explicit Close
                      // command, e.g. the registry itself was torn down.
                      self.finish(CloseReason::Error).await;
                      break;
                  }
              }
          }
          _ = idle_sleep => {
              if self.idle_action() {
                  self.finish(CloseReason::Idle).await;
                  break;
              }
          }
      }
    }
  }

  /// Returns `true` if the actor should stop after this command.
  async fn handle_echo_command(&mut self, cmd: SessionCommand) -> bool {
    match cmd {
      SessionCommand::UserMessage { client_msg_id, content } => {
        let Some(turn) = self.lifecycle.start_turn(client_msg_id) else {
          tracing::debug!(session=%self.id, %client_msg_id, "duplicate user message ignored");
          return false;
        };
        self
          .emit(
            EventPayload::UserMessage { client_msg_id, content: content.clone() },
            turn,
          )
          .await;
        self.emit_skill_invocations(&content, turn).await;
        self.echo_turn(&content, turn).await;
        false
      }
      SessionCommand::Interrupt => {
        if let Some((turn, payload)) = self.lifecycle.interrupt_turn() {
          self.emit(payload, turn).await;
        }
        false
      }
      // The echo adapter has no policy engine, no approvals, and nothing
      // that reads mode/model, so these are accepted and ignored.
      SessionCommand::ResolveApproval { .. }
      | SessionCommand::UpdatePolicy(_)
      | SessionCommand::SetMode { .. }
      | SessionCommand::SetModel { .. }
      | SessionCommand::SendSubagentInput { .. }
      | SessionCommand::InterruptSubagent { .. }
      | SessionCommand::InspectSubagent { .. } => false,
      SessionCommand::Close { reason } => {
        self.finish(reason).await;
        true
      }
      SessionCommand::RenameTitle { title } => {
        self.title_generation_epoch += 1;
        self.apply_title(title).await;
        false
      }
      // Title generation shells out to a real provider subprocess, which the
      // echo adapter never fires.
      SessionCommand::RegenerateTitle
      | SessionCommand::TitleGenerationCompleted { .. } => false,
    }
  }

  async fn echo_turn(&mut self, content: &[orchd_core::ContentPart], turn: TurnId) {
    let block = BlockId::new();
    let text = extract_text(content);

    for chunk in chunk_words(&text) {
      self.emit(EventPayload::TextDelta { block, text: chunk }, turn).await;
    }

    self
      .emit(EventPayload::TurnCompleted { turn, stop_reason: StopReason::EndTurn }, turn)
      .await;
    self.maybe_compact().await;
  }

  // ---- Real, subprocess-backed adapters --------------------------------

  async fn run_unsupported(mut self) {
    tracing::error!(session = %self.id, agent = ?self.agent_kind, "no adapter registered for this agent kind");
    let turn = self.lifecycle.current_turn();
    self
      .emit(
        EventPayload::Error {
          scope: ErrorScope::Adapter,
          code: "unsupported_agent".to_string(),
          message: format!("no adapter registered for {:?}", self.agent_kind),
          recoverable: false,
        },
        turn,
      )
      .await;
    self.finish(CloseReason::Error).await;
  }

  /// Drives the agent subprocess across however many spawn attempts it takes:
  /// each crash is retried with exponential backoff up to
  /// `ActorConfig::backoff.max_retries`, as long as the adapter can resume
  /// whatever native session was established. Exhausting retries, or a client
  /// closing the session, ends the loop for good.
  async fn run_agent(mut self, adapter: Box<dyn AgentAdapter>) {
    loop {
      let resume_native_session_id = self.native_session_id.clone();
      match self.run_agent_attempt(adapter.as_ref(), resume_native_session_id).await {
        AttemptOutcome::Stopped => break,
        AttemptOutcome::Crashed => {
          let Some(plan) = self.recovery.next_retry(
            self.config.backoff,
            self.native_session_id.is_some(),
            adapter.capabilities().resume,
          ) else {
            self.fail(CloseReason::AgentCrash).await;
            break;
          };
          tracing::warn!(session = %self.id, attempt = plan.attempt, delay = ?plan.delay, "retrying crashed agent after backoff");
          if !self.wait_for_backoff_or_close(plan.delay).await {
            break;
          }
        }
      }
    }
  }

  /// Waits out a backoff delay while still honoring `Close`, so a client
  /// closing a crash-looping session doesn't have to wait for the retry cap.
  /// Any other command arriving mid-backoff is dropped: there's no live agent
  /// to hand it to. Returns `false` if the actor was closed during the wait,
  /// in which case `finish` has already run.
  async fn wait_for_backoff_or_close(&mut self, delay: Duration) -> bool {
    let deadline = tokio::time::Instant::now() + delay;
    loop {
      tokio::select! {
          _ = tokio::time::sleep_until(deadline) => return true,
          cmd = self.cmd_rx.recv() => {
              match cmd {
                  Some(SessionCommand::Close { reason }) => {
                      self.finish(reason).await;
                      return false;
                  }
                  Some(SessionCommand::RenameTitle { title }) => {
                      self.title_generation_epoch += 1;
                      self.apply_title(title).await;
                  }
                  Some(_) => {
                      tracing::debug!(session = %self.id, "command dropped: agent is restarting after a crash");
                  }
                  None => {
                      self.finish(CloseReason::Error).await;
                      return false;
                  }
              }
          }
      }
    }
  }

  async fn run_agent_attempt(
    &mut self,
    adapter: &dyn AgentAdapter,
    resume_native_session_id: Option<String>,
  ) -> AttemptOutcome {
    let launch = LaunchSpec {
      cwd: PathBuf::from(&self.cwd),
      resume_native_session_id,
      model: self.model.clone(),
    };
    let spawn_spec = adapter.spawn_spec(&launch);
    let mut translator = adapter.translator(&launch);
    match self.store.list_subagents(self.id).await {
      Ok(records) => {
        for record in records {
          translator
            .restore_subagent(&record.thread_id, record.active_turn_id.as_deref());
        }
      }
      Err(err) => {
        tracing::debug!(session = %self.id, error = %err, "failed to restore subagent state");
      }
    }

    let (mut process, pipes) = match ManagedProcess::spawn(&spawn_spec) {
      Ok(pair) => pair,
      Err(err) => {
        tracing::error!(session = %self.id, error = %err, "failed to spawn agent process");
        let turn = self.lifecycle.current_turn();
        self
          .emit(
            EventPayload::Error {
              scope: ErrorScope::Process,
              code: "spawn_failed".to_string(),
              message: err.to_string(),
              recoverable: true,
            },
            turn,
          )
          .await;
        return AttemptOutcome::Crashed;
      }
    };

    if let Err(err) = self.store.set_pgid(self.id, process.pgid()).await {
      tracing::error!(session = %self.id, error = %err, "failed to persist subprocess pgid");
    }

    let ChildPipes { mut stdin, stdout, stderr } = pipes;
    let mut frames = orchd_proc::framed_stream(stdout, adapter.framing());
    forward_stderr(self.id, stderr);

    if let Err(err) = write_translator_frames(&mut stdin, translator.as_mut(), true).await
    {
      tracing::error!(session = %self.id, error = %err, "failed to start agent protocol");
    }

    let outcome = loop {
      let idle_sleep = tokio::time::sleep_until(self.idle_deadline());
      tokio::select! {
          frame = frames.next() => {
              match frame {
                  Some(Ok(frame)) => self.handle_agent_frame(translator.as_mut(), &mut stdin, frame).await,
                  Some(Err(err)) => {
                      tracing::warn!(session = %self.id, error = %err, "error reading agent stdout");
                  }
                  None => {
                      // stdout closed; the child-exit branch drives teardown.
                  }
              }
          }
          cmd = self.cmd_rx.recv() => {
              match cmd {
                  Some(cmd) => {
                      self.last_activity = Instant::now();
                      if self.handle_agent_command(translator.as_mut(), &mut stdin, &mut process, cmd).await {
                          break AttemptOutcome::Stopped;
                      }
                  }
                  None => {
                      let _ = process.kill().await;
                      self.finish(CloseReason::Error).await;
                      break AttemptOutcome::Stopped;
                  }
              }
          }
          status = process.wait() => {
              self.on_agent_exit(status).await;
              break AttemptOutcome::Crashed;
          }
          _ = idle_sleep => {
              if self.idle_action() {
                  let _ = process.kill().await;
                  self.finish(CloseReason::Idle).await;
                  break AttemptOutcome::Stopped;
              }
          }
      }
    };

    if let Err(err) = self.store.set_pgid(self.id, None).await {
      tracing::error!(session = %self.id, error = %err, "failed to clear subprocess pgid");
    }
    outcome
  }

  async fn handle_agent_frame(
    &mut self,
    translator: &mut dyn Translator,
    stdin: &mut ChildStdin,
    frame: Frame,
  ) {
    match translator.decode(frame) {
      Ok(payloads) => {
        for payload in payloads {
          self.handle_agent_payload(translator, stdin, payload).await;
        }
      }
      Err(err) => {
        tracing::warn!(session = %self.id, error = %err, "failed to decode agent frame");
      }
    }
    if let Err(err) = write_translator_frames(stdin, translator, false).await {
      tracing::error!(session = %self.id, error = %err, "failed to write agent protocol response");
    }
    self.sync_native_session_id(translator).await;
    self.sync_title(translator).await;
  }

  /// Persists the agent CLI's own session id as soon as a translator reports
  /// one, so a future crash or server restart can `--resume` it.
  async fn sync_native_session_id(&mut self, translator: &mut dyn Translator) {
    let Some(id) = translator.native_session_id() else {
      return;
    };
    if self.native_session_id.as_deref() == Some(id.as_str()) {
      return;
    }
    self.native_session_id = Some(id.clone());
    if let Err(err) = self.store.set_native_session_id(self.id, &id).await {
      tracing::error!(session = %self.id, error = %err, "failed to persist native session id");
    }
  }

  /// Persists the model an adapter reports at session start so it's queryable
  /// without replaying the event log.
  async fn sync_model(&mut self, payload: &EventPayload) {
    let EventPayload::SessionInit { model: Some(model), .. } = payload else { return };
    if let Err(err) = self.store.set_model(self.id, model).await {
      tracing::error!(session = %self.id, error = %err, "failed to persist session model");
    }
  }

  /// Persists the context-token total from the latest `UsageUpdate` so a
  /// "context used" indicator is queryable without replaying the event log.
  /// Adapters report per-call usage, so this is a snapshot to overwrite with,
  /// not a delta to add.
  async fn sync_context_usage(&mut self, payload: &EventPayload) {
    let EventPayload::UsageUpdate {
      input_tokens,
      cache_creation_input_tokens,
      cache_read_input_tokens,
      ..
    } = payload
    else {
      return;
    };
    let total = input_tokens + cache_creation_input_tokens + cache_read_input_tokens;
    if let Err(err) = self.store.set_context_usage(self.id, total).await {
      tracing::error!(session = %self.id, error = %err, "failed to persist context usage");
    }
  }

  /// Persists and broadcasts an adapter-reported title when it changes.
  /// No adapter reports one today: Claude Code's `ai-title` line only comes
  /// from its interactive TUI's resume picker, never from the headless `-p`
  /// mode `spawn_spec` uses, so `apply_first_message_title` is what actually
  /// names a session. Kept because a real agent-chosen title would beat our
  /// first-message guess.
  async fn sync_title(&mut self, translator: &mut dyn Translator) {
    let Some(title) = translator.title() else {
      return;
    };
    self.apply_title(title).await;
  }

  /// Names a session from its first user message: a zero-latency placeholder,
  /// superseded by a real LLM-generated title once the background subprocess
  /// finishes. Skipped when a title already exists, so a resumed session keeps
  /// the one it earned.
  async fn apply_first_message_title(&mut self, content: &[orchd_core::ContentPart]) {
    if self.current_title.is_some() {
      return;
    }
    let text = extract_text(content);
    let Some(placeholder) = orchd_core::sanitize_title(&text) else {
      return;
    };
    self.apply_title(placeholder).await;
    self.spawn_title_generation(TitleGenerationKind::Initial { message: text });
  }

  async fn spawn_title_regeneration(&mut self) {
    if self.agent_kind != AgentKind::ClaudeCode {
      return;
    }
    let previous_title = self.current_title.clone().unwrap_or_default();
    let transcript = self.title_regeneration_transcript().await;
    if transcript.trim().is_empty() {
      return;
    }
    self.spawn_title_generation(TitleGenerationKind::Regeneration {
      previous_title,
      transcript,
    });
  }

  async fn title_regeneration_transcript(&self) -> String {
    let events = match self.store.replay_events(self.id, 0).await {
      Ok(events) => events,
      Err(err) => {
        tracing::warn!(session = %self.id, error = %err, "failed to load transcript for title regeneration");
        return String::new();
      }
    };
    events
      .into_iter()
      .filter_map(|event| match event.payload {
        EventPayload::UserMessage { content, .. } => Some(extract_text(&content)),
        _ => None,
      })
      .collect::<Vec<_>>()
      .join("\n\n")
  }

  /// Fires a background, provider-specific title subprocess decoupled from
  /// this session's own agent process, routing its result back through the
  /// actor's command channel as `TitleGenerationCompleted`.
  ///
  /// `epoch` guards against a slow, superseded generation (two rapid
  /// "Regenerate title" clicks) clobbering a newer one: the result only
  /// applies if the epoch it carries still matches.
  fn spawn_title_generation(&mut self, kind: TitleGenerationKind) {
    let (program, agent_kind) = match self.agent_kind {
      AgentKind::ClaudeCode => {
        (orchd_adapters::claude_code::CLAUDE_BINARY, AgentKind::ClaudeCode)
      }
      AgentKind::Codex => (orchd_adapters::codex::CODEX_BINARY, AgentKind::Codex),
      _ => return,
    };
    self.title_generation_epoch += 1;
    let epoch = self.title_generation_epoch;
    let cwd = PathBuf::from(self.cwd.clone());
    let session_id = self.id;
    let self_tx = self.self_tx.clone();

    tokio::spawn(async move {
      let result = match kind {
        TitleGenerationKind::Initial { message } => match agent_kind {
          AgentKind::ClaudeCode => {
            orchd_adapters::claude_code::generate_initial_title(program, &cwd, &message)
              .await
              .map_err(|err| err.to_string())
          }
          AgentKind::Codex => {
            orchd_adapters::codex::generate_initial_title(program, &cwd, &message)
              .await
              .map_err(|err| err.to_string())
          }
          _ => unreachable!(),
        },
        TitleGenerationKind::Regeneration { previous_title, transcript } => {
          match agent_kind {
            AgentKind::ClaudeCode => orchd_adapters::claude_code::regenerate_title(
              program,
              &cwd,
              &previous_title,
              &transcript,
            )
            .await
            .map_err(|err| err.to_string()),
            AgentKind::Codex => orchd_adapters::codex::regenerate_title(
              program,
              &cwd,
              &previous_title,
              &transcript,
            )
            .await
            .map_err(|err| err.to_string()),
            _ => unreachable!(),
          }
        }
      };
      let title = match result {
        Ok(title) => Some(title),
        Err(err) => {
          tracing::error!(session = %session_id, error = %err, "title generation failed");
          None
        }
      };
      let _ =
        self_tx.send(SessionCommand::TitleGenerationCompleted { epoch, title }).await;
    });
  }

  async fn apply_title(&mut self, title: String) {
    if self.current_title.as_deref() == Some(title.as_str()) {
      return;
    }
    self.current_title = Some(title.clone());
    if let Err(err) = self.store.set_title(self.id, &title).await {
      tracing::error!(session = %self.id, error = %err, "failed to persist session title");
    }
    let turn = self.lifecycle.current_turn();
    self.emit(EventPayload::TitleUpdated { title }, turn).await;
  }

  async fn handle_agent_payload(
    &mut self,
    translator: &mut dyn Translator,
    stdin: &mut ChildStdin,
    payload: EventPayload,
  ) {
    self.sync_model(&payload).await;
    self.sync_context_usage(&payload).await;

    match payload {
      // The server, not the agent, is the real permission gate.
      EventPayload::PermissionRequested(req) => {
        self.intercept_permission(translator, stdin, req).await;
      }
      EventPayload::SubagentStarted {
        thread_id,
        nickname,
        role,
        prompt,
        model,
        effort,
        status,
        can_accept_direct_input,
        active_turn_id,
      } => {
        if let Err(err) = self
          .store
          .upsert_subagent(
            self.id,
            &thread_id,
            nickname.as_deref(),
            role.as_deref(),
            prompt.as_deref(),
            model.as_deref(),
            effort.as_deref(),
            status.clone(),
            can_accept_direct_input,
          )
          .await
        {
          tracing::error!(session = %self.id, thread = %thread_id, error = %err, "failed to persist subagent");
        }
        self
          .emit(
            EventPayload::SubagentStarted {
              thread_id,
              nickname,
              role,
              prompt,
              model,
              effort,
              status,
              can_accept_direct_input,
              active_turn_id,
            },
            self.lifecycle.current_turn(),
          )
          .await;
      }
      EventPayload::SubagentStatusChanged {
        thread_id,
        status,
        message,
        can_accept_direct_input,
        active_turn_id,
      } => {
        if let Err(err) = self
          .store
          .update_subagent_status(
            self.id,
            &thread_id,
            status.clone(),
            message.as_deref(),
            can_accept_direct_input,
            active_turn_id.as_deref(),
          )
          .await
        {
          tracing::debug!(session = %self.id, thread = %thread_id, error = %err, "failed to update subagent status");
        }
        self
          .emit(
            EventPayload::SubagentStatusChanged {
              thread_id,
              status,
              message,
              can_accept_direct_input,
              active_turn_id,
            },
            self.lifecycle.current_turn(),
          )
          .await;
      }
      EventPayload::SubagentResult { thread_id, summary } => {
        if let Err(err) =
          self.store.set_subagent_result(self.id, &thread_id, &summary).await
        {
          tracing::debug!(session = %self.id, thread = %thread_id, error = %err, "failed to persist subagent result");
        }
        self
          .emit(
            EventPayload::SubagentResult { thread_id, summary },
            self.lifecycle.current_turn(),
          )
          .await;
      }
      // A clean init means the agent came up, so any crash-recovery streak
      // that led here is over.
      EventPayload::SessionInit { .. } => {
        self.recovery.reset();
        let turn = self.lifecycle.current_turn();
        self.emit(payload, turn).await;
      }
      // The translator fills `TurnCompleted.turn` with a placeholder, since it
      // doesn't track turn grouping; overwrite it before sealing.
      EventPayload::TurnCompleted { stop_reason, .. } => {
        let (turn, completion) = self.lifecycle.complete_turn(stop_reason);
        self.emit(completion, turn).await;
        self.maybe_compact().await;
      }
      other => {
        let turn = self.lifecycle.current_turn();
        self.emit(other, turn).await;
      }
    }
  }

  /// Returns `true` if the actor should stop after this command.
  async fn handle_agent_command(
    &mut self,
    translator: &mut dyn Translator,
    stdin: &mut ChildStdin,
    process: &mut ManagedProcess,
    cmd: SessionCommand,
  ) -> bool {
    match &cmd {
      SessionCommand::UserMessage { client_msg_id, content } => {
        let Some(turn) = self.lifecycle.start_turn(*client_msg_id) else {
          tracing::debug!(session=%self.id, %client_msg_id, "duplicate user message ignored");
          return false;
        };
        self.apply_first_message_title(content).await;
        self
          .emit(
            EventPayload::UserMessage {
              client_msg_id: *client_msg_id,
              content: content.clone(),
            },
            turn,
          )
          .await;
        self.emit_skill_invocations(content, turn).await;
      }
      SessionCommand::ResolveApproval { request_id, decision } => {
        self.resolve_approval(translator, stdin, *request_id, decision.clone()).await;
        return false;
      }
      SessionCommand::SendSubagentInput { .. }
      | SessionCommand::InterruptSubagent { .. }
      | SessionCommand::InspectSubagent { .. } => {}
      SessionCommand::UpdatePolicy(patch) => {
        match self.policy.apply_patch(patch) {
          Ok(()) => self.persist_policy().await,
          Err(err) => {
            tracing::warn!(session = %self.id, error = %err, "rejected malformed policy patch");
          }
        }
        return false;
      }
      SessionCommand::Close { reason } => {
        let _ = process.kill().await;
        self.finish(reason.clone()).await;
        return true;
      }
      SessionCommand::RenameTitle { title } => {
        self.title_generation_epoch += 1;
        self.apply_title(title.clone()).await;
        return false;
      }
      SessionCommand::Interrupt
      | SessionCommand::SetMode { .. }
      | SessionCommand::SetModel { .. } => {}
      SessionCommand::RegenerateTitle => {
        self.spawn_title_regeneration().await;
        return false;
      }
      SessionCommand::TitleGenerationCompleted { epoch, title } => {
        if *epoch == self.title_generation_epoch {
          if let Some(title) = title.clone() {
            self.apply_title(title).await;
          }
        }
        return false;
      }
    }

    match translator.encode(&cmd) {
      Ok(frames) => {
        for frame in &frames {
          if let Err(err) = write_frame(stdin, frame).await {
            tracing::error!(session = %self.id, error = %err, "failed to write to agent stdin");
            break;
          }
        }
        if let Err(err) = write_translator_frames(stdin, translator, false).await {
          tracing::error!(session = %self.id, error = %err, "failed to write queued agent command");
        }
      }
      Err(err) => {
        tracing::warn!(session = %self.id, error = %err, "failed to encode command for agent");
      }
    }
    false
  }

  async fn emit_skill_invocations(
    &mut self,
    content: &[orchd_core::ContentPart],
    turn: TurnId,
  ) {
    for part in content {
      let orchd_core::ContentPart::Skill { name, path } = part else { continue };
      self
        .emit(
          EventPayload::SkillInvoked {
            skill: name.clone(),
            args: serde_json::json!({ "path": path }),
          },
          turn,
        )
        .await;
    }
  }

  // ---- Permissions --------------------------------------------------

  /// Runs a decoded `PermissionRequested` through the policy engine before
  /// it's ever surfaced. `AskHuman` parks a timeout that auto-denies if nobody
  /// replies before `expires_at`, so a disconnected human can't wedge a
  /// session forever.
  async fn intercept_permission(
    &mut self,
    translator: &mut dyn Translator,
    stdin: &mut ChildStdin,
    req: PermissionRequest,
  ) {
    match self.policy.evaluate(&req, Path::new(&self.cwd)) {
      Verdict::AutoAllow => {
        self.auto_resolve_permission(translator, stdin, req, Decision::Allow).await;
      }
      Verdict::AutoDeny(reason) => {
        self
          .auto_resolve_permission(
            translator,
            stdin,
            req,
            Decision::Deny { reason: Some(reason) },
          )
          .await;
      }
      Verdict::AskHuman => {
        if let Err(err) = self.store.put_approval(self.id, &req).await {
          tracing::error!(session = %self.id, error = %err, "failed to persist pending approval");
        }

        let turn = self.lifecycle.current_turn();
        self.emit(EventPayload::PermissionRequested(req.clone()), turn).await;

        let remaining = req.expires_at - OffsetDateTime::now_utc();
        let ttl = std::time::Duration::from_secs(remaining.whole_seconds().max(0) as u64);
        let request_id = req.request_id;
        let self_tx = self.self_tx.clone();
        let timeout = tokio::spawn(async move {
          tokio::time::sleep(ttl).await;
          let _ = self_tx
            .send(SessionCommand::ResolveApproval {
              request_id,
              decision: Decision::Deny { reason: Some("approval timed out".to_string()) },
            })
            .await;
        });

        self
          .pending_approvals
          .insert(request_id, PendingApproval { request: req, timeout });
      }
    }
  }

  /// Unknown or already-resolved `request_id`s (a stale client retry, or a
  /// timeout firing after a human answered) are ignored rather than treated
  /// as errors.
  async fn resolve_approval(
    &mut self,
    translator: &mut dyn Translator,
    stdin: &mut ChildStdin,
    request_id: ApprovalId,
    decision: Decision,
  ) {
    let Some(pending) = self.pending_approvals.remove(&request_id) else {
      tracing::debug!(session = %self.id, %request_id, "resolve for unknown or already-resolved approval ignored");
      return;
    };
    pending.timeout.abort();

    if let Decision::AllowAlways { scope } = &decision {
      self.policy.allow_always(scope.clone());
      self.persist_policy().await;
    }

    self.answer_permission(translator, stdin, &pending.request, decision).await;
  }

  /// A policy verdict resolved without a human: same wire effects as
  /// `resolve_approval`, minus the pending-approval entry to remove first.
  async fn auto_resolve_permission(
    &mut self,
    translator: &mut dyn Translator,
    stdin: &mut ChildStdin,
    req: PermissionRequest,
    decision: Decision,
  ) {
    if let Err(err) = self.store.put_approval(self.id, &req).await {
      tracing::error!(session = %self.id, error = %err, "failed to persist auto-resolved approval");
    }
    self.answer_permission(translator, stdin, &req, decision).await;
  }

  async fn answer_permission(
    &mut self,
    translator: &mut dyn Translator,
    stdin: &mut ChildStdin,
    req: &PermissionRequest,
    decision: Decision,
  ) {
    match translator.encode_decision(req, &decision) {
      Ok(frames) => {
        for frame in &frames {
          if let Err(err) = write_frame(stdin, frame).await {
            tracing::error!(session = %self.id, error = %err, "failed to write permission decision to agent stdin");
            break;
          }
        }
      }
      Err(err) => {
        tracing::warn!(session = %self.id, error = %err, "failed to encode permission decision");
      }
    }

    if let Err(err) =
      self.store.resolve_approval(req.request_id, approval_status_for(&decision)).await
    {
      tracing::error!(session = %self.id, error = %err, "failed to persist approval resolution");
    }

    let turn = self.lifecycle.current_turn();
    self
      .emit(
        EventPayload::PermissionResolved { request_id: req.request_id, decision },
        turn,
      )
      .await;
  }

  async fn persist_policy(&self) {
    if let Err(err) = self.store.save_policy_rules(self.id, &self.policy.to_json()).await
    {
      tracing::error!(session = %self.id, error = %err, "failed to persist policy rules");
    }
  }

  /// Reports a child exit as an error plus, if a turn was open, a synthetic
  /// `TurnCompleted { Interrupted }` so no client waits on a block that will
  /// never close. In stream-json mode the CLI stays alive across turns waiting
  /// on stdin, so any exit while the actor is still running is abnormal.
  /// Whether to retry is the caller's decision, not this function's.
  async fn on_agent_exit(
    &mut self,
    status: Result<std::process::ExitStatus, orchd_proc::ProcError>,
  ) {
    let turn = self.lifecycle.current_turn();
    match status {
      Ok(status) => {
        tracing::warn!(session = %self.id, %status, "agent process exited unexpectedly");
        self
          .emit(
            EventPayload::Error {
              scope: ErrorScope::Process,
              code: "agent_exited".to_string(),
              message: format!("agent process exited: {status}"),
              recoverable: true,
            },
            turn,
          )
          .await;
      }
      Err(err) => {
        tracing::error!(session = %self.id, error = %err, "failed to wait on agent process");
        self
          .emit(
            EventPayload::Error {
              scope: ErrorScope::Process,
              code: "wait_failed".to_string(),
              message: err.to_string(),
              recoverable: true,
            },
            turn,
          )
          .await;
      }
    }

    if let Some((turn, completion)) = self.lifecycle.interrupt_turn() {
      self.emit(completion, turn).await;
    }
  }

  // ---- Idle policy ----------------------------------------------------

  fn idle_deadline(&self) -> tokio::time::Instant {
    match self.config.idle.timeout {
      Some(timeout) => tokio::time::Instant::from(self.last_activity + timeout),
      // No timeout configured: park far enough out that this branch never
      // meaningfully races the others in `select!`.
      None => tokio::time::Instant::now() + Duration::from_secs(365 * 24 * 3600),
    }
  }

  /// Returns `true` if the idle policy says to close now. `Keep` bumps
  /// `last_activity` so the next loop iteration doesn't immediately re-fire
  /// the same deadline.
  fn idle_action(&mut self) -> bool {
    match self.config.idle.action {
      IdleAction::Close => {
        tracing::info!(session = %self.id, "closing idle session");
        true
      }
      IdleAction::Keep => {
        self.last_activity = Instant::now();
        false
      }
    }
  }

  // ---- Event-log compaction --------------------------------------------

  /// Folds older events into fewer equivalent ones once enough have
  /// accumulated. Called at turn boundaries only; compaction is housekeeping,
  /// not something that needs to run per-delta.
  async fn maybe_compact(&mut self) {
    if self.transcript.next_seq().saturating_sub(self.compacted_up_to)
      < COMPACTION_THRESHOLD + COMPACTION_TAIL
    {
      return;
    }
    let before_seq = self.transcript.next_seq() - COMPACTION_TAIL;
    match self.store.compact_events(self.id, before_seq).await {
      Ok(removed) => {
        if removed > 0 {
          tracing::debug!(session = %self.id, removed, before_seq, "compacted session event log");
        }
        self.compacted_up_to = before_seq;
      }
      Err(err) => {
        tracing::error!(session = %self.id, error = %err, "failed to compact event log");
      }
    }
  }

  // ---- Shared -----------------------------------------------------------

  async fn finish(&mut self, reason: CloseReason) {
    self.close_with_status(reason, SessionStatus::Closed).await;
  }

  /// Like `finish`, but marks the session `failed` when crash recovery gives
  /// up for good, so the store distinguishes "the user ended this" from "this
  /// could never come back up".
  async fn fail(&mut self, reason: CloseReason) {
    self.close_with_status(reason, SessionStatus::Failed).await;
  }

  async fn close_with_status(&mut self, reason: CloseReason, status: SessionStatus) {
    for (_, pending) in self.pending_approvals.drain() {
      pending.timeout.abort();
    }
    self.emit(EventPayload::SessionClosed { reason }, TurnId::new()).await;
    if let Err(err) = self.store.set_session_status(self.id, status).await {
      tracing::error!(session = %self.id, error = %err, "failed to persist closed status");
    }
  }

  /// Touch activity before passing the event to the transcript module. The
  /// transcript then enforces persist-before-publish.
  async fn emit(&mut self, payload: EventPayload, turn: TurnId) {
    self.last_activity = Instant::now();
    self.transcript.append(payload, turn).await;
  }
}

async fn write_frame(stdin: &mut ChildStdin, frame: &Frame) -> std::io::Result<()> {
  stdin.write_all(frame.as_bytes()).await?;
  stdin.write_all(b"\n").await?;
  stdin.flush().await
}

/// Sends frames created by protocol startup or by decoding a server response.
/// Keeping this in the actor preserves the single-writer invariant for agent
/// stdin while allowing a translator to react to asynchronous JSON-RPC data.
async fn write_translator_frames(
  stdin: &mut ChildStdin,
  translator: &mut dyn Translator,
  initial: bool,
) -> Result<(), std::io::Error> {
  let frames = if initial {
    translator
      .initial_frames()
      .map_err(|err| std::io::Error::new(std::io::ErrorKind::InvalidData, err))?
  } else {
    translator
      .drain_outgoing()
      .map_err(|err| std::io::Error::new(std::io::ErrorKind::InvalidData, err))?
  };
  for frame in &frames {
    write_frame(stdin, frame).await?;
  }
  Ok(())
}

fn approval_status_for(decision: &Decision) -> ApprovalStatus {
  match decision {
    Decision::Allow | Decision::AllowAlways { .. } | Decision::Modify { .. } => {
      ApprovalStatus::Allowed
    }
    Decision::Deny { reason } if reason.as_deref() == Some("approval timed out") => {
      ApprovalStatus::Expired
    }
    Decision::Deny { .. } => ApprovalStatus::Denied,
  }
}

/// Logs the agent subprocess's stderr at debug level so it's available for
/// troubleshooting without polluting the transcript.
fn forward_stderr(session_id: SessionId, stderr: ChildStderr) {
  tokio::spawn(async move {
    let mut lines = BufReader::new(stderr).lines();
    while let Ok(Some(line)) = lines.next_line().await {
      tracing::debug!(session = %session_id, "agent stderr: {line}");
    }
  });
}
