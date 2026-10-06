/**
 * The day plan, through the browser.
 *
 * `plan_suite.py` proves the arithmetic. This asks the other question: can you
 * actually run a day from this page - start it from the diary, block out a
 * task, tick things off, and take the result somewhere else - and does what is
 * on screen agree with what the server computed.
 *
 *   WCC_URL=http://localhost:4173 CHROMIUM_PATH=... node tests/plan_ui_suite.mjs
 */
import { chromium } from 'playwright';

const B = process.env.WCC_URL || 'http://localhost:3000';
let pass = 0, fail = 0; const failures = [], errors = [];
const G = '\x1b[32m', R = '\x1b[31m', BD = '\x1b[1m', X = '\x1b[0m';
const check = (n, c, d = '') => c ? (pass++, console.log(`  ${G}PASS${X}  ${n}`))
  : (fail++, failures.push(n), console.log(`  ${R}FAIL${X}  ${n}  ${d}`));
const section = t => console.log(`\n${BD}${t}${X}`);

const b = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const ctx = await b.newContext({
  viewport: { width: 1440, height: 1100 },
  permissions: ['clipboard-read', 'clipboard-write'],
});
const p = await ctx.newPage();
p.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
p.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));

const D = () => p.locator('[role="dialog"]');
const go = async x => { await p.goto(B + x, { waitUntil: 'networkidle' }); await p.waitForTimeout(500); };
const api = async (m, u, bo) => {
  const r = await fetch(B + u, {
    method: m, headers: { 'Content-Type': 'application/json' },
    body: bo ? JSON.stringify(bo) : undefined,
  });
  const t = await r.text();
  return t ? JSON.parse(t) : null;
};
const stamp = String(Date.now()).slice(-6);

// A day far enough out that a real diary will not collide with the fixtures.
const DAY = new Date(Date.now() + 86400000 * (400 + (Number(stamp) % 120)))
  .toISOString().slice(0, 10);
const cleanup = { plans: [], tasks: [], meetings: [] };

/* ═════════════════════════════ starting a day ════════════════════════════ */
section('Starting a day that already has meetings in it');

const meeting = await api('POST', '/api/meetings', {
  title: `Vendor sync ${stamp}`,
  meeting_date: `${DAY}T09:30:00`, ends_at: `${DAY}T10:30:00`,
});
cleanup.meetings.push(meeting.id);

await go('/plan');
check('the Day plan has its own place in the sidebar',
  await p.locator('a[href="/plan"]').count() === 1);
await p.locator('#plan-date').fill(DAY);
await p.waitForTimeout(900);
check('a day with no plan says so rather than showing an empty grid',
  (await p.locator('body').textContent()).includes('Nothing planned for'),
  (await p.locator('body').textContent()).slice(0, 200));

await p.locator('#start-day').click();
await p.waitForTimeout(1600);
const plan = await api('GET', `/api/plans/day/${DAY}`);
cleanup.plans.push(plan.id);

let body = await p.locator('body').textContent();
check('starting the day brings the diary in', body.includes(`Vendor sync ${stamp}`), body.slice(0, 300));
check('and says it came from the diary', body.includes('from your diary'));
check('lunch is there without being asked', body.includes('Lunch'));
check('the day says how much is still unplanned',
  /unplanned/.test(await p.locator('[data-day-span]').textContent()),
  await p.locator('[data-day-span]').textContent());

/* ══════════════════════════════ filling it in ════════════════════════════ */
section('Blocking out the morning');

await p.locator('#add-block').click();
await p.waitForTimeout(600);
await D().locator('#f-block-start').fill('10:45');
await D().locator('#f-block-end').fill('12:15');
await D().locator('#f-block-title').fill(`VDA go-live planning ${stamp}`);
await D().locator('#f-block-activity').fill('Readiness checklist, endpoints, rollback plan.');
await D().locator('#f-block-theme').fill('VDA go-live');
await p.locator('button:has-text("Add")').last().click();
await p.waitForTimeout(1400);

body = await p.locator('body').textContent();
check('the block appears without a page refresh', body.includes(`VDA go-live planning ${stamp}`));
check('its activity is shown, not just its title',
  body.includes('Readiness checklist, endpoints, rollback plan.'));
check('the breakdown picks the theme up',
  (await p.locator('[data-breakdown]').textContent()).includes('VDA go-live'),
  await p.locator('[data-breakdown]').textContent());
check('and counts it as an hour and a half',
  (await p.locator('[data-slice="VDA go-live"]').textContent()).includes('1.5h'),
  await p.locator('[data-slice="VDA go-live"]').textContent());

