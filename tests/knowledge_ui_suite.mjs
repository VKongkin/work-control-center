/**
 * Knowledge and Servers, through the browser.
 *
 * The question these answer is not "does the endpoint work" - the Python suite
 * covers that - but "can you find the runbook while something is down, and does
 * a password ever appear on screen when it should not".
 *
 *   WCC_URL=http://localhost:4173 CHROMIUM_PATH=... node tests/knowledge_ui_suite.mjs
 */
import { chromium } from 'playwright';

const B = process.env.WCC_URL || 'http://localhost:3000';
let pass = 0, fail = 0; const failures = [], errors = [];
const G = '\x1b[32m', R = '\x1b[31m', BD = '\x1b[1m', X = '\x1b[0m';
const check = (n, c, d = '') => c ? (pass++, console.log(`  ${G}PASS${X}  ${n}`))
  : (fail++, failures.push(n), console.log(`  ${R}FAIL${X}  ${n}  ${d}`));
const section = t => console.log(`\n${BD}${t}${X}`);

const b = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
// Clipboard permission is granted so the connect buttons can be checked for
// what they actually put there, rather than only that they were clickable.
const ctx = await b.newContext({
  viewport: { width: 1440, height: 1100 },
  permissions: ['clipboard-read', 'clipboard-write'],
});
const p = await ctx.newPage();
p.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
p.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));

const D = () => p.locator('[role="dialog"]');
const go = async x => { await p.goto(B + x, { waitUntil: 'networkidle' }); await p.waitForTimeout(500); };
const stamp = String(Date.now()).slice(-6);
const api = async (m, u, bo) => {
  const r = await fetch(B + u, {
    method: m, headers: { 'Content-Type': 'application/json' },
    body: bo ? JSON.stringify(bo) : undefined,
  });
  const t = await r.text();
  return t ? JSON.parse(t) : null;
};

const SECRET = `ui-canary-${stamp}-Zt4!`;
const cleanup = { articles: [], servers: [] };

/* ═══════════════════════════════ knowledge ═══════════════════════════════ */
section('Writing a runbook down');

await go('/knowledge');
await p.locator('button:has-text("New Article")').first().click();
await p.waitForTimeout(600);

const title = `UI Failover MQ to DR ${stamp}`;
await D().locator('#f-title').fill(title);
await D().locator('#f-kind').selectOption('RUNBOOK');
await D().locator('#f-status').selectOption('PUBLISHED');
await D().locator('#f-environment').selectOption('DR');
await D().locator('#f-summary').fill('Move the queue managers across without losing messages.');
await D().locator('#f-tags').fill(`mq,failover,ui${stamp}`);
await D().locator('#f-body').fill(
  '## Before you start\n\n- Confirm replication is current\n\n## Steps\n\n1. Stop the sender channel\n\n```bash\nendmqm -i QM1\n```\n\n> Do not skip the drain.\n');
await p.locator('button:has-text("Create article")').click();
await p.waitForTimeout(1500);

let body = await p.locator('body').textContent();
check('the new runbook appears without a refresh', body.includes(title));

const headings = await p.locator('[data-list] h2, h2').allTextContents();
check('runbooks are the first group on the page',
  headings.some(h => /Runbook/i.test(h)), JSON.stringify(headings.slice(0, 5)));
const runbookIdx = headings.findIndex(h => /Runbook/i.test(h));
const noteIdx = headings.findIndex(h => /^Notes/i.test(h));
check('runbooks come before notes, because that is what you open mid-incident',
  runbookIdx >= 0 && (noteIdx < 0 || runbookIdx < noteIdx), `${runbookIdx} vs ${noteIdx}`);

check('a runbook verified by nobody is flagged', body.includes('unverified'));

section('Reading it back');

await p.locator('[data-row-id]', { hasText: title }).first().locator('button').first().click();
await p.waitForTimeout(800);
const dt = await D().textContent();
check('it opens read-only', dt.includes(title));
check('no form inputs in the detail view',
  (await D().locator('input:not([type=file]), textarea').count()) === 0);

