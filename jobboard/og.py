"""Share image for a day, 1200 by 627, drawn by a headless browser from site/og.html."""

from __future__ import annotations

from html import escape
from pathlib import Path
from string import Template

from jobboard.render import SITE, load_board, load_day, logo_data_uri, totals


def render_og(board_name: str, slug: str, out: Path) -> Path:
    from playwright.sync_api import sync_playwright

    board = load_board(board_name)
    day = load_day(board_name, slug)
    if day is None:
        raise SystemExit(f"no data for {board_name} {slug}")
    entry = next(item for item in board["days"] if item["slug"] == slug)
    counts = totals(day)
    page_html = Template((SITE / "og.html").read_text(encoding="utf-8")).substitute(
        eyebrow=escape(board["eyebrow"]),
        title=escape(entry["title"]),
        hiring=counts["hiring"],
        roles=f"{counts['roles']:,}",
        logo=logo_data_uri("metix-logo-white.svg"),
        url=escape(board["url"].removeprefix("https://")),
    )

    out.parent.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch()
        page = browser.new_page(viewport={"width": 1200, "height": 627})
        page.set_content(page_html, wait_until="networkidle")
        page.evaluate("document.fonts.ready")
        page.screenshot(path=str(out))
        browser.close()
    return out