// What the server computed and what the page shows must be the same number.
const after = await api('GET', `/api/plans/day/${DAY}`);
check('the page agrees with the server about the work planned',
  (await p.locator('[data-day-span]').textContent()).includes(
    after.work_minutes % 60 === 0 ? `${after.work_minutes / 60}h` : `${Math.floor(after.work_minutes / 60)}h`),
  `${await p.locator('[data-day-span]').textContent()} vs ${after.work_minutes}m`);

/* ═════════════════════════════ a double booking ══════════════════════════ */
section('Two things at the same time');

await p.locator('#add-block').click();
await p.waitForTimeout(600);
await D().locator('#f-block-start').fill('10:00');
await D().locator('#f-block-end').fill('11:00');
await D().locator('#f-block-title').fill(`Clashing call ${stamp}`);
await p.locator('button:has-text("Add")').last().click();
await p.waitForTimeout(1400);

check('a double booking is shown rather than silently accepted',
  await p.locator('[data-clashes]').count() === 1,
  await p.locator('body').textContent());
check('and names both blocks and the overlap',
  /share/.test(await p.locator('[data-clashes]').textContent()),
  await p.locator('[data-clashes]').textContent());

const clash = (await api('GET', `/api/plans/day/${DAY}`))
  .blocks.find(x => x.title.startsWith('Clashing call'));
await api('DELETE', `/api/plans/blocks/${clash.id}`);
await go('/plan');
await p.locator('#plan-date').fill(DAY);
await p.waitForTimeout(1000);
// Not "no clashes at all": the 10:45-12:15 block really does run into the
// seeded 12:00 lunch, and the page is right to keep saying so. What has to
// disappear is the one that was removed.
const stillSaid = await p.locator('[data-clashes]').count()
  ? await p.locator('[data-clashes]').textContent() : '';
check('removing it clears that warning', !stillSaid.includes(`Clashing call ${stamp}`), stillSaid);
check('while a real overlap with lunch is still reported',
  stillSaid.includes('Lunch'), stillSaid || '(no clashes box)');

/* ═══════════════════════════════ from a task ═════════════════════════════ */
section('Blocking out a task you already have');

const task = await api('POST', '/api/tasks', {
  title: `Review MQ channel status ${stamp}`, priority: 'P0_CRITICAL',
  status: 'IN_PROGRESS', next_action: 'Check the DR pair first',
});
cleanup.tasks.push(task.id);

await p.locator('#pick-tasks').click();
await p.waitForTimeout(1200);
check('the planner offers what is worth an hour',
  await D().locator('[data-suggestion]').count() > 0, await D().textContent());
check('and the critical one is in there',
  (await D().textContent()).includes(`Review MQ channel status ${stamp}`));

await D().locator(`[data-suggestion="${task.id}"] button`).click();
await p.waitForTimeout(1400);
await p.locator('button:has-text("Done")').last().click();
await p.waitForTimeout(800);

body = await p.locator('body').textContent();
check('blocking it out puts it in the day', body.includes(`Review MQ channel status ${stamp}`));
check('and shows that the block is tied to a real task', body.includes(`task #${task.id}`));

/* ══════════════════════════════ ticking it off ═══════════════════════════ */
section('Ticking it off finishes the task');

const linked = (await api('GET', `/api/plans/day/${DAY}`))
  .blocks.find(x => x.task_id === task.id);
await p.locator(`[data-tick="${linked.id}"]`).click();
await p.waitForTimeout(1500);

check('the page says which task that completed',
  (await p.locator('body').textContent()).includes('is marked complete'),
  (await p.locator('body').textContent()).slice(0, 300));
const reread = await api('GET', `/api/tasks/${task.id}`);
check('and the task really is complete in the database',
  reread.status === 'COMPLETED', reread.status);
check('the day reports time actually done',
  (await p.locator('[data-breakdown]').textContent()).includes('Done so far'),
  await p.locator('[data-breakdown]').textContent());

/* ════════════════════════════════ taking it ══════════════════════════════ */
section('Taking the plan somewhere else');

await p.locator('#copy-checklist').click();
await p.waitForTimeout(1200);
const copied = await p.evaluate(() => navigator.clipboard.readText().catch(() => ''));
check('the task list copies as plain tickable lines',
  copied.includes('[x]') && copied.includes(`Review MQ channel status ${stamp}`),
  copied.slice(0, 200));
check('and leaves lunch out of it, because lunch is not a to-do',
  !copied.includes('Lunch'), copied);

/* ═══════════════════════════ what am I doing now ═════════════════════════ */
/**
 * Everything below runs against a *frozen* clock in the timezone this app is
 * actually used in (UTC+7), rather than against whatever time the test
 * machine happens to hold.
 *
 * That is not neatness. The blocks are stored as minutes since local midnight
 * and the server runs in UTC, so a page that worked out "now" from the server,
 * or from a UTC date, would be seven hours wrong here - which looks like
 * nothing at all in a CI box running at UTC, and looks like the wrong task all
 * morning on the machine this was built for. Freezing the clock at a known
 * local time is the only way to tell those two apart.
 */
