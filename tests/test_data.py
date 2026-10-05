"""Checks every published day file must pass before it goes out."""

import json
import re
from pathlib import Path
from typing import Any

import pytest

Day = dict[str, Any]

DAYS = sorted(Path(__file__).resolve().parent.parent.glob("boards/*/*/days/*.json"))
TIERS = {"early", "growth", "large", "vc", "pro"}
REGIONS = {"sf", "pen", "east", "north", "remote"}
LEGAL_TITLE = re.compile(r"\b(counsel|attorney|paralegal)\b", re.I)
RECRUITER_TITLE = re.compile(r"\b(recruiter|hr business partner)\b", re.I)


@pytest.fixture(params=DAYS, ids=lambda path: f"{path.parent.parent.name}/{path.stem}")
def day(request: pytest.FixtureRequest) -> Day:
    data: Day = json.loads(Path(request.param).read_text(encoding="utf-8"))
    return data


def test_there_is_at_least_one_day() -> None:
    assert DAYS


def test_every_post_company_is_on_the_page(day: Day) -> None:
    names = {company["name"] for company in day["companies"]}
    assert set(day["post"]) <= names


def test_companies_are_complete(day: Day) -> None:
    for company in day["companies"]:
        assert company["tier"] in TIERS, company["name"]
        assert company["label"] and company["summary"] and company["industry"], company["name"]
        if company["stage"]:
            assert company["stage_source"], f"{company['name']}: a shown round needs a source"
        assert company["linkedin"].startswith("https://www.linkedin.com/company/"), company["name"]
        assert company["events"], company["name"]
        assert company["roles"], company["name"]


def test_links_point_where_they_should(day: Day) -> None:
    event_ids = {event["id"] for event in day["events"]}
    for event in day["events"]:
        assert event["url"].startswith("https://www.tech-week.com/"), event["url"]
        assert "src=" not in event["url"], event["url"]
        assert event["hosts"], event["name"]
    for company in day["companies"]:
        assert set(company["events"]) <= event_ids, company["name"]
        for role in company["roles"]:
            assert str(role["id"]).isdigit(), role
            assert set(role["regions"]) <= REGIONS, role


def test_every_role_says_whether_it_is_new(day: Day) -> None:
    for company in day["companies"]:
        for role in company["roles"]:
            assert isinstance(role["new"], bool), role


def test_roles_are_inside_the_window(day: Day) -> None:
    start, end = day["window"]["from"], day["window"]["to"]
    for company in day["companies"]:
        for role in company["roles"]:
            assert start <= role["posted"] <= end, role


def test_legal_titles_are_filed_as_legal(day: Day) -> None:
    for company in day["companies"]:
        for role in company["roles"]:
            if LEGAL_TITLE.search(role["title"]):
                assert role["family"] == "Legal / compliance", role["title"]


def test_recruiters_are_filed_as_people(day: Day) -> None:
    for company in day["companies"]:
        for role in company["roles"]:
            if RECRUITER_TITLE.search(role["title"]):
                assert role["family"] == "People / recruiting", role["title"]
