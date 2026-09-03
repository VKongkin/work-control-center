.PHONY: help up dev down logs logs-backend logs-frontend logs-db restart clean reset status pull backup restore

DB_USER ?= wcc_user
DB_NAME ?= wcc_db
BUILD   := -f docker-compose.build.yml

help:
	@echo "Work Control Center"
	@echo ""
	@echo "  Running (published images - works on any machine with Docker)"
	@echo "    make up             Pull and start everything"
	@echo "    make pull           Fetch the newest images"
	@echo "    make down           Stop"
	@echo "    make status         Show service health"
	@echo ""
	@echo "  Developing (builds from this source tree)"
	@echo "    make dev            Build and start from source"
	@echo ""
	@echo "  Logs"
	@echo "    make logs           All services"
	@echo "    make logs-backend   Backend only"
	@echo "    make logs-frontend  Frontend only"
	@echo "    make logs-db        Database only"
	@echo ""
	@echo "  Data"
	@echo "    make backup         Write wcc-backup.sql from the running database"
	@echo "    make restore        Load wcc-backup.sql into the running database"
	@echo "    make reset          Delete all data and start fresh"
	@echo ""
	@echo "  Shells"
	@echo "    make shell-backend  Shell inside the backend container"
	@echo "    make shell-db       psql inside the database"
	@echo ""

up:
	docker compose up -d
	@echo ""
	@echo "  Frontend  http://localhost:3000"
	@echo "  API docs  http://localhost:8000/docs"
	@echo "  Database  http://localhost:8080"
	@echo ""

pull:
	docker compose pull

dev:
	docker compose $(BUILD) up -d --build
	@echo ""
	@echo "  Built from source. Frontend: http://localhost:3000"
	@echo ""

down:
	docker compose down

logs:
	docker compose logs -f

logs-backend:
	docker compose logs -f backend

logs-frontend:
	docker compose logs -f frontend

logs-db:
	docker compose logs -f db

restart:
	docker compose restart

status:
	docker compose ps

clean:
	docker compose down --remove-orphans

reset:
	docker compose down -v --remove-orphans
	docker compose up -d
	@echo ""
	@echo "  Database reset. Demo data reseeded."
	@echo ""

# Moving your real data to another machine: back up here, copy the file over,
# restore there. A fresh install seeds demo data instead, which is why your own
# tasks do not appear on a new machine until you restore.
backup:
	docker compose exec -T db pg_dump -U $(DB_USER) -d $(DB_NAME) --clean --if-exists > wcc-backup.sql
	@echo "Wrote wcc-backup.sql ($$(wc -c < wcc-backup.sql) bytes)"

restore:
	@test -f wcc-backup.sql || { echo "wcc-backup.sql not found"; exit 1; }
	docker compose exec -T db psql -U $(DB_USER) -d $(DB_NAME) < wcc-backup.sql
	docker compose restart backend
	@echo "Restored from wcc-backup.sql"

shell-backend:
	docker compose exec backend sh

shell-frontend:
	docker compose exec frontend sh

shell-db:
	docker compose exec db psql -U $(DB_USER) -d $(DB_NAME)