section('Which block am I in right now');

const NOW_DAY = new Date(Date.parse(DAY) + 86400000 * 7).toISOString().slice(0, 10);
const TZ = 'Asia/Phnom_Penh';   // UTC+7, no DST

const nowPlan = await api('POST', '/api/plans', { plan_date: NOW_DAY, title: 'Clock day' });
cleanup.plans.push(nowPlan.id);
for (const [start, end, kind, title, theme] of [
  ['08:00', '09:30', 'WORK', `Readiness checklist ${stamp}`, 'VDA go-live'],
  ['09:30', '09:45', 'BREAK', 'Coffee', null],
  ['09:45', '11:15', 'WORK', `Endpoint cutover check ${stamp}`, 'VDA go-live'],
  // 11:15-12:00 left empty on purpose: somewhere to stand in a gap
  ['12:00', '13:00', 'LUNCH', 'Lunch', null],
  ['13:00', '14:15', 'WORK', `Preprod deployment ${stamp}`, 'MBS/API preprod'],
  ['16:00', '16:30', 'BUFFER', `Follow-up ${stamp}`, 'Buffer'],
]) {
  await api('POST', `/api/plans/${nowPlan.id}/blocks`,
    { start, end, kind, title, theme: theme ?? undefined });
}

// A plan on the following day too, so that stepping forward lands on a day
// that has something on it rather than on the empty-day page.
const nextDay = new Date(Date.parse(NOW_DAY) + 86400000).toISOString().slice(0, 10);
const nextPlan = await api('POST', '/api/plans', { plan_date: nextDay });
cleanup.plans.push(nextPlan.id);
await api('POST', `/api/plans/${nextPlan.id}/blocks`,
  { start: '09:00', end: '10:00', title: `Tomorrow's first thing ${stamp}` });

/** A page whose clock is stopped at `hhmm` on the fixture day, in UTC+7. */
async function at(hhmm, day = NOW_DAY) {
  const c = await b.newContext({
    viewport: { width: 1440, height: 1100 }, timezoneId: TZ,
    permissions: ['clipboard-read', 'clipboard-write'],
  });
  const page = await c.newPage();
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  await page.clock.install({ time: new Date(`${day}T${hhmm}:00+07:00`) });
  await page.goto(B + '/plan', { waitUntil: 'networkidle' });
  await page.waitForTimeout(900);
  return { c, page };
}
const stateOf = pg => pg.locator('[data-now]').getAttribute('data-now-state');

// ---- 10:15, which is 03:15 UTC: the hour the whole feature turns on -------
{
  const { c, page } = await at('10:15');
  check('the page says what is running right now', await page.locator('[data-now]').count() === 1);
  check('and knows it is mid-block', await stateOf(page) === 'current', await stateOf(page));

  const panel = await page.locator('[data-now]').textContent();
  check('it names the block the clock is actually inside',
    panel.includes(`Endpoint cutover check ${stamp}`), panel.slice(0, 200));
  // The proof that it read the browser's clock and not the server's: at 10:15
  // local it is 03:15 UTC, which is before this day has started at all. A page
  // working in UTC would say "the day starts at 08:00", not name a block.
  check('reading the local clock, not the server in UTC',
    !panel.includes('The day starts'), panel.slice(0, 200));
  check('it says how much of the block is left',
    (await page.locator('[data-now-left]').textContent()).includes('1h 00m left'),
    await page.locator('[data-now-left]').textContent());
  check('and what is up next, with the wait',
    /Lunch/.test(await page.locator('[data-now-next]').textContent())
    && /1h 45m/.test(await page.locator('[data-now-next]').textContent()),
    await page.locator('[data-now-next]').textContent());

  const live = (await api('GET', `/api/plans/day/${NOW_DAY}`))
    .blocks.find(x => x.title.startsWith('Endpoint cutover check'));
  check('the timetable marks that same row, so the two cannot disagree',
    await page.locator(`[data-current="${live.id}"]`).count() === 1);
  check('exactly one row is marked current',
    await page.locator('[data-current]').count() === 1);
  check('the row carries a now badge with the time left',
    (await page.locator('[data-now-pill]').textContent()).includes('1h 00m'),
    await page.locator('[data-now-pill]').textContent());
  check('blocks that have been and gone are faded, those to come are not',
    await page.locator('[data-past]').count() === 2,
    `${await page.locator('[data-past]').count()} past`);
  check('and it offers to take you to it', await page.locator('#jump-now').count() === 1);

  // Ticking from the panel, which is where your eye already is.
  await page.locator('[data-now-tick]').click();
  await page.waitForTimeout(1200);
  check('ticking it off from the panel counts the time as done',
    (await page.locator('[data-breakdown]').textContent()).includes('1h 30m'),
    await page.locator('[data-breakdown]').textContent());
  const reread = (await api('GET', `/api/plans/day/${NOW_DAY}`))
    .blocks.find(x => x.id === live.id);
  check('and it is really ticked in the database', reread.done === true);
  await api('PATCH', `/api/plans/blocks/${live.id}`, { done: false });   // put it back
  await c.close();
}

