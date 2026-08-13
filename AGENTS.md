# Agent Orchestrator — Architecture & Implementation Plan

I'll call the project **`orchd`** (the daemon) throughout. Below is a complete design covering all nine areas. The code is illustrative Rust — shaped to compile with minor filling-in, not copy-paste-ready — meant to pin down the actual types and traits you'd build.

The core architectural bet: **treat every agent as a stateful subprocess behind a per-session actor, and make a durable, sequenced event log the single source of truth.** Everything else (reconnection, crash recovery, fan-out, persistence) falls out of that one decision cleanly.

---

## 0. Workspace layout

A Cargo workspace keeps the pluggable pieces honest — adapters can't reach into server internals if they only depend on `orchd-core`.

```
orchd/
├── crates/
│   ├── orchd-core/        # canonical schema, traits, errors — no I/O, no tokio-heavy deps
│   ├── orchd-proc/        # process manager: spawn, sandbox, monitor, reap
│   ├── orchd-session/     # session actor, event log, broadcast, policy engine
│   ├── orchd-store/       # persistence (SQLite via sqlx) behind a repository trait
│   ├── orchd-api/         # axum: REST + WebSocket gateway, auth
│   ├── orchd-adapters/    # one module per agent: claude_code, codex, aider, cursor
│   └── orchd-server/      # binary: wires everything, config, tracing
└── Cargo.toml
```

`orchd-core` is the contract crate: canonical events, the `AgentAdapter` trait, error types. New adapters depend only on it.

---

## 1. High-level architecture

```
                         ┌──────────────────────────────────────────────┐
   web / desktop UI ─────┤              API Gateway (axum)               │
     (WS + REST)         │  auth · rate-limit · WS framing · REST cmds   │
                         └───────┬───────────────────────────────┬──────┘
                                 │ commands (mpsc)                │ events (broadcast + replay)
                                 ▼                                │
                    ┌────────────────────────┐                    │
                    │   Session Registry     │  DashMap<SessionId, SessionHandle>
                    │  (admission control,   │                    │
                    │   per-tenant quotas)   │                    │
                    └──────────┬─────────────┘                    │
                               │ one actor per session            │
        ┌──────────────────────┼──────────────────────────────┐  │
        ▼                      ▼                                ▼  │
 ┌─────────────┐       ┌─────────────┐                 ┌─────────────┐
 │Session Actor│  ...  │Session Actor│                 │Session Actor│
 │ ─ owns child│       │             │                 │             │
 │ ─ seq++ log │       │             │                 │             │
 │ ─ policy    │       │             │                 │             │
 └──┬───────▲──┘       └─────────────┘                 └─────────────┘
    │       │ CanonicalEvent
 cmds│       │
    ▼       │
 ┌────────────────────────┐        ┌───────────────────────────────┐
 │  Protocol Adapter      │        │        Event Bus              │
 │  (Translator + Codec)  │        │  broadcast::Sender per session │
 │  agent-native ⇄ canon  │        │  + append to durable log       │
 └──────────┬─────────────┘        └───────────────┬───────────────┘
            │ framed stdio                          │
            ▼                                       ▼
 ┌────────────────────────┐            ┌───────────────────────────┐
 │   Process Manager       │           │    Session Store (SQLite)  │
 │  spawn · sandbox · pgid  │          │  sessions · events · appr. │
 │  rlimits · pdeathsig     │          │  append-only event log      │
 │  reaper / orphan cleanup │          └───────────────────────────┘
 └──────────┬──────────────┘
            ▼
   ┌────────────────┐  ┌────────────────┐  ┌────────────────┐
   │ claude (stdio  │  │ codex (JSON-RPC │  │ aider (text /  │
   │ stream-json)   │  │ app-server)     │  │ line parsing)  │
   └────────────────┘  └────────────────┘  └────────────────┘
```

**Component responsibilities**

| Component | Owns | Does not own |
|---|---|---|
| **API Gateway** | WS/REST framing, auth, mapping wire messages ↔ commands/events | agent protocol details, process lifecycle |
| **Session Registry** | session lookup, admission control, quotas, lifecycle transitions | translation, child I/O |
| **Session Actor** | the single writer for one session: child handle, seq counter, pending-approval table, policy eval | cross-session concerns |
| **Protocol Adapter** | agent-native ⇄ canonical translation, framing, resume semantics | spawning, sandboxing |
| **Process Manager** | spawn/monitor/kill, sandbox, rlimits, process groups, reaping | protocol semantics |
| **Event Bus** | fan-out (broadcast) + durable append | translation |
| **Session Store** | persistence, replay queries | live process state |

