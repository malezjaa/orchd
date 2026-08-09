use std::str::FromStr;

use orchd_core::{
  AgentKind, ApprovalId, EventPayload, PermissionRequest, ProjectId, SessionEvent,
  SessionId, TurnId,
};
use rand::{RngCore, rngs::OsRng};
use sha2::{Digest, Sha256};
use sqlx::{
  Row, SqlitePool,
  sqlite::{SqliteConnectOptions, SqlitePoolOptions},
};
use time::OffsetDateTime;
use uuid::Uuid;

use crate::{
  error::StoreError,
  models::{
    ApprovalStatus, ClientSessionRecord, ProjectRecord, SessionRecord, SessionStatus,
    SettingsPatch, SettingsRecord, agent_kind_from_sql, agent_kind_to_sql,
  },
};

#[derive(Clone)]
pub struct Store {
  pool: SqlitePool,
}

impl Store {
  /// `url` is a sqlite connection string, e.g. `sqlite://orchd.db` or
  /// `sqlite::memory:`. WAL mode is enabled so readers (event replay)
  /// don't block the single writer (the session actors' appends).
  pub async fn connect(url: &str) -> Result<Self, StoreError> {
    let opts = SqliteConnectOptions::from_str(url)?
      .create_if_missing(true)
      .journal_mode(sqlx::sqlite::SqliteJournalMode::Wal)
      .foreign_keys(true);

    let pool = SqlitePoolOptions::new().max_connections(8).connect_with(opts).await?;

    sqlx::migrate!("./migrations").run(&pool).await?;

    Ok(Self { pool })
  }

  pub async fn create_session(
    &self,
    agent_kind: AgentKind,
    project_id: ProjectId,
    cwd: &str,
  ) -> Result<SessionRecord, StoreError> {
    let record = SessionRecord {
      id: SessionId::new(),
      agent_kind,
      project_id: Some(project_id),
      cwd: cwd.to_string(),
      status: SessionStatus::Creating,
      native_session_id: None,
      pgid: None,
      title: None,
      model: None,
      context_tokens_used: None,
      archived_at: None,
      created_at: OffsetDateTime::now_utc(),
      updated_at: OffsetDateTime::now_utc(),
    };

    sqlx::query(
      "INSERT INTO sessions (id, agent_kind, project_id, cwd, status, \
       native_session_id, pgid, title, model, context_tokens_used, created_at, \
       updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, NULL, NULL, NULL, NULL, NULL, ?6, ?7)",
    )
    .bind(record.id.to_string())
    .bind(agent_kind_to_sql(record.agent_kind))
    .bind(project_id.to_string())
    .bind(&record.cwd)
    .bind(record.status.as_str())
    .bind(record.created_at.unix_timestamp())
    .bind(record.updated_at.unix_timestamp())
    .execute(&self.pool)
    .await?;

    Ok(record)
  }

  /// Returns a session regardless of archived state: a direct lookup by id
  /// (opening it, resuming its actor, replaying its log) shouldn't care
  /// that it's hidden from the list view.
  pub async fn get_session(
    &self,
    id: SessionId,
  ) -> Result<Option<SessionRecord>, StoreError> {
    let row = sqlx::query(
      "SELECT id, agent_kind, project_id, cwd, status, native_session_id, pgid, title, \
       model, context_tokens_used, archived_at, created_at, updated_at
             FROM sessions WHERE id = ?1",
    )
    .bind(id.to_string())
    .fetch_optional(&self.pool)
    .await?;

    Ok(row.map(|r| row_to_session(&r)))
  }

  /// Archived sessions are excluded: this backs the sidebar's session
  /// list, not an audit trail. `get_session` still returns them.
  pub async fn list_sessions(&self) -> Result<Vec<SessionRecord>, StoreError> {
    let rows = sqlx::query(
      "SELECT id, agent_kind, project_id, cwd, status, native_session_id, pgid, title, \
       model, context_tokens_used, archived_at, created_at, updated_at
             FROM sessions WHERE archived_at IS NULL ORDER BY created_at DESC",
    )
    .fetch_all(&self.pool)
    .await?;

    Ok(rows.iter().map(row_to_session).collect())
  }

  /// The inverse of `list_sessions`: only archived sessions, most recently
  /// archived first, for the sidebar's History view.
  pub async fn list_archived_sessions(&self) -> Result<Vec<SessionRecord>, StoreError> {
    let rows = sqlx::query(
      "SELECT id, agent_kind, project_id, cwd, status, native_session_id, pgid, title, \
       model, context_tokens_used, archived_at, created_at, updated_at
             FROM sessions WHERE archived_at IS NOT NULL ORDER BY archived_at DESC",
    )
    .fetch_all(&self.pool)
    .await?;

    Ok(rows.iter().map(row_to_session).collect())
  }

  pub async fn list_sessions_by_project(
    &self,
    project_id: ProjectId,
  ) -> Result<Vec<SessionRecord>, StoreError> {
    let rows = sqlx::query(
      "SELECT id, agent_kind, project_id, cwd, status, native_session_id, pgid, title, \
       model, context_tokens_used, archived_at, created_at, updated_at
             FROM sessions WHERE project_id = ?1 AND archived_at IS NULL ORDER BY \
       created_at DESC",
    )
    .bind(project_id.to_string())
    .fetch_all(&self.pool)
    .await?;

    Ok(rows.iter().map(row_to_session).collect())
  }

