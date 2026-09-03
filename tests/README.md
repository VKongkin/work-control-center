# Test suites

Three suites, 468 checks, run against a live application.

| File | Checks | What it covers |
|---|---|---|
| `api_suite.py` | 217 | Every endpoint and method, all 10 entities' CRUD lifecycles, validation (required, blank, enums, uniqueness, foreign keys), 404s, filters, pagination, cascade behaviour, date handling, unicode |
| `ui_suite.mjs` | 155 | All 13 pages in a real browser: create/edit/delete through the forms, validation behaviour, archive/restore, unsaved-changes guard, filters, routing, keyboard, mobile layout, console errors |
| `followups_suite.mjs` | 96 | The follow-ups page in depth: all three waiting-for types, all five statuses, quick actions, the four dates, overdue signalling, alert rules, field-level update integrity |

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
```

Each exits non-zero on failure, so they drop straight into CI.

## Notes

The suites create records with recognisable names (`S task 123456`, `UI Vendor 123456`,
`FU switch 123456`) and delete them as they finish. Names carry a per-run suffix
because archived master-data rows keep their names and would otherwise collide on
a second run.
