import { chromium } from 'playwright';
const B = process.env.WCC_URL || 'http://localhost:3000';
let pass = 0, fail = 0; const failures = [], errors = [];
const G='\x1b[32m', R='\x1b[31m', BD='\x1b[1m', X='\x1b[0m';
const check = (n,c,d='') => c ? (pass++, console.log(`  ${G}PASS${X}  ${n}`))
                              : (fail++, failures.push(n), console.log(`  ${R}FAIL${X}  ${n}  ${d}`));
const section = t => console.log(`\n${BD}${t}${X}`);

const b = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const p = await b.newPage({ viewport: { width: 1440, height: 1000 } });
p.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
p.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
const D = () => p.locator('[role="dialog"]');
const go = async x => { await p.goto(B + x, { waitUntil: 'networkidle' }); await p.waitForTimeout(450); };
const stamp = () => String(Date.now()).slice(-6);
const api = async (m,u,bo) => { const r = await fetch(B+u,{method:m,headers:{'Content-Type':'application/json'},
  body: bo?JSON.stringify(bo):undefined}); const t = await r.text(); return t?JSON.parse(t):null; };

/* ════════════════════════════ detail view ════════════════════════════ */
section('Opening a record shows it, rather than dropping into an edit form');

const taskTitle = `Detail probe ${stamp()}`;
await go('/tasks');
await p.locator('button:has-text("New Task")').first().click();
await p.waitForTimeout(500);
await D().locator('#f-title').fill(taskTitle);
await D().locator('#f-description').fill('Something worth reading before changing it');
await D().locator('#f-priority').selectOption('P0_CRITICAL');
await D().locator('#f-notes').fill('A note on the record');
await p.locator('button:has-text("Create task")').click();
await p.waitForTimeout(1600);

await p.locator('tbody tr', { hasText: taskTitle }).first().locator('button').first().click();
await p.waitForTimeout(700);
const dt = await D().textContent();
check('the record opens read-only', dt.includes(taskTitle));
check('no form inputs in the detail view', (await D().locator('input:not([type=file]), textarea').count()) === 0,
  `${await D().locator('input:not([type=file]), textarea').count()} inputs found`);
check('description is shown', dt.includes('Something worth reading'));
check('notes are shown', dt.includes('A note on the record'));
check('priority badge is shown', dt.includes('P0'));
check('it offers Edit', (await D().locator('button:has-text("Edit")').count()) > 0);
check('it offers Delete', (await D().locator('button:has-text("Delete")').count()) > 0);
check('it offers a Files area', dt.includes('Files'));

section('Detail hands over to the edit form');
await D().locator('button:has-text("Edit")').click();
await p.waitForTimeout(800);
check('edit form opens, prefilled', (await D().locator('#f-title').inputValue()) === taskTitle);
await p.keyboard.press('Escape');
await p.waitForTimeout(400);
if (await p.locator('button:has-text("Discard changes")').count())
  { await p.locator('button:has-text("Discard changes")').click(); await p.waitForTimeout(300); }

section('Every list opens a detail view, not an edit form');
for (const [path, btn] of [['/projects','New Project'], ['/issues','New Issue'], ['/meetings','New Meeting'],
                           ['/people','New Person'], ['/vendors','New Vendor']]) {
  await go(path);
  const rows = await p.locator('tbody tr').count();
  if (!rows) { check(`${path}: detail view`, true, '(no rows)'); continue; }
  await p.locator('tbody tr').first().locator('button').first().click();
  await p.waitForTimeout(650);
  const open = (await D().count()) > 0;
  const noInputs = (await D().locator('input:not([type=file]), textarea, select').count()) === 0;
  check(`${path}: opens a read-only detail view`, open && noInputs,
    open ? 'form controls present' : 'nothing opened');
  await p.locator('button:has-text("Close")').click();
  await p.waitForTimeout(400);
}

/* ════════════════════════════ attachments ════════════════════════════ */
section('Attaching files to a task');
await go('/tasks');
await p.locator('tbody tr', { hasText: taskTitle }).first().locator('button').first().click();
await p.waitForTimeout(700);
check('upload area offers a file picker', (await D().locator('button:has-text("Choose files")').count()) === 1);
check('a task is not offered folder upload', (await D().locator('button:has-text("Choose folder")').count()) === 0);

