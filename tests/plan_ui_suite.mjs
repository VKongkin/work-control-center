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
