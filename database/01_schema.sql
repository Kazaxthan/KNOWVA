-- KNOWVA baseline PostgreSQL schema. Designed for a NEW empty database.
-- Existing installations must be backed up and migrated after inspecting differences.
CREATE EXTENSION IF NOT EXISTS pgcrypto;
DO $$ BEGIN CREATE TYPE user_role AS ENUM ('STUDENT','FACULTY','ADMIN','REVIEWER'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE project_status AS ENUM ('DRAFT','SUBMITTED','SCREENING','APPLICATION_APPROVED','UNDER_REVIEW','REVISION_REQUESTED','APPROVED','REJECTED','PUBLISHED','SUBMITTED_TO_CONFERENCE'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE ai_validation_status AS ENUM ('PENDING','PASSED','FLAGGED_FOR_REVISION','FAILED'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE review_status AS ENUM ('ASSIGNED','IN_PROGRESS','APPROVED','REJECTED','REVISION_REQUIRED'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE publication_type AS ENUM ('JOURNAL','CONFERENCE','OTHER'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE publication_status AS ENUM ('PREPARING','SUBMITTED','ACCEPTED','PUBLISHED','REJECTED'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS users (
 user_id SERIAL PRIMARY KEY,
 first_name VARCHAR(120) NOT NULL,
 last_name VARCHAR(120) NOT NULL,
 email VARCHAR(255) NOT NULL UNIQUE,
 password_hash TEXT NOT NULL,
 role user_role NOT NULL DEFAULT 'STUDENT',
 department VARCHAR(180),
 student_number VARCHAR(40) UNIQUE,
 active BOOLEAN NOT NULL DEFAULT TRUE,
 email_verified BOOLEAN NOT NULL DEFAULT FALSE,
 avatar_url TEXT,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS research_projects (
 project_id SERIAL PRIMARY KEY,
 lead_researcher_id INT NOT NULL REFERENCES users(user_id),
 title TEXT NOT NULL,
 abstract TEXT,
 keywords TEXT,
 status project_status NOT NULL DEFAULT 'DRAFT',
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS project_authors (
 author_id SERIAL PRIMARY KEY,
 project_id INT NOT NULL REFERENCES research_projects(project_id) ON DELETE CASCADE,
 user_id INT REFERENCES users(user_id),
 author_name VARCHAR(255) NOT NULL,
 author_order INT NOT NULL DEFAULT 1,
 is_corresponding BOOLEAN NOT NULL DEFAULT FALSE,
 affiliation VARCHAR(255)
);
CREATE TABLE IF NOT EXISTS manuscripts (
 manuscript_id SERIAL PRIMARY KEY,
 project_id INT NOT NULL REFERENCES research_projects(project_id) ON DELETE CASCADE,
 version_number INT NOT NULL DEFAULT 1,
 file_url TEXT NOT NULL,
 ai_validation_status ai_validation_status DEFAULT 'PENDING',
 similarity_score NUMERIC(5,2),
 uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 UNIQUE(project_id, version_number)
);
CREATE TABLE IF NOT EXISTS peer_reviews (
 review_id SERIAL PRIMARY KEY,
 manuscript_id INT NOT NULL REFERENCES manuscripts(manuscript_id) ON DELETE CASCADE,
 reviewer_id INT NOT NULL REFERENCES users(user_id),
 review_status review_status NOT NULL DEFAULT 'ASSIGNED',
 comments TEXT,
 reviewed_at TIMESTAMPTZ,
 UNIQUE(manuscript_id, reviewer_id)
);
CREATE TABLE IF NOT EXISTS publication_records (
 publication_id SERIAL PRIMARY KEY,
 project_id INT NOT NULL REFERENCES research_projects(project_id) ON DELETE CASCADE,
 manuscript_id INT REFERENCES manuscripts(manuscript_id),
 publication_type publication_type NOT NULL DEFAULT 'JOURNAL',
 venue_name VARCHAR(255),
 submission_date DATE,
 publication_date DATE,
 publication_status publication_status NOT NULL DEFAULT 'PREPARING',
 doi_or_link TEXT
);
CREATE TABLE IF NOT EXISTS workflow_history (
 history_id SERIAL PRIMARY KEY,
 project_id INT NOT NULL REFERENCES research_projects(project_id) ON DELETE CASCADE,
 action_by_user_id INT REFERENCES users(user_id),
 stage_name VARCHAR(140) NOT NULL,
 action_taken TEXT NOT NULL,
 remarks TEXT,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Application extensions, separated from the legacy tables above.
CREATE TABLE IF NOT EXISTS project_details (
 project_id INT PRIMARY KEY REFERENCES research_projects(project_id) ON DELETE CASCADE,
 research_type VARCHAR(160) NOT NULL DEFAULT 'Unspecified',
 category VARCHAR(160) NOT NULL DEFAULT 'Uncategorized',
 department VARCHAR(160) NOT NULL DEFAULT 'Computer Engineering',
 objectives TEXT NOT NULL DEFAULT '',
 advisor_id INT REFERENCES users(user_id),
 stage VARCHAR(160) NOT NULL DEFAULT 'Draft',
 resume_stage VARCHAR(160),
 sections JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE TABLE IF NOT EXISTS author_details (
 author_id INT PRIMARY KEY REFERENCES project_authors(author_id) ON DELETE CASCADE,
 contribution VARCHAR(100) NOT NULL DEFAULT 'Co-Author',
 collaborator_type VARCHAR(60) NOT NULL DEFAULT 'Internal',
 email VARCHAR(255),
 link_status VARCHAR(50) NOT NULL DEFAULT 'Unlinked'
);
CREATE TABLE IF NOT EXISTS review_evaluations (
 project_id INT NOT NULL REFERENCES research_projects(project_id) ON DELETE CASCADE,
 reviewer_id INT NOT NULL REFERENCES users(user_id),
 recommendation VARCHAR(50),
 scores JSONB NOT NULL DEFAULT '{}'::jsonb,
 comments TEXT,
 revisions TEXT,
 final BOOLEAN NOT NULL DEFAULT FALSE,
 updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 PRIMARY KEY(project_id, reviewer_id)
);
CREATE TABLE IF NOT EXISTS notifications (
 notification_id BIGSERIAL PRIMARY KEY,
 user_id INT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
 title TEXT NOT NULL,
 content TEXT NOT NULL DEFAULT '',
 kind VARCHAR(40) NOT NULL DEFAULT 'system',
 is_read BOOLEAN NOT NULL DEFAULT FALSE,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS invitations (
 invitation_id BIGSERIAL PRIMARY KEY,
 project_id INT NOT NULL REFERENCES research_projects(project_id) ON DELETE CASCADE,
 invited_by INT NOT NULL REFERENCES users(user_id),
 invited_name VARCHAR(255) NOT NULL,
 invited_email VARCHAR(255) NOT NULL,
 contribution VARCHAR(120) NOT NULL DEFAULT 'Co-Author',
 collaborator_type VARCHAR(40) NOT NULL DEFAULT 'Internal',
 token_hash CHAR(64) NOT NULL UNIQUE,
 status VARCHAR(25) NOT NULL DEFAULT 'queued',
 expires_at TIMESTAMPTZ NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 accepted_at TIMESTAMPTZ,
 sent_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS invitation_pending_unique ON invitations(project_id, lower(invited_email)) WHERE status IN ('queued','sent');
CREATE TABLE IF NOT EXISTS email_verifications (
 token_hash CHAR(64) PRIMARY KEY,
 user_id INT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
 expires_at TIMESTAMPTZ NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 consumed_at TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS platform_settings (
 setting_key VARCHAR(80) PRIMARY KEY,
 setting_value JSONB NOT NULL,
 updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS mentorship_meetings (
 meeting_id BIGSERIAL PRIMARY KEY,
 faculty_id INT NOT NULL REFERENCES users(user_id),
 title VARCHAR(255) NOT NULL,
 scheduled_at TIMESTAMPTZ NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS audit_events (
 audit_id BIGSERIAL PRIMARY KEY,
 actor_id INT REFERENCES users(user_id),
 event_type VARCHAR(100) NOT NULL,
 entity_type VARCHAR(80),
 entity_id VARCHAR(80),
 metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
 ip_address INET,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS uploaded_files (
 file_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 project_id INT NOT NULL REFERENCES research_projects(project_id) ON DELETE CASCADE,
 uploaded_by INT NOT NULL REFERENCES users(user_id),
 file_name VARCHAR(255) NOT NULL,
 disk_name TEXT NOT NULL UNIQUE,
 mime_type VARCHAR(100) NOT NULL,
 size_bytes BIGINT NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 20971520),
 purpose VARCHAR(40) NOT NULL DEFAULT 'supporting',
 uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS reviewer_certifications (
 user_id INT PRIMARY KEY REFERENCES users(user_id) ON DELETE CASCADE,
 specialization TEXT NOT NULL DEFAULT '',
 certified_by INT REFERENCES users(user_id),
 certified_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_projects_owner ON research_projects(lead_researcher_id);
CREATE INDEX IF NOT EXISTS ix_projects_status ON research_projects(status);
CREATE INDEX IF NOT EXISTS ix_authors_user ON project_authors(user_id);
CREATE INDEX IF NOT EXISTS ix_reviews_reviewer ON peer_reviews(reviewer_id);
CREATE INDEX IF NOT EXISTS ix_notices_user ON notifications(user_id,created_at DESC);
CREATE INDEX IF NOT EXISTS ix_audit_created ON audit_events(created_at DESC);
CREATE INDEX IF NOT EXISTS ix_manuscripts_project ON manuscripts(project_id);
CREATE INDEX IF NOT EXISTS ix_uploads_project ON uploaded_files(project_id);
INSERT INTO platform_settings(setting_key,setting_value) VALUES ('general', '{"platform":"KNOWVA Centralized Research Portal","contact":"support@knowva.edu.ph","strict":true,"threshold":15,"maxLoad":5,"maintenance":false}'::jsonb) ON CONFLICT DO NOTHING;