  /// Errors if the session doesn't exist or is already archived, mirroring
  /// `archive_project`'s not-found handling.
  pub async fn archive_session(&self, id: SessionId) -> Result<(), StoreError> {
    let res = sqlx::query(
      "UPDATE sessions SET archived_at = ?1, updated_at = ?1 WHERE id = ?2 AND \
       archived_at IS NULL",
    )
    .bind(OffsetDateTime::now_utc().unix_timestamp())
    .bind(id.to_string())
    .execute(&self.pool)
    .await?;

    if res.rows_affected() == 0 {
      return Err(StoreError::SessionNotFound(id));
    }
    Ok(())
  }

  /// Errors if the session doesn't exist or isn't currently archived.
  /// Restores it to the regular (non-archived) session list without
  /// touching `status`: an unarchived `closed` session is still closed,
  /// just visible again.
  pub async fn unarchive_session(&self, id: SessionId) -> Result<(), StoreError> {
    let res = sqlx::query(
      "UPDATE sessions SET archived_at = NULL, updated_at = ?1 WHERE id = ?2 AND \
       archived_at IS NOT NULL",
    )
    .bind(OffsetDateTime::now_utc().unix_timestamp())
    .bind(id.to_string())
    .execute(&self.pool)
    .await?;

    if res.rows_affected() == 0 {
      return Err(StoreError::SessionNotFound(id));
    }
    Ok(())
  }

  pub async fn create_project(
    &self,
    name: &str,
    path: &str,
  ) -> Result<ProjectRecord, StoreError> {
    let record = ProjectRecord {
      id: ProjectId::new(),
      name: name.to_string(),
      path: path.to_string(),
      archived_at: None,
      created_at: OffsetDateTime::now_utc(),
      updated_at: OffsetDateTime::now_utc(),
    };

    sqlx::query(
      "INSERT INTO projects (id, name, path, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5)",
    )
    .bind(record.id.to_string())
    .bind(&record.name)
    .bind(&record.path)
    .bind(record.created_at.unix_timestamp())
    .bind(record.updated_at.unix_timestamp())
    .execute(&self.pool)
    .await?;

    Ok(record)
  }

  pub async fn get_project(
    &self,
    id: ProjectId,
  ) -> Result<Option<ProjectRecord>, StoreError> {
    let row = sqlx::query(
      "SELECT id, name, path, archived_at, created_at, updated_at FROM projects WHERE \
       id = ?1",
    )
    .bind(id.to_string())
    .fetch_optional(&self.pool)
    .await?;

    Ok(row.map(|r| row_to_project(&r)))
  }

  /// Archived projects are excluded: this backs the sidebar's project
  /// list, not an audit trail. `get_project` still returns them, since a
  /// session opened under an archived project must keep resolving it.
  pub async fn list_projects(&self) -> Result<Vec<ProjectRecord>, StoreError> {
    let rows = sqlx::query(
      "SELECT id, name, path, archived_at, created_at, updated_at FROM projects WHERE \
       archived_at IS NULL ORDER BY created_at DESC",
    )
    .fetch_all(&self.pool)
    .await?;

    Ok(rows.iter().map(row_to_project).collect())
  }

  /// Errors if the project doesn't exist or is already archived, mirroring
  /// `delete_project`'s not-found handling.
  pub async fn archive_project(&self, id: ProjectId) -> Result<(), StoreError> {
    let res = sqlx::query(
      "UPDATE projects SET archived_at = ?1, updated_at = ?1 WHERE id = ?2 AND \
       archived_at IS NULL",
    )
    .bind(OffsetDateTime::now_utc().unix_timestamp())
    .bind(id.to_string())
    .execute(&self.pool)
    .await?;

    if res.rows_affected() == 0 {
      return Err(StoreError::ProjectNotFound(id));
    }
    Ok(())
  }

  /// Fails with a foreign-key-constraint database error if any session
  /// still references this project. Sessions resolve their `cwd` from it,
  /// so deleting one out from under them would leave them pointing at
  /// nothing; that's a hard error rather than a silent orphaning.
  pub async fn delete_project(&self, id: ProjectId) -> Result<(), StoreError> {
    let res = sqlx::query("DELETE FROM projects WHERE id = ?1")
      .bind(id.to_string())
      .execute(&self.pool)
      .await?;

    if res.rows_affected() == 0 {
      return Err(StoreError::ProjectNotFound(id));
    }
    Ok(())
  }

  pub async fn set_session_status(
    &self,
    id: SessionId,
    status: SessionStatus,
  ) -> Result<(), StoreError> {
    let res =
      sqlx::query("UPDATE sessions SET status = ?1, updated_at = ?2 WHERE id = ?3")
        .bind(status.as_str())
        .bind(OffsetDateTime::now_utc().unix_timestamp())
        .bind(id.to_string())
        .execute(&self.pool)
        .await?;

    if res.rows_affected() == 0 {
      return Err(StoreError::SessionNotFound(id));
    }
    Ok(())
  }

