from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from .downloader import (
    DownloadConfig,
    find_project_root,
    latest_verification_report_path,
    run_download,
)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="polytheta-yahoo-recover",
        description="Retry missing or incomplete tickers from a download verification report.",
    )
    parser.add_argument(
        "--project-root",
        type=Path,
        default=None,
        help="Repository root containing ./data and ./data_history.",
    )
    parser.add_argument(
        "--verification-report",
        type=Path,
        default=None,
        help="Optional explicit verification report JSON. Defaults to the latest report in ./data.",
    )
    parser.add_argument(
        "--batch-size",
        type=int,
        default=500,
        help="Maximum number of retry symbols to include in this recovery run.",
    )
    parser.add_argument(
        "--history-period",
        default="max",
        help="History period used for the recovery run.",
    )
    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()

    project_root = find_project_root(args.project_root)
    verification_report = args.verification_report or latest_verification_report_path(
        project_root
    )
    if verification_report is None:
        parser.error("No verification report found to recover from.")
    if args.batch_size <= 0:
        parser.error("--batch-size must be greater than zero.")

    report = json.loads(verification_report.read_text(encoding="utf-8"))
    retry_symbols = set(report.get("missing_from_manifest") or [])
    retry_symbols.update(report.get("error_symbols") or [])
    retry_symbols.update((report.get("missing_required_files") or {}).keys())
    ordered_retry_symbols = sorted(retry_symbols)[: args.batch_size]
    if not ordered_retry_symbols:
        print("retry_symbols=")
        print("recovery_skipped=True")
        return 0

    result = run_download(
        DownloadConfig(
            project_root=project_root,
            min_price=float(report.get("min_price", 0)),
            max_tickers=len(ordered_retry_symbols),
            history_period=args.history_period,
            symbol_source=str(report.get("symbol_source", "cboe_weekly")),
            tickers=tuple(ordered_retry_symbols),
            missing_only=False,
            symbol_timeout_seconds=180,
        )
    )
    print(f"retry_symbols={','.join(ordered_retry_symbols)}")
    print(f"run_timestamp={result.run_timestamp}")
    print(f"manifest_csv={result.manifest_csv}")
    print(f"verification_report={result.verification_report or ''}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
