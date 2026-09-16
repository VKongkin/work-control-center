# Installation Guide

## Prerequisites

- Docker 20.10+ 
- Docker Compose 2.0+
- Internet connection to pull images

## Installation Steps

### 1. Clone Repository

```bash
git clone <repository-url>
cd work-control-center
```

### 2. Create Environment File

```bash
cp .env.example .env
```

Edit `.env` if you want to customize:
- Database credentials
- API port
- Frontend port
- `WCC_VAULT_KEY` — needed only to store server passwords
- `WCC_AGENT_KEY` — needed only to enable the Copilot/MCP interface

The last two are generated, not chosen; `.env.example` has the commands, and
[COPILOT.md](COPILOT.md) explains what each does. Leaving them unset is fine —
the app runs without either.

### 3. Build and Start

Two compose files, for two situations.

**Running published images** — nothing is built, works on any machine with
Docker and no source:

```bash
docker compose up -d
# or: make up
```

**Building from this source tree** — what you want while working on the code:

```bash
docker compose -f docker-compose.build.yml up -d --build
# or: make dev
```

The build file compiles `./backend` and `./frontend` locally instead of pulling
`vkongkin/work-control-center`, and mounts `./backend` into the container so
Python edits apply on restart without rebuilding. Frontend changes need
`--build`, because the frontend ships as a compiled bundle.

Both files use the same named volume, so switching between them keeps your data.
Rebuilding never touches the database — Postgres is a pulled image with no build
step, so `--build` cannot rebuild it.

Wait for all services to be healthy (about 60 seconds):

```bash
docker compose ps
```

Look for "healthy" status on all services.

### 4. Verify Installation

**Frontend**: http://localhost:3000
- Should show the WCC dashboard
- If dashboard is loading, connection to backend is working

**API Documentation**: http://localhost:8000/docs
- Interactive API documentation
- All endpoints listed with test capability

**API Health**: http://localhost:8000/health
- Returns `{"status": "healthy"}`

**Database Admin** (Adminer): http://localhost:8080
- Server: db
- Username: wcc_user  
- Password: wcc_password
- Database: wcc_db

**Agent interface** (only if you set `WCC_AGENT_KEY`):

```bash
make agent-check
```

Reports whether the interface is on, whether the key in `.env` is the one the
running container has, and what to do about it if not.

## Verification Checklist

- [ ] All containers are healthy: `docker compose ps`
- [ ] Frontend loads: http://localhost:3000
- [ ] Dashboard shows statistics
- [ ] API docs visible: http://localhost:8000/docs
- [ ] Database accessible: http://localhost:8080

## Troubleshooting Installation

### Ports already in use

Symptom: `Bind for 0.0.0.0:8000 failed: port is already allocated`, or the app
starts but you reach something else entirely.

**First, find out what owns it. Do not kill it** — on a work machine that port
usually belongs to something someone needs.

Windows (PowerShell):

```powershell
Get-NetTCPConnection -LocalPort 8000 -State Listen |
  ForEach-Object { Get-Process -Id $_.OwningProcess }

# or the old way
netstat -ano | findstr :8000
```

macOS and Linux:

```bash
lsof -i :8000
```

**Then move WCC, rather than moving the other application.** Every port is a
default, overridden in `.env`:

```env
FRONTEND_PORT=3100
API_PORT=8100
DB_PORT=5532
ADMINER_PORT=8180
```

```bash
docker compose up -d      # recreates the containers with the new mapping
```

No rebuild, and nothing inside the app needs to change. The browser calls the
API at the relative path `/api`, which nginx proxies to `backend:8000` on
Docker's own network — that internal port never changes, so the UI does not care
which port you published it on.

What does change:

| | |
|---|---|
| The app | `http://localhost:3100` |
| API docs | `http://localhost:8100/docs` |
| The agent URL for Copilot or VS Code | `http://<host>:8100/api/agent/mcp` |
| `make agent-check` | reads `API_PORT` from `.env`, so it follows by itself |

Pick something in the 1024–49151 range. Above 49152 is Windows' dynamic range,
where the OS hands out ports to outbound connections and will eventually collide
with you.

**A Windows-specific trap.** If a port fails to bind while `Get-NetTCPConnection`
shows nothing listening, Hyper-V has probably reserved a block containing it —
this is common on machines running Docker Desktop or WSL:

```powershell
netsh interface ipv4 show excludedportrange protocol=tcp
```

If your port is inside one of those ranges, no process holds it and nothing can
free it. Choose a port outside every listed range.

### The hostname is shared with other applications

If `wcc` has to live on a server that already serves other things, the answer is
not a free port — it is a name. Ask for a DNS record (`wcc.bank.local`, a CNAME
to the host) and put a reverse proxy in front that routes by `Host` header:

```nginx
server {
    listen 80;
    server_name wcc.bank.local;
    location / { proxy_pass http://127.0.0.1:3000; }
}
```

Then the URL is `http://wcc.bank.local` with no port at all, other apps on the
same box keep their own names, and you can change WCC's internal port whenever
you like without telling anyone.

This is worth doing early if Copilot Studio is the destination: that route needs
a hostname and HTTPS regardless, so a name now saves reconfiguring every client
later. See `COPILOT.md`.

### Docker Daemon Not Running

```bash
# Start Docker daemon
systemctl start docker    # Linux
# or start Docker Desktop on macOS/Windows
```

### Out of Disk Space

Clean up old Docker images:

```bash
docker system prune -a
```

### Slow Start

First run takes longer due to image building. Subsequent starts are faster.

```bash
# Monitor startup
docker compose logs -f
```

Wait for "Seeding demo data..." message to complete.

### Database Connection Failed

```bash
# Check database logs
docker compose logs db

# Verify database is healthy
docker compose ps db

# Reset database if needed
make reset
```

### Frontend Blank Page

Check browser console for errors:
1. Open DevTools (F12)
2. Go to Console tab
3. Look for error messages about API connection

Solution:
```bash
docker compose restart backend
docker compose restart frontend
```

## Next Steps After Installation

1. **Explore the Dashboard**
   - View statistics and alerts
   - Check demo data

2. **Create Your First Task**
   - Click "New Task" on dashboard
   - Fill in title and priority
   - Set due date

3. **Review Demo Data**
   - Navigate to Tasks page
   - Check Follow-ups
   - View Projects

4. **Read API Documentation**
   - Visit http://localhost:8000/docs
   - Try out some API endpoints

5. **Customize for Your Workflow**
   - Add your departments
   - Add your vendors
   - Modify categories

## Getting Help

Check the main README.md for:
- Complete feature documentation
- API endpoint reference
- Command reference
- Database schema

For database issues:
- Use Adminer (http://localhost:8080)
- Query database directly
- Check logs: `docker compose logs db`

For API issues:
- Check logs: `docker compose logs backend`
- Test endpoints at: http://localhost:8000/docs
- Verify database connection

For frontend issues:
- Check browser console
- Check logs: `docker compose logs frontend`
- Clear browser cache: Ctrl+Shift+Delete

## Uninstallation

To completely remove the application:

```bash
# Stop and remove containers
docker compose down

# Remove volumes (database data)
docker compose down -v

# Remove images
docker image rm work-control-center-frontend
docker image rm work-control-center-backend
docker image rm postgres:15-alpine
docker image rm adminer
docker image rm node:18-alpine
docker image rm python:3.11-slim
```

Or simply delete the project directory:

```bash
rm -rf work-control-center/
```
