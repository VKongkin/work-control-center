import { chromium } from 'playwright';
const B = process.env.WCC_URL || 'http://localhost:3000';
let pass = 0, fail = 0; const failures = [];
const G='\x1b[32m', R='\x1b[31m', BD='\x1b[1m', X='\x1b[0m';
const check = (n,c,d='') => c ? (pass++, console.log(`  ${G}PASS${X}  ${n}`))
                              : (fail++, failures.push(n), console.log(`  ${R}FAIL${X}  ${n}  ${d}`));
const section = t => console.log(`\n${BD}${t}${X}`);

const b = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const p = await b.newPage({ viewport: { width: 1440, height: 950 } });
const D = () => p.locator('[role="dialog"]');
const go = async x => { await p.goto(B + x, { waitUntil: 'networkidle' }); await p.waitForTimeout(450); };
const nav = async label => { await p.locator(`a:has-text("${label}")`).first().click(); await p.waitForTimeout(1100); };

/* Relation pickers are searchable comboboxes; their list portals to the body. */
const comboOpen = async (id) => {
  if ((await p.locator('[role="option"]').count()) > 0) return;   // already open
  await p.locator(`#${id}`).click();
  await p.waitForTimeout(320);
  // the list opens on focus, so a click does nothing when the input already
  // had focus; ArrowDown opens it either way
  if ((await p.locator('[role="option"]').count()) === 0) {
    await p.locator(`#${id}`).press('ArrowDown');
    await p.waitForTimeout(320);
  }
};
const comboLabels = async (id) => {
  await comboOpen(id);
  const t = await p.locator('[role="option"]').allTextContents();
  // Escape is safe only while the list is genuinely open - otherwise it bubbles
  // to the dialog and closes the whole form
  if ((await p.locator('[role="option"]').count()) > 0) {
    await p.keyboard.press('Escape');
    await p.waitForTimeout(250);
  }
  return t.map(x => x.trim());
};
const comboPick = async (id, { index, label } = {}) => {
  await comboOpen(id);
  const opts = p.locator('[role="option"]');
  if (label) await opts.filter({ hasText: label }).first().click();
  else await opts.nth(index ?? 0).click();
  await p.waitForTimeout(250);
};

const stamp = () => String(Date.now()).slice(-6);
const api = async (m,u,bo) => (await fetch(B+u,{method:m,headers:{'Content-Type':'application/json'},
  body: bo?JSON.stringify(bo):undefined})).json().catch(()=>null);
const cleanup = [];

await go('/');   // load the app before using the sidebar

/** Create a record on a Directory page through the UI. */
async function createIn(page, button, createLabel, name) {
  await nav(page);
  await p.locator(`button:has-text("${button}")`).first().click();
  await p.waitForTimeout(400);
  await D().locator('#f-name').fill(name);
  await p.locator(`button:has-text("${createLabel}")`).click();
  await p.waitForTimeout(1500);
}

/** Open a form elsewhere and report whether `name` is offered in `selectId`. */
async function offeredIn(navLabel, newButton, selectId, name, exact = false) {
  await nav(navLabel);
  // filter controls sit on the page; field controls sit inside the modal
  if (selectId.startsWith('f-filter-')) {
    const opts = await p.locator(`#${selectId} option`).allTextContents();
    return exact ? opts.some(o => o.trim() === name) : opts.some(o => o.includes(name));
  }
  await p.locator(`button:has-text("${newButton}")`).first().click();
  await p.waitForTimeout(700);
  const opts = await comboLabels(selectId);
  const n = (exact ? opts.filter(o => o.trim() === name) : opts.filter(o => o.includes(name))).length;
  await p.keyboard.press('Escape');
  await p.waitForTimeout(400);
  if (await p.locator('button:has-text("Discard changes")').count())
    { await p.locator('button:has-text("Discard changes")').click(); await p.waitForTimeout(300); }
  return n > 0;
}

section('A new Directory record reaches every form that references it');
const CASES = [
  { entity:'Person',     page:'People',      btn:'New Person',     mk:'Create person',
    checks:[['Tasks','New Task','f-responsible_person_id'], ['Follow-ups','New Follow-up','f-person_id'],
            ['Issues','New Issue','f-responsible_person_id'], ['Meetings','New Meeting','f-primary_contact_id'],
            ['Departments','New Department','f-contact_person_id'], ['Vendors','New Vendor','f-primary_contact_id']] },
  { entity:'Department', page:'Departments', btn:'New Department', mk:'Create department',
    checks:[['Tasks','New Task','f-department_id'], ['Issues','New Issue','f-department_id'],
            ['People','New Person','f-department_id']] },
  { entity:'Vendor',     page:'Vendors',     btn:'New Vendor',     mk:'Create vendor',
    checks:[['Tasks','New Task','f-vendor_id'], ['Issues','New Issue','f-vendor_id'],
            ['People','New Person','f-vendor_id']] },
  { entity:'System',     page:'Systems',     btn:'New System',     mk:'Create system',
    checks:[['Tasks','New Task','f-system_id'], ['Issues','New Issue','f-system_id']] },
  { entity:'Category',   page:'Categories',  btn:'New Category',   mk:'Create category',
    checks:[['Tasks','New Task','f-category_id']] },
  { entity:'Project',    page:'Projects',    btn:'New Project',    mk:'Create project',
    checks:[['Tasks','New Task','f-project_id'], ['Issues','New Issue','f-project_id'],
            ['Tasks','New Task','f-filter-project']] },
];