The **actor-per-session** model is load-bearing: each session has exactly one task that owns the child's stdin and the seq counter, so there are no data races on ordering or on writing to the process. Commands arrive via a bounded `mpsc`; events leave via a `broadcast` after being persisted.

---

## 2. Canonical event & command schema

This is the contract every adapter normalizes into. Internally-tagged enums serialize to clean JSON for the wire.

```rust
// orchd-core/src/event.rs

/// A durable, ordered event in a session's transcript.
#[derive(Clone, Serialize, Deserialize)]
pub struct SessionEvent {
    pub session_id: SessionId,
    pub seq: u64,                 // monotonic per session; the replay cursor
    pub ts: OffsetDateTime,
    pub turn: TurnId,             // groups events belonging to one user turn
    #[serde(flatten)]
    pub payload: EventPayload,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum EventPayload {
    /// Emitted once when the agent process is ready; carries native ids/capabilities.
    SessionInit {
        agent: AgentKind,
        native_session_id: Option<String>,
        model: Option<String>,
        capabilities: AgentCapabilities,
    },

    /// Assistant visible text, streamed incrementally.
    TextDelta { block: BlockId, text: String },

    /// Reasoning / thinking stream (Claude thinking, Codex reasoning summaries).
    ThinkingDelta { block: BlockId, text: String, redacted: bool },

    /// The agent wants to invoke a tool. `needs_approval` is decided by policy,
    /// not by the agent — see the permission flow.
    ToolCallRequested {
        call_id: ToolCallId,
        tool: ToolRef,            // canonical tool identity (see §7)
        input: serde_json::Value, // normalized args
        needs_approval: bool,
    },

    ToolCallProgress { call_id: ToolCallId, chunk: serde_json::Value },

    ToolCallCompleted {
        call_id: ToolCallId,
        output: ToolOutput,       // Text | Json | File diffs | error
        is_error: bool,
    },

    /// A named skill / slash-command / subagent invocation.
    SkillInvoked { skill: String, args: serde_json::Value },

    /// A permission decision is required from a human/policy before proceeding.
    PermissionRequested(PermissionRequest),
    PermissionResolved { request_id: ApprovalId, decision: Decision },

    UsageUpdate { input_tokens: u64, output_tokens: u64, cost_usd: Option<f64> },

    /// Non-fatal or fatal error, normalized.
    Error { scope: ErrorScope, code: String, message: String, recoverable: bool },

    /// End of a single turn (agent yielded control back to the user).
    TurnCompleted { turn: TurnId, stop_reason: StopReason },

    /// Terminal state for the whole session.
    SessionClosed { reason: CloseReason },
}
```

Commands flow the other direction (client → actor → agent):

```rust
// orchd-core/src/command.rs
#[derive(Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum SessionCommand {
    /// Idempotency key set by the client; dedup at the actor boundary.
    UserMessage { client_msg_id: Uuid, content: Vec<ContentPart> },
    ResolveApproval { request_id: ApprovalId, decision: Decision },
    Interrupt,                    // cancel current turn (SIGINT-equivalent)
    UpdatePolicy(PolicyPatch),    // change allow-list / auto-approve mid-session
    Close { reason: CloseReason },
}

#[derive(Clone, Serialize, Deserialize)]
pub enum Decision {
    Allow,
    AllowAlways { scope: PermissionScope },   // adds an allow-list rule
    Deny { reason: Option<String> },
    Modify { updated_input: serde_json::Value }, // edit the tool args before allowing
}
```

The permission object is agent-agnostic:

```rust
#[derive(Clone, Serialize, Deserialize)]
pub struct PermissionRequest {
    pub request_id: ApprovalId,
    pub call_id: Option<ToolCallId>,
    pub kind: PermissionKind,     // FileWrite | ShellExec | NetworkAccess | ToolUse | Custom
    pub summary: String,          // human-readable ("write 4 files under src/")
    pub detail: serde_json::Value,// structured (paths, command, host, diff)
    pub suggested: Option<Decision>,
    pub expires_at: OffsetDateTime,
}
```

Why internally-tagged enums: they give you exhaustive `match` in Rust (adding an event variant forces every consumer to handle it) *and* a stable, discriminated-union JSON shape the TypeScript client can model with a matching tagged union.

---

## 3. The adapter pattern

