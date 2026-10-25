"""The few Google calls the tool makes, with the standard library (no Google SDK).

- refresh: turn a channel's long-lived refresh token into a one-hour access token
- my_channel: which channel a token belongs to (needs the youtube.readonly permission)
- channel_report: daily revenue, views, watch time and subscribers (YouTube Analytics)

Tests replace these functions; nothing here touches the database.
"""

import json
import urllib.error
import urllib.parse
import urllib.request
from datetime import date

TIMEOUT_SECONDS = 30
ANALYTICS_URL = "https://youtubeanalytics.googleapis.com/v2/reports"
CHANNELS_URL = "https://www.googleapis.com/youtube/v3/channels"
METRICS = "estimatedRevenue,views,estimatedMinutesWatched,subscribersGained,subscribersLost"

REVENUE_SCOPE = "https://www.googleapis.com/auth/yt-analytics-monetary.readonly"
CHANNEL_SCOPE = "https://www.googleapis.com/auth/youtube.readonly"


class GoogleError(Exception):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status


class TokenDead(GoogleError):
    """The owner removed the permission, or Google expired it: ask them to Allow again."""


def _call(url: str, *, data: dict | None = None, token: str | None = None) -> dict:
    headers = {"Authorization": f"Bearer {token}"} if token else {}
    body = urllib.parse.urlencode(data).encode() if data is not None else None
    req = urllib.request.Request(url, data=body, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT_SECONDS) as resp:  # noqa: S310
            return json.loads(resp.read())
    except urllib.error.HTTPError as exc:
        try:
            detail = json.loads(exc.read())
        except ValueError:
            detail = {}
        err = detail.get("error")
        if isinstance(err, dict):
            message = err.get("message") or str(exc.code)
        else:
            message = f"{err or exc.code} {detail.get('error_description', '')}".strip()
        if data is not None and err == "invalid_grant":
            raise TokenDead(exc.code, message) from exc
        raise GoogleError(exc.code, message) from exc
    except (OSError, ValueError) as exc:
        raise GoogleError(0, f"Could not reach Google: {exc}") from exc


def refresh(token_uri: str, client_id: str, client_secret: str, refresh_token: str) -> str:
    out = _call(
        token_uri,
        data={
            "client_id": client_id,
            "client_secret": client_secret,
            "refresh_token": refresh_token,
            "grant_type": "refresh_token",
        },
    )
    return out["access_token"]


def my_channel(access_token: str) -> dict | None:
    """{id, title, subscribers, videos} of the token's channel, or None if it has none."""
    q = urllib.parse.urlencode({"part": "snippet,statistics", "mine": "true"})
    items = _call(f"{CHANNELS_URL}?{q}", token=access_token).get("items") or []
    if not items:
        return None
    item, stats = items[0], items[0].get("statistics", {})
    return {
        "id": item["id"],
        "title": item.get("snippet", {}).get("title"),
        "subscribers": None
        if stats.get("hiddenSubscriberCount")
        else int(stats.get("subscriberCount", 0)),
        "videos": int(stats["videoCount"]) if "videoCount" in stats else None,
    }


def channel_report(access_token: str, channel_id: str, start: date, end: date) -> dict:
    """YouTube Analytics, one row per day: [day, revenue USD, views, minutes, subs +, subs -]."""
    q = urllib.parse.urlencode(
        {
            "ids": f"channel=={channel_id}",
            "startDate": start.isoformat(),
            "endDate": end.isoformat(),
            "metrics": METRICS,
            "dimensions": "day",
            "sort": "day",
            "currency": "USD",
        }
    )
    return _call(f"{ANALYTICS_URL}?{q}", token=access_token)
