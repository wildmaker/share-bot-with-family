CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  session_key TEXT NOT NULL,
  name TEXT NOT NULL,
  question TEXT NOT NULL,
  reply TEXT,
  status TEXT NOT NULL CHECK (status IN ('pending', 'done')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_messages_session_created_at
  ON messages (session_key, created_at);
