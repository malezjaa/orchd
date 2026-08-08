use std::{net::SocketAddr, sync::Arc};

use orchd_session::SessionRegistry;
use orchd_store::Store;

pub mod config;
pub mod logging;

pub use config::ServerConfig;

/// A daemon that has loaded its config, connected to the store, and minted
/// this boot's pairing token, but isn't accepting connections yet. Split out
/// from [`serve`] so in-process callers can read the pairing token directly
/// instead of scraping it out of a log line.
pub struct Bootstrapped {
  pub config: ServerConfig,
  pub registry: Arc<SessionRegistry>,
  pub pairing_token: String,
}

pub async fn bootstrap() -> anyhow::Result<Bootstrapped> {
  let config = ServerConfig::load()?;

  tracing::info!(db_url = %config.db_url, "connecting to session store");
  let store = Store::connect(&config.db_url).await?;

  let registry = Arc::new(SessionRegistry::new(store, config.actor));

  let reconciled = registry.reconcile_on_boot().await?;
  if reconciled > 0 {
    tracing::info!(
      reconciled,
      "reconciled sessions left running by a previous orchd process"
    );
  }

  // Minted on every boot, not just first run: the trust boundary is being
  // able to read this log line, i.e. shell or journal access to the host,
  // which recovering from a lost pairing token requires anyway. Pairing more
  // devices without a restart goes through `POST /auth/pairing-tokens`.
  let pairing_token =
    registry.store().create_pairing_token(config.auth.pairing_token_ttl).await?;
  tracing::warn!(
    "pairing token (expires in {}s): {pairing_token}",
    config.auth.pairing_token_ttl.as_secs()
  );
  tracing::warn!("exchange it via POST /auth/pairing to pair this device");

  Ok(Bootstrapped { config, registry, pairing_token })
}

/// Binds and serves the API, consuming a [`Bootstrapped`] daemon. Runs
/// until the listener errors or the process is killed.
pub async fn serve(bootstrapped: Bootstrapped) -> anyhow::Result<()> {
  let Bootstrapped { config, registry, .. } = bootstrapped;
  let bind_addr = config.bind_addr;
  let app = orchd_api::app(registry, config.auth);

  let listener = tokio::net::TcpListener::bind(&bind_addr).await?;
  tracing::info!(%bind_addr, "orchd listening");

  axum::serve(listener, app.into_make_service_with_connect_info::<SocketAddr>()).await?;
  Ok(())
}

/// Bootstraps and serves in one call: the plain "run the daemon" path used by
/// the standalone `orchd-server` binary and `orchd serve`.
pub async fn run() -> anyhow::Result<()> {
  serve(bootstrap().await?).await
}

pub fn init_tracing() {
  logging::init();
}
