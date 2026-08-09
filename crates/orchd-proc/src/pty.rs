use std::{
  io::{Read, Write},
  sync::Mutex,
};

use portable_pty::{Child, CommandBuilder, MasterPty, PtySize, native_pty_system};
use thiserror::Error;
use tokio::sync::mpsc;

#[derive(Debug, Error)]
pub enum PtyError {
  #[error("failed to open pty: {0}")]
  Open(#[source] anyhow::Error),
  #[error("failed to spawn shell: {0}")]
  Spawn(#[source] anyhow::Error),
  #[error("failed to resize pty: {0}")]
  Resize(#[source] anyhow::Error),
  #[error("failed to write to pty: {0}")]
  Write(#[source] std::io::Error),
}

fn default_shell() -> String {
  #[cfg(unix)]
  {
    std::env::var("SHELL").unwrap_or_else(|_| "/bin/bash".to_string())
  }
  #[cfg(windows)]
  {
    std::env::var("COMSPEC").unwrap_or_else(|_| "cmd.exe".to_string())
  }
}

/// A user shell running behind a real PTY, one per open terminal panel. Unlike
/// `ManagedProcess`, this isn't an agent subprocess speaking a framed
/// protocol: it's raw bytes in both directions, so there's no translator layer
/// and output is handed back as an `mpsc` byte stream instead of going through
/// the session event log.
pub struct PtySession {
  // `Box<dyn MasterPty + Send>` isn't `Sync` on its own; wrapping it is what
  // lets `PtySession` live behind an `Arc` shared across the terminal
  // registry and multiple WS handler tasks.
  master: Mutex<Box<dyn MasterPty + Send>>,
  writer: Mutex<Box<dyn Write + Send>>,
  child: Mutex<Box<dyn Child + Send + Sync>>,
}

impl PtySession {
  /// Spawns the daemon owner's own shell (`$SHELL`, falling back to
  /// `/bin/bash`) in `cwd`. The blocking PTY reader runs on a dedicated
  /// `spawn_blocking` task and forwards chunks over the returned channel,
  /// which closes when the shell exits.
  pub fn spawn(cwd: &str, cols: u16, rows: u16) -> Result<(Self, mpsc::Receiver<Vec<u8>>), PtyError> {
    let pty_system = native_pty_system();
    let pair = pty_system
      .openpty(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 })
      .map_err(PtyError::Open)?;

    let mut cmd = CommandBuilder::new(default_shell());
    cmd.cwd(cwd);
    cmd.env("TERM", "xterm-256color");
    cmd.env("COLORTERM", "truecolor");

    let child = pair.slave.spawn_command(cmd).map_err(PtyError::Spawn)?;
    // Dropping our copy of the slave lets the child hold the only reference,
    // so its exit reliably shows up as EOF on the master reader.
    drop(pair.slave);

    let mut reader = pair.master.try_clone_reader().map_err(PtyError::Open)?;
    let writer = pair.master.take_writer().map_err(PtyError::Open)?;

    let (tx, rx) = mpsc::channel::<Vec<u8>>(64);
    tokio::task::spawn_blocking(move || {
      let mut buf = [0u8; 8192];
      loop {
        match reader.read(&mut buf) {
          Ok(0) => break,
          Ok(n) => {
            if tx.blocking_send(buf[..n].to_vec()).is_err() {
              break;
            }
          }
          Err(_) => break,
        }
      }
    });

    Ok((
      Self {
        master: Mutex::new(pair.master),
        writer: Mutex::new(writer),
        child: Mutex::new(child),
      },
      rx,
    ))
  }

  pub fn write(&self, data: &[u8]) -> Result<(), PtyError> {
    let mut writer = self.writer.lock().expect("pty writer lock poisoned");
    writer.write_all(data).map_err(PtyError::Write)?;
    writer.flush().map_err(PtyError::Write)
  }

  pub fn resize(&self, cols: u16, rows: u16) -> Result<(), PtyError> {
    self
      .master
      .lock()
      .expect("pty master lock poisoned")
      .resize(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 })
      .map_err(PtyError::Resize)
  }

  pub fn kill(&self) {
    let mut child = self.child.lock().expect("pty child lock poisoned");
    let _ = child.kill();
  }
}
