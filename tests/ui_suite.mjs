import { chromium } from 'playwright';

const BASE = process.env.WCC_URL || 'http://localhost:3000';
let pass = 0, fail = 0;
const failures = [];
const errors = [];
const G = '\x1b[32m', R = '\x1b[31m', B = '\x1b[1m', X = '\x1b[0m';

const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ${G}PASS${X}  ${name}`); }
  else { fail++; failures.push(name); console.log(`  ${R}FAIL${X}  ${name}  ${detail}`); }
};
const section = (t) => console.log(`\n${B}${t}${X}`);

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const page = await browser.newPage({ viewport: { width: 1440, height: 950 } });
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));

const go = async (p) => { await page.goto(BASE + p, { waitUntil: 'networkidle' }); await page.waitForTimeout(350); };
const dialog = () => page.locator('[role="dialog"]');

/* Relation pickers are searchable comboboxes; their list portals to the body. */
const comboOpen = async (id) => {
  if ((await page.locator('[role="option"]').count()) > 0) return;   // already open
  await page.locator(`#${id}`).click();
  await page.waitForTimeout(320);
  // the list opens on focus, so a click does nothing when the input already
  // had focus; ArrowDown opens it either way
  if ((await page.locator('[role="option"]').count()) === 0) {
    await page.locator(`#${id}`).press('ArrowDown');
    await page.waitForTimeout(320);
  }
};
const comboLabels = async (id) => {
  await comboOpen(id);
  const t = await page.locator('[role="option"]').allTextContents();
  // Escape is safe only while the list is genuinely open. Counting the options
  // is not good enough: the list stays mounted through its closing transition,
  // so a count taken then sends an Escape that reaches the dialog instead and
  // closes the whole form. aria-expanded reflects the real state.
  const expanded = await page.locator(`#${id}`).getAttribute('aria-expanded');
  if (expanded === 'true') {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(250);
  }
  await page.waitForTimeout(150);
  return t.map(x => x.trim());
};
const comboPick = async (id, { index, label } = {}) => {
  await comboOpen(id);
  const opts = page.locator('[role="option"]');
  if (label) await opts.filter({ hasText: label }).first().click();
  else await opts.nth(index ?? 0).click();
  await page.waitForTimeout(250);
};
const stamp = () => String(Date.now()).slice(-6);

/* ---------------------------------------------------------------- pages */
section('Every page renders with live data');
const PAGES = [
  ['/', 'Dashboard'], ['/tasks', 'Tasks'], ['/followups', 'Follow-ups'],
  ['/projects', 'Projects'], ['/issues', 'Issues'], ['/meetings', 'Meetings'],
  ['/people', 'People'], ['/departments', 'Departments'], ['/vendors', 'Vendors'],
  ['/systems', 'Systems'], ['/categories', 'Categories'], ['/alerts', 'Alerts'],
  ['/search', 'Search'],
];
for (const [path, heading] of PAGES) {
  await go(path);
  const h1 = (await page.locator('h1').first().textContent().catch(() => ''))?.trim();
  check(`${path} → "${heading}"`, h1 === heading, `saw "${h1}"`);
  const body = await page.locator('body').textContent();
  check(`${path} has no error banner`, !body.includes('Something went wrong'));
}

/* ------------------------------------------------------- CRUD every page */
const CRUD = [
  { path: '/tasks',       singular: 'Task',       create: 'Create task',       nameField: 'title' },
  { path: '/projects',    singular: 'Project',    create: 'Create project',    nameField: 'name' },
  { path: '/issues',      singular: 'Issue',      create: 'Create issue',      nameField: 'title' },
  { path: '/meetings',    singular: 'Meeting',    create: 'Create meeting',    nameField: 'title' },
  { path: '/people',      singular: 'Person',     create: 'Create person',     nameField: 'name', archivable: true },
  { path: '/departments', singular: 'Department', create: 'Create department', nameField: 'name', archivable: true },
  { path: '/vendors',     singular: 'Vendor',     create: 'Create vendor',     nameField: 'name', archivable: true },
  { path: '/systems',     singular: 'System',     create: 'Create system',     nameField: 'name', archivable: true },
  { path: '/categories',  singular: 'Category',   create: 'Create category',   nameField: 'name' },
];

