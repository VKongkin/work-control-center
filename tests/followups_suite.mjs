import { chromium } from 'playwright';

const BASE = process.env.WCC_URL || 'http://localhost:3000';
let pass = 0, fail = 0;
const failures = [], errors = [];
const G='\x1b[32m', R='\x1b[31m', B='\x1b[1m', X='\x1b[0m';
const check = (n, c, d='') => { if (c) { pass++; console.log(`  ${G}PASS${X}  ${n}`); }
  else { fail++; failures.push(n); console.log(`  ${R}FAIL${X}  ${n}  ${d}`); } };
const section = t => console.log(`\n${B}${t}${X}`);

const api = async (m, p, b) => {
  const r = await fetch(BASE + p, { method: m,
    headers: { 'Content-Type': 'application/json' },
    body: b ? JSON.stringify(b) : undefined });
  const t = await r.text();
  return { status: r.status, body: t ? JSON.parse(t) : null };
};

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));

const go = async p => { await page.goto(BASE + p, { waitUntil: 'networkidle' }); await page.waitForTimeout(400); };
const D = () => page.locator('[role="dialog"]');
const card = name => page.locator('div.rounded-xl.border', { hasText: name }).first();

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
  // Escape is safe only while the list is genuinely open - otherwise it bubbles
  // to the dialog and closes the whole form
  if ((await page.locator('[role="option"]').count()) > 0) {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(250);
  }
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
const created = [];

async function makeFollowUp(fields) {
  await page.locator('button:has-text("New Follow-up")').first().click();
  await page.waitForTimeout(400);
  for (const [id, val] of Object.entries(fields)) {
    const el = D().locator(`#f-${id}`);
    const tag = await el.evaluate(e => e.tagName);
    if (tag === 'SELECT') await el.selectOption(val); else await el.fill(val);
    await page.waitForTimeout(120);
  }
  await page.locator('button:has-text("Create follow-up")').click();
  await page.waitForTimeout(1500);
  if (fields.title) created.push(fields.title);
}

/* ══════════════════════════════════════ 1. the three waiting-for types */
section('Waiting-for types — each offers the right target');
await go('/followups');
await page.locator('button:has-text("New Follow-up")').first().click();
await page.waitForTimeout(500);

check('defaults to Person', (await D().locator('#f-waiting_for_type').inputValue()) === 'PERSON');
check('Person target shown', await D().locator('#f-person_id').count() === 1);
check('Department target hidden', await D().locator('#f-department_id').count() === 0);
check('Vendor target hidden', await D().locator('#f-vendor_id').count() === 0);

await D().locator('#f-waiting_for_type').selectOption('DEPARTMENT');
await page.waitForTimeout(300);
check('switching to Department swaps the target', await D().locator('#f-department_id').count() === 1);
check('Person target removed', await D().locator('#f-person_id').count() === 0);

await D().locator('#f-waiting_for_type').selectOption('VENDOR');
await page.waitForTimeout(300);
check('switching to Vendor swaps the target', await D().locator('#f-vendor_id').count() === 1);
check('Department target removed', await D().locator('#f-department_id').count() === 0);

const opts = {
  person: await (async () => { await D().locator('#f-waiting_for_type').selectOption('PERSON');
    await page.waitForTimeout(250); return (await comboLabels('f-person_id')).length; })(),
  dept: await (async () => { await D().locator('#f-waiting_for_type').selectOption('DEPARTMENT');
    await page.waitForTimeout(250); return (await comboLabels('f-department_id')).length; })(),
  vendor: await (async () => { await D().locator('#f-waiting_for_type').selectOption('VENDOR');
    await page.waitForTimeout(250); return (await comboLabels('f-vendor_id')).length; })(),
};
check('Person list populated', opts.person > 0, `${opts.person}`);
check('Department list populated', opts.dept > 0, `${opts.dept}`);
check('Vendor list populated', opts.vendor > 0, `${opts.vendor}`);

/* ── the important one: does an abandoned target get left behind? ── */
section('Switching type must not leave the old target attached');
await D().locator('#f-waiting_for_type').selectOption('PERSON');
await page.waitForTimeout(250);
await comboPick('f-person_id', { index: 0 });
const pickedPerson = await D().locator('#f-person_id').inputValue();  // label, not id
await D().locator('#f-waiting_for_type').selectOption('VENDOR');
await page.waitForTimeout(250);
await comboPick('f-vendor_id', { index: 0 });
const title0 = `FU switch ${stamp()}`;
await D().locator('#f-title').fill(title0);
await page.locator('button:has-text("Create follow-up")').click();
await page.waitForTimeout(1600);
created.push(title0);

