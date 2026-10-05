"""Command line entry point: python -m jobboard <command>."""

from __future__ import annotations

import argparse

from jobboard import render, report


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="jobboard",
        description="Build hiring boards from the Metix AI Platform.",
    )
    commands = parser.add_subparsers(dest="command", required=True)

    site = commands.add_parser("site", help="render a day's page, redirects and share image")
    site.add_argument("board", help="board directory under boards/, for example tech-week-2026/sf")
    site.add_argument("--day", required=True, help="day slug from board.toml, for example mon")
    site.add_argument("--no-og", action="store_true", help="skip the share image")

    rep = commands.add_parser("report", help="render the board's report page and share image")
    rep.add_argument("board", help="board directory under boards/, for example tech-week-2026/sf")
    rep.add_argument("--no-og", action="store_true", help="skip the share image")

    args = parser.parse_args(argv)
    if args.command == "site":
        written = render.build(args.board, args.day, og=not args.no_og)
    else:
        written = report.build(args.board, og=not args.no_og)
    for path in written:
        print(path.relative_to(render.ROOT))
    return 0
