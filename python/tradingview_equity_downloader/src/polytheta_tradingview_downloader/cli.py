from __future__ import annotations

import argparse
import logging
import sys
from pathlib import Path

from .downloader import (
    DownloadConfig,
    fetch_cboe_weekly_symbols,
    find_project_root,
    load_tradingview_cookies,
    resolve_candidate_tickers,
    run_download,
)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="polytheta-tradingview-downloader",
        description=(
            "Download TradingView screener equities into the repository "
            "data_trading_view/ folder."
        ),
    )
    parser.add_argument(
        "--project-root",
        type=Path,
        default=None,
        help="Repository root containing ./data_trading_view.",
    )
    parser.add_argument(
        "--min-price",
        type=float,
        default=None,
        help="Only keep instruments priced at or above this value.",
    )
    parser.add_argument(
        "--full-download",
        action="store_true",
        help="Download the full NASDAQ/NYSE/AMEX equity universe plus the configured index tickers and options data.",
    )
    parser.add_argument(
        "--cboe-weeklys-only",
        action="store_true",
        help="Download only the current Cboe Weeklys underlyings, plus SPX and VIX.",
    )
    parser.add_argument(
        "--batch-size",
        type=int,
        default=500,
        help="TradingView screener page size.",
    )
    parser.add_argument(
        "--max-records",
        type=int,
        default=0,
        help="Optional hard cap on downloaded rows. Zero means no cap.",
    )
    parser.add_argument(
        "--column-batch-size",
        type=int,
        default=125,
        help="How many TradingView fields to request per chunk when downloading all stock fields.",
    )
    parser.add_argument(
        "--option-expirations",
        type=int,
        default=2,
        help="How many nearest option expirations to export per underlying. Zero disables the options export.",
    )
    parser.add_argument(
        "--option-strike-distance-pct",
        type=float,
        default=30.0,
        help="Keep only option strikes within this percentage of the current underlying price.",
    )
    parser.add_argument(
        "--ticker-pause-seconds",
        type=float,
        default=0.2,
        help="Pause between per-ticker options downloads to reduce TradingView rate limiting.",
    )
    parser.add_argument(
        "--request-pause-seconds",
        type=float,
        default=0.5,
        help="Pause before TradingView/Cboe HTTP requests to be more courteous to upstream services.",
    )
    parser.add_argument(
        "--include-calculated-fields",
        action="store_true",
        help="Keep calculated technical-indicator families in the main equities export instead of splitting them out.",
    )
    parser.add_argument(
        "--skip-calculated-fields",
        action="store_true",
        help="Do not fetch or write the calculated field set at all.",
    )
    parser.add_argument(
        "--browser",
        default="edge",
        choices=("edge", "chrome", "chromium", "brave", "firefox", "safari"),
        help="Browser profile to use for TradingView cookies.",
    )
    parser.add_argument(
        "--market",
        default="america",
        help="TradingView market to query. Defaults to america.",
    )
    parser.add_argument(
        "--exchanges",
        default="NASDAQ,NYSE,AMEX",
        help="Comma-separated exchanges to include.",
    )
    parser.add_argument(
        "--instrument-types",
        default="stock,fund",
        help="Comma-separated TradingView instrument types, for example stock or stock,fund.",
    )
    parser.add_argument(
        "--log-level",
        default="INFO",
        choices=("DEBUG", "INFO", "WARNING", "ERROR"),
        help="Logging verbosity.",
    )
    return parser


def parse_csv_list(raw_value: str) -> tuple[str, ...]:
    values: list[str] = []
    seen: set[str] = set()
    for item in raw_value.split(","):
        normalized = item.strip().upper()
        if not normalized or normalized in seen:
            continue
        seen.add(normalized)
        values.append(normalized)
    return tuple(values)


