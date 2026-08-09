use std::{path::PathBuf, process::Stdio, time::Duration};

use anyhow::Context;
use command_group::AsyncCommandGroup;
use tokio::{
  io::{AsyncBufReadExt, AsyncRead, BufReader},
  process::Command,
  sync::mpsc,
};

use crate::browser;

/// Runs the backend in-process (we're already the compiled binary, so no
/// nested `cargo run`) alongside the frontend dev server, then opens a browser
/// straight into a paired session once both are ready.
pub async fn run(no_open: bool) -> anyhow::Result<()> {
  let frontend_dir = workspace_root().join("frontend");
  anyhow::ensure!(
    frontend_dir.join("package.json").exists(),
    "no frontend/ found at {}; run `orchd dev` from the orchd repo",
    frontend_dir.display()
  );

  let bootstrapped = orchd_server::bootstrap().await?;
  let pairing_token = bootstrapped.pairing_token.clone();

  let backend = tokio::spawn(async move {
    if let Err(err) = orchd_server::serve(bootstrapped).await {
      tracing::error!(%err, "backend exited with an error");
    }
  });

  // `pnpm dev` execs vite as a child of its own, so killing just the `pnpm`
  // process would orphan it holding the port open; spawn a process group and
  // kill the whole group instead. That detaches from the terminal's foreground
  // pgrp, so an inherited stdin would make vite's readline-based CLI shortcuts
  // trigger SIGTTIN and silently freeze the group. Pipe stdin instead, and
  // never take or drop it: EOF makes vite think its parent went away.
  let mut frontend = Command::new("pnpm")
    .arg("dev")
    .current_dir(&frontend_dir)
    .env("FORCE_COLOR", "1")
    .stdin(Stdio::piped())
    .stdout(Stdio::piped())
    .stderr(Stdio::piped())
    .group_spawn()
    .context("failed to start `pnpm dev`; is pnpm installed and on PATH?")?;

  let (url_tx, mut url_rx) = mpsc::unbounded_channel::<String>();
  let inner = frontend.inner();
  tokio::spawn(relay_and_scan(inner.stdout.take().unwrap(), false, url_tx.clone()));
  tokio::spawn(relay_and_scan(inner.stderr.take().unwrap(), true, url_tx));

  let frontend_url = tokio::select! {
    Some(url) = url_rx.recv() => url,
    _ = tokio::time::sleep(Duration::from_secs(30)) => {
      tracing::warn!("frontend didn't report a URL in time, guessing http://localhost:3000/");
      "http://localhost:3000/".to_string()
    }
  };

  let separator = if frontend_url.contains('?') { '&' } else { '?' };
  let pair_url = format!("{frontend_url}{separator}pair={pairing_token}");

  println!("\n  ready, opening {pair_url}\n");
  if no_open {
    println!("  --no-open set; open this URL yourself to pair this device\n");
  } else if let Err(err) = browser::open(&pair_url) {
    tracing::warn!(%err, "couldn't open a browser automatically");
    println!("  open this URL yourself to pair this device:\n  {pair_url}\n");
  }

  tokio::select! {
    status = frontend.wait() => {
      tracing::info!(?status, "frontend exited");
    }
    _ = backend => {
      tracing::info!("backend task exited");
    }
    _ = tokio::signal::ctrl_c() => {
      tracing::info!("shutting down");
    }
    _ = terminate() => {
      tracing::info!("shutting down");
    }
  }

  let _ = frontend.kill().await;
  Ok(())
}

/// Waits for SIGTERM, which `kill`, `timeout`, systemd and `docker stop` all
/// send by default, so shutdown cleanup runs on those paths and not just
/// Ctrl-C.
#[cfg(unix)]
async fn terminate() {
  use tokio::signal::unix::{SignalKind, signal};
  let mut sigterm =
    signal(SignalKind::terminate()).expect("failed to install SIGTERM handler");
  sigterm.recv().await;
}

#[cfg(not(unix))]
async fn terminate() {
  std::future::pending().await
}

fn workspace_root() -> PathBuf {
  PathBuf::from(env!("CARGO_MANIFEST_DIR"))
    .parent()
    .and_then(|p| p.parent())
    .expect("crates/orchd-cli has two parent directories")
    .to_path_buf()
}

async fn relay_and_scan(
  reader: impl AsyncRead + Unpin,
  is_stderr: bool,
  tx: mpsc::UnboundedSender<String>,
) {
  let mut lines = BufReader::new(reader).lines();
  while let Ok(Some(line)) = lines.next_line().await {
    if is_stderr {
      eprintln!("{line}");
    } else {
      println!("{line}");
    }
    if let Some(url) = extract_local_url(&line) {
      let _ = tx.send(url);
    }
  }
}

fn extract_local_url(line: &str) -> Option<String> {
  let plain = strip_ansi(line);
  let after = plain.split("Local:").nth(1)?;
  let start = after.find("http")?;
  let candidate = &after[start..];
  let end = candidate.find(char::is_whitespace).unwrap_or(candidate.len());
  Some(candidate[..end].to_string())
}

fn strip_ansi(s: &str) -> String {
  let mut out = String::with_capacity(s.len());
  let mut chars = s.chars().peekable();
  while let Some(c) = chars.next() {
    if c == '\u{1b}' && chars.peek() == Some(&'[') {
      chars.next();
      for c2 in chars.by_ref() {
        if c2.is_ascii_alphabetic() {
          break;
        }
      }
      continue;
    }
    out.push(c);
  }
  out
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn extracts_plain_url() {
    assert_eq!(
      extract_local_url("  ➜  Local:   http://localhost:3000/"),
      Some("http://localhost:3000/".to_string())
    );
  }

  #[test]
  fn extracts_ansi_colored_url() {
    let line = "  \u{1b}[32m➜\u{1b}[39m  \u{1b}[1mLocal\u{1b}[22m:   \u{1b}[36mhttp://localhost:3001/\u{1b}[39m";
    assert_eq!(extract_local_url(line), Some("http://localhost:3001/".to_string()));
  }

  #[test]
  fn ignores_unrelated_lines() {
    assert_eq!(extract_local_url("VITE v5.0.0 ready in 120 ms"), None);
  }
}
