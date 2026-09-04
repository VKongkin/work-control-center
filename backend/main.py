"""
Work Control Center - FastAPI Backend
Main application entry point
"""
import os
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

# Import routers and models
from app.api import tasks, followups, projects, people, departments, vendors, systems, issues, meetings, categories, dashboard, alerts, search, attachments, tools, calendar
from app.database import engine, Base, init_db
from app.validation import register_error_handlers

# Create tables on startup
@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: Create tables
    init_db()
    yield
    # Shutdown: cleanup if needed
    pass

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
