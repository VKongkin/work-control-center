# Test suites

Seven suites, 637 checks, run against a live application.

| File | Checks | What it covers |
|---|---|---|
| `api_suite.py` | 217 | Every endpoint and method, all 10 entities' CRUD lifecycles, validation (required, blank, enums, uniqueness, foreign keys), 404s, filters, pagination, cascade behaviour, date handling, unicode |
| `ui_suite.mjs` | 156 | All 13 pages in a real browser: create/edit/delete through the forms, validation behaviour, archive/restore, unsaved-changes guard, filters, routing, keyboard, mobile layout, console errors |
| `followups_suite.mjs` | 96 | The follow-ups page in depth: all three waiting-for types, all five statuses, quick actions, the four dates, overdue signalling, alert rules, field-level update integrity |
| `features_suite.mjs` | 42 | Detail views, file uploads to tasks, tool folders, the sandboxed tool runner, pinning |
| `sync_suite.mjs` | 25 | Live data: a Directory record created, renamed, archived, restored or deleted must reach every form that references it without a page refresh |
| `calendar_suite.py` | 60 | Calendar sync against a feed the suite serves itself: recurrence expansion, idempotence, the edit-protection rule, the delete guard, cancellation instead of deletion, disconnecting. The Microsoft path is checked as far as its own boundary — the Graph calls themselves are not exercised (see the note below) |
| `calendar_ui_suite.mjs` | 41 | The same journey through the browser: connecting, testing, syncing, editing a synced meeting, releasing a field, disconnecting |

## Running them

Start the app first:

```bash
docker compose up -d
```

**API suite** — no dependencies beyond Python:

```bash
WCC_API=http://localhost:8000 python3 tests/api_suite.py
```

**Browser suites** — need Playwright once:

```bash
npm install -D playwright && npx playwright install chromium

WCC_URL=http://localhost:3000 node tests/ui_suite.mjs
WCC_URL=http://localhost:3000 node tests/followups_suite.mjs
WCC_URL=http://localhost:3000 node tests/sync_suite.mjs
WCC_URL=http://localhost:3000 node tests/features_suite.mjs
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
