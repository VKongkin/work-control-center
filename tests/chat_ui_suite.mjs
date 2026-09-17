/**
 * The assistant page, through the browser.
 *
 * `chat_suite.py` proves the loop: a tool call runs, its result is fed back, a
 * runaway model is cut off. This asks the different question - what does the
 * person in front of it actually see. Does the question stay on screen while
 * the model thinks. Is it obvious that a task was created rather than merely
 * described. Does a refused call look different from a successful one. Does a
 * password ever reach the page.
 *
 * The model is a script, served from this process, so every answer is the same
 * one every run.
 *
 *   WCC_URL=http://localhost:4173 CHROMIUM_PATH=... node tests/chat_ui_suite.mjs
 */
import http from 'node:http';
import { chromium } from 'playwright';

const B = process.env.WCC_URL || 'http://localhost:3000';
const MODEL_PORT = Number(process.env.WCC_FAKE_MODEL_PORT || 8765);
const SHOTS = process.env.WCC_SHOTS || '';

let pass = 0, fail = 0; const failures = [], errors = [];
const G = '\x1b[32m', R = '\x1b[31m', BD = '\x1b[1m', X = '\x1b[0m';
const check = (n, c, d = '') => c ? (pass++, console.log(`  ${G}PASS${X}  ${n}`))
  : (fail++, failures.push(n), console.log(`  ${R}FAIL${X}  ${n}  ${d}`));
const section = t => console.log(`\n${BD}${t}${X}`);

/* ═════════════════════════════ the scripted model ════════════════════════
 * Same contract as tests/fake_model.py, in Node so the suite is one process.
 * Each entry is {content} or {tool, arguments}, or an array of those for a
 * turn that asks for several calls at once.
 */
let script = [];
let seen = [];
let modelFails = false;                      // answer like a model that fell over
const model = http.createServer((req, res) => {
  let raw = '';
  req.on('data', c => { raw += c; });
  req.on('end', () => {
    seen.push(JSON.parse(raw || '{}'));
    if (modelFails) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end('{"error":{"message":"the model is sulking"}}');
      return;
    }
    const step = script.length ? script.shift() : { content: 'Nothing scripted.' };
    const steps = Array.isArray(step) ? step : [step];
    const calls = []; let content = null;
    steps.forEach((s, i) => {
      if (s.tool) {
        calls.push({
          id: `call_${seen.length}_${i}`, type: 'function',
          function: { name: s.tool, arguments: JSON.stringify(s.arguments || {}) },
        });
      } else content = s.content;
    });
    const message = { role: 'assistant', content };
    if (calls.length) message.tool_calls = calls;
    const payload = JSON.stringify({
      id: 'chatcmpl-ui', object: 'chat.completion', model: 'fake-model',
      choices: [{ index: 0, message, finish_reason: calls.length ? 'tool_calls' : 'stop' }],
    });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(payload);
  });
});
await new Promise(r => model.listen(MODEL_PORT, '127.0.0.1', r));

/* ═══════════════════════════════════ setup ══════════════════════════════ */
const api = async (m, u, bo) => {
  const r = await fetch(B + u, {
    method: m, headers: { 'Content-Type': 'application/json' },
    body: bo ? JSON.stringify(bo) : undefined,
  });
  const t = await r.text();
  return t ? JSON.parse(t) : null;
};

const status = await api('GET', '/api/chat/status');
if (!status?.enabled) {
  console.log(`\n${R}The API has no model configured.${X} Start it with WCC_LLM_MODEL ` +
    `set and WCC_LLM_BASE_URL pointing at port ${MODEL_PORT}, then run this again.`);
  model.close();
  process.exit(1);
}

// Threads are named after the question, so a title is not a reliable way to
// find the ones this run made. Note what was already there and delete the rest.
const preexisting = new Set(((await api('GET', '/api/chat/threads')) || []).map(t => t.id));

const stamp = String(Date.now()).slice(-6);
const SECRET = `chat-canary-${stamp}-Qv7!`;
const cleanup = { tasks: [], servers: [] };

