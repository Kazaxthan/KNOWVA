/** Fast static smoke checks for the 14 frontend changes. Run with npm run qa:smoke.
 * These do not replace browser testing or integration testing against a backend.
 */
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const app = fs.readFileSync(path.join(__dirname, '../src/App.jsx'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, '../src/styles.css'), 'utf8');
const ast = ts.createSourceFile('App.jsx', app, ts.ScriptTarget.Latest, true, ts.ScriptKind.JSX);
const checks = [
  [1, 'Navbar turns blue on hover', css.includes('.public-header nav a:hover') && css.includes('color:#2853cf')],
  [2, 'No duplicate landing CTA', !app.includes('Select Your Portal <ArrowRight')],
  [3, 'Research notification contained within overview', /className="hero-board"[\s\S]*className="mini-float"/.test(app) && css.includes('.hero-board .mini-float {position:static')],
  [4, 'One notification entry point with bell popover', app.includes('bell-popover') && !app.includes("['Notifications','notifications',Bell]") && !app.includes('Recent Notifications')],
  [5, 'Password eye icon maps to visible state', app.includes('{show?<Eye size={16}/>:<EyeOff size={16}/>}')],
  [6, 'PUP ID full format is validated', app.includes('2025-01673-MN-0') && app.includes('id.trim()')],
  [7, 'Research Type supports Other', app.includes('Specify research type')],
  [8, 'Dashboard counters do not pad with zero', !app.slice(app.indexOf('function Dashboard('),app.indexOf('function TrendChart(')).includes(".padStart(2,'0')")],
  [9, 'Category placeholder is disabled and Other supported', app.includes('<option value="" disabled>Select Category</option>') && app.includes('Specify research category') && app.includes('.sort((a,b)=>a.localeCompare(b))')],
  [10, 'Security card only renders in security tab', app.includes("{tab==='Security & Privacy'&&<Panel title=\"Account Security\" >") || app.includes("{tab==='Security & Privacy'&&<Panel title=\"Account Security\"> ") || app.includes("{tab==='Security & Privacy'&&<Panel title=\"Account Security\">" )],
  [11, 'Authors have inline edit and delete', app.includes('Edit author') && app.includes('Delete author') && app.includes('Save Author')],
  [12, 'Step 3 accepts PDF/DOCX and manual editing', app.includes('Upload Manuscript File') && app.includes('Write Online') && app.includes("['pdf','docx'].includes(ext)")],
  [13, 'Nested pages have back navigation', app.includes('topbar-back') && app.includes('backTarget')],
  [14, 'Read label and action toggle dynamically', app.includes("{n.read?'Mark as unread':'Mark as read'}") && app.includes('read:!x.read')],
];
const parseOk = ast.parseDiagnostics.length === 0;
console.log(`JSX syntax: ${parseOk ? 'PASS' : 'FAIL'}`);
for (const d of ast.parseDiagnostics) {
  const p = ast.getLineAndCharacterOfPosition(d.start || 0);
  console.error(`${p.line+1}:${p.character+1}: ${ts.flattenDiagnosticMessageText(d.messageText, '\n')}`);
}
for (const [id, name, ok] of checks) console.log(`${String(id).padStart(2, '0')} ${ok ? 'PASS' : 'FAIL'} ${name}`);
console.log(`${checks.filter(x=>x[2]).length}/${checks.length} QA criteria detected in source`);
if (!parseOk || checks.some(x=>!x[2])) process.exitCode = 1;
