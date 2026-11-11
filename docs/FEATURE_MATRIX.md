# KnowVa v1.5: Backend integration coverage

| Frontend area | API / persistence | Notes |
|---|---|---|
| Login, logout, registration, email verification | `/api/auth/*`, PostgreSQL users/sessions | SMTP required for delivered verification email. 3 UI roles: student, faculty, admin. |
| Profiles and photos | `/api/users/me`, `/api/users/me/avatar`, `/api/account/password` | Password update requires current password; profile photos stored privately on backend. |
| Research index/search/status and project detail | `/api/projects`, `/api/projects/:id` | Source data from PostgreSQL; status changes validated on server. |
| Create research, save draft, submit | `/api/projects`, `/api/projects/:id`, `/api/projects/:id/files` | Multi-step create uploads selected files to backend; submission requires at least one real document. |
| Manuscript editor and sections | `PATCH /api/projects/:id` | Section content stored as JSONB. Existing textarea is not a full rich-text editor. |
| Document upload/download/delete | `/api/projects/:id/files` and `/:fileId` | PostgreSQL metadata + private storage folder. |
| Co-authors, author lookup and email invitations | `/api/directory`, `/api/projects/:id` author patch, `/api/invitations/*` | Linked accounts and invitations are persisted. Sending actual email requires SMTP. |
| Faculty assigned reviews, scores and decisions | `/api/reviews`, `/api/reviews/:projectId/evaluation` | Review rights and workflow controlled by backend; multiple reviewer assignments supported. |
| Reviewer pool, certification and assignments | `/api/reviewers`, `/api/projects/:id/assign-reviewer` | Verified faculty and administrator authorization required. |
| Student–faculty advising and mentorship | `/api/projects`, `/api/mentorship/meetings` | Adviser links and scheduled meetings persisted; external calendar invites not supplied. |
| Publication journal/conference records | `/api/projects/:id/publications` | Publication metadata stored and relevant project statuses updated server-side. |
| Notification and workflow history | `/api/notifications`, `/api/activity` | Backed by notifications and workflow_history tables. |
| Personal to-do | `/api/tasks` | Per-user CRUD backed by `user_tasks`. |
| Admin users and account activation | `/api/users`, `/api/users/:id` | Server-protected ADMIN routes. |
| Analytics and database health | `/api/insights`, `/api/admin/health`, `/api/health` | Live counts/trends replace demo figures; no fabricated timings. |
| Backend logs / security events | `/api/audit`, `/api/admin/security` | Observed app security events, not full cybersecurity platform. |
| General settings and maintenance | `/api/settings` | JSONB settings persisted; nonadmin mutations blocked in maintenance. |
| Brand image and logo | `/api/branding`, `/api/admin/logo` | Logo file stored on backend; path in PostgreSQL. |
| Administrator email templates | `/api/admin/email-templates` | Stored in PostgreSQL; used for verification, invitation and reviewer assignment messages; SMTP still needed. |
| Admin metadata export | `/api/admin/export` | Downloadable sanitized JSON metadata. Not full DB backup. |
| PDF/DOCX metadata extraction | `/api/ai/extract` | Optional explicit consent to send document text externally. |
| Internal manuscript similarity | `/api/projects/:id/validation/run` | Compares local corpus and records text overlap; no internet/Turnitin. |
| OpenAI writing feedback and diagnostics | `/api/ai/status`, `/api/ai/test` | Consent, valid key, API permissions, billing and network required. |

## Intentional limitations

Existing frontend navigation layout and screen structure are preserved. Minor interface wording and administrative controls were added to connect API operations. Purely visual widgets and formatting tools may remain local UI behavior. All externally dependent services cannot be proven functional without live provider credentials. Full end-to-end execution against the user's PostgreSQL server and SMTP/OpenAI accounts has **not** been performed inside this package build.
