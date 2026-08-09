use clap::{Parser, Subcommand};

mod browser;
mod dev;

#[derive(Parser)]
#[command(
  name = "orchd",
  version,
  about = "orchd: self-hosted coding-agent orchestrator"
)]
struct Cli {
  #[command(subcommand)]
  command: Command,
}

#[derive(Subcommand)]
enum Command {
  /// Run the orchd daemon.
  Serve,
  /// Run the daemon and the frontend dev server together, and open a
  /// paired browser tab once both are ready.
  Dev {
    /// Don't open a browser automatically; just print the pairing URL.
    #[arg(long)]
    no_open: bool,
  },
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
  orchd_server::init_tracing();

  match Cli::parse().command {
    Command::Serve => orchd_server::run().await,
    Command::Dev { no_open } => dev::run(no_open).await,
  }
}
