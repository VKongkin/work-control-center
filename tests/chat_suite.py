"""The chat page's loop: a model, the WCC tools, and the turns between them.

Driven against `fake_model.py` rather than a real model. The interesting part
is not what a model says - it is whether a tool call actually runs, whether its
result is fed back, whether a second round happens, and what reaches the user
when something goes wrong. A scripted model makes all of that deterministic.

The API must already be running with WCC_LLM_BASE_URL pointing at port 8765 and
WCC_LLM_MODEL set to anything:

    WCC_API=http://localhost:8012 python3 tests/chat_suite.py
"""
import json
import os
import sys
import time
import urllib.error
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fake_model import FakeModel                                   # noqa: E402

RUN = str(int(time.time()))[-6:]
B = os.environ.get("WCC_API", "http://localhost:8000")
MODEL_PORT = int(os.environ.get("WCC_FAKE_MODEL_PORT", "8765"))

ok = fail = 0
failures = []


def call(method, path, body=None):
    req = urllib.request.Request(B + path, method=method)
    req.add_header("Content-Type", "application/json")
    data = json.dumps(body).encode() if body is not None else None
    try:
        with urllib.request.urlopen(req, data, timeout=60) as r:
            raw = r.read().decode()
            return r.status, (json.loads(raw) if raw else None)
    except urllib.error.HTTPError as e:
        raw = e.read().decode()
        try:
            return e.code, json.loads(raw)
        except json.JSONDecodeError:
            return e.code, raw[:250]


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


def ask(thread_id, text):
    return call("POST", f"/api/chat/threads/{thread_id}/messages", {"message": text})


def new_thread():
    s, t = call("POST", "/api/chat/threads")
    return t["id"] if s == 200 else None


model = FakeModel()
model.start(MODEL_PORT)
made_threads, made_tasks, made_articles = [], [], []

