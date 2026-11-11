-- Additive KnowVa full-application migration; run after 01_schema.sql and 03_integrity_validation.sql.
-- Never drops or truncates existing user data. Safe to re-run.
CREATE TABLE IF NOT EXISTS user_tasks (
 task_id BIGSERIAL PRIMARY KEY,
 user_id INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
 title VARCHAR(500) NOT NULL,
 completed BOOLEAN NOT NULL DEFAULT FALSE,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_user_tasks_user ON user_tasks(user_id,created_at DESC);
CREATE INDEX IF NOT EXISTS ix_publications_project ON publication_records(project_id);
CREATE TABLE IF NOT EXISTS platform_email_templates (
 template_key VARCHAR(80) PRIMARY KEY,
 subject VARCHAR(255) NOT NULL,
 body TEXT NOT NULL,
 updated_by INTEGER REFERENCES users(user_id),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO platform_email_templates(template_key,subject,body) VALUES
 ('verification','Verify your KnowVa email','Please verify your email using the secure link provided.'),
 ('invitation','KnowVa Research Invitation','You have been invited to collaborate on a KnowVa research project.'),
 ('review','Research review assignment','A research manuscript has been assigned to you for review.')
ON CONFLICT DO NOTHING;
