"""Episode metadata for a deal (PDF slide 4 step 03): title, synopsis, air date, duration.

CSV columns (header names are case-insensitive, extra columns are ignored):
    season            optional; required when the deal licenses by season
    episode           episode number
    title             required
    description       optional synopsis / details
    air_date          optional, 2026-10-01 (also 01-10-2026 or 01/10/2026)
    duration_minutes  optional
    language          optional
    notes             optional

Each (season, episode) keeps one row: importing it again updates it.
"""

import csv
import io
import uuid
from dataclasses import dataclass, field
from datetime import date, datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import ContentDeal, DealEpisode

TEMPLATE = (
    "season,episode,title,description,air_date,duration_minutes,language,notes\n"
    ",101,Kapil with the Bachchans,Family special with guest stars,2019-01-05,52,Hindi,\n"
    ",102,Comedy Nights Reunion,Old cast returns for a reunion episode,2019-01-12,48,Hindi,\n"
)


def scope_error(deal: ContentDeal, season: int | None, episode: int) -> str | None:
    """Why this episode is outside the licence, or None when it is covered."""
    if deal.episode_scope == "all":
        return None
    if deal.episode_scope == "seasons" and season is None:
        return "This deal licenses episodes by season — enter the season."
    covered = any(
        r.from_episode <= episode <= r.to_episode
        and (deal.episode_scope == "ranges" or r.season == season)
        for r in deal.episode_ranges
    )
    if covered:
        return None
    label = f"S{season} E{episode}" if deal.episode_scope == "seasons" else f"Episode {episode}"
    return f"{label} is outside the licensed episodes."


def normal_season(deal: ContentDeal, season: int | None) -> int | None:
    # Deals that do not count by season store every episode without one.
    return season if deal.episode_scope == "seasons" else None


def _date(value: str) -> date:
    for fmt in ("%Y-%m-%d", "%d-%m-%Y", "%d/%m/%Y"):
        try:
            return datetime.strptime(value, fmt).date()
        except ValueError:
            continue
    raise ValueError(f"Air date '{value}' is not a date (use 2026-10-01)")


def _int(value: str, what: str, low: int = 1) -> int:
    try:
        n = int(value.replace(",", "").strip())
    except ValueError as exc:
        raise ValueError(f"{what} '{value}' is not a whole number") from exc
    if n < low:
        raise ValueError(f"{what} must be at least {low}")
    return n


@dataclass
class EpisodeImport:
    created: int = 0
    updated: int = 0
    errors: list[dict] = field(default_factory=list)


def import_episodes(db: Session, deal: ContentDeal, content: bytes) -> EpisodeImport:
    text = content.decode("utf-8-sig", errors="replace")
    reader = csv.DictReader(io.StringIO(text))
    headers = {h.strip().lower(): h for h in (reader.fieldnames or []) if h}
    result = EpisodeImport()
    missing = [h for h in ("episode", "title") if h not in headers]
    if missing:
        result.errors.append({"line": 1, "message": f"Missing column(s): {', '.join(missing)}"})
        return result

    existing = {
        (e.season, e.episode_number): e
        for e in db.scalars(select(DealEpisode).where(DealEpisode.deal_id == deal.id))
    }
    seen: set[tuple[int | None, int]] = set()
    for line, raw in enumerate(reader, start=2):
        row = {k: (raw.get(h) or "").strip() for k, h in headers.items()}
        if not any(row.values()):
            continue
        try:
            season = _int(row["season"], "Season") if row.get("season") else None
            number = _int(row["episode"], "Episode")
            title = row["title"]
            if not title:
                raise ValueError("Title is required")
            if len(title) > 300:
                raise ValueError("Title is longer than 300 characters")
            problem = scope_error(deal, season, number)
            if problem:
                raise ValueError(problem)
            values = {
                "title": title,
                "description": row.get("description") or None,
                "air_date": _date(row["air_date"]) if row.get("air_date") else None,
                "duration_minutes": _int(row["duration_minutes"], "Duration")
                if row.get("duration_minutes")
                else None,
                "language": (row.get("language") or None) and row["language"][:60],
                "notes": row.get("notes") or None,
            }
        except ValueError as exc:
            result.errors.append({"line": line, "message": str(exc)})
            continue
        key = (normal_season(deal, season), number)
        if key in seen:
            result.errors.append(
                {"line": line, "message": "This episode appears twice in the file"}
            )
            continue
        seen.add(key)
        episode = existing.get(key)
        if episode is None:
            db.add(
                DealEpisode(
                    id=uuid.uuid4(),
                    organization_id=deal.organization_id,
                    deal_id=deal.id,
                    season=key[0],
                    episode_number=number,
                    **values,
                )
            )
            result.created += 1
        else:
            for k, v in values.items():
                setattr(episode, k, v)
            result.updated += 1
    return result
