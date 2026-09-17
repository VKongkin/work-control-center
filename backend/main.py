"""
Work Control Center - FastAPI Backend
Main application entry point
"""
import logging
import os
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

# Background syncing reports what it did through the log, since nobody is
# watching a screen when it runs.
logging.basicConfig(
    level=os.getenv("WCC_LOG_LEVEL", "INFO").upper(),
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)

# Import routers and models
from app.api import tasks, followups, projects, people, departments, vendors, systems, issues, meetings, categories, dashboard, alerts, search, attachments, tools, calendar, knowledge, servers, agent, chat
from app.database import engine, Base, init_db
from app.validation import register_error_handlers

def _warn_if_passwords_are_reachable() -> None:
    """Say out loud, once, that storing passwords here assumes a private port.

    WCC has no login: every route under /api answers whoever can open a socket
    to it, and that includes revealing a stored password. On one person's
    laptop that is fine and is the design. On a shared host it is not, and the
    person who moves it there is unlikely to be thinking about it - so the log
    says so at the moment the combination first exists, rather than leaving it
    to be discovered.
    """
    if not os.getenv("WCC_VAULT_KEY", "").strip():
        return
    logging.getLogger("wcc").warning(
        "Password storage is ON (WCC_VAULT_KEY is set). This application has no "
        "login, so anyone who can reach this port can read a stored password. "
        "Keep the port private to this machine, or leave WCC_VAULT_KEY unset on "
        "a shared host - the inventory and vault_location still work without it. "
        "See DEPLOY.md, 'Who can reach it'."
    )


# Create tables on startup
@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: Create tables
    init_db()
    _warn_if_passwords_are_reachable()
    # Keep connected calendars up to date without anyone pressing a button.
    from app.services import scheduler
    await scheduler.start()
    yield
    await scheduler.stop()

# Create FastAPI app
app = FastAPI(
    title="Work Control Center API",
    description="API for managing work items, follow-ups, and projects",
    version="1.0.0",
    lifespan=lifespan
)

# Turn constraint violations and bad enum values into readable messages
register_error_handlers(app)

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # In production, restrict this
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include routers
app.include_router(dashboard.router, prefix="/api", tags=["Dashboard"])
app.include_router(tasks.router, prefix="/api/tasks", tags=["Tasks"])
app.include_router(followups.router, prefix="/api/followups", tags=["Follow-ups"])
app.include_router(projects.router, prefix="/api/projects", tags=["Projects"])
app.include_router(people.router, prefix="/api/people", tags=["People"])
app.include_router(departments.router, prefix="/api/departments", tags=["Departments"])
app.include_router(vendors.router, prefix="/api/vendors", tags=["Vendors"])
app.include_router(systems.router, prefix="/api/systems", tags=["Systems"])
app.include_router(issues.router, prefix="/api/issues", tags=["Issues"])
app.include_router(meetings.router, prefix="/api/meetings", tags=["Meetings"])
app.include_router(categories.router, prefix="/api/categories", tags=["Categories"])
app.include_router(attachments.router, prefix="/api/attachments", tags=["Attachments"])
app.include_router(tools.router, prefix="/api/tools", tags=["Tools"])
app.include_router(calendar.router, prefix="/api/calendar", tags=["Calendar"])
app.include_router(knowledge.router, prefix="/api/knowledge", tags=["Knowledge"])
app.include_router(servers.router, prefix="/api/servers", tags=["Servers"])
app.include_router(agent.router, prefix="/api/agent", tags=["Agent"])
app.include_router(chat.router, prefix="/api/chat", tags=["Chat"])
app.include_router(alerts.router, prefix="/api/alerts", tags=["Alerts"])
app.include_router(search.router, prefix="/api/search", tags=["Search"])

@app.get("/")
async def root():
    return {
        "message": "Work Control Center API",
        "version": "1.0.0",
        "docs": "/docs"
    }

@app.get("/health")
async def health():
    return {"status": "healthy"}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=int(os.getenv("API_PORT", 8000)),
        reload=True
    )