for (const c of CRUD) {
  section(`CRUD through the UI — ${c.singular}`);
  await go(c.path);
  const before = await page.locator('tbody tr').count();
  const value = `UI ${c.singular} ${stamp()}`;

  await page.locator(`button:has-text("New ${c.singular}")`).first().click();
  await page.waitForTimeout(350);
  check(`${c.singular}: form opens`, (await dialog().count()) > 0);

  await dialog().locator(`#f-${c.nameField}`).fill(value);
  await page.locator(`button:has-text("${c.create}")`).click();
  await page.waitForTimeout(1300);
  check(`${c.singular}: created`, (await page.locator('tbody').textContent()).includes(value));
  check(`${c.singular}: row count grew`, (await page.locator('tbody tr').count()) === before + 1);

  // edit
  const row = page.locator('tbody tr', { hasText: value }).first();
  await row.locator('button[aria-label="Edit"]').click();
  await page.waitForTimeout(500);
  check(`${c.singular}: edit form prefilled`,
    (await dialog().locator(`#f-${c.nameField}`).inputValue()) === value);
  await dialog().locator(`#f-${c.nameField}`).fill(value + ' v2');
  await page.locator('button:has-text("Save changes")').click();
  await page.waitForTimeout(1300);
  check(`${c.singular}: edit saved`, (await page.locator('tbody').textContent()).includes(value + ' v2'));

  // delete / archive
  const label = c.archivable ? 'Archive' : 'Delete';
  await page.locator('tbody tr', { hasText: value + ' v2' }).first()
    .locator(`button[aria-label="${label}"]`).click();
  await page.waitForTimeout(400);
  const confirmText = await dialog().textContent();
  check(`${c.singular}: confirmation is honest about ${label.toLowerCase()}`,
    c.archivable ? /hidden from lists/.test(confirmText) : /cannot be undone/.test(confirmText),
    confirmText.slice(0, 80));
  await dialog().locator(`button:has-text("${label}")`).last().click();
  await page.waitForTimeout(1400);
  check(`${c.singular}: removed from list`,
    !(await page.locator('tbody').textContent()).includes(value));
}

/* ---------------------------------------------------------- follow-ups */
section('CRUD through the UI — Follow-up');
await go('/followups');
const fuName = `UI Followup ${stamp()}`;
await page.locator('button:has-text("New Follow-up")').first().click();
await page.waitForTimeout(350);
await dialog().locator('#f-title').fill(fuName);
await page.locator('button:has-text("Create follow-up")').click();
await page.waitForTimeout(1300);
check('Follow-up: created', (await page.locator('body').textContent()).includes(fuName));

const card = page.locator('div.rounded-xl', { hasText: fuName }).first();
await card.locator('button:has-text("Log contact")').click();
await page.waitForTimeout(1300);
check('Follow-up: log contact persisted', !(await page.locator('body').textContent()).includes('Something went wrong'));
await page.locator('div.rounded-xl', { hasText: fuName }).first().locator('button:has-text("Received")').click();
await page.waitForTimeout(1300);
check('Follow-up: marked received', await page.locator('div.rounded-xl', { hasText: fuName }).first()
  .locator('text=Received').count() > 0);
await page.locator('div.rounded-xl', { hasText: fuName }).first().locator('button[aria-label="Delete"]').click();
await page.waitForTimeout(400);
await dialog().locator('button:has-text("Delete")').last().click();
await page.waitForTimeout(1300);
check('Follow-up: deleted', !(await page.locator('body').textContent()).includes(fuName));

/* ---------------------------------------------------------- validation */
section('Validation — required fields');
await go('/tasks');
await page.locator('button:has-text("New Task")').first().click();
await page.waitForTimeout(350);
await page.locator('button:has-text("Create task")').click();
await page.waitForTimeout(600);
check('blank title blocks submit', (await dialog().count()) > 0);
check('summary names the problem', (await dialog().textContent()).includes('Title is required'));
check('field shows inline error', await dialog().locator('#f-title-error').count() > 0);
check('field marked invalid for a11y',
  (await dialog().locator('#f-title').getAttribute('aria-invalid')) === 'true');
const focused = await page.evaluate(() => document.activeElement?.id);
check('focus moves to the offending field', focused === 'f-title', `focus on ${focused}`);

section('Validation — errors clear as you fix them');
await dialog().locator('#f-title').fill('Now it has a title');
await page.waitForTimeout(350);
check('inline error disappears', await dialog().locator('#f-title-error').count() === 0);
check('summary disappears', !(await dialog().textContent()).includes('Title is required'));

