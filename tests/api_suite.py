"""Full backend suite: every endpoint, every method, plus validation and edge cases."""
import json, urllib.request, urllib.error, sys, time

RUN = str(int(time.time()))[-6:]

import os
B = os.environ.get("WCC_API", "http://localhost:8000")
ok = fail = 0
failures = []

def call(method, path, body=None):
    req = urllib.request.Request(B + path, method=method)
    req.add_header("Content-Type", "application/json")
    data = json.dumps(body).encode() if body is not None else None
    try:
        with urllib.request.urlopen(req, data, timeout=20) as r:
            raw = r.read().decode()
            try:
                return r.status, (json.loads(raw) if raw else None)
            except json.JSONDecodeError:
                return r.status, raw[:160]   # /docs returns HTML
    except urllib.error.HTTPError as e:
        raw = e.read().decode()
        try: return e.code, json.loads(raw)
        except: return e.code, raw[:160]

def check(name, cond, detail=""):
    global ok, fail
    if cond: ok += 1; print(f"  \033[32mPASS\033[0m  {name}")
    else:
        fail += 1; failures.append(name)
        print(f"  \033[31mFAIL\033[0m  {name}  {detail}")

def section(t): print(f"\n\033[1m{t}\033[0m")

ENTITIES = [
    ("tasks",       {"title": f"S task {RUN}", "priority": "P1_HIGH", "status": "PENDING"}, {"status": "IN_PROGRESS"}, "title"),
    ("followups",   {"title": f"S fu {RUN}", "waiting_for_type": "PERSON", "status": "WAITING"}, {"status": "RECEIVED"}, "title"),
    ("projects",    {"name": f"S proj {RUN}", "status": "PLANNED", "priority": "P2_MEDIUM"}, {"status": "ACTIVE"}, "name"),
    ("issues",      {"title": f"S issue {RUN}", "severity": "HIGH", "status": "OPEN"}, {"status": "RESOLVED"}, "title"),
    ("meetings",    {"title": f"S meet {RUN}", "participants": "A"}, {"decisions": "Ship"}, "title"),
    ("people",      {"name": f"S person {RUN}", "role": "Tester"}, {"role": "Lead"}, "name"),
    ("departments", {"name": f"S dept {RUN}"}, {"description": "d"}, "name"),
    ("vendors",     {"name": f"S vendor {RUN}", "type": "T"}, {"email": "v@e.com"}, "name"),
    ("systems",     {"name": f"S system {RUN}", "environment": "UAT"}, {"owner": "Ops"}, "name"),
    ("categories",  {"name": f"S cat {RUN}"}, {"description": "c"}, "name"),
]

section("Infrastructure")
for path, want in [("/health", 200), ("/", 200), ("/docs", 200), ("/openapi.json", 200)]:
    s, _ = call("GET", path); check(f"GET {path}", s == want, f"got {s}")

section("Read every collection")
for path in [e[0] for e in ENTITIES] + ["dashboard", "alerts"]:
    s, rows = call("GET", "/api/" + path)
    check(f"GET /api/{path}", s == 200, f"got {s}")

section("Dashboard shape")
s, d = call("GET", "/api/dashboard")
stats = (d or {}).get("stats", {})
for k in ["critical","followups_due","overdue","today","in_progress","blocked","forgotten","total_tasks","completed_today"]:
    check(f"dashboard.stats.{k}", k in stats and isinstance(stats[k], int), f"got {stats.get(k)!r}")

section("Alerts shape")
s, alerts = call("GET", "/api/alerts")
check("alerts is a list", isinstance(alerts, list))
if alerts:
    a = alerts[0]
    for k in ["id","type","title","description","severity","entity_id","entity_type"]:
        check(f"alert.{k}", k in a, f"missing from {list(a)}")
    check("severity is known", all(x["severity"] in ("critical","high","medium","low") for x in alerts))

