CREATE TABLE IF NOT EXISTS lumen_system (
  id integer PRIMARY KEY CHECK (id = 1), initialized boolean NOT NULL DEFAULT false
);
INSERT INTO lumen_system(id) VALUES (1) ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS lumen_users (
  id text PRIMARY KEY, username text UNIQUE NOT NULL, password_hash text NOT NULL,
  role text NOT NULL CHECK (role IN ('admin','user')), disabled boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS lumen_sessions (
  hash text PRIMARY KEY, user_id text NOT NULL REFERENCES lumen_users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS lumen_sessions_user ON lumen_sessions(user_id);
CREATE TABLE IF NOT EXISTS lumen_invites (
  id text PRIMARY KEY, hash text UNIQUE NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL, used_by text REFERENCES lumen_users(id), revoked boolean NOT NULL DEFAULT false
);
CREATE TABLE IF NOT EXISTS lumen_resets (
  hash text PRIMARY KEY, user_id text NOT NULL REFERENCES lumen_users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS lumen_limits (
  key text NOT NULL, bucket bigint NOT NULL, count integer NOT NULL, PRIMARY KEY(key,bucket)
);
CREATE TABLE IF NOT EXISTS lumen_source (
  id integer PRIMARY KEY CHECK (id = 1), credential jsonb, account jsonb,
  enabled boolean NOT NULL DEFAULT false, status text NOT NULL DEFAULT 'unconfigured',
  version integer NOT NULL DEFAULT 0, checked_at timestamptz,
  qr_generation text, qr_key text, qr_owner text, qr_expires_at timestamptz
);
INSERT INTO lumen_source(id) VALUES (1) ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS lumen_failures (
  id bigserial PRIMARY KEY, kind text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS lumen_failures_time ON lumen_failures(created_at);
CREATE TABLE IF NOT EXISTS lumen_sync_state (
  user_id text PRIMARY KEY REFERENCES lumen_users(id) ON DELETE CASCADE,
  cursor bigint NOT NULL DEFAULT 0, stats_epoch text NOT NULL DEFAULT 'initial'
);
CREATE TABLE IF NOT EXISTS lumen_playlists (
  user_id text NOT NULL REFERENCES lumen_users(id) ON DELETE CASCADE, id text NOT NULL,
  data jsonb NOT NULL, deleted boolean NOT NULL DEFAULT false, position bigint NOT NULL,
  PRIMARY KEY(user_id,id)
);
CREATE TABLE IF NOT EXISTS lumen_entries (
  user_id text NOT NULL, id text NOT NULL, playlist_id text NOT NULL, data jsonb NOT NULL,
  deleted boolean NOT NULL DEFAULT false, position bigint NOT NULL,
  PRIMARY KEY(user_id,id), FOREIGN KEY(user_id,playlist_id) REFERENCES lumen_playlists(user_id,id)
);
CREATE TABLE IF NOT EXISTS lumen_operations (
  user_id text NOT NULL REFERENCES lumen_users(id) ON DELETE CASCADE, id text NOT NULL,
  cursor bigint NOT NULL, data jsonb NOT NULL, PRIMARY KEY(user_id,id), UNIQUE(user_id,cursor)
);
CREATE TABLE IF NOT EXISTS lumen_stat_events (
  user_id text NOT NULL REFERENCES lumen_users(id) ON DELETE CASCADE, id text NOT NULL,
  epoch text NOT NULL, data jsonb NOT NULL, PRIMARY KEY(user_id,id)
);
CREATE TABLE IF NOT EXISTS lumen_imports (
  user_id text NOT NULL REFERENCES lumen_users(id) ON DELETE CASCADE, id text NOT NULL,
  PRIMARY KEY(user_id,id)
);
