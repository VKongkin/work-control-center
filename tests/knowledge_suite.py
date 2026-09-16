"""Knowledge, the server/credential vault, and the Copilot agent interface.

The security claims these modules make in their docstrings are the reason this
suite exists. A docstring saying "secrets are structurally unreachable from the
agent" is a comment; the tests below are the part that can fail.

Needs the API running with WCC_VAULT_KEY and WCC_AGENT_KEY set. Point it with:

    WCC_API=http://localhost:8012 WCC_AGENT_KEY=... python3 tests/knowledge_suite.py
"""
import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.request
from datetime import date

RUN = str(int(time.time()))[-6:]
B = os.environ.get("WCC_API", "http://localhost:8000")
AGENT_KEY = os.environ.get("WCC_AGENT_KEY", "test-agent-key-123")
BACKEND = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "backend")

# A password nobody would produce by accident, so that finding it anywhere it
# does not belong is proof rather than coincidence.
CANARY = f"canary-{RUN}-Xq7!vault"

ok = fail = 0
failures = []


def call(method, path, body=None, headers=None):
    req = urllib.request.Request(B + path, method=method)
    req.add_header("Content-Type", "application/json")
    for k, v in (headers or {}).items():
        req.add_header(k, v)
    data = json.dumps(body).encode() if body is not None else None
    try:
        with urllib.request.urlopen(req, data, timeout=20) as r:
            raw = r.read().decode()
            try:
                return r.status, (json.loads(raw) if raw else None)
            except json.JSONDecodeError:
                return r.status, raw[:200]
    except urllib.error.HTTPError as e:
        raw = e.read().decode()
        try:
            return e.code, json.loads(raw)
        except json.JSONDecodeError:
            return e.code, raw[:200]


def check(name, cond, detail=""):
    global ok, fail
    if cond:
        ok += 1
        print(f"  \033[32mPASS\033[0m  {name}")
    else:
        fail += 1
        failures.append(name)
        print(f"  \033[31mFAIL\033[0m  {name}  {detail}")


def section(t):
    print(f"\n\033[1m{t}\033[0m")


def agent(method, params=None, key=AGENT_KEY, rid=1):
    """One JSON-RPC call to the MCP endpoint."""
    body = {"jsonrpc": "2.0", "id": rid, "method": method}
    if params is not None:
        body["params"] = params
    return call("POST", "/api/agent/mcp", body, {"X-API-Key": key} if key else {})


def tool(name, args=None):
    s, r = agent("tools/call", {"name": name, "arguments": args or {}})
    if s != 200 or not isinstance(r, dict):
        return s, r, None
    content = (r.get("result") or {}).get("content") or []
    text = content[0].get("text") if content else None
    try:
        return s, r, json.loads(text) if text else None
    except (json.JSONDecodeError, TypeError):
        return s, r, text


made_articles, made_servers = [], []


# ===================================================================== knowledge
section("Knowledge: the basics")

s, art = call("POST", "/api/knowledge", {
    "title": f"KB Restart WebSphere on the MBS nodes {RUN}",
    "kind": "RUNBOOK",
    "status": "PUBLISHED",
    "environment": "DC",
    "summary": "Graceful restart without dropping in-flight transactions.",
    "tags": f"was,mbs,kb{RUN}",
    "body": "# Steps\n\n1. Stop the node agent\n2. Stop the server\n",
})
check("create an article", s == 200 and art.get("id"), f"{s} {art}")
aid = art.get("id") if s == 200 else None
if aid:
    made_articles.append(aid)

s, got = call("GET", f"/api/knowledge/{aid}")
check("read it back", s == 200 and got["title"] == art["title"], f"got {s}")

s, rows = call("GET", "/api/knowledge?limit=500")
check("it is in the list", s == 200 and any(r["id"] == aid for r in rows), f"got {s}")

s, upd = call("PUT", f"/api/knowledge/{aid}", {"status": "DRAFT"})
check("update a field", s == 200 and upd["status"] == "DRAFT", f"{s} {upd}")
call("PUT", f"/api/knowledge/{aid}", {"status": "PUBLISHED"})