section('Validation — conditional requirement');
await dialog().locator('#f-status').selectOption('BLOCKED');
await page.waitForTimeout(400);
check('blocked reason field appears', await dialog().locator('#f-blocked_reason').count() > 0);
await page.locator('button:has-text("Create task")').click();
await page.waitForTimeout(600);
check('blocked without a reason is refused', (await dialog().count()) > 0);
check('and it says why', (await dialog().textContent()).includes('Blocked reason is required'));
await dialog().locator('#f-blocked_reason').fill('Waiting on the network team');
await page.waitForTimeout(300);
await dialog().locator('#f-status').selectOption('PENDING');
await page.waitForTimeout(300);

section('Validation — implausible date');
await dialog().locator('#f-due_date').fill('1899-01-01');
await dialog().locator('#f-due_date').blur();
await page.waitForTimeout(400);
check('bad year flagged', (await dialog().textContent()).includes('Check the year'));
await dialog().locator('#f-due_date').fill('2026-12-01');
await page.waitForTimeout(350);
check('bad year clears', !(await dialog().textContent()).includes('Check the year'));

section('Unsaved-changes guard');
await dialog().locator('button[aria-label="Close"]').click();
await page.waitForTimeout(400);
check('closing a dirty form asks first', (await dialog().textContent()).includes('Discard your changes'));
await page.locator('button:has-text("Keep editing")').click();
await page.waitForTimeout(400);
check('"Keep editing" returns to the form', await dialog().locator('#f-title').count() > 0);
check('the typed value survived', (await dialog().locator('#f-title').inputValue()) === 'Now it has a title');
await dialog().locator('button[aria-label="Close"]').click();
await page.waitForTimeout(300);
await page.locator('button:has-text("Discard changes")').click();
await page.waitForTimeout(500);
check('"Discard" closes the form', await dialog().count() === 0);

section('Validation — email format');
await go('/people');
await page.locator('button:has-text("New Person")').first().click();
await page.waitForTimeout(350);
await dialog().locator('#f-name').fill('Email Probe ' + stamp());
await dialog().locator('#f-email').fill('not-an-email');
await dialog().locator('#f-email').blur();
await page.waitForTimeout(400);
check('bad email flagged on blur', (await dialog().textContent()).includes('valid email address'));
await dialog().locator('#f-email').fill('someone@company.com');
await page.waitForTimeout(350);
check('valid email clears the error', !(await dialog().textContent()).includes('valid email address'));
await dialog().locator('button[aria-label="Close"]').click();
await page.waitForTimeout(300);
if (await page.locator('button:has-text("Discard changes")').count())
  await page.locator('button:has-text("Discard changes")').click();
await page.waitForTimeout(400);

section('Validation — server rejection surfaces in the form');
await go('/departments');
const firstDept = (await page.locator('tbody tr td').first().textContent())?.trim();
await page.locator('button:has-text("New Department")').first().click();
await page.waitForTimeout(350);
await dialog().locator('#f-name').fill(firstDept);
await page.locator('button:has-text("Create department")').click();
await page.waitForTimeout(1500);
check('duplicate name keeps the form open', (await dialog().count()) > 0);
const dupText = await dialog().textContent();
check('duplicate explained in plain words', /already exists/i.test(dupText), dupText.slice(0, 120));
check('duplicate mentions archived records', /archived/i.test(dupText));
await dialog().locator('button[aria-label="Close"]').click();
await page.waitForTimeout(300);
if (await page.locator('button:has-text("Discard changes")').count())
  await page.locator('button:has-text("Discard changes")').click();

section('Archive and restore');
await go('/vendors');
const vName = `Archive Probe ${stamp()}`;
await page.locator('button:has-text("New Vendor")').first().click();
await page.waitForTimeout(350);
await dialog().locator('#f-name').fill(vName);
await page.locator('button:has-text("Create vendor")').click();
await page.waitForTimeout(1300);
await page.locator('tbody tr', { hasText: vName }).first().locator('button[aria-label="Archive"]').click();
await page.waitForTimeout(400);
await dialog().locator('button:has-text("Archive")').last().click();
await page.waitForTimeout(1400);
check('archived row leaves the list', !(await page.locator('tbody').textContent()).includes(vName));
await page.locator('input[type="checkbox"]').first().check();
await page.waitForTimeout(1400);
check('"Show archived" reveals it', (await page.locator('tbody').textContent()).includes(vName));
await page.locator('tbody tr', { hasText: vName }).first().locator('button[aria-label="Restore"]').click();
await page.waitForTimeout(1400);
check('restore brings it back', (await page.locator('tbody tr', { hasText: vName }).count()) > 0);
await page.locator('input[type="checkbox"]').first().uncheck();
await page.waitForTimeout(1300);
check('restored row is in the normal list', (await page.locator('tbody').textContent()).includes(vName));
await page.locator('tbody tr', { hasText: vName }).first().locator('button[aria-label="Archive"]').click();
await page.waitForTimeout(400);
await dialog().locator('button:has-text("Archive")').last().click();
await page.waitForTimeout(1200);