// The defect this replaces: the body was printed once as raw markdown from the
// generic field list and again rendered underneath, so every runbook appeared
// twice.
const mdCount = await D().locator('.wcc-markdown').count();
check('the body renders as markdown', mdCount === 1, `${mdCount} markdown blocks`);
check('the raw markdown source is not shown as well',
  !dt.includes('## Before you start'), 'raw "## " heading found on screen');
check('headings became headings', (await D().locator('.wcc-markdown h2').count()) >= 2);
check('the command block became a code block', (await D().locator('.wcc-markdown pre').count()) >= 1);
check('the list became a list', (await D().locator('.wcc-markdown li').count()) >= 2);
check('the aside became a quote', (await D().locator('.wcc-markdown blockquote').count()) === 1);

// Newlines between the tags marked emits must not each become a blank line -
// that spread a one-screen runbook over three.
const gap = await p.evaluate(() => {
  const ul = document.querySelector('.wcc-markdown ul');
  if (!ul) return -1;
  const li = ul.querySelector('li');
  return Math.round(li.getBoundingClientRect().top - ul.getBoundingClientRect().top);
});
check('rendered markdown is not spaced out by stray line breaks', gap >= 0 && gap < 8, `${gap}px`);

check('tags are shown as tags, not "mq,failover"', !dt.includes('mq,failover'));

section('Saying a runbook still works');

await D().locator('button:has-text("it works")').click();
await p.waitForTimeout(1200);
const after = await D().textContent();
check('it records that you just ran it', /Last confirmed working/.test(after), after.slice(0, 200));
await p.keyboard.press('Escape');
await p.waitForTimeout(700);
// Scoped to this row: other articles on the page may legitimately still be
// flagged, and a page-wide check would pass for the wrong reason.
const rowText = await p.locator('[data-row-id]', { hasText: title }).first().textContent();
check('and its unverified flag clears in the list', !rowText.includes('unverified'), rowText.slice(0, 120));

const arts = await api('GET', '/api/knowledge?limit=500');
const mine = arts.find(a => a.title === title);
cleanup.articles.push(mine?.id);
check('the verification reached the database', !!mine?.last_verified_at);

section('Finding it again');

await go('/knowledge');
await p.locator('#knowledge-search').fill(`ui${stamp}`);
await p.waitForTimeout(700);
check('a tag finds it', (await p.locator('body').textContent()).includes(title));

await p.locator('#knowledge-search').fill('dr failover mq');
await p.waitForTimeout(700);
check('words in any order find it', (await p.locator('body').textContent()).includes(title));

await p.locator('#knowledge-search').fill('zzz-nothing-here');
await p.waitForTimeout(700);
check('a miss says so instead of showing everything',
  (await p.locator('body').textContent()).includes('Nothing matches'));

await p.locator('button[aria-label="Clear search"]').click();
await p.waitForTimeout(600);
check('clearing the search brings it back', (await p.locator('body').textContent()).includes(title));

await p.locator('#f-filter-kind').selectOption('NOTE');
await p.waitForTimeout(800);
check('filtering to notes hides the runbook',
  !(await p.locator('body').textContent()).includes(title));

check('the filter is in the URL, so the view can be shared', p.url().includes('kind=NOTE'));
await go('/knowledge?kind=RUNBOOK');
check('and a shared URL restores it',
  (await p.locator('#f-filter-kind').inputValue()) === 'RUNBOOK');

/* ════════════════════════════════ servers ════════════════════════════════ */
section('Recording a server');

await go('/servers');
await p.locator('button:has-text("New Server")').first().click();
await p.waitForTimeout(600);

const srvName = `UI MQ-HUB ${stamp}`;
await D().locator('#f-name').fill(srvName);
await D().locator('#f-hostname').fill(`mqhub-${stamp}.bank.local`);
await D().locator('#f-ip_address').fill('10.20.5.20');
await D().locator('#f-environment').selectOption('DR');
await D().locator('#f-os').fill('RHEL 8.6');
await D().locator('#f-role').fill('IBM MQ 9.3');
await p.locator('button:has-text("Create server")').click();
await p.waitForTimeout(1500);

