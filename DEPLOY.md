# Running on another machine

The published images hold the application. The database is the stock
`postgres:15-alpine` image, pulled straight from Docker Hub — there is nothing
of ours to publish for it. What the other machine needs is the compose file that
wires the four services together.

## The short version

```bash
git clone https://github.com/VKongkin/work-control-center.git
cd work-control-center
docker compose up -d
```

That pulls `backend-latest`, `frontend-latest`, Postgres and Adminer, and starts
them. No build step, no Node, no Python — only Docker.

Then open **http://localhost:3000**.

## Without cloning anything

If you only want to run it, one file is enough:

```bash
curl -fsSL https://raw.githubusercontent.com/VKongkin/work-control-center/main/docker-compose.yml -o docker-compose.yml
docker compose up -d
```

Or without even writing the file to disk:

```bash
curl -fsSL https://raw.githubusercontent.com/VKongkin/work-control-center/main/docker-compose.yml \
  | docker compose -f - up -d
```

Both need the repository to be public. If it is private, clone with your
credentials instead.

## Your data does not travel with the images

This is the part that surprises people. The images carry the *application*; your
tasks and follow-ups live in a Docker volume on the machine that created them. A
fresh install starts with an empty database, which the backend then seeds with
demo data — so the new machine will look populated, but with sample records
rather than yours.

To carry your real data across:

```bash
# on the machine that has your data
make backup                    # writes wcc-backup.sql

# copy wcc-backup.sql to the other machine, then there:
make restore
```

Without `make`:

```bash
docker compose exec -T db pg_dump -U wcc_user -d wcc_db --clean --if-exists > wcc-backup.sql
docker compose exec -T db psql   -U wcc_user -d wcc_db < wcc-backup.sql
```

## What can and cannot delete your data

Your records live in a Docker **volume**, not inside a container. Containers are
disposable; the volume is not.

| Command | Effect on your data |
|---|---|
| `docker compose up -d` | Safe. Reuses the existing volume. |
| `docker compose up -d --build` | Safe. Postgres has no build step — it is a pulled image, so `--build` never touches it. Only the app images rebuild. |
| `docker compose down` | Safe. Stops containers, volume untouched. |
| `docker compose restart` | Safe. |
| `docker compose pull` | Safe. Newer app images, same database. |
| **`docker compose down -v`** | **Deletes everything.** The `-v` removes volumes. |
| **`make reset`** | **Deletes everything** — but asks for confirmation and writes `wcc-backup.sql` first. |

So a plain `up -d --build` is not the risk. The `-v` flag is.

### The failure that actually looks like data loss

The volume used to be named after the folder. Clone into `wcc` instead of
`work-control-center`, or rename the directory, and Compose would look for a
volume that does not exist, create an empty one, and start a fresh database.
Nothing was deleted — the old volume is still there — but it reads as total
data loss.

The project and volume names are now pinned in the compose file, so the folder
name no longer matters. Confirm yours matches:

```bash
docker volume ls | grep postgres_data
# expected: work-control-center_postgres_data
```

If it prints a different name, your data is in that volume. Either rename the
pin in `docker-compose.yml` to match it, or copy it across:

```bash
docker run --rm \
  -v OLD_NAME:/from -v work-control-center_postgres_data:/to \
  alpine sh -c 'cd /from && cp -a . /to'
```

Uploaded files - task attachments and the files making up a tool - are stored
in the database, so `make backup` captures them along with everything else. The
limit is 10 MB per file.

Calendar connections are in the database too, including the encrypted Microsoft
sign-in token. A restore onto a machine with a different `WCC_SECRET_KEY` cannot
read that token, so you would simply sign in again; nothing else is affected.
See `CALENDAR.md`.

### Before anything risky

```bash
make backup     # writes wcc-backup.sql
```

Worth doing before upgrading Postgres major versions, which is the one change
an existing volume cannot survive on its own.

## Upgrading an existing install

New columns are added to your existing database automatically on startup. The
backend compares the tables it finds against the ones it expects and issues the
missing `ADD COLUMN`s — additive only: nothing is dropped, renamed or retyped,
so an upgrade cannot cost you data.

```bash
docker compose pull && docker compose up -d
docker compose logs backend | grep "Schema updated"
```

This is what lets `docker compose pull` be safe on a volume holding months of
work. It is not a substitute for `make backup` before a Postgres **major**
version change, which is a different kind of upgrade entirely.

## Choosing a version

