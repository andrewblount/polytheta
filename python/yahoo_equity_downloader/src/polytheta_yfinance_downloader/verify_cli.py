from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from .downloader import (
    DownloadConfig,
    DownloadResult,
    find_project_root,
    latest_manifest_path,
    parse_ticker_list,
    verify_download_completeness,
)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="polytheta-yahoo-verify",
        description="Verify the completeness of the latest downloader snapshot.",
    )
    parser.add_argument(
        "--project-root",
        type=Path,
        default=None,
        help="Repository root containing ./data and ./data_history.",
    )
    parser.add_argument(
        "--manifest-path",
        type=Path,
        default=None,
        help="Optional explicit manifest CSV to verify. Defaults to the latest manifest in ./data.",
    )
    parser.add_argument(
        "--min-price",
        type=float,
        required=True,
        help="Minimum price filter that was used for the download.",
    )
    parser.add_argument(
        "--max-tickers",
        type=int,
        default=10000,
        help="Maximum number of symbols expected from discovery.",
    )
    parser.add_argument(
        "--history-period",
        default="max",
        help="History period used by the downloader.",
    )
    parser.add_argument(
        "--symbol-source",
        default="cboe_weekly",
        choices=("cboe_weekly", "nasdaqtrader", "screeners", "hybrid"),
        help="Discovery source to validate against.",
    )
    parser.add_argument(
        "--tickers",
        default=None,
        help="Optional comma-separated explicit symbols to validate instead of discovery.",
    )
    parser.add_argument(
        "--missing-only",
        action="store_true",
        help="Validate only the symbols whose current ./data/<TICKER>/ folder is missing or empty.",
    )
    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()

    project_root = find_project_root(args.project_root)
    manifest_path = args.manifest_path or latest_manifest_path(project_root)
    if manifest_path is None:
        parser.error("No manifest file found to verify.")

    run_timestamp = manifest_path.name[:19]
    config = DownloadConfig(
        project_root=project_root,
        min_price=args.min_price,
        max_tickers=args.max_tickers,
        history_period=args.history_period,
        symbol_source=args.symbol_source,
        tickers=parse_ticker_list(args.tickers),
        missing_only=args.missing_only,
        symbol_timeout_seconds=180,
    )
    result = DownloadResult(
        run_timestamp=run_timestamp,
        rotated_to=None,
        downloaded_symbols=[],
        skipped_symbols=[],
        consolidated_csv=None,
        manifest_csv=manifest_path,
    )
    report_path = verify_download_completeness(config=config, result=result)
    report = json.loads(report_path.read_text(encoding="utf-8"))
    print(f"report_path={report_path}")
    print(f"complete={report.get('complete')}")
    print(f"expected_symbol_count={report.get('expected_symbol_count')}")
    print(f"attempted_symbol_count={report.get('attempted_symbol_count')}")
    print(f"downloaded_symbol_count={report.get('downloaded_symbol_count')}")
    print(f"missing_from_manifest_count={report.get('missing_from_manifest_count')}")
    print(f"error_symbol_count={report.get('error_symbol_count')}")
    print(f"missing_required_file_count={report.get('missing_required_file_count')}")
    return 0 if report.get("complete") else 1


if __name__ == "__main__":
    sys.exit(main())
