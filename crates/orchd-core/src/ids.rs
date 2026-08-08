use std::fmt;

use serde::{Deserialize, Serialize};
use uuid::Uuid;

macro_rules! id_type {
  ($name:ident) => {
    #[derive(Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
    #[serde(transparent)]
    pub struct $name(pub Uuid);

    impl $name {
      pub fn new() -> Self {
        Self(Uuid::now_v7())
      }
    }

    impl Default for $name {
      fn default() -> Self {
        Self::new()
      }
    }

    impl fmt::Display for $name {
      fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.0)
      }
    }

    impl fmt::Debug for $name {
      fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}({})", stringify!($name), self.0)
      }
    }

    impl std::str::FromStr for $name {
      type Err = uuid::Error;
      fn from_str(s: &str) -> Result<Self, Self::Err> {
        Ok(Self(Uuid::parse_str(s)?))
      }
    }
  };
}

id_type!(SessionId);
id_type!(TurnId);
id_type!(BlockId);
id_type!(ToolCallId);
id_type!(ApprovalId);
id_type!(ProjectId);