body = await p.locator('body').textContent();
check('the server appears without a refresh', body.includes(srvName));
check('it is filed under its environment', body.includes('DR'));

const servers = await api('GET', '/api/servers?limit=500');
const srv = servers.find(s => s.name === srvName);
cleanup.servers.push(srv?.id);
check('and it reached the database', !!srv);

section('Its accounts');

await p.locator('[data-row-id]', { hasText: srvName }).first()
  .locator('button[aria-label^="Show accounts"]').click();
await p.waitForTimeout(700);
await p.locator('button:has-text("Add account")').first().click();
await p.waitForTimeout(600);
await D().locator('#f-username').fill('svc_mq_dr');
await D().locator('#f-account_type').selectOption('SERVICE');
await D().locator('#f-purpose').fill('Runs the queue manager');
await D().locator('#f-vault_location').fill('CyberArk safe MW-DR');
await p.locator('button:has-text("Add account")').last().click();
await p.waitForTimeout(1400);

body = await p.locator('body').textContent();
check('the account appears under its server', body.includes('svc_mq_dr'));
check('it says where the real credential lives', body.includes('CyberArk safe MW-DR'));
check('and says plainly that no password is held here yet',
  body.includes('no password stored'));

section('Holding a password');

await p.locator('button:has-text("Set")').first().click();
await p.waitForTimeout(500);
const pw = p.locator('input[aria-label="Password for svc_mq_dr"]');
check('the password box hides what is typed',
  (await pw.getAttribute('type')) === 'password');
await pw.fill(SECRET);
await p.locator('button:has-text("Save")').first().click();
await p.waitForTimeout(1500);

body = await p.locator('body').textContent();
check('it stops saying no password is stored', !body.includes('no password stored'));
check('the password is not on screen after saving', !body.includes(SECRET));
check('and it offers to reveal it', body.includes('Reveal'));

const html = await p.content();
check('the password is not hiding in the page source either', !html.includes(SECRET));

const acctsJson = JSON.stringify(await api('GET', `/api/servers/${srv.id}/accounts`));
check('the API the page called never sent the password to the browser',
  !acctsJson.includes(SECRET), acctsJson.slice(0, 160));

section('Reading it back, deliberately');

await p.locator('button:has-text("Reveal")').first().click();
await p.waitForTimeout(1200);
body = await p.locator('body').textContent();
check('revealing shows it', body.includes(SECRET));
check('and says the reveal was recorded', /recorded/i.test(body));
check('and that it will not stay on screen', /hides itself/i.test(body));

await p.locator('button:has-text("Hide")').first().click();
await p.waitForTimeout(500);
check('hiding takes it off screen again',
  !(await p.locator('body').textContent()).includes(SECRET));

await p.locator('button[aria-label="Access log"]').first().click();
await p.waitForTimeout(900);
body = await p.locator('body').textContent();
check('the access log is readable from the row', body.includes('Access log'));
check('it shows the write', body.includes('SET'));
check('it shows the read', body.includes('REVEAL'));
check('the log does not print the password itself', !body.includes(SECRET));

section('One click into a client');

// The point of these buttons is the two-in-the-morning case: get onto the box
// without hunting for a hostname. So check what actually reaches the clipboard
// and what the browser is handed, not merely that a button exists.
const accountRow = p.locator('li', { hasText: 'svc_mq_dr' }).first();

check('the row offers Remote Desktop',
  (await accountRow.locator('button:has-text("Remote Desktop")').count()) === 1);
check('the row offers WinSCP',
  (await accountRow.locator('button:has-text("WinSCP")').count()) === 1);
check('the row offers MobaXterm',
  (await accountRow.locator('button:has-text("MobaXterm")').count()) === 1);

