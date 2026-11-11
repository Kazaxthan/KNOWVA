# KNOWVA Frontend v1.3 · QA Retest Checklist

**Source:** Research Hub Bug & QA Tracker, 14 reported items.

**Status:** Implemented in source, **awaiting independent browser QA retest**. The automated `npm run qa:smoke` script checks JSX syntax and the presence of each intended change. It cannot prove the browser experience or backend behavior.

| QA ID | Severity (tracker) | Retest procedure | Expected result in v1.3 |
|---:|---|---|---|
| 1 | Low | Visit landing page; hover main navigation links. | Text turns blue on hover. |
| 2 | Low | Scroll the landing page; compare `Get Started` and the lower collaboration section. | One prominent portal-entry CTA (`Get Started`); no redundant `Select Your Portal` CTA. |
| 3 | Low | Inspect the hero's research overview at desktop and mobile widths. | Latest submission message is contained inside the overview card; it does not float over other elements. |
| 4 | Low | Open Student dashboard; look for notifications in sidebar/dashboard/header; click bell. | Only header bell is used for notification entry; it opens a dropdown and leads to the full Notification Center. The dashboard displays Research Progress instead of an extra notifications feed. |
| 5 | Low | On Sign In, type a password; click the visibility control twice. | Hidden password shows a **slashed eye**; visible text shows an **open eye**. Labels match actions. |
| 6 | Low | Sign Up → Student; inspect the Student ID field, submit a malformed ID, then a valid ID. | Placeholder uses `2025-01673-MN-0`; student ID requires `YYYY-#####-AA-#`. Faculty ID is not held to the student pattern. |
| 7 | Low | New Research → Information → Research Type → Other. | `Other (Please specify)` reveals a text field; a blank custom value blocks final submission. |
| 8 | Low | Sign into Student and Faculty demos; inspect dashboard metric counters. | Single-digit metrics display `5`, `0`, `1`, etc., without leading zeros. |
| 9 | Low | New Research → Information → Research Category. | `Select Category` is a disabled placeholder; options are alphabetized; selecting Other reveals a required custom input. |
| 10 | Medium | Profile → Personal Information / Research Information / Academic Credentials / Security & Privacy. | `Account Security` card appears only under Security & Privacy. |
| 11 | Low | New Research → Authors; add an author and click the edit pencil; also test Co-Authors Management. | Both Edit and Delete actions exist; editing updates the existing author entry instead of forcing delete/re-add. |
| 12 | **Critical** | New Research → Step 3: Manuscript. Upload a PDF, then a DOCX; switch to Write Online. Try an invalid extension or a file over 20 MB. | User can choose PDF/DOCX or manual entry; accepted selection shows filename/size, PDF preview works while the current tab is open; unsupported/oversized files display errors. **Actual file content upload/persistence requires a backend.** |
| 13 | Medium | Open a research detail, manuscript editor, review evaluation, and validation detail from their parent pages. | An arrow-back control appears near the top bar and returns to the appropriate parent workspace. |
| 14 | Low | Open Notification Center via header bell; click an item's Mark as read and then Mark as unread. | Label and state alternate correctly; unread filter and bell count update. |

## Important implementation notes

- Three **account roles** remain `student`, `faculty`, `admin`. Reviewer/coordinator are responsibilities within the appropriate role.
- The normal sign-in sends only credentials to `/api/auth/login`. A **separate Demo panel** provides the three roles until the backend is connected.
- App data is per-browser `localStorage`; shared sessions and document contents are not persisted or uploaded.
- Step 3 PDF local preview works only while the browser retains the selected file object. After refresh, the filename/size may still be displayed, but the file must be reselected for preview/transmission.
- Actual AI/similarity analysis and secure file storage are not implemented. The current validator remains a readiness checklist.
- QA should test at desktop and mobile widths, and after clearing demo local storage if a stale prior saved state masks new defaults.

## Run the source smoke checks

```powershell
cd frontend
npm install
npm run qa:smoke
npm run dev
```

Then manually execute the 14 retests above. A passing source check is **not** a passed browser regression test.