The key separation: **process spawning is shared; protocol translation is per-agent.** An adapter is a *codec + translator*, not a process babysitter. This means every agent gets the same sandboxing, reaping, and rlimits for free.

```rust
// orchd-core/src/adapter.rs
#[async_trait]
pub trait AgentAdapter: Send + Sync + 'static {
    fn kind(&self) -> AgentKind;
    fn capabilities(&self) -> AgentCapabilities;

    /// Tell the process manager how to launch this agent.
    fn spawn_spec(&self, launch: &LaunchSpec) -> SpawnSpec;

    /// How raw stdout bytes are chunked into protocol frames.
    fn framing(&self) -> Framing;   // LineDelimitedJson | ContentLengthJsonRpc | Sse | Raw

    /// Construct a fresh, stateful translator for one running session.
    fn translator(&self, launch: &LaunchSpec) -> Box<dyn Translator>;
}

/// Stateful: JSON-RPC codecs track request ids; stream codecs track open blocks.
#[async_trait]
pub trait Translator: Send {
    /// Agent → canonical. One inbound frame may yield 0..n canonical events.
    fn decode(&mut self, frame: Frame) -> Result<Vec<EventPayload>, AdapterError>;

    /// Canonical command → agent-native frames written to stdin.
    fn encode(&mut self, cmd: &SessionCommand) -> Result<Vec<Frame>, AdapterError>;

    /// Map a resolved permission decision into whatever the agent expects
    /// (e.g. Claude's permission-prompt-tool response, Codex's approval reply).
    fn encode_decision(&mut self, req: &PermissionRequest, d: &Decision)
        -> Result<Vec<Frame>, AdapterError>;

    /// Extract the native session id once known (for --resume).
    fn native_session_id(&self) -> Option<String>;
}
```

```rust
pub struct SpawnSpec {
    pub program: String,
    pub args: Vec<String>,
    pub env: Vec<(String, SecretString)>,  // secrecy-wrapped
    pub cwd: PathBuf,
    pub stdio: StdioConfig,                 // piped stdin/stdout/stderr
    pub sandbox: SandboxProfile,
}
```

**Concrete adapter differences the abstraction absorbs:**

- **Claude Code** — `claude -p --input-format stream-json --output-format stream-json --include-partial-messages --verbose`, resume via `--session-id`/`--resume`. Framing = `LineDelimitedJson`. Native events: `system`(init) → `SessionInit`; `stream_event` text deltas → `TextDelta`; `content_block` `tool_use` → `ToolCallRequested`; `tool_result` → `ToolCallCompleted`; `result` → `TurnCompleted`/`UsageUpdate`. Permission = a `--permission-prompt-tool` MCP tool the CLI *calls* when it needs approval; `encode_decision` replies `{behavior: "allow"|"deny", updatedInput}`.
- **Codex** — `codex proto` / app-server (JSON-RPC over stdio). Framing = `ContentLengthJsonRpc`. The translator must match request ids to correlate tool/approval responses; approvals arrive as server→client requests you answer.
- **Aider** — no clean JSON stream; run `--message` one-shot or drive the REPL, framing = `Raw`/line, translator does best-effort text/diff parsing. Capabilities advertise `structured_tools: false` so the UI degrades gracefully.
- **Cursor agent** — `cursor-agent --output-format stream-json`, similar to Claude Code.

Because differences are confined to `Translator`, adding an agent is: implement one trait + declare a `SpawnSpec`. Advertise per-agent gaps through `AgentCapabilities { thinking, structured_tools, resume, native_permissions, skills }` so the gateway and UI adapt rather than assume.

> Exact CLI flags/protocols drift between versions — pin them in each adapter module and verify against the installed CLI; the trait boundary is what's stable.

---

## 4. Crate choices

