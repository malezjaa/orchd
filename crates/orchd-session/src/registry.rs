use dashmap::{DashMap, mapref::entry::Entry};
use orchd_core::{AgentKind, ProjectId, SessionId};
use orchd_store::{ProjectRecord, SessionRecord, SessionStatus, Store};

use crate::{
  actor::SessionActor, config::ActorConfig, error::RegistryError, handle::SessionHandle,
};

/// In-memory registry of live session actors. This is pure runtime state,
/// rebuilt on demand from the store, which is the only source of truth:
/// `get_or_resume` lazily respawns an actor for any session that exists in the
/// store but has none, so a client resuming an old session doesn't need to
/// know whether it's live or just history.
pub struct SessionRegistry {
  store: Store,
  sessions: DashMap<SessionId, SessionHandle>,
  config: ActorConfig,
}

impl SessionRegistry {
  pub fn new(store: Store, config: ActorConfig) -> Self {
    Self { store, sessions: DashMap::new(), config }
  }

  pub fn store(&self) -> &Store {
    &self.store
  }

  /// `cwd` is resolved from the project's own `path` rather than accepted
  /// from the client, so a session can never point somewhere its project
  /// doesn't.
  pub async fn create_session(
    &self,
    agent_kind: AgentKind,
    project_id: ProjectId,
  ) -> Result<SessionRecord, RegistryError> {
    let project = self
      .store
      .get_project(project_id)
      .await?
      .ok_or(RegistryError::ProjectNotFound(project_id))?;

    let record = self.store.create_session(agent_kind, project_id, &project.path).await?;
    let handle = self.spawn_actor(&record, None).await?;
    self.sessions.insert(record.id, handle);
    Ok(record)
  }

  pub async fn create_project(
    &self,
    name: &str,
    path: &str,
  ) -> Result<ProjectRecord, RegistryError> {
    Ok(self.store.create_project(name, path).await?)
  }

  pub async fn list_projects(&self) -> Result<Vec<ProjectRecord>, RegistryError> {
    Ok(self.store.list_projects().await?)
  }

  pub async fn get_project(&self, id: ProjectId) -> Result<ProjectRecord, RegistryError> {
    self.store.get_project(id).await?.ok_or(RegistryError::ProjectNotFound(id))
  }

  pub async fn delete_project(&self, id: ProjectId) -> Result<(), RegistryError> {
    match self.store.delete_project(id).await {
      Ok(()) => Ok(()),
      Err(orchd_store::StoreError::ProjectNotFound(id)) => {
        Err(RegistryError::ProjectNotFound(id))
      }
      Err(err) => Err(err.into()),
    }
  }

  pub async fn list_sessions_by_project(
    &self,
    project_id: ProjectId,
  ) -> Result<Vec<SessionRecord>, RegistryError> {
    Ok(self.store.list_sessions_by_project(project_id).await?)
  }

  pub fn get(&self, id: SessionId) -> Option<SessionHandle> {
    self.sessions.get(&id).map(|entry| entry.value().clone())
  }

  /// Like `get`, but spins up a fresh actor when none is live and the
  /// session's last known status means it could still be running
  /// (`creating` covers a daemon that died before startup finished).
  /// `closed`/`failed` sessions are read-only history and are deliberately
  /// left alone rather than reanimated.
  pub async fn get_or_resume(
    &self,
    id: SessionId,
  ) -> Result<SessionHandle, RegistryError> {
    if let Some(handle) = self.get(id) {
      return Ok(handle);
    }

    let record = self.store.get_session(id).await?.ok_or(RegistryError::NotFound(id))?;

    match record.status {
      SessionStatus::Closed | SessionStatus::Failed => Err(RegistryError::NotFound(id)),
      SessionStatus::Creating | SessionStatus::Running | SessionStatus::Interrupted => {
        let handle = self.spawn_actor(&record, record.native_session_id.clone()).await?;
        // A concurrent caller may have resumed the same session while we
        // were spawning; keep whichever actor registered first rather than
        // clobbering it. The loser's task keeps running harmlessly.
        match self.sessions.entry(id) {
          Entry::Occupied(entry) => Ok(entry.get().clone()),
          Entry::Vacant(entry) => {
            entry.insert(handle.clone());
            Ok(handle)
          }
        }
      }
    }
  }

