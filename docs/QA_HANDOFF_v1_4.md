# KnowVa Frontend v1.4 | QA Retest Handoff

**Baseline:** UX Pilot / v1.3 QA-fixes frontend. **Account roles remain exactly three:** Student, Faculty, Admin. Reviewers and coordinators are work assignments/capabilities, not separate account roles.

## What is being delivered

- **DEMO package** (`VITE_KNOWVA_MODE=demo`): browser-only interactive sample data, clear demo accounts, research workflow, visible simulated invitation status, and per-user locally saved photos. **No actual email is sent.**
- **FINAL frontend package** (`VITE_KNOWVA_MODE=production`): regular credentials only, no demo account chooser, no seed records, REST API adapters for research projects, users, invitation requests, acceptance links, avatar upload, reviews, settings, and notifications. **Requires a working secured backend and email service before production deployment.**
- `BACKEND_INTEGRATION.md`: API contracts and security notes.

## Professor recommendations: new acceptance cases

| ID | Priority | Area | Steps | Expected in DEMO | Expected in FINAL after backend integration |
| --- | --- | --- | --- | --- | --- |
| PR-01 | Medium | Research type filter | Sign in as Student or Faculty, open **My Research**, set **Research type** to Applied Research and switch back to All Types. Repeat at Admin → Central Database. Combine with title search/status. | Results update instantly; count changes; page pagination resets; no unrelated types. | Same display, based on API projects the signed-in user is authorized to see. |
| PR-02 | High | Registered author linking | New Submission → Step 2 Authors, type `Elena` or another seeded registered account; click **Link Author**. | The selected account appears with name, email, user ID, and `Linked` status. | Backend persists the account relationship. A copied name is **not** sufficient. |
| PR-03 | High | Invitation when author is missing | Step 2 Authors → search a name not in the directory → **Can't find the author? Invite by email** → enter name and valid email → Add Invitation to Draft → Save Draft; or use Co-Authors Management on a saved project. | Record appears with `Pending invitation`; QA can use **Simulate acceptance**. **No email is actually delivered.** | `POST /api/projects/{id}/invitations` returns an accepted request; backend queues a signed, expiring email invitation; recipient clicks link and accepts it with a verified account. Check real email and API audit; this cannot pass until backend is connected. |
| PR-04 | High | Faculty workspaces | Sign in as Faculty → open **My Research**, **Assigned Reviews**, and **Student Research**. Add a new Student project with Faculty Adviser assigned to Elena in Step 2. | My Research lists projects led by Faculty; Assigned Reviews shows only review work; Student Research and Mentorship list projects assigned to that adviser. No student project counted as faculty-owned. | Backend must filter ownership/assignments and enforce access. Verify direct unauthorized URL does not bypass access. |
| PR-05 | Medium | Profile-photo upload | From any role, open **Profile** → **Change Photo** → select JPG/PNG/WebP under 2 MB → verify image in profile, sidebar, top bar. Switch demo roles and return. Try invalid file/oversized image and Remove. | Valid images are cropped/compressed and stored per demo account in browser only; errors show for invalid files; removed photo reverts to initials. | Avatar upload and deletion handled by `/api/users/me/avatar`; persists across devices after login. Backend checks image bytes, file limits, ownership, and storage authorization. |

## v1.3 QA regression: recheck all 14 resolved items

1. Landing navbar links turn blue on hover.
2. No duplicate CTA to exactly the same destination.
3. Latest Research Submission card stays inside dashboard illustration.
4. Single notification entry at top bell; no redundant sidebar and dashboard widgets.
5. Password icon: open eye shown when text is visible; crossed eye when hidden.
6. Student ID example and validation include `2025-01673-MN-0` format.
7. Research Type has `Other (Please specify)` and reveals text input.
8. Metric counters show 0, 1, 5 rather than 00, 01, 05.
9. Research Category: disabled placeholder, alphabetical options, and Other input.
10. Profile Account Security panel only in Security & Privacy tab.
11. Author rows retain Edit and Delete actions.
12. Manuscript Step 3 allows PDF/DOCX selection or manual text entry, rejecting wrong type and files over 20 MB.
13. Detail pages include back navigation.
14. Notification toggle changes from Mark as read to Mark as unread based on read state.

## High-value integration tests for FINAL frontend

- Login as three authorized roles using the same email/password form. Response role **must come from the server**, not the URL or form.
- Confirm student cannot access Admin User Management or Faculty peer-review endpoints directly.
- Author invitation endpoint must reject duplicates, invalid emails, unowned project IDs, and unauthorized users.
- Invitation delivery: server logs queued/sent/failed (not just a frontend toast); link token must be single use, time limited, and tied to the invited email.
- Invitee accepts after university account verification; author relation changes to linked on the actual project and cannot be self-confirmed by changing localStorage.
- Upload photo: reject SVG/script, malformed image, files over 2 MB, and unauthorized file deletion; persist across sessions.
- Faculty lists must remain distinct when someone is both a lead researcher, assigned reviewer, and adviser.
- Verify API outages show errors and no false "saved/sent" confirmation.

## Source checks (not browser tests)

```powershell
cd frontend
npm install
npm run qa:smoke
npm run qa:v14
npm run dev
```

**Preliminary verification:** Both JSX parsing and TypeScript transpilation succeed. The source guard tests for 14 legacy items and 10 v1.4 scenarios pass. These checks **do not** verify browser behavior, email delivery, actual database writes, or server-side authorization. QA should retest each workflow in a browser and fill actual status/evidence.

## Evidence recommended for QA

Capture: (1) filter before/after, (2) directory author search and linked author row, (3) missing-author invitation modal and pending status, (4) all three Faculty workspaces with corresponding records, (5) profile image before/after and error case, (6) same operations against connected FINAL backend when available.