s, r = call("GET", "/api/knowledge/999999")
check("a missing article is a 404, not a 500", s == 404, f"got {s}")

section("Knowledge: finding it again six months later")

# The failure this replaces: search matched the literal phrase, so "websphere
# restart" found nothing in "Restart WebSphere on the MBS nodes". Nobody
# remembers the word order of a runbook they wrote in March.
s, rows = call("GET", f"/api/knowledge?limit=500&q=websphere%20restart")
check("words match in any order", s == 200 and any(r["id"] == aid for r in rows),
      f"got {s} {[r['title'] for r in (rows or [])][:3]}")

s, rows = call("GET", "/api/knowledge?limit=500&q=restart%20websphere")
check("and in the other order", any(r["id"] == aid for r in (rows or [])))

s, rows = call("GET", f"/api/knowledge?limit=500&q=kb{RUN}")
check("a tag finds it", any(r["id"] == aid for r in (rows or [])))

s, rows = call("GET", "/api/knowledge?limit=500&q=in-flight")
check("a word from the summary finds it", any(r["id"] == aid for r in (rows or [])))

s, rows = call("GET", "/api/knowledge?limit=500&q=node%20agent")
check("a word from the body finds it", any(r["id"] == aid for r in (rows or [])))

s, rows = call("GET", "/api/knowledge?limit=500&q=websphere%20kubernetes")
check("every word has to match, not any", not any(r["id"] == aid for r in (rows or [])),
      "an unrelated extra word still matched")

s, rows = call("GET", "/api/knowledge?limit=500&kind=RUNBOOK")
check("the kind filter narrows it", all(r["kind"] == "RUNBOOK" for r in (rows or [])))

s, rows = call("GET", "/api/knowledge?limit=500&kind=NOTE")
check("and excludes other kinds", not any(r["id"] == aid for r in (rows or [])))

s, rows = call("GET", "/api/knowledge?limit=500&environment=DC")
check("the environment filter narrows it", any(r["id"] == aid for r in (rows or [])))

s, tags = call("GET", "/api/knowledge/meta/tags")
check("known tags are collected for autocomplete",
      s == 200 and f"kb{RUN}" in tags, f"got {s}")

section("Knowledge: is this runbook still true?")

s, before = call("GET", f"/api/knowledge/{aid}")
check("a new runbook has never been verified", before.get("last_verified_at") is None,
      str(before.get("last_verified_at")))

s, after = call("POST", f"/api/knowledge/{aid}/verified")
stamped = str(after.get("last_verified_at") or "")[:10] if s == 200 else ""
check("marking it verified stamps today", s == 200 and stamped == date.today().isoformat(),
      f"{s} got {stamped!r}")


# ======================================================================= servers
section("Servers: inventory")

s, vs = call("GET", "/api/servers/vault-status")
check("vault status is reported", s == 200 and "configured" in (vs or {}), f"{s} {vs}")
vault_on = bool((vs or {}).get("configured"))
if not vault_on:
    print("  \033[33mNOTE\033[0m  WCC_VAULT_KEY is not set on the API; "
          "the password tests below check the refusal path instead.")

s, srv = call("POST", "/api/servers", {
    "name": f"KB MBS-APP-01 {RUN}",
    "hostname": f"mbsapp01-{RUN}.bank.local",
    "ip_address": "10.20.4.11",
    "environment": "DC",
    "os": "RHEL 8.6",
    "role": "WebSphere ND 9.0.5",
})
check("create a server", s == 200 and srv.get("id"), f"{s} {srv}")
sid = srv.get("id") if s == 200 else None
if sid:
    made_servers.append(sid)

s, rows = call("GET", "/api/servers?limit=500&environment=DC")
check("the environment filter narrows it", any(r["id"] == sid for r in (rows or [])))

s, rows = call("GET", "/api/servers?limit=500&environment=DR")
check("and excludes other environments", not any(r["id"] == sid for r in (rows or [])))

