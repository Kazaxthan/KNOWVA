# KnowVa v1.4 | Backend Integration Contract

The production frontend is configured with `VITE_KNOWVA_MODE=production`. It does **not** provide an email server, database schema, file storage service, or identity provider. Do not expose SMTP keys, database credentials, or invitation signing secrets to the browser.

## Security boundary

1. Only `student`, `faculty`, and `admin` are user roles. Reviewer / coordinator responsibilities are assignments or capabilities on those users.
2. Credentials must be checked server-side. A successful login creates a **Secure, HttpOnly, SameSite cookie** session. Require CSRF defenses where needed for cookie-authenticated state-changing requests, plus appropriate CORS restrictions.
3. Every project, review, author, profile, admin, and invitation endpoint checks authorization against current server-side identity. Route hiding and stored frontend state do **not** confer authorization.
4. All returned lists must be filtered to current user's permitted data. `/api/directory` should return only safe searchable fields; `/api/users` is Admin-only.

## API endpoints required for production mode

Base URL: `/api` by default, configurable via `VITE_API_BASE_URL` before building.

| Method | Path | Request / success response |
| --- | --- | --- |
| POST | `/auth/login` | `{email,password}` → `{user:{id,name,email,role,avatarUrl}}` and secure session cookie |
| GET | `/auth/me` | `{user:{id,name,email,role,avatarUrl}}` or 401 |
| POST | `/auth/logout` | revoke session, 200/204 |
| POST | `/auth/register` | `{name,email,universityId,role,password}` → 202; only Student and Faculty, verify PUP email |
| GET | `/projects` | `{projects:[...]}`; server filters by permissions |
| POST | `/projects` | `{...research, submit:boolean}` → `{project:{id,...}}` |
| PATCH | `/projects/:id` | Partial research updates → `{project:{...}}`; stage changes must be authorized |
| GET | `/directory` | `{items:[{id,name,email,department,role,active}]}` for safe search/listing; restrict data exposure |
| GET | `/users` | Admin-only `{users:[...]}` |
| POST/PATCH | `/users`, `/users/:id` | Admin-managed account create/update → `{user:{...}}` |
| PATCH | `/users/me` | `{name,email,department}` → `{user:{...}}`; verify any email change |
| PUT | `/users/me/avatar` | `multipart/form-data` field `avatar` (JPG/PNG/WebP ≤2 MB) → `{avatarUrl:"/uploaded/..."}` |
| DELETE | `/users/me/avatar` | Deletes current user's stored image and returns 204 |
| GET | `/reviews` | `{reviews:[...]}` with assignment `reviewerEmail`/reviewer ID; only assigned reviews returned |
| POST | `/reviews/:projectId/evaluation` | `{recommendation,scores,comments,revisions,final}` → `{review:{...},project:{...}}`; if final, update workflow server-side |
| GET | `/notifications` | `{notifications:[...]}` for current user |
| PATCH | `/notifications/:id` | `{read:true/false}` for current user's notification |
| POST | `/notifications/read-all` | Mark all of current user's notifications read |
| GET | `/invitations` | `{invitations:[...]}` scoped to project owner/admin |
| POST | `/projects/:id/invitations` | `{name,email,role,type}` → 202 `{invitation:{id,email,status:"Queued",projectId,...}}` |
| GET | `/invitations/validate?token=...` | `{invitation:{projectId,projectTitle,role,emailMasked,expiresAt}}` (no sensitive token leaks) |
| POST | `/invitations/accept` | `{token}` with verified login → link user to research, mark invitation accepted |
| GET | `/reviewers` | Admin-only `{reviewers:[...]}` |
| GET/PATCH | `/settings` | Admin settings read/save, enforce permissions |
| POST | `/mentorship/meetings` | `{title,scheduledAt}` → `{meeting:{...}}` |

## Email invitation workflow

1. Author search links a **registered** account by `userId` in the research authorship list. Backend validates the user is eligible and the project owner may add them.
2. If absent, requester submits an invitation with name, email and intended contribution. Backend checks ownership/roles, validates email, prevents duplicates, and records invitation with `queued` status.
3. Backend sends email through a configured transactional email service (SMTP or provider) containing a **signed, single-use, time-limited** invitation URL such as `https://your-domain.example/invitations/accept/<token>`.
4. Recipient signs in or registers with verified invitation email, then accepts; backend atomically associates the account with the research and records the audit event.
5. Keep delivery statuses distinct: `queued`, `sent`, `delivered` (only if confirmed by provider), `failed`, `expired`, `accepted`. A successful HTTP 202 proves request acceptance, **not email delivery**.
6. Provide rate limiting, invitation expiration, resend policy, and revoke behavior.

**In the Demo ZIP** clicking Invite only creates a pending local record. "Simulate acceptance" changes local state; it does not send email or verify identity.

## Profile photos

Client restricts file MIME and size; server MUST independently inspect actual bytes, decode/re-encode the image to a safe format, remove metadata, generate a thumbnail, store it privately or in a controlled public avatar bucket, and return a safe URL. Authorize upload/delete to current authenticated user, apply rate limits and storage quotas, and consider malicious images.

## Other pending integrations from earlier KnowVa versions

PDF/DOCX manuscript selection and supporting documents in the frontend currently track metadata only; permanent upload and versioning need storage APIs. AI and similarity readiness is **not** an actual AI-content detector or plagiarism checker. Real validation requires separate document processing, third-party service agreements as applicable, human oversight, and reliable status storage. Reviewer and research workflow transitions need server-enforced state machines and audit events.

## Build / deployment

In final package use `.env` with:

```dotenv
VITE_KNOWVA_MODE=production
VITE_API_BASE_URL=/api
```

Develop with `npm install`, `npm run dev`, and build with `npm run build` after API proxy/deployment is set up. For a public deployment, configure SPA routing to fall back to `index.html`, secure HTTPS, and server session cookie domains. Never expose the browser-only Demo ZIP as a production login system.