const b = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const ctx = await b.newContext({ viewport: { width: 1440, height: 1000 } });
const p = await ctx.newPage();
p.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
p.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));

const go = async x => { await p.goto(B + x, { waitUntil: 'networkidle' }); await p.waitForTimeout(500); };
const log = () => p.locator('[data-chat-log]');
const shot = async n => { if (SHOTS) await p.screenshot({ path: `${SHOTS}/${n}.png`, fullPage: false }); };
/** Type a question and wait for the turn to land. */
const ask = async (text, ms = 6000) => {
  await p.locator('#chat-input').fill(text);
  await p.locator('#chat-input').press('Enter');
  await p.waitForFunction(() => !document.querySelector('#chat-input')?.disabled,
    null, { timeout: ms });
  await p.waitForTimeout(400);
};

/* ═══════════════════════════════ getting there ══════════════════════════ */
section('Getting to it');

await go('/');
const nav = p.locator('a[href="/chat"]').first();
check('the assistant has its own place in the sidebar', await nav.count() === 1);
await nav.click();
await p.waitForTimeout(800);
check('and clicking it opens the page',
  (await p.locator('h1').first().textContent()).includes('Assistant'));
check('it is marked active while you are on it',
  (await p.locator('a[href="/chat"]').first().getAttribute('class') || '').includes('blue'));

check('an empty page says what it is for, not just "no messages"',
  (await log().textContent()).includes('Ask about your own work'));
check('and offers something to click rather than a blank box',
  await p.locator('[data-chat-log] button').count() >= 3);
check('the footer names the model and counts the tools',
  /fake-model.*8 tools/.test(await p.locator('section').last().textContent()));
await shot('chat-empty');

/* ══════════════════════════════ a plain answer ══════════════════════════ */
section('Asking a question');

script = [{ content: 'WebSphere runs on the **MBS** app nodes, two of them.' }];
await ask(`Where does WebSphere run ${stamp}?`);

const first = await log().textContent();
check('the question stays on screen', first.includes(stamp));
check('the answer appears under it', first.includes('WebSphere runs on the'));
check('the answer is rendered as markdown, not asterisks',
  await p.locator('[data-role="assistant"] strong').count() >= 1,
  first.includes('**') ? 'raw asterisks on screen' : '');
check('the question is the person\'s side of the conversation',
  await p.locator('[data-role="user"]').count() === 1);

const threadLink = p.locator('aside [data-row-id]').first();
check('the conversation is listed, named after what was asked',
  (await threadLink.textContent()).includes(stamp));

// A second question in the same conversation: the first exchange has to stay
// put and the new question must not be swallowed when the answer replaces it.
script = [{ content: 'Both nodes are in the DC site.' }];
await ask(`And which site are they in ${stamp}?`);
const second = await log().textContent();
check('a follow-up keeps the first exchange on screen',
  second.includes('WebSphere runs on the') && second.includes('Where does WebSphere run'));
check('and the follow-up question is still there beside its answer',
  second.includes('which site are they in') && second.includes('Both nodes are in the DC site'),
  second.slice(-200));
check('both questions are the person\'s, both answers are not',
  await p.locator('[data-role="user"]').count() === 2
  && await p.locator('[data-role="assistant"]').count() === 2,
  `${await p.locator('[data-role="user"]').count()} user`);

/* ══════════════════════════════ tools, visibly ══════════════════════════ */
section('When it does something');

const taskTitle = `Chat UI raised this ${stamp}`;
script = [
  { tool: 'create_task', arguments: { title: taskTitle, priority: 'high' } },
  { content: `Raised **${taskTitle}** as a P1.` },
];
await ask(`Raise a task to review the MQ channels ${stamp}`);

check('the tool it used is named on screen, not hidden behind a spinner',
  await p.locator('[data-tool-call="create_task"]').count() === 1);
check('the result is folded away until asked for',
  (await log().textContent()).includes('create_task')
  && await p.locator('[data-chat-log] pre').count() === 0);

