use std::{path::PathBuf, time::Duration};

use orchd_api::AuthConfig;
use orchd_session::{ActorConfig, BackoffPolicy, IdleAction, IdlePolicy};
use serde::{Deserialize, Serialize};

const CONFIG_FILE_NAME: &str = "config.toml";
const DB_FILE_NAME: &str = "orchd.db";

/// `orchd`'s home directory: `$ORCHD_HOME` if set, otherwise `~/.orchd`. The
/// TOML config and the SQLite database both live here, so there's exactly one
/// place on disk to back up. Created on first run if missing.
pub fn orchd_home() -> anyhow::Result<PathBuf> {
  let home = match std::env::var_os("ORCHD_HOME") {
    Some(dir) => PathBuf::from(dir),
    None => dirs::home_dir()
      .ok_or_else(|| anyhow::anyhow!("could not determine home directory"))?
      .join(".orchd"),
  };
  std::fs::create_dir_all(&home)?;
  Ok(home)
}

/// The on-disk shape of `<orchd_home>/config.toml`. Flat rather than nested
/// tables so the file stays easy to hand-edit; `ServerConfig` reshapes it into
/// the typed configs each crate wants.
#[derive(Debug, Serialize, Deserialize)]
#[serde(default)]
struct TomlConfig {
  bind_addr: String,
  /// Path to the SQLite file. Relative paths are resolved against
  /// `orchd_home()`; defaults to `<orchd_home>/orchd.db`.
  db_path: Option<String>,
  idle_timeout_secs: Option<u64>,
  idle_action: String,
  backoff_base_ms: u64,
  backoff_max_secs: u64,
  max_retries: u32,
  pairing_token_ttl_secs: u64,
  session_ttl_secs: u64,
  ws_ticket_ttl_secs: u64,
  cookie_secure: bool,
}

impl Default for TomlConfig {
  fn default() -> Self {
    let backoff = BackoffPolicy::default();
    let auth = AuthConfig::default();
    Self {
      bind_addr: "127.0.0.1:8787".to_string(),
      db_path: None,
      idle_timeout_secs: None,
      idle_action: "close".to_string(),
      backoff_base_ms: backoff.base.as_millis() as u64,
      backoff_max_secs: backoff.max.as_secs(),
      max_retries: backoff.max_retries,
      pairing_token_ttl_secs: auth.pairing_token_ttl.as_secs(),
      session_ttl_secs: auth.session_ttl.as_secs(),
      ws_ticket_ttl_secs: auth.ws_ticket_ttl.as_secs(),
      cookie_secure: auth.cookie_secure,
    }
  }
}

/// Fully resolved server configuration, ready to hand to the registry,
/// the API layer, and the listener.
pub struct ServerConfig {
  pub bind_addr: String,
  pub db_url: String,
  pub actor: ActorConfig,
  pub auth: AuthConfig,
}

impl ServerConfig {
  /// Loads `<orchd_home>/config.toml`, creating it with defaults on first run
  /// so there's a file to edit. Environment variables override individual
  /// fields on top of it, for scripting and CI use.
  pub fn load() -> anyhow::Result<Self> {
    let home = orchd_home()?;
    let config_path = home.join(CONFIG_FILE_NAME);

    let mut toml_config = if config_path.exists() {
      let raw = std::fs::read_to_string(&config_path)?;
      toml::from_str(&raw)?
    } else {
      let defaults = TomlConfig::default();
      std::fs::write(&config_path, toml::to_string_pretty(&defaults)?)?;
      defaults
    };

    apply_env_overrides(&mut toml_config);

    let db_url = match std::env::var("ORCHD_DB") {
      Ok(url) => url,
      Err(_) => {
        let path = match toml_config.db_path.as_deref() {
          Some(p) => PathBuf::from(p),
          None => home.join(DB_FILE_NAME),
        };
        format!("sqlite://{}", path.display())
      }
    };

    let idle_action = match toml_config.idle_action.as_str() {
      "keep" => IdleAction::Keep,
      _ => IdleAction::Close,
    };

    let actor = ActorConfig {
      backoff: BackoffPolicy {
        base: Duration::from_millis(toml_config.backoff_base_ms),
        max: Duration::from_secs(toml_config.backoff_max_secs),
        max_retries: toml_config.max_retries,
      },
      idle: IdlePolicy {
        timeout: toml_config
          .idle_timeout_secs
          .filter(|secs| *secs > 0)
          .map(Duration::from_secs),
        action: idle_action,
      },
    };

    let auth = AuthConfig {
      pairing_token_ttl: Duration::from_secs(toml_config.pairing_token_ttl_secs),
      session_ttl: Duration::from_secs(toml_config.session_ttl_secs),
      ws_ticket_ttl: Duration::from_secs(toml_config.ws_ticket_ttl_secs),
      cookie_secure: toml_config.cookie_secure,
    };

    Ok(Self { bind_addr: toml_config.bind_addr.clone(), db_url, actor, auth })
  }
}

fn apply_env_overrides(config: &mut TomlConfig) {
  if let Ok(addr) = std::env::var("ORCHD_BIND") {
    config.bind_addr = addr;
  }
  if let Ok(path) = std::env::var("ORCHD_DB_PATH") {
    config.db_path = Some(path);
  }
  if let Some(secs) = env_u64("ORCHD_IDLE_TIMEOUT_SECS") {
    config.idle_timeout_secs = Some(secs);
  }
  if let Ok(action) = std::env::var("ORCHD_IDLE_ACTION") {
    config.idle_action = action;
  }
  if let Some(ms) = env_u64("ORCHD_BACKOFF_BASE_MS") {
    config.backoff_base_ms = ms;
  }
  if let Some(secs) = env_u64("ORCHD_BACKOFF_MAX_SECS") {
    config.backoff_max_secs = secs;
  }
  if let Some(n) = std::env::var("ORCHD_MAX_RETRIES").ok().and_then(|s| s.parse().ok()) {
    config.max_retries = n;
  }
  if let Some(secs) = env_u64("ORCHD_PAIRING_TOKEN_TTL_SECS") {
    config.pairing_token_ttl_secs = secs;
  }
  if let Some(secs) = env_u64("ORCHD_SESSION_TTL_SECS") {
    config.session_ttl_secs = secs;
  }
  if let Some(secs) = env_u64("ORCHD_WS_TICKET_TTL_SECS") {
    config.ws_ticket_ttl_secs = secs;
  }
  if let Ok(val) = std::env::var("ORCHD_COOKIE_SECURE") {
    config.cookie_secure = matches!(val.as_str(), "true" | "1");
  }
}

fn env_u64(key: &str) -> Option<u64> {
  std::env::var(key).ok().and_then(|s| s.parse().ok())
}