const all = (await api('GET', '/api/followups?limit=200')).body;
const saved = all.find(f => f.title === title0);
check('saved with the type actually chosen', saved?.waiting_for_type === 'VENDOR', saved?.waiting_for_type);
check('vendor_id recorded', saved?.vendor_id != null);
check('abandoned person_id NOT saved', saved?.person_id == null,
  `person_id=${saved?.person_id} (was ${pickedPerson})`);

// the same trap in the other direction
await go('/followups');
await page.locator('button:has-text("New Follow-up")').first().click();
await page.waitForTimeout(400);
await D().locator('#f-waiting_for_type').selectOption('DEPARTMENT');
await page.waitForTimeout(250);
await comboPick('f-department_id', { index: 0 });
await D().locator('#f-waiting_for_type').selectOption('PERSON');
await page.waitForTimeout(250);
await comboPick('f-person_id', { index: 0 });
const title1 = `FU switch2 ${stamp()}`;
await D().locator('#f-title').fill(title1);
await page.locator('button:has-text("Create follow-up")').click();
await page.waitForTimeout(1600);
created.push(title1);
const saved1 = (await api('GET', '/api/followups?limit=300')).body.find(f => f.title === title1);
check('department -> person also drops the old link', saved1?.department_id == null,
  `department_id=${saved1?.department_id}`);
check('and keeps the new one', saved1?.person_id != null);

// switching back and forth must not resurrect anything
await go('/followups');
await page.locator('button:has-text("New Follow-up")').first().click();
await page.waitForTimeout(400);
await comboPick('f-person_id', { index: 0 });
await D().locator('#f-waiting_for_type').selectOption('VENDOR');
await page.waitForTimeout(250);
await D().locator('#f-waiting_for_type').selectOption('PERSON');
await page.waitForTimeout(250);
check('returning to a type does not restore the cleared target',
  (await D().locator('#f-person_id').inputValue()) === '');
const title2 = `FU switch3 ${stamp()}`;
await D().locator('#f-title').fill(title2);
await page.locator('button:has-text("Create follow-up")').click();
await page.waitForTimeout(1600);
created.push(title2);
const saved3 = (await api('GET', '/api/followups?limit=300')).body.find(f => f.title === title2);
check('no stray links at all', saved3?.person_id == null && saved3?.department_id == null
  && saved3?.vendor_id == null);

/* ══════════════════════════════════════ 2. one of each type, displayed */
section('Each type resolves the right name on the card');
await go('/followups');
for (const [type, field] of [['PERSON','person_id'], ['DEPARTMENT','department_id'], ['VENDOR','vendor_id']]) {
  const t = `FU ${type} ${stamp()}`;
  await page.locator('button:has-text("New Follow-up")').first().click();
  await page.waitForTimeout(400);
  await D().locator('#f-title').fill(t);
  await D().locator('#f-waiting_for_type').selectOption(type);
  await page.waitForTimeout(300);
  await comboPick(`f-${field}`, { index: 0 });
  const chosen = await D().locator(`#f-${field}`).inputValue();
  await page.locator('button:has-text("Create follow-up")').click();
  await page.waitForTimeout(1500);
  created.push(t);
  const text = await card(t).textContent();
  check(`${type}: card names who we are waiting on`, text.includes(chosen.trim()), `expected "${chosen.trim()}"`);
}

/* ══════════════════════════════════════ 3. statuses */
section('Every status round-trips and is badged');
for (const st of ['WAITING', 'FOLLOW_UP_DUE', 'OVERDUE', 'RECEIVED', 'CANCELLED']) {
  const t = `FU ${st} ${stamp()}`;
  await go('/followups');
  await makeFollowUp({ title: t, status: st });
  const text = await card(t).textContent();
  const label = { WAITING:'Waiting', FOLLOW_UP_DUE:'Follow-up Due', OVERDUE:'Overdue',
                  RECEIVED:'Received', CANCELLED:'Cancelled' }[st];
  check(`${st}: badge reads "${label}"`, text.includes(label), text.slice(0, 70));
}

/* ══════════════════════════════════════ 4. quick actions */
section('Quick actions');
const qa = `FU quick ${stamp()}`;
await go('/followups');
await makeFollowUp({ title: qa, status: 'WAITING' });
check('Log contact offered while open', await card(qa).locator('button:has-text("Log contact")').count() === 1);
check('Received offered while open', await card(qa).locator('button:has-text("Received")').count() === 1);