const made = {};
for (const c of CASES) {
  const name = `Sync ${c.entity} ${stamp()}`;
  made[c.entity] = name;
  await createIn(c.page, c.btn, c.mk, name);
  for (const [navLabel, btn, sel] of c.checks) {
    const ok = await offeredIn(navLabel, btn, sel, name);
    check(`new ${c.entity} → ${navLabel} / ${sel.replace('f-','')}`, ok, 'not offered without a refresh');
  }
}

section('Renaming a Directory record updates the label shown elsewhere');
const personName = made['Person'];
const renamed = personName + ' RENAMED';
await nav('People');
await p.locator('tbody tr', { hasText: personName }).first().locator('button[aria-label="Edit"]').click();
await p.waitForTimeout(600);
await D().locator('#f-name').fill(renamed);
await p.locator('button:has-text("Save changes")').click();
await p.waitForTimeout(1600);
check('rename → Task form shows the new label',
  await offeredIn('Tasks', 'New Task', 'f-responsible_person_id', renamed));
check('rename → old label is gone',
  !(await offeredIn('Tasks', 'New Task', 'f-responsible_person_id', personName, true)),
  'the pre-rename label is still offered');
made['Person'] = renamed;

section('A task owner column reflects a rename without a refresh');
await nav('Tasks');
await p.locator('button:has-text("New Task")').first().click();
await p.waitForTimeout(600);
const taskTitle = `Sync owner ${stamp()}`;
await D().locator('#f-title').fill(taskTitle);
await comboPick('f-responsible_person_id', { label: renamed });
await p.locator('button:has-text("Create task")').click();
await p.waitForTimeout(1600);
check('task row shows the owner',
  (await p.locator('tbody tr', { hasText: taskTitle }).first().textContent()).includes(renamed));

const again = renamed + ' AGAIN';
await nav('People');
await p.locator('tbody tr', { hasText: renamed }).first().locator('button[aria-label="Edit"]').click();
await p.waitForTimeout(600);
await D().locator('#f-name').fill(again);
await p.locator('button:has-text("Save changes")').click();
await p.waitForTimeout(1600);
await nav('Tasks');
await p.waitForTimeout(900);
check('task row picks up the rename without a refresh',
  (await p.locator('tbody tr', { hasText: taskTitle }).first().textContent()).includes(again),
  'still showing the stale name');
made['Person'] = again;

section('Archiving removes a record from the pickers immediately');
await nav('Vendors');
const vName = made['Vendor'];
await p.locator('tbody tr', { hasText: vName }).first().locator('button[aria-label="Archive"]').click();
await p.waitForTimeout(450);
await D().locator('button:has-text("Archive")').last().click();
await p.waitForTimeout(1600);
check('archived vendor disappears from the Task form',
  !(await offeredIn('Tasks', 'New Task', 'f-vendor_id', vName)), 'still offered after archiving');

await nav('Vendors');
await p.locator('input[type="checkbox"]').first().check();
await p.waitForTimeout(1400);
await p.locator('tbody tr', { hasText: vName }).first().locator('button[aria-label="Restore"]').click();
await p.waitForTimeout(1600);
check('restored vendor comes back to the Task form',
  await offeredIn('Tasks', 'New Task', 'f-vendor_id', vName));

section('Deleting removes it from the pickers immediately');
await nav('Categories');
const cName = made['Category'];
await p.locator('tbody tr', { hasText: cName }).first().locator('button[aria-label="Delete"]').click();
await p.waitForTimeout(450);
await D().locator('button:has-text("Delete")').last().click();
await p.waitForTimeout(1600);
check('deleted category disappears from the Task form',
  !(await offeredIn('Tasks', 'New Task', 'f-category_id', cName)));
delete made['Category'];

/* cleanup */
for (const [path, key] of [['people','Person'],['departments','Department'],['vendors','Vendor'],
                           ['systems','System'],['projects','Project'],['categories','Category']]) {
  if (!made[key]) continue;
  const rows = await api('GET', `/api/${path}?limit=300&include_inactive=true`);
  const r = (rows||[]).find(x => x.name === made[key]);
  if (r) await api('DELETE', `/api/${path}/${r.id}`);
}
const tasks = await api('GET', '/api/tasks?limit=300');
for (const t of tasks||[]) if (t.title.startsWith('Sync owner')) await api('DELETE', `/api/tasks/${t.id}`);

console.log(`\n${'='.repeat(54)}\n  ${BD}${pass} passed, ${fail} failed${X}\n${'='.repeat(54)}`);
if (failures.length) { console.log('Failed:'); failures.forEach(f => console.log('  -', f)); }
await b.close();
process.exit(fail ? 1 : 0);
