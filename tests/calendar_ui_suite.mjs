/**
 * The calendar integration through a real browser.
 *
 * Drives the ICS route end to end - connect, test, sync, edit, disconnect -
 * because that is the one a user can set up alone. The Microsoft route only
 * gets as far as the sign-in prompt here; the rest needs a real tenant.
 */
import { chromium } from 'playwright';
import http from 'node:http';

const BASE = process.env.WCC_URL ?? 'http://127.0.0.1:4173';
const FEED_PORT = Number(process.env.WCC_UI_FEED_PORT ?? 4898);

let passed = 0, failed = 0;
const failures = [];
const check = (name, ok, detail = '') => {
  if (ok) { passed++; console.log(`  \x1b[32mPASS\x1b[0m  ${name}`); }
  else { failed++; failures.push(`${name} :: ${detail}`); console.log(`  \x1b[31mFAIL\x1b[0m  ${name}  ${detail}`); }
};
const section = (t) => console.log(`\n\x1b[1m${t}\x1b[0m`);

/* ---- a calendar feed we control ---------------------------------------- */

const base = new Date(Date.now() + 2 * 864e5);
base.setUTCHours(9, 0, 0, 0);
const z = (d) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
const plus = (d, ms) => new Date(d.getTime() + ms);

const feed = (title = 'Weekly Change Board') => `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//WCC ui test//EN
BEGIN:VEVENT
UID:uiseries@wcc-test
SUMMARY:${title}
DTSTART:${z(base)}
DTEND:${z(plus(base, 36e5))}
RRULE:FREQ=WEEKLY;COUNT=3
LOCATION:Board Room
ORGANIZER;CN=Alice Chan:mailto:alice@bank.com
DESCRIPTION:Join https://teams.microsoft.com/l/meetup-join/19%3auitest/0
END:VEVENT
END:VCALENDAR
`;

const state = { body: feed() };
const server = http.createServer((_req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/calendar' });
  res.end(state.body);
});
await new Promise((r) => server.listen(FEED_PORT, '127.0.0.1', r));
const FEED_URL = `http://127.0.0.1:${FEED_PORT}/ui.ics`;

/* ------------------------------------------------------------------------ */

const browser = await chromium.launch(
  process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}
);
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)); });
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message.slice(0, 200)));

const go = async (p) => { await page.goto(BASE + p, { waitUntil: 'networkidle' }); await page.waitForTimeout(400); };
const dialog = () => page.locator('[role="dialog"]');
const bodyText = () => page.locator('body').textContent();

