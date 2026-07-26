from __future__ import annotations

import argparse
import logging
import sys
from pathlib import Path

from .downloader import find_project_root, load_saved_config, run_download, verify_snapshot


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="polytheta-tradingview-recover",
        description=(
            "Recover an incomplete TradingView snapshot by rerunning it with the filters "
            "saved in the latest verification report."
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
        help="Optional explicit verification report JSON to recover from.",
    )
    parser.add_argument(
        "--batch-size",
        type=int,
        default=500,
        help="TradingView screener page size for the recovery run.",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="Run the recovery download even if the latest snapshot already verifies cleanly.",
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

    if args.batch_size <= 0:
        parser.error("--batch-size must be greater than zero.")

    project_root = find_project_root(args.project_root)
    verification = verify_snapshot(project_root, verification_report=args.verification_report)
    needs_recovery = not (
        verification.is_complete_against_saved_total and verification.matches_live_total
    )

    if not needs_recovery and not args.force:
        print("status=skipped_already_complete")
        print(f"latest_verification_report={verification.latest_verification_report}")
        print(f"verification_output={verification.verification_output}")
        return 0

    config = load_saved_config(
        project_root,
        verification.latest_verification_report,
        batch_size=args.batch_size,
    )
    result = run_download(config)
    print("status=recovered")
    print(f"run_timestamp={result.run_timestamp}")
    print(f"csv_output={result.csv_output}")
    print(f"json_output={result.json_output}")
    print(f"manifest_csv={result.manifest_csv}")
    print(f"verification_report={result.verification_report}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
