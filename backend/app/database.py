"""Database configuration and initialization"""
import os
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, declarative_base
from dotenv import load_dotenv

load_dotenv()

# Get database URL from environment
DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "postgresql://wcc_user:wcc_password@db:5432/wcc_db"
)

# Create engine
engine = create_engine(
    DATABASE_URL,
    echo=os.getenv("SQL_ECHO", "False").lower() == "true",
    pool_pre_ping=True,  # Verify connections before using them
)

# Create session factory
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

# Create declarative base for models
Base = declarative_base()

def get_db():
    """Dependency for getting database session"""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

def init_db():
    """Initialize database by creating all tables"""
    try:
        Base.metadata.create_all(bind=engine)
        print("Database tables created successfully")

        # Seed demo data if tables are empty
        db = SessionLocal()
        from app.models import Task
        if db.query(Task).count() == 0:
            print("Seeding demo data...")
            db.close()
            from seed_data import seed_data
            seed_data()
        else:
            db.close()
            print("Demo data already exists")
    except Exception as e:
        print(f"Error initializing database: {e}")

# Import all models to register them with Base
from app.models import (
    tasks, followups, projects, people, departments, vendors, systems, issues, meetings, categories
)
