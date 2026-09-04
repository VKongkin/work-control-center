"""Encryption for credentials held at rest.

A calendar refresh token is a long-lived key to a work mailbox, so it is never
stored in plain text. The key comes from WCC_SECRET_KEY when set; otherwise one
is generated on first use and kept in the database, which keeps a laptop
install working with no configuration while still not writing tokens in clear.
"""
import base64
import os
from typing import Optional

from cryptography.fernet import Fernet, InvalidToken
from sqlalchemy.orm import Session

from app.models import AppSecret

_KEY_NAME = "fernet_key"


def _key(db: Session) -> bytes:
    configured = os.getenv("WCC_SECRET_KEY", "").strip()
    if configured:
        # Accept either a real Fernet key or any passphrase, padded to 32 bytes.
        try:
            Fernet(configured.encode())
            return configured.encode()
        except (ValueError, TypeError):
            digest = configured.encode().ljust(32, b"0")[:32]
            return base64.urlsafe_b64encode(digest)

    row = db.query(AppSecret).filter(AppSecret.key == _KEY_NAME).first()
    if row:
        return row.value.encode()

    generated = Fernet.generate_key().decode()
    db.add(AppSecret(key=_KEY_NAME, value=generated))
    db.commit()
    return generated.encode()


def encrypt(db: Session, plaintext: Optional[str]) -> Optional[str]:
    if not plaintext:
        return None
    return Fernet(_key(db)).encrypt(plaintext.encode()).decode()


def decrypt(db: Session, ciphertext: Optional[str]) -> Optional[str]:
    if not ciphertext:
        return None
    try:
        return Fernet(_key(db)).decrypt(ciphertext.encode()).decode()
    except (InvalidToken, ValueError):
        # A rotated or lost key means the stored token is unusable; treat it as
        # absent so the UI asks the user to sign in again rather than crashing.
        return None