s, rows = call("GET", f"/api/servers?limit=500&q=websphere%20mbsapp01-{RUN}")
check("search matches words across name, hostname and role",
      any(r["id"] == sid for r in (rows or [])), f"got {s}")

s, acct = call("POST", f"/api/servers/{sid}/accounts", {
    "username": "wasadmin",
    "account_type": "APPLICATION",
    "purpose": "WebSphere console",
    "vault_location": "CyberArk safe MW-PROD",
})
check("create an account on it", s == 200 and acct.get("id"), f"{s} {acct}")
acid = acct.get("id") if s == 200 else None
if not acid:
    # Everything below needs an account. Without one the rest would report
    # thirty confusing failures instead of the single real one above.
    print("\n\033[31mCannot continue without an account.\033[0m")
    sys.exit(1)

check("a new account has no password", acct.get("has_secret") is False, str(acct))
check("the ciphertext column is absent from the response, not null",
      "secret_ciphertext" not in (acct or {}),
      f"keys: {sorted((acct or {}).keys())}")

section("Servers: storing a password")

s, r = call("PUT", f"/api/servers/accounts/{acid}/secret", {"secret": CANARY})
if vault_on:
    check("storing a password succeeds", s == 200 and r.get("has_secret") is True, f"{s} {r}")
    check("the response still does not carry the ciphertext",
          "secret_ciphertext" not in (r or {}), f"keys: {sorted((r or {}).keys())}")
    check("it is marked readable while the key is present", r.get("secret_readable") is True)
    check("storing stamps the rotation date", bool(r.get("last_rotated_at")))
else:
    check("storing is refused with a 409 when no key is set", s == 409, f"got {s}")

s, rows = call("GET", f"/api/servers/{sid}/accounts")
blob = json.dumps(rows)
check("listing accounts never returns the password", CANARY not in blob)
check("listing accounts never returns the ciphertext", "secret_ciphertext" not in blob)
check("but it does say whether one exists",
      rows and rows[0].get("has_secret") is (True if vault_on else False), str(rows))

s, one = call("GET", f"/api/servers/{sid}")
check("the server record itself carries no credential", CANARY not in json.dumps(one))

section("Servers: reading it back, on the record")

s, rev = call("POST", f"/api/servers/accounts/{acid}/reveal?reason=suite%20check")
if vault_on:
    check("reveal returns the password", s == 200 and rev.get("secret") == CANARY,
          f"{s} {str(rev)[:120]}")
    check("reveal names the account it belongs to", (rev or {}).get("username") == "wasadmin")
else:
    check("reveal is refused with a 409 when no key is set", s in (409, 404), f"got {s}")

s, log = call("GET", f"/api/servers/accounts/{acid}/access-log")
actions = [r["action"] for r in (log or [])]
check("every touch is logged", s == 200 and len(actions) >= 1, f"{s} {actions}")
if vault_on:
    check("the log records the write", "SET" in actions, str(actions))
    check("the log records the read", "REVEAL" in actions, str(actions))
    check("the log keeps the reason given",
          any((r.get("detail") or "").startswith("suite check") for r in log), str(log[:2]))
else:
    check("a refused write is still logged", "DENIED" in actions, str(actions))
check("the log itself never contains the password", CANARY not in json.dumps(log))

section("Servers: clearing it")

s, r = call("PUT", f"/api/servers/accounts/{acid}/secret", {"secret": ""})
check("clearing succeeds with or without a key", s == 200, f"{s} {r}")
check("and the account reports no password", (r or {}).get("has_secret") is False, str(r))

s, rev = call("POST", f"/api/servers/accounts/{acid}/reveal")
check("revealing a cleared password is a 404, not an empty string", s == 404, f"got {s}")

s, log = call("GET", f"/api/servers/accounts/{acid}/access-log")
if vault_on:
    check("clearing is logged too", "CLEAR" in [r["action"] for r in (log or [])],
          str([r["action"] for r in (log or [])]))