| Concern | Crate | Why |
|---|---|---|
| Async runtime | **tokio** (multi-thread) | Process I/O, `mpsc`/`broadcast`/`oneshot`/`watch`, timers, task supervision — everything here is tokio-native. |
| HTTP + WebSocket | **axum** (+ `tower`, `tower-http`) | REST and WS in one router; tower middleware for auth/CORS/rate-limit/tracing; `axum::extract::ws` for the socket. |
| WS (if standalone) | tokio-tungstenite | What axum's WS wraps; use directly only for an outbound client. |
| Process mgmt | **tokio::process** + **command-group** + **nix** | `command-group` puts each child in its own process group (kill the whole tree); `nix` for `PR_SET_PDEATHSIG`, `setrlimit`, signals. |
| Serialization | **serde** + **serde_json** | Tagged enums ↔ discriminated-union JSON; `simd-json` later if parsing is hot. |
| Framing | **tokio-util** (`Framed`, `LinesCodec`) | Line-delimited and custom `Content-Length` codecs for JSON-RPC. |
| Persistence | **sqlx** (SQLite, WAL) | Async, compile-time-checked queries, migrations; relational listing/filtering of sessions; single-file, zero-ops; swappable to Postgres behind a repo trait. |
| IDs | **uuid** (v7) | Time-sortable ids double as natural ordering keys. |
| Errors | **thiserror** (libs) + **anyhow** (binary) | Typed errors across crate boundaries; ergonomic top-level. |
| Observability | **tracing** + **tracing-subscriber** + **metrics** | Structured spans per session/turn; Prometheus export. |
| Secrets | **secrecy** + **zeroize** | `SecretString` keeps API keys out of `Debug`/logs and zeroes on drop. |
| Sandboxing (Linux) | **landlock**, **seccompiler**, **cgroups-rs** | FS restriction, syscall filtering, memory/CPU/pids caps. |
| Config | **figment** | Layer file + env + CLI. |
| Auth | **jsonwebtoken** | Per-tenant JWT verification in a tower layer. |