  /// Records the agent CLI's own session id once a translator reports one,
  /// so a respawned actor (crash recovery, or resume after server
  /// restart) can pass it back as `--resume`.
  pub async fn set_native_session_id(
    &self,
    id: SessionId,
    native_session_id: &str,
  ) -> Result<(), StoreError> {
    sqlx::query(
      "UPDATE sessions SET native_session_id = ?1, updated_at = ?2 WHERE id = ?3",
    )
    .bind(native_session_id)
    .bind(OffsetDateTime::now_utc().unix_timestamp())
    .bind(id.to_string())
    .execute(&self.pool)
    .await?;
    Ok(())
  }

  /// Records an adapter-reported session title (see `Translator::title`),
  /// overwriting whatever was there before. The adapter is trusted to only
  /// report a title fresher than the one it last reported.
  pub async fn set_title(&self, id: SessionId, title: &str) -> Result<(), StoreError> {
    sqlx::query("UPDATE sessions SET title = ?1, updated_at = ?2 WHERE id = ?3")
      .bind(title)
      .bind(OffsetDateTime::now_utc().unix_timestamp())
      .bind(id.to_string())
      .execute(&self.pool)
      .await?;
    Ok(())
  }

  /// Records the model an adapter reports via `SessionInit.model`, so it's
  /// queryable (e.g. for a "current model" indicator) without replaying the
  /// event log.
  pub async fn set_model(&self, id: SessionId, model: &str) -> Result<(), StoreError> {
    sqlx::query("UPDATE sessions SET model = ?1, updated_at = ?2 WHERE id = ?3")
      .bind(model)
      .bind(OffsetDateTime::now_utc().unix_timestamp())
      .bind(id.to_string())
      .execute(&self.pool)
      .await?;
    Ok(())
  }

  /// Records the running context-token total from the latest `UsageUpdate`
  /// (input + cache-read + cache-creation), overwriting the previous value
  /// because each `UsageUpdate` carries the turn's full total, not a delta.
  pub async fn set_context_usage(
    &self,
    id: SessionId,
    tokens_used: u64,
  ) -> Result<(), StoreError> {
    sqlx::query(
      "UPDATE sessions SET context_tokens_used = ?1, updated_at = ?2 WHERE id = ?3",
    )
    .bind(tokens_used as i64)
    .bind(OffsetDateTime::now_utc().unix_timestamp())
    .bind(id.to_string())
    .execute(&self.pool)
    .await?;
    Ok(())
  }

  /// Records the process-group id of the currently spawned subprocess (or
  /// clears it to `NULL` once the process is gone), so a future boot's
  /// `reconcile_boot` knows what to reap if this daemon dies uncleanly.
  pub async fn set_pgid(
    &self,
    id: SessionId,
    pgid: Option<u32>,
  ) -> Result<(), StoreError> {
    sqlx::query("UPDATE sessions SET pgid = ?1, updated_at = ?2 WHERE id = ?3")
      .bind(pgid.map(|p| p as i64))
      .bind(OffsetDateTime::now_utc().unix_timestamp())
      .bind(id.to_string())
      .execute(&self.pool)
      .await?;
    Ok(())
  }

  /// Boot-time reconciliation: any session left `running`/`creating` from
  /// a previous process must have had its subprocess die with the old
  /// daemon (or never started), so no live actor exists for it anymore.
  /// Flips them to `interrupted` and returns the affected records (with
  /// their last-known `pgid`) so the caller can sweep any orphaned
  /// subprocess that somehow survived.
  pub async fn reconcile_boot(&self) -> Result<Vec<SessionRecord>, StoreError> {
    let rows = sqlx::query(
      "SELECT id, agent_kind, project_id, cwd, status, native_session_id, pgid, title, \
       model, context_tokens_used, archived_at, created_at, updated_at
             FROM sessions WHERE status IN ('running', 'creating')",
    )
    .fetch_all(&self.pool)
    .await?;
    let orphaned: Vec<SessionRecord> = rows.iter().map(row_to_session).collect();

    sqlx::query(
      "UPDATE sessions SET status = ?1, updated_at = ?2 WHERE status IN ('running', \
       'creating')",
    )
    .bind(SessionStatus::Interrupted.as_str())
    .bind(OffsetDateTime::now_utc().unix_timestamp())
    .execute(&self.pool)
    .await?;

    Ok(orphaned)
  }

  /// Persist one transcript event. Callers must call this *before*
  /// broadcasting it to live subscribers: the log is the source of
  /// truth, the broadcast is just a lossy live-tail convenience.
  pub async fn append_event(&self, event: &SessionEvent) -> Result<(), StoreError> {
    let payload = serde_json::to_string(&event.payload)?;

    sqlx::query(
      "INSERT INTO events (session_id, seq, ts, turn, payload)
             VALUES (?1, ?2, ?3, ?4, ?5)",
    )
    .bind(event.session_id.to_string())
    .bind(event.seq as i64)
    .bind(event.ts.unix_timestamp())
    .bind(event.turn.to_string())
    .bind(payload)
    .execute(&self.pool)
    .await?;

    Ok(())
  }

  /// Replay everything strictly after `after_seq`, in order. Used both
  /// for reconnect ("give me what I missed") and for cold resume after a
  /// server restart ("give me the whole transcript", i.e. `after_seq=0`).
  pub async fn replay_events(
    &self,
    session_id: SessionId,
    after_seq: u64,
  ) -> Result<Vec<SessionEvent>, StoreError> {
    let rows = sqlx::query(
      "SELECT session_id, seq, ts, turn, payload FROM events
             WHERE session_id = ?1 AND seq > ?2
             ORDER BY seq ASC",
    )
    .bind(session_id.to_string())
    .bind(after_seq as i64)
    .fetch_all(&self.pool)
    .await?;

    rows.iter().map(row_to_event).collect()
  }

