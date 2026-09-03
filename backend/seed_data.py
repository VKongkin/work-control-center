"""Seed initial demo data"""
from datetime import datetime, timedelta
from app.database import SessionLocal
from app.models import (
    Task, FollowUp, Project, Person, Department, Vendor, System, Issue, Meeting, Category
)
from app.models.tasks import TaskStatus, TaskPriority
from app.models.followups import FollowUpStatus, WaitingForType
from app.models.issues import IssueSeverity, IssueStatus
from app.models.projects import ProjectStatus


def seed_data():
    db = SessionLocal()

    # Clear existing data
    db.query(Task).delete()
    db.query(FollowUp).delete()
    db.query(Project).delete()
    db.query(Issue).delete()
    db.query(Meeting).delete()
    db.query(Person).delete()
    db.query(Department).delete()
    db.query(Vendor).delete()
    db.query(System).delete()
    db.query(Category).delete()

    # Create departments
    departments = [
        Department(name="Network", description="Network Infrastructure"),
        Department(name="Security", description="Security Team"),
        Department(name="Infrastructure", description="Infrastructure Operations"),
        Department(name="Application", description="Application Development"),
        Department(name="Operations", description="Operational Team"),
        Department(name="UAT", description="User Acceptance Testing"),
    ]
    db.add_all(departments)
    db.commit()

    # Create vendors
    vendors = [
        Vendor(name="Visa", type="Payment Processor"),
        Vendor(name="Network Vendor ABC", type="Network Equipment"),
        Vendor(name="Cloud Provider", type="Cloud Services"),
        Vendor(name="Security Vendor", type="Security Solutions"),
    ]
    db.add_all(vendors)
    db.commit()

    # Create people
    people = [
        Person(name="John Smith", email="john@company.com", role="Network Manager", department_id=departments[0].id),
        Person(name="Sarah Johnson", email="sarah@company.com", role="Security Lead", department_id=departments[1].id),
        Person(name="Mike Brown", email="mike@company.com", role="Sys Admin", department_id=departments[2].id),
        Person(name="Lisa Williams", email="lisa@company.com", role="Dev Lead", department_id=departments[3].id),
        Person(name="Tom Davis", email="tom@vendor.com", role="Vendor Contact", vendor_id=vendors[0].id),
    ]
    db.add_all(people)
    db.commit()

    # Create systems
    systems = [
        System(name="APIMS", description="API Management System", owner="Application Team"),
        System(name="MBS", description="Mobile Banking System", owner="Application Team"),
        System(name="Bakong", description="Payment System", owner="Operations"),
        System(name="F5", description="Load Balancer", owner="Infrastructure"),
        System(name="Cloudflare", description="CDN and Security", owner="Security"),
        System(name="Logstash", description="Log Aggregation", owner="Infrastructure"),
    ]
    db.add_all(systems)
    db.commit()

    # Create categories
    categories = [
        Category(name="Technical", description="Technical tasks"),
        Category(name="Monitoring", description="Monitoring and alerts"),
        Category(name="Network", description="Network related"),
        Category(name="Security", description="Security related"),
        Category(name="UAT", description="Testing tasks"),
        Category(name="Meeting", description="Meeting follow-ups"),
        Category(name="Documentation", description="Documentation tasks"),
        Category(name="Support", description="Support requests"),
    ]
    db.add_all(categories)
    db.commit()

    # Create projects
    projects = [
        Project(
            name="Visa Integration",
            description="Integrate Visa payment processor",
            status=ProjectStatus.ACTIVE,
            priority=TaskPriority.P1_HIGH,
            owner="Application Team",
        ),
        Project(
            name="Security Audit",
            description="Complete security audit",
            status=ProjectStatus.ACTIVE,
            priority=TaskPriority.P1_HIGH,
        ),
        Project(
            name="Infrastructure Upgrade",
            description="Upgrade infrastructure to new version",
            status=ProjectStatus.PLANNED,
            priority=TaskPriority.P2_MEDIUM,
        ),
        Project(
            name="Mobile App Launch",
            description="Launch new mobile banking app",
            status=ProjectStatus.ACTIVE,
            priority=TaskPriority.P0_CRITICAL,
        ),
    ]
    db.add_all(projects)
    db.commit()

    # Create tasks
    today = datetime.utcnow()
    tasks = [
        # Critical tasks
        Task(
            title="Fix Visa → APIMS connectivity issue",
            description="Connection timing out intermittently",
            status=TaskStatus.IN_PROGRESS,
            priority=TaskPriority.P0_CRITICAL,
            due_date=today,
            project_id=projects[0].id,
            system_id=systems[0].id,
            responsible_person_id=people[3].id,
            category_id=categories[0].id,
            next_action="Check firewall rules and NAT configuration",
        ),
        Task(
            title="Resolve certificate expiration alert",
            description="SSL certificate expiring in 3 days",
            status=TaskStatus.BLOCKED,
            priority=TaskPriority.P0_CRITICAL,
            due_date=today + timedelta(days=3),
            system_id=systems[1].id,
            responsible_person_id=people[1].id,
            blocked_reason="Waiting for certificate from vendor",
            category_id=categories[3].id,
        ),
        # High priority
        Task(
            title="Setup Filebeat for MBS",
            description="Configure Filebeat to send logs to Logstash",
            status=TaskStatus.PENDING,
            priority=TaskPriority.P1_HIGH,
            due_date=today + timedelta(days=2),
            system_id=systems[5].id,
            responsible_person_id=people[2].id,
            category_id=categories[0].id,
            project_id=projects[0].id,
        ),
        Task(
            title="Review UAT test cases",
            description="Review and approve test cases for payment flow",
            status=TaskStatus.PENDING,
            priority=TaskPriority.P1_HIGH,
            due_date=today + timedelta(days=1),
            responsible_person_id=people[3].id,
            category_id=categories[4].id,
        ),
        # Medium priority - Pending
        Task(
            title="Configure Logstash pipeline",
            description="Setup Logstash to parse and forward logs",
            status=TaskStatus.PENDING,
            priority=TaskPriority.P2_MEDIUM,
            due_date=today + timedelta(days=5),
            system_id=systems[5].id,
            category_id=categories[0].id,
        ),
        Task(
            title="Update documentation for API endpoints",
            description="Document new endpoints added in last release",
            status=TaskStatus.INBOX,
            priority=TaskPriority.P2_MEDIUM,
            due_date=today + timedelta(days=7),
            category_id=categories[6].id,
        ),
        # Low priority
        Task(
            title="Schedule team meeting",
            description="Monthly sync with operations team",
            status=TaskStatus.INBOX,
            priority=TaskPriority.P3_LOW,
            due_date=today + timedelta(days=3),
            category_id=categories[5].id,
        ),
        # Forgotten item (old activity)
        Task(
            title="Bakong monitoring setup",
            description="Setup monitoring dashboards for Bakong system",
            status=TaskStatus.PENDING,
            priority=TaskPriority.P2_MEDIUM,
            due_date=today - timedelta(days=10),
            system_id=systems[2].id,
            category_id=categories[1].id,
            last_activity_at=today - timedelta(days=8),
        ),
    ]
    db.add_all(tasks)
    db.commit()

    # Create follow-ups
    followups = [
        FollowUp(
            title="Firewall rule request from Network team",
            description="Waiting for Network team to approve firewall rule for new server",
            status=FollowUpStatus.FOLLOW_UP_DUE,
            waiting_for_type=WaitingForType.DEPARTMENT,
            department_id=departments[0].id,
            requested_date=today - timedelta(days=2),
            expected_date=today,
            follow_up_date=today,
            next_action="Follow up with John Smith about firewall rule",
        ),
        FollowUp(
            title="Certificate from Visa",
            description="Waiting for SSL certificate from Visa",
            status=FollowUpStatus.WAITING,
            waiting_for_type=WaitingForType.VENDOR,
            vendor_id=vendors[0].id,
            person_id=people[4].id,
            requested_date=today - timedelta(days=3),
            expected_date=today + timedelta(days=2),
            follow_up_date=today + timedelta(days=1),
            next_action="Check with vendor on certificate status",
        ),
        FollowUp(
            title="Network bandwidth increase request",
            description="Requested additional bandwidth for Bakong system",
            status=FollowUpStatus.WAITING,
            waiting_for_type=WaitingForType.VENDOR,
            vendor_id=vendors[1].id,
            requested_date=today - timedelta(days=5),
            expected_date=today + timedelta(days=3),
            follow_up_date=today + timedelta(days=3),
        ),
        FollowUp(
            title="Security assessment report",
            description="Waiting for security vendor's assessment report",
            status=FollowUpStatus.OVERDUE,
            waiting_for_type=WaitingForType.VENDOR,
            vendor_id=vendors[3].id,
            requested_date=today - timedelta(days=7),
            expected_date=today - timedelta(days=2),
            follow_up_date=today,
            next_action="Call vendor directly about delayed report",
        ),
    ]
    db.add_all(followups)
    db.commit()

    # Create issues
    issues = [
        Issue(
            title="Visa cannot reach APIMS",
            description="API calls from Visa are timing out after 30 seconds",
            severity=IssueSeverity.CRITICAL,
            status=IssueStatus.INVESTIGATING,
            system_id=systems[0].id,
            department_id=departments[0].id,
            responsible_person_id=people[0].id,
            detected_at=today - timedelta(hours=2),
            notes="Issue started this morning around 9 AM",
        ),
        Issue(
            title="F5 CPU utilization high",
            description="F5 load balancer CPU at 85% consistently",
            severity=IssueSeverity.HIGH,
            status=IssueStatus.INVESTIGATING,
            system_id=systems[3].id,
            responsible_person_id=people[2].id,
            detected_at=today - timedelta(hours=6),
        ),
        Issue(
            title="Certificate expiration warning",
            description="SSL certificate for API expires in 3 days",
            severity=IssueSeverity.CRITICAL,
            status=IssueStatus.MITIGATING,
            system_id=systems[1].id,
            responsible_person_id=people[1].id,
            detected_at=today - timedelta(days=1),
        ),
    ]
    db.add_all(issues)
    db.commit()

    # Create meetings
    meetings = [
        Meeting(
            title="APIMS Incident Response",
            meeting_date=today - timedelta(hours=1),
            participants="John Smith, Sarah Johnson, Mike Brown",
            notes="Discussed Visa connectivity issue. Decision: check firewall and NAT. Mike will review F5 configuration.",
            decisions="1. Review firewall rules 2. Check NAT configuration 3. Monitor F5 performance",
        ),
        Meeting(
            title="Project Status Review",
            meeting_date=today - timedelta(days=1),
            participants="Project Lead, Team Members",
            notes="Visa integration on track. Certificate issue needs resolution.",
            decisions="Prioritize certificate renewal. UAT to proceed with existing certificate.",
        ),
    ]
    db.add_all(meetings)
    db.commit()

    print("✅ Demo data seeded successfully!")
    print(f"   - {len(departments)} departments")
    print(f"   - {len(vendors)} vendors")
    print(f"   - {len(people)} people")
    print(f"   - {len(systems)} systems")
    print(f"   - {len(categories)} categories")
    print(f"   - {len(projects)} projects")
    print(f"   - {len(tasks)} tasks")
    print(f"   - {len(followups)} follow-ups")
    print(f"   - {len(issues)} issues")
    print(f"   - {len(meetings)} meetings")


if __name__ == "__main__":
    seed_data()