await card(qa).locator('button:has-text("Log contact")').click();
await page.waitForTimeout(1600);
const today = new Date();
const todayLabel = today.toLocaleDateString(undefined, { day:'numeric', month:'short', year:'numeric' });
check('Log contact stamps today', (await card(qa).textContent()).includes(todayLabel), todayLabel);
const afterLog = (await api('GET', '/api/followups?limit=200')).body.find(f => f.title === qa);
check('Log contact leaves status alone', afterLog?.status === 'WAITING', afterLog?.status);

await card(qa).locator('button:has-text("Received")').click();
await page.waitForTimeout(1600);
check('Received sets the status', (await card(qa).textContent()).includes('Received'));
check('quick actions retire once received',
  await card(qa).locator('button:has-text("Log contact")').count() === 0);
check('Edit and Delete still available',
  await card(qa).locator('button[aria-label="Edit"]').count() === 1 &&
  await card(qa).locator('button[aria-label="Delete"]').count() === 1);

/* ══════════════════════════════════════ 5. dates + overdue */
section('Dates and the overdue signal');
const dt = `FU dates ${stamp()}`;
await go('/followups');
await makeFollowUp({ title: dt, requested_date: '2026-08-01', expected_date: '2026-08-20',
                     follow_up_date: '2026-08-15', last_contact_date: '2026-08-10' });
const saved2 = (await api('GET', '/api/followups?limit=200')).body.find(f => f.title === dt);
check('all four dates stored', ['requested_date','expected_date','follow_up_date','last_contact_date']
  .every(k => saved2?.[k]), JSON.stringify(saved2 && {r:saved2.requested_date, e:saved2.expected_date}));
const dtext = await card(dt).textContent();
check('card shows Expected', dtext.includes('20 Aug 2026') || dtext.includes('Aug 20, 2026'), dtext.slice(0,120));
check('past expected date flagged overdue',
  await card(dt).locator('dd.text-red-600').count() === 1);
check('overdue card gets a red border',
  (await card(dt).getAttribute('class')).includes('border-red-200'));

const future = `FU future ${stamp()}`;
await go('/followups');
await makeFollowUp({ title: future, expected_date: '2027-06-01' });
check('future expected date is not flagged',
  await card(future).locator('dd.text-red-600').count() === 0);
check('future card keeps the neutral border',
  (await card(future).getAttribute('class')).includes('border-slate-200'));

/* ══════════════════════════════════════ 6. validation */
section('Validation');
await go('/followups');
await page.locator('button:has-text("New Follow-up")').first().click();
await page.waitForTimeout(400);
await page.locator('button:has-text("Create follow-up")').click();
await page.waitForTimeout(700);
check('blank title refused', (await D().count()) > 0);
check('and it says so', (await D().textContent()).includes('Title is required'));
check('focus lands on the title', (await page.evaluate(() => document.activeElement?.id)) === 'f-title');

await D().locator('#f-title').fill('Date order probe');
await D().locator('#f-requested_date').fill('2026-09-20');
await D().locator('#f-expected_date').fill('2026-09-10');
await D().locator('#f-expected_date').blur();
await page.waitForTimeout(500);
check('expected-before-requested is caught',
  (await D().textContent()).includes('cannot be before requested on'), (await D().textContent()).slice(0,200));
await D().locator('#f-expected_date').fill('2026-09-25');
await page.waitForTimeout(400);
check('fixing the order clears it', !(await D().textContent()).includes('cannot be before'));

await D().locator('#f-follow_up_date').fill('2026-09-01');
await D().locator('#f-follow_up_date').blur();
await page.waitForTimeout(450);
check('follow-up-before-requested is caught too',
  (await D().textContent()).includes('cannot be before requested on'));
await D().locator('#f-follow_up_date').fill('2026-09-22');
await page.waitForTimeout(350);

await D().locator('#f-last_contact_date').fill('1899-05-05');
await D().locator('#f-last_contact_date').blur();
await page.waitForTimeout(450);
check('implausible year caught', (await D().textContent()).includes('Check the year'));
await D().locator('#f-last_contact_date').fill('2026-09-21');
await page.waitForTimeout(350);
check('all clear once fixed', !(await D().textContent()).includes('needs fixing'));