  pub async fn max_seq(&self, session_id: SessionId) -> Result<u64, StoreError> {
    let row = sqlx::query(
      "SELECT COALESCE(MAX(seq), 0) as max_seq FROM events WHERE session_id = ?1",
    )
    .bind(session_id.to_string())
    .fetch_one(&self.pool)
    .await?;

    let max: i64 = row.try_get("max_seq")?;
    Ok(max as u64)
  }

  /// Records a permission request as pending. Idempotent on `request_id`
  /// so re-emitting the same request (e.g. after a decode retry) doesn't
  /// error.
  pub async fn put_approval(
    &self,
    session_id: SessionId,
    request: &PermissionRequest,
  ) -> Result<(), StoreError> {
    let request_json = serde_json::to_string(request)?;

    sqlx::query(
      "INSERT INTO approvals (id, session_id, request, status, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5)
             ON CONFLICT(id) DO UPDATE SET request = excluded.request",
    )
    .bind(request.request_id.to_string())
    .bind(session_id.to_string())
    .bind(request_json)
    .bind(ApprovalStatus::Pending.as_str())
    .bind(OffsetDateTime::now_utc().unix_timestamp())
    .execute(&self.pool)
    .await?;

    Ok(())
  }

  pub async fn resolve_approval(
    &self,
    request_id: ApprovalId,
    status: ApprovalStatus,
  ) -> Result<(), StoreError> {
    sqlx::query("UPDATE approvals SET status = ?1, decided_at = ?2 WHERE id = ?3")
      .bind(status.as_str())
      .bind(OffsetDateTime::now_utc().unix_timestamp())
      .bind(request_id.to_string())
      .execute(&self.pool)
      .await?;

    Ok(())
  }

  /// Upserts the full ordered rule list for a session, so a respawned
  /// actor can reload exactly what it had (see `load_policy_rules`).
  pub async fn save_policy_rules(
    &self,
    session_id: SessionId,
    rules: &serde_json::Value,
  ) -> Result<(), StoreError> {
    let rules_json = serde_json::to_string(rules)?;

    sqlx::query(
      "INSERT INTO policies (session_id, rules, updated_at)
             VALUES (?1, ?2, ?3)
             ON CONFLICT(session_id) DO UPDATE SET rules = excluded.rules, updated_at = \
       excluded.updated_at",
    )
    .bind(session_id.to_string())
    .bind(rules_json)
    .bind(OffsetDateTime::now_utc().unix_timestamp())
    .execute(&self.pool)
    .await?;

    Ok(())
  }

  pub async fn load_policy_rules(
    &self,
    session_id: SessionId,
  ) -> Result<Option<serde_json::Value>, StoreError> {
    let row = sqlx::query("SELECT rules FROM policies WHERE session_id = ?1")
      .bind(session_id.to_string())
      .fetch_optional(&self.pool)
      .await?;

    match row {
      Some(row) => {
        let rules: String = row.get("rules");
        Ok(Some(serde_json::from_str(&rules)?))
      }
      None => Ok(None),
    }
  }

  /// Folds the run of events strictly before `before_seq` into a smaller
  /// equivalent sequence, then replaces the raw rows with the folded
  /// ones: consecutive `TextDelta`/`ThinkingDelta` events for the same
  /// block are merged into one (streamed chunks are only ever useful
  /// individually while they're arriving live), and `ToolCallProgress`
  /// events are dropped once their call's `ToolCallCompleted` is also in
  /// range. Everything else passes through unchanged at its original
  /// `seq`, including any non-contiguous delta run, so interleaving
  /// between blocks is preserved.
  ///
  /// Events at `seq >= before_seq` (the caller's "hot tail") are left
  /// alone entirely, so a client mid-reconnect can never race a
  /// compaction pass. Returns the number of rows removed.
  pub async fn compact_events(
    &self,
    session_id: SessionId,
    before_seq: u64,
  ) -> Result<u64, StoreError> {
    let rows = sqlx::query(
      "SELECT session_id, seq, ts, turn, payload FROM events
             WHERE session_id = ?1 AND seq < ?2
             ORDER BY seq ASC",
    )
    .bind(session_id.to_string())
    .bind(before_seq as i64)
    .fetch_all(&self.pool)
    .await?;
    let raw: Vec<SessionEvent> =
      rows.iter().map(row_to_event).collect::<Result<_, _>>()?;
    if raw.is_empty() {
      return Ok(0);
    }
    let original_count = raw.len() as u64;

    let completed_calls: std::collections::HashSet<_> = raw
      .iter()
      .filter_map(|e| match &e.payload {
        EventPayload::ToolCallCompleted { call_id, .. } => Some(*call_id),
        _ => None,
      })
      .collect();

    let mut folded: Vec<SessionEvent> = Vec::with_capacity(raw.len());
    for event in raw {
      if let EventPayload::ToolCallProgress { call_id, .. } = &event.payload {
        if completed_calls.contains(call_id) {
          continue;
        }
      }

      let mergeable = match (folded.last(), &event.payload) {
        (
          Some(SessionEvent {
            payload: EventPayload::TextDelta { block: prev_block, .. },
            ..
          }),
          EventPayload::TextDelta { block, .. },
        ) => prev_block == block,
        (
          Some(SessionEvent {
            payload:
              EventPayload::ThinkingDelta {
                block: prev_block, redacted: prev_redacted, ..
              },
            ..
          }),
          EventPayload::ThinkingDelta { block, redacted, .. },
        ) => prev_block == block && prev_redacted == redacted,
        _ => false,
      };

      if mergeable {
        // The merged row takes on this raw event's seq/ts, so it
        // always carries the timestamp of its last chunk.
        let last = folded.last_mut().expect("just matched Some(...) above");
        match (&mut last.payload, &event.payload) {
          (
            EventPayload::TextDelta { text: prev_text, .. },
            EventPayload::TextDelta { text, .. },
          ) => prev_text.push_str(text),
          (
            EventPayload::ThinkingDelta { text: prev_text, .. },
            EventPayload::ThinkingDelta { text, .. },
          ) => prev_text.push_str(text),
          _ => unreachable!("mergeable implies matching delta variants"),
        }
        last.seq = event.seq;
        last.ts = event.ts;
      } else {
        folded.push(event);
      }
    }

    let folded_count = folded.len() as u64;
    if folded_count == original_count {
      return Ok(0);
    }

    let mut tx = self.pool.begin().await?;
    sqlx::query("DELETE FROM events WHERE session_id = ?1 AND seq < ?2")
      .bind(session_id.to_string())
      .bind(before_seq as i64)
      .execute(&mut *tx)
      .await?;

    for event in &folded {
      let payload = serde_json::to_string(&event.payload)?;
      sqlx::query(
        "INSERT INTO events (session_id, seq, ts, turn, payload)
                 VALUES (?1, ?2, ?3, ?4, ?5)",
      )
      .bind(event.session_id.to_string())
      .bind(event.seq as i64)
      .bind(event.ts.unix_timestamp())
      .bind(event.turn.to_string())
      .bind(payload)
      .execute(&mut *tx)
      .await?;
    }
    tx.commit().await?;

    Ok(original_count - folded_count)
  }

