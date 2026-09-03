.PHONY: help build up down logs logs-backend logs-frontend logs-db restart clean reset

help:
	@echo "Work Control Center - Available Commands"
	@echo ""
	@echo "  make build          - Build Docker images"
	@echo "  make up             - Start all services"
	@echo "  make down           - Stop all services"
	@echo "  make logs           - View logs from all services"
	@echo "  make logs-backend   - View backend logs"
	@echo "  make logs-frontend  - View frontend logs"
	@echo "  make logs-db        - View database logs"
	@echo "  make restart        - Restart all services"
	@echo "  make clean          - Stop and remove containers"
	@echo "  make reset          - Reset database (removes all data)"
	@echo "  make status         - Show service status"
	@echo ""

build:
	docker compose build

up:
	docker compose up -d --build
	@echo ""
	@echo "✅ Application started!"
	@echo "   Frontend: http://localhost:3000"
	@echo "   API:      http://localhost:8000"
	@echo "   API Docs: http://localhost:8000/docs"
	@echo "   Database: http://localhost:8080 (Adminer)"
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

clean:
	docker compose down --remove-orphans

reset:
	docker compose down -v --remove-orphans
	docker compose up -d --build
	@echo ""
	@echo "✅ Database reset and application restarted!"
	@echo ""

status:
	docker compose ps

shell-backend:
	docker compose exec backend sh

shell-frontend:
	docker compose exec frontend sh

shell-db:
	docker compose exec db psql -U wcc_user -d wcc_db
