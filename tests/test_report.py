import re

from jobboard.report import bar, load_report, render_report

BOARD = "tech-week-2026/sf"


def test_bar_segments_fill_the_track_in_order() -> None:
    svg = bar([(0.25, "s-new"), (0.75, "s-old")])
    segment = r'class="s-[a-z0-9]+" x="[\d.]+" y="0" width="([\d.]+)"'
    widths = [float(w) for w in re.findall(segment, svg)]
    assert widths == [25.0, 75.0]
    assert 'x="25.00"' in svg
    assert "style=" not in svg


def test_report_numbers_add_up() -> None:
    report = load_report(BOARD)
    overall = report["overall"]
    reposts = sum(band["roles"] for band in report["repost_age_bands"])
    assert overall["new"] + reposts == overall["roles"]
    assert sum(row["roles"] for row in report["by_company_type"]) == overall["roles"]


def test_report_page_renders_every_placeholder() -> None:
    html = render_report(BOARD)
    assert "$" not in html.replace("$$", "")
    assert "Most roles posted this week" in html
    assert "style=" not in html