section("Search")
for q, expect_list in [("visa", True), ("zzzznope", True), ("a", True)]:
    s, r = call("GET", f"/api/search?q={q}")
    check(f"search '{q}'", s == 200 and isinstance(r, list), f"got {s}")
s, r = call("GET", "/api/search?q=visa")
if r:
    check("search result shape", all("type" in x and "title" in x and "id" in x for x in r))

section("Full CRUD lifecycle, every entity")
for path, create, patch, label in ENTITIES:
    s, made = call("POST", "/api/" + path, create)
    if s != 200 or not isinstance(made, dict):
        check(f"POST /{path}", False, f"{s} {made}"); continue
    check(f"POST /{path}", True)
    i, original = made["id"], made[label]

    s, got = call("GET", f"/api/{path}/{i}")
    check(f"GET /{path}/{{id}}", s == 200 and got.get(label) == original, f"got {s}")

    field, want = list(patch.items())[0]
    s, up = call("PUT", f"/api/{path}/{i}", patch)
    check(f"PUT /{path} partial", s == 200 and up.get(field) == want, f"got {s} {up}")
    check(f"PUT /{path} preserves {label}", isinstance(up, dict) and up.get(label) == original, f"{label}={up.get(label)!r}")

    s, _ = call("DELETE", f"/api/{path}/{i}")
    check(f"DELETE /{path}", s == 200, f"got {s}")
    archives = path in ("people", "departments", "vendors", "systems")
    s, gone = call("GET", f"/api/{path}/{i}")
    if archives:
        check(f"{path}: archived, kept by id", s == 200 and gone.get("active") is False, f"got {s}")
        s, rows = call("GET", f"/api/{path}")
        check(f"{path}: archived row leaves the list", all(r["id"] != i for r in rows))
        s, rows = call("GET", f"/api/{path}?include_inactive=true")
        check(f"{path}: archived row visible on request", any(r["id"] == i for r in rows))
        s, back = call("PUT", f"/api/{path}/{i}", {"active": True})
        check(f"{path}: restore works", s == 200 and back.get("active") is True, f"got {s}")
        call("DELETE", f"/api/{path}/{i}")
    else:
        check(f"{path}: GET after DELETE -> 404", s == 404, f"got {s}")

section("Validation: required and blank")
for path, payload, why in [
    ("tasks", {}, "missing title"),
    ("tasks", {"title": ""}, "blank title"),
    ("tasks", {"title": "   "}, "whitespace title"),
    ("projects", {}, "missing name"),
    ("people", {"role": "x"}, "missing name"),
    ("categories", {"name": ""}, "blank name"),
]:
    s, r = call("POST", "/api/" + path, payload)
    msg = r.get("detail", "") if isinstance(r, dict) else str(r)
    check(f"{path}: {why} -> 422", s == 422, f"got {s}")
    check(f"{path}: {why} explains itself", isinstance(msg, str) and ("required" in msg.lower() or "blank" in msg.lower()), f"msg={msg!r}")

section("Validation: enums")
for path, payload, why in [
    ("tasks", {"title": "x", "status": "NOPE"}, "bad task status"),
    ("tasks", {"title": "x", "priority": "NOPE"}, "bad priority"),
    ("followups", {"title": "x", "waiting_for_type": "ALIEN"}, "bad waiting type"),
    ("followups", {"title": "x", "waiting_for_type": "PERSON", "status": "NOPE"}, "bad followup status"),
    ("projects", {"name": "x", "status": "NOPE"}, "bad project status"),
    ("issues", {"title": "x", "severity": "NOPE"}, "bad severity"),
    ("issues", {"title": "x", "status": "NOPE"}, "bad issue status"),
]:
    s, r = call("POST", "/api/" + path, payload)
    msg = r.get("detail", "") if isinstance(r, dict) else str(r)
    check(f"{why} -> 422", s == 422, f"got {s}")
    check(f"{why} lists valid values", "must be one of" in str(msg), f"msg={msg!r}")