  /// Returns the single settings row, creating it with all-default (`NULL`)
  /// fields on first access rather than requiring a seed row from the
  /// migration itself.
  pub async fn get_settings(&self) -> Result<SettingsRecord, StoreError> {
    let row = sqlx::query(
      "SELECT interface_font, interface_font_size, mono_font, mono_font_size, \
       time_format, code_theme, updated_at FROM settings WHERE id = 1",
    )
    .fetch_optional(&self.pool)
    .await?;

    if let Some(row) = row {
      return Ok(row_to_settings(&row));
    }

    let now = OffsetDateTime::now_utc();
    sqlx::query(
      "INSERT INTO settings (id, interface_font, interface_font_size, mono_font, \
       mono_font_size, time_format, code_theme, updated_at)
             VALUES (1, NULL, NULL, NULL, NULL, NULL, NULL, ?1)
             ON CONFLICT(id) DO NOTHING",
    )
    .bind(now.unix_timestamp())
    .execute(&self.pool)
    .await?;

    Ok(SettingsRecord {
      interface_font: None,
      interface_font_size: None,
      mono_font: None,
      mono_font_size: None,
      time_format: None,
      code_theme: None,
      updated_at: now,
    })
  }

  /// Applies a partial patch: fields left `None` in `patch` keep their
  /// current stored value, mirroring `SessionCommand::UpdatePolicy`'s patch
  /// semantics rather than requiring the full settings object on every
  /// call.
  pub async fn update_settings(
    &self,
    patch: SettingsPatch,
  ) -> Result<SettingsRecord, StoreError> {
    let current = self.get_settings().await?;
    let next = SettingsRecord {
      interface_font: patch.interface_font.unwrap_or(current.interface_font),
      interface_font_size: patch
        .interface_font_size
        .unwrap_or(current.interface_font_size),
      mono_font: patch.mono_font.unwrap_or(current.mono_font),
      mono_font_size: patch.mono_font_size.unwrap_or(current.mono_font_size),
      time_format: patch.time_format.unwrap_or(current.time_format),
      code_theme: patch.code_theme.unwrap_or(current.code_theme),
      updated_at: OffsetDateTime::now_utc(),
    };

    sqlx::query(
      "INSERT INTO settings (id, interface_font, interface_font_size, mono_font, \
       mono_font_size, time_format, code_theme, updated_at)
             VALUES (1, ?1, ?2, ?3, ?4, ?5, ?6, ?7)
             ON CONFLICT(id) DO UPDATE SET interface_font = excluded.interface_font, \
       interface_font_size = excluded.interface_font_size, mono_font = \
       excluded.mono_font, mono_font_size = excluded.mono_font_size, time_format = \
       excluded.time_format, code_theme = excluded.code_theme, updated_at = \
       excluded.updated_at",
    )
    .bind(&next.interface_font)
    .bind(&next.interface_font_size)
    .bind(&next.mono_font)
    .bind(&next.mono_font_size)
    .bind(&next.time_format)
    .bind(&next.code_theme)
    .bind(next.updated_at.unix_timestamp())
    .execute(&self.pool)
    .await?;

    Ok(next)
  }

  // ---- Auth: pairing tokens, client sessions, WS tickets ---------------
  //
  // Only token *hashes* are ever persisted: a raw token is generated, its
  // hash is what goes in the database, and the raw value is returned to
  // the caller exactly once, at creation/exchange time.

