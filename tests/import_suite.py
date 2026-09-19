"""Building a tool out of a repository link.

Driven against a forge the suite serves itself on port 8766, because the
interesting cases are the ones github.com will not perform on demand: a branch
that does not exist, a redirect that leaves the allowlist, an archive with
"../.." in it, a tarball that claims to be enormous.

Half of these are security checks, and they are written as behaviour rather
than as "the function was called": what comes back to the person, and what
ended up in the database.

The API must be running with the test forge allowlisted:

    WCC_FETCH_ALLOW=127.0.0.1 WCC_API=http://localhost:8012 \
        python3 tests/import_suite.py
"""
import io
import json
import os
import sys
import tarfile
import time
import urllib.error
import urllib.request
import zipfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fake_forge import FakeForge                                    # noqa: E402

RUN = str(int(time.time()))[-6:]
B = os.environ.get("WCC_API", "http://localhost:8000")
PORT = int(os.environ.get("WCC_FAKE_FORGE_PORT", "8766"))

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


def imported(url, **extra):
    return call("POST", "/api/tools/import", {"url": url, **extra})


forge = FakeForge()
base = forge.start(PORT)
made_tools = []

try:
    section("Whether it is switched on")

    s, st = call("GET", "/api/tools/import/status")
    check("the page can ask whether importing is available",
          s == 200 and "enabled" in (st or {}), f"{s} {st}")
    if not (st or {}).get("enabled"):
        print("\n  \033[31mThe API has no fetch allowlist.\033[0m Start it with "
              f"WCC_FETCH_ALLOW=127.0.0.1 and run this again.")
        sys.exit(1)
    check("it names the hosts it will fetch from, so the rule is visible",
          "127.0.0.1" in (st.get("hosts") or []), str(st.get("hosts")))
    check("and never echoes the token", "token" not in json.dumps(st).replace(
        "token_set", ""), json.dumps(st)[:160])

    section("Importing a repository")

    s, out = imported(f"{base}/acme/dashboard", name=f"Imported dash {RUN}")
    check("a bare repository link works", s == 200, f"{s} {str(out)[:200]}")
    if s == 200:
        made_tools.append(out["tool"]["id"])
        # Five: the page, its stylesheet, its script, the widget's page and
        # the README - documentation travels with the thing it documents.
        check("the files came across",
              out["imported"] == 5, f"{out['imported']}: {out.get('files')}")
        check("the wrapper folder the forge adds is stripped off",
              "index.html" in out["files"], str(out["files"]))
        check("nested paths survive, or nothing would load",
              "css/app.css" in out["files"], str(out["files"]))
        check("it points at the page that opens it",
              out["entry_path"] == "index.html", str(out["entry_path"]))
        check("so the tool is runnable without another step", out["runnable"] is True)

        s, man = call("GET", f"/api/tools/{out['tool']['id']}/manifest")
        check("and the tool agrees when asked separately",
              s == 200 and man["runnable"] and man["file_count"] == 5,
              str(man)[:160])

        # Fetched raw: this one answers with HTML, and call() speaks JSON.
        tid = out["tool"]["id"]
        with urllib.request.urlopen(f"{B}/api/tools/{tid}/serve/index.html",
                                    timeout=30) as r:
            served, served_type = r.read(), r.headers.get("Content-Type", "")
        check("the imported page really serves, as HTML",
              b"<title>Dashboard</title>" in served and "text/html" in served_type,
              f"{served_type} {served[:60]}")

        with urllib.request.urlopen(f"{B}/api/tools/{tid}/serve/css/app.css",
                                    timeout=30) as r:
            check("and so does a file nested inside it, with the right type",
                  "text/css" in r.headers.get("Content-Type", ""),
                  r.headers.get("Content-Type"))

    plumbing = out if isinstance(out, dict) else {}
    check("the repository's plumbing is left behind",
          not any(f.startswith(".github") or "node_modules" in f
                  or f.endswith(".py") or f == "Makefile"
                  for f in plumbing.get("files", [])),
          str(plumbing.get("files")))
    check("and it says what it skipped rather than silently dropping it",
          bool(plumbing.get("skipped")), str(plumbing.get("skipped")))

    section("Pointing at part of a repository")

    s, out = imported(f"{base}/acme/dashboard/tree/main/widget",
                      name=f"Imported widget {RUN}")
    check("a folder inside a repository can be imported on its own",
          s == 200, f"{s} {str(out)[:160]}")
    if s == 200:
        made_tools.append(out["tool"]["id"])
        check("only that folder comes across",
              out["files"] == ["index.html"], str(out["files"]))
        check("and its path is relative to the folder, not the repository",
              "widget/" not in "".join(out["files"]), str(out["files"]))

    section("A branch that is not main")

    s, out = imported(f"{base}/acme/legacy", name=f"Imported legacy {RUN}")
    check("a repository still on master is found without being told",
          s == 200 and out.get("imported", 0) >= 1, f"{s} {str(out)[:160]}")
    if s == 200:
        made_tools.append(out["tool"]["id"])
        check("and the branch it used is reported",
              out.get("ref") == "master", str(out.get("ref")))

    s, out = imported(f"{base}/acme/nowhere", name=f"Imported nothing {RUN}")
    check("a repository that does not exist is explained, not a 500",
          s == 422 and "main and master" in str(out), f"{s} {str(out)[:200]}")

    section("Other things a link can be")

    s, out = imported(f"{base}/acme/dashboard/-/archive/main/dashboard-main.zip",
                      name=f"Imported zip {RUN}")
    check("a zip is read as well as a tarball", s == 200, f"{s} {str(out)[:160]}")
    if s == 200:
        made_tools.append(out["tool"]["id"])
        check("with the same layout as the tarball",
              "index.html" in out["files"], str(out["files"]))

    s, out = imported(f"{base}/acme/dashboard/raw/main/index.html",
                      name=f"Imported single {RUN}")
    check("a single file link makes a one-file tool", s == 200, f"{s} {str(out)[:160]}")
    if s == 200:
        made_tools.append(out["tool"]["id"])
        check("and that file is the entry point",
              out["entry_path"] == "index.html", str(out["entry_path"]))

    s, out = imported(f"{base}/nothing/like/a/repo/at/all/here")
    check("something that is not a repository link says so",
          s == 422 and "repository link" in str(out).lower(), f"{s} {str(out)[:200]}")

    section("What the server must refuse to fetch")

    # The address that makes SSRF worth caring about. Nothing about this
    # request looks unusual; the allowlist is the only thing standing in
    # front of it.
    s, out = imported("http://169.254.169.254/latest/meta-data/iam/")
    check("the cloud metadata address is refused",
          s == 422 and "WCC_FETCH_ALLOW" in str(out), f"{s} {str(out)[:200]}")

    s, out = imported("http://localhost:8012/api/servers")
    check("WCC cannot be talked into fetching its own API",
          s == 422, f"{s} {str(out)[:200]}")

    s, out = imported("file:///etc/passwd")
    check("a file:// link is refused", s == 422, f"{s} {str(out)[:200]}")

    # An allowlisted host that answers "go and fetch this other thing" is the
    # ordinary way a check on the first URL alone gets walked around.
    s, out = imported(f"{base}/acme/offsite", name=f"Imported redirect {RUN}")
    check("a redirect off the allowlist is refused at the hop, not followed",
          s == 422 and "169.254.169.254" in str(out), f"{s} {str(out)[:250]}")

    s, out = imported(f"{base}/acme/hop", name=f"Imported hop {RUN}")
    check("but a redirect that stays on an allowed host is followed",
          s == 200 and out.get("imported", 0) >= 1, f"{s} {str(out)[:160]}")
    if s == 200:
        made_tools.append(out["tool"]["id"])

    s, out = imported(f"{base}/acme/loop")
    check("a redirect that never lands gives up", s == 422, f"{s} {str(out)[:200]}")

    section("What the server must refuse to unpack")

    before = len(call("GET", "/api/tools?limit=500")[1] or [])
    s, out = imported(f"{base}/evil/archive/main.tar.gz", name=f"Imported evil {RUN}")
    if s == 200:
        made_tools.append(out["tool"]["id"])
        paths = out["files"]
        check("an entry climbing out of the folder is re-rooted, not obeyed",
              not any(p.startswith("..") or p.startswith("/") for p in paths),
              str(paths))
        check("and it lands somewhere harmless inside the tool",
              any(p.endswith("passwd.html") for p in paths), str(paths))
        check("a symlink in the archive is not imported at all",
              not any("link" in p for p in paths), str(paths))
    else:
        check("a hostile archive is refused readably", s == 422, f"{s} {str(out)[:200]}")

    s, out = imported(f"{base}/huge/archive/main.tar.gz")
    check("an archive that unpacks to more than the limit is refused",
          s == 422 and "MB" in str(out), f"{s} {str(out)[:200]}")

    s, out = imported(f"{base}/notweb/archive/main.tar.gz")
    check("a repository with nothing web-shaped in it says so",
          s == 422 and "index.html" in str(out), f"{s} {str(out)[:250]}")

    s, out = imported(f"{base}/garbage/archive/main.tar.gz")
    check("something that is not an archive at all is explained",
          s == 422 and ("tar.gz" in str(out) or "zip" in str(out)),
          f"{s} {str(out)[:200]}")

    section("Importing again over the top")

    s, first = imported(f"{base}/acme/dashboard", name=f"Refresh me {RUN}")
    tid = first["tool"]["id"]
    made_tools.append(tid)
    s, second = imported(f"{base}/acme/legacy", tool_id=tid)
    check("an import can refresh a tool that already exists",
          s == 200 and second["tool"]["id"] == tid, f"{s} {str(second)[:160]}")
    s, man = call("GET", f"/api/tools/{tid}/manifest")
    check("and replaces the old files rather than mixing two versions",
          man["file_count"] == second["imported"],
          f"{man['file_count']} files, imported {second['imported']}")
    check("no second tool was created by accident",
          len(call("GET", "/api/tools?limit=500")[1] or []) == before + 2,
          f"{len(call('GET', '/api/tools?limit=500')[1] or [])} vs {before}")

    s, out = imported(f"{base}/acme/dashboard", tool_id=999999)
    check("importing into a tool that does not exist is a 404", s == 404, f"{s}")

    section("With the allowlist empty")

    # The API has one, so this is asked of the module directly - the same way
    # the vault's "no key, no storing" rule is checked.
    sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)),
                                    "..", "backend"))
    from app.services import repo_import                            # noqa: E402

    kept = os.environ.get(repo_import.ENV_ALLOW)
    try:
        os.environ[repo_import.ENV_ALLOW] = ""
        check("with no allowlist the feature reports itself off",
              repo_import.configured() is False)
        check("and says how to turn it on rather than just failing",
              "WCC_FETCH_ALLOW" in repo_import.status()["detail"],
              repo_import.status()["detail"])
        try:
            repo_import.import_link("https://github.com/acme/thing")
            check("nothing is fetched while it is off", False, "it fetched anyway")
        except repo_import.ImportRefused as e:
            check("nothing is fetched while it is off", "WCC_FETCH_ALLOW" in str(e), str(e))

        os.environ[repo_import.ENV_ALLOW] = "github.com"
        check("a listed host is allowed", repo_import.host_allowed("github.com"))
        check("so is a subdomain of it", repo_import.host_allowed("codeload.github.com"))
        check("a host that merely ends with the same letters is not",
              not repo_import.host_allowed("notgithub.com"))
        check("nor is one that only starts with it",
              not repo_import.host_allowed("github.com.evil.net"))
        check("and a trailing dot does not sneak past",
              repo_import.host_allowed("github.com."))
    finally:
        if kept is None:
            os.environ.pop(repo_import.ENV_ALLOW, None)
        else:
            os.environ[repo_import.ENV_ALLOW] = kept

    section("Reading the link itself")

    sources = repo_import.resolve("https://github.com/acme/dash/tree/develop/ui")
    check("a branch and folder link keeps both",
          sources[0].ref == "develop" and sources[0].subdir == "ui",
          str(sources[0]))
    sources = repo_import.resolve("https://gitlab.bank.local/mw/team/dash/-/tree/main/app")
    check("a nested GitLab group is not mistaken for owner and repo",
          "/mw/team/dash/-/archive/main/" in sources[0].url, sources[0].url)
    sources = repo_import.resolve("https://github.com/acme/dash")
    check("a bare link tries main before master",
          [s.ref for s in sources] == ["main", "master"], str([s.ref for s in sources]))

finally:
    forge.stop()
    for t in made_tools:
        call("DELETE", f"/api/tools/{t}")

print(f"\n{'=' * 52}\n  \033[1m{ok} passed, {fail} failed\033[0m\n{'=' * 52}")
if failures:
    print("Failed:")
    for f in failures:
        print("  -", f)
sys.exit(1 if fail else 0)
