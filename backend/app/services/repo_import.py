"""Build a tool out of a repository link instead of a folder upload.

A tool in WCC is a folder of files - index.html plus whatever it needs - and
those folders usually already exist in a repository. Uploading them by hand is
the tedious version of `git clone`, and it goes stale the moment the repository
moves on. So: paste the link, and WCC pulls the files itself.

It reads the archive a forge already serves rather than speaking either forge's
API. One request, no token for a public repository, and the same code path for
github.com, gitlab.com and the GitLab instance behind the bank's firewall,
which is the one that actually matters here.

  SECURITY. This is the first thing in WCC that makes the server fetch a URL
  somebody typed. That is a request originating *inside* the network, from a
  host that can see things a browser cannot, which is the whole shape of an
  SSRF. Four things hold it in:

    * It is off until an allowlist exists. No WCC_FETCH_ALLOW, no fetching -
      the same "off until configured" rule the vault and the agent follow.
    * Every hop is checked, not just the first. A 302 to somewhere else is the
      usual way an allowlist gets walked around.
    * A token, if one is set, is sent to the host that was allowlisted and
      dropped the moment a redirect crosses to another host.
    * Archives are treated as hostile: entry paths are re-rooted so they cannot
      escape, links are skipped, and the size is capped before anything is
      written rather than after.
"""
import io
import ipaddress
import os
import re
import socket
import tarfile
import zipfile
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Tuple
from urllib.parse import urlparse, unquote

import httpx

ENV_ALLOW = "WCC_FETCH_ALLOW"
ENV_TOKEN = "WCC_FETCH_TOKEN"

# Ceilings. A tool is a web page and its assets; anything approaching these is
# a repository that was never going to run in an iframe anyway.
MAX_DOWNLOAD_BYTES = 40 * 1024 * 1024
MAX_UNPACKED_BYTES = 40 * 1024 * 1024
MAX_FILES = 400
MAX_REDIRECTS = 5
TIMEOUT = 30.0

# What belongs in a tool. Everything else in the repository - the CI config, the
# lockfile, the test suite, the .git directory - is not part of the thing that
# runs, and importing it would turn a two-file tool into a thousand-file one.
KEEP = {
    ".html", ".htm", ".css", ".js", ".mjs", ".cjs", ".json", ".map",
    ".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp", ".ico", ".avif",
    ".woff", ".woff2", ".ttf", ".otf", ".eot",
    ".txt", ".md", ".csv", ".wasm", ".webmanifest", ".xml",
}

# Never import these, whatever their extension says. A dotfile directory is
# repository plumbing, and node_modules is how a 40 MB cap gets hit by accident.
SKIP_DIRS = {".git", ".github", ".gitlab", ".idea", ".vscode", "node_modules",
             "__pycache__", ".next", ".nuxt"}


class ImportRefused(Exception):
    """The link, the configuration or the archive is not acceptable.

    Carries a sentence meant for the person who pasted the link, not a stack
    trace: every one of these is something they can act on.
    """


class NotAllowed(ImportRefused):
    """The allowlist said no.

    Its own type because it must not be swallowed. A bare repository link
    becomes two attempts, main then master, and the first version of this
    reported whichever failed last - so a redirect to the cloud metadata
    service came back as "check the branch name". A refusal on security
    grounds is the answer, not a step on the way to one.
    """


@dataclass
class Imported:
    name: str
    ref: Optional[str]
    source_url: str
    files: List[Tuple[str, bytes]] = field(default_factory=list)
    skipped: Dict[str, int] = field(default_factory=dict)

    def note(self, why: str) -> None:
        self.skipped[why] = self.skipped.get(why, 0) + 1


# ------------------------------------------------------------------ allowlist

def allowlist() -> List[str]:
    raw = os.getenv(ENV_ALLOW, "")
    return [h.strip().lower().rstrip(".") for h in raw.split(",") if h.strip()]


def configured() -> bool:
    return bool(allowlist())


def status() -> Dict[str, object]:
    hosts = allowlist()
    return {
        "enabled": bool(hosts),
        "hosts": hosts,
        # Whether a token exists, never the token.
        "token_set": bool(os.getenv(ENV_TOKEN, "").strip()),
        "detail": (
            f"Importing is allowed from: {', '.join(hosts)}."
            if hosts else
            f"Importing from a link is off. Set {ENV_ALLOW} to the hosts you "
            f"trust, e.g. {ENV_ALLOW}=github.com,codeload.github.com - WCC will "
            f"fetch from those and nowhere else."
        ),
        "max_files": MAX_FILES,
        "max_bytes": MAX_UNPACKED_BYTES,
    }


