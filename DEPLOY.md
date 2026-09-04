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

### Before anything risky

```bash
make backup     # writes wcc-backup.sql
```

Worth doing before upgrading Postgres major versions, which is the one change
an existing volume cannot survive on its own.

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
POSTGRES_PASSWORD=something-better
```

Set `POSTGRES_PASSWORD` **before** the first start. Postgres only reads it when
it initialises the volume; changing it later has no effect until you
`docker compose down -v`, which erases the database.

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
