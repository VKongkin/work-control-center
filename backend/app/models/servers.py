"""Servers, the accounts on them, and who looked at what.

The inventory is the useful part: which box, which environment, what it runs,
which accounts exist on it and whether each is an AD or a local account. That
is the thing you cannot remember across dozens of servers, and none of it is
secret.

The password is optional and separate. It is stored encrypted, with the key
outside the database (see app.services.vault), and reading one back is an event
that gets recorded - because a credential store nobody can audit is worse than
a notebook, which at least cannot be copied silently.
"""
from sqlalchemy import Boolean, Column, DateTime, Index, Integer, String, Text
from datetime import datetime
from app.database import Base

ENVIRONMENTS = ("DC", "DR", "UAT", "SIT", "DEV", "OTHER")
ACCOUNT_TYPES = ("AD", "LOCAL", "SERVICE", "APPLICATION", "DATABASE", "APPLIANCE", "OTHER")


class Server(Base):
    __tablename__ = "servers"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(255), nullable=False)
    # Three different things that all get called "the address":
    #   hostname   - what the box calls itself, e.g. MBSAPP01
    #   dns_name   - the record it resolves by, e.g. mbsapp01.bank.local
    #   ip_address - what the connect buttons actually dial
    hostname = Column(String(255), nullable=True)
    dns_name = Column(String(255), nullable=True)
    ip_address = Column(String(64), nullable=True)
    environment = Column(String(16), nullable=False, default="DC")

    os = Column(String(128), nullable=True)
    role = Column(String(255), nullable=True)  # what it runs: WAS, MQ, F5, ...

    # Only worth storing when they are not the usual ones. Null means 22 and
    # 3389; the connect links leave the port out entirely in that case, which
    # is what every client expects.
    ssh_port = Column(Integer, nullable=True)
    rdp_port = Column(Integer, nullable=True)

    system_id = Column(Integer, nullable=True)
    department_id = Column(Integer, nullable=True)
    vendor_id = Column(Integer, nullable=True)
    owner_person_id = Column(Integer, nullable=True)

    # A DR box and its DC counterpart are the same server twice; saying so here
    # is what lets a runbook for one be found from the other.
    paired_server_id = Column(Integer, nullable=True)

    notes = Column(Text, nullable=True)
    active = Column(Boolean, default=True)

    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    __table_args__ = (Index("ix_servers_env", "environment", "active"),)


class ServerAccount(Base):
    __tablename__ = "server_accounts"

    id = Column(Integer, primary_key=True, index=True)
    server_id = Column(Integer, nullable=False)
    username = Column(String(255), nullable=False)
    account_type = Column(String(16), nullable=False, default="LOCAL")
    purpose = Column(String(255), nullable=True)

    # Where the authoritative credential lives - a vault safe, a team manager,
    # a person. Filled in whether or not a password is also stored here, because
    # this app is not the system of record for a bank's privileged accounts.
    vault_location = Column(String(255), nullable=True)

    # Encrypted with the key from WCC_VAULT_KEY. Never serialised by any read
    # endpoint, and never reachable through the agent interface.
    secret_ciphertext = Column(Text, nullable=True)

    last_rotated_at = Column(DateTime, nullable=True)
    rotation_days = Column(Integer, nullable=True)
    notes = Column(Text, nullable=True)
    active = Column(Boolean, default=True)

    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    __table_args__ = (Index("ix_server_accounts_server", "server_id", "active"),)


class SecretAccess(Base):
    """Every time a stored password is set, read or cleared.

    Append-only by intent: there is no endpoint that edits or deletes a row
    here. An access log you can quietly tidy up is not an access log.
    """
    __tablename__ = "secret_access_log"

    id = Column(Integer, primary_key=True, index=True)
    account_id = Column(Integer, nullable=False)
    action = Column(String(16), nullable=False)  # SET | REVEAL | CLEAR | DENIED | LAUNCH
    at = Column(DateTime, default=datetime.utcnow)
    detail = Column(String(500), nullable=True)

    __table_args__ = (Index("ix_secret_access_account", "account_id", "at"),)