def host_allowed(host: str) -> bool:
    """Exactly a listed host, or a subdomain of one.

    Written out rather than done with `endswith`, because "notgithub.com"
    ends with "github.com" and that is precisely the bug worth not having.
    """
    host = (host or "").lower().rstrip(".")
    for allowed in allowlist():
        if host == allowed or host.endswith("." + allowed):
            return True
    return False


def _check(url: str) -> None:
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https"):
        raise NotAllowed(
            f"{parsed.scheme or 'that'} is not a scheme WCC will fetch. Use http or https."
        )
    if not host_allowed(parsed.hostname or ""):
        raise NotAllowed(
            f"{parsed.hostname or 'That host'} is not in {ENV_ALLOW}, so WCC will not "
            f"fetch from it. Add it there if you trust it."
        )


# -------------------------------------------------------------- link → source

# A GitLab project can be nested several groups deep, so the path before the
# "/-/" separator is taken whole rather than assumed to be two segments.
_GITLAB = re.compile(r"^/(?P<project>.+?)/-/(?P<kind>tree|blob|raw|archive)/(?P<rest>.+)$")
_FORGE = re.compile(r"^/(?P<owner>[^/]+)/(?P<repo>[^/]+?)(?:\.git)?"
                    r"(?:/(?P<kind>tree|blob|raw)/(?P<ref>[^/]+)(?:/(?P<sub>.*))?)?/?$")

ARCHIVE_SUFFIXES = (".tar.gz", ".tgz", ".zip")
DEFAULT_REFS = ("main", "master")


@dataclass
class Source:
    """One thing to fetch, and what to do with what comes back."""
    url: str
    kind: str                 # "archive" | "file"
    name: str
    ref: Optional[str] = None
    subdir: str = ""


def resolve(link: str) -> List[Source]:
    """Turn a pasted link into the candidates to try, best first.

    A bare repository link does not say which branch it is on, and finding out
    means an API call to a host that may not be the one allowlisted. Trying
    main and then master is one extra request in the uncommon case and no
    dependency on either forge's API.
    """
    link = (link or "").strip()
    if not link:
        raise ImportRefused("There is no link there.")
    parsed = urlparse(link)
    if not parsed.scheme:
        parsed = urlparse("https://" + link)
    host, path = (parsed.hostname or ""), parsed.path or "/"

    # An archive link, or a raw file link, is already the thing to fetch.
    if path.lower().endswith(ARCHIVE_SUFFIXES):
        return [Source(url=parsed.geturl(), kind="archive",
                       name=_name_from_path(path))]
    if host.startswith("raw.") or "/raw/" in path:
        return [Source(url=parsed.geturl(), kind="file",
                       name=_name_from_path(path))]

    base = f"{parsed.scheme or 'https'}://{parsed.netloc}"

    gitlab = _GITLAB.match(path)
    if gitlab:
        project = gitlab.group("project").strip("/")
        kind, rest = gitlab.group("kind"), gitlab.group("rest")
        if kind in ("blob", "raw"):
            ref, _, inner = rest.partition("/")
            return [Source(url=f"{base}/{project}/-/raw/{ref}/{inner}",
                           kind="file", name=_name_from_path(inner), ref=ref)]
        if kind == "archive":
            return [Source(url=parsed.geturl(), kind="archive",
                           name=_name_from_path(project))]
        ref, _, subdir = rest.partition("/")
        return [_gitlab_archive(base, project, ref, subdir)]

    forge = _FORGE.match(path)
    if forge and forge.group("owner") and forge.group("repo"):
        owner, repo = forge.group("owner"), forge.group("repo")
        kind, ref, sub = forge.group("kind"), forge.group("ref"), forge.group("sub") or ""
        if kind in ("blob", "raw"):
            return [Source(url=f"{base}/{owner}/{repo}/raw/{ref}/{sub}",
                           kind="file", name=_name_from_path(sub), ref=ref)]
        if ref:
            return [_forge_archive(base, owner, repo, ref, sub)]
        return [_forge_archive(base, owner, repo, r, "") for r in DEFAULT_REFS]

    raise ImportRefused(
        "That does not look like a repository link. Paste the page you would "
        "browse the files on - a repository, a branch, or a folder inside one - "
        "or a direct link to a .tar.gz or .zip."
    )