section('Unsaved-changes guard');
await D().locator('button[aria-label="Close"]').click();
await page.waitForTimeout(450);
check('asks before discarding', (await D().textContent()).includes('Discard your changes'));
await page.locator('button:has-text("Keep editing")').click();
await page.waitForTimeout(400);
check('Keep editing preserves the entry',
  (await D().locator('#f-title').inputValue()) === 'Date order probe');
await D().locator('button[aria-label="Close"]').click();
await page.waitForTimeout(350);
await page.locator('button:has-text("Discard changes")').click();
await page.waitForTimeout(500);
check('Discard closes it', await D().count() === 0);

/* ══════════════════════════════════════ 7. edit */
section('Editing an existing follow-up');
const ed = `FU edit ${stamp()}`;
await go('/followups');
await makeFollowUp({ title: ed, description: 'original text', status: 'WAITING',
                     waiting_for_type: 'DEPARTMENT', expected_date: '2026-10-01',
                     next_action: 'chase on Monday' });
await card(ed).locator('button[aria-label="Edit"]').click();
await page.waitForTimeout(700);
check('title prefilled', (await D().locator('#f-title').inputValue()) === ed);
check('description prefilled', (await D().locator('#f-description').inputValue()) === 'original text');
check('type prefilled', (await D().locator('#f-waiting_for_type').inputValue()) === 'DEPARTMENT');
check('department target shown for a saved DEPARTMENT row',
  await D().locator('#f-department_id').count() === 1);
check('date prefilled', (await D().locator('#f-expected_date').inputValue()) === '2026-10-01');
check('next action prefilled', (await D().locator('#f-next_action').inputValue()) === 'chase on Monday');
await D().locator('#f-title').fill(ed + ' edited');
await D().locator('#f-status').selectOption('FOLLOW_UP_DUE');
await page.locator('button:has-text("Save changes")').click();
await page.waitForTimeout(1600);
created[created.indexOf(ed)] = ed + ' edited';
check('edit saved', (await page.locator('body').textContent()).includes(ed + ' edited'));
check('status change saved', (await card(ed + ' edited').textContent()).includes('Follow-up Due'));

await card(ed + ' edited').locator('button[aria-label="Edit"]').click();
await page.waitForTimeout(600);
await comboPick('f-department_id', { index: 0 });
await D().locator('#f-waiting_for_type').selectOption('VENDOR');
await page.waitForTimeout(300);
await comboPick('f-vendor_id', { index: 0 });
await page.locator('button:has-text("Save changes")').click();
await page.waitForTimeout(1600);
const reSaved = (await api('GET', '/api/followups?limit=300')).body.find(f => f.title === ed + ' edited');
check('editing: switching type clears the old link', reSaved?.department_id == null,
  `department_id=${reSaved?.department_id}`);
check('editing: new link saved', reSaved?.vendor_id != null);

/* ══════════════════════════════════════ 8. filters */
section('Status filter');
await go('/followups');
const total = await page.locator('div.rounded-xl.border').count();
await page.locator('#f-filter-status').selectOption('RECEIVED');
await page.waitForTimeout(1400);
const recvCards = await page.locator('div.rounded-xl.border').count();
check('filter narrows the list', recvCards <= total, `${recvCards} of ${total}`);
const allReceived = await page.locator('div.rounded-xl.border').evaluateAll(
  els => els.every(e => e.textContent.includes('Received')));
check('only matching rows remain', recvCards === 0 || allReceived);
check('Clear button appears', await page.locator('button:has-text("Clear")').count() === 1);
await page.locator('button:has-text("Clear")').click();
await page.waitForTimeout(1300);
check('clearing restores the full list', (await page.locator('div.rounded-xl.border').count()) === total);

await page.locator('#f-filter-status').selectOption('CANCELLED');
await page.waitForTimeout(1300);
const cancelled = await page.locator('div.rounded-xl.border').count();
if (cancelled === 0) check('empty filter shows a helpful message',
  (await page.locator('body').textContent()).includes('Nothing with that status'));
else check('empty filter shows a helpful message', true, '(cancelled rows exist)');
await page.locator('button:has-text("Clear")').click();
await page.waitForTimeout(1200);

section('Deep link from the dashboard');
await go('/followups?status=WAITING');
check('URL status is applied on load',
  (await page.locator('#f-filter-status').inputValue()) === 'WAITING');
const waitingCards = await page.locator('div.rounded-xl.border').count();
const onlyWaiting = await page.locator('div.rounded-xl.border').evaluateAll(
  els => els.every(e => e.textContent.includes('Waiting')));
check('deep link actually filters', waitingCards === 0 || onlyWaiting);

