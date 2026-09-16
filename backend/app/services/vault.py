"""Encryption for server credentials.

Deliberately separate from `app.services.secrets`, and deliberately stricter.

That module will generate a key and keep it in the database when none is
configured, which is the right trade-off for a calendar token: it keeps a
laptop install working with no setup. It is the wrong trade-off here. A key
sitting in the same database as the passwords it protects means one stolen
backup file gives up everything - the encryption would be decoration.

So this module has no fallback. Without WCC_VAULT_KEY in the environment,
storing a password is refused outright and the rest of the server inventory -
hostnames, account names, where the real credential lives - keeps working
without it. Losing the key means the stored passwords are gone; that is the
point of holding it somewhere the database is not.
"""
import base64
import os
from typing import Optional

from cryptography.fernet import Fernet, InvalidToken

ENV_KEY = "WCC_VAULT_KEY"

# Short keys are worse than none, because they invite the belief that something
# was protected. 16 characters is not strong, but it rules out "password".
MIN_PASSPHRASE = 16


class VaultLocked(RuntimeError):
    """No key is configured, so nothing can be encrypted or read back."""


def configured() -> bool:
    return bool(os.getenv(ENV_KEY, "").strip())


def _key() -> bytes:
    raw = os.getenv(ENV_KEY, "").strip()
    if not raw:
        raise VaultLocked(
            "No vault key is set, so passwords cannot be stored. Set WCC_VAULT_KEY "
            "in the environment - keep it somewhere other than the database, such "
            "as your own password manager - and restart. Everything else about a "
            "server and its accounts works without it."
        )
    try:
        Fernet(raw.encode())
        return raw.encode()
    except (ValueError, TypeError):
        pass
    if len(raw) < MIN_PASSPHRASE:
        raise VaultLocked(
            f"WCC_VAULT_KEY must be a Fernet key or a passphrase of at least "
            f"{MIN_PASSPHRASE} characters."
        )
    # A passphrase is padded to Fernet's 32 bytes. This is not a KDF and is not
    # pretending to be one - a generated Fernet key is the better choice, and
    # `python -c "from cryptography.fernet import Fernet;
    # print(Fernet.generate_key().decode())"` produces one.
    return base64.urlsafe_b64encode(raw.encode().ljust(32, b"0")[:32])


def encrypt(plaintext: Optional[str]) -> Optional[str]:
    if plaintext is None or plaintext == "":
        return None
    return Fernet(_key()).encrypt(plaintext.encode()).decode()


def decrypt(ciphertext: Optional[str]) -> Optional[str]:
    """Read a stored password back. Raises rather than returning None on a bad key.

    Unlike a calendar token, silence here would be dangerous: "no password"
    and "the key changed" look identical to the caller, and the second needs
    saying out loud.
    """
    if not ciphertext:
        return None
    try:
        return Fernet(_key()).decrypt(ciphertext.encode()).decode()
    except (InvalidToken, ValueError) as e:
        raise VaultLocked(
            "This password cannot be read with the current WCC_VAULT_KEY. The key "
            "has changed since it was stored, or the value is corrupt."
        ) from e
