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

def ensure_schema():
    """Add columns and indexes that the models have but the database does not.

    `create_all` only ever creates whole tables, so upgrading an existing
    install - which is the normal case, since the data lives in a Docker volume
    that survives every image change - would otherwise leave the new columns
    missing and every query failing. This is additive only: nothing is dropped,
    renamed or retyped, so it can never cost you data.
    """
    from sqlalchemy import inspect, text
    from sqlalchemy.schema import CreateIndex

    inspector = inspect(engine)
    tables = set(inspector.get_table_names())
    compiler = engine.dialect.type_compiler
    added = []

    with engine.begin() as conn:
        for table in Base.metadata.sorted_tables:
            if table.name not in tables:
                continue  # create_all just made it, in full

            have = {c["name"] for c in inspector.get_columns(table.name)}
            for column in table.columns:
                if column.name in have:
                    continue
                ddl = f'ALTER TABLE "{table.name}" ADD COLUMN "{column.name}" ' \
                      f'{compiler.process(column.type)}'
                # A default matters here: existing rows need a sensible value,
                # and "source" in particular decides whether a meeting may be
                # deleted. Everything already in the table was created by hand.
                if column.default is not None and getattr(column.default, "is_scalar", False):
                    value = column.default.arg
                    literal = f"'{value}'" if isinstance(value, str) else str(value)
                    ddl += f" DEFAULT {literal}"
                conn.execute(text(ddl))
                added.append(f"{table.name}.{column.name}")

            known = {i["name"] for i in inspector.get_indexes(table.name)}
            for index in table.indexes:
                if index.name not in known:
                    conn.execute(CreateIndex(index))
                    added.append(f"index {index.name}")

    if added:
        print(f"Schema updated: {', '.join(added)}")


def init_db():
    """Initialize database by creating all tables"""
    try:
        Base.metadata.create_all(bind=engine)
        ensure_schema()
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