def _forge_archive(base: str, owner: str, repo: str, ref: str, sub: str) -> Source:
    # The shape GitHub serves, and the one Gitea and Forgejo copied.
    return Source(url=f"{base}/{owner}/{repo}/archive/{ref}.tar.gz",
                  kind="archive", name=sub.strip("/").split("/")[-1] or repo,
                  ref=ref, subdir=sub.strip("/"))


def _gitlab_archive(base: str, project: str, ref: str, sub: str) -> Source:
    leaf = project.rstrip("/").split("/")[-1]
    return Source(url=f"{base}/{project}/-/archive/{ref}/{leaf}-{ref}.tar.gz",
                  kind="archive", name=sub.strip("/").split("/")[-1] or leaf,
                  ref=ref, subdir=sub.strip("/"))


def _name_from_path(path: str) -> str:
    leaf = unquote((path or "").rstrip("/").split("/")[-1]) or "imported"
    for suffix in ARCHIVE_SUFFIXES:
        if leaf.lower().endswith(suffix):
            leaf = leaf[: -len(suffix)]
    return leaf or "imported"


# ------------------------------------------------------------------ fetching

def _private(host: str) -> bool:
    """Does this name resolve somewhere only this server can see?

    Not a veto - an internal GitLab is exactly the case worth supporting, and
    somebody listed it on purpose. It decides whether a token travels.
    """
    try:
        infos = socket.getaddrinfo(host, None)
    except socket.gaierror:
        return False
    for info in infos:
        try:
            ip = ipaddress.ip_address(info[4][0])
        except ValueError:
            continue
        if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved:
            return True
    return False