section("Validation: enums on partial update too")
s, made = call("POST", "/api/tasks", {"title": "enum put"})
i = made["id"]
s, r = call("PUT", f"/api/tasks/{i}", {"status": "GARBAGE"})
check("PUT bad enum -> 422", s == 422, f"got {s}")
check("PUT bad enum message", "must be one of" in str(r.get("detail", "")), r)
call("DELETE", f"/api/tasks/{i}")

section("Validation: uniqueness")
s, r = call("POST", "/api/departments", {"name": "Network"})
check("duplicate department -> 409", s == 409, f"got {s}")
check("duplicate says already exists", "already exists" in str(r.get("detail","")).lower(), r)
s, r = call("POST", "/api/systems", {"name": "APIMS"})
check("duplicate system -> 409", s == 409, f"got {s}")

section("Validation: bad foreign keys")
for path, payload in [
    ("tasks", {"title": "fk", "project_id": 999999}),
    ("tasks", {"title": "fk", "responsible_person_id": 999999}),
    ("issues", {"title": "fk", "system_id": 999999}),
]:
    s, r = call("POST", "/api/" + path, payload)
    check(f"{path} bad FK -> 422", s == 422, f"got {s}")
    check(f"{path} bad FK is readable", "no longer exist" in str(r.get("detail","")).lower(), r)

section("404s on every entity")
for path, *_ in ENTITIES:
    for method, body in [("GET", None), ("PUT", {}), ("DELETE", None)]:
        s, _ = call(method, f"/api/{path}/999999", body)
        check(f"{method} /{path}/999999 -> 404", s == 404, f"got {s}")

section("Filters and pagination")
for path, q, verify in [
    ("tasks", "?status=IN_PROGRESS", lambda r: all(x["status"] == "IN_PROGRESS" for x in r)),
    ("tasks", "?priority=P0_CRITICAL", lambda r: all(x["priority"] == "P0_CRITICAL" for x in r)),
    ("tasks", "?limit=2", lambda r: len(r) <= 2),
    ("tasks", "?skip=1&limit=2", lambda r: len(r) <= 2),
    ("followups", "?status=WAITING", lambda r: all(x["status"] == "WAITING" for x in r)),
    ("issues", "?status=OPEN", lambda r: all(x["status"] == "OPEN" for x in r)),
    ("people", "?limit=500", lambda r: isinstance(r, list)),
]:
    s, r = call("GET", f"/api/{path}{q}")
    check(f"GET /{path}{q}", s == 200 and isinstance(r, list) and verify(r), f"got {s}")

section("Data integrity: completed_at, trimming")
s, made = call("POST", "/api/tasks", {"title": "  padded  "})
check("title trimmed on save", made.get("title") == "padded", made.get("title"))
i = made["id"]
s, up = call("PUT", f"/api/tasks/{i}", {"status": "COMPLETED"})
check("completed_at set on completion", up.get("completed_at") is not None, up.get("completed_at"))
s, up = call("PUT", f"/api/tasks/{i}", {"priority": "P3_LOW"})
check("completed_at survives later edits", up.get("completed_at") is not None)
call("DELETE", f"/api/tasks/{i}")

section("Relations resolve")
s, people = call("GET", "/api/people")
s, depts = call("GET", "/api/departments")
if people and depts:
    s, made = call("POST", "/api/tasks", {
        "title": "linked", "responsible_person_id": people[0]["id"], "department_id": depts[0]["id"]})
    check("task accepts valid FKs", s == 200 and made.get("responsible_person_id") == people[0]["id"], f"{s}")
    if s == 200: call("DELETE", f"/api/tasks/{made['id']}")

section("Cascade and linked-record behaviour")
s, t = call("POST", "/api/tasks", {"title": "cascade probe"})
tid = t["id"]
call("PUT", f"/api/tasks/{tid}", {"status": "IN_PROGRESS"})
call("PUT", f"/api/tasks/{tid}", {"status": "COMPLETED"})
s, _ = call("DELETE", f"/api/tasks/{tid}")
check("delete a task that has activity history", s == 200, f"got {s}")

