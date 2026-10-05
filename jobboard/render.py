"""Render one day of a board into static pages under docs/."""

from __future__ import annotations

import base64
import json
import shutil
import tomllib
from datetime import date
from html import escape
from pathlib import Path
from string import Template
from typing import Any

ROOT = Path(__file__).resolve().parent.parent
SITE = ROOT / "site"
BOARDS = ROOT / "boards"
DOCS = ROOT / "docs"

PLATFORM = "https://platform.metix.ai"
ASSETS = {
    "app.css": SITE / "app.css",
    "app.js": SITE / "app.js",
    "favicon.svg": SITE / "brand" / "favicon.svg",
    "metix-logo.svg": SITE / "brand" / "metix-logo.svg",
}

Board = dict[str, Any]
Day = dict[str, Any]


def load_board(board: str) -> Board:
    with (BOARDS / board / "board.toml").open("rb") as fh:
        return tomllib.load(fh)


def load_day(board: str, slug: str) -> Day | None:
    path = BOARDS / board / "days" / f"{slug}.json"
    if not path.exists():
        return None
    day: Day = json.loads(path.read_text(encoding="utf-8"))
    return day


def short_date(iso: str) -> str:
    d = date.fromisoformat(iso)
    return f"{d:%b} {d.day}"


def date_range(start: str, end: str) -> str:
    a, b = date.fromisoformat(start), date.fromisoformat(end)
    if (a.year, a.month) == (b.year, b.month):
        return f"{a:%b} {a.day} to {b.day}"
    return f"{a:%b} {a.day} to {b:%b} {b.day}"


def embed_json(value: object) -> str:
    """JSON for a <script type="application/json"> element; "<" is escaped so no
    string inside the data can close the element."""
    text = json.dumps(value, ensure_ascii=False, separators=(",", ":"))
    return text.replace("<", "\\u003c")


def totals(day: Day) -> dict[str, int]:
    roles = [role for company in day["companies"] for role in company["roles"]]
    return {
        "events": day["events_today"],
        "hiring": len(day["companies"]),
        "roles": len(roles),
        "new": sum(1 for role in roles if role["new"]),
        "ai": sum(1 for role in roles if role["ai"]),
        "remote": sum(1 for role in roles if role["regions"] == ["remote"]),
    }


def platform_link(path: str, via: str) -> str:
    return f"{PLATFORM}{path}?via={via}"


def day_tabs(board_name: str, board: Board, current: str) -> str:
    """One slim tab per day. Days without a published file are shown dimmed, not linked."""
    tabs = []
    for entry in board["days"]:
        slug = entry["slug"]
        text = f"{escape(entry['weekday'])} <span>{escape(entry['dates'])}</span>"
        if load_day(board_name, slug) is None:
            tabs.append(f'<span class="tab is-later">{text}</span>')
        elif slug == current:
            tabs.append(f'<a class="tab is-today" href="{slug}" aria-current="page">{text}</a>')
        else:
            tabs.append(f'<a class="tab" href="{slug}">{text}</a>')
    return "".join(tabs)


def insights(day: Day) -> str:
    cards = []
    for item in day.get("insights", []):
        link = f'<a href="{escape(item["href"])}">More</a>' if item.get("href") else ""
        cards.append(
            f'<article class="insight"><p>{escape(item["text"])}</p>'
            f'<span class="insight-tag">Metix AI Platform analysis</span>{link}</article>'
        )
    return "".join(cards)


def render_day(board_name: str, slug: str) -> str:
    board = load_board(board_name)
    day = load_day(board_name, slug)
    if day is None:
        raise SystemExit(f"no data for {board_name} {slug}")
    entry = next(item for item in board["days"] if item["slug"] == slug)
    counts = totals(day)
    window = date_range(day["window"]["from"], day["window"]["to"])
    pulled = short_date(day["pulled"])
    via = board["via"]
    canonical = f"{board['url']}/{slug}"
    title = entry["title"]

    weekday = title.split(",")[0]
    when = "this weekend" if weekday == "Weekend" else f"on {weekday}"
    headline = f"{counts['hiring']} hosts with events {when} are hiring in the Bay Area."
    page = Template((SITE / "day.html").read_text(encoding="utf-8"))
    return page.substitute(
        page_title=escape(f"{title}: SF Tech Week hosts that are hiring | Metix AI Platform"),
        og_title=escape(f"{title}: {counts['hiring']} SF Tech Week hosts are hiring"),
        description=escape(
            f"{counts['hiring']} companies hosting SF Tech Week events on {title} posted "
            f"{counts['roles']:,} Bay Area or US-remote roles in the past 7 days, "
            f"{counts['new']} of them new. Pick your field to see which events to go to."
        ),
        og_alt=escape(
            f"{title}: {counts['hiring']} SF Tech Week hosts are hiring, with "
            f"{counts['roles']:,} Bay Area and US-remote roles posted this week."
        ),
        canonical=canonical,
        og_image=f"{board['url']}/og/{slug}.png",
        assets="../../assets",
        platform_url=platform_link("/", via),
        eyebrow=escape(f"SF Tech Week · {title}"),
        day_tabs=day_tabs(board_name, board, slug),
        headline=escape(headline),
        stats=escape(
            f"{counts['roles']:,} roles posted this week · {counts['new']} new · "
            f"{counts['remote']} US remote · pulled {pulled}"
        ),
        insights=insights(day),
        window=escape(window),
        pulled=escape(pulled),
        calendar=board["calendar"],
        repo=board["repo"],
        integrations=platform_link("/integrations", via),
        quickstart=platform_link("/docs/quickstart", via),
        signup=f"{PLATFORM}/signup?via={via}&amp;redirectUrl=%2Fapi-keys",
        main_site=f"https://www.metix.ai/?utm_source={via}",
        data=embed_json(
            {
                "post": day["post"],
                "events": day["events"],
                "companies": day["companies"],
            }
        ),
    )


def redirect(target: str) -> str:
    return (
        '<!doctype html><html lang="en"><head><meta charset="utf-8">'
        f'<meta http-equiv="refresh" content="0; url={target}">'
        '<meta name="robots" content="noindex"><title>Redirecting</title></head>'
        f'<body><a href="{target}">Continue</a></body></html>\n'
    )


def write(path: Path, text: str) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")
    return path


def build(board_name: str, slug: str, *, og: bool = True) -> list[Path]:
    out = DOCS / board_name
    written = [write(out / f"{slug}.html", render_day(board_name, slug))]

    for name, source in ASSETS.items():
        target = DOCS / "assets" / name
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source, target)
        written.append(target)

    series, city = board_name.split("/")
    written.append(write(DOCS / ".nojekyll", ""))
    written.append(write(DOCS / "index.html", redirect(f"{board_name}/{slug}")))
    written.append(write(DOCS / series / "index.html", redirect(f"{city}/{slug}")))
    written.append(write(out / "index.html", redirect(slug)))

    if og:
        from jobboard.og import render_og

        written.append(render_og(board_name, slug, out / "og" / f"{slug}.png"))
    return written


def logo_data_uri(name: str) -> str:
    raw = (SITE / "brand" / name).read_bytes()
    return "data:image/svg+xml;base64," + base64.b64encode(raw).decode("ascii")