Deliberate rejections: **sled/redb** (want SQL for session listing and append-log replay queries); **actix-web** (axum's tower ecosystem composes better here); jumping straight to **Postgres+Redis** (premature — the repo/event-bus traits let you defer horizontal scale until you actually need multi-node).

---

## 5. Streaming — internal & external

### Internal: the session actor loop

```rust
async fn run_session(mut actor: SessionActor) {
    let mut child = actor.spawn().await?;                 // sandboxed subprocess
    let mut frames = actor.framed_stdout(&mut child);     // FramedRead over stdout
    let events_tx = actor.event_bus.clone();              // broadcast::Sender

    loop {
        tokio::select! {
            // 1. Agent produced output
            Some(frame) = frames.next() => {
                for payload in actor.translator.decode(frame?)? {
                    // policy interception happens here (see §7)
                    let payload = actor.intercept(payload).await?;
                    let ev = actor.seal(payload);          // assign seq + ts + turn
                    actor.store.append(&ev).await?;        // DURABLE first
                    let _ = events_tx.send(ev);            // then fan out (lossy ok)
                }
            }
            // 2. A client/policy sent a command
            Some(cmd) = actor.cmd_rx.recv() => {
                if !actor.dedup(&cmd) { continue; }
                for frame in actor.translator.encode(&cmd)? {
                    actor.write_stdin(&mut child, frame).await?;   // bounded/awaited
                }
            }
            // 3. Child exited
            status = child.wait() => {
                actor.on_exit(status?).await;             // crash recovery / close
                break;
            }
            // 4. Idle / turn timeout
            _ = actor.deadline.tick() => actor.on_timeout().await,
        }
    }
}
```

**Ordering & durability invariant: persist before publish.** The seq is assigned by the single actor, the event is written to the append-only log, *then* broadcast. If the broadcast drops (slow subscriber) it doesn't matter — the log is truth and the client re-reads from it.

**Backpressure:**
- Client → actor: **bounded `mpsc`** (e.g. depth 64). A flooding client blocks its own sends, never the actor.
- stdout → actor: reading is naturally paced by how fast we persist+broadcast. If persistence is the bottleneck, the OS pipe buffer fills and the child blocks on write — correct backpressure onto the *agent*, no unbounded memory growth.
- Actor → clients: **`broadcast`** channel (bounded ring). Fan-out is intentionally lossy: a slow client gets `RecvError::Lagged(n)`, which we treat as "you fell behind — reconnect and replay from your last seq." Slow consumers can never stall the producer. This is the whole reason the durable log exists.

### External: WebSocket framing

One WS carries a session (or multiplexes several via `session_id` in the envelope). Text frames, JSON envelopes:

```jsonc
// server → client
{ "v": 1, "session_id": "…", "seq": 412, "kind": "event",
  "payload": { "type": "text_delta", "block": "b1", "text": "Hello" } }

// client → server
{ "v": 1, "session_id": "…", "kind": "command", "client_msg_id": "…",
  "payload": { "type": "user_message", "content": [ … ] } }

// resumption handshake after reconnect
{ "v": 1, "kind": "resume", "session_id": "…", "last_seq": 411 }
```

- **Resumption:** every server event carries `seq`. On reconnect the client sends `resume { last_seq }`; the gateway replays `events WHERE seq > last_seq` from SQLite, then attaches the live broadcast — no gap, no dupes. This is Last-Event-ID semantics generalized.
- **Heartbeat:** WS ping/pong every ~20s; missed pongs → close and let the client reconnect (session keeps running server-side).
- **Backpressure to client:** the per-connection writer pulls from broadcast; if the socket can't drain, `Lagged` → send a `{kind:"resync", from_seq}` telling the client to REST-replay.

**Hybrid option:** SSE (`text/event-stream`) for the server→client event stream (trivially resumable via `Last-Event-ID`) + REST `POST /sessions/{id}/commands` for the low-frequency client→server direction. Simpler to operate and cache-friendly; the trade-off is two connections and slightly higher command latency. I'd default to WebSocket for the interactive feel and offer SSE+REST as a fallback transport over the same envelope schema.

---

## 6. Persistence strategy

**Embedded SQLite (WAL mode) via sqlx is the source of truth.** The live layer (actor registry, broadcast channels) is pure in-memory runtime state, rebuilt on demand.

```sql
CREATE TABLE projects (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, path TEXT NOT NULL UNIQUE,
  created_at INTEGER, updated_at INTEGER
);
CREATE TABLE sessions (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, project_id TEXT NOT NULL REFERENCES projects(id),
  agent_kind TEXT NOT NULL,
  cwd TEXT NOT NULL, native_session_id TEXT,
  status TEXT NOT NULL,                    -- creating|running|interrupted|failed|closed
  config JSON NOT NULL, created_at INTEGER, updated_at INTEGER
);
CREATE TABLE events (                      -- append-only transcript = replay + audit
  session_id TEXT NOT NULL, seq INTEGER NOT NULL, ts INTEGER NOT NULL,
  turn TEXT NOT NULL, payload JSON NOT NULL,
  PRIMARY KEY (session_id, seq)
);
CREATE TABLE approvals (
  id TEXT PRIMARY KEY, session_id TEXT NOT NULL, kind TEXT NOT NULL,
  request JSON NOT NULL, status TEXT NOT NULL,   -- pending|allowed|denied|expired
  decided_by TEXT, decided_at INTEGER
);
CREATE TABLE policies ( tenant_id TEXT, session_id TEXT, rules JSON, PRIMARY KEY(tenant_id, session_id) );
```

**Projects.** A session never floats freely against an arbitrary `cwd` — it's opened *under* a project: a named folder on disk, registered once (`POST /projects {name, path}`) and reused across many sessions. `sessions.project_id` is a required FK; a session's `cwd` is resolved server-side from its project's `path` at creation time rather than accepted as freeform client input, so a session can never point somewhere its project doesn't. This mirrors how every real agent CLI (and every IDE) already scopes work to a project root, and it's what turns "list my sessions for this repo" into a real indexed query (`GET /projects/{id}/sessions`) instead of a `cwd` string-match. `path` is validated and canonicalized at creation time (must exist, must be a directory) — the one point client-supplied input crosses into the system, per the validation posture in §5/§7. Deleting a project (`DELETE /projects/{id}`) is rejected by the FK while sessions still reference it, rather than silently orphaning them. REST surface: `POST /projects`, `GET /projects`, `GET /projects/{id}`, `DELETE /projects/{id}`, `GET /projects/{id}/sessions`; `POST /sessions` takes a `project_id` in place of a raw `cwd`.

**Resumability across server restarts:**
1. On boot, any session `status = 'running'` is reconciled to `interrupted` (its process is gone).
2. Client requests resume → gateway replays the `events` log to reconstruct the exact prior view (the log *is* the transcript).
3. If the agent supports native resume (Claude `--resume native_session_id`, Codex resume), the process manager respawns and the actor continues appending at `max(seq)+1`. If not, the session is read-only history.

**Why SQLite, not X:**
- vs **in-memory only:** you lose the transcript and all resumability on restart — unacceptable for long agent runs.
- vs **sled/redb (KV):** you'd hand-roll session listing/filtering and range replay; SQL gives you both plus ACID for free.
- vs **Postgres from day one:** ops overhead with no payoff until multi-node. The `SessionStore` repository trait + `EventBus` trait keep the seam clean — swap to Postgres + Redis pub/sub (for cross-node fan-out) when you outgrow one box, without touching adapters or the actor.

Snapshotting: for very long sessions, periodically fold the event log into a compacted checkpoint row so replay reads a snapshot + tail rather than 50k rows.

---

## 7. Tool & skill abstraction + permission flow

**Canonical tool identity** decouples the UI from each agent's naming:

```rust
pub struct ToolRef {
    pub canonical: CanonicalTool,   // FileRead|FileWrite|FileEdit|ShellExec|Search|WebFetch|Mcp|Custom
    pub native_name: String,        // "Bash", "apply_patch", "run_terminal_cmd"
    pub agent: AgentKind,
}
```

Adapters map native tool names to `CanonicalTool` where they can and pass through `Custom { name }` otherwise. Skills/slash-commands/subagents normalize to `SkillInvoked` so a UI can render them uniformly.

**Permission flow — the server owns the policy, not the agent.** When a translator decodes a native tool call (or a native permission prompt), the actor runs it through a policy engine *before* forwarding:

```rust
async fn intercept(&mut self, p: EventPayload) -> Result<EventPayload> {
    if let EventPayload::ToolCallRequested { call_id, tool, input, .. } = &p {
        match self.policy.evaluate(tool, input) {
            Verdict::AutoAllow => { /* pass through, needs_approval=false */ }
            Verdict::AutoDeny(reason) => {
                self.respond_denied(call_id, reason).await?;   // never reaches agent execution
                return Ok(/* ToolCallCompleted is_error=true */);
            }
            Verdict::AskHuman => {
                let req = PermissionRequest::from(tool, input, /*expires*/ 5.minutes());
                let (tx, rx) = oneshot::channel();
                self.pending.insert(req.request_id, tx);        // park the decision
                self.store.put_approval(&req).await?;
                self.emit(EventPayload::PermissionRequested(req.clone()));
                // agent is blocked (its permission-prompt tool call is awaiting our reply)
                let decision = timeout(req.ttl(), rx).await.unwrap_or(Decision::Deny{..});
                for f in self.translator.encode_decision(&req, &decision)? {
                    self.write_stdin(f).await?;                 // unblock agent
                }
            }
        }
    }
    Ok(p)
}
```

- The **pending-approval table** maps `ApprovalId → oneshot::Sender<Decision>`. A `ResolveApproval` command (from any authorized client) fires the oneshot.
- **Policy engine**: ordered allow/deny rules matched on `(canonical tool, path glob, command pattern, host)`, plus modes (`auto_approve_reads`, `deny_network`, `writes_confined_to_cwd`). `AllowAlways` appends a scoped rule to `policies` mid-session.
- **Agent mapping** lives entirely in `encode_decision`: Claude gets a permission-prompt-tool reply `{behavior, updatedInput}`; Codex gets its approval-response RPC; Aider (no protocol) is gated by *not sending* the command until approved. The client sees one uniform `PermissionRequest`.
- **Timeout → auto-deny** so a disconnected human can't wedge a session forever.

This means the server enforces permissions *even for agents whose own permission model you don't fully trust* — you can run the underlying CLI in its most permissive mode and let `orchd` be the real gate.

---

## 8. Security model

Defense in depth, strongest isolation you can afford per deployment:

**Subprocess sandboxing (Linux, escalating):**
1. Baseline: dedicated `cwd` per session, **Landlock** to confine filesystem access to the workspace (+ read-only toolchain paths), **seccomp** (seccompiler) to drop dangerous syscalls, `no_new_privs`.
2. Network: run in a **network namespace** with egress only through an allow-listed proxy; deny by default.
3. Resource caps: `setrlimit` (`RLIMIT_CPU`, `RLIMIT_AS`, `RLIMIT_NOFILE`, `RLIMIT_NPROC`) + **cgroups v2** (`memory.max`, `cpu.max`, `pids.max`) per session, nested under a per-tenant parent cgroup.
4. Strong tenancy: run each agent in a **rootless container (podman)** or **Firecracker microVM** when tenants are mutually untrusting. The `SandboxProfile` in `SpawnSpec` selects the tier.

**Process hygiene:** each child in its own process group (`command-group`) → one `killpg` tears down the whole tree; `PR_SET_PDEATHSIG(SIGKILL)` so children die if `orchd` dies; a reaper task + startup reconciliation (persisted pgids) sweep orphans.

**Secrets:** API keys wrapped in `secrecy::SecretString` (never in `Debug`/logs, zeroed on drop); injected via **env or 0600 files, never argv** (argv is world-readable in `/proc`); scoped per-tenant/session; a `tracing` redaction layer scrubs known-sensitive fields. Support pluggable secret sources (env, file, Vault/KMS).

**Permission scoping:** deny-by-default policy engine (§7), independent of and stricter than the agent's own — writes confined to `cwd`, shell/network gated.

**API surface:** single-owner pairing auth (see below) in a tower middleware layer, not per-tenant JWT — `orchd` is self-hosted for one operator, not a multi-tenant service; CORS locked to known origins; audit log (the event log + `approvals.decided_by`) records every human decision.

**Authentication & pairing.** `orchd` has exactly one owner — whoever can read the daemon's log/journal, since that's where the pairing token is printed — but that owner may have several devices (laptop, phone, a second desktop) that should each hold their own revocable credential rather than sharing one password. The model is adapted from how Theo Browne's T3 Code (`pingdotgg/t3code`, a structurally similar local-daemon-plus-remote-clients agent orchestrator) solves the same self-hosted/remote-pairing problem:

```sql
CREATE TABLE pairing_tokens (
  token_hash TEXT PRIMARY KEY, created_at INTEGER, expires_at INTEGER, used_at INTEGER
);
CREATE TABLE client_sessions (
  id TEXT PRIMARY KEY, token_hash TEXT UNIQUE, device_label TEXT,
  created_at INTEGER, last_seen_at INTEGER, expires_at INTEGER, revoked_at INTEGER
);
CREATE TABLE ws_tickets (
  token_hash TEXT PRIMARY KEY, session_id TEXT REFERENCES client_sessions(id),
  created_at INTEGER, expires_at INTEGER, used_at INTEGER
);
```

Only token *hashes* (SHA-256) are ever persisted; a raw token is returned to the caller exactly once, at creation/exchange time, and never logged or stored again.

- **Pairing token** — one-time, short-TTL (15 minutes default). Minted automatically at every daemon boot and logged at `warn` level (loud enough to survive a default log-level filter) — that boot log line *is* the trust boundary: whoever can read it (shell/journal access to the host) can pair the first device. Additional devices are paired without restarting via `POST /auth/pairing-tokens`, which itself requires an existing valid session — mirroring T3 Code's `t3 pair`.
- **Client session** — created by `POST /auth/pairing` exchanging a pairing token. Long-lived (30 days default), individually labeled and revocable (`GET`/`DELETE /auth/sessions`), so one leaked or retired device doesn't require rotating everyone else's access — this is also why sessions are an opaque, store-backed token rather than a stateless JWT: revocation has to actually work. Presented as either an `Authorization: Bearer` header (CLI/API clients) or an `HttpOnly`/`SameSite=Lax` cookie (browser clients); the `require_session` middleware accepts either.
- **WS ticket** — a session can't attach to `/sessions/{id}/ws` directly: browsers can't set custom headers on a WebSocket upgrade request, so the durable bearer token/cookie would otherwise have to sit in the socket URL (server logs, browser history). Instead `POST /auth/websocket-ticket` (itself session-gated) mints a 60-second, single-use ticket that goes in the URL in its place; the long-lived credential never does.

`POST /auth/pairing` is deliberately the one unauthenticated route in the API — it has to be, it's the bootstrap *into* auth — so it sits behind its own IP-keyed rate limit (`tower_governor`, `SmartIpKeyExtractor`: reads `X-Forwarded-For`/`X-Real-Ip`/`Forwarded` before falling back to the peer address) instead of `require_session`. That's what makes it safe to expose through either supported remote-access posture:

- **Private mesh (Tailscale, WireGuard):** network membership is the first gate — a device can't reach the port at all unless it's already on the tailnet — and pairing is a second layer on top of that.
- **Public tunnel (Cloudflare Tunnel, or any other HTTPS-reachable endpoint):** there is no network-layer gate, so `orchd`'s own pairing/session auth *is* the entire boundary. This is exactly why the rate limit on `/auth/pairing` isn't optional the way it could be for a Tailscale-only deployment: high-entropy tokens plus a tight request budget is what makes exposing the daemon publicly (optionally paired with Cloudflare Access at the edge, for a second layer) a reasonable choice instead of a reckless one.

Either way the pairing/session flow itself is transport-agnostic — the same posture T3 Code's own remote-access docs describe: Tailscale is one interchangeable "endpoint provider" among LAN, custom HTTPS, and tunnels, all driving the same underlying pairing flow.

---

## 9. Error handling & reconnection semantics

**Client disconnects mid-stream** → the session is *detached, not stopped*. The actor keeps running, events keep appending to the log and broadcasting (to zero subscribers, harmlessly). On reconnect the client replays from `last_seq` and re-attaches live (§5). An **idle policy** decides what to do if no client returns within N minutes: keep running, pause at the next turn boundary, or checkpoint-and-close — configurable per tenant, because a background refactor should keep going but an interactive chat probably shouldn't burn tokens unattended.

**Agent process dies/crashes** → `child.wait()` returns; the actor emits `Error { recoverable }` and runs crash recovery:
- If the agent supports resume and the crash looks transient (non-zero exit, OOM-kill, SIGSEGV): respawn with `--resume native_session_id`, replay nothing to the client (the log already has everything), continue at `seq+1`. **Exponential backoff, capped retries.**
- Mid-turn crash: emit `TurnCompleted { stop_reason: Interrupted }` so the client isn't left hanging on an open text block, then attempt resume.
- Unrecoverable (repeated crashes, non-resumable agent): mark `status = failed`, emit `SessionClosed { reason: AgentCrash }`, preserve the full transcript.

**Server crash/restart** → §6 reconciliation: `running → interrupted`, resume on demand. `PDEATHSIG` means most children already died with the server; the startup reaper kills any survivors by persisted pgid.

**Supervision & blast radius:** each session actor is a supervised task; a panic is caught at the task boundary (`JoinHandle` error → mark session failed) so **one bad session can never take down the server or its neighbors**. Commands are idempotent via `client_msg_id` dedup so a client retry after a flaky connection doesn't double-send a message.

**Concurrency & multi-tenancy** (threading through all of the above): sessions are independent tokio tasks in a `DashMap<SessionId, SessionHandle>` registry; an **admission controller** enforces per-tenant quotas (max concurrent sessions via a `Semaphore`, aggregate cgroup memory/CPU) and returns `429` when exceeded; per-turn and per-session wall-clock timeouts via tokio timers layered on top of the cgroup/rlimit hard caps.

---

## 10. Phased build roadmap

**Phase 0 — Skeleton (contracts first).** `orchd-core` schema (events, commands, adapter trait); axum server with health + a hardcoded echo "adapter"; SQLite store with the events table + append/replay; the session-actor loop with in-memory broadcast. *Exit: a WS client can create a fake session and get sequenced events replayed after reconnect.* This proves the streaming/reconnection spine before any real agent.

**Phase 1 — MVP, one real adapter (Claude Code).** Process manager (spawn, pipes, process-group kill, wait); `claude_code` adapter (stream-json framing + translator + resume); basic REST (`create/list/get/close`) + WS (`send`, stream). *Exit: a UI drives a real Claude Code session end-to-end, survives a client reconnect.*

**Phase 2 — Permissions & tools.** Policy engine + pending-approval table + `PermissionRequested`/`ResolveApproval`; canonical `ToolRef` mapping; allow/deny lists (no auto-approve policies yet). *Exit: file writes/shell commands surface as generic approvals the client accepts/denies/modifies.*

**Phase 3 — Second adapter (Codex) → prove the abstraction.** Content-Length JSON-RPC framing + id-correlated translator + approval mapping; `AgentCapabilities`-driven degradation in the gateway. *This is the real test that the trait boundary holds.* Add a third (Cursor/Aider) if the seams held.

**Phase 4 — Persistence & recovery hardening.** Full resume-after-restart; crash recovery with backoff; orphan reaping; idle policies; event-log compaction/snapshots.

**Phase 5 — Single-owner auth & remote pairing.** Boot-time and on-demand pairing tokens exchanged for revocable, per-device client sessions; bearer/cookie `require_session` middleware; WS tickets so long-lived credentials never sit in a socket URL; rate-limited pairing exchange safe behind either a private mesh (Tailscale) or a public tunnel (Cloudflare Tunnel). *(Multi-tenancy was dropped from this phase — `orchd` is self-hosted for one owner, not a multi-tenant service. Subprocess sandboxing (Landlock/seccomp/cgroups), pluggable secrets sources, and an audit log remain future hardening, tracked separately since they don't depend on the auth model.)*

**Phase 6 — Advanced policies & scale.** Auto-approve policy DSL, `AllowAlways` scopes; metrics/tracing dashboards; optional Postgres + Redis pub/sub behind the existing repo/event-bus traits for multi-node; SSE+REST hybrid transport.

Each phase is independently demoable, and the ordering front-loads the two riskiest bets — the **streaming/reconnection spine (Phase 0)** and the **adapter abstraction under a second, structurally different agent (Phase 3)** — so you learn whether the core design holds before building policy, sandboxing, and scale on top of it.