try {
  /* -- clean slate ------------------------------------------------------- */
  await go('/calendars');
  for (;;) {
    const card = page.locator('div', { hasText: 'UI test calendar' });
    if ((await page.locator('button[aria-label="Disconnect"]').count()) === 0) break;
    await page.locator('button[aria-label="Disconnect"]').first().click();
    await page.waitForTimeout(300);
    await page.locator('button:has-text("Disconnect")').last().click();
    await page.waitForTimeout(900);
    void card;
  }

  section('The Calendars page');
  check('reachable from the sidebar',
    (await page.locator('a:has-text("Calendars")').count()) > 0);
  check('explains the two routes', (await bodyText()).includes('Which one should I use?'));
  check('states that hand edits are kept',
    (await bodyText()).toLowerCase().includes('edit by hand is kept'));
  check('states that nothing is deleted',
    (await bodyText()).toLowerCase().includes('never deleted'));

  section('Connecting a published calendar');
  await page.locator('button:has-text("Connect a calendar")').first().click();
  await page.waitForTimeout(500);
  // Headless UI's dialog root has no size of its own, so isVisible() is false
  // even when the panel is plainly on screen. Presence is the honest check.
  check('the form opens', (await dialog().count()) === 1 &&
    (await dialog().locator('#f-display_name').count()) === 1);
  check('defaults to the route needing no approval',
    (await dialog().locator('#f-provider').inputValue()) === 'ics');

  await dialog().locator('#f-display_name').fill('UI test calendar');
  await dialog().locator('#f-ics_url').fill(FEED_URL);
  await dialog().locator('button:has-text("Add calendar")').click();
  await page.waitForTimeout(1200);
  check('the connection is listed', (await bodyText()).includes('UI test calendar'));
  check('it starts unsynced', (await bodyText()).includes('Never synced'));

  section('Switching to the Microsoft route asks for different details');
  await page.locator('button:has-text("Edit")').first().click();
  await page.waitForTimeout(500);
  await dialog().locator('#f-provider').selectOption('microsoft');
  await page.waitForTimeout(350);
  check('asks for the tenant', (await dialog().locator('#f-tenant_id').count()) === 1);
  check('asks for the client id', (await dialog().locator('#f-client_id').count()) === 1);
  check('hides the feed URL', (await dialog().locator('#f-ics_url').count()) === 0);
  await dialog().locator('#f-provider').selectOption('ics');
  await page.waitForTimeout(300);
  check('switching back restores the URL field',
    (await dialog().locator('#f-ics_url').count()) === 1);
  await dialog().locator('button:has-text("Cancel")').click();
  await page.waitForTimeout(400);

  section('Testing before trusting it');
  await page.locator('button:has-text("Test")').first().click();
  await page.waitForTimeout(1800);
  check('reports what it found', (await bodyText()).includes('Found 3 meeting'),
    (await bodyText()).slice(0, 0));

  section('Syncing');
  await page.locator('button:has-text("Sync now")').first().click();
  await page.waitForTimeout(2500);
  const afterSync = await bodyText();
  check('reports what changed', afterSync.includes('Synced: 3 new'));
  check('the card records the last sync', !afterSync.includes('Never synced'));

  section('Synced meetings on the Meetings page');
  await go('/meetings');
  const rows = page.locator('tbody tr', { hasText: 'Weekly Change Board' });
  check('all three occurrences arrived', (await rows.count()) === 3, `${await rows.count()}`);
  const first = rows.first();
  check('marked as coming from a calendar',
    (await first.textContent()).includes('Calendar'));
  check('offers a Join link for the online meeting',
    (await first.locator('a:has-text("Join")').count()) === 1);
  check('the time of day is shown, not just the date',
    /\d{1,2}:\d{2}/.test(await first.textContent()), await first.textContent());

  const del = first.locator('button[aria-label="Delete"]');
  check('delete is refused for a synced meeting', await del.isDisabled());
  check('and says why',
    ((await del.getAttribute('title')) ?? '').toLowerCase().includes('outlook'),
    await del.getAttribute('title'));

  section('Editing a synced meeting keeps your version');
  await first.locator('button[aria-label="Edit"]').click();
  await page.waitForTimeout(600);
  check('start time is editable with a time, not just a date',
    (await dialog().locator('#f-meeting_date').getAttribute('type')) === 'datetime-local');
  await dialog().locator('#f-location').fill('Room 9.01 (my correction)');
  await dialog().locator('#f-notes').fill('Bring the migration plan');
  await dialog().locator('button:has-text("Save changes")').click();
  await page.waitForTimeout(1400);

  const editedRow = page.locator('tbody tr', { hasText: 'Weekly Change Board' }).first();
  check('the kept-edit badge appears', (await editedRow.textContent()).includes('kept'),
    await editedRow.textContent());

  // upstream renames the series; the room must not come back
  state.body = feed('Board (renamed upstream)');
  await page.locator('button:has-text("Sync calendar")').first().click();
  await page.waitForTimeout(2800);
  const synced = await bodyText();
  check('the title follows the calendar', synced.includes('Board (renamed upstream)'));
  check('your edit is reported as kept', synced.includes('of your edits kept'), synced.slice(0, 0));

  await page.locator('tbody tr', { hasText: 'Board (renamed upstream)' }).first()
    .locator('button').first().click();
  await page.waitForTimeout(700);
  const detail = await dialog().textContent();
  check('the detail view keeps your room name', detail.includes('Room 9.01 (my correction)'));
  check('your notes survived the sync', detail.includes('Bring the migration plan'));
  check('it names the source', detail.includes('Published calendar feed'));
  check('it offers to release the field', detail.toLowerCase().includes('release'));
  check('delete is refused here too',
    await dialog().locator('button:has-text("Delete")').isDisabled());

  section('Releasing a field lets it track the calendar again');
  await dialog().locator('button:has-text("location")').first().click();
  await page.waitForTimeout(1200);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(600);
  await page.locator('button:has-text("Sync calendar")').first().click();
  await page.waitForTimeout(2800);
  // The table shows a Join link in place of the location for online meetings,
  // so the released value has to be read from the record itself.
  await page.locator('tbody tr', { hasText: 'Board (renamed upstream)' }).first()
    .locator('button').first().click();
  await page.waitForTimeout(700);
  const released = await dialog().textContent();
  check('the calendar value returns', released.includes('Board Room'), released.slice(0, 200));
  check('your correction is no longer held', !released.includes('Room 9.01'));
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
  check('the kept-edit badge is gone from that row',
    !(await page.locator('tbody tr', { hasText: 'Board (renamed upstream)' })
      .first().textContent()).includes('kept'));

  section('A meeting you create yourself stays yours');
  await page.locator('button:has-text("New Meeting")').first().click();
  await page.waitForTimeout(500);
  await dialog().locator('#f-title').fill('UI mine only');
  await dialog().locator('button:has-text("Create meeting")').click();
  await page.waitForTimeout(1400);
  const mine = page.locator('tbody tr', { hasText: 'UI mine only' }).first();
  check('no calendar badge', !(await mine.textContent()).includes('Calendar'));
  check('delete is allowed', !(await mine.locator('button[aria-label="Delete"]').isDisabled()));

  section('Disconnecting hands the meetings back');
  await go('/calendars');
  await page.locator('button[aria-label="Disconnect"]').first().click();
  await page.waitForTimeout(400);
  check('it says the meetings are kept',
    (await bodyText()).includes('Your meetings are kept'));
  await page.locator('button:has-text("Disconnect")').last().click();
  await page.waitForTimeout(1600);
  check('the connection is gone', !(await bodyText()).includes('UI test calendar'));

  await go('/meetings');
  const orphan = page.locator('tbody tr', { hasText: 'Board (renamed upstream)' }).first();
  check('the meetings are still there', (await orphan.count()) > 0);
  check('and are now deletable',
    !(await orphan.locator('button[aria-label="Delete"]').isDisabled()));

  section('Cleanup');
  for (const title of ['Board (renamed upstream)', 'UI mine only']) {
    for (;;) {
      const row = page.locator('tbody tr', { hasText: title }).first();
      if ((await row.count()) === 0) break;
      await row.locator('button[aria-label="Delete"]').click();
      await page.waitForTimeout(400);
      await dialog().locator('button:has-text("Delete")').last().click();
      await page.waitForTimeout(900);
    }
  }
  check('test records removed', !(await bodyText()).includes('UI mine only'));

  section('A browser in Phnom Penh sees Phnom Penh times');
  // The whole point of the timezone work: run the browser at UTC+7, feed a
  // 03:30Z meeting, and the page must read 10:30 AM.
  const tzCtx = await browser.newContext({ timezoneId: 'Asia/Phnom_Penh',
    viewport: { width: 1280, height: 900 } });
  const tzPage = await tzCtx.newPage();
  const tzDialog = () => tzPage.locator('[role="dialog"]');
  try {
    state.body = `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:tzmorning@wcc-ui
SUMMARY:UI morning meeting
DTSTART:${z(new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate(), 3, 30)))}
DTEND:${z(new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate(), 5, 0)))}
END:VEVENT
BEGIN:VEVENT
UID:tzholiday@wcc-ui
SUMMARY:UI public holiday
DTSTART;VALUE=DATE:${z(base).slice(0, 8)}
DTEND;VALUE=DATE:${z(plus(base, 864e5)).slice(0, 8)}
END:VEVENT
END:VCALENDAR
`;
    await tzPage.goto(BASE + '/calendars', { waitUntil: 'networkidle' });
    await tzPage.waitForTimeout(500);
    await tzPage.locator('button:has-text("Connect a calendar")').first().click();
    await tzPage.waitForTimeout(600);
    const tzField = tzDialog().locator('#f-timezone');
    check('the form asks which clock to show times in', (await tzField.count()) === 1);
    check('and defaults to the browser\'s own zone',
      (await tzField.inputValue()) === 'Asia/Phnom Penh' ||
      (await tzField.inputValue()) === 'Asia/Phnom_Penh',
      await tzField.inputValue());

    await tzDialog().locator('#f-display_name').fill('UI tz calendar');
    await tzDialog().locator('#f-ics_url').fill(FEED_URL);
    await tzDialog().locator('button:has-text("Add calendar")').click();
    await tzPage.waitForTimeout(1300);
    check('the card names the zone in use',
      (await tzPage.locator('body').textContent()).includes('times in Asia/Phnom Penh'));

    await tzPage.locator('button:has-text("Sync now")').first().click();
    await tzPage.waitForTimeout(2500);
    await tzPage.goto(BASE + '/meetings', { waitUntil: 'networkidle' });
    await tzPage.waitForTimeout(700);

    const morning = await tzPage.locator('tbody tr', { hasText: 'UI morning meeting' })
      .first().textContent();
    check('a 03:30Z meeting reads as 10:30 AM', /10:30/.test(morning), morning);
    check('and not as 03:30', !/03:30/.test(morning), morning);

    const holiday = await tzPage.locator('tbody tr', { hasText: 'UI public holiday' })
      .first().textContent();
    check('an all-day entry says so instead of showing a time',
      holiday.includes('all day'), holiday);
    check('and does not slide onto the previous evening',
      !/11:00|12:00 AM/.test(holiday), holiday);

    // clean up through this context so the main one is unaffected
    await tzPage.goto(BASE + '/calendars', { waitUntil: 'networkidle' });
    await tzPage.waitForTimeout(400);
    await tzPage.locator('button[aria-label="Disconnect"]').first().click();
    await tzPage.waitForTimeout(400);
    await tzPage.locator('button:has-text("Disconnect")').last().click();
    await tzPage.waitForTimeout(1400);
    await tzPage.goto(BASE + '/meetings', { waitUntil: 'networkidle' });
    await tzPage.waitForTimeout(600);
    for (const title of ['UI morning meeting', 'UI public holiday']) {
      for (;;) {
        const row = tzPage.locator('tbody tr', { hasText: title }).first();
        if ((await row.count()) === 0) break;
        await row.locator('button[aria-label="Delete"]').click();
        await tzPage.waitForTimeout(400);
        await tzDialog().locator('button:has-text("Delete")').last().click();
        await tzPage.waitForTimeout(900);
      }
    }
  } finally {
    await tzCtx.close();
  }

  section('Console health');
  check('no uncaught console errors', errors.length === 0, errors.slice(0, 3).join(' | '));
} finally {
  await browser.close();
  server.close();
}

console.log(`\n${'='.repeat(54)}\n  \x1b[1m${passed} passed, ${failed} failed\x1b[0m\n${'='.repeat(54)}`);
for (const f of failures) console.log(`  - ${f}`);
process.exit(failed ? 1 : 0);
