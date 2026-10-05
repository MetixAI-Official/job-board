"""Share images, 1200 by 627, drawn by a headless browser from site/og.html."""

from __future__ import annotations

from html import escape
from pathlib import Path
from string import Template

from jobboard.render import SITE, load_board, load_day, logo_data_uri, totals


def _draw(page_html: str, out: Path) -> Path:
    from playwright.sync_api import sync_playwright

    out.parent.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch()
        page = browser.new_page(viewport={"width": 1200, "height": 627})
        page.set_content(page_html, wait_until="networkidle")
        page.evaluate("document.fonts.ready")
        page.screenshot(path=str(out))
        browser.close()
    return out


def _page(board: dict[str, str], title: str, claim: str, title_size: int, eyebrow: str = "") -> str:
    return Template((SITE / "og.html").read_text(encoding="utf-8")).substitute(
        eyebrow=escape(eyebrow or board["eyebrow"]),
        title=escape(title),
        title_size=title_size,
        claim=claim,
        logo=logo_data_uri("metix-logo-white.svg"),
        url=escape(board["url"].removeprefix("https://")),
    )


def render_og(board_name: str, slug: str, out: Path) -> Path:
    board = load_board(board_name)
    day = load_day(board_name, slug)
    if day is None:
        raise SystemExit(f"no data for {board_name} {slug}")
    entry = next(item for item in board["days"] if item["slug"] == slug)
    counts = totals(day)
    claim = (
        f"<b>{counts['hiring']}</b> SF Tech Week hosts are hiring today.<br>"
        f"<b>{counts['roles']:,}</b> Bay Area and US-remote roles this week."
    )
    return _draw(_page(board, entry["title"], claim, 78), out)