section('Relations populate from lookups');
await go('/tasks');
await page.locator('button:has-text("New Task")').first().click();
await page.waitForTimeout(700);
for (const [id, label] of [['f-project_id','Project'],['f-system_id','System'],
  ['f-department_id','Department'],['f-vendor_id','Vendor'],
  ['f-responsible_person_id','Responsible person'],['f-category_id','Category']]) {
  const n = (await comboLabels(id)).length;
  check(`${label} picker is populated`, n > 0, `${n} options`);
}
check('relation pickers are searchable',
  await dialog().locator('#f-responsible_person_id').getAttribute('role') === 'combobox');
await dialog().locator('button[aria-label="Close"]').click();
await page.waitForTimeout(400);

section('Task workflow end to end');
await go('/tasks');
const tName = `Workflow ${stamp()}`;
await page.locator('button:has-text("New Task")').first().click();
await page.waitForTimeout(400);
await dialog().locator('#f-title').fill(tName);
await dialog().locator('#f-priority').selectOption('P0_CRITICAL');
await dialog().locator('#f-due_date').fill('2020-01-01');
const projOpts = (await comboLabels('f-project_id')).length;
if (projOpts > 0) await comboPick('f-project_id', { index: 0 });
await page.locator('button:has-text("Create task")').click();
await page.waitForTimeout(1400);
const wfRow = page.locator('tbody tr', { hasText: tName }).first();
check('task created with relations', await wfRow.count() > 0);
check('overdue date is highlighted', await wfRow.locator('.text-red-600').count() > 0);
check('priority badge shows P0', (await wfRow.textContent()).includes('P0'));
await wfRow.locator('select').selectOption('IN_PROGRESS');
await page.waitForTimeout(1300);
await go('/tasks');
check('inline status change persisted',
  (await page.locator('tbody tr', { hasText: tName }).first().locator('select').inputValue()) === 'IN_PROGRESS');
await go('/');
check('dashboard counts the new critical task',
  /Critical/.test(await page.locator('body').textContent()));
await go('/alerts');
check('alerts pick it up', (await page.locator('body').textContent()).includes(tName));
await go('/search');
await page.locator('input').first().fill(tName.split(' ')[1]);
await page.locator('button:has-text("Search")').click();
await page.waitForTimeout(1400);
check('search finds it', (await page.locator('body').textContent()).includes(tName));
await go('/tasks');
await page.locator('tbody tr', { hasText: tName }).first().locator('button[aria-label="Delete"]').click();
await page.waitForTimeout(400);
await dialog().locator('button:has-text("Delete")').last().click();
await page.waitForTimeout(1300);
check('cleanup deleted', !(await page.locator('tbody').textContent()).includes(tName));

section('Filters');
await go('/tasks');
await page.locator('#f-filter-status').selectOption('COMPLETED');
await page.waitForTimeout(1200);
check('status filter hits the URL', page.url().includes('status=COMPLETED'));
const rows = await page.locator('tbody tr').count();
if (rows) {
  const vals = await page.locator('tbody tr select').evaluateAll(els => els.map(e => e.value));
  check('only matching rows shown', vals.every(v => v === 'COMPLETED'), vals.join(','));
} else check('only matching rows shown', true, '(none completed)');
await page.locator('#f-filter-priority').selectOption('P0_CRITICAL');
await page.waitForTimeout(1100);
check('two filters combine in URL',
  page.url().includes('status=COMPLETED') && page.url().includes('priority=P0_CRITICAL'));
await page.locator('button:has-text("Clear")').click();
await page.waitForTimeout(1100);
check('clear resets everything', !page.url().includes('status=') && !page.url().includes('priority='));
await page.locator('input[placeholder="Filter by title…"]').fill('zzzznope');
await page.waitForTimeout(700);
check('no-match shows a helpful empty state',
  (await page.locator('body').textContent()).includes('No tasks match these filters'));

