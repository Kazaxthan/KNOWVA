-- =====================================================================
-- KNOWVA : team accounts + placeholder sample data
-- Run in pgAdmin's Query Tool on publication_system, as the postgres user.
-- Run the WHOLE file at once (no highlighting needed). Safe to re-run.
--
-- Everything fake is tagged with the keyword "sample-data" so it can be
-- removed later with remove_sample_data.sql.
-- =====================================================================


-- =====================================================================
-- PART 0: Prepare the database
-- =====================================================================

-- The users table has no student number yet
ALTER TABLE users ADD COLUMN IF NOT EXISTS student_number VARCHAR(20) UNIQUE;

-- pgcrypto lets Postgres create bcrypt password hashes (same format the
-- Node backend uses), so these accounts can really sign in.
CREATE EXTENSION IF NOT EXISTS pgcrypto;


-- =====================================================================
-- PART 1: Team member accounts (role STUDENT)
-- Temporary password for everyone: ChangeMe#2026
-- Emails are placeholders built from the student number. Replace them
-- with the real institutional emails (see the UPDATE example below).
-- =====================================================================
INSERT INTO users (first_name, last_name, email, password_hash, role, department, student_number)
SELECT t.first_name,
       t.last_name,
       lower(t.student_number) || '@placeholder.invalid',
       crypt('ChangeMe#2026', gen_salt('bf', 10)),
       'STUDENT'::user_role,
       'Computer Engineering',
       t.student_number
FROM (VALUES
    ('Kharl Emmanuel',   'Lajom',     '2023-05338-MN-0'),
    ('Kyla',             'Endrinal',  '2023-04156-MN-0'),
    ('Carlo Roberto',    'Paule',     '2023-04729-MN-0'),
    ('April Cathlie',    'Varron',    '2023-03022-MN-0'),
    ('Lance Philip M.',  'Escario',   '2023-13789-MN-0'),
    ('Zyrus C.',         'Clavo',     '2023-06550-MN-0'),
    ('Nicole Decemae M.','Sta. Ana',  '2023-05357-MN-0'),
    ('Uella Blainne F.', 'Fabregas',  '2023-00176-MN-0'),
    ('Hanylyn D.',       'Rivera',    '2023-01755-MN-0'),
    ('Franchesca',       'Cervana',   '2023-06885-MN-0'),
    ('Charlene',         'Aldaya',    '2023-00188-MN-0'),
	('Shadwil F.',         'Joaquin',    '2023-02285-MN-0')
) AS t(first_name, last_name, student_number)
ON CONFLICT (email) DO NOTHING;

-- Example: put in a real email later (emails must be lowercase)
-- UPDATE users SET email = 'name@yourschool.edu.ph' WHERE student_number = '2023-05338-MN-0';

-- =====================================================================
-- PART 2: Two sample reviewers (needed so the sample peer reviews work)
-- Same temporary password: ChangeMe#2026
-- =====================================================================
INSERT INTO users (first_name, last_name, email, password_hash, role, department)
SELECT t.first_name, t.last_name, t.email,
       crypt('ChangeMe#2026', gen_salt('bf', 10)),
       'REVIEWER'::user_role,
       'Sample Department'
FROM (VALUES
    ('Demo', 'Reviewer 1', 'demo.reviewer1@placeholder.invalid'),
    ('Demo', 'Reviewer 2', 'demo.reviewer2@placeholder.invalid')
) AS t(first_name, last_name, email)
ON CONFLICT (email) DO NOTHING;


-- =====================================================================
-- PART 3: Sample projects based on public domain literary works
-- Each project gets authors, a manuscript, reviews, publication records
-- and workflow history, in a mix of statuses so dashboards look alive.
-- Leads are the team accounts, taken in turn.
-- =====================================================================
DO $$
DECLARE
    rec             RECORD;
    student_ids     INT[];
    reviewer_ids    INT[];
    v_lead          INT;
    v_reviewer      INT;
    v_project       INT;
    v_manuscript    INT;
    v_created       TIMESTAMP;
    v_review_status TEXT;
    v_comments      TEXT;
