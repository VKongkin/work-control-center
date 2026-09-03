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

### 3. Build and Start

```bash
docker compose up -d --build
```

Or use the Makefile:

```bash
make up
```

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

## Verification Checklist

- [ ] All containers are healthy: `docker compose ps`
- [ ] Frontend loads: http://localhost:3000
- [ ] Dashboard shows statistics
- [ ] API docs visible: http://localhost:8000/docs
- [ ] Database accessible: http://localhost:8080

## Troubleshooting Installation

### Ports Already in Use

If you get "Address already in use" error:

```bash
# Find which process is using the port
lsof -i :3000   # Frontend
lsof -i :8000   # Backend API
lsof -i :5432   # Database

# Kill the process
kill -9 <PID>

# Or change ports in docker-compose.yml
```

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