  /// Mints a one-time pairing credential. Used both at daemon boot (pairs
  /// the first device) and on demand by an already-paired device (pairs
  /// additional ones); the caller decides which.
  pub async fn create_pairing_token(
    &self,
    ttl: std::time::Duration,
  ) -> Result<String, StoreError> {
    let token = generate_token("orchd_pair");
    let now = OffsetDateTime::now_utc();
    sqlx::query(
      "INSERT INTO pairing_tokens (token_hash, created_at, expires_at, used_at)
             VALUES (?1, ?2, ?3, NULL)",
    )
    .bind(hash_token(&token))
    .bind(now.unix_timestamp())
    .bind((now + to_time_duration(ttl)).unix_timestamp())
    .execute(&self.pool)
    .await?;
    Ok(token)
  }

  /// Consumes a pairing token (single-use) and creates a new client
  /// session for it. Returns `None` for an unknown, already-used, or
  /// expired token; callers must answer all three with the same generic
  /// "invalid or expired" response so a prober can't learn which applies.
  pub async fn exchange_pairing_token(
    &self,
    raw_token: &str,
    device_label: Option<&str>,
    session_ttl: std::time::Duration,
  ) -> Result<Option<(ClientSessionRecord, String)>, StoreError> {
    let hash = hash_token(raw_token);
    let now = OffsetDateTime::now_utc();

    let mut tx = self.pool.begin().await?;
    let row =
      sqlx::query("SELECT expires_at, used_at FROM pairing_tokens WHERE token_hash = ?1")
        .bind(&hash)
        .fetch_optional(&mut *tx)
        .await?;
    let Some(row) = row else { return Ok(None) };
    let expires_at: i64 = row.get("expires_at");
    let used_at: Option<i64> = row.get("used_at");
    if used_at.is_some() || expires_at < now.unix_timestamp() {
      return Ok(None);
    }

    sqlx::query("UPDATE pairing_tokens SET used_at = ?1 WHERE token_hash = ?2")
      .bind(now.unix_timestamp())
      .bind(&hash)
      .execute(&mut *tx)
      .await?;

    let session_token = generate_token("orchd_sess");
    let record = ClientSessionRecord {
      id: Uuid::now_v7().to_string(),
      device_label: device_label.map(str::to_string),
      created_at: now,
      last_seen_at: now,
      expires_at: now + to_time_duration(session_ttl),
      revoked_at: None,
    };
    sqlx::query(
      "INSERT INTO client_sessions (id, token_hash, device_label, created_at, \
       last_seen_at, expires_at, revoked_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, NULL)",
    )
    .bind(&record.id)
    .bind(hash_token(&session_token))
    .bind(&record.device_label)
    .bind(record.created_at.unix_timestamp())
    .bind(record.last_seen_at.unix_timestamp())
    .bind(record.expires_at.unix_timestamp())
    .execute(&mut *tx)
    .await?;

    tx.commit().await?;
    Ok(Some((record, session_token)))
  }

  /// Validates a session bearer/cookie token. Touches `last_seen_at` (at
  /// most once a minute, to avoid a write on every single request) when
  /// valid. Returns `None` for an unknown, expired, or revoked session,
  /// with the same "don't distinguish the reason" rationale as pairing
  /// exchange.
  pub async fn authenticate(
    &self,
    raw_token: &str,
  ) -> Result<Option<ClientSessionRecord>, StoreError> {
    let hash = hash_token(raw_token);
    let row = sqlx::query(
      "SELECT id, device_label, created_at, last_seen_at, expires_at, revoked_at
             FROM client_sessions WHERE token_hash = ?1",
    )
    .bind(&hash)
    .fetch_optional(&self.pool)
    .await?;
    let Some(row) = row else { return Ok(None) };
    let record = row_to_client_session(&row);

    let now = OffsetDateTime::now_utc();
    if !client_session_is_live(&record, now) {
      return Ok(None);
    }

    if now - record.last_seen_at > time::Duration::minutes(1) {
      sqlx::query("UPDATE client_sessions SET last_seen_at = ?1 WHERE id = ?2")
        .bind(now.unix_timestamp())
        .bind(&record.id)
        .execute(&self.pool)
        .await?;
    }

    Ok(Some(record))
  }

  pub async fn list_client_sessions(
    &self,
  ) -> Result<Vec<ClientSessionRecord>, StoreError> {
    let rows = sqlx::query(
      "SELECT id, device_label, created_at, last_seen_at, expires_at, revoked_at
             FROM client_sessions WHERE revoked_at IS NULL ORDER BY created_at DESC",
    )
    .fetch_all(&self.pool)
    .await?;
    Ok(rows.iter().map(row_to_client_session).collect())
  }

  pub async fn revoke_client_session(&self, id: &str) -> Result<(), StoreError> {
    let res = sqlx::query(
      "UPDATE client_sessions SET revoked_at = ?1 WHERE id = ?2 AND revoked_at IS NULL",
    )
    .bind(OffsetDateTime::now_utc().unix_timestamp())
    .bind(id)
    .execute(&self.pool)
    .await?;

    if res.rows_affected() == 0 {
      return Err(StoreError::ClientSessionNotFound(id.to_string()));
    }
    Ok(())
  }

