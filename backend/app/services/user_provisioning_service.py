"""
User auto-provisioning service.

When an admin creates a PPK or a Company (type=contractor|consultant), the
system automatically generates a User account bound to that entity:

  - PPK → role "ppk",     User.email = ppk.email (or generated)
  - Company(contractor)   → role "kontraktor"
  - Company(consultant)   → role "konsultan"
  - Company(supplier)     → NO user (suppliers don't log in)

Rules:
  - Default password is always "Ganti@123!" and must_change_password=True.
  - Username is a slug derived from the entity name, uniqueness-suffixed.
  - Email defaults to the entity's email field; if empty, we synthesize
    "<slug>@knmp.local" so the User row has a unique email (DB constraint).
  - The function is idempotent: if the entity already has a linked user,
    it's returned as-is (no duplicate).

This service is the single source of truth for entity→user linkage; the
master API handlers must go through it rather than calling User() directly.
"""
import re
import uuid
from typing import Optional, Tuple
from sqlalchemy.orm import Session
from sqlalchemy import func

from app.models.models import User, Role, Company, PPK
from app.core.security import get_password_hash


DEFAULT_PASSWORD = "Ganti@123!"


# ─────────────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────────────

def _slugify(name: str) -> str:
    """Turn a human name into a login-safe slug: lowercase, alnum + dots."""
    s = name.strip().lower()
    s = re.sub(r"[^a-z0-9]+", ".", s)
    s = re.sub(r"\.{2,}", ".", s).strip(".")
    return s or "user"


def _unique_username(db: Session, base: str) -> str:
    """Return a username that doesn't collide with existing rows."""
    candidate = base
    i = 1
    while db.query(User.id).filter(User.username == candidate).first():
        i += 1
        candidate = f"{base}.{i}"
    return candidate


def _unique_email(db: Session, preferred: Optional[str], slug: str) -> str:
    """
    Use the entity's real email if it's provided and unique.
    Otherwise fall back to a synthetic `@knmp.local` address so the
    users.email UNIQUE constraint is satisfied.
    """
    if preferred:
        existing = db.query(User.id).filter(func.lower(User.email) == preferred.lower()).first()
        if not existing:
            return preferred.lower()
    # Fallback synthetic email
    candidate = f"{slug}@knmp.local"
    i = 1
    while db.query(User.id).filter(func.lower(User.email) == candidate).first():
        i += 1
        candidate = f"{slug}.{i}@knmp.local"
    return candidate


def _get_role(db: Session, role_code: str) -> Role:
    role = db.query(Role).filter(Role.code == role_code).first()
    if not role:
        raise RuntimeError(
            f"Required role '{role_code}' not found. Run seed.py first."
        )
    return role


def _company_role_code(company_type: str) -> Optional[str]:
    return {
        "contractor": "kontraktor",
        "consultant": "konsultan",
    }.get((company_type or "").lower())


# ─────────────────────────────────────────────────────────────────────────────
# Public API
# ─────────────────────────────────────────────────────────────────────────────

def provision_user_for_ppk(
    db: Session,
    ppk: PPK,
    created_by_id: Optional[uuid.UUID] = None,
) -> Tuple[User, bool]:
    """
    Ensure the given PPK has an attached User. Returns (user, was_created).

    If ppk.user_id already points to a live user, that user is returned with
    was_created=False. Caller is responsible for db.commit().
    """
    if ppk.user_id:
        existing = db.query(User).filter(User.id == ppk.user_id).first()
        if existing:
            return existing, False

    role = _get_role(db, "ppk")
    slug = _slugify(ppk.name)
    username = _unique_username(db, slug)
    email = _unique_email(db, ppk.email, slug)

    user = User(
        email=email,
        username=username,
        full_name=ppk.name,
        hashed_password=get_password_hash(DEFAULT_PASSWORD),
        role_id=role.id,
        phone=ppk.phone,
        whatsapp_number=ppk.whatsapp_number,
        is_active=True,
        must_change_password=True,
        auto_provisioned=True,
        created_by=created_by_id,
    )
    db.add(user)
    db.flush()  # populate user.id

    ppk.user_id = user.id
    db.add(ppk)
    db.flush()
    return user, True


def provision_user_for_company(
    db: Session,
    company: Company,
    created_by_id: Optional[uuid.UUID] = None,
) -> Tuple[Optional[User], bool]:
    """
    Ensure the given Company has an attached User if its type is
    contractor or consultant. Suppliers are skipped (returns (None, False)).
    Returns (user_or_None, was_created).
    """
    role_code = _company_role_code(company.company_type)
    if not role_code:
        return None, False

    if company.default_user_id:
        existing = db.query(User).filter(User.id == company.default_user_id).first()
        if existing:
            return existing, False

    role = _get_role(db, role_code)
    slug = _slugify(company.name)
    username = _unique_username(db, slug)
    email = _unique_email(db, company.email, slug)

    user = User(
        email=email,
        username=username,
        full_name=company.contact_person or company.name,
        hashed_password=get_password_hash(DEFAULT_PASSWORD),
        role_id=role.id,
        phone=company.phone,
        is_active=True,
        must_change_password=True,
        auto_provisioned=True,
        created_by=created_by_id,
    )
    db.add(user)
    db.flush()

    company.default_user_id = user.id
    db.add(company)
    db.flush()
    return user, True