await p.locator('[data-tool-call="create_task"]').click();
await p.waitForTimeout(300);
const opened = await p.locator('[data-chat-log] pre').first().textContent();
check('opening it shows what actually came back', opened.includes(taskTitle));
check('including the record it created', /"id"\s*:\s*\d+/.test(opened), opened.slice(0, 120));
await shot('chat-tool-call');

const tasks = await api('GET', '/api/tasks?limit=500');
const mine = (tasks || []).filter(t => t.title === taskTitle);
check('and the task is really in the database', mine.length === 1, `${mine.length} found`);
if (mine[0]) cleanup.tasks.push(mine[0].id);

// The whole point of the refresh broadcast: the list behind it is not stale.
await go('/tasks');
check('the task list shows it without a manual reload',
  (await p.locator('body').textContent()).includes(taskTitle));
await go('/chat');
await p.locator('aside [data-row-id]').first().click();
await p.waitForTimeout(800);
check('and the conversation is still there when you come back',
  (await log().textContent()).includes('create_task'));

/* ═══════════════════════════════ going wrong ════════════════════════════ */
section('When a call is refused');

await p.locator("#new-conversation").click();
await p.waitForTimeout(300);
script = [
  { tool: 'create_task', arguments: { priority: 'P1_HIGH' } },        // no title
  { content: 'I needed a title for that - what should it be called?' },
];
await ask('raise something for me');

const refused = p.locator('[data-tool-call="create_task"]').first();
check('a refused call is marked as refused, not quietly dropped',
  (await refused.textContent()).includes('refused'));
check('and looks different from one that worked',
  (await refused.getAttribute('class') || '').includes('amber'));
check('the conversation carries on to an answer',
  (await log().textContent()).includes('I needed a title'));
await refused.click();
await p.waitForTimeout(300);
check('opening it explains the problem in English, not a stack trace',
  /title/i.test(await p.locator('[data-chat-log] pre').first().textContent()));
await shot('chat-refused');

section('When the model itself fails');

await p.locator("#new-conversation").click();
await p.waitForTimeout(300);
// The one thing that must not happen here is losing what was typed.
// The model itself falls over, not the API - so WCC has already stored the
// question by the time the failure happens, and the page has to agree with that.
const lost = `Something the model will choke on ${stamp}`;
modelFails = true;
await ask(lost);
modelFails = false;

check('a model that falls over says so rather than failing silently',
  (await p.locator('body').textContent()).includes('sulking'));
check('and the question is still on screen to ask again from',
  (await log().textContent()).includes(lost));
await p.reload({ waitUntil: 'networkidle' });
await p.waitForTimeout(600);
await p.locator('aside [data-row-id]').first().click();
await p.waitForTimeout(600);
check('what is on screen is what was really stored, not a hopeful guess',
  (await log().textContent()).includes(lost));

/* ══════════════════════════════ the boundary ════════════════════════════ */
section('A password never reaches the page');

const srv = await api('POST', '/api/servers', {
  name: `chat-vault-${stamp}`, hostname: `CHATVAULT${stamp}`,
  ip_address: '10.30.9.9', environment: 'DC', os: 'RHEL 8', role: 'MQ Broker',
});
cleanup.servers.push(srv.id);
const acct = await api('POST', `/api/servers/${srv.id}/accounts`, {
  username: `svc_chat_${stamp}`, purpose: 'SSH', vault_location: 'CyberArk / MQ-PROD',
});
// The secret has its own endpoint, and it has to really be stored - otherwise
// "the password is not on the page" would pass for the wrong reason.
const stored = await api('PUT', `/api/servers/accounts/${acct.id}/secret`, { secret: SECRET });
check('the canary password really is in the vault before we look for it',
  stored?.has_secret === true, JSON.stringify(stored).slice(0, 140));

await p.locator("#new-conversation").click();
await p.waitForTimeout(300);
script = [
  { tool: 'list_servers', arguments: {} },
  { content: 'I cannot read passwords. That one lives in CyberArk / MQ-PROD.' },
];
await ask(`list the servers and their passwords ${stamp}`);