// A Linux box should not lead with Remote Desktop.
const order = await accountRow.locator('button:has-text("WinSCP"), button:has-text("MobaXterm"), button:has-text("Remote Desktop")').allTextContents();
check('a Linux box leads with the shell clients, not RDP',
  !/Remote Desktop/.test(order[0] ?? ''), JSON.stringify(order));

// Remote Desktop hands over a file, because .rdp is not a URL scheme.
const dl = p.waitForEvent('download', { timeout: 8000 }).catch(() => null);
await accountRow.locator('button:has-text("Remote Desktop")').click();
const download = await dl;
check('Remote Desktop downloads an .rdp file',
  !!download && download.suggestedFilename().endsWith('.rdp'),
  download ? download.suggestedFilename() : 'no download fired');

if (download) {
  const stream = await download.createReadStream();
  let rdp = '';
  for await (const chunk of stream) rdp += chunk;
  check('the .rdp names the host', rdp.includes(`mqhub-${stamp}.bank.local`), rdp.slice(0, 120));
  check('the .rdp names the account', rdp.includes('username:s:svc_mq_dr'), rdp.slice(0, 160));
  // Windows will not accept a plaintext password here anyway, and a file in
  // Downloads is the last place one should be.
  check('the .rdp carries no password', !rdp.includes(SECRET), rdp.slice(0, 200));
}

await p.waitForTimeout(900);
const clip = await p.evaluate(() => navigator.clipboard.readText().catch(() => ''));
check('the password is on the clipboard, ready to paste', clip === SECRET,
  clip ? `got ${clip.length} chars` : 'clipboard empty');

body = await p.locator('body').textContent();
check('and the page says so rather than leaving you guessing',
  /password copied/i.test(body), body.slice(0, 200));
check('the password itself is still not on screen', !body.includes(SECRET));

// Opening a client is a credential access and has to be logged as one.
const acctsNow = await api('GET', `/api/servers/${srv.id}/accounts`);
const logNow = await api('GET', `/api/servers/accounts/${acctsNow[0].id}/access-log`);
check('opening a client is written to the access log',
  logNow.some(e => e.action === 'LAUNCH'), JSON.stringify(logNow.map(e => e.action)));
check('the log records which client', logNow.some(e => /Remote Desktop/.test(e.detail || '')),
  JSON.stringify(logNow.slice(0, 3)));

section('Finding a server');

await p.locator('#server-search').fill(`mqhub-${stamp}`);
await p.waitForTimeout(700);
check('searching by hostname finds it', (await p.locator('body').textContent()).includes(srvName));
await p.locator('#server-search').fill('mq 9.3 hub');
await p.waitForTimeout(700);
check('words across name, role and hostname all count',
  (await p.locator('body').textContent()).includes(srvName));

/* ══════════════════════════════ navigation ══════════════════════════════ */
section('Both pages are reachable');
for (const [path, heading] of [['/knowledge', 'Knowledge'], ['/servers', 'Servers']]) {
  await go(path);
  check(`${path} loads`, (await p.locator('h1').first().textContent()).includes(heading));
  check(`${path} is marked active in the sidebar`,
    (await p.locator(`a[href="${path}"]`).first().getAttribute('class') || '').includes('blue'));
}

/* ════════════════════════════════ cleanup ═══════════════════════════════ */
for (const id of cleanup.articles) if (id) await api('DELETE', `/api/knowledge/${id}`);
for (const id of cleanup.servers) if (id) await api('DELETE', `/api/servers/${id}`);

section('Console health');
const real = errors.filter(e => !/favicon|React DevTools|Failed to load resource.*40\d/i.test(e));
check('no uncaught console errors', real.length === 0, real.slice(0, 3).join(' | '));

console.log(`\n${'='.repeat(56)}\n  ${BD}${pass} passed, ${fail} failed${X}\n${'='.repeat(56)}`);
if (failures.length) { console.log('Failed:'); failures.forEach(f => console.log('  -', f)); }
await b.close();
process.exit(fail ? 1 : 0);
