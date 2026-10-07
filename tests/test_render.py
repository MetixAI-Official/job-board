from jobboard.render import date_range, early_note, embed_json, short_date, totals


def test_date_range_across_months() -> None:
    assert date_range("2026-09-26", "2026-10-02") == "Sep 26 to Oct 2"


def test_date_range_within_a_month() -> None:
    assert date_range("2026-10-01", "2026-10-07") == "Oct 1 to 7"


def test_short_date() -> None:
    assert short_date("2026-10-03") == "Oct 3"


def test_embedded_data_cannot_close_the_script_element() -> None:
    embedded = embed_json({"title": "</script><script>alert(1)</script>"})
    assert "</script>" not in embedded
    assert "<" not in embedded


def test_totals_count_new_and_remote_only_roles() -> None:
    day = {
        "events_today": 9,
        "companies": [
            {
                "roles": [
                    {"ai": True, "new": True, "regions": ["remote"]},
                    {"ai": False, "new": False, "regions": ["sf", "remote"]},
                ]
            },
            {"roles": [{"ai": False, "new": False, "regions": ["sf"]}]},
        ],
    }
    assert totals(day) == {"events": 9, "hiring": 2, "roles": 3, "new": 1, "ai": 1, "remote": 1}


def test_early_note_only_on_pages_filled_ahead_of_their_day() -> None:
    window = {"from": "2026-09-30", "to": "2026-10-06"}
    day = {"early": True, "pulled": "2026-10-07", "window": window}
    note = early_note(day)
    assert "Early look" in note
    assert "Filled with Oct 7 market data (roles posted Sep 30 to Oct 6)" in note
    assert early_note({**day, "early": False}) == ""
    assert early_note({k: v for k, v in day.items() if k != "early"}) == ""