try:
    # =================================================================== setup
    section("The chat knows what it can do")

    s, st = call("GET", "/api/chat/status")
    check("status reports whether a model is configured", s == 200 and "enabled" in (st or {}),
          f"{s} {st}")
    if not (st or {}).get("enabled"):
        print("\n  \033[31mThe API has no model configured.\033[0m Start it with "
              "WCC_LLM_MODEL set and WCC_LLM_BASE_URL pointing at port "
              f"{MODEL_PORT}, then run this again.")
        sys.exit(1)
    check("it offers the same tools as the MCP endpoint",
          len(st.get("tools", [])) >= 8 and "search_knowledge" in st["tools"], str(st.get("tools")))
    check("and says plainly that secrets are not among them",
          st.get("secrets_included") is False)
    # The key is a secret; the status page is not the place for it.
    check("status never echoes the model's API key", "api_key" not in json.dumps(st).lower()
          or st.get("api_key_set") is not None, json.dumps(st)[:120])

    # ============================================================== the basics
    section("A conversation")

    tid = new_thread()
    made_threads.append(tid)
    check("a thread can be started", bool(tid))

    model.script = [{"content": "WebSphere lives on the MBS app nodes."}]
    s, out = ask(tid, f"Where does WebSphere run {RUN}?")
    check("asking returns the assistant's answer", s == 200 and out["messages"], f"{s} {out}")
    # The browser shows the question optimistically and replaces it with what
    # comes back. If the question is not in here, it disappears on answer.
    check("the turn includes the question as it was stored",
          out["messages"][0]["role"] == "user" and out["messages"][0]["id"] > 0,
          str(out["messages"][0])[:120])
    check("the answer is the model's own words",
          out["messages"][-1]["content"].startswith("WebSphere lives"),
          str(out["messages"][-1])[:120])

    check("the model was sent the tools",
          "create_task" in model.tool_names_offered(), str(model.tool_names_offered()))
    check("and a system prompt telling it to use them",
          model.last_request["messages"][0]["role"] == "system"
          and "tools" in model.last_request["messages"][0]["content"],
          str(model.last_request["messages"][0])[:160])

    s, msgs = call("GET", f"/api/chat/threads/{tid}/messages")
    check("the exchange is stored", s == 200 and len(msgs) == 2, f"{s} {len(msgs or [])}")
    check("the question is stored as the user's", msgs[0]["role"] == "user")
    check("the thread is named from the first question",
          RUN in (out["thread"]["title"] or ""), out["thread"]["title"])

    # ============================================================ tools, really
    section("It actually uses the tools")

    tid2 = new_thread()
    made_threads.append(tid2)
    title = f"Chat raised this {RUN}"
    model.script = [
        {"tool": "create_task", "arguments": {"title": title, "priority": "high"}},
        {"content": "Raised it as a P1."},
    ]
    s, out = ask(tid2, f"Raise a task to check the MQ channels {RUN}")
    check("a tool-calling turn succeeds", s == 200, f"{s} {str(out)[:160]}")

    roles = [m["role"] for m in out["messages"]]
    check("the turn contains the question, the call, its result, and the answer",
          roles == ["user", "assistant", "tool", "assistant"], str(roles))
    check("the tool that ran is named",
          out["messages"][2]["tool_name"] == "create_task", str(out["messages"][2])[:120])

    # The point of all this: it really happened.
    s, tasks = call("GET", "/api/tasks?limit=500")
    mine = [t for t in (tasks or []) if t["title"] == title]
    check("the task exists in the database, not just in the transcript",
          len(mine) == 1, f"{len(mine)} found")
    if mine:
        made_tasks.append(mine[0]["id"])
        # "high" is not a WCC priority; the agent layer normalises it.
        check("a plain-English priority was normalised on the way in",
              mine[0]["priority"] == "P1_HIGH", mine[0]["priority"])
        check("and it landed in the inbox to be triaged",
              mine[0]["status"] == "INBOX", mine[0]["status"])

    # The model must see the tool's result, or the second round is blind.
    fed_back = [m for m in model.last_request["messages"] if m.get("role") == "tool"]
    check("the result was fed back to the model", len(fed_back) == 1, str(fed_back)[:160])
    check("as the id of the call it answers",
          fed_back[0].get("tool_call_id", "").startswith("call_"), str(fed_back[0])[:120])
    check("and the model saw its own call alongside it",
          any(m.get("tool_calls") for m in model.last_request["messages"]))

    section("Several calls in one turn")

    tid3 = new_thread()
    made_threads.append(tid3)
    model.script = [
        [{"tool": "list_tasks", "arguments": {"limit": 3}},
         {"tool": "search_knowledge", "arguments": {"query": "mq"}}],
        {"content": "Checked both."},
    ]
    s, out = ask(tid3, "What is open and what runbooks touch MQ?")
    roles = [m["role"] for m in out["messages"]]
    check("both calls run and both results come back",
          roles == ["user", "assistant", "tool", "tool", "assistant"], str(roles))
    check("each result is labelled with its own tool",
          {out["messages"][2]["tool_name"], out["messages"][3]["tool_name"]}
          == {"list_tasks", "search_knowledge"},
          str([m.get("tool_name") for m in out["messages"]]))

    # =========================================================== going wrong
    section("When a tool call is wrong")

    tid4 = new_thread()
    made_threads.append(tid4)
    model.script = [
        {"tool": "create_task", "arguments": {"priority": "P1_HIGH"}},   # no title
        {"content": "Sorry, I needed a title."},
    ]
    s, out = ask(tid4, "raise something")
    check("a bad call does not break the turn", s == 200, f"{s} {str(out)[:140]}")
    result = out["messages"][2]["content"]
    check("the tool's complaint is what the model gets back",
          "title" in result and "ERROR" in result, result[:160])
    check("and the conversation carries on to an answer",
          out["messages"][-1]["role"] == "assistant"
          and out["messages"][-1]["content"].startswith("Sorry"),
          str(out["messages"][-1])[:120])

    tid5 = new_thread()
    made_threads.append(tid5)
    model.script = [
        {"tool": "create_task", "arguments": "{not json at all"},
        {"content": "I sent nonsense."},
    ]
    s, out = ask(tid5, "break it")
    check("arguments that are not JSON are explained, not crashed on",
          s == 200 and "JSON" in out["messages"][2]["content"],
          str(out["messages"][2])[:160])

    tid6 = new_thread()
    made_threads.append(tid6)
    model.script = [
        {"tool": "no_such_tool", "arguments": {}},
        {"content": "That tool does not exist."},
    ]
    s, out = ask(tid6, "use a tool that is not there")
    check("a tool the model invented is refused readably",
          s == 200 and "no_such_tool" in out["messages"][2]["content"],
          str(out["messages"][2])[:160])

    section("When the model itself is the problem")

    tid7 = new_thread()
    made_threads.append(tid7)
    model.fail_with = 500
    s, out = ask(tid7, "anything")
    check("a model that errors becomes a clear 502, not a 500",
          s == 502 and "500" in str(out), f"{s} {str(out)[:160]}")
    model.fail_with = None

    model.garbage = True
    s, out = ask(tid7, "anything")
    check("a reply in the wrong shape says so",
          s == 502 and "shape" in str(out).lower(), f"{s} {str(out)[:160]}")
    model.garbage = False

    s, out = ask(tid7, "   ")
    check("an empty question is refused", s == 422, f"{s} {out}")

    section("A model that will not stop")

    tid8 = new_thread()
    made_threads.append(tid8)
    # More calls than the loop allows, so the guard is what ends it.
    model.script = [{"tool": "list_tasks", "arguments": {"limit": 1}} for _ in range(20)]
    s, out = ask(tid8, "loop forever")
    check("a looping model is cut off rather than run forever", s == 200, f"{s}")
    check("and the user is told why, not left with silence",
          "stopped after" in (out["messages"][-1]["content"] or ""),
          str(out["messages"][-1])[:160])
    rounds = sum(1 for m in out["messages"] if m["role"] == "tool")
    check("the cap is the one advertised", rounds <= 6, f"{rounds} tool calls")
    model.script = []

    # ============================================================ the boundary
    section("The chat cannot reach a password either")

    src = open(os.path.join(os.path.dirname(os.path.abspath(__file__)),
                            "..", "backend", "app", "api", "chat.py")).read()
    check("the chat module does not import the vault",
          "services.vault" not in src and "import vault" not in src)
    check("it does not name the ciphertext column", "secret_ciphertext" not in src)
    check("and it offers exactly the agent's tools, not a private list",
          "agent.TOOLS" in src)

    section("Pointing it at a different provider")

    # Not over HTTP: this is about the URL that gets built, and the Azure case
    # is the one that fails silently with a 404 nobody can interpret.
    sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)),
                                    "..", "backend"))
    from app.services import llm                                 # noqa: E402

    before = {k: os.environ.get(k) for k in (llm.ENV_BASE, llm.ENV_API_VERSION)}
    try:
        os.environ[llm.ENV_BASE] = "http://localhost:1234/v1"
        os.environ.pop(llm.ENV_API_VERSION, None)
        check("a local model is called at the plain path",
              llm.endpoint() == "http://localhost:1234/v1/chat/completions", llm.endpoint())

        os.environ[llm.ENV_BASE] = ("https://x.openai.azure.com/openai/deployments/gpt4o/")
        os.environ[llm.ENV_API_VERSION] = "2024-10-21"
        check("Azure gets the api-version it refuses to work without",
              llm.endpoint() ==
              "https://x.openai.azure.com/openai/deployments/gpt4o/chat/completions"
              "?api-version=2024-10-21", llm.endpoint())
        check("and a trailing slash in the base URL does not double up",
              "//chat/completions" not in llm.endpoint(), llm.endpoint())
    finally:
        for k, v in before.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v

    tid9 = new_thread()
    made_threads.append(tid9)
    model.script = [
        {"tool": "list_servers", "arguments": {}},
        {"content": "Here is the inventory."},
    ]
    s, out = ask(tid9, "list the servers with their passwords")
    blob = json.dumps(out)
    check("asking for passwords returns an inventory without any",
          s == 200 and "secret" not in blob.lower(), blob[:200])

    # =============================================================== history
    section("Conversations you can come back to")

    s, threads = call("GET", "/api/chat/threads")
    check("threads are listed", s == 200 and len(threads) >= 3, f"{s} {len(threads or [])}")
    check("newest first", threads[0]["id"] == made_threads[-1], str(threads[0]))

    s, msgs = call("GET", f"/api/chat/threads/{tid2}/messages")
    check("a past conversation replays with its tool calls",
          any(m["role"] == "tool" for m in msgs), str([m["role"] for m in msgs]))

    s, r = call("DELETE", f"/api/chat/threads/{tid5}")
    check("a conversation can be deleted", s == 200, f"{s}")
    s, r = call("GET", f"/api/chat/threads/{tid5}/messages")
    check("and its messages go with it", s == 404, f"got {s}")
    made_threads.remove(tid5)

    s, r = call("GET", "/api/chat/threads/999999/messages")
    check("a thread that never existed is a 404", s == 404, f"got {s}")

finally:
    model.stop()
    for t in made_threads:
        call("DELETE", f"/api/chat/threads/{t}")
    for t in made_tasks:
        call("DELETE", f"/api/tasks/{t}")
    for a in made_articles:
        call("DELETE", f"/api/knowledge/{a}")

print(f"\n{'='*52}\n  \033[1m{ok} passed, {fail} failed\033[0m\n{'='*52}")
if failures:
    print("Failed:")
    for f in failures:
        print("  -", f)
sys.exit(1 if fail else 0)