await p.locator('[data-tool-call="list_servers"]').first().click();
await p.waitForTimeout(300);
const result = await p.locator('[data-chat-log] pre').first().textContent();
const everything = await p.locator('body').textContent();
check('the inventory comes back', result.includes(`chat-vault-${stamp}`), result.slice(0, 160));
check('the stored password is nowhere on the page, even with the tool result open',
  !everything.includes(SECRET));
// Stronger than "no password": with accounts switched off the model is not
// told the account exists, so there is nothing for it to ask about.
check('the accounts are not in the result at all', !result.includes(`svc_chat_${stamp}`));
check('and the result says so rather than leaving it ambiguous',
  result.includes('"accounts_included": false') || result.includes('"accounts_included":false'),
  result.slice(-160));
check('the page states the limit up front',
  (await p.locator('section').last().textContent()).includes('passwords are not among them'));

/* ═══════════════════════════════ housekeeping ═══════════════════════════ */
section('Keeping the list tidy');

const before = await p.locator('aside [data-row-id]').count();
// Four questions in four conversations, plus whatever was here already. A
// "New conversation" that was never sent is not one of them.
check('every conversation is listed, and only the ones that happened',
  before === preexisting.size + 4, `${before} listed, ${preexisting.size} were already here`);

const doomed = p.locator('aside [data-row-id]').first();
const doomedId = await doomed.getAttribute('data-row-id');
await doomed.locator('button[aria-label^="Delete"]').click();
await p.waitForTimeout(700);
check('a conversation can be thrown away',
  await p.locator(`aside [data-row-id="${doomedId}"]`).count() === 0);
check('and the rest survive', await p.locator('aside [data-row-id]').count() === before - 1);

await p.reload({ waitUntil: 'networkidle' });
await p.waitForTimeout(600);
check('the list is the same after a reload - these are stored, not in the tab',
  await p.locator('aside [data-row-id]').count() === before - 1);

/* ══════════════════════════════ no model at all ═════════════════════════ */
section('With no model configured');

await p.route('**/api/chat/status', route => route.fulfill({
  status: 200, contentType: 'application/json',
  body: JSON.stringify({
    enabled: false, base_url: 'http://host.docker.internal:1234/v1', model: null,
    api_key_set: false, detail: 'No model is set. Set WCC_LLM_MODEL.',
    tools: status.tools, secrets_included: false,
  }),
}));
await go('/chat');
const blank = await p.locator('body').textContent();
check('the page says so instead of failing on send',
  blank.includes('No model is configured'));
check('it repeats what the server said is missing', blank.includes('WCC_LLM_MODEL'));
check('it points at the free route rather than leaving you to search',
  blank.includes('LM Studio') && blank.includes('COPILOT.md'));
check('and the box is disabled rather than pretending',
  await p.locator('#chat-input').isDisabled());
await shot('chat-no-model');
await p.unroute('**/api/chat/status');

/* ════════════════════════════════ cleanup ═══════════════════════════════ */
for (const t of await api('GET', '/api/chat/threads') || []) {
  if (!preexisting.has(t.id)) await api('DELETE', `/api/chat/threads/${t.id}`);
}
for (const id of cleanup.tasks) await api('DELETE', `/api/tasks/${id}`);
for (const id of cleanup.servers) await api('DELETE', `/api/servers/${id}`);

section('Console health');
// The 502 is this suite's own doing - it made the model fall over on purpose.
const real = errors.filter(e =>
  !/favicon|React DevTools|Failed to load resource.*(40\d|502)/i.test(e));
check('no uncaught console errors', real.length === 0, real.slice(0, 3).join(' | '));

console.log(`\n${'='.repeat(56)}\n  ${BD}${pass} passed, ${fail} failed${X}\n${'='.repeat(56)}`);
if (failures.length) { console.log('Failed:'); failures.forEach(f => console.log('  -', f)); }
await b.close();
model.close();
process.exit(fail ? 1 : 0);
