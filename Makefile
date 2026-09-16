.PHONY: help up dev down logs logs-backend logs-frontend logs-db restart clean reset status pull backup restore agent-check

DB_USER ?= wcc_user
DB_NAME ?= wcc_db
BUILD   := -f docker-compose.build.yml

help:
	@echo "Work Control Center"
	@echo ""
	@echo "  Your data lives in the volume work-control-center_postgres_data."
	@echo "  Only 'make reset' or 'docker compose down -v' can delete it."
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
	@echo "    make reset          Delete all data and start fresh (asks first)"
	@echo ""
	@echo "  Agent (Copilot / MCP)"
	@echo "    make agent-check    Check the agent interface is on and reachable"
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

# The only command here that destroys data. It asks first and takes a backup
# anyway, so a mistyped `make reset` is recoverable.
reset:
	@echo ""
	@echo "  This deletes the database volume and every record in it."
	@echo "  A backup will be written to wcc-backup.sql first."
	@echo ""
	@printf '  Type ERASE to confirm: '; read ans; \
	  [ "$$ans" = "ERASE" ] || { echo "  Cancelled - nothing was touched."; exit 1; }
	-@docker compose exec -T db pg_dump -U $(DB_USER) -d $(DB_NAME) --clean --if-exists > wcc-backup.sql 2>/dev/null \
	  && echo "  Backed up to wcc-backup.sql" || echo "  (database not running - no backup taken)"
	docker compose down -v --remove-orphans
	docker compose up -d
	@echo ""
	@echo "  Database reset. Demo data reseeded."
	@echo "  Your previous data is in wcc-backup.sql - restore it with: make restore"
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

# Is the Copilot/MCP interface actually on? Reads the key out of .env so the
# answer does not depend on remembering it. See COPILOT.md.
agent-check:
	@port=$$(grep -E '^API_PORT=' .env 2>/dev/null | tail -1 | cut -d= -f2 | tr -d '[:space:]'); \
	 port=$${port:-8000}; \
	 url="http://localhost:$$port"; \
	 key=$$(grep -E '^WCC_AGENT_KEY=' .env 2>/dev/null | tail -1 | cut -d= -f2- | tr -d '[:space:]'); \
	 echo ""; \
	 echo "  API        $$url"; \
	 if ! curl -fsS "$$url/health" >/dev/null 2>&1; then \
	   echo "  Result     the API is not answering. Is it running? 'make status'"; echo ""; exit 1; fi; \
	 status=$$(curl -fsS "$$url/api/agent/status"); \
	 echo "  Status     $$status" | head -c 400; echo ""; \
	 case "$$status" in *'"enabled": true'*|*'"enabled":true'*) ;; \
	   *) echo ""; echo "  Result     switched off. Put WCC_AGENT_KEY in .env and 'docker compose up -d'."; \
	      echo "             See COPILOT.md step 1."; echo ""; exit 1 ;; esac; \
	 if [ -z "$$key" ]; then \
	   echo ""; echo "  Result     enabled, but WCC_AGENT_KEY is not in .env so this cannot test a call."; echo ""; exit 1; fi; \
	 reply=$$(curl -fsS -X POST "$$url/api/agent/mcp" -H 'Content-Type: application/json' \
	   -H "X-API-Key: $$key" \
	   -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' 2>/dev/null); \
	 case "$$reply" in *search_knowledge*) \
	   echo ""; \
	   echo "  Result     working. The key in .env is accepted and the tools are listed."; \
	   echo ""; \
	   echo "  MCP        $$url/api/agent/mcp      (header X-API-Key)"; \
	   echo "  OpenAPI    $$url/api/agent/openapi.json"; \
	   echo ""; \
	   echo "  Next       COPILOT.md step 3 - point VS Code or Claude Desktop at it."; \
	   echo "" ;; \
	   *) echo ""; echo "  Result     enabled, but the key in .env was rejected."; \
	      echo "             The running container may still have an older key - 'docker compose up -d'."; \
	      echo ""; exit 1 ;; esac
