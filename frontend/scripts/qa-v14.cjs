/** QA source regression guard. Source checks are not a browser test or proof of email delivery. */
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const app = fs.readFileSync(path.join(__dirname, '../src/App.jsx'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, '../src/styles.css'), 'utf8');
const api = fs.readFileSync(path.join(__dirname, '../src/api.js'), 'utf8');
const config = fs.readFileSync(path.join(__dirname, '../src/config.js'), 'utf8');
const ast = ts.createSourceFile('App.jsx', app, ts.ScriptTarget.Latest, true, ts.ScriptKind.JSX);
const checks = [
 ['PR-01', 'Research type filter affects project results', app.includes('research-type-filter') && app.includes("researchType==='All Types'||p.type===researchType")],
 ['PR-02', 'Registered author search and link', app.includes('function AuthorLookup(') && app.includes('onLink?.(') && app.includes('userId:u.id')],
 ['PR-02b', 'Email invitation request routed to backend', app.includes("'/invitations',{method:'POST'") && app.includes("inviteAuthor=async") && app.includes('No real email was sent.')],
 ['PR-02c', 'Invitation acceptance route exists', app.includes('/invitations/accept/:token') && app.includes("apiRequest('/invitations/accept'")],
 ['PR-03', 'Faculty has three distinct spaces', app.includes("['Student Research','student-research'") && app.includes('function StudentResearch(') && app.includes('ownsResearch(') && app.includes('assignedReviewsFor(')],
 ['PR-03b', 'Student adviser assignment connects to faculty', app.includes('faculty-adviser-select') && app.includes('isStudentResearchForFaculty')],
 ['PR-04', 'Profile supports JPG, PNG, WebP uploads', app.includes('image/png,image/jpeg,image/webp') && app.includes('file.size>2*1024*1024') && app.includes('canvas')],
 ['PR-04b', 'Profile upload API and browser demo storage separated', app.includes("'/users/me/avatar'") && app.includes('setDemoAvatars')],
 ['MODES', 'Demo vs production environment builds', config.includes('VITE_KNOWVA_MODE') && app.includes('IS_DEMO&&<section') && api.includes('credentials:')],
 ['UX', 'UX Pilot navigation styling still present', css.includes('.sidebar') && css.includes('.faculty-workspace-links') && css.includes('.author-lookup')],
];
const okSyntax = ast.parseDiagnostics.length === 0;
console.log(`JSX syntax: ${okSyntax?'PASS':'FAIL'}`);
for (const d of ast.parseDiagnostics) {
 const p=ast.getLineAndCharacterOfPosition(d.start);
 console.error(`${p.line+1}:${p.character+1}: ${ts.flattenDiagnosticMessageText(d.messageText, ' ')}`);
}
for(const [id,desc,ok] of checks) console.log(`${id.padEnd(7)} ${ok?'PASS':'FAIL'} ${desc}`);
console.log(`${checks.filter(x=>x[2]).length}/${checks.length} new acceptance guards passed`);
if(!okSyntax||checks.some(x=>!x[2]))process.exitCode=1;
