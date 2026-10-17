"""Bootstrap commands (there is no public signup).

Normally you only need the first one; the super admin then creates companies and
founders from the Admin pages in the app. The rest are for scripting and recovery.

    python -m app.cli create-superadmin --email admin@taggify.in --name "Admin Name"
    python -m app.cli create-org --name Taggify --slug taggify
    python -m app.cli create-user --org taggify --email founder@taggify.in --name "Founder Name"
    python -m app.cli add-member --org sociodoor --email founder@taggify.in
    python -m app.cli list

create-superadmin and create-user ask for the password. For non-interactive use, set
TAGGIFY_NEW_PASSWORD instead.
"""

import argparse
import getpass
import os
import sys

from sqlalchemy import select

from app.core.database import SessionLocal
from app.core.security import MIN_PASSWORD_LENGTH, hash_password
from app.models import Membership, Organization, User
from app.services.audit import record_audit
from app.services.auth import normalize_email, validate_new_email
from app.services.teams import seed_default_roles


def _read_password() -> str:
    if password := os.environ.get("TAGGIFY_NEW_PASSWORD"):
        return password
    password = getpass.getpass("Password: ")
    if password != getpass.getpass("Repeat password: "):
        sys.exit("Passwords do not match")
    return password


def _get_org(db, slug: str) -> Organization:
    org = db.scalar(select(Organization).where(Organization.slug == slug))
    if org is None:
        sys.exit(f"No company with slug '{slug}'. Create it with create-org first.")
    return org


def _new_user_email(db, raw: str) -> str:
    try:
        email = validate_new_email(raw)
    except ValueError as exc:
        sys.exit(f"Invalid email: {exc}")
    if db.scalar(select(User).where(User.email == email)):
        sys.exit(f"User {email} already exists.")
    return email


def _new_password() -> str:
    password = _read_password()
    if len(password) < MIN_PASSWORD_LENGTH:
        sys.exit(f"Password must be at least {MIN_PASSWORD_LENGTH} characters")
    return password


def create_superadmin(args: argparse.Namespace) -> None:
    with SessionLocal() as db:
        email = _new_user_email(db, args.email)
        user = User(
            email=email,
            full_name=args.name,
            password_hash=hash_password(_new_password()),
            is_superadmin=True,
        )
        db.add(user)
        db.flush()
        record_audit(
            db,
            "user.created",
            entity_type="user",
            entity_id=user.id,
            details={"email": email, "superadmin": True, "source": "cli"},
        )
        db.commit()
        print(f"Created super admin {email}. Log in and open Companies / All users.")


def create_org(args: argparse.Namespace) -> None:
    with SessionLocal() as db:
        if db.scalar(select(Organization).where(Organization.slug == args.slug)):
            sys.exit(f"Company '{args.slug}' already exists")
        org = Organization(name=args.name, slug=args.slug, base_currency=args.currency)
        db.add(org)
        db.flush()
        seed_default_roles(db, org)
        record_audit(db, "org.created", organization_id=org.id, details={"source": "cli"})
        db.commit()
        print(f"Created company {org.name} ({org.slug})")


def create_user(args: argparse.Namespace) -> None:
    with SessionLocal() as db:
        org = _get_org(db, args.org)
        email = _new_user_email(db, args.email)
        user = User(email=email, full_name=args.name, password_hash=hash_password(_new_password()))
        db.add(Membership(user=user, organization_id=org.id))
        db.flush()
        record_audit(
            db,
            "user.created",
            organization_id=org.id,
            entity_type="user",
            entity_id=user.id,
            details={"email": email, "source": "cli"},
        )
        db.commit()
        print(f"Created {email} in {org.name}")


def add_member(args: argparse.Namespace) -> None:
    with SessionLocal() as db:
        org = _get_org(db, args.org)
        user = db.scalar(select(User).where(User.email == normalize_email(args.email)))
        if user is None:
            sys.exit(f"No user {args.email}. Use create-user first.")
        membership = db.scalar(
            select(Membership).where(
                Membership.user_id == user.id, Membership.organization_id == org.id
            )
        )
        if membership:
            membership.is_active = True
        else:
            db.add(Membership(user_id=user.id, organization_id=org.id))
        record_audit(
            db,
            "user.added_to_org",
            organization_id=org.id,
            entity_type="user",
            entity_id=user.id,
            details={"email": user.email, "source": "cli"},
        )
        db.commit()
        print(f"{user.email} now has access to {org.name}")


def list_all(_: argparse.Namespace) -> None:
    with SessionLocal() as db:
        admins = db.scalars(select(User).where(User.is_superadmin.is_(True)).order_by(User.email))
        for admin in admins:
            print(f"Super admin: {admin.full_name} <{admin.email}>")
        for org in db.scalars(select(Organization).order_by(Organization.name)):
            print(f"{org.name} ({org.slug}, {org.base_currency})")
            members = db.scalars(
                select(Membership)
                .where(Membership.organization_id == org.id)
                .order_by(Membership.created_at)
            )
            for m in members:
                state = "active" if m.is_active else "deactivated"
                print(f"  - {m.user.full_name} <{m.user.email}> [{state}]")


def main() -> None:
    parser = argparse.ArgumentParser(prog="python -m app.cli")
    sub = parser.add_subparsers(required=True)

    p = sub.add_parser("create-superadmin", help="Create the super admin who runs the tool")
    p.add_argument("--email", required=True)
    p.add_argument("--name", required=True)
    p.set_defaults(func=create_superadmin)

    p = sub.add_parser("create-org", help="Create a company")
    p.add_argument("--name", required=True)
    p.add_argument("--slug", required=True)
    p.add_argument("--currency", default="INR")
    p.set_defaults(func=create_org)

    p = sub.add_parser("create-user", help="Create a founder login in a company")
    p.add_argument("--org", required=True, help="company slug")
    p.add_argument("--email", required=True)
    p.add_argument("--name", required=True)
    p.set_defaults(func=create_user)

    p = sub.add_parser("add-member", help="Give an existing user access to another company")
    p.add_argument("--org", required=True, help="company slug")
    p.add_argument("--email", required=True)
    p.set_defaults(func=add_member)

    p = sub.add_parser("list", help="List companies and their users")
    p.set_defaults(func=list_all)

    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
