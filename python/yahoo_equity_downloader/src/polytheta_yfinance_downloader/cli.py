from __future__ import annotations

import argparse
import logging
import sys
from pathlib import Path

from .downloader import DownloadConfig, find_project_root, parse_ticker_list, run_download


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="polytheta-yahoo-downloader",
        description=(
            "Download Yahoo Finance equity, options, and fundamentals snapshots "
            "into the repository data/ folder."
        ),
    )
    parser.add_argument(
        "--project-root",
        type=Path,
        default=None,
        help="Repository root containing ./data and ./data_history.",
    )
    parser.add_argument(
        "--min-price",
        type=float,
        required=True,
        help="Only keep equities priced at or above this value.",
    )
    parser.add_argument(
        "--max-tickers",
        type=int,
        default=10000,
        help="Maximum number of symbols to download in one run.",
    )
    parser.add_argument(
        "--history-period",
        default="max",
        help="Price history period passed to yfinance. Defaults to max.",
    )
    parser.add_argument(
        "--tickers",
        default=None,
        help="Optional comma-separated list of explicit symbols to download.",
    )
    parser.add_argument(
        "--missing-only",
        action="store_true",
        help="Only download symbols whose current ./data/<TICKER>/ folder is missing or empty, then rebuild the run-level files.",
    )
    parser.add_argument(
        "--symbol-source",
        default="cboe_weekly",
        choices=("cboe_weekly", "nasdaqtrader", "screeners", "hybrid"),
        help="Discovery source for non-manual runs.",
    )
    parser.add_argument(
        "--cboe-weeklys-with-indexes",
        action="store_true",
        help="Use the Cboe Weeklys universe and append SPX and VIX index aliases for Yahoo downloads.",
    )
    parser.add_argument(
        "--log-level",
        default="INFO",
        choices=("DEBUG", "INFO", "WARNING", "ERROR"),
        help="Logging verbosity.",
    )
    parser.add_argument(
        "--symbol-timeout-seconds",
        type=int,
        default=180,
        help="Abort a single symbol download if it runs longer than this many seconds.",
    )
    parser.add_argument(
        "--ticker-pause-seconds",
        type=float,
        default=1.5,
        help="Pause between ticker downloads to reduce upstream request pressure.",
    )
    parser.add_argument(
        "--request-pause-seconds",
        type=float,
        default=0.75,
        help="Pause before upstream SEC/FINRA/FRED/Yahoo request groups to be courteous to data providers.",
    )
    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()

    logging.basicConfig(
        level=getattr(logging, args.log_level.upper()),
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )

    if args.min_price < 0:
        parser.error("--min-price must be non-negative.")
    if args.max_tickers <= 0:
        parser.error("--max-tickers must be greater than zero.")
    if args.symbol_timeout_seconds <= 0:
        parser.error("--symbol-timeout-seconds must be greater than zero.")
    if args.ticker_pause_seconds < 0:
        parser.error("--ticker-pause-seconds must be non-negative.")
    if args.request_pause_seconds < 0:
        parser.error("--request-pause-seconds must be non-negative.")

    project_root = find_project_root(args.project_root)
    tickers = parse_ticker_list(args.tickers)
    symbol_source = args.symbol_source
    if args.cboe_weeklys_with_indexes:
        symbol_source = "cboe_weekly"

    result = run_download(
        DownloadConfig(
            project_root=project_root,
            min_price=args.min_price,
            max_tickers=args.max_tickers,
            history_period=args.history_period,
            symbol_source=symbol_source,
            tickers=tickers,
            missing_only=args.missing_only,
            symbol_timeout_seconds=args.symbol_timeout_seconds,
            ticker_pause_seconds=args.ticker_pause_seconds,
            request_pause_seconds=args.request_pause_seconds,
            include_cboe_weekly_indexes=args.cboe_weeklys_with_indexes,
        )
    )

    print(f"run_timestamp={result.run_timestamp}")
    print(f"project_root={project_root}")
    print(f"rotated_to={result.rotated_to or ''}")
    print(f"downloaded_symbols={','.join(result.downloaded_symbols)}")
    print(f"skipped_symbols={','.join(result.skipped_symbols)}")
    print(f"manifest_csv={result.manifest_csv}")
    print(f"consolidated_csv={result.consolidated_csv or ''}")
    print(f"signal_snapshots_csv={result.signal_snapshots_csv or ''}")
    print(f"macro_signals_csv={result.macro_signals_csv or ''}")
    print(f"verification_report={result.verification_report or ''}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