await D().locator('input[type=file]').first().setInputFiles([
  { name: 'spec.txt', mimeType: 'text/plain', buffer: Buffer.from('the agreed spec') },
  { name: 'diagram.svg', mimeType: 'image/svg+xml',
    buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>') },
]);
await p.waitForTimeout(2200);
const afterUpload = await D().textContent();
check('both files are listed', afterUpload.includes('spec.txt') && afterUpload.includes('diagram.svg'));
check('sizes are shown', /\d+\s?B|KB/.test(afterUpload));
check('an image renders a thumbnail', (await D().locator('img').count()) > 0);

const taskRow = (await api('GET', '/api/tasks?limit=300')).find(t => t.title === taskTitle);
const files = await api('GET', `/api/attachments?entity_type=task&entity_id=${taskRow.id}`);
check('files are stored against the task', files.length === 2, JSON.stringify(files.map(f=>f.path)));
const dl = await fetch(`${B}/api/attachments/${files.find(f=>f.path==='spec.txt').id}/download`);
check('a file downloads with its content', (await dl.text()) === 'the agreed spec');

section('Removing a file');
await D().locator('button[aria-label="Delete spec.txt"]').click();
await p.waitForTimeout(500);
await D().locator('button:has-text("Delete")').last().click();
await p.waitForTimeout(1600);
const left = await api('GET', `/api/attachments?entity_type=task&entity_id=${taskRow.id}`);
check('the file is gone', left.length === 1 && left[0].path === 'diagram.svg', JSON.stringify(left.map(f=>f.path)));
await p.locator('button:has-text("Close")').click();
await p.waitForTimeout(500);

/* ════════════════════════════ tools ════════════════════════════ */
section('Building a tool');
const toolName = `Probe Tool ${stamp()}`;
await go('/tools');
check('the Tools page is reachable from the sidebar',
  (await p.locator('a:has-text("Tools")').count()) > 0);
await p.locator('button:has-text("New Tool")').first().click();
await p.waitForTimeout(600);
await D().locator('#f-name').fill(toolName);
await D().locator('#f-description').fill('A probe');
await p.locator('button:has-text("Create tool")').click();
await p.waitForTimeout(2000);
check('after creating, it asks for files', (await D().textContent() ?? '').includes('Files'));
check('a tool is offered folder upload', (await D().locator('button:has-text("Choose folder")').count()) === 1);

await D().locator('input[type=file]').first().setInputFiles([
  { name: 'index.html', mimeType: 'text/html',
    buffer: Buffer.from('<!doctype html><html><head><link rel=stylesheet href="style.css"></head><body><h1 id=h>Probe</h1><script src="app.js"></script></body></html>') },
  { name: 'style.css', mimeType: 'text/css', buffer: Buffer.from('h1{color:rgb(20,80,200)}') },
  { name: 'app.js', mimeType: 'text/javascript',
    buffer: Buffer.from('document.getElementById("h").textContent="Ran OK";') },
]);
await p.waitForTimeout(2400);
const fileList = await D().textContent();
check('all three files uploaded', ['index.html','style.css','app.js'].every(f => fileList.includes(f)));
await p.locator('button:has-text("Done")').click();
await p.waitForTimeout(1400);

section('Running the tool');
const card = p.locator('div.rounded-xl.border', { hasText: toolName }).first();
check('the card reports the file count', (await card.textContent()).includes('3 files'));
check('it offers Open', (await card.locator('a:has-text("Open")').count()) === 1);
await card.locator('a:has-text("Open")').click();
await p.waitForTimeout(2200);
check('the runner page opens', p.url().includes('/tools/'));

const frame = p.frameLocator('iframe');
check('the tool renders its HTML', (await frame.locator('h1').textContent()) === 'Ran OK',
  'the JS did not run, or the HTML did not load');
const colour = await frame.locator('h1').evaluate(el => getComputedStyle(el).color);
check('its stylesheet applied', colour === 'rgb(20, 80, 200)', colour);

section('The tool is sandboxed away from the app');
const sandbox = await p.locator('iframe').getAttribute('sandbox');
check('iframe is sandboxed', !!sandbox, String(sandbox));
check('scripts are allowed', sandbox.includes('allow-scripts'));
check('same-origin access is NOT granted', !sandbox.includes('allow-same-origin'), sandbox);
const reachedParent = await frame.locator('body').evaluate(() => {
  try { return !!window.parent.document; } catch { return false; }
});
check('the tool cannot read the page around it', reachedParent === false);
check('the page says it is sandboxed', (await p.locator('body').textContent()).includes('Sandboxed'));

section('Pinning puts a tool in the sidebar');
await go('/tools');
await p.locator(`button[aria-label="Pin ${toolName}"]`).click();
await p.waitForTimeout(1800);
check('a pinned tool appears in the sidebar',
  (await p.locator('aside').textContent()).includes(toolName));
await p.locator('aside').locator(`a:has-text("${toolName}")`).first().click();
await p.waitForTimeout(1600);
check('the sidebar shortcut opens it', p.url().includes('/tools/'));

await go('/tools');
await p.locator(`button[aria-label="Unpin ${toolName}"]`).click();
await p.waitForTimeout(1600);
check('unpinning removes the shortcut',
  !(await p.locator('aside').textContent()).includes(toolName));

section('Deleting a tool takes its files with it');
const tool = (await api('GET', '/api/tools?limit=200')).find(t => t.name === toolName);
await p.locator('div.rounded-xl.border', { hasText: toolName }).first()
  .locator(`button[aria-label="Delete ${toolName}"]`).click();
await p.waitForTimeout(500);
await D().locator('button:has-text("Delete")').last().click();
await p.waitForTimeout(1700);
check('the tool is gone', !(await p.locator('body').textContent()).includes(toolName));
const orphans = await api('GET', `/api/attachments?entity_type=tool&entity_id=${tool.id}`);
check('its files went with it', orphans.length === 0, `${orphans.length} left behind`);

/* cleanup */
await api('DELETE', `/api/tasks/${taskRow.id}`);

section('Console health');
const real = errors.filter(e => !/favicon|React DevTools|Failed to load resource.*40\d/i.test(e));
check('no uncaught console errors', real.length === 0, real.slice(0,3).join(' | '));

console.log(`\n${'='.repeat(56)}\n  ${BD}${pass} passed, ${fail} failed${X}\n${'='.repeat(56)}`);
if (failures.length) { console.log('Failed:'); failures.forEach(f => console.log('  -', f)); }
await b.close();
process.exit(fail ? 1 : 0);
