use std::process::{ExitStatus, Stdio};

use command_group::{AsyncCommandGroup, AsyncGroupChild};
use orchd_core::SpawnSpec;
use secrecy::ExposeSecret;
use thiserror::Error;
use tokio::process::{ChildStderr, ChildStdin, ChildStdout};

#[derive(Debug, Error)]
pub enum ProcError {
  #[error("failed to spawn subprocess: {0}")]
  Spawn(#[source] std::io::Error),
  #[error("subprocess stdio was not piped")]
  MissingStdio,
  #[error("failed to wait on subprocess: {0}")]
  Wait(#[source] std::io::Error),
  #[error("failed to signal subprocess: {0}")]
  Signal(#[source] std::io::Error),
}

/// The three pipes of a spawned subprocess, handed to the caller as owned
/// values rather than fields on `ManagedProcess`, so holding one doesn't
/// require a partial-move-unfriendly `&mut ManagedProcess`. The session
/// actor moves `stdout` into a `framed_stream` and keeps `stdin` for
/// writing, independently of calling `kill`/`wait` on the process itself.
pub struct ChildPipes {
  pub stdin: ChildStdin,
  pub stdout: ChildStdout,
  pub stderr: ChildStderr,
}

/// A spawned agent subprocess, in its own process group so the whole tree
/// (the agent plus any shells/tools it spawns) can be torn down with one
/// kill. Protocol framing and translation happen one layer up in the
/// session actor.
pub struct ManagedProcess {
  group: AsyncGroupChild,
}

impl ManagedProcess {
  /// Spawns `spec` with piped stdio and `kill_on_drop` set, so a crashed
  /// or panicked actor can't leak an orphaned child. `spec.env` is
  /// layered on top of the daemon's own environment rather than
  /// replacing it, since the agent CLI needs the ambient PATH/HOME/etc
  /// to function.
  pub fn spawn(spec: &SpawnSpec) -> Result<(Self, ChildPipes), ProcError> {
    let mut cmd = tokio::process::Command::new(&spec.program);
    cmd
      .args(&spec.args)
      .current_dir(&spec.cwd)
      .stdin(Stdio::piped())
      .stdout(Stdio::piped())
      .stderr(Stdio::piped())
      .kill_on_drop(true);

    for (key, value) in &spec.env {
      cmd.env(key, value.expose_secret());
    }

    let mut group = cmd.group_spawn().map_err(ProcError::Spawn)?;
    let inner = group.inner();
    let stdin = inner.stdin.take().ok_or(ProcError::MissingStdio)?;
    let stdout = inner.stdout.take().ok_or(ProcError::MissingStdio)?;
    let stderr = inner.stderr.take().ok_or(ProcError::MissingStdio)?;

    Ok((Self { group }, ChildPipes { stdin, stdout, stderr }))
  }

  pub async fn wait(&mut self) -> Result<ExitStatus, ProcError> {
    self.group.wait().await.map_err(ProcError::Wait)
  }

  /// The OS process-group id, persisted by the session actor so a future
  /// `orchd` boot can find and reap this subprocess if the current
  /// daemon dies without a chance to kill it itself (see
  /// `kill_orphan_pgid`).
  pub fn pgid(&self) -> Option<u32> {
    self.group.id()
  }

  /// Kill the whole process group, not just the direct child.
  pub async fn kill(&mut self) -> Result<(), ProcError> {
    self.group.kill().await.map_err(ProcError::Signal)
  }

  /// Send `SIGINT` to the process group: the closest thing to an
  /// agent-agnostic "stop what you're doing" for CLIs that don't expose a
  /// protocol-level interrupt message.
  #[cfg(unix)]
  pub fn interrupt(&self) -> Result<(), ProcError> {
    use nix::{
      sys::signal::{Signal, killpg},
      unistd::Pid,
    };

    let pid = self.group.id().ok_or(ProcError::MissingStdio)?;
    killpg(Pid::from_raw(pid as i32), Signal::SIGINT)
      .map_err(|err| ProcError::Signal(std::io::Error::from(err)))
  }
}

/// Startup orphan reaping: kills a process group by a `pgid` persisted from
/// a *previous* `orchd` run, i.e. one this process never spawned and holds
/// no `ManagedProcess`/`kill_on_drop` handle for. A missing process
/// (`ESRCH`, already exited or reaped by init) is the expected common case,
/// so it counts as success rather than an error.
#[cfg(unix)]
pub fn kill_orphan_pgid(pgid: i64) -> Result<(), ProcError> {
  use nix::{
    errno::Errno,
    sys::signal::{Signal, killpg},
    unistd::Pid,
  };

  match killpg(Pid::from_raw(pgid as i32), Signal::SIGKILL) {
    Ok(()) | Err(Errno::ESRCH) => Ok(()),
    Err(err) => Err(ProcError::Signal(std::io::Error::from(err))),
  }
}