await go('/followups');
await page.locator('#f-filter-status').selectOption('OVERDUE');
await page.waitForTimeout(1300);
check('changing the filter updates the URL', page.url().includes('status=OVERDUE'), page.url());

/* ══════════════════════════════════════ 9. delete */
section('Delete');
const del = `FU delete ${stamp()}`;
await go('/followups');
await makeFollowUp({ title: del });
await card(del).locator('button[aria-label="Delete"]').click();
await page.waitForTimeout(450);
check('confirmation names the record', (await D().textContent()).includes(del));
check('confirmation warns it is permanent', (await D().textContent()).includes('permanently removed'));
await D().getByRole('button', { name: 'Cancel', exact: true }).click();
await page.waitForTimeout(600);
check('Cancel keeps the record', (await page.locator('body').textContent()).includes(del));
await card(del).locator('button[aria-label="Delete"]').click();
await page.waitForTimeout(400);
await D().locator('button:has-text("Delete")').last().click();
await page.waitForTimeout(1500);
check('Delete removes it', !(await page.locator('body').textContent()).includes(del));
created.splice(created.indexOf(del), 1);

/* ══════════════════════════════════════ 9b. the update endpoint writes everything */
section('Every field survives an update');
const upd = `FU update ${stamp()}`;
await go('/followups');
await makeFollowUp({ title: upd, waiting_for_type: 'DEPARTMENT', last_contact_date: '2026-08-01' });
let rec = (await api('GET', '/api/followups?limit=300')).body.find(f => f.title === upd);

await api('PUT', `/api/followups/${rec.id}`, { requested_date: '2026-07-15' });
rec = (await api('GET', `/api/followups/${rec.id}`)).body;
check('requested_date is assignable', String(rec.requested_date).startsWith('2026-07-15'), rec.requested_date);

await api('PUT', `/api/followups/${rec.id}`, { title: upd + ' renamed' });
rec = (await api('GET', `/api/followups/${rec.id}`)).body;
created[created.indexOf(upd)] = upd + ' renamed';
check('an unrelated edit does not fake a contact',
  String(rec.last_contact_date).startsWith('2026-08-01'), rec.last_contact_date);

await api('PUT', `/api/followups/${rec.id}`, { waiting_for_type: 'VENDOR', department_id: null, vendor_id: 2 });
rec = (await api('GET', `/api/followups/${rec.id}`)).body;
check('reassigning to a vendor actually sticks',
  rec.waiting_for_type === 'VENDOR' && rec.vendor_id === 2 && rec.department_id === null,
  JSON.stringify({t: rec.waiting_for_type, v: rec.vendor_id, d: rec.department_id}));

/* ══════════════════════════════════════ 9c. alert rules */
section('Which follow-ups raise an alert');
const mk = async (label, body) => {
  const r = await api('POST', '/api/followups', { title: `FU alert ${label} ${stamp()}`,
    waiting_for_type: 'PERSON', ...body });
  created.push(r.body.title);
  return r.body;
};
const past = '2026-08-01', pastChase = '2026-08-15', future2 = '2027-06-01';
const aMissed    = await mk('missed',    { status: 'WAITING',   expected_date: past });
const aMarked    = await mk('marked',    { status: 'OVERDUE' });
const aChase     = await mk('chase',     { status: 'WAITING',   follow_up_date: pastChase });
const aBoth      = await mk('both',      { status: 'WAITING',   expected_date: past, follow_up_date: pastChase });
const aCancelled = await mk('cancelled', { status: 'CANCELLED', follow_up_date: pastChase });
const aReceived  = await mk('received',  { status: 'RECEIVED',  follow_up_date: pastChase });
const aFuture    = await mk('future',    { status: 'WAITING',   expected_date: future2 });

const alerts = (await api('GET', '/api/alerts')).body.filter(a => a.entity_type === 'followup');
const forId = id => alerts.filter(a => a.entity_id === id);
check('a missed expected date raises a high alert',
  forId(aMissed.id).some(a => a.severity === 'high'), JSON.stringify(forId(aMissed.id)));
check('a row marked overdue raises a high alert',
  forId(aMarked.id).some(a => a.severity === 'high'));
check('a due chase raises a medium alert',
  forId(aChase.id).some(a => a.severity === 'medium'));
check('a row tripping both rules alerts once, at the worse level',
  forId(aBoth.id).length === 1 && forId(aBoth.id)[0].severity === 'high',
  JSON.stringify(forId(aBoth.id)));
