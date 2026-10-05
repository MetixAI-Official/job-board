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


def day_strip(board_name: str, board: Board, current: str) -> str:
    cells = []
    for entry in board["days"]:
        slug = entry["slug"]
        head = f'<b>{escape(entry["weekday"])}</b><span class="d">{escape(entry["dates"])}</span>'
        day = load_day(board_name, slug)
        if day is None:
            status = f'<span class="s">{escape(board["release"])}</span>'
            cells.append(f'<span class="day is-later">{head}{status}</span>')
            continue
        status = f'<span class="s">{len(day["companies"])} hiring</span>'
        if slug == current:
            cells.append(
                f'<a class="day is-today" href="{slug}" aria-current="page">{head}{status}</a>'
            )
        else:
            cells.append(f'<a class="day" href="{slug}">{head}{status}</a>')
    return "".join(cells)


def post_list(day: Day) -> str:
    companies = {company["name"]: company for company in day["companies"]}
    items = []
    for name in day["post"]:
        company = companies[name]
        items.append(
            f'<li><a href="#co-{company["slug"]}" data-jump="{company["slug"]}">'
            f"{escape(name)}</a>"
            f'<span class="st">{escape(company["stage"])}</span>'
            f'<span class="sm">{escape(company["summary"])}</span></li>'
        )
    return "".join(items)


def numbers(counts: dict[str, int]) -> str:
    rows = [
        ("hiring", "hosts hiring today"),
        ("roles", "roles posted this week"),
        ("new", "new this week"),
        ("remote", "US remote"),
    ]
    return "".join(f"<div><dt>{label}</dt><dd>{counts[key]:,}</dd></div>" for key, label in rows)


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

    page = Template((SITE / "day.html").read_text(encoding="utf-8"))
    return page.substitute(
        page_title=escape(f"{title}: SF Tech Week hosts that are hiring | Metix AI Platform"),
        og_title=escape(f"{title}: {counts['hiring']} SF Tech Week hosts are hiring"),
        description=escape(
            f"{counts['hiring']} companies hosting SF Tech Week events on {title} posted "
            f"{counts['roles']:,} Bay Area or US-remote roles in the past 7 days, "
            f"{counts['new']} of them new. Their events today and every role, with links."
        ),
        og_alt=escape(
            f"{title}: {counts['hiring']} SF Tech Week hosts are hiring, with "
            f"{counts['roles']:,} Bay Area and US-remote roles posted this week."
        ),
        canonical=canonical,
        og_image=f"{board['url']}/og/{slug}.png",
        assets="../../assets",
        platform_url=platform_link("/", via),
        eyebrow=escape(board["eyebrow"]),
        day_strip=day_strip(board_name, board, slug),
        title=escape(title),
        nums=numbers(counts),
        stub=escape(
            f"{counts['events']} events on the calendar today. {counts['hiring']} of their hosts "
            f"posted Bay Area or US-remote roles in the past 7 days: {counts['roles']:,} in all, "
            f"{window}, {counts['new']} of them new this week. Pulled {pulled} from the "
            "Metix AI Platform."
        ),
        post_list=post_list(day),
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