  async fn spawn_actor(
    &self,
    record: &SessionRecord,
    native_session_id: Option<String>,
  ) -> Result<SessionHandle, RegistryError> {
    let (handle, cmd_rx, events_tx, busy) =
      SessionHandle::new_pair(record.id, record.agent_kind);
    let actor = SessionActor::new(
      record.id,
      record.agent_kind,
      record.cwd.clone(),
      self.store.clone(),
      cmd_rx,
      handle.command_sender(),
      events_tx,
      busy,
      self.config,
      native_session_id,
      record.title.clone(),
    )
    .await?;

    tokio::spawn(actor.run());
    Ok(handle)
  }

  /// Anything left `running`/`creating` by a previous `orchd` process has no
  /// actor anymore. Flips those to `interrupted` and kills any subprocess
  /// whose pgid survived the old daemon, so a crashed server never leaks
  /// orphaned agent processes. Returns the number of sessions reconciled.
  pub async fn reconcile_on_boot(&self) -> Result<usize, RegistryError> {
    let orphaned = self.store.reconcile_boot().await?;
    for record in &orphaned {
      let Some(pgid) = record.pgid else { continue };
      tracing::info!(session = %record.id, pgid, "reaping orphaned subprocess from a previous run");
      #[cfg(unix)]
      if let Err(err) = orchd_proc::kill_orphan_pgid(pgid) {
        tracing::warn!(session = %record.id, pgid, error = %err, "failed to reap orphaned subprocess");
      }
    }
    Ok(orphaned.len())
  }

  pub async fn list(&self) -> Result<Vec<SessionRecord>, RegistryError> {
    Ok(self.store.list_sessions().await?)
  }

  pub async fn list_archived(&self) -> Result<Vec<SessionRecord>, RegistryError> {
    Ok(self.store.list_archived_sessions().await?)
  }

  pub async fn get_record(&self, id: SessionId) -> Result<SessionRecord, RegistryError> {
    self.store.get_session(id).await?.ok_or(RegistryError::NotFound(id))
  }

  /// Whether a turn is currently in flight. `false` for any session with no
  /// live actor: there's nothing running to be busy.
  pub fn is_busy(&self, id: SessionId) -> bool {
    self.get(id).is_some_and(|handle| handle.is_busy())
  }

  pub async fn archive_project(&self, id: ProjectId) -> Result<(), RegistryError> {
    match self.store.archive_project(id).await {
      Ok(()) => Ok(()),
      Err(orchd_store::StoreError::ProjectNotFound(id)) => {
        Err(RegistryError::ProjectNotFound(id))
      }
      Err(err) => Err(err.into()),
    }
  }

  /// Archiving only hides the session from the list; it doesn't touch the
  /// live actor, so an already-open session keeps working until its owner
  /// closes it.
  pub async fn archive_session(&self, id: SessionId) -> Result<(), RegistryError> {
    match self.store.archive_session(id).await {
      Ok(()) => Ok(()),
      Err(orchd_store::StoreError::SessionNotFound(id)) => {
        Err(RegistryError::NotFound(id))
      }
      Err(err) => Err(err.into()),
    }
  }

  pub async fn unarchive_session(&self, id: SessionId) -> Result<(), RegistryError> {
    match self.store.unarchive_session(id).await {
      Ok(()) => Ok(()),
      Err(orchd_store::StoreError::SessionNotFound(id)) => {
        Err(RegistryError::NotFound(id))
      }
      Err(err) => Err(err.into()),
    }
  }
}
