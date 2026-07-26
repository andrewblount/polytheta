from __future__ import annotations

import argparse
import logging
import sys
from pathlib import Path

from .downloader import find_project_root, verify_snapshot


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="polytheta-tradingview-verify",
        description=(
            "Verify the latest TradingView snapshot in data_trading_view/ against its "
            "saved manifest and the current live TradingView total."
        ),
    )
    parser.add_argument(
        "--project-root",
        type=Path,
        default=None,
        help="Repository root containing ./data_trading_view.",
    )
    parser.add_argument(
        "--verification-report",
        type=Path,
        default=None,
        help="Optional explicit verification report JSON to validate.",
    )
    parser.add_argument(
        "--skip-live-total",
        action="store_true",
        help="Only validate against the saved run metadata and skip the live TradingView count.",
    )
    parser.add_argument(
        "--log-level",
        default="INFO",
        choices=("DEBUG", "INFO", "WARNING", "ERROR"),
        help="Logging verbosity.",
    )
    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()

    logging.basicConfig(
        level=getattr(logging, args.log_level.upper()),
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )

    project_root = find_project_root(args.project_root)
    result = verify_snapshot(
        project_root,
        verification_report=args.verification_report,
        refresh_live_total=not args.skip_live_total,
    )

    print(f"latest_csv={result.latest_csv}")
    print(f"latest_manifest_csv={result.latest_manifest_csv}")
    print(f"latest_verification_report={result.latest_verification_report}")
    print(f"verification_output={result.verification_output}")
    print(f"expected_total_saved={result.expected_total_saved}")
    print(f"expected_total_live={result.expected_total_live}")
    print(f"records_downloaded={result.records_downloaded}")
    print(f"unique_tickers={result.unique_tickers}")
    print(f"duplicate_ticker_rows={result.duplicate_ticker_rows}")
    print(f"page_rows_total={result.page_rows_total}")
    print(f"is_complete_against_saved_total={result.is_complete_against_saved_total}")
    print(f"matches_live_total={result.matches_live_total}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