// ---- 11:30: in the hole between two blocks --------------------------------
{
  const { c, page } = await at('11:30');
  check('standing in an unplanned stretch says so', await stateOf(page) === 'gap', await stateOf(page));
  const left = await page.locator('[data-now-left]').textContent();
  check('it says how long you have been free and for how much longer',
    left.includes('11:15') && left.includes('30m'), left);
  check('no row claims to be current when none is',
    await page.locator('[data-current]').count() === 0);
  check('a line is drawn across the day where the clock has got to',
    await page.locator('[data-now-line]').count() === 1);
  check('two earlier blocks are flagged as never ticked off',
    await page.locator('[data-behind="2"]').count() === 1,
    await page.locator('[data-now]').textContent());

  // The gap is offered as something to fill, already filled in.
  await page.locator('#plan-the-gap').click();
  await page.waitForTimeout(500);
  const dlg = page.locator('[role="dialog"]');
  check('offering to plan the gap starts the form at the gap',
    await dlg.locator('#f-block-start').inputValue() === '11:15'
    && await dlg.locator('#f-block-end').inputValue() === '12:00',
    `${await dlg.locator('#f-block-start').inputValue()}-${await dlg.locator('#f-block-end').inputValue()}`);
  await c.close();
}

// ---- 07:28 and 16:46: the ends of the day --------------------------------
{
  const { c, page } = await at('07:28');
  check('before the day starts it says when it does', await stateOf(page) === 'before', await stateOf(page));
  check('and how long that is', (await page.locator('[data-now-left]').textContent()).includes('32m'),
    await page.locator('[data-now-left]').textContent());

  // The day arrows, in the timezone this is used in. Done here because a
  // browser at UTC+7 is the only place the old arithmetic went wrong.
  await page.locator('button[aria-label="Next day"]').click();
  await page.waitForTimeout(700);
  check('the next-day arrow moves exactly one day, east of Greenwich too',
    await page.locator('#plan-date').inputValue() === nextDay,
    `${await page.locator('#plan-date').inputValue()} wanted ${nextDay}`);
  check('and another day is not pretending to be happening now',
    await stateOf(page) === 'other-day', await stateOf(page));
  check('with nothing on it marked as current',
    await page.locator('[data-current]').count() === 0);

  await page.locator('button[aria-label="Previous day"]').click();
  await page.waitForTimeout(700);
  check('and back again lands where it started',
    await page.locator('#plan-date').inputValue() === NOW_DAY,
    await page.locator('#plan-date').inputValue());
  await c.close();
}
{
  const { c, page } = await at('16:46');
  check('after the last block the day is reported as done', await stateOf(page) === 'after', await stateOf(page));
  check('with what was ticked and what is left of the day',
    /0 of 6 ticked off/.test(await page.locator('[data-now-left]').textContent())
    && /14m/.test(await page.locator('[data-now-left]').textContent()),
    await page.locator('[data-now-left]').textContent());
  await c.close();
}

// ---- 05:30, which is yesterday in UTC ------------------------------------
{
  // The bug this guards: new Date().toISOString().slice(0, 10) is today in
  // UTC. At UTC+7 that is yesterday until 07:00, so the planner opened on
  // yesterday's page every morning before seven - exactly when someone opens
  // it to see what today holds.
  const { c, page } = await at('05:30');
  check('at half five in the morning the planner opens on today, not yesterday',
    await page.locator('#plan-date').inputValue() === NOW_DAY,
    `${await page.locator('#plan-date').inputValue()} wanted ${NOW_DAY}`);
  await c.close();
}

/* ════════════════════════════════ cleanup ════════════════════════════════ */
for (const id of cleanup.plans) await api('DELETE', `/api/plans/${id}`);
for (const id of cleanup.tasks) await api('DELETE', `/api/tasks/${id}`);
for (const id of cleanup.meetings) await api('DELETE', `/api/meetings/${id}`);

section('Console health');
const real = errors.filter(e => !/favicon|React DevTools|Failed to load resource.*(40\d|422)/i.test(e));
check('no uncaught console errors', real.length === 0, real.slice(0, 3).join(' | '));

console.log(`\n${'='.repeat(56)}\n  ${BD}${pass} passed, ${fail} failed${X}\n${'='.repeat(56)}`);
if (failures.length) { console.log('Failed:'); failures.forEach(f => console.log('  -', f)); }
await b.close();
process.exit(fail ? 1 : 0);