section('Dashboard drill-downs');
for (const [label, expect] of [
  ['In progress', 'status=IN_PROGRESS'], ['Blocked', 'status=BLOCKED'],
  ['Critical', 'priority=P0_CRITICAL'], ['Follow-ups due', '/followups'],
]) {
  await go('/');
  await page.locator(`button:has-text("${label}")`).first().click();
  await page.waitForTimeout(900);
  check(`"${label}" tile drills through`, page.url().includes(expect), page.url());
}
await go('/');
await page.locator('button:has-text("New Task")').first().click();
await page.waitForTimeout(1200);
check('dashboard "New Task" opens the form', (await dialog().count()) > 0);

section('Navigation and routing');
await go('/tasks');
const activeCount = await page.locator('a.bg-blue-50').count();
check('exactly one sidebar item is active', activeCount === 1, `${activeCount} active`);
await go('/tasks?status=INBOX');
const inboxActive = await page.locator('a.bg-blue-50:has-text("Inbox")').count();
check('Inbox highlights on its own filter', inboxActive === 1);
await go('/no-such-page');
check('unknown route falls back to dashboard',
  (await page.locator('h1').first().textContent())?.trim() === 'Dashboard');

section('Keyboard and accessibility');
await go('/tasks');
await page.locator('button:has-text("New Task")').first().click();
await page.waitForTimeout(400);
await page.keyboard.press('Escape');
await page.waitForTimeout(400);
check('Escape closes a clean form', await dialog().count() === 0);
await page.locator('button:has-text("New Task")').first().click();
await page.waitForTimeout(400);
await dialog().locator('#f-title').fill('typed');
await page.keyboard.press('Escape');
await page.waitForTimeout(400);
check('Escape on a dirty form asks first', (await dialog().textContent()).includes('Discard your changes'));
await page.locator('button:has-text("Discard changes")').click();
await page.waitForTimeout(400);
check('required fields carry a visible marker',
  await page.locator('button:has-text("New Task")').first().click()
    .then(() => page.waitForTimeout(400))
    .then(() => dialog().locator('label:has-text("Title") span[aria-label="required"]').count()) > 0);
await page.keyboard.press('Escape');
await page.waitForTimeout(300);

section('Responsive layout');
await page.setViewportSize({ width: 390, height: 844 });
await go('/tasks');
check('mobile: sidebar collapses', await page.locator('aside.-translate-x-full').count() === 1);
check('mobile: menu button appears', await page.locator('button[aria-label="Open menu"]').isVisible());
await page.locator('button[aria-label="Open menu"]').click();
await page.waitForTimeout(500);
check('mobile: menu opens', await page.locator('aside.translate-x-0').count() === 1);
await page.locator('a:has-text("Vendors")').first().click();
await page.waitForTimeout(900);
check('mobile: navigation works and closes the menu', page.url().endsWith('/vendors'));
const scrollX = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
check('mobile: no horizontal page scroll', !scrollX);
await page.setViewportSize({ width: 1440, height: 950 });

section('DOM integrity');
await go('/tasks');
await page.locator('button:has-text("New Task")').first().click();
await page.waitForTimeout(500);
const dupIds = await page.evaluate(() => {
  const seen = {}, dupes = [];
  document.querySelectorAll('[id]').forEach(el => {
    if (seen[el.id]) dupes.push(el.id); else seen[el.id] = 1;
  });
  return [...new Set(dupes)];
});
check('no duplicate element ids with a form open', dupIds.length === 0, dupIds.join(', '));
await page.keyboard.press('Escape');
await page.waitForTimeout(300);
if (await page.locator('button:has-text("Discard changes")').count())
  await page.locator('button:has-text("Discard changes")').click();
await page.waitForTimeout(300);

section('Console health');
const real = errors.filter(e => !/favicon|React DevTools|Failed to load resource.*40[49]/i.test(e));
check('no uncaught console errors', real.length === 0, real.slice(0, 3).join(' | '));

console.log(`\n${'='.repeat(52)}\n  ${B}${pass} passed, ${fail} failed${X}\n${'='.repeat(52)}`);
if (failures.length) { console.log('Failed:'); failures.forEach(f => console.log('  -', f)); }
await browser.close();
process.exit(fail ? 1 : 0);