`docker compose up -d` follows `latest`, which moves every time you push to
`main`. To pin a specific release, tag it in git (`git tag v1.0.0 && git push
--tags`), let the workflow publish it, then:

```bash
WCC_TAG=v1.0.0 docker compose up -d
```

## Changing ports or credentials

Every value has a default, so nothing is required. To override, put a `.env`
file next to the compose file:

```bash
FRONTEND_PORT=3001
API_PORT=8001
DB_PORT=5433
ADMINER_PORT=8081
POSTGRES_PASSWORD=something-better
```

Moving a port is safe and needs no rebuild — `docker compose up -d` recreates
the container with the new mapping. Nothing inside the app is affected either:
the browser calls the API at the relative path `/api`, which nginx proxies to
`backend:8000` on Docker's own network, and that internal port never changes.
Only the addresses you type change, plus the agent URL if you have set one up.

Avoid ports above 49151 on Windows — that is the dynamic range the OS hands out
to outbound connections, so it will collide with you eventually. If a port
refuses to bind while nothing appears to be listening, see the Hyper-V reserved
ranges note in `INSTALLATION.md`.

Set `POSTGRES_PASSWORD` **before** the first start. Postgres only reads it when
it initialises the volume; changing it later has no effect until you
`docker compose down -v`, which erases the database.

## Who can reach it

**WCC has no login.** Everything under `/api` answers anyone who can open a TCP
connection to it — including the server inventory and, if you have set
`WCC_VAULT_KEY`, the endpoint that reveals a stored password. `WCC_AGENT_KEY`
protects only `/api/agent/*`. Port 3000 is not safer than 8000: nginx proxies
`/api/` through to the same backend.

That is the right design for one person on `localhost`, which is the install
this document describes. It stops being right the moment the ports are reachable
by someone else.

If you put WCC on a shared machine:

- **Leave `WCC_VAULT_KEY` unset there.** The inventory, the accounts and the
  `vault_location` field all still work — you keep the map without the safe, and
  there is no stored password to lose.
- Or put something in front of it: a reverse proxy with SSO, or firewall rules
  that admit only your own workstation.
- Either way, do not publish it to the internet as it stands — including through
  a tunnel.

`COPILOT.md` covers this again in the context of letting Copilot reach it, which
is the usual reason someone moves WCC off their laptop in the first place.

## Environment variables worth knowing

Everything has a working default; these only matter when you want to change
behaviour.

| Variable | Default | What it does |
|---|---|---|
| `WCC_AUTO_SYNC` | `1` | Set to `0` to stop connected calendars syncing on a schedule. Manual syncing still works. |
| `WCC_SYNC_TICK_SECONDS` | `60` | How often the scheduler looks for calendars that are due. Rarely worth changing. |
| `WCC_TIMEZONE` | unset | Fallback zone for a calendar with none of its own. See `CALENDAR.md`. |
| `WCC_SECRET_KEY` | generated | Encrypts stored Microsoft sign-in tokens. Change it and you sign in again. |
| `WCC_VAULT_KEY` | unset | Encrypts server passwords on the Servers page. Unset means the inventory works normally but storing a password is refused — there is deliberately **no** fallback key in the database. See below. |
| `WCC_AGENT_KEY` | unset | Turns on the Copilot/MCP agent interface and is the key it requires. Unset means every agent route returns 401. See `COPILOT.md`. |
| `WCC_AGENT_EXPOSE_ACCOUNTS` | `0` | Set to `1` to let the agent's `list_servers` include account usernames. Never includes a password at any setting. |

### About `WCC_VAULT_KEY`

Unlike `WCC_SECRET_KEY`, this one is never generated for you and never stored in
the database. A key sitting beside the passwords it protects means one stolen
backup gives up both, so the app would rather refuse to store a password than
pretend to protect it.

Generate one and keep it in your own password manager:

```bash
python3 -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
```

Lose it and the stored passwords cannot be read back — which is the point. Every
account also records where its credential of record lives, so losing the key
costs you convenience rather than the credential.

## Updating

```bash
docker compose pull && docker compose up -d
```

The volume survives, so your data stays.

## Building from source instead

Only needed when working on the code itself:

```bash
docker compose -f docker-compose.build.yml up -d --build
```

The default `docker-compose.yml` deliberately has no build section — otherwise
a clone on a new machine would rebuild everything from scratch and never use the
images you publish.

## If the images are not there yet

`docker compose up -d` fails with *manifest unknown* until the GitHub workflow
has published at least once. Check the Actions tab. Until then, use the build
file above.