def parse_type_list(raw_value: str) -> tuple[str, ...]:
    values: list[str] = []
    seen: set[str] = set()
    for item in raw_value.split(","):
        normalized = item.strip().lower()
        if not normalized or normalized in seen:
            continue
        seen.add(normalized)
        values.append(normalized)
    return tuple(values)


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()

    logging.basicConfig(
        level=getattr(logging, args.log_level.upper()),
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )

    selected_modes = int(bool(args.full_download)) + int(bool(args.cboe_weeklys_only))
    if selected_modes > 1:
        parser.error("Use only one of --full-download or --cboe-weeklys-only.")
    if not args.full_download and not args.cboe_weeklys_only and args.min_price is None:
        parser.error("Provide --min-price or use --full-download or --cboe-weeklys-only.")
    if selected_modes and args.min_price is not None:
        parser.error("Use either --min-price, --full-download, or --cboe-weeklys-only.")
    if args.min_price is not None and args.min_price < 0:
        parser.error("--min-price must be non-negative.")
    if args.batch_size <= 0:
        parser.error("--batch-size must be greater than zero.")
    if args.max_records < 0:
        parser.error("--max-records must be zero or positive.")
    if args.column_batch_size <= 0:
        parser.error("--column-batch-size must be greater than zero.")
    if args.option_expirations < 0:
        parser.error("--option-expirations must be zero or positive.")
    if args.option_strike_distance_pct < 0:
        parser.error("--option-strike-distance-pct must be non-negative.")
    if args.ticker_pause_seconds < 0:
        parser.error("--ticker-pause-seconds must be non-negative.")
    if args.request_pause_seconds < 0:
        parser.error("--request-pause-seconds must be non-negative.")
    if args.include_calculated_fields and args.skip_calculated_fields:
        parser.error("Use either --include-calculated-fields or --skip-calculated-fields, not both.")

    project_root = find_project_root(args.project_root)
    exchanges = parse_csv_list(args.exchanges)
    instrument_types = parse_type_list(args.instrument_types)
    if not exchanges:
        parser.error("--exchanges must include at least one exchange.")
    if not instrument_types:
        parser.error("--instrument-types must include at least one type.")

    config = DownloadConfig(
        project_root=project_root,
        min_price=0.0 if (args.full_download or args.cboe_weeklys_only) else args.min_price,
        batch_size=args.batch_size,
        max_records=0 if (args.full_download or args.cboe_weeklys_only) else args.max_records,
        column_batch_size=args.column_batch_size,
        option_expirations=args.option_expirations,
        option_strike_distance_pct=args.option_strike_distance_pct,
        ticker_pause_seconds=args.ticker_pause_seconds,
        request_pause_seconds=args.request_pause_seconds,
        include_calculated_fields=args.include_calculated_fields,
        skip_calculated_fields=args.skip_calculated_fields,
        browser=args.browser,
        market=args.market,
        exchanges=exchanges,
        instrument_types=instrument_types,
    )
    if args.cboe_weeklys_only:
        weekly_symbols = fetch_cboe_weekly_symbols(args.request_pause_seconds)
        cookies = load_tradingview_cookies(args.browser)
        target_tickers, unresolved_symbols = resolve_candidate_tickers(
            config,
            cookies,
            weekly_symbols,
        )
        if unresolved_symbols:
            logging.warning(
                "Could not resolve %s Cboe Weeklys symbols to TradingView tickers: %s",
                len(unresolved_symbols),
                ",".join(unresolved_symbols[:50]),
            )
        config.target_tickers = target_tickers
        config.extra_tickers = ()

    result = run_download(config)

    print(f"run_timestamp={result.run_timestamp}")
    print(f"project_root={project_root}")
    print(f"records_downloaded={result.records_downloaded}")
    print(f"unique_symbols={result.unique_symbols}")
    print(f"option_records_downloaded={result.option_records_downloaded}")
    print(f"rotated_to={result.rotated_to or ''}")
    print(f"csv_output={result.csv_output}")
    print(f"options_csv_output={result.options_csv_output or ''}")
    print(f"calculated_csv_output={result.calculated_csv_output or ''}")
    print(f"json_output={result.json_output}")
    print(f"options_json_output={result.options_json_output or ''}")
    print(f"calculated_json_output={result.calculated_json_output or ''}")
    print(f"manifest_csv={result.manifest_csv}")
    print(f"verification_report={result.verification_report}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