  /// Mints a short-lived, single-use ticket for attaching one WebSocket
  /// connection, so the durable session token/cookie never has to sit in
  /// a socket URL.
  pub async fn create_ws_ticket(
    &self,
    session_id: &str,
    ttl: std::time::Duration,
  ) -> Result<String, StoreError> {
    let token = generate_token("orchd_wst");
    let now = OffsetDateTime::now_utc();
    sqlx::query(
      "INSERT INTO ws_tickets (token_hash, session_id, created_at, expires_at, used_at)
             VALUES (?1, ?2, ?3, ?4, NULL)",
    )
    .bind(hash_token(&token))
    .bind(session_id)
    .bind(now.unix_timestamp())
    .bind((now + to_time_duration(ttl)).unix_timestamp())
    .execute(&self.pool)
    .await?;
    Ok(token)
  }

  /// Consumes a WS ticket (single-use) and returns the client session it
  /// was issued for, or `None` if the ticket is unknown/expired/already
  /// used, or the underlying session has since expired or been revoked.
  pub async fn consume_ws_ticket(
    &self,
    raw_ticket: &str,
  ) -> Result<Option<ClientSessionRecord>, StoreError> {
    let hash = hash_token(raw_ticket);
    let now = OffsetDateTime::now_utc();

    let mut tx = self.pool.begin().await?;
    let row = sqlx::query(
      "SELECT session_id, expires_at, used_at FROM ws_tickets WHERE token_hash = ?1",
    )
    .bind(&hash)
    .fetch_optional(&mut *tx)
    .await?;
    let Some(row) = row else { return Ok(None) };
    let session_id: String = row.get("session_id");
    let expires_at: i64 = row.get("expires_at");
    let used_at: Option<i64> = row.get("used_at");
    if used_at.is_some() || expires_at < now.unix_timestamp() {
      return Ok(None);
    }
    sqlx::query("UPDATE ws_tickets SET used_at = ?1 WHERE token_hash = ?2")
      .bind(now.unix_timestamp())
      .bind(&hash)
      .execute(&mut *tx)
      .await?;
    tx.commit().await?;

    let row = sqlx::query(
      "SELECT id, device_label, created_at, last_seen_at, expires_at, revoked_at
             FROM client_sessions WHERE id = ?1",
    )
    .bind(&session_id)
    .fetch_optional(&self.pool)
    .await?;
    let Some(row) = row else { return Ok(None) };
    let record = row_to_client_session(&row);
    if !client_session_is_live(&record, now) {
      return Ok(None);
    }
    Ok(Some(record))
  }
}

fn row_to_session(row: &sqlx::sqlite::SqliteRow) -> SessionRecord {
  let id: String = row.get("id");
  let agent_kind: String = row.get("agent_kind");
  let project_id: Option<String> = row.get("project_id");
  let status: String = row.get("status");
  let pgid: Option<i64> = row.get("pgid");
  let archived_at: Option<i64> = row.get("archived_at");
  let created_at: i64 = row.get("created_at");
  let updated_at: i64 = row.get("updated_at");

  SessionRecord {
    id: SessionId::from_str(&id).expect("valid session id in store"),
    agent_kind: agent_kind_from_sql(&agent_kind),
    project_id: project_id
      .map(|p| ProjectId::from_str(&p).expect("valid project id in store")),
    cwd: row.get("cwd"),
    status: SessionStatus::parse(&status),
    native_session_id: row.get("native_session_id"),
    pgid,
    title: row.get("title"),
    model: row.get("model"),
    context_tokens_used: row.get("context_tokens_used"),
    archived_at: archived_at.map(|ts| {
      OffsetDateTime::from_unix_timestamp(ts).expect("valid archived_at timestamp")
    }),
    created_at: OffsetDateTime::from_unix_timestamp(created_at)
      .expect("valid created_at timestamp"),
    updated_at: OffsetDateTime::from_unix_timestamp(updated_at)
      .expect("valid updated_at timestamp"),
  }
}

fn row_to_project(row: &sqlx::sqlite::SqliteRow) -> ProjectRecord {
  let id: String = row.get("id");
  let archived_at: Option<i64> = row.get("archived_at");
  let created_at: i64 = row.get("created_at");
  let updated_at: i64 = row.get("updated_at");

  ProjectRecord {
    id: ProjectId::from_str(&id).expect("valid project id in store"),
    name: row.get("name"),
    path: row.get("path"),
    archived_at: archived_at.map(|ts| {
      OffsetDateTime::from_unix_timestamp(ts).expect("valid archived_at timestamp")
    }),
    created_at: OffsetDateTime::from_unix_timestamp(created_at)
      .expect("valid created_at timestamp"),
    updated_at: OffsetDateTime::from_unix_timestamp(updated_at)
      .expect("valid updated_at timestamp"),
  }
}

fn row_to_settings(row: &sqlx::sqlite::SqliteRow) -> SettingsRecord {
  let updated_at: i64 = row.get("updated_at");
  SettingsRecord {
    interface_font: row.get("interface_font"),
    interface_font_size: row.get("interface_font_size"),
    mono_font: row.get("mono_font"),
    mono_font_size: row.get("mono_font_size"),
    time_format: row.get("time_format"),
    code_theme: row.get("code_theme"),
    updated_at: OffsetDateTime::from_unix_timestamp(updated_at)
      .expect("valid updated_at timestamp"),
  }
}