# Put it back for the agent sweep below - the point of that sweep is that a real
# stored password does not surface anywhere it should not.
if vault_on:
    call("PUT", f"/api/servers/accounts/{acid}/secret", {"secret": CANARY})


# ========================================================================= agent
section("Agent: nobody gets in without the key")

s, r = call("GET", "/api/agent/status")
check("status is readable without a key, so setup can be checked", s == 200, f"got {s}")
check("status does not hand out the key itself",
      AGENT_KEY not in json.dumps(r or {}), str(r))

s, r = agent("tools/list", key=None)
check("no key is a 401", s == 401, f"got {s}")

s, r = agent("tools/list", key="wrong-key-entirely")
check("a wrong key is a 401", s == 401, f"got {s}")

s, r = call("POST", "/api/agent/tools/search_knowledge", {"query": "x"})
check("the REST shape is protected too", s == 401, f"got {s}")

# Clients are split on which header they send. LM Studio's own mcp.json example
# uses Authorization: Bearer, and its config is quoted verbatim in COPILOT.md,
# so both have to keep working.
s, r = call("POST", "/api/agent/mcp", {"jsonrpc": "2.0", "id": 1, "method": "tools/list"},
            {"Authorization": f"Bearer {AGENT_KEY}"})
check("the key is accepted as a bearer token too",
      s == 200 and "result" in (r or {}), f"{s} {str(r)[:120]}")

s, r = call("POST", "/api/agent/mcp", {"jsonrpc": "2.0", "id": 1, "method": "tools/list"},
            {"Authorization": "Bearer not-the-key"})
check("but only the right one", s == 401, f"got {s}")

section("Agent: it speaks MCP")

s, r = agent("initialize", {"protocolVersion": "2025-06-18", "capabilities": {}})
res = (r or {}).get("result") or {}
check("initialize is answered", s == 200 and res.get("protocolVersion"), f"{s} {r}")
check("it names itself", (res.get("serverInfo") or {}).get("name"), str(res))

s, r = agent("ping")
check("ping is answered", s == 200 and "result" in (r or {}), f"{s} {r}")

# Every client sends this straight after the handshake and expects no reply.
# Answering `null` with a 200 looks malformed to a strict client and can drop
# the connection before the first tool call.
req = urllib.request.Request(B + "/api/agent/mcp", method="POST")
req.add_header("Content-Type", "application/json")
req.add_header("X-API-Key", AGENT_KEY)
with urllib.request.urlopen(
        req, json.dumps({"jsonrpc": "2.0", "method": "notifications/initialized"}).encode(),
        timeout=20) as resp:
    code, payload = resp.status, resp.read()
check("a notification gets 202 and an empty body, not a null",
      code == 202 and payload == b"", f"{code} {payload[:40]!r}")

s, r = call("POST", "/api/agent/mcp",
            [{"jsonrpc": "2.0", "id": 7, "method": "ping"},
             {"jsonrpc": "2.0", "method": "notifications/initialized"}],
            {"X-API-Key": AGENT_KEY})
check("a batch answers the requests and drops the notifications",
      s == 200 and isinstance(r, list) and len(r) == 1 and r[0].get("id") == 7, f"{s} {r}")

s, r = agent("tools/list")
tools = [t["name"] for t in ((r or {}).get("result") or {}).get("tools", [])]
check("tools are listed", s == 200 and len(tools) >= 8, f"{s} {tools}")
for name in ["search_knowledge", "get_knowledge", "create_knowledge", "update_knowledge",
             "list_tasks", "create_task", "update_task", "list_servers"]:
    check(f"tool {name} is offered", name in tools, str(tools))

check("every tool has a description Copilot can read",
      all(t.get("description") for t in ((r or {}).get("result") or {}).get("tools", [])))
check("every tool declares a schema",
      all(t.get("inputSchema", {}).get("type") == "object"
          for t in ((r or {}).get("result") or {}).get("tools", [])))

s, r = agent("nonsense/method")
check("an unknown method is a JSON-RPC error, not a crash",
      s == 200 and "error" in (r or {}), f"{s} {r}")

