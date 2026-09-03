"""Shared request validation and friendly error translation.

The API originally accepted any string for enum columns, accepted an empty
title, and turned every database constraint violation into a bare 500. Each of
those reached the user as "Internal Server Error" with nothing actionable in
it. This module gives the schemas real constraints and turns the database's
own complaints into sentences a person can act on.
"""
from datetime import date, datetime, time
from typing import Annotated, Optional
from fastapi import Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import BeforeValidator, StringConstraints, ValidationError, field_validator
from sqlalchemy.exc import IntegrityError

# Column name -> the label a person recognises, for error messages.
FIELD_LABELS = {
    "title": "Title",
    "name": "Name",
    "status": "Status",
    "priority": "Priority",
    "severity": "Severity",
    "waiting_for_type": "Waiting for",
    "due_date": "Due date",
    "expected_date": "Expected by",
    "email": "Email",
}


def _label(loc) -> str:
    """Last meaningful path segment of a pydantic error location, humanised."""
    parts = [p for p in loc if isinstance(p, str) and p != "body"]
    field = parts[-1] if parts else "Field"
    return FIELD_LABELS.get(field, field.replace("_", " ").capitalize())


def _explain(err: dict) -> str:
    kind, msg = err.get("type", ""), err.get("msg", "Invalid value")
    label = _label(err.get("loc", ()))
    if kind == "missing":
        return f"{label} is required"
    if kind in ("string_too_short", "value_error") and "at least 1" in msg:
        return f"{label} cannot be blank"
    if kind == "string_too_long":
        return f"{label} is too long"
    msg = msg.replace("Value error, ", "")
    return f"{label}: {msg}"


def _messages(errors) -> str:
    seen, out = set(), []
    for e in errors:
        m = _explain(e)
        if m not in seen:
            seen.add(m)
            out.append(m)
    return "; ".join(out[:4])

# A required, human-entered name or title: trimmed, and not blank once trimmed.
Name = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=255)]


def _coerce_datetime(value):
    """Accept a plain calendar date where a timestamp is stored.

    Every date control in the UI submits "YYYY-MM-DD", which pydantic refuses
    for a datetime column - so before this, no date could be saved from any
    form in the app. A bare date means midnight on that day.
    """
    if isinstance(value, str):
        text = value.strip()
        if not text:
            return None
        try:
            return datetime.combine(date.fromisoformat(text), time.min)
        except ValueError:
            pass  # a full timestamp: let pydantic parse it as usual
    return value


# Use in place of `Optional[datetime]` on any field a person fills in. The
# validator wraps the Optional so that clearing a date ("") reads as "no date"
# rather than as an invalid timestamp.
Timestamp = Annotated[Optional[datetime], BeforeValidator(_coerce_datetime)]

TASK_STATUSES = ["INBOX", "PENDING", "IN_PROGRESS", "BLOCKED", "COMPLETED", "CANCELLED"]
PRIORITIES = ["P0_CRITICAL", "P1_HIGH", "P2_MEDIUM", "P3_LOW"]
FOLLOWUP_STATUSES = ["WAITING", "FOLLOW_UP_DUE", "OVERDUE", "RECEIVED", "CANCELLED"]
WAITING_FOR_TYPES = ["PERSON", "DEPARTMENT", "VENDOR"]
PROJECT_STATUSES = ["PLANNED", "ACTIVE", "ON_HOLD", "COMPLETED", "CANCELLED"]
ISSUE_SEVERITIES = ["CRITICAL", "HIGH", "MEDIUM", "LOW"]
ISSUE_STATUSES = ["OPEN", "INVESTIGATING", "MITIGATING", "BLOCKED", "RESOLVED", "CLOSED"]


def one_of(field: str, allowed: list[str]):
    """Field validator restricting a column to its known values.

    Partial-update schemas make every field optional, so None passes through
    untouched - it means "leave this alone", not "set it to nothing".
    """
    def _check(value):
        if value is None:
            return value
        if value not in allowed:
            raise ValueError(f"must be one of: {', '.join(allowed)}")
        return value

    return field_validator(field)(_check)


# --------------------------------------------------------------- error shaping

def _friendly_integrity_error(exc: IntegrityError) -> tuple[int, str]:
    """Translate a database constraint violation into a message and status."""
    detail = str(getattr(exc, "orig", exc))

    if "unique constraint" in detail.lower() or "duplicate key" in detail.lower():
        # These keep archived rows, which still hold their name - so a clash can
        # be with something the user cannot currently see.
        archivable = any(t in detail for t in ("people", "departments", "vendors", "systems"))
        hint = ' It may be archived - switch on "Show archived" to find it.' if archivable else ""
        # psycopg2 reports: Key (name)=(Network) already exists.
        if "Key (" in detail and ")=(" in detail:
            column = detail.split("Key (")[1].split(")")[0].replace("_", " ")
            value = detail.split(")=(")[1].split(")")[0]
            return 409, f'"{value}" already exists. Pick a different {column}.{hint}'
        return 409, f"That name is already taken. Pick a different one.{hint}"

    if "foreign key constraint" in detail.lower():
        return 422, (
            "One of the linked records no longer exists. "
            "Refresh the page and choose again."
        )

    if "not-null constraint" in detail.lower():
        column = "a required field"
        if 'column "' in detail:
            column = f'"{detail.split(chr(34))[1]}"'
        return 422, f"{column} cannot be empty."

    return 422, "That change conflicts with existing data."


def register_error_handlers(app):
    """Attach handlers so constraint failures never surface as a bare 500."""

    @app.exception_handler(IntegrityError)
    async def _integrity(request: Request, exc: IntegrityError):
        status, message = _friendly_integrity_error(exc)
        return JSONResponse(status_code=status, content={"detail": message})

    @app.exception_handler(RequestValidationError)
    async def _request_invalid(request: Request, exc: RequestValidationError):
        return JSONResponse(status_code=422, content={"detail": _messages(exc.errors())})

    @app.exception_handler(ValidationError)
    async def _model_invalid(request: Request, exc: ValidationError):
        # Raised by the merge() step on a partial update, after parsing.
        return JSONResponse(status_code=422, content={"detail": _messages(exc.errors())})

    @app.exception_handler(ValueError)
    async def _value(request: Request, exc: ValueError):
        return JSONResponse(status_code=422, content={"detail": str(exc)})