s, c = call("POST", "/api/categories", {"name": "InUse Probe"})
cid = c["id"]
s, t = call("POST", "/api/tasks", {"title": "uses category", "category_id": cid})
tid = t["id"]
s, _ = call("DELETE", f"/api/categories/{cid}")
check("delete a category still in use", s == 200, f"got {s}")
s, still = call("GET", f"/api/tasks/{tid}")
check("its task survives, just uncategorised", s == 200 and still.get("category_id") is None, still.get("category_id"))
call("DELETE", f"/api/tasks/{tid}")

s, p_ = call("POST", "/api/projects", {"name": "Owner Probe"})
pid = p_["id"]
s, t = call("POST", "/api/tasks", {"title": "in project", "project_id": pid})
tid = t["id"]
s, _ = call("DELETE", f"/api/projects/{pid}")
check("delete a project that owns tasks", s == 200, f"got {s}")
call("DELETE", f"/api/tasks/{tid}")

section("Response tolerance")
s, rows = call("GET", "/api/tasks?limit=200")
check("task list survives odd stored rows", s == 200 and isinstance(rows, list), f"got {s}")

section("Unicode and long input")
s, t = call("POST", "/api/tasks", {"title": "Fix Visa → APIMS · ភាសាខ្មែរ · 日本語"})
check("unicode title round-trips", s == 200 and "ភាសាខ្មែរ" in t.get("title", ""), t)
if s == 200: call("DELETE", f"/api/tasks/{t['id']}")
s, r = call("POST", "/api/tasks", {"title": "x" * 300})
check("over-long title rejected", s == 422, f"got {s}")

section("Date handling — what the date pickers actually send")
DATE_CASES = [
    ("tasks", {"title": "date probe", "due_date": "2026-10-01"}, "due_date"),
    ("followups", {"title": "date probe", "waiting_for_type": "PERSON",
                   "requested_date": "2026-09-01", "expected_date": "2026-09-15"}, "expected_date"),
    ("projects", {"name": "date probe", "start_date": "2026-09-01", "target_date": "2026-12-01"}, "target_date"),
    ("issues", {"title": "date probe", "detected_at": "2026-09-01"}, "detected_at"),
    ("meetings", {"title": "date probe", "meeting_date": "2026-09-03"}, "meeting_date"),
]
for path, payload, field in DATE_CASES:
    s_, made = call("POST", "/api/" + path, payload)
    check(f"{path}: date picker value accepted", s_ == 200, f"got {s_} {made}")
    if s_ != 200: continue
    check(f"{path}: stored as midnight", str(made.get(field, "")).endswith("T00:00:00"), made.get(field))
    i = made["id"]
    s_, up = call("PUT", f"/api/{path}/{i}", {field: ""})
    check(f"{path}: clearing a date works", s_ == 200 and up.get(field) is None, f"got {s_} {up.get(field)}")
    s_, up = call("PUT", f"/api/{path}/{i}", {field: "2027-01-15"})
    check(f"{path}: updating a date works", s_ == 200 and str(up.get(field)).startswith("2027-01-15"), up.get(field))
    call("DELETE", f"/api/{path}/{i}")

s_, r = call("POST", "/api/tasks", {"title": "bad date", "due_date": "nonsense"})
check("nonsense date still rejected", s_ == 422, f"got {s_}")
s_, made = call("POST", "/api/tasks", {"title": "ts", "due_date": "2026-10-01T09:30:00"})
check("full timestamp still accepted", s_ == 200 and "09:30" in str(made.get("due_date")), made.get("due_date"))
if s_ == 200: call("DELETE", f"/api/tasks/{made['id']}")

print(f"\n{'='*52}\n  \033[1m{ok} passed, {fail} failed\033[0m\n{'='*52}")
if failures:
    print("Failed:"); [print("  -", f) for f in failures]
sys.exit(1 if fail else 0)