BEGIN
    SELECT array_agg(user_id ORDER BY student_number) INTO student_ids
      FROM users WHERE student_number IS NOT NULL;
    SELECT array_agg(user_id ORDER BY email) INTO reviewer_ids
      FROM users
     WHERE email IN ('demo.reviewer1@placeholder.invalid', 'demo.reviewer2@placeholder.invalid');

    IF student_ids IS NULL OR reviewer_ids IS NULL THEN
        RAISE EXCEPTION 'Parts 1 and 2 must run first';
    END IF;

    FOR rec IN
        SELECT * FROM (VALUES
            ( 1, 'Pride and Prejudice',                       'Jane Austen',            '1813',               'romance, social class, marriage',          'APPROVED',           'PASSED',               8.40, 'PUBLISHED'),
            ( 2, 'Frankenstein; or, The Modern Prometheus',   'Mary Shelley',           '1818',               'science fiction, ethics, gothic',          'APPROVED',           'PASSED',              11.20, 'PUBLISHED'),
            ( 3, 'Alice''s Adventures in Wonderland',         'Lewis Carroll',          '1865',               'fantasy, nonsense, childhood',             'UNDER_REVIEW',       'PASSED',              14.75, NULL),
            ( 4, 'Dracula',                                   'Bram Stoker',            '1897',               'gothic, horror, epistolary',               'UNDER_REVIEW',       'PASSED',               9.60, NULL),
            ( 5, 'Moby-Dick; or, The Whale',                  'Herman Melville',        '1851',               'adventure, symbolism, obsession',          'SUBMITTED',          'PENDING',              NULL, NULL),
            ( 6, 'The Adventures of Sherlock Holmes',         'Arthur Conan Doyle',     '1892',               'detective fiction, short stories',         'REVISION_REQUESTED', 'FLAGGED_FOR_REVISION', 38.40, NULL),
            ( 7, 'A Tale of Two Cities',                      'Charles Dickens',        '1859',               'historical fiction, revolution',           'SUBMITTED',          'PASSED',              12.10, NULL),
            ( 8, 'The Picture of Dorian Gray',                'Oscar Wilde',            '1890',               'aestheticism, morality, gothic',           'APPROVED',           'PASSED',               6.90, 'ACCEPTED'),
            ( 9, 'Jane Eyre',                                 'Charlotte Bronte',       '1847',               'bildungsroman, gender, independence',      'DRAFT',              NULL,                   NULL, NULL),
            (10, 'Wuthering Heights',                         'Emily Bronte',           '1847',               'gothic, love, revenge',                    'REJECTED',           'PASSED',              17.30, NULL),
            (11, 'Treasure Island',                           'Robert Louis Stevenson', '1883',               'adventure, pirates, coming of age',        'APPROVED',           'PASSED',              10.05, 'PUBLISHED'),
            (12, 'Noli Me Tangere',                           'Jose Rizal',             '1887',               'Philippine literature, colonialism',       'APPROVED',           'PASSED',               7.25, 'PUBLISHED'),
            (13, 'El Filibusterismo',                         'Jose Rizal',             '1891',               'Philippine literature, revolution',        'UNDER_REVIEW',       'PASSED',              13.40, NULL),
            (14, 'The Odyssey (Samuel Butler translation)',   'Homer',                  'c. 8th century BC',  'epic poetry, myth, journey',               'SUBMITTED',          'PASSED',               5.60, NULL),
            (15, 'Great Expectations',                        'Charles Dickens',        '1861',               'bildungsroman, social class, ambition',    'DRAFT',              NULL,                   NULL, NULL),
            (16, 'The Time Machine',                          'H. G. Wells',            '1895',               'science fiction, time, social commentary', 'APPROVED',           'PASSED',               9.15, 'PREPARING')
        ) AS t(n, title, lit_author, lit_year, topics, status, ai_status, similarity, pub_status)
        ORDER BY n
    LOOP
        -- Skip works that were already added by an earlier run
        IF EXISTS (SELECT 1 FROM research_projects
                    WHERE title = rec.title AND keywords LIKE '%sample-data%') THEN
            CONTINUE;
        END IF;

        v_lead    := student_ids[((rec.n - 1) % array_length(student_ids, 1)) + 1];
        v_created := now()::timestamp - make_interval(days => 70 - rec.n * 3);

        -- Project
        INSERT INTO research_projects
            (lead_researcher_id, title, abstract, keywords, status, created_at, updated_at)
        VALUES (
            v_lead,
            rec.title,
            format('A sample record based on the public domain work "%s" by %s (%s). '
                   'Placeholder content until real student outputs are available.',
                   rec.title, rec.lit_author, rec.lit_year),
            rec.topics || ', sample-data',
            rec.status::project_status,
            v_created,
            CASE WHEN rec.status = 'DRAFT' THEN v_created ELSE v_created + interval '10 days' END
        )
        RETURNING project_id INTO v_project;

        -- Authors: the team member (lead) and the original author
        INSERT INTO project_authors
            (project_id, user_id, author_name, author_order, is_corresponding, affiliation)
        VALUES
            (v_project, v_lead,
             (SELECT first_name || ' ' || last_name FROM users WHERE user_id = v_lead),
             1, TRUE, 'Computer Engineering'),
            (v_project, NULL, rec.lit_author,
             2, FALSE, 'Original author (public domain work)');

        -- History: creation
        INSERT INTO workflow_history
            (project_id, action_by_user_id, stage_name, action_taken, remarks, created_at)
        VALUES (v_project, v_lead, 'Project Creation', 'Created draft', NULL, v_created);

        IF rec.status <> 'DRAFT' THEN
            -- Manuscript (the file name is a placeholder, no real file exists)
            INSERT INTO manuscripts
                (project_id, version_number, file_url, ai_validation_status, similarity_score, uploaded_at)
            VALUES (
                v_project, 1, 'SAMPLE-' || rec.n || '.pdf',
                rec.ai_status::ai_validation_status, rec.similarity,
                v_created + interval '2 days'
            )
            RETURNING manuscript_id INTO v_manuscript;

            INSERT INTO workflow_history
                (project_id, action_by_user_id, stage_name, action_taken, remarks, created_at)
            VALUES
                (v_project, v_lead, 'Manuscript Upload', 'Uploaded version 1', NULL, v_created + interval '2 days'),
                (v_project, v_lead, 'Submission', 'Submitted for review', NULL, v_created + interval '3 days');
        END IF;

        -- Peer review
        IF rec.status IN ('UNDER_REVIEW', 'APPROVED', 'REJECTED', 'REVISION_REQUESTED') THEN
            v_reviewer := reviewer_ids[(rec.n % 2) + 1];

            v_review_status := CASE rec.status
                WHEN 'APPROVED'           THEN 'APPROVED'
                WHEN 'REJECTED'           THEN 'REJECTED'
                WHEN 'REVISION_REQUESTED' THEN 'REVISION_REQUIRED'
                ELSE CASE WHEN rec.n % 2 = 0 THEN 'IN_PROGRESS' ELSE 'ASSIGNED' END
            END;

            v_comments := CASE rec.status
                WHEN 'APPROVED'           THEN 'Clear structure and well supported. Recommended for publication.'
                WHEN 'REJECTED'           THEN 'Scope does not fit the review criteria. Please reframe the research question.'
                WHEN 'REVISION_REQUESTED' THEN 'Please address the similarity flags and strengthen the methodology section.'
                ELSE NULL
            END;

            INSERT INTO peer_reviews
                (manuscript_id, reviewer_id, review_status, comments, reviewed_at)
            VALUES (
                v_manuscript, v_reviewer, v_review_status::review_status, v_comments,
                CASE WHEN rec.status <> 'UNDER_REVIEW' THEN v_created + interval '8 days' END
            );

            INSERT INTO workflow_history
                (project_id, action_by_user_id, stage_name, action_taken, remarks, created_at)
            VALUES (v_project, v_reviewer, 'Peer Review', 'Reviewer assigned', NULL, v_created + interval '5 days');

            IF rec.status <> 'UNDER_REVIEW' THEN
                INSERT INTO workflow_history
                    (project_id, action_by_user_id, stage_name, action_taken, remarks, created_at)
                VALUES (v_project, v_reviewer, 'Peer Review',
                        'Review submitted: ' || v_review_status, v_comments,
                        v_created + interval '8 days');
            END IF;
        END IF;

        -- Publication record for approved works
        IF rec.status = 'APPROVED' THEN
            INSERT INTO publication_records
                (project_id, manuscript_id, publication_type, venue_name,
                 submission_date, publication_date, publication_status, doi_or_link)
            VALUES (
                v_project, v_manuscript,
                (CASE WHEN rec.n % 2 = 0 THEN 'CONFERENCE' ELSE 'JOURNAL' END)::publication_type,
                CASE WHEN rec.n % 2 = 0 THEN 'Sample Conference on Humanities Research'
                     ELSE 'Sample Journal of Literary Studies' END,
                (v_created + interval '12 days')::date,
                CASE WHEN rec.pub_status = 'PUBLISHED' THEN (v_created + interval '30 days')::date END,
                rec.pub_status::publication_status,
                NULL
            );
        END IF;
    END LOOP;
END $$;


-- =====================================================================
-- PART 4: Check the result
-- =====================================================================
SELECT first_name, last_name, student_number, role
FROM users
WHERE student_number IS NOT NULL
ORDER BY student_number;

SELECT status, COUNT(*) AS total
FROM research_projects
WHERE keywords LIKE '%sample-data%'
GROUP BY status
ORDER BY status;