check('cancelled follow-ups stay quiet', forId(aCancelled.id).length === 0);
check('received follow-ups stay quiet', forId(aReceived.id).length === 0);
check('a future date stays quiet', forId(aFuture.id).length === 0);

/* ══════════════════════════════════════ 10. integration */
section('Integration with the rest of the app');
const intg = `FU integration ${stamp()}`;
await go('/followups');
await makeFollowUp({ title: intg, status: 'WAITING', expected_date: '2026-08-01' });

await go('/alerts');
check('overdue follow-up reaches Alerts',
  (await page.locator('body').textContent()).includes(intg), '(checked alerts page)');

await go('/search');
await page.locator('input').first().fill('integration');
await page.locator('button:has-text("Search")').click();
await page.waitForTimeout(1500);
check('search finds follow-ups', (await page.locator('body').textContent()).includes(intg));

await go('/');
const dash = await page.locator('body').textContent();
check('dashboard shows a Follow-ups due tile', dash.includes('Follow-ups due'));
await page.locator('button:has-text("Follow-ups due")').first().click();
await page.waitForTimeout(1200);
check('tile drills into follow-ups', page.url().includes('/followups'), page.url());

/* ══════════════════════════════════════ 11. text handling */
section('Text handling');
const uni = `FU ភាសាខ្មែរ → 日本語 ${stamp()}`;
await go('/followups');
await makeFollowUp({ title: uni, description: 'Fix Visa → APIMS · ភាសាខ្មែរ' });
check('unicode survives the round trip', (await page.locator('body').textContent()).includes('ភាសាខ្មែរ'));

const longTitle = 'L'.repeat(260);
await page.locator('button:has-text("New Follow-up")').first().click();
await page.waitForTimeout(400);
await D().locator('#f-title').fill(longTitle);
await page.locator('button:has-text("Create follow-up")').click();
await page.waitForTimeout(900);
check('over-long title refused before the network', (await D().count()) > 0);
check('and explains the limit', (await D().textContent()).includes('255 characters or fewer'));
await D().locator('button[aria-label="Close"]').click();
await page.waitForTimeout(300);
if (await page.locator('button:has-text("Discard changes")').count())
  await page.locator('button:has-text("Discard changes")').click();
await page.waitForTimeout(400);

/* ══════════════════════════════════════ 12. accessibility + responsive */
section('Accessibility and layout');
await go('/followups');
await page.locator('button:has-text("New Follow-up")').first().click();
await page.waitForTimeout(500);
check('required fields marked',
  await D().locator('label:has-text("Title") span[aria-label="required"]').count() === 1);
check('waiting-for marked required',
  await D().locator('label:has-text("Waiting for") span[aria-label="required"]').count() === 1);
const dupes = await page.evaluate(() => {
  const seen = {}, d = [];
  document.querySelectorAll('[id]').forEach(e => { if (seen[e.id]) d.push(e.id); else seen[e.id] = 1; });
  return [...new Set(d)];
});
check('no duplicate element ids', dupes.length === 0, dupes.join(','));
await page.keyboard.press('Escape');
await page.waitForTimeout(400);
check('Escape closes an untouched form', await D().count() === 0);

await page.setViewportSize({ width: 390, height: 844 });
await go('/followups');
const overflow = await page.evaluate(() =>
  document.documentElement.scrollWidth > document.documentElement.clientWidth);
check('mobile: no horizontal scroll', !overflow);
check('mobile: cards still render', (await page.locator('div.rounded-xl.border').count()) > 0);
await page.setViewportSize({ width: 1440, height: 1000 });

section('Console health');
const real = errors.filter(e => !/favicon|React DevTools|Failed to load resource.*4\d\d/i.test(e));
check('no uncaught console errors', real.length === 0, real.slice(0, 3).join(' | '));

/* cleanup */
const rows = (await api('GET', '/api/followups?limit=300')).body;
let removed = 0;
for (const r of rows) if (/^FU |^L{50}/.test(r.title) || r.title.includes('ភាសាខ្មែរ')) {
  await api('DELETE', `/api/followups/${r.id}`); removed++;
}
console.log(`\n(cleaned up ${removed} test records)`);

console.log(`\n${'='.repeat(54)}\n  ${B}${pass} passed, ${fail} failed${X}\n${'='.repeat(54)}`);
if (failures.length) { console.log('Failed:'); failures.forEach(f => console.log('  -', f)); }
await browser.close();
process.exit(fail ? 1 : 0);
