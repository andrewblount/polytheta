from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Literal

from mcp.server.fastmcp import FastMCP

from .downloader import (
    SIGNAL_SNAPSHOTS_FILENAME_SUFFIX,
    find_project_root,
    latest_file_matching,
    latest_consolidated_path,
    latest_ticker_dataset_path,
    list_current_tickers,
    list_files_for_ticker,
    list_history_runs,
    read_csv_preview,
    ensure_data_directories,
)

DEFAULT_PROJECT_ROOT = find_project_root()

mcp = FastMCP(
    name="polytheta-yahoo-downloader",
    instructions=(
        "Read the latest Yahoo Finance downloader CSV snapshots from the "
        "Polytheta repository data/ and data_history/ folders."
    ),
)


@mcp.tool(
    description="List all current ticker folders available in ./data.",
    structured_output=True,
)
def list_downloaded_tickers(project_root: str | None = None) -> dict[str, object]:
    root = find_project_root(project_root or DEFAULT_PROJECT_ROOT)
    return {"project_root": str(root), "tickers": list_current_tickers(root)}


@mcp.tool(
    description="List archived downloader run directories in ./data_history.",
    structured_output=True,
)
def list_archived_runs(project_root: str | None = None) -> dict[str, object]:
    root = find_project_root(project_root or DEFAULT_PROJECT_ROOT)
    return {"project_root": str(root), "runs": list_history_runs(root)}


@mcp.tool(
    description="List CSV files available for a ticker in current data and optionally history.",
    structured_output=True,
)
def list_ticker_files(
    ticker: str,
    include_history: bool = False,
    project_root: str | None = None,
) -> dict[str, object]:
    root = find_project_root(project_root or DEFAULT_PROJECT_ROOT)
    return {
        "project_root": str(root),
        "ticker": ticker.upper(),
        "files": list_files_for_ticker(
            ticker=ticker, project_root=root, include_history=include_history
        ),
    }


@mcp.tool(
    description="Read a preview of the latest consolidated fundamentals CSV.",
    structured_output=True,
)
def preview_consolidated_fundamentals(
    rows: int = 25, project_root: str | None = None
) -> dict[str, object]:
    root = find_project_root(project_root or DEFAULT_PROJECT_ROOT)
    path = latest_consolidated_path(root)
    if path is None:
        return {"project_root": str(root), "path": None, "rows": []}
    return {
        "project_root": str(root),
        "path": str(path),
        "rows": read_csv_preview(path, rows=rows),
    }


@mcp.tool(
    description="Read a preview of the latest normalized source-signal CSV.",
    structured_output=True,
)
def preview_signal_snapshots(
    rows: int = 25, project_root: str | None = None
) -> dict[str, object]:
    root = find_project_root(project_root or DEFAULT_PROJECT_ROOT)
    data_dir, _ = ensure_data_directories(root)
    path = latest_file_matching(data_dir, SIGNAL_SNAPSHOTS_FILENAME_SUFFIX)
    if path is None:
        return {"project_root": str(root), "path": None, "rows": []}
    return {
        "project_root": str(root),
        "path": str(path),
        "rows": read_csv_preview(path, rows=rows),
    }


@mcp.tool(
    description=(
        "Preview the latest ticker CSV for quote, fundamentals, price_history, "
        "income_statement, balance_sheet, cashflow, options, options_current, or options_next_week."
    ),
    structured_output=True,
)
def preview_ticker_dataset(
    ticker: str,
    dataset: Literal[
        "quote",
        "fundamentals",
        "price_history",
        "income_statement",
        "balance_sheet",
        "cashflow",
        "options",
        "options_current",
        "options_next_week",
    ] = "fundamentals",
    rows: int = 20,
    project_root: str | None = None,
) -> dict[str, object]:
    root = find_project_root(project_root or DEFAULT_PROJECT_ROOT)
    path = latest_ticker_dataset_path(ticker=ticker, dataset=dataset, project_root=root)
    if path is None:
        return {
            "project_root": str(root),
            "ticker": ticker.upper(),
            "dataset": dataset,
            "path": None,
            "rows": [],
        }
    return {
        "project_root": str(root),
        "ticker": ticker.upper(),
        "dataset": dataset,
        "path": str(path),
        "rows": read_csv_preview(path, rows=rows),
    }


@mcp.tool(
    description="Return a JSON-serializable summary of the latest downloader data for a ticker.",
    structured_output=True,
)
def summarize_ticker(
    ticker: str, project_root: str | None = None
) -> dict[str, object]:
    root = find_project_root(project_root or DEFAULT_PROJECT_ROOT)
    summary = {
        "project_root": str(root),
        "ticker": ticker.upper(),
        "quote": preview_ticker_dataset(
            ticker=ticker, dataset="quote", rows=1, project_root=str(root)
        ),
        "fundamentals": preview_ticker_dataset(
            ticker=ticker, dataset="fundamentals", rows=1, project_root=str(root)
        ),
        "options_current": preview_ticker_dataset(
            ticker=ticker, dataset="options_current", rows=5, project_root=str(root)
        ),
        "options_next_week": preview_ticker_dataset(
            ticker=ticker,
            dataset="options_next_week",
            rows=5,
            project_root=str(root),
        ),
    }
    return json.loads(json.dumps(summary))


def main() -> None:
    global DEFAULT_PROJECT_ROOT

    parser = argparse.ArgumentParser(
        prog="polytheta-yahoo-mcp",
        description="Expose local downloader CSV data over an MCP stdio server.",
    )
    parser.add_argument(
        "--project-root",
        type=Path,
        default=DEFAULT_PROJECT_ROOT,
        help="Repository root containing ./data and ./data_history.",
    )
    args = parser.parse_args()

    DEFAULT_PROJECT_ROOT = find_project_root(args.project_root)
    mcp.run(transport="stdio")


if __name__ == "__main__":
    main()
