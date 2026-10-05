"""Render a board's report page from its aggregate file, report.json."""

from __future__ import annotations

import json
from html import escape
from pathlib import Path
from string import Template
from typing import Any

from jobboard.render import BOARDS, DOCS, PLATFORM, SITE, date_range, load_board, short_date, write

Report = dict[str, Any]


def load_report(board: str) -> Report:
    report: Report = json.loads((BOARDS / board / "report.json").read_text(encoding="utf-8"))
    return report


def pct(share: float) -> str:
    return f"{round(share * 100)}%"


def bar(parts: list[tuple[float, str]]) -> str:
    """A horizontal bar of segments, each (fraction of the track, CSS class). Colours come
    from the stylesheet, so the page needs no inline styles under its CSP."""
    x = 0.0
    rects = []
    for fraction, css in parts:
        width = max(0.0, fraction) * 100
        rects.append(f'<rect class="{css}" x="{x:.2f}" y="0" width="{width:.2f}" height="10"/>')
        x += width
    return (
        '<svg class="rb" viewBox="0 0 100 10" preserveAspectRatio="none" aria-hidden="true">'
        f'<rect class="track" x="0" y="0" width="100" height="10"/>{"".join(rects)}</svg>'
    )


def rows(items: list[tuple[str, str, list[tuple[float, str]], str]]) -> str:
    """Chart rows: (label, value text, bar parts, extra text)."""
    out = []
    for label, value, parts, extra in items:
        extra_html = f'<span class="rx">{escape(extra)}</span>' if extra else ""
        out.append(
            f'<li><span class="rl">{escape(label)}</span>{bar(parts)}'
            f'<span class="rv">{escape(value)}</span>{extra_html}</li>'
        )
    return f'<ol class="chart">{"".join(out)}</ol>'


def new_split(row: Report) -> list[tuple[float, str]]:
    return [(row["new"] / row["roles"], "s-new"), (1 - row["new"] / row["roles"], "s-old")]


def age_chart(report: Report) -> str:
    total = report["overall"]["roles"]
    segments = [(report["overall"]["new"], "New that week", "s-new")]
    shades = ["s-a1", "s-a2", "s-a3", "s-a4"]
    segments += [
        (band["roles"], f"Repost, first seen {band['label'].lower()} earlier", shade)
        for band, shade in zip(report["repost_age_bands"], shades, strict=True)
    ]
    legend = "".join(
        f'<li><span class="key {css}" aria-hidden="true"></span>{escape(label)}'
        f'<b>{count:,}</b><span class="rx">{round(100 * count / total)}%</span></li>'
        for count, label, css in segments
    )
    return (
        f'<div class="stack">{bar([(count / total, css) for count, _, css in segments])}</div>'
        f'<ul class="legend">{legend}</ul>'
    )


def render_report(board_name: str) -> str:
    board = load_board(board_name)
    report = load_report(board_name)
    overall = report["overall"]
    window = date_range(report["window"]["from"], report["window"]["to"])
    via = board["via"]
    old = report["repost_age_bands"]
    open_90 = old[2]["roles"] + old[3]["roles"]
    types = [row for row in report["by_company_type"] if row["roles"] >= 40]
    small = [row for row in report["by_company_type"] if row["roles"] < 40]
    jobs = report["by_job_type"]
    top_share = max(row["new_share"] for row in jobs)
    scale = (int(top_share * 10) + 1) / 10
    title = "Most roles posted this week at SF Tech Week hosts were posted before"

    page = Template((SITE / "report.html").read_text(encoding="utf-8"))
    return page.substitute(
        page_title=escape(f"{title} | Metix AI Platform"),
        description=escape(
            f"Of {overall['roles']:,} Bay Area and US-remote roles that {report['companies']} "
            f"SF Tech Week hosts posted {window}, {pct(overall['new_share'])} first appeared "
            "that week. The rest were reposts of older openings."
        ),
        canonical=f"{board['url']}/report",
        og_image=f"{board['url']}/og/report.png",
        assets="../../assets",
        platform_url=f"{PLATFORM}/?via={via}",
        eyebrow=escape("SF Tech Week · Oct 5-11, 2026 · Metix AI Platform analysis"),
        title=escape(title),
        lede=escape(
            f"We matched the {overall['roles']:,} Bay Area and US-remote roles that "
            f"{report['companies']} hosting companies posted {window} against the Metix AI "
            f"Platform's job history. One in five first appeared that week. The rest were "
            f"reposts of openings first seen a median of {report['repost_median_days']:.0f} "
            "days earlier."
        ),
        n_roles=f"{overall['roles']:,}",
        n_new=pct(overall["new_share"]),
        n_age=f"{report['repost_median_days']:.0f}",
        n_old=f"{open_90:,}",
        age_chart=age_chart(report),
        new_count=f"{overall['new']:,}",
        under_30=f"{old[0]['roles']:,}",
        open_90=f"{open_90:,}",
        over_180=f"{old[3]['roles']:,}",
        most_new=rows(
            [
                (row["name"], f"{row['new']} new of {row['roles']}", new_split(row), "")
                for row in report["most_new"]
            ]
        ),
        all_reposts=rows(
            [
                (row["name"], f"{row['new']} new of {row['roles']}", new_split(row), "")
                for row in report["all_reposts"]
            ]
        ),
        n_all_reposts=str(len(report["all_reposts"])),
        by_type=rows(
            [
                (
                    row["label"],
                    f"{pct(row['new_share'])} new of {row['roles']:,}",
                    new_split(row),
                    f"postings up {row['mean_days_up']} days on average, "
                    f"{pct(row['closed_within_14_days'])} down within 2 weeks",
                )
                for row in types
            ]
        ),
        small_types=escape(
            ", ".join(f"{row['label'].lower()} ({row['roles']} roles)" for row in small)
        ),
        by_job=rows(
            [
                (
                    row["label"],
                    f"{pct(row['new_share'])} of {row['roles']:,}",
                    [(row["new_share"] / scale, "s-new")],
                    "",
                )
                for row in jobs
            ]
        ),
        job_scale=pct(scale),
        ai_share=pct(report["ai"]["new_share"]),
        within_14=pct(report["closed_within_14_days"]),
        mean_days=str(report["mean_days_up"]),
        postings_closed=f"{report['postings_closed']:,}",
        window=escape(window),
        pulled=escape(short_date(report["pulled"])),
        calendar=board["calendar"],
        repo=board["repo"],
        monday_new=f"{board['url']}/mon?new=1&amp;scope=all",
        signup=f"{PLATFORM}/signup?via={via}&amp;redirectUrl=%2Fapi-keys",
        main_site=f"https://www.metix.ai/?utm_source={via}",
    )


def build(board_name: str, *, og: bool = True) -> list[Path]:
    out = DOCS / board_name
    written = [write(out / "report.html", render_report(board_name))]
    if og:
        from jobboard.og import render_report_og

        written.append(render_report_og(board_name, out / "og" / "report.png"))
    return written
