CREATE TABLE IF NOT EXISTS subagents (
  parent_session_id TEXT NOT NULL,
  thread_id TEXT NOT NULL,
  nickname TEXT,
  role TEXT,
  prompt TEXT,
  model TEXT,
  effort TEXT,
  status TEXT NOT NULL,
  message TEXT,
  summary TEXT,
  can_accept_direct_input INTEGER,
  active_turn_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (parent_session_id, thread_id),
  FOREIGN KEY (parent_session_id) REFERENCES sessions(id)
);

CREATE INDEX IF NOT EXISTS idx_subagents_parent
  ON subagents(parent_session_id, updated_at DESC);
