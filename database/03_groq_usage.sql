CREATE TABLE IF NOT EXISTS ai_usage_requests (
  request_id BIGSERIAL PRIMARY KEY,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ai_usage_requests_started_at_idx ON ai_usage_requests(started_at);
