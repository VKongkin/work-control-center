"""Issue model"""
from sqlalchemy import Column, Integer, String, Text, DateTime, ForeignKey, Enum as SQLEnum
from sqlalchemy.orm import relationship
from datetime import datetime
import enum
from app.database import Base


class IssueSeverity(str, enum.Enum):
    CRITICAL = "CRITICAL"
    HIGH = "HIGH"
    MEDIUM = "MEDIUM"
    LOW = "LOW"


class IssueStatus(str, enum.Enum):
    OPEN = "OPEN"
    INVESTIGATING = "INVESTIGATING"
    MITIGATING = "MITIGATING"
    BLOCKED = "BLOCKED"
    RESOLVED = "RESOLVED"
    CLOSED = "CLOSED"


class Issue(Base):
    __tablename__ = "issues"

    id = Column(Integer, primary_key=True, index=True)
    title = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    severity = Column(SQLEnum(IssueSeverity), default=IssueSeverity.MEDIUM)
    status = Column(SQLEnum(IssueStatus), default=IssueStatus.OPEN)

    system_id = Column(Integer, ForeignKey("systems.id"), nullable=True)
    project_id = Column(Integer, ForeignKey("projects.id"), nullable=True)
    responsible_person_id = Column(Integer, ForeignKey("people.id"), nullable=True)
    vendor_id = Column(Integer, ForeignKey("vendors.id"), nullable=True)
    department_id = Column(Integer, ForeignKey("departments.id"), nullable=True)

    detected_at = Column(DateTime, nullable=True)
    resolved_at = Column(DateTime, nullable=True)
    root_cause = Column(Text, nullable=True)
    resolution = Column(Text, nullable=True)
    notes = Column(Text, nullable=True)

    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    # Relationships
    system = relationship("System", back_populates="issues")
    project = relationship("Project", back_populates="issues")
    responsible_person = relationship("Person", back_populates="issues")
    vendor = relationship("Vendor", back_populates="issues")
    department = relationship("Department", back_populates="issues")
    activities = relationship("Activity", back_populates="issue", cascade="all, delete-orphan")