fn row_to_client_session(row: &sqlx::sqlite::SqliteRow) -> ClientSessionRecord {
  let created_at: i64 = row.get("created_at");
  let last_seen_at: i64 = row.get("last_seen_at");
  let expires_at: i64 = row.get("expires_at");
  let revoked_at: Option<i64> = row.get("revoked_at");

  ClientSessionRecord {
    id: row.get("id"),
    device_label: row.get("device_label"),
    created_at: OffsetDateTime::from_unix_timestamp(created_at)
      .expect("valid created_at timestamp"),
    last_seen_at: OffsetDateTime::from_unix_timestamp(last_seen_at)
      .expect("valid last_seen_at timestamp"),
    expires_at: OffsetDateTime::from_unix_timestamp(expires_at)
      .expect("valid expires_at timestamp"),
    revoked_at: revoked_at.map(|t| {
      OffsetDateTime::from_unix_timestamp(t).expect("valid revoked_at timestamp")
    }),
  }
}

fn client_session_is_live(record: &ClientSessionRecord, now: OffsetDateTime) -> bool {
  record.revoked_at.is_none() && record.expires_at >= now
}

/// A cryptographically random 256-bit token, hex-encoded and prefixed so a
/// leaked value is recognizable at a glance (same idea as GitHub/Stripe
/// token prefixes) and so secret-scanning tools have something to match.
fn generate_token(prefix: &str) -> String {
  let mut bytes = [0u8; 32];
  OsRng.fill_bytes(&mut bytes);
  format!("{prefix}_{}", hex_encode(&bytes))
}

/// Tokens are high-entropy and never user-chosen, so a plain fast hash
/// (not a slow password-hashing KDF) is the right tool here. The risk this
/// defends against is "the database leaks", not "an attacker guesses the
/// token", which the token's own entropy already prevents.
fn hash_token(token: &str) -> String {
  hex_encode(&Sha256::digest(token.as_bytes()))
}

fn hex_encode(bytes: &[u8]) -> String {
  use std::fmt::Write;
  let mut out = String::with_capacity(bytes.len() * 2);
  for b in bytes {
    write!(out, "{b:02x}").expect("writing to a String never fails");
  }
  out
}

fn to_time_duration(d: std::time::Duration) -> time::Duration {
  time::Duration::seconds(d.as_secs() as i64)
}

#[cfg(test)]
mod tests {
  use super::*;

  #[tokio::test]
  async fn session_title_round_trips_through_migrations() {
    let store = Store::connect("sqlite::memory:").await.expect("connect");
    let project =
      store.create_project("test", "/tmp/orchd-title-test").await.expect("project");
    let session = store
      .create_session(AgentKind::ClaudeCode, project.id, &project.path)
      .await
      .expect("session");
    assert_eq!(session.title, None);

    store
      .set_title(session.id, "Explore canvas-ui registry components")
      .await
      .expect("set_title");

    let reloaded = store.get_session(session.id).await.expect("get").expect("found");
    assert_eq!(reloaded.title.as_deref(), Some("Explore canvas-ui registry components"));

    let listed = store.list_sessions().await.expect("list");
    assert_eq!(listed[0].title.as_deref(), Some("Explore canvas-ui registry components"));
  }

  #[tokio::test]
  async fn settings_default_then_patch_round_trips() {
    let store = Store::connect("sqlite::memory:").await.expect("connect");

    let defaults = store.get_settings().await.expect("get_settings");
    assert_eq!(defaults.interface_font, None);
    assert_eq!(defaults.mono_font_size, None);
    assert_eq!(defaults.code_theme, None);

    let updated = store
      .update_settings(SettingsPatch {
        interface_font: Some(Some("geist".to_string())),
        mono_font_size: None,
        code_theme: Some(Some("gruvbox".to_string())),
        ..Default::default()
      })
      .await
      .expect("update_settings");
    assert_eq!(updated.interface_font.as_deref(), Some("geist"));
    assert_eq!(updated.mono_font_size, None);
    assert_eq!(updated.code_theme.as_deref(), Some("gruvbox"));

    // A field left `None` in the patch keeps its previously stored value.
    let reloaded = store.get_settings().await.expect("get_settings");
    assert_eq!(reloaded.interface_font.as_deref(), Some("geist"));

    // `Some(None)` explicitly clears a field back to unset.
    let cleared = store
      .update_settings(SettingsPatch { interface_font: Some(None), ..Default::default() })
      .await
      .expect("update_settings");
    assert_eq!(cleared.interface_font, None);
    assert_eq!(cleared.code_theme.as_deref(), Some("gruvbox"));
  }
}

fn row_to_event(row: &sqlx::sqlite::SqliteRow) -> Result<SessionEvent, StoreError> {
  let session_id: String = row.get("session_id");
  let seq: i64 = row.get("seq");
  let ts: i64 = row.get("ts");
  let turn: String = row.get("turn");
  let payload: String = row.get("payload");

  Ok(SessionEvent {
    session_id: SessionId::from_str(&session_id).expect("valid session id in store"),
    seq: seq as u64,
    ts: OffsetDateTime::from_unix_timestamp(ts).expect("valid event ts"),
    turn: TurnId::from_str(&turn).expect("valid turn id in store"),
    payload: serde_json::from_str::<EventPayload>(&payload)?,
  })
}
