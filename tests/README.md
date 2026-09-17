# Test suites

Nine suites, 1,025 checks, run against a live application.

| File | Checks | What it covers |
|---|---|---|
| `api_suite.py` | 229 | Every endpoint and method, all 10 entities' CRUD lifecycles, validation (required, blank, enums, uniqueness, foreign keys), 404s, filters, pagination, cascade behaviour, date handling, unicode, the meetings diary ordering and date window, and the issues severity ordering and filters |
| `ui_suite.mjs` | 171 | All 13 pages in a real browser: create/edit/delete through the forms, validation behaviour, archive/restore, unsaved-changes guard, filters, routing, keyboard, mobile layout, console errors, and that Tasks and Issues group most-urgent-first with their finished work folded away |
| `followups_suite.mjs` | 96 | The follow-ups page in depth: all three waiting-for types, all five statuses, quick actions, the four dates, overdue signalling, alert rules, field-level update integrity |
| `features_suite.mjs` | 42 | Detail views, file uploads to tasks, tool folders, the sandboxed tool runner, pinning |
| `sync_suite.mjs` | 25 | Live data: a Directory record created, renamed, archived, restored or deleted must reach every form that references it without a page refresh |
| `calendar_suite.py` | 96 | Calendar sync against a feed the suite serves itself: recurrence expansion, idempotence, the edit-protection rule, the delete guard, cancellation instead of deletion, disconnecting, timezone conversion (including changing a calendar's zone after the fact), and the automatic-sync schedule — due/not-due, the off switch, interval limits, and the failure backoff. The Microsoft path is checked as far as its own boundary — the Graph calls themselves are not exercised (see the note below) |
| `calendar_ui_suite.mjs` | 61 | The same journey through the browser: connecting, testing, syncing, editing a synced meeting, releasing a field, disconnecting, a background sync appearing in an open page without a reload, the agenda's grouping, scope filter and search, and a browser running at UTC+7 to prove a 03:30Z meeting reads as 10:30 |
| `knowledge_suite.py` | 196 | Knowledge articles including images and Word import (a .docx is built in the test and converted: headings, bullets, numbered steps, bold, a table whose real header survives, and an embedded figure that becomes a resolvable attachment), the server inventory, the credential vault and the agent interface — including the claims each module makes about itself: that no read endpoint returns a password, that every touch of one is logged, that the vault refuses to work without a key rather than falling back, that a changed key says so instead of returning nothing, and that the agent cannot reach a credential by any tool, any argument, or any import |
| `knowledge_ui_suite.mjs` | 109 | The same two pages in a browser: writing a runbook and getting it back as rendered markdown, finding it by words in any order, saying it still works, and — on Servers — storing a password without it appearing on screen or in the page source, revealing it deliberately, reading the access log that records both, opening an account in a desktop client (asserting the password really is on the clipboard and really is not in the downloaded .rdp), and grouping a multi-node estate by service so a DR node sits with its DC siblings. Also pastes a real PNG through a real ClipboardEvent and checks it becomes an attachment reference rather than a base64 blob in the row, and that every value on a server row copies on click while a web link stored in the IP field opens on double-click — with noopener, and never for a `javascript:` value |

## Running them

Start the app first:

```bash
docker compose up -d
```

**API suite** — no dependencies beyond Python:

```bash
WCC_API=http://localhost:8000 python3 tests/api_suite.py
WCC_API=http://localhost:8000 python3 tests/calendar_suite.py
```

The knowledge suite also needs the two keys the app reads from its environment.
It adapts if `WCC_VAULT_KEY` is absent — checking that storing a password is
refused rather than that it works — but it needs `WCC_AGENT_KEY` to match:

```bash
WCC_API=http://localhost:8000 WCC_AGENT_KEY=<the one the API has> \
  python3 tests/knowledge_suite.py
```

**Browser suites** — need Playwright once:

```bash
npm install -D playwright && npx playwright install chromium

WCC_URL=http://localhost:3000 node tests/ui_suite.mjs
WCC_URL=http://localhost:3000 node tests/followups_suite.mjs
WCC_URL=http://localhost:3000 node tests/sync_suite.mjs
WCC_URL=http://localhost:3000 node tests/features_suite.mjs
WCC_URL=http://localhost:3000 node tests/calendar_ui_suite.mjs
WCC_URL=http://localhost:3000 node tests/knowledge_ui_suite.mjs
```

Each exits non-zero on failure, so they drop straight into CI.

## Notes

The suites create records with recognisable names (`S task 123456`, `UI Vendor 123456`,
`FU switch 123456`) and delete them as they finish. Names carry a per-run suffix
because archived master-data rows keep their names and would otherwise collide on
a second run.


## A note on the Microsoft path

`calendar_suite.py` drives the ICS provider end to end against a feed it serves
on localhost, and both providers share one sync engine — so the rules that
matter (edit protection, the delete guard, cancel-don't-delete) are genuinely
covered.

What is **not** covered is Microsoft Graph itself: device-code sign-in, token
refresh and `/me/calendarView`. Exercising those needs an app registration in a
real tenant, which no test here can create. The suite checks the code up to that
boundary — that syncing before sign-in explains itself, that sign-in is refused
for the wrong provider type, that no token is ever returned to the browser — and
stops. **The Microsoft route has to be tested by hand, once, on the machine that
has the app registration.** `CALENDAR.md` lists the errors to expect and what
each one means.