s, r, _ = tool("no_such_tool")
check("an unknown tool is an error, not a crash",
      "error" in (r or {}) or ((r or {}).get("result") or {}).get("isError"), str(r)[:160])

section("Agent: it can actually do the work")

s, r, out = tool("search_knowledge", {"query": "websphere restart"})
found = [a["id"] for a in (out or {}).get("results", [])]
check("the agent finds the runbook", aid in found, f"{s} {str(out)[:160]}")

s, r, out = tool("get_knowledge", {"id": aid})
check("the agent can read one in full", (out or {}).get("body", "").startswith("# Steps"),
      str(out)[:160])

s, r, out = tool("create_knowledge", {
    "title": f"KB agent-written note {RUN}",
    "kind": "NOTE",
    "body": "Original line.",
    "tags": f"kb{RUN}",
})
new_id = (out or {}).get("id")
check("the agent can write a note", bool(new_id), str(out)[:160])
if new_id:
    made_articles.append(new_id)

s, got = call("GET", f"/api/knowledge/{new_id}")
check("and it is a real article, visible in the UI's API", s == 200, f"got {s}")

s, r, out = tool("update_knowledge", {"id": new_id, "append": "\n\nSecond line."})
body = (out or {}).get("body", "")
check("appending keeps what was already there",
      "Original line." in body and "Second line." in body, repr(body)[:160])

s, r, out = tool("create_task", {"title": f"KB agent task {RUN}", "priority": "P1_HIGH"})
tid = (out or {}).get("id")
check("the agent can raise a task", bool(tid), str(out)[:160])

# Anything Copilot creates lands in the inbox to be triaged, rather than
# appearing in the active list as though it had been thought about.
check("an agent-raised task starts in the inbox", (out or {}).get("status") == "INBOX",
      str(out)[:160])

s, r, out = tool("list_tasks", {"query": f"KB agent task {RUN}"})
check("the agent can list tasks",
      any(t["id"] == tid for t in (out or {}).get("results", [])), str(out)[:200])

s, r, out = tool("update_task", {"id": tid, "status": "COMPLETED"})
check("the agent can close a task", (out or {}).get("status") == "COMPLETED", str(out)[:160])

s, r, out = tool("create_task", {"title": f"KB bad date {RUN}", "due_date": "next tuesday"})
check("a date it made up is refused clearly, not stored as garbage",
      "error" in (r or {}) or ((r or {}).get("result") or {}).get("isError"),
      str(r)[:200])

s, rest = call("POST", "/api/agent/tools/search_knowledge",
               {"query": "websphere restart"}, {"X-API-Key": AGENT_KEY})
check("the same work is reachable in the plain REST shape Copilot plugins use",
      s == 200 and any(a["id"] == aid for a in (rest or {}).get("results", [])),
      f"{s} {str(rest)[:160]}")

s, spec = call("GET", "/api/agent/openapi.json")
check("an OpenAPI document is published for the plugin route",
      s == 200 and spec.get("openapi", "").startswith("3."), f"{s} {str(spec)[:120]}")
paths = list((spec or {}).get("paths", {}).keys())
check("it describes the tools", any("search_knowledge" in p for p in paths), str(paths)[:200])

section("Agent: a wrong argument must not kill the conversation")

