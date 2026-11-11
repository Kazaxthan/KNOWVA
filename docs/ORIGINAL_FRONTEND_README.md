# KnowVa Frontend v1.4

React 18 + Vite web application based on the uploaded UX Pilot screens and the research publication flowchart. Retains the navy/blue UI, the supplied KnowVa icon, three account roles, and all 14 QA v1.3 fixes.

## Professor's improvements

- Research-type filter in **My Research**, **Admin Central Database**, and **Faculty Student Research**; combines with search and other filters.
- Search and link registered researchers as authors by account ID/email. If not found, **Invite by email**, with pending invitation tracking and an acceptance-page route. Demo invitations DO NOT send email. Real emails require backend integration and provider configuration.
- Faculty's own research, assigned peer reviews, and advised student research are three separate workspaces. Students can choose a faculty adviser when creating research.
- Profile-photo uploader accepts JPG/PNG/WebP up to 2 MB, previews in profile/sidebar/top bar, supports removal, and reports errors.

## Running in VS Code

Unzip the ZIP file; `package.json` is at the root. In its folder:

```powershell
npm install
npm run qa:smoke
npm run qa:v14
npm run dev
```

Open the Vite address (usually `http://localhost:5173`). To test a production bundle on your own PC, run `npm run build` after dependencies are installed.

## Which package am I using?

- **KnowVa_v1.4_DEMO.zip**: `.env` sets `VITE_KNOWVA_MODE=demo`. Login has clearly labeled **Explore KnowVa Demo** with Student, Faculty and Admin. Records are browser-local and other devices see different data. Use fictional accounts/research only.
- **KnowVa_v1.4_FINAL_Frontend.zip**: `.env` sets `VITE_KNOWVA_MODE=production`. Normal credential form, no demo role switch, API-backed routes, no sample records. It needs the real backend before data loads and real workflows work. This is **the final frontend integration candidate**, not a complete launched production system.

## Important demo limitations

- Invites shown in the demo are simulated. No external email is delivered.
- Demo photos are compressed and saved per account in this browser only.
- Demo project and author records are stored in localStorage, not PostgreSQL.
- PDF/DOCX manuscript and support-file selection saves metadata only; permanent file storage is pending.
- AI & Similarity Validator is a readiness checklist, not an active AI/plagiarism scan.
- The backend must enforce role authorization. A frontend role picker alone does not secure account access.

## QA documents

- `QA_HANDOFF_v1_4.md`: professor change acceptance tests plus 14 regression items.
- `QA_RETEST_CHECKLIST.md`: original v1.3 14-item retest guide.
- `BACKEND_INTEGRATION.md`: expected API endpoints, author invitation email workflow, profile image upload requirements.

## Verification

JSX syntax parsing, TypeScript transpilation, 14 v1.3 source guards and 10 v1.4 source guards passed. Full dependency installation and browser tests were **not possible in the packaging environment**; run `npm install`, `npm run build` and hands-on QA locally before checking issues as resolved.
