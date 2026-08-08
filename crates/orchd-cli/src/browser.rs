/// Best-effort "open a URL in the default browser". Errors are the caller's
/// to report: a dev tool shouldn't hard-fail just because there's no display
/// to open one on, such as over SSH.
pub fn open(url: &str) -> anyhow::Result<()> {
  let status = if cfg!(target_os = "macos") {
    std::process::Command::new("open").arg(url).status()
  } else if cfg!(target_os = "windows") {
    std::process::Command::new("cmd").args(["/C", "start", "", url]).status()
  } else {
    std::process::Command::new("xdg-open").arg(url).status()
  }?;

  anyhow::ensure!(status.success(), "browser launcher exited with {status}");
  Ok(())
}