# What this replaces: priority "high" raised inside SQLAlchemy, escaped as a
# bare HTTP 500 with a plain-text body, and the client - having received
# something it could not parse as JSON-RPC - stopped for the rest of the
# session. A tool that refuses an argument has to say so *in a result*.
MODEL_ISH = [
    ("a lowercase priority", {"title": "AG p1", "priority": "high"}),
    ("a plain-English priority", {"title": "AG p2", "priority": "URGENT"}),
    ("a status from another tracker", {"title": "AG s1", "status": "TODO"}),
    ("a status in words", {"title": "AG s2", "status": "in progress"}),
    ("a date with a Z on it", {"title": "AG d1", "due_date": "2026-09-30T14:00:00Z"}),
    ("a date-only string", {"title": "AG d2", "due_date": "2026-09-30"}),
    ("a relative date", {"title": "AG d3", "due_date": "next Friday"}),
    ("a missing title", {"priority": "P1_HIGH"}),
    ("a field that does not exist", {"title": "AG x1", "assignee": "me"}),
    ("a value that is simply wrong", {"title": "AG x2", "priority": "banana"}),
    ("a title longer than the column", {"title": "AG " + "x" * 600}),
]
made_tasks = []
for label, args in MODEL_ISH:
    st, resp = call("POST", "/api/agent/mcp",
                    {"jsonrpc": "2.0", "id": 5, "method": "tools/call",
                     "params": {"name": "create_task", "arguments": args}},
                    {"X-API-Key": AGENT_KEY})
    parsed = isinstance(resp, dict) and ("result" in resp or "error" in resp)
    check(f"{label} still returns a usable JSON-RPC reply",
          st == 200 and parsed, f"HTTP {st} {str(resp)[:90]}")
    rid = ((resp or {}).get("result") or {}).get("structuredContent", {})
    if isinstance(rid, dict) and rid.get("id"):
        made_tasks.append(rid["id"])

# The friendly ones should succeed outright, not merely fail politely.
def made(args):
    s, r, out = tool("create_task", args)
    if isinstance(out, dict) and out.get("id"):
        made_tasks.append(out["id"])
    return out

out = made({"title": f"AG norm {RUN}", "priority": "high"})
check("'high' is understood as P1_HIGH", (out or {}).get("priority") == "P1_HIGH", str(out)[:120])
out = made({"title": f"AG norm2 {RUN}", "priority": "urgent", "status": "todo"})
check("'urgent' becomes P0_CRITICAL", (out or {}).get("priority") == "P0_CRITICAL", str(out)[:120])
check("'todo' becomes INBOX", (out or {}).get("status") == "INBOX", str(out)[:120])
out = made({"title": f"AG norm3 {RUN}", "status": "in progress"})
check("'in progress' becomes IN_PROGRESS", (out or {}).get("status") == "IN_PROGRESS", str(out)[:120])
out = made({"title": f"AG norm4 {RUN}", "due_date": "2026-09-30T14:00:00Z"})
check("a trailing Z on a date is tolerated", bool((out or {}).get("due_date")), str(out)[:120])

# And the unfriendly ones have to teach the model how to retry.
s, r, out = tool("create_task", {"title": "AG bad", "priority": "banana"})
msg = str(((r or {}).get("result") or {}).get("content", [{}])[0].get("text", ""))
check("an unusable value names the ones that would work",
      "P1_HIGH" in msg and "banana" in msg, msg[:160])

s, r, out = tool("create_task", {"due_date": "2026-09-30"})
msg = str(((r or {}).get("result") or {}).get("content", [{}])[0].get("text", ""))
check("a missing argument is explained without Python jargon",
      "title" in msg and "positional" not in msg, msg[:160])

s, r, out = tool("create_task", {"title": "AG rel", "due_date": "next Friday"})
msg = str(((r or {}).get("result") or {}).get("content", [{}])[0].get("text", ""))
check("a relative date is told what format to use",
      "YYYY-MM-DD" in msg, msg[:160])

# Whatever went wrong, the next call has to work. A poisoned session would look
# exactly like the agent "giving up".
s, r, out = tool("list_tasks", {"limit": 1})
check("the connection still works after every one of those",
      s == 200 and isinstance(out, dict) and "results" in out, str(out)[:120])

section("Agent: what the client reads before it starts")

s, r = agent("initialize", {"protocolVersion": "2025-06-18", "capabilities": {}})
inst = ((r or {}).get("result") or {}).get("instructions", "")
check("the server tells the client how to use it", len(inst) > 200, f"{len(inst)} chars")
check("including that a failed call should be retried, not abandoned",
      "isError" in inst and "again" in inst, inst[:160])
check("and that ids come from list_tasks rather than imagination",
      "list_tasks" in inst, inst[:160])