def fetch(url: str) -> Tuple[bytes, str]:
    """GET a URL, re-checking the allowlist at every redirect.

    httpx would follow redirects for us, and that is the problem: the check has
    to happen per hop. An allowlisted host that answers 302 to somewhere else is
    the ordinary way this kind of guard is defeated.
    """
    _check(url)
    token = os.getenv(ENV_TOKEN, "").strip()
    first_host = urlparse(url).hostname

    headers = {"User-Agent": "work-control-center", "Accept": "*/*"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
        headers["PRIVATE-TOKEN"] = token          # what GitLab calls it

    try:
        with httpx.Client(timeout=TIMEOUT, follow_redirects=False) as client:
            for _ in range(MAX_REDIRECTS + 1):
                response = client.get(url, headers=headers)
                if response.status_code in (301, 302, 303, 307, 308):
                    location = response.headers.get("location")
                    if not location:
                        raise ImportRefused(
                            f"{url} redirected without saying where to.")
                    url = str(response.url.join(location))
                    _check(url)
                    if urlparse(url).hostname != first_host:
                        # A different host is a different trust decision, and
                        # the token was issued for the first one.
                        headers.pop("Authorization", None)
                        headers.pop("PRIVATE-TOKEN", None)
                    continue

                if response.status_code == 404:
                    raise ImportRefused(
                        f"{url} is not there. Check the branch name - WCC tries "
                        f"main and master for a bare repository link - and "
                        f"whether the repository is private."
                    )
                if response.status_code in (401, 403):
                    raise ImportRefused(
                        f"{url} refused the request ({response.status_code}). If "
                        f"the repository is private, set {ENV_TOKEN} to a read-only "
                        f"token for it."
                    )
                if response.status_code >= 400:
                    raise ImportRefused(
                        f"{url} answered {response.status_code}.")

                body = response.content
                if len(body) > MAX_DOWNLOAD_BYTES:
                    raise ImportRefused(
                        f"That download is {len(body) // (1024 * 1024)} MB. The "
                        f"limit is {MAX_DOWNLOAD_BYTES // (1024 * 1024)} MB."
                    )
                return body, url
        raise ImportRefused(f"{url} redirected more than {MAX_REDIRECTS} times.")
    except httpx.HTTPError as e:
        raise ImportRefused(
            f"Could not reach {urlparse(url).hostname}: {type(e).__name__}."
        ) from e


# ----------------------------------------------------------------- unpacking

def _keep(path: str) -> bool:
    lowered = path.lower()
    parts = lowered.split("/")
    if any(p in SKIP_DIRS for p in parts):
        return False
    if any(p.startswith(".") for p in parts[:-1]):
        return False
    dot = lowered.rfind(".")
    return dot != -1 and lowered[dot:] in KEEP


def _clean(raw: str) -> str:
    """Re-root an archive entry so it cannot climb out of the tool.

    Shares the rule the upload path uses, so an imported tool and an uploaded
    one are laid out identically - and so "../../etc/passwd" comes out as
    "etc/passwd" rather than anywhere.
    """
    from app.api.attachments import clean_path
    return clean_path(raw)


def unpack(blob: bytes, source: Source) -> Imported:
    out = Imported(name=source.name, ref=source.ref, source_url=source.url)

    if source.kind == "file":
        path = _clean(_name_from_path(urlparse(source.url).path))
        if not _keep(path):
            raise ImportRefused(
                f"{path} is not a file a tool is made of. Tools are HTML, CSS, "
                f"JavaScript and their assets."
            )
        out.files.append((path, blob))
        return out

    members = _members(blob)

    # Every archive from a forge wraps the tree in "repo-branch/". The upload
    # path strips that same wrapper off a folder chosen in the browser, so the
    # two routes produce the same layout.
    from app.api.attachments import strip_common_root
    names = [_clean(n) for n, _ in members]
    rooted = strip_common_root(names)

    prefix = (source.subdir.strip("/") + "/") if source.subdir else ""
    total = 0
    for (original, read), path in zip(members, rooted):
        if prefix:
            if not path.startswith(prefix):
                continue
            path = path[len(prefix):]
        if not path:
            continue
        if not _keep(path):
            out.note("not part of a web page")
            continue
        if len(out.files) >= MAX_FILES:
            out.note("over the file limit")
            continue

        body = read()
        total += len(body)
        if total > MAX_UNPACKED_BYTES:
            raise ImportRefused(
                f"The files come to more than "
                f"{MAX_UNPACKED_BYTES // (1024 * 1024)} MB unpacked. Import a "
                f"folder inside the repository rather than the whole thing."
            )
        out.files.append((path, body))

    if not out.files:
        where = f" under {source.subdir}" if source.subdir else ""
        raise ImportRefused(
            f"Nothing{where} in that repository looks like part of a web tool. "
            f"Point the link at the folder holding index.html."
        )
    return out


def _members(blob: bytes):
    """(name, read) for each regular file, for a .tar.gz or a .zip.

    Only regular files. A symlink or a device node in an archive is either a
    mistake or an attempt to write somewhere else, and neither belongs in a
    folder that gets served back to a browser.
    """
    if blob[:2] == b"PK":
        try:
            archive = zipfile.ZipFile(io.BytesIO(blob))
        except zipfile.BadZipFile as e:
            raise ImportRefused("That zip file could not be read.") from e
        out = []
        for info in archive.infolist():
            if info.is_dir():
                continue
            if info.file_size > MAX_UNPACKED_BYTES:
                continue
            out.append((info.filename, lambda i=info: archive.read(i)))
        return out

    try:
        archive = tarfile.open(fileobj=io.BytesIO(blob), mode="r:*")
    except tarfile.TarError as e:
        raise ImportRefused(
            "That download is not a .tar.gz or a .zip that WCC can read."
        ) from e
    out = []
    for member in archive.getmembers():
        if not member.isfile():           # dirs, symlinks, hardlinks, devices
            continue
        if member.size > MAX_UNPACKED_BYTES:
            continue
        out.append((member.name, lambda m=member: (archive.extractfile(m) or io.BytesIO()).read()))
    return out


# ------------------------------------------------------------------ the whole

def import_link(link: str) -> Imported:
    """Fetch and unpack, trying each candidate the link resolves to."""
    if not configured():
        raise ImportRefused(status()["detail"])

    # The allowlist is asked first, before the link is even understood. Reading
    # the shape first would mean an address like 169.254.169.254 - the cloud
    # metadata service, and the reason SSRF is worth caring about - is turned
    # away for looking odd rather than for being disallowed. Same outcome
    # today; the wrong reason to rely on tomorrow.
    pasted = (link or "").strip()
    if not pasted:
        raise ImportRefused("There is no link there.")
    parsed = urlparse(pasted if "//" in pasted else "https://" + pasted)
    _check(parsed.geturl())

    candidates = resolve(link)
    last: Optional[ImportRefused] = None
    for source in candidates:
        try:
            blob, final_url = fetch(source.url)
        except NotAllowed:
            raise                          # never hidden behind a later 404
        except ImportRefused as e:
            last = e
            continue                       # e.g. main missing, try master
        source.url = final_url
        return unpack(blob, source)
    raise last or ImportRefused("Nothing could be fetched from that link.")
