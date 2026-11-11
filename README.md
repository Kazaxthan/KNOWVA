# KNOWVA: Integrated Research Publication System

**Frontend:** React 18 + Vite (`frontend/`)  
**API:** Node.js 20+ / Express (`backend/`)  
**Database:** PostgreSQL 18-compatible (`database/`)  
**Mode by default:** Backend-connected, not browser demo. Set `VITE_KNOWVA_MODE=demo` explicitly if an isolated demo is required.

This package was rebuilt against the uploaded **KNOWVA (2).zip**. It includes backend routes for the frontend's main research workflows and a persistence migration for newly added functions. It is a **development integration release**: static checks/unit tests passed, but live PostgreSQL, live OpenAI, SMTP, full browser workflow, and production security verification must still be completed on your machine. See `docs/FEATURE_MATRIX.md`.

## IMPORTANT: Existing `.env` files preserved

The uploaded `backend/.env` and both `.env.example` files are included **unchanged, byte-for-byte**. No keys, passwords, ports, or connection strings were edited. The code does not require changing the frontend `.env`: when `VITE_KNOWVA_MODE` is absent, it uses the API and Vite's `/api` proxy.

**SECURITY:** The backend `.env` contains private credentials. Do not upload this ZIP to a public repository or distribute it. A key previously posted in chat is exposed: revoke it with its issuer and create a new one before production use. Your existing `.env` is left intact per your request.

## Folder structure

```text
KNOWVA/
  frontend/         React screens, API client, production-connected default
  backend/          API, authentication, services, CLI scripts and private storage/
  database/         01 original schema; 02 optional seed; 03 AI/security; 04 full app migration
  docs/             Feature matrix and end-to-end test checklist
  README.md
```

## Setup on Windows / PowerShell: existing `publication_system`

**Before doing anything:** Back up the PostgreSQL `publication_system` database and your `backend/storage/` folder. Do **not** use `npm run db:init` on an existing database. The supplied `database/USER_SUPPLIED_knowva_database.sql` is not a full database schema and need not be imported again.

1. Stop any previously running Vite / Node servers (Ctrl+C). Use the directory extracted from *this* ZIP, not an older `KNOWVA` folder.
2. Ensure PostgreSQL 18 is running and the credentials in the **existing** `backend/.env` point to the correct database. **Do not change `.env` just for the new code.** If its credentials are incorrect, connectivity can't work until you choose to update them.
3. Start backend, once, from a PowerShell terminal:

```powershell
cd backend
npm install
npm run db:migrate-full
npm run db:verify
npm run check
npm test
npm run dev
```

`db:migrate-full` applies `database/03_integrity_validation.sql` and `database/04_full_app.sql` without deleting existing research records. Review/backup before applying migration on any non-empty or independently modified schema. It does not import the sample research seed. If your original database is *empty*, follow the separate original `database/README.md` for the initial schema **only once** before migrating.

4. Open a second terminal and start frontend:

```powershell
cd frontend
npm install
npm run build
npm run dev -- --strictPort
```

5. Test these URLs:

- `http://localhost:3001/api/health` → `{"status":"ok","database":"connected"}`
- `http://localhost:5173/api/health` → same JSON through Vite proxy
- `http://localhost:5173/` → KnowVa site

If a backend session is already in use or your PostgreSQL instance was reconfigured, log out and sign in again. The frontend now loads PostgreSQL-backed projects, users, documents, reviews, notifications, invitations and settings. Demo mode is no longer the default if there is no frontend `.env`.

## Administrator and user access

An administrator account must exist in the target database. If necessary, from the **backend** directory, use the included `npm run admin:create` CLI with `ADMIN_EMAIL`, `ADMIN_NAME`, and `ADMIN_PASSWORD` environment variables. The CLI does not replace passwords of existing users. New student/faculty registrations require institutional email verification; **email delivery requires SMTP**. Without SMTP the backend only logs a development verification link and cannot send emails.

## OpenAI and similarity checking

- `npm run ai:test` from `backend/` tests the **existing** `OPENAI_API_KEY` and `OPENAI_MODEL` without sending research manuscripts.
- Admins can also test the key in the Validation Desk and Settings integration panel.
- Metadata extraction of PDF/DOCX runs locally first; sending text to OpenAI requires an explicit consent option.
- Writing feedback is optional and uses OpenAI if configured and authorized.
- Internal similarity checks compare eligible uploaded manuscripts against the KnowVa repository and save `manuscript_checks`. **This is NOT Turnitin, internet-wide plagiarism scanning, or AI-authorship detection.**

## Persistence / file storage

Research metadata, author links, reviews, publications, tasks, system settings, email templates, security events and audit logs are stored in PostgreSQL. Real uploaded documents and profile/logo images are stored privately under `backend/storage/`, with file metadata/references in PostgreSQL. Keep this folder when replacing an old backend. Sample manuscript placeholder paths from the old SQL do not correspond to real files.

## External service limitations (not hidden)

- **SMTP:** The supplied `.env` did not contain a configured working mail transport. Verification, invitations and reviewer emails are persisted/queued or reported as undelivered until SMTP is configured. Stored admin-editable email templates are read when composing these messages.
- **OpenAI:** A key in `.env` does not establish billing/permission/access, and AI requests may incur charges. `npm run ai:test` will report why a connection fails. Only consented manuscript content is sent externally.
- **Security monitoring:** Records observed backend access events, failed logins, and rate limits; it is not antivirus, DDoS protection or comprehensive intrusion detection.
- **Full backup:** Admin JSON export covers metadata and excludes passwords and file bytes; it is not a PostgreSQL `pg_dump` or a storage-backup replacement.
- **Production:** Requires HTTPS and secure session cookies, secret management, SMTP, independently reviewed security controls, backups, access testing and end-to-end QA. No production-readiness claim is made.

## QA checklist

Follow `docs/END_TO_END_CHECKLIST.md`. Verify all status changes via refreshed frontend and pgAdmin, including permissions for STUDENT, FACULTY and ADMIN. Use `npm run db:verify` to detect missing tables after migration.