s, r = agent("tools/list")
listed = ((r or {}).get("result") or {}).get("tools", [])
for t in listed:
    props = t["inputSchema"].get("properties", {})
    for field in ("status", "priority"):
        if field in props and t["name"] in ("create_task", "update_task", "list_tasks"):
            check(f"{t['name']}.{field} tells the model its allowed values",
                  "enum" in props[field], str(props[field])[:80])

# Clients probe for these whether or not they are advertised.
for method, key in (("resources/list", "resources"), ("prompts/list", "prompts")):
    s, r = agent(method)
    check(f"{method} answers with an empty list rather than an error",
          s == 200 and key in ((r or {}).get("result") or {}), str(r)[:110])

for i in made_tasks:
    call("DELETE", f"/api/tasks/{i}")

section("Agent: the secrets are not in there, structurally")

# The claim under test: the agent cannot hand a password to Copilot. Not
# "is configured not to" - cannot, because no path to one exists.
s, r, out = tool("list_servers", {})
blob = json.dumps(out)
check("the agent can see the inventory",
      any(sv["id"] == sid for sv in (out or {}).get("results", [])), str(out)[:200])
check("the inventory carries no password", CANARY not in blob)
check("the inventory carries no ciphertext", "secret_ciphertext" not in blob)
check("accounts are left out by default", (out or {}).get("accounts_included") is False,
      str(out)[:120])
check("and so account names are absent",
      "wasadmin" not in blob, blob[:200])

# Sweep: call every tool the agent offers and look for the canary in the reply.
s, r = agent("tools/list")
every = [t["name"] for t in ((r or {}).get("result") or {}).get("tools", [])]
leaked = []
for name in every:
    for args in ({}, {"query": CANARY}, {"query": "wasadmin"}, {"id": acid}, {"id": sid}):
        st, resp = call("POST", "/api/agent/mcp",
                        {"jsonrpc": "2.0", "id": 9, "method": "tools/call",
                         "params": {"name": name, "arguments": args}},
                        {"X-API-Key": AGENT_KEY})
        if CANARY in json.dumps(resp):
            leaked.append(f"{name}{args}")
check("no tool, called any way, returns the stored password", not leaked, str(leaked))

check("no tool is even named after credentials",
      not any(w in n for n in every for w in ("secret", "password", "credential", "reveal")),
      str(every))

src = open(os.path.join(BACKEND, "app", "api", "agent.py")).read()
check("the agent module does not import the vault",
      "services.vault" not in src and "import vault" not in src)

# Read the module as code rather than as text: the docstring at the top says
# the word "secret_ciphertext" precisely in order to forbid it, and a grep
# cannot tell that apart from an attribute access.
import ast
tree = ast.parse(src)
touches = [n for n in ast.walk(tree)
           if (isinstance(n, ast.Attribute) and n.attr == "secret_ciphertext")
           or (isinstance(n, ast.Name) and n.id == "secret_ciphertext")]
check("no code in the agent module reads the ciphertext column",
      not touches, f"{len(touches)} reference(s)")

# Anything the module can reach, a future tool could reach by accident.
imported = {a.name for n in ast.walk(tree) if isinstance(n, ast.Import) for a in n.names}
imported |= {n.module or "" for n in ast.walk(tree) if isinstance(n, ast.ImportFrom)}
check("nothing it imports leads to the vault",
      not any("vault" in m for m in imported), str(sorted(imported)))

# The plugin manifest is what Copilot reads to decide what it may call, so the
# routes and parameters are what matter - the prose may well mention passwords,
# since it says they are not available.
surface = json.dumps({
    "paths": list((spec or {}).get("paths", {}).keys()),
    "operations": [op.get("operationId")
                   for p in (spec or {}).get("paths", {}).values()
                   for op in p.values() if isinstance(op, dict)],
    "schemas": list(((spec or {}).get("components", {}).get("schemas") or {}).keys()),
}).lower()
check("the published OpenAPI document offers no credential route",
      not any(w in surface for w in ("secret", "reveal", "password", "credential")), surface[:250])


