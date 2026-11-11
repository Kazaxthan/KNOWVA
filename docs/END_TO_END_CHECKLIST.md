# KnowVa end-to-end retest: Windows + PostgreSQL 18

Perform these checks after backing up the database and running `npm run db:migrate-full` and `npm run db:verify`. Keep the existing `backend/.env` unchanged unless **you** choose to fix an incorrect secret or database address.

- [ ] Both `/api/health` addresses report `database: connected`; no `Cannot GET` on frontend port.
- [ ] Login with a real verified institutional account; log out and back in; role-specific navigation is enforced.
- [ ] Create research draft, refresh, confirm persistence in `research_projects` and `project_details`.
- [ ] Upload PDF/DOCX and supporting file, refresh, download, then remove file; check `uploaded_files`.
- [ ] Edit research title, authors, adviser and manuscript sections; reload; verify original lead author remains linked.
- [ ] Submit a research with real document and verify workflow status/history.
- [ ] Admin approves screening, certifies faculty reviewer and assigns two reviewers; faculty can submit evaluations.
- [ ] Faculty can see assigned reviews and advised student projects, but not unrelated research.
- [ ] Student and faculty users cannot access admin-only endpoints (403 response).
- [ ] Create journal or conference publication record via authorized workflow; verify `publication_records`.
- [ ] Add/check/complete/delete user to-do tasks, refresh between actions; verify `user_tasks`.
- [ ] Schedule mentorship meeting, refresh, verify `mentorship_meetings`.
- [ ] Update profile photo, password, account status, logo, settings and email templates; refresh.
- [ ] Admin analytics and DB health match `SELECT count(*)` queries.
- [ ] Check admin audit trail and security-events display following a failed login.
- [ ] Use `npm run ai:test` to verify optional OpenAI. Do not send unpublished work without consent.
- [ ] Upload 2 manuscripts with overlapping source text; run internal comparison and see stored `manuscript_checks`.
- [ ] Test verification/invitation mail only after SMTP credentials are configured; otherwise verify accurate undelivered status.
- [ ] Admin export includes metadata but not passwords/file bytes; take separate database and storage backups.
- [ ] Run `cd frontend; npm run build` and `cd backend; npm run check; npm test` on the target Windows machine.

## SQL spot checks

```sql
SELECT current_database(), current_user;
SELECT COUNT(*) FROM research_projects;
SELECT COUNT(*) FROM users;
SELECT COUNT(*) FROM uploaded_files;
SELECT COUNT(*) FROM publication_records;
SELECT COUNT(*) FROM user_tasks;
SELECT COUNT(*) FROM manuscript_checks;
SELECT COUNT(*) FROM security_events;
```

If any SQL table is missing, do **not** reset the database. Review the migration output or seek assistance with a schema-specific fix.
