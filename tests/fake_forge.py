"""A repository host that does exactly what the test needs it to.

Importing a tool from a link has to be tested against the awkward cases, and
github.com will not produce them on request: a branch that is missing, a
redirect that leaves the allowlist, a tarball carrying "../.." or a symlink,
an archive that claims to unpack to half a gigabyte.

So this serves the same URL shapes a forge does - /{owner}/{repo}/archive/
{ref}.tar.gz, /-/archive/, /raw/ - out of archives built in memory.

    forge = FakeForge()
    base = forge.start(8766)      # -> http://127.0.0.1:8766
    ...
    forge.stop()
"""
import gzip
import http.server
import io
import tarfile
import threading
import zipfile
from typing import Dict, List, Optional, Tuple

# A small, believable web tool, plus the repository furniture that should be
# left behind when it is imported.
DASHBOARD: List[Tuple[str, bytes]] = [
    ("index.html", b"<!doctype html><title>Dashboard</title><link rel=stylesheet "
                   b"href=css/app.css><script src=js/app.js></script><h1>MQ</h1>"),
    ("css/app.css", b"body{font-family:system-ui}"),
    ("js/app.js", b"console.log('dashboard');"),
    ("widget/index.html", b"<!doctype html><title>Widget</title>"),
    ("README.md", b"# Dashboard\n"),
    (".github/workflows/ci.yml", b"on: push\n"),
    ("node_modules/left-pad/index.js", b"module.exports = 1;"),
    ("Makefile", b"all:\n\techo hi\n"),
    ("src/main.py", b"print('not part of a web page')\n"),
]

LEGACY: List[Tuple[str, bytes]] = [
    ("index.html", b"<!doctype html><title>Legacy</title>"),
]

NOT_WEB: List[Tuple[str, bytes]] = [
    ("main.py", b"print(1)\n"),
    ("Makefile", b"all:\n"),
]


def tar_gz(root: str, files: List[Tuple[str, bytes]]) -> bytes:
    """A forge-shaped tarball: every entry under one "repo-ref/" directory."""
    raw = io.BytesIO()
    with tarfile.open(fileobj=raw, mode="w:gz") as tar:
        for path, body in files:
            info = tarfile.TarInfo(f"{root}/{path}")
            info.size = len(body)
            tar.addfile(info, io.BytesIO(body))
    return raw.getvalue()


def zip_of(root: str, files: List[Tuple[str, bytes]]) -> bytes:
    raw = io.BytesIO()
    with zipfile.ZipFile(raw, "w") as z:
        for path, body in files:
            z.writestr(f"{root}/{path}", body)
    return raw.getvalue()


def hostile_tar() -> bytes:
    """An archive that tries to write outside the folder it is unpacked into."""
    raw = io.BytesIO()
    with tarfile.open(fileobj=raw, mode="w:gz") as tar:
        for path, body in [
            ("evil-main/index.html", b"<!doctype html><title>Evil</title>"),
            # Classic tar-slip. Unpacked naively this lands in /etc.
            ("evil-main/../../../../etc/passwd.html", b"<!doctype html>root:x:0:0"),
        ]:
            info = tarfile.TarInfo(path)
            info.size = len(body)
            tar.addfile(info, io.BytesIO(body))

        link = tarfile.TarInfo("evil-main/link.html")
        link.type = tarfile.SYMTYPE
        link.linkname = "/etc/shadow"
        tar.addfile(link)
    return raw.getvalue()


def huge_tar() -> bytes:
    """Small on the wire, far over the limit once unpacked."""
    raw = io.BytesIO()
    with tarfile.open(fileobj=raw, mode="w:gz") as tar:
        # Zeroes compress to almost nothing, which is the whole trick.
        for i in range(12):
            body = b"\0" * (5 * 1024 * 1024)
            info = tarfile.TarInfo(f"huge-main/part{i}.txt")
            info.size = len(body)
            tar.addfile(info, io.BytesIO(body))
    return raw.getvalue()


class FakeForge:
    def __init__(self):
        self._httpd = None
        self._thread = None
        self.port = 0
        self.seen: List[str] = []
        self.auth_seen: List[Optional[str]] = []

    # ------------------------------------------------------------------ routes

    def _routes(self) -> Dict[str, Tuple[int, bytes, Dict[str, str]]]:
        gz = {"Content-Type": "application/gzip"}
        base = f"http://127.0.0.1:{self.port}"
        return {
            "/acme/dashboard/archive/main.tar.gz":
                (200, tar_gz("dashboard-main", DASHBOARD), gz),
            "/acme/dashboard/-/archive/main/dashboard-main.zip":
                (200, zip_of("dashboard-main", DASHBOARD),
                 {"Content-Type": "application/zip"}),
            "/acme/dashboard/raw/main/index.html":
                (200, DASHBOARD[0][1], {"Content-Type": "text/html"}),

            # Still on master, like plenty of things in a bank.
            "/acme/legacy/archive/main.tar.gz": (404, b"Not Found", {}),
            "/acme/legacy/archive/master.tar.gz":
                (200, tar_gz("legacy-master", LEGACY), gz),

            "/acme/nowhere/archive/main.tar.gz": (404, b"Not Found", {}),
            "/acme/nowhere/archive/master.tar.gz": (404, b"Not Found", {}),

            "/evil/archive/main.tar.gz": (200, hostile_tar(), gz),
            "/huge/archive/main.tar.gz": (200, huge_tar(), gz),
            "/notweb/archive/main.tar.gz":
                (200, tar_gz("notweb-main", NOT_WEB), gz),
            "/garbage/archive/main.tar.gz":
                (200, b"this is not an archive, it is a sentence", gz),

            # Repository-shaped, because that is how a forge redirects: GitHub
            # answers /archive/ with a 302 to codeload.github.com.
            "/acme/hop/archive/main.tar.gz":
                (302, b"", {"Location": f"{base}/acme/dashboard/archive/main.tar.gz"}),
            "/acme/offsite/archive/main.tar.gz":
                (302, b"", {"Location": "http://169.254.169.254/latest/meta-data/"}),
            "/acme/loop/archive/main.tar.gz":
                (302, b"", {"Location": f"{base}/acme/loop/archive/main.tar.gz"}),
        }

    def _handler(self):
        outer = self

        class H(http.server.BaseHTTPRequestHandler):
            def log_message(self, *a):
                pass

            def do_GET(self):
                outer.seen.append(self.path)
                outer.auth_seen.append(self.headers.get("Authorization"))
                status, body, headers = outer._routes().get(
                    self.path, (404, b"Not Found", {}))
                self.send_response(status)
                for k, v in headers.items():
                    self.send_header(k, v)
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                if body:
                    self.wfile.write(body)

        return H

    # --------------------------------------------------------------- lifecycle

    def start(self, port: int = 0) -> str:
        self._httpd = http.server.ThreadingHTTPServer(("127.0.0.1", port), self._handler())
        self.port = self._httpd.server_address[1]
        self._thread = threading.Thread(target=self._httpd.serve_forever, daemon=True)
        self._thread.start()
        return f"http://127.0.0.1:{self.port}"

    def stop(self):
        if self._httpd:
            self._httpd.shutdown()
            self._httpd.server_close()
