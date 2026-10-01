
    CREATE TABLE IF NOT EXISTS pyro_schema_migrations (
      version integer PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS pyro_documents (
      key text PRIMARY KEY,
      value jsonb NOT NULL,
      updated_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS pyro_events (
      id text PRIMARY KEY,
      created_at timestamptz NOT NULL,
      app_id text,
      profile_id text NOT NULL,
      verdict text NOT NULL,
      action text NOT NULL,
      risk double precision NOT NULL,
      provider text NOT NULL,
      api_key_id text,
      labels jsonb NOT NULL DEFAULT '{}'::jsonb,
      payload jsonb NOT NULL
    );

    CREATE INDEX IF NOT EXISTS pyro_events_created_at_idx ON pyro_events (created_at DESC);
    CREATE INDEX IF NOT EXISTS pyro_events_app_created_idx ON pyro_events (app_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS pyro_events_profile_created_idx ON pyro_events (profile_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS pyro_events_action_created_idx ON pyro_events (action, created_at DESC);
    CREATE INDEX IF NOT EXISTS pyro_events_verdict_created_idx ON pyro_events (verdict, created_at DESC);
    CREATE INDEX IF NOT EXISTS pyro_events_provider_created_idx ON pyro_events (provider, created_at DESC);
    CREATE INDEX IF NOT EXISTS pyro_events_api_key_created_idx ON pyro_events (api_key_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS pyro_events_labels_idx ON pyro_events USING gin (labels);

CREATE TABLE IF NOT EXISTS pyro_deliveries (
    id text PRIMARY KEY, integration_id text NOT NULL, event_id text NOT NULL,
    created_at timestamptz NOT NULL, status text NOT NULL, next_attempt_at timestamptz NOT NULL,
    payload jsonb NOT NULL, UNIQUE (integration_id, event_id)
  );
  CREATE INDEX IF NOT EXISTS pyro_deliveries_due_idx ON pyro_deliveries(next_attempt_at) WHERE status IN ('pending', 'delivering');
  CREATE INDEX IF NOT EXISTS pyro_deliveries_integration_idx ON pyro_deliveries(integration_id, created_at DESC);
INSERT INTO pyro_schema_migrations(version) VALUES (1), (2);
