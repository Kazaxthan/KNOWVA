-- KNOWVA ADDITIVE MIGRATION 03
-- Safe to apply to the previously installed KnowVa schema (does not drop or alter existing data).
BEGIN;
CREATE TABLE IF NOT EXISTS manuscript_checks (
 check_id BIGSERIAL PRIMARY KEY,
 project_id INT NOT NULL REFERENCES research_projects(project_id) ON DELETE CASCADE,
 file_id UUID NOT NULL REFERENCES uploaded_files(file_id) ON DELETE CASCADE,
 checked_by INT NOT NULL REFERENCES users(user_id),
 overlap_percent NUMERIC(5,2) CHECK(overlap_percent BETWEEN 0 AND 100),
 compared_count INT NOT NULL DEFAULT 0,
 skipped_count INT NOT NULL DEFAULT 0,
 matches JSONB NOT NULL DEFAULT '[]'::jsonb,
 ai_feedback TEXT,
 methodology TEXT NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_checks_project_created ON manuscript_checks(project_id,created_at DESC);
CREATE TABLE IF NOT EXISTS security_events (
 event_id BIGSERIAL PRIMARY KEY,
 event_type VARCHAR(50) NOT NULL,
 severity VARCHAR(12) NOT NULL CHECK(severity IN ('INFO','WARNING','CRITICAL')),
 actor_id INT REFERENCES users(user_id) ON DELETE SET NULL,
 source_ip INET,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_security_created ON security_events(created_at DESC);
COMMIT;