# ================================================================ vault, up close
section("The vault itself")

# Run in subprocesses: these need a different WCC_VAULT_KEY than the API has,
# and changing it in this process would not reach the API anyway.
def vault_py(code, key=None):
    env = dict(os.environ)
    env.pop("WCC_VAULT_KEY", None)
    if key is not None:
        env["WCC_VAULT_KEY"] = key
    p = subprocess.run([sys.executable, "-c", code], cwd=BACKEND, env=env,
                       capture_output=True, text=True, timeout=60)
    return (p.stdout + p.stderr).strip()

PRE = "from app.services import vault\n"

out = vault_py(PRE + "print(vault.configured())")
check("with no key it reports itself locked", out.endswith("False"), out[-120:])

out = vault_py(PRE + """
try:
    vault.encrypt('x')
    print('STORED')
except vault.VaultLocked:
    print('REFUSED')
""")
check("with no key, storing is refused rather than stored in the clear",
      out.endswith("REFUSED"), out[-160:])

out = vault_py(PRE + "print(vault.configured())", key="a-test-passphrase-not-for-real-use")
check("with a key it reports itself open", out.endswith("True"), out[-120:])

out = vault_py(PRE + """
try:
    vault.encrypt('x'); print('ACCEPTED')
except vault.VaultLocked as e:
    print('REFUSED')
""", key="short")
check("a passphrase too short to mean anything is refused", out.endswith("REFUSED"), out[-160:])

out = vault_py(PRE + f"""
c = vault.encrypt({CANARY!r})
print('SAME' if {CANARY!r} in c else 'ENCRYPTED')
print('ROUNDTRIP' if vault.decrypt(c) == {CANARY!r} else 'LOST')
print('DISTINCT' if vault.encrypt({CANARY!r}) != c else 'DETERMINISTIC')
""", key="a-test-passphrase-not-for-real-use")
lines = out.splitlines()[-3:]
check("the stored form is not the password", lines[0:1] == ["ENCRYPTED"], out[-200:])
check("it reads back to exactly what went in", lines[1:2] == ["ROUNDTRIP"], out[-200:])
check("the same password twice gives different ciphertext",
      lines[2:3] == ["DISTINCT"], out[-200:])

out = vault_py(PRE + """
import os
c = vault.encrypt('hello there friend')
os.environ['WCC_VAULT_KEY'] = 'a-completely-different-passphrase'
try:
    print('READ:' + str(vault.decrypt(c)))
except vault.VaultLocked:
    print('REFUSED')
""", key="a-test-passphrase-not-for-real-use")
check("a changed key says so out loud instead of returning nothing",
      out.endswith("REFUSED"), out[-200:])

out = vault_py(PRE + "print('NONE' if vault.decrypt(None) is None else 'SOMETHING')",
               key="a-test-passphrase-not-for-real-use")
check("no stored password reads back as nothing, quietly", out.endswith("NONE"), out[-120:])

src = open(os.path.join(BACKEND, "app", "services", "vault.py")).read()
check("the vault has no database fallback for its key",
      "Session" not in src and "db." not in src, "vault.py touches the database")


# ======================================================================= clean up
section("Clean up")
for i in made_articles:
    call("DELETE", f"/api/knowledge/{i}")
for i in made_servers:
    call("DELETE", f"/api/servers/{i}")
if tid:
    call("DELETE", f"/api/tasks/{tid}")

s, r = call("GET", f"/api/knowledge/{made_articles[0]}") if made_articles else (404, None)
check("deleting an article really removes it", s == 404, f"got {s}")

s, rows = call("GET", f"/api/servers/{sid}/accounts")
check("deleting a server takes its accounts and their ciphertext with it",
      s == 404 or rows == [], f"{s} {str(rows)[:120]}")


print(f"\n{'='*52}\n  \033[1m{ok} passed, {fail} failed\033[0m\n{'='*52}")
if failures:
    print("Failed:")
    for f in failures:
        print("  -", f)
sys.exit(1 if fail else 0)
