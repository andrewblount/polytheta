from __future__ import annotations

import csv
import json
import logging
import math
import re
import signal
import time
from numbers import Integral, Real
import shutil
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from pathlib import Path
from typing import Any, Iterable
from urllib.request import Request, urlopen
from zoneinfo import ZoneInfo

import pandas as pd
import yfinance as yf

from .source_signals import (
    FinraShortInterestCsvProvider,
    OptionalSocialSentimentProvider,
    PublicMacroSnapshotProvider,
    SecEdgarFilingsProvider,
    SecFtdSignalProvider,
    SecLitigationRadarProvider,
    black_scholes_delta,
    configure_request_pause_seconds,
    iv_percentile,
    latest_weekly_universe_frame,
    probability_of_touch_from_delta,
)

LOGGER = logging.getLogger(__name__)

DEFAULT_SCREENER_QUERIES = (
    "most_actives",
    "day_gainers",
    "aggressive_small_caps",
    "growth_technology_stocks",
    "small_cap_gainers",
    "undervalued_growth_stocks",
    "undervalued_large_caps",
    "most_shorted_stocks",
)

EQUITY_FUNDAMENTALS_FILENAME_SUFFIX = "equity_fundamentals"
PRICE_HISTORY_FILENAME_SUFFIX = "price_history"
PRICE_HISTORY_TODAY_FILENAME_SUFFIX = "price_history_today"
INCOME_STATEMENT_YEARLY_FILENAME_SUFFIX = "income_statement_yearly"
INCOME_STATEMENT_QUARTERLY_FILENAME_SUFFIX = "income_statement_quarterly"
BALANCE_SHEET_YEARLY_FILENAME_SUFFIX = "balance_sheet_yearly"
BALANCE_SHEET_QUARTERLY_FILENAME_SUFFIX = "balance_sheet_quarterly"
CASHFLOW_YEARLY_FILENAME_SUFFIX = "cashflow_yearly"
CASHFLOW_QUARTERLY_FILENAME_SUFFIX = "cashflow_quarterly"
OPTIONS_FILENAME_SUFFIX = "options"
CURRENT_WEEK_OPTIONS_FILENAME_SUFFIX = "current_week_options"
NEXT_WEEK_OPTIONS_FILENAME_SUFFIX = "next_week_options"
DATASET_MANIFEST_FILENAME_SUFFIX = "dataset_manifest"
MANIFEST_FILENAME_SUFFIX = "download_manifest"
WEEKLY_UNIVERSE_FILENAME_SUFFIX = "weekly_universe"
SIGNAL_SNAPSHOTS_FILENAME_SUFFIX = "signal_snapshots"
SHORT_INTEREST_SIGNALS_FILENAME_SUFFIX = "short_interest_signals"
FILING_SIGNALS_FILENAME_SUFFIX = "filing_signals"
MACRO_SIGNALS_FILENAME_SUFFIX = "macro_signals"
SOCIAL_SIGNALS_FILENAME_SUFFIX = "social_signals"
PROVIDER_STATUS_FILENAME_SUFFIX = "provider_status"
DAILY_HISTORY_REFRESH_WINDOW_DAYS = 30
DAILY_HISTORY_REFRESH_PERIOD = "45d"
INTRADAY_INTERVAL_CANDIDATES = ("1m", "2m", "5m", "15m", "30m", "60m", "90m", "1h")
US_MARKET_TIMEZONE = ZoneInfo("America/New_York")
US_MARKET_OPEN_HOUR = 9
US_MARKET_OPEN_MINUTE = 30
US_MARKET_CLOSE_HOUR = 16
US_MARKET_CLOSE_MINUTE = 0
STATEMENT_DATASET_SUFFIXES = {
    INCOME_STATEMENT_YEARLY_FILENAME_SUFFIX,
    INCOME_STATEMENT_QUARTERLY_FILENAME_SUFFIX,
    BALANCE_SHEET_YEARLY_FILENAME_SUFFIX,
    BALANCE_SHEET_QUARTERLY_FILENAME_SUFFIX,
    CASHFLOW_YEARLY_FILENAME_SUFFIX,
    CASHFLOW_QUARTERLY_FILENAME_SUFFIX,
}
NASDAQ_TRADER_LISTING_SOURCES = (
    ("https://www.nasdaqtrader.com/dynamic/SymDir/nasdaqtraded.txt", "Symbol", "nasdaqtrader"),
    ("https://www.nasdaqtrader.com/dynamic/SymDir/otherlisted.txt", "ACT Symbol", "otherlisted"),
)
CBOE_WEEKLY_OPTIONS_URL = "https://www.cboe.com/us/options/symboldir/weeklys-options/download/"
SECURITY_NAME_EXCLUSION_TERMS = (
    "Warrant",
    " Warrants",
    " Unit",
    " Units",
    " Right",
    " Rights",
    " Preferred",
    " Preference",
    " Depositary Shares",
    " Notes",
    " Bond",
    " ETN",
    " NextShares",
    " Trust Units",
    " Beneficial Interest",
    " Closed End Fund",
)
SYMBOL_PATTERN = r"[A-Z]{1,5}(?:\.[A-Z])?"
HTTP_REQUEST_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/136.0.0.0 Safari/537.36"
    )
}
DEFAULT_SYMBOL_TIMEOUT_SECONDS = 180
DEFAULT_TICKER_PAUSE_SECONDS = 1.5
DEFAULT_REQUEST_PAUSE_SECONDS = 0.75
HISTORY_PERIOD_FALLBACKS = ("1y", "6mo", "1mo", "5d")
YAHOO_SYMBOL_OVERRIDES: dict[str, dict[str, Any]] = {
    "VIX": {"yahoo_symbol": "^VIX", "history_only": True},
    "^VIX": {"canonical_symbol": "VIX", "yahoo_symbol": "^VIX", "history_only": True},
    "DJX": {"yahoo_symbol": "^DJI", "history_only": True},
    "RUT": {"yahoo_symbol": "^RUT", "history_only": True},
    "MRUT": {"yahoo_symbol": "^RUT", "history_only": True},
    "SPX": {"yahoo_symbol": "^GSPC", "history_only": True},
    "^SPX": {"canonical_symbol": "SPX", "yahoo_symbol": "^GSPC", "history_only": True},
    "XSP": {"yahoo_symbol": "^GSPC", "history_only": True},
    "NANOS": {"yahoo_symbol": "^GSPC", "history_only": True},
    "OEX": {"yahoo_symbol": "^OEX", "history_only": True},
    "XEO": {"yahoo_symbol": "^XEO", "history_only": True},
}
REQUIRED_DATASET_SUFFIXES = (
    EQUITY_FUNDAMENTALS_FILENAME_SUFFIX,
    PRICE_HISTORY_FILENAME_SUFFIX,
    INCOME_STATEMENT_YEARLY_FILENAME_SUFFIX,
    INCOME_STATEMENT_QUARTERLY_FILENAME_SUFFIX,
    BALANCE_SHEET_YEARLY_FILENAME_SUFFIX,
    BALANCE_SHEET_QUARTERLY_FILENAME_SUFFIX,
    CASHFLOW_YEARLY_FILENAME_SUFFIX,
    CASHFLOW_QUARTERLY_FILENAME_SUFFIX,
)


@dataclass(slots=True)
class DownloadConfig:
    project_root: Path
    min_price: float
    max_tickers: int
    history_period: str
    symbol_source: str = "cboe_weekly"
    tickers: tuple[str, ...] = ()
    screener_queries: tuple[str, ...] = DEFAULT_SCREENER_QUERIES
    missing_only: bool = False
    symbol_timeout_seconds: int = DEFAULT_SYMBOL_TIMEOUT_SECONDS
    ticker_pause_seconds: float = DEFAULT_TICKER_PAUSE_SECONDS
    request_pause_seconds: float = DEFAULT_REQUEST_PAUSE_SECONDS
    include_cboe_weekly_indexes: bool = False


@dataclass(slots=True)
class SymbolDownloadAttempt:
    symbol: str
    status: str
    payload: dict[str, Any] | None
    error: str | None
    attempt_count: int


class SymbolDownloadTimeoutError(TimeoutError):
    pass


@dataclass(slots=True)
class DownloadResult:
    run_timestamp: str
    rotated_to: Path | None
    downloaded_symbols: list[str]
    skipped_symbols: list[str]
    consolidated_csv: Path | None
    manifest_csv: Path
    verification_report: Path | None = None
    signal_snapshots_csv: Path | None = None
    macro_signals_csv: Path | None = None


def run_timestamp_label() -> str:
    return datetime.now(UTC).strftime("%Y-%m-%d %H-%M-%S")


def pause_for_network(seconds: float) -> None:
    if seconds > 0:
        time.sleep(seconds)


def find_project_root(explicit_root: str | Path | None = None) -> Path:
    if explicit_root:
        return Path(explicit_root).expanduser().resolve()

    candidates = [Path.cwd(), *Path(__file__).resolve().parents]
    for candidate in candidates:
        if (candidate / "package.json").exists() and (candidate / "src").exists():
            return candidate

    raise FileNotFoundError(
        "Could not determine the repository root. Re-run with --project-root."
    )


def ensure_data_directories(project_root: Path) -> tuple[Path, Path]:
    data_dir = project_root / "data"
    history_dir = project_root / "data_history"
    data_dir.mkdir(parents=True, exist_ok=True)
    history_dir.mkdir(parents=True, exist_ok=True)
    (data_dir / ".gitkeep").touch(exist_ok=True)
    (history_dir / ".gitkeep").touch(exist_ok=True)
    return data_dir, history_dir


def should_discard_transient_file(path: Path) -> bool:
    return path.suffix in {".csv", ".json"} and exact_suffix_matches(
        path.stem, PRICE_HISTORY_TODAY_FILENAME_SUFFIX
    )


def rotate_current_data(
    data_dir: Path, history_dir: Path, rotation_timestamp: str
) -> Path | None:
    current_entries = [entry for entry in data_dir.iterdir() if entry.name != ".gitkeep"]
    if not current_entries:
        return None

    archive_dir = history_dir / rotation_timestamp
    archive_dir.mkdir(parents=True, exist_ok=True)
    for entry in current_entries:
        if entry.is_file():
            if should_discard_transient_file(entry):
                entry.unlink(missing_ok=True)
                continue
            shutil.move(str(entry), str(archive_dir / entry.name))
            continue

        destination_dir = archive_dir / entry.name
        destination_dir.mkdir(parents=True, exist_ok=True)
        archived_any = False
        for child in list(entry.iterdir()):
            if child.is_file() and should_discard_transient_file(child):
                child.unlink(missing_ok=True)
                continue
            shutil.move(str(child), str(destination_dir / child.name))
            archived_any = True

        if archived_any:
            shutil.rmtree(entry)
        else:
            shutil.rmtree(destination_dir, ignore_errors=True)
            shutil.rmtree(entry)

    return archive_dir


def parse_ticker_list(raw_tickers: str | None) -> tuple[str, ...]:
    if not raw_tickers:
        return ()

    seen: set[str] = set()
    normalized: list[str] = []
    for ticker in raw_tickers.split(","):
        symbol = ticker.strip().upper()
        override = YAHOO_SYMBOL_OVERRIDES.get(symbol)
        if override and override.get("canonical_symbol"):
            symbol = str(override["canonical_symbol"]).upper()
        if not symbol or symbol in seen:
            continue
        seen.add(symbol)
        normalized.append(symbol)
    return tuple(normalized)


def extend_with_index_overrides(
    candidates: list[dict[str, Any]],
    *,
    max_tickers: int,
) -> list[dict[str, Any]]:
    seen = {str(candidate.get("symbol") or "").upper() for candidate in candidates}
    extended = list(candidates)
    for symbol in ("SPX", "VIX"):
        if symbol in seen:
            continue
        override = YAHOO_SYMBOL_OVERRIDES.get(symbol, {})
        extended.append(
            {
                "symbol": symbol,
                "screen_query": "cboe_weekly_index",
                "exchange": "INDEX",
                "security_name": symbol,
                "is_etf": False,
                "yahoo_symbol": override.get("yahoo_symbol") or yahoo_symbol_for(symbol),
                "history_only": bool(override.get("history_only")),
            }
        )
        seen.add(symbol)
        if len(extended) >= max_tickers:
            break
    return extended[:max_tickers]


def yahoo_symbol_for(symbol: str) -> str:
    override = YAHOO_SYMBOL_OVERRIDES.get(symbol)
    if override and override.get("yahoo_symbol"):
        return str(override["yahoo_symbol"])
    return symbol.replace(".", "-")


def is_history_only_symbol(symbol: str) -> bool:
    override = YAHOO_SYMBOL_OVERRIDES.get(symbol)
    return bool(override and override.get("history_only"))


def required_dataset_suffixes_for_candidate(candidate: dict[str, Any]) -> tuple[str, ...]:
    if candidate.get("history_only") or candidate.get("is_etf") or candidate.get("etf"):
        return (
            EQUITY_FUNDAMENTALS_FILENAME_SUFFIX,
            PRICE_HISTORY_FILENAME_SUFFIX,
        )
    return REQUIRED_DATASET_SUFFIXES


def as_bool(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    text = str(value).strip().lower()
    return text in {"true", "1", "y", "yes"}


def safe_float(value: Any) -> float | None:
    if value is None:
        return None
    try:
        converted = float(value)
    except (TypeError, ValueError):
        return None
    if math.isnan(converted) or math.isinf(converted):
        return None
    return converted


def safe_int(value: Any) -> int | None:
    converted = safe_float(value)
    if converted is None:
        return None
    return int(round(converted))


def format_datetime_like(value: datetime | date | pd.Timestamp) -> str:
    if isinstance(value, pd.Timestamp):
        timestamp = value.to_pydatetime()
    elif isinstance(value, datetime):
        timestamp = value
    else:
        return value.strftime("%Y-%m-%d")

    if timestamp.tzinfo:
        timestamp = timestamp.astimezone(UTC)

    has_time = any(
        [timestamp.hour != 0, timestamp.minute != 0, timestamp.second != 0]
    )
    if not has_time:
        return timestamp.strftime("%Y-%m-%d")
    return timestamp.strftime("%Y-%m-%d %H-%M-%S")


def format_number(value: Any) -> Any:
    if isinstance(value, bool):
        return value
    if isinstance(value, Integral):
        return value
    if isinstance(value, Real):
        rounded = round(float(value), 2)
        if math.isnan(rounded) or math.isinf(rounded):
            return None
        if rounded.is_integer():
            return int(rounded)
        return rounded
    return value


def as_scalar(value: Any) -> Any:
    if value is None:
        return None
    if isinstance(value, (pd.Timestamp, datetime, date)):
        return format_datetime_like(value)
    if isinstance(value, (list, tuple, set)):
        return "|".join(str(item) for item in value)
    if isinstance(value, dict):
        return str(value)
    if pd.isna(value):
        return None
    if isinstance(value, (Real, Integral, bool)):
        return format_number(value)
    return value


def normalize_dataframe(df: pd.DataFrame | None) -> pd.DataFrame:
    if df is None or df.empty:
        return pd.DataFrame()
    normalized = df.copy()
    normalized.columns = [str(as_scalar(column)) for column in normalized.columns]
    return normalized.map(as_scalar)


def normalize_statement_dataframe(df: pd.DataFrame | None) -> pd.DataFrame:
    if df is None or df.empty:
        return pd.DataFrame()
    statement = normalize_dataframe(df)
    statement.index = statement.index.map(as_scalar)
    statement.index.name = "line_item"
    statement = statement.reset_index()
    statement.columns = [str(as_scalar(column)) for column in statement.columns]
    return statement


def first_available_frame(value_candidates: Iterable[Any]) -> pd.DataFrame | None:
    for candidate in value_candidates:
        if candidate is None:
            continue
        if isinstance(candidate, pd.DataFrame):
            return candidate
    return None


def exact_suffix_matches(stem: str, suffix_fragment: str) -> bool:
    return stem.endswith(f"_{suffix_fragment}")


def suffix_with_trailing_token_matches(stem: str, suffix_fragment: str) -> bool:
    return stem.endswith(f"_{suffix_fragment}") or f"_{suffix_fragment}_" in stem


def write_csv(df: pd.DataFrame, path: Path) -> None:
    def to_csv_value(value: Any) -> str:
        scalar = as_scalar(value)
        if scalar is None:
            return ""
        if isinstance(scalar, bool):
            return "True" if scalar else "False"
        if isinstance(scalar, Integral):
            return str(int(scalar))
        if isinstance(scalar, Real):
            text = f"{float(scalar):.2f}"
            if text.endswith(".00"):
                return text[:-3]
            if text.endswith("0"):
                return text[:-1]
            return text
        return str(scalar)

    path.parent.mkdir(parents=True, exist_ok=True)
    serializable = df.copy()
    serializable.columns = [str(as_scalar(column)) for column in serializable.columns]
    serializable = serializable.map(to_csv_value)
    serializable.to_csv(path, index=False)


def write_json_records(df: pd.DataFrame, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    records = [
        {key: as_scalar(value) for key, value in record.items()}
        for record in df.to_dict(orient="records")
    ]
    path.write_text(json.dumps(records, ensure_ascii=True, indent=2), encoding="utf-8")


def parse_run_timestamp(value: str) -> datetime | None:
    try:
        return datetime.strptime(value, "%Y-%m-%d %H-%M-%S").replace(tzinfo=UTC)
    except ValueError:
        return None


def extract_run_timestamp_from_path(path: Path) -> datetime | None:
    return parse_run_timestamp(path.name[:19])


def is_same_utc_run_day(path: Path, run_timestamp: str) -> bool:
    cached_timestamp = extract_run_timestamp_from_path(path)
    current_timestamp = parse_run_timestamp(run_timestamp)
    if cached_timestamp is None or current_timestamp is None:
        return False
    return cached_timestamp.date() == current_timestamp.date()


def is_us_market_open(reference_time: datetime | None = None) -> bool:
    now = (reference_time or datetime.now(UTC)).astimezone(US_MARKET_TIMEZONE)
    if now.weekday() >= 5:
        return False

    open_time = now.replace(
        hour=US_MARKET_OPEN_HOUR,
        minute=US_MARKET_OPEN_MINUTE,
        second=0,
        microsecond=0,
    )
    close_time = now.replace(
        hour=US_MARKET_CLOSE_HOUR,
        minute=US_MARKET_CLOSE_MINUTE,
        second=0,
        microsecond=0,
    )
    return open_time <= now <= close_time


def combined_dataset_output_name(dataset_suffix: str) -> str:
    if dataset_suffix == EQUITY_FUNDAMENTALS_FILENAME_SUFFIX:
        return "equities"
    return dataset_suffix


def combined_filename(run_timestamp: str, suffix: str) -> str:
    return f"{run_timestamp}_{combined_dataset_output_name(suffix)}.csv"


def ticker_filename(
    run_timestamp: str, suffix: str, expiry: str | None = None
) -> str:
    if expiry:
        return f"{run_timestamp}_{suffix}_{expiry}.csv"
    return f"{run_timestamp}_{suffix}.csv"


def json_filename(csv_filename: str) -> str:
    return str(Path(csv_filename).with_suffix(".json"))


def normalize_history_index(raw_history: pd.DataFrame, *, intraday: bool) -> pd.DataFrame:
    if raw_history.empty:
        return pd.DataFrame()

    history = raw_history.copy()
    converted_index = pd.to_datetime(history.index)
    if intraday:
        history.index = pd.Index(converted_index)
        history.index.name = "timestamp"
    else:
        history.index = pd.Index([timestamp.date() for timestamp in converted_index])
        history.index.name = "date"
    return history


def fetch_daily_history(
    ticker: yf.Ticker, period: str, *, interval: str = "1d"
) -> pd.DataFrame:
    history = ticker.history(period=period, interval=interval, auto_adjust=False)
    return normalize_history_index(history, intraday=interval != "1d")


def fetch_daily_history_with_fallback(
    ticker: yf.Ticker,
    period: str,
    *,
    interval: str = "1d",
    fallback_periods: Iterable[str] = (),
) -> pd.DataFrame:
    attempted_periods: list[str] = []
    for candidate_period in (period, *fallback_periods):
        if candidate_period in attempted_periods:
            continue
        attempted_periods.append(candidate_period)
        try:
            history = fetch_daily_history(ticker, candidate_period, interval=interval)
        except Exception as exc:  # pragma: no cover
            LOGGER.warning(
                "History download failed for period %s interval %s: %s",
                candidate_period,
                interval,
                exc,
            )
            continue
        if not history.empty:
            return history
    return pd.DataFrame()


def load_existing_daily_history(path: Path) -> pd.DataFrame:
    existing = pd.read_csv(path)
    if existing.empty or "date" not in existing.columns:
        return pd.DataFrame()

    cleaned = existing.drop(columns=["downloaded_on", "symbol"], errors="ignore").copy()
    cleaned["date"] = pd.to_datetime(cleaned["date"], errors="coerce").dt.strftime("%Y-%m-%d")
    cleaned = cleaned.loc[cleaned["date"].notna()].copy()
    return cleaned


def strip_run_metadata(dataframe: pd.DataFrame) -> pd.DataFrame:
    return dataframe.drop(columns=["downloaded_on", "symbol"], errors="ignore").copy()


def refresh_run_metadata(
    dataframe: pd.DataFrame, run_timestamp: str, symbol: str
) -> pd.DataFrame:
    refreshed = strip_run_metadata(dataframe)
    refreshed.insert(0, "downloaded_on", run_timestamp)
    refreshed.insert(1, "symbol", symbol)
    return refreshed


def write_symbol_status_manifest(
    *,
    ticker_dir: Path,
    run_timestamp: str,
    symbol: str,
    status: str,
    dataset_statuses: dict[str, Any] | None = None,
    error: str | None = None,
    metadata: dict[str, Any] | None = None,
) -> Path:
    dataset_manifest_path = ticker_dir / json_filename(
        ticker_filename(run_timestamp, DATASET_MANIFEST_FILENAME_SUFFIX)
    )
    payload = {
        "downloaded_on": run_timestamp,
        "symbol": symbol,
        "status": status,
        "datasets": dataset_statuses or {},
    }
    if error:
        payload["error"] = error
    if metadata:
        payload["metadata"] = metadata
    dataset_manifest_path.write_text(
        json.dumps(payload, ensure_ascii=True, indent=2),
        encoding="utf-8",
    )
    return dataset_manifest_path


def merge_daily_history(
    existing_history: pd.DataFrame | None,
    recent_history: pd.DataFrame,
    *,
    refresh_window_days: int = DAILY_HISTORY_REFRESH_WINDOW_DAYS,
) -> pd.DataFrame:
    recent_output = normalize_dataframe(recent_history.reset_index())
    if existing_history is None or existing_history.empty:
        return recent_output

    cutoff = (datetime.now(UTC).date() - timedelta(days=refresh_window_days)).strftime(
        "%Y-%m-%d"
    )
    preserved = existing_history.loc[existing_history["date"] < cutoff].copy()
    combined = pd.concat([preserved, recent_output], ignore_index=True, sort=False)
    if "date" not in combined.columns:
        return combined

    combined["date"] = pd.to_datetime(combined["date"], errors="coerce").dt.strftime("%Y-%m-%d")
    combined = combined.loc[combined["date"].notna()].copy()
    combined = combined.drop_duplicates(subset=["date"], keep="last")
    combined = combined.sort_values(by=["date"]).reset_index(drop=True)
    return combined


def fetch_intraday_history(
    ticker: yf.Ticker,
) -> tuple[pd.DataFrame, str | None]:
    for interval in INTRADAY_INTERVAL_CANDIDATES:
        try:
            history = fetch_daily_history(ticker, "1d", interval=interval)
        except Exception as exc:  # pragma: no cover
            LOGGER.warning("Intraday history download failed for interval %s: %s", interval, exc)
            continue
        if history.empty:
            continue
        return history, interval
    return pd.DataFrame(), None


def load_cached_dataframe(path: Path | None) -> pd.DataFrame:
    if path is None or not path.exists():
        return pd.DataFrame()
    return pd.read_csv(path)


def load_cached_row(path: Path | None) -> dict[str, Any]:
    dataframe = load_cached_dataframe(path)
    if dataframe.empty:
        return {}
    return {
        key: as_scalar(value) for key, value in dataframe.iloc[0].to_dict().items()
    }


def merge_prefer_non_null(
    base: dict[str, Any], updates: dict[str, Any]
) -> dict[str, Any]:
    merged = dict(base)
    for key, value in updates.items():
        if value is None:
            continue
        merged[key] = value
    return merged


def latest_non_null_from_row(
    statement_df: pd.DataFrame, row_name: str
) -> tuple[Any, str | None]:
    if statement_df.empty or "line_item" not in statement_df.columns:
        return None, None

    matches = statement_df.loc[statement_df["line_item"] == row_name]
    if matches.empty:
        return None, None

    row = matches.iloc[0]
    for column in statement_df.columns[1:]:
        if column in {"downloaded_on", "symbol"}:
            continue
        value = row[column]
        if value is not None:
            return value, column
    return None, None


def first_available_statement_value(
    statement_df: pd.DataFrame, candidates: Iterable[str]
) -> tuple[Any, str | None, str | None]:
    for candidate in candidates:
        value, period = latest_non_null_from_row(statement_df, candidate)
        if value is not None:
            return value, candidate, period
    return None, None, None


def sum_statement_values(
    statement_df: pd.DataFrame, row_names: Iterable[str]
) -> tuple[float | None, str | None]:
    total = 0.0
    period: str | None = None
    found = False
    for row_name in row_names:
        value, row_period = latest_non_null_from_row(statement_df, row_name)
        numeric = safe_float(value)
        if numeric is None:
            continue
        if period is None:
            period = row_period
        total += numeric
        found = True
    return (format_number(total) if found else None), period


def regex_statement_value(
    statement_df: pd.DataFrame, terms: Iterable[str]
) -> tuple[Any, str | None, str | None]:
    if statement_df.empty or "line_item" not in statement_df.columns:
        return None, None, None

    lowered_terms = tuple(term.lower() for term in terms)
    for line_item in statement_df["line_item"]:
        if not isinstance(line_item, str):
            continue
        lowered = line_item.lower()
        if all(term in lowered for term in lowered_terms):
            value, period = latest_non_null_from_row(statement_df, line_item)
            if value is not None:
                return value, line_item, period
    return None, None, None


def select_option_expiries(expiries: Iterable[str]) -> dict[str, str]:
    today = datetime.now(UTC).date()
    parsed: list[tuple[date, str]] = []
    for raw_expiry in expiries:
        try:
            expiry_date = date.fromisoformat(raw_expiry)
        except ValueError:
            continue
        if expiry_date >= today:
            parsed.append((expiry_date, raw_expiry))

    parsed.sort(key=lambda item: item[0])
    if not parsed:
        return {}

    current_date, current_expiry = parsed[0]
    selected = {"current": current_expiry}
    next_week_target = current_date + timedelta(days=7)
    next_week_expiry = None
    for expiry_date, raw_expiry in parsed[1:]:
        if expiry_date >= next_week_target:
            next_week_expiry = raw_expiry
            break
    if next_week_expiry is None and len(parsed) > 1:
        next_week_expiry = parsed[1][1]
    if next_week_expiry:
        selected["next_week"] = next_week_expiry
    return selected


def has_weekly_options(expiries: Iterable[str]) -> bool:
    today = datetime.now(UTC).date()
    parsed: list[date] = []
    for raw_expiry in expiries:
        try:
            expiry_date = date.fromisoformat(raw_expiry)
        except ValueError:
            continue
        if expiry_date >= today:
            parsed.append(expiry_date)

    parsed = sorted(set(parsed))
    if len(parsed) < 2:
        return False

    # Weekly listings usually show consecutive nearby expiries roughly one week apart.
    nearby = [expiry for expiry in parsed if (expiry - today).days <= 21]
    for current_expiry, next_expiry in zip(nearby, nearby[1:]):
        gap_days = (next_expiry - current_expiry).days
        if 5 <= gap_days <= 8:
            return True
    return False


def filter_option_frame(
    frame: pd.DataFrame | None, current_price: float | None
) -> pd.DataFrame:
    if frame is None or frame.empty or current_price is None:
        return pd.DataFrame()
    if "strike" not in frame.columns:
        return frame.copy()

    lower_bound = current_price * 0.7
    upper_bound = current_price * 1.3
    filtered = frame.loc[frame["strike"].between(lower_bound, upper_bound)].copy()
    return filtered


def combine_option_chain(
    symbol: str,
    chain: Any,
    expiry: str,
    label: str,
    run_timestamp: str,
    current_price: float | None,
) -> pd.DataFrame:
    frames: list[pd.DataFrame] = []
    for option_type, raw_frame in (("call", chain.calls), ("put", chain.puts)):
        frame = filter_option_frame(raw_frame, current_price)
        if frame.empty:
            continue
        option_df = normalize_dataframe(frame)
        option_df.insert(0, "downloaded_on", run_timestamp)
        option_df.insert(1, "symbol", symbol)
        option_df.insert(2, "option_snapshot_label", label)
        option_df.insert(3, "expiry", expiry)
        option_df.insert(4, "option_type", option_type)
        option_df.insert(5, "underlying_price", format_number(current_price))
        frames.append(option_df)

    if not frames:
        return pd.DataFrame()

    combined = pd.concat(frames, ignore_index=True)
    return normalize_dataframe(combined)


def option_mid_price(row: pd.Series) -> float | None:
    bid = safe_float(row.get("bid"))
    ask = safe_float(row.get("ask"))
    last_price = safe_float(row.get("lastPrice") or row.get("last_price"))
    if bid is not None and ask is not None and bid > 0 and ask > 0:
        return format_number((bid + ask) / 2)
    return format_number(last_price) if last_price is not None else None


def enrich_option_metrics_frame(
    option_frame: pd.DataFrame,
    *,
    underlying_price: float | None,
    risk_free_rate: float | None,
    as_of_date: str,
) -> pd.DataFrame:
    if option_frame.empty:
        return option_frame
    enriched = option_frame.copy()
    if "downloaded_on" not in enriched.columns:
        enriched.insert(0, "downloaded_on", as_of_date)
    if "mid_price" not in enriched.columns:
        enriched["mid_price"] = enriched.apply(option_mid_price, axis=1)
    deltas: list[float | None] = []
    pots: list[float | None] = []
    for _, row in enriched.iterrows():
        expiry_raw = str(row.get("expiry") or "")
        try:
            expiry_date = date.fromisoformat(expiry_raw)
            current_date = date.fromisoformat(as_of_date)
            dte = max(0, (expiry_date - current_date).days)
        except ValueError:
            dte = None
        delta_value = black_scholes_delta(
            spot=underlying_price,
            strike=safe_float(row.get("strike")),
            days_to_expiry=dte,
            implied_volatility=safe_float(row.get("impliedVolatility") or row.get("implied_volatility")),
            option_type=str(row.get("option_type") or ""),
            risk_free_rate=risk_free_rate,
        )
        deltas.append(delta_value)
        pots.append(probability_of_touch_from_delta(delta_value))
    enriched["modeled_delta"] = deltas
    enriched["probability_of_touch"] = pots
    enriched["model_source"] = "black_scholes"
    return normalize_dataframe(enriched)


def current_atm_iv(option_frame: pd.DataFrame, underlying_price: float | None) -> float | None:
    if option_frame.empty or underlying_price is None or "strike" not in option_frame.columns:
        return None
    candidate = option_frame.copy()
    candidate["distance_to_spot"] = candidate["strike"].map(safe_float).map(
        lambda value: abs(value - underlying_price) if value is not None else math.inf
    )
    candidate = candidate.sort_values(by=["distance_to_spot"])
    values = [
        safe_float(value)
        for value in candidate.head(4)["impliedVolatility"].tolist()
        if safe_float(value) is not None
    ]
    if not values:
        return None
    return round(sum(values) / len(values), 4)


def historical_atm_iv_series(symbol: str, history_dir: Path) -> list[float]:
    values: list[tuple[str, float]] = []
    for run_dir in sorted(
        (entry for entry in history_dir.iterdir() if entry.is_dir() and not entry.name.startswith(".")),
        key=lambda entry: entry.name,
    ):
        ticker_dir = run_dir / symbol.upper()
        if not ticker_dir.exists():
            continue
        option_path = latest_file_matching(
            ticker_dir,
            CURRENT_WEEK_OPTIONS_FILENAME_SUFFIX,
            allow_trailing_tokens=True,
        )
        equity_path = latest_file_matching(ticker_dir, EQUITY_FUNDAMENTALS_FILENAME_SUFFIX)
        if option_path is None or equity_path is None:
            continue
        try:
            option_frame = pd.read_csv(option_path)
            equity_frame = pd.read_csv(equity_path)
        except Exception:
            continue
        if option_frame.empty or equity_frame.empty:
            continue
        spot = safe_float(equity_frame.iloc[0].get("current_price"))
        iv_value = current_atm_iv(option_frame, spot)
        if iv_value is None:
            continue
        values.append((run_dir.name, iv_value))
    return [value for _, value in values[-252:]]


def write_output_dataset(
    *,
    data_dir: Path,
    run_timestamp: str,
    dataset_suffix: str,
    dataframe: pd.DataFrame,
) -> Path | None:
    if dataframe.empty:
        return None
    output_path = data_dir / ticker_filename(run_timestamp, dataset_suffix)
    write_csv(dataframe, output_path)
    write_json_records(dataframe, output_path.with_suffix(".json"))
    return output_path


def discover_symbols_via_screeners(
    min_price: float,
    max_tickers: int,
    screener_queries: Iterable[str] = DEFAULT_SCREENER_QUERIES,
) -> list[dict[str, Any]]:
    discovered: list[dict[str, Any]] = []
    seen: set[str] = set()

    for query in screener_queries:
        try:
            response = yf.screen(query, count=min(250, max_tickers))
        except Exception as exc:  # pragma: no cover
            LOGGER.warning("Screener query %s failed: %s", query, exc)
            continue

        quotes = response.get("quotes") or []
        for quote in quotes:
            symbol = str(quote.get("symbol") or "").upper()
            if not symbol or symbol in seen:
                continue

            quote_type = str(quote.get("quoteType") or "").upper()
            if quote_type and quote_type != "EQUITY":
                continue

            price = safe_float(
                quote.get("regularMarketPrice")
                or quote.get("postMarketPrice")
                or quote.get("preMarketPrice")
            )
            if price is not None and price < min_price:
                continue

            discovered.append(
                {
                    "symbol": symbol,
                    "screen_query": query,
                    "screen_price": format_number(price) if price is not None else None,
                    "exchange": quote.get("exchange"),
                }
            )
            seen.add(symbol)
            if len(discovered) >= max_tickers:
                return discovered

    return discovered


def load_nasdaq_trader_listings() -> list[dict[str, Any]]:
    listings: list[dict[str, Any]] = []
    for url, symbol_column, source_label in NASDAQ_TRADER_LISTING_SOURCES:
        with urlopen(Request(url, headers=HTTP_REQUEST_HEADERS), timeout=30) as response:
            lines = response.read().decode("utf-8").splitlines()
        for row in csv.DictReader(lines, delimiter="|"):
            symbol = str(row.get(symbol_column) or "").strip().upper()
            if not symbol or "FILE CREATION TIME" in symbol:
                continue
            normalized = dict(row)
            normalized["symbol"] = symbol
            normalized["source"] = source_label
            listings.append(normalized)
    return listings


def load_cboe_weekly_options_symbols() -> list[dict[str, Any]]:
    with urlopen(Request(CBOE_WEEKLY_OPTIONS_URL, headers=HTTP_REQUEST_HEADERS), timeout=30) as response:
        lines = response.read().decode("utf-8-sig").splitlines()

    listings: list[dict[str, Any]] = []
    reader = csv.DictReader(lines, skipinitialspace=True)
    for row in reader:
        company_name = str(row.get("Company Name") or "").strip()
        symbol = str(row.get("Stock Symbol") or "").strip().upper()
        if not symbol or not company_name:
            continue
        if re.fullmatch(SYMBOL_PATTERN, symbol) is None:
            continue
        listings.append(
            {
                "symbol": symbol,
                "security_name": company_name,
                "source": "cboe_weekly",
            }
        )
    return listings


def build_nasdaq_listing_map() -> dict[str, dict[str, Any]]:
    listing_map: dict[str, dict[str, Any]] = {}
    for row in load_nasdaq_trader_listings():
        symbol = str(row.get("symbol") or "").strip().upper()
        if not symbol or symbol in listing_map:
            continue
        listing_map[symbol] = row
    return listing_map


def is_supported_equity_or_etf_listing(row: dict[str, Any]) -> bool:
    symbol = str(row.get("symbol") or "").strip().upper()
    security_name = str(row.get("Security Name") or "").strip()
    if not symbol or not security_name:
        return False
    if re.fullmatch(SYMBOL_PATTERN, symbol) is None:
        return False
    if str(row.get("Test Issue") or "N").strip().upper() != "N":
        return False
    if str(row.get("NextShares") or "N").strip().upper() == "Y":
        return False
    return not any(term in security_name for term in SECURITY_NAME_EXCLUSION_TERMS)


def discover_symbols_via_nasdaq_trader(max_tickers: int) -> list[dict[str, Any]]:
    discovered: list[dict[str, Any]] = []
    seen: set[str] = set()
    for row in load_nasdaq_trader_listings():
        if not is_supported_equity_or_etf_listing(row):
            continue
        symbol = row["symbol"]
        if symbol in seen:
            continue
        discovered.append(
            {
                "symbol": symbol,
                "screen_query": row.get("source"),
                "screen_price": None,
                "exchange": row.get("Listing Exchange") or row.get("Exchange"),
                "security_name": row.get("Security Name"),
                "is_etf": str(row.get("ETF") or "N").strip().upper() == "Y",
            }
        )
        seen.add(symbol)
        if len(discovered) >= max_tickers:
            break
    return discovered


def infer_etf_from_name(name: str) -> bool:
    lowered = name.lower()
    return " etf" in lowered or lowered.endswith("etf") or " exchange traded fund" in lowered


def discover_symbols_via_cboe_weekly(max_tickers: int) -> list[dict[str, Any]]:
    discovered: list[dict[str, Any]] = []
    seen: set[str] = set()
    listing_map = build_nasdaq_listing_map()
    for row in load_cboe_weekly_options_symbols():
        symbol = row["symbol"]
        if symbol in seen:
            continue
        listing_row = listing_map.get(symbol, {})
        security_name = str(
            listing_row.get("Security Name") or row.get("security_name") or ""
        ).strip()
        override = YAHOO_SYMBOL_OVERRIDES.get(symbol, {})
        discovered.append(
            {
                "symbol": symbol,
                "screen_query": "cboe_weekly",
                "screen_price": None,
                "exchange": listing_row.get("Listing Exchange") or listing_row.get("Exchange"),
                "security_name": security_name or row.get("security_name"),
                "is_etf": str(listing_row.get("ETF") or "N").strip().upper() == "Y"
                or infer_etf_from_name(str(security_name or row.get("security_name") or "")),
                "yahoo_symbol": override.get("yahoo_symbol") or yahoo_symbol_for(symbol),
                "history_only": bool(override.get("history_only")),
            }
        )
        seen.add(symbol)
        if len(discovered) >= max_tickers:
            break
    return discovered


def discover_symbols(
    min_price: float,
    max_tickers: int,
    screener_queries: Iterable[str] = DEFAULT_SCREENER_QUERIES,
    *,
    symbol_source: str = "nasdaqtrader",
) -> list[dict[str, Any]]:
    if symbol_source == "screeners":
        return discover_symbols_via_screeners(
            min_price=min_price,
            max_tickers=max_tickers,
            screener_queries=screener_queries,
        )
    if symbol_source == "cboe_weekly":
        return discover_symbols_via_cboe_weekly(max_tickers=max_tickers)
    if symbol_source == "nasdaqtrader":
        return discover_symbols_via_nasdaq_trader(max_tickers=max_tickers)
    if symbol_source == "hybrid":
        discovered: list[dict[str, Any]] = []
        seen: set[str] = set()
        for candidate in discover_symbols_via_cboe_weekly(max_tickers=max_tickers):
            discovered.append(candidate)
            seen.add(candidate["symbol"])
        if len(discovered) < max_tickers:
            for candidate in discover_symbols_via_nasdaq_trader(max_tickers=max_tickers):
                if candidate["symbol"] in seen:
                    continue
                discovered.append(candidate)
                seen.add(candidate["symbol"])
                if len(discovered) >= max_tickers:
                    break
        return discovered
    raise ValueError(f"Unsupported symbol source: {symbol_source}")


def build_quote_row(
    symbol: str,
    run_timestamp: str,
    info: dict[str, Any],
    fast_info: dict[str, Any],
    current_price: float | None,
    source_metadata: dict[str, Any],
) -> dict[str, Any]:
    return {
        "downloaded_on": run_timestamp,
        "symbol": symbol,
        "screen_query": source_metadata.get("screen_query"),
        "quote_source": "yfinance",
        "yahoo_symbol": source_metadata.get("yahoo_symbol") or yahoo_symbol_for(symbol),
        "current_price": format_number(current_price),
        "regular_market_previous_close": format_number(
            safe_float(info.get("regularMarketPreviousClose") or fast_info.get("previousClose"))
        ),
        "open": format_number(safe_float(info.get("open") or fast_info.get("open"))),
        "day_high": format_number(
            safe_float(
                info.get("dayHigh")
                or info.get("regularMarketDayHigh")
                or fast_info.get("dayHigh")
            )
        ),
        "day_low": format_number(
            safe_float(
                info.get("dayLow")
                or info.get("regularMarketDayLow")
                or fast_info.get("dayLow")
            )
        ),
        "fifty_two_week_high": format_number(
            safe_float(info.get("fiftyTwoWeekHigh") or fast_info.get("yearHigh"))
        ),
        "fifty_two_week_low": format_number(
            safe_float(info.get("fiftyTwoWeekLow") or fast_info.get("yearLow"))
        ),
        "average_volume_10day": safe_int(
            info.get("averageDailyVolume10Day") or fast_info.get("tenDayAverageVolume")
        ),
        "average_volume_3month": safe_int(
            info.get("averageDailyVolume3Month") or fast_info.get("threeMonthAverageVolume")
        ),
        "currency": info.get("currency") or fast_info.get("currency"),
        "exchange": info.get("exchange") or source_metadata.get("exchange"),
        "short_name": info.get("shortName"),
        "long_name": info.get("longName"),
        "sector": info.get("sector"),
        "industry": info.get("industry"),
        "country": info.get("country"),
    }


def build_equity_fundamentals_row(
    symbol: str,
    run_timestamp: str,
    info: dict[str, Any],
    fast_info: dict[str, Any],
    income_statement: pd.DataFrame,
    cashflow: pd.DataFrame,
    current_price: float | None,
    source_metadata: dict[str, Any],
    selected_expiries: dict[str, str],
    weekly_options: bool,
    extra_metrics: dict[str, Any] | None = None,
) -> dict[str, Any]:
    is_etf = bool(source_metadata.get("is_etf")) or str(info.get("quoteType") or "").upper() == "ETF"
    total_revenue, revenue_line_item, revenue_period = first_available_statement_value(
        income_statement, ("Total Revenue",)
    )
    gross_profit, gross_profit_line_item, _ = first_available_statement_value(
        income_statement, ("Gross Profit",)
    )
    net_income, net_income_line_item, net_income_period = first_available_statement_value(
        income_statement,
        (
            "Net Income Common Stockholders",
            "Net Income",
            "Net Income Including Noncontrolling Interests",
        ),
    )
    sga_cost, sga_line_item, sga_period = first_available_statement_value(
        income_statement, ("Selling General And Administration",)
    )
    if sga_cost is None:
        sga_cost, sga_period = sum_statement_values(
            income_statement,
            ("Selling And Marketing Expense", "General And Administrative Expense"),
        )
        if sga_cost is not None:
            sga_line_item = "Selling And Marketing Expense + General And Administrative Expense"

    general_admin_cost, general_admin_line_item, general_admin_period = (
        first_available_statement_value(
            income_statement, ("General And Administrative Expense",)
        )
    )
    selling_marketing_cost, selling_marketing_line_item, selling_marketing_period = (
        first_available_statement_value(
            income_statement, ("Selling And Marketing Expense",)
        )
    )
    asset_impairment_charge, asset_impairment_line_item, asset_impairment_period = (
        first_available_statement_value(income_statement, ("Asset Impairment Charge",))
    )
    capitalized_software_impairments, software_impairment_line_item, software_impairment_period = (
        regex_statement_value(income_statement, ("software", "impair"))
    )
    capitalized_software_costs, capitalized_software_line_item, capitalized_software_period = (
        regex_statement_value(cashflow, ("capitalized", "software"))
    )

    revenue = safe_float(info.get("totalRevenue")) or safe_float(total_revenue)
    gross_profit_value = safe_float(info.get("grossProfits")) or safe_float(gross_profit)
    net_income_value = safe_float(info.get("netIncomeToCommon")) or safe_float(net_income)
    employees = safe_int(info.get("fullTimeEmployees"))
    revenue_per_employee = safe_float(info.get("revenuePerEmployee"))
    if revenue_per_employee is None and revenue is not None and employees:
        revenue_per_employee = revenue / employees

    gross_margin = safe_float(info.get("grossMargins"))
    if gross_margin is None and revenue and gross_profit_value is not None:
        gross_margin = gross_profit_value / revenue

    profit_margin = safe_float(info.get("profitMargins"))
    if profit_margin is None and revenue and net_income_value is not None:
        profit_margin = net_income_value / revenue

    row = build_quote_row(
        symbol=symbol,
        run_timestamp=run_timestamp,
        info=info,
        fast_info=fast_info,
        current_price=current_price,
        source_metadata=source_metadata,
    )
    row.update(
        {
            "market_cap": format_number(
                safe_float(info.get("marketCap") or fast_info.get("marketCap"))
            ),
            "enterprise_value": format_number(safe_float(info.get("enterpriseValue"))),
            "beta": format_number(safe_float(info.get("beta"))),
            "shares_outstanding": format_number(
                safe_float(info.get("sharesOutstanding") or fast_info.get("shares"))
            ),
            "float_shares": format_number(safe_float(info.get("floatShares"))),
            "full_time_employees": employees,
            "revenue": format_number(revenue),
            "profit": format_number(net_income_value),
            "total_revenue": format_number(revenue),
            "net_income": format_number(net_income_value),
            "revenue_per_employee": format_number(revenue_per_employee),
            "sg_and_a_cost": format_number(safe_float(sga_cost)),
            "gross_profit": format_number(gross_profit_value),
            "gross_margin": format_number(gross_margin),
            "operating_margin": format_number(safe_float(info.get("operatingMargins"))),
            "profit_margin": format_number(profit_margin),
            "ebitda": format_number(safe_float(info.get("ebitda"))),
            "free_cash_flow": format_number(safe_float(info.get("freeCashflow"))),
            "operating_cash_flow": format_number(safe_float(info.get("operatingCashflow"))),
            "debt_to_equity": format_number(safe_float(info.get("debtToEquity"))),
            "current_ratio": format_number(safe_float(info.get("currentRatio"))),
            "book_value": format_number(safe_float(info.get("bookValue"))),
            "price_to_book": format_number(safe_float(info.get("priceToBook"))),
            "trailing_pe": format_number(safe_float(info.get("trailingPE"))),
            "forward_pe": format_number(safe_float(info.get("forwardPE"))),
            "gross_margin_source": "info.grossMargins"
            if safe_float(info.get("grossMargins")) is not None
            else gross_profit_line_item,
            "revenue_source_line_item": revenue_line_item,
            "revenue_source_period": revenue_period,
            "profit_source_line_item": net_income_line_item,
            "profit_source_period": net_income_period,
            "sg_and_a_source_line_item": sga_line_item,
            "sg_and_a_source_period": sga_period,
            "general_and_administrative_expense": format_number(
                safe_float(general_admin_cost)
            ),
            "general_and_administrative_source_line_item": general_admin_line_item,
            "general_and_administrative_source_period": general_admin_period,
            "selling_and_marketing_expense": format_number(
                safe_float(selling_marketing_cost)
            ),
            "selling_and_marketing_source_line_item": selling_marketing_line_item,
            "selling_and_marketing_source_period": selling_marketing_period,
            "asset_impairment_charge": format_number(
                safe_float(asset_impairment_charge)
            ),
            "asset_impairment_source_line_item": asset_impairment_line_item,
            "asset_impairment_source_period": asset_impairment_period,
            "capitalized_software_impairments": format_number(
                safe_float(capitalized_software_impairments)
            ),
            "capitalized_software_impairments_source_line_item": software_impairment_line_item,
            "capitalized_software_impairments_source_period": software_impairment_period,
            "capitalized_software_costs": format_number(
                safe_float(capitalized_software_costs)
            ),
            "capitalized_software_costs_source_line_item": capitalized_software_line_item,
            "capitalized_software_costs_source_period": capitalized_software_period,
            "latest_current_expiry": selected_expiries.get("current"),
            "latest_next_week_expiry": selected_expiries.get("next_week"),
            "has_options": bool(selected_expiries),
            "weekly_options": weekly_options,
            "history_only": bool(source_metadata.get("history_only")),
            "etf": is_etf,
            "is_etf": is_etf,
        }
    )
    if extra_metrics:
        row.update(extra_metrics)
    return row


def append_dataset(
    datasets: dict[str, list[pd.DataFrame]], dataset_name: str, dataframe: pd.DataFrame
) -> None:
    if dataframe.empty:
        return
    datasets.setdefault(dataset_name, []).append(dataframe)


def reshape_statement_for_combined_export(dataframe: pd.DataFrame) -> pd.DataFrame:
    if dataframe.empty:
        return dataframe

    id_columns = [
        column
        for column in ("downloaded_on", "symbol", "line_item")
        if column in dataframe.columns
    ]
    value_columns = [column for column in dataframe.columns if column not in id_columns]
    if not value_columns:
        return dataframe.copy()

    period_order = {column: index + 1 for index, column in enumerate(value_columns)}
    reshaped = dataframe.melt(
        id_vars=id_columns,
        value_vars=value_columns,
        var_name="period_end",
        value_name="value",
    )
    reshaped["period_index"] = reshaped["period_end"].map(period_order)
    reshaped = reshaped.dropna(subset=["value"]).reset_index(drop=True)
    return reshaped[
        ["downloaded_on", "symbol", "line_item", "period_index", "period_end", "value"]
    ]


def fetch_ticker_payload(
    symbol: str,
    run_timestamp: str,
    data_dir: Path,
    history_dir: Path,
    min_price: float,
    history_period: str,
    source_metadata: dict[str, Any],
    request_pause_seconds: float,
) -> dict[str, Any] | None:
    yahoo_symbol = str(source_metadata.get("yahoo_symbol") or yahoo_symbol_for(symbol))
    history_only = bool(source_metadata.get("history_only"))
    ticker = yf.Ticker(yahoo_symbol)
    run_datetime = parse_run_timestamp(run_timestamp) or datetime.now(UTC)
    try:
        fast_info = dict(ticker.fast_info or {})
    except Exception as exc:  # pragma: no cover
        LOGGER.warning("fast_info unavailable for %s: %s", symbol, exc)
        fast_info = {}
    ticker_dir = data_dir / symbol
    ticker_dir.mkdir(parents=True, exist_ok=True)

    dataset_statuses: dict[str, str] = {}
    history_output = pd.DataFrame()

    cached_equity_path = latest_archived_ticker_dataset_path(
        symbol, EQUITY_FUNDAMENTALS_FILENAME_SUFFIX, history_dir
    )
    cached_equity_row = load_cached_row(cached_equity_path)
    reuse_same_day_equity = cached_equity_path is not None and is_same_utc_run_day(
        cached_equity_path, run_timestamp
    )
    if reuse_same_day_equity:
        info = {}
    else:
        pause_for_network(request_pause_seconds)
        info = ticker.info or {}
    dataset_statuses["equity_info"] = (
        "reused_cached_same_day" if reuse_same_day_equity else "downloaded"
    )

    history_output = pd.DataFrame()
    previous_history_path = latest_archived_ticker_dataset_path(
        symbol, PRICE_HISTORY_FILENAME_SUFFIX, history_dir
    )
    history_fallback_periods = HISTORY_PERIOD_FALLBACKS if history_only else ()
    if previous_history_path is None:
        pause_for_network(request_pause_seconds)
        history = fetch_daily_history_with_fallback(
            ticker,
            history_period,
            fallback_periods=history_fallback_periods,
        )
        dataset_statuses["price_history"] = "downloaded_full"
    else:
        existing_history = load_existing_daily_history(previous_history_path)
        pause_for_network(request_pause_seconds)
        recent_history = fetch_daily_history_with_fallback(
            ticker,
            DAILY_HISTORY_REFRESH_PERIOD,
            fallback_periods=("1mo", "5d") if history_only else (),
        )
        history_output = merge_daily_history(existing_history, recent_history)
        history = pd.DataFrame()
        dataset_statuses["price_history"] = "downloaded_incremental_30d_refresh"

    intraday_history = pd.DataFrame()
    intraday_interval: str | None = None
    if is_us_market_open(run_datetime):
        pause_for_network(request_pause_seconds)
        intraday_history, intraday_interval = fetch_intraday_history(ticker)
        dataset_statuses["price_history_today"] = (
            f"downloaded_{intraday_interval}" if intraday_interval else "download_attempted_empty"
        )
    else:
        dataset_statuses["price_history_today"] = "skipped_market_closed"

    current_price = safe_float(
        fast_info.get("lastPrice")
        or info.get("currentPrice")
        or info.get("regularMarketPrice")
        or (
            history["Close"].iloc[-1]
            if not history.empty
            else (
                intraday_history["Close"].iloc[-1]
                if not intraday_history.empty
                else None
            )
        )
    )
    if current_price is None:
        LOGGER.warning("Skipping %s because current price was unavailable.", symbol)
        return None
    if current_price < min_price:
        LOGGER.info(
            "Skipping %s because current price %.2f is below min-price %.2f.",
            symbol,
            current_price,
            min_price,
        )
        return None

    cached_statement_paths = {
        INCOME_STATEMENT_YEARLY_FILENAME_SUFFIX: latest_archived_ticker_dataset_path(
            symbol, INCOME_STATEMENT_YEARLY_FILENAME_SUFFIX, history_dir
        ),
        INCOME_STATEMENT_QUARTERLY_FILENAME_SUFFIX: latest_archived_ticker_dataset_path(
            symbol, INCOME_STATEMENT_QUARTERLY_FILENAME_SUFFIX, history_dir
        ),
        BALANCE_SHEET_YEARLY_FILENAME_SUFFIX: latest_archived_ticker_dataset_path(
            symbol, BALANCE_SHEET_YEARLY_FILENAME_SUFFIX, history_dir
        ),
        BALANCE_SHEET_QUARTERLY_FILENAME_SUFFIX: latest_archived_ticker_dataset_path(
            symbol, BALANCE_SHEET_QUARTERLY_FILENAME_SUFFIX, history_dir
        ),
        CASHFLOW_YEARLY_FILENAME_SUFFIX: latest_archived_ticker_dataset_path(
            symbol, CASHFLOW_YEARLY_FILENAME_SUFFIX, history_dir
        ),
        CASHFLOW_QUARTERLY_FILENAME_SUFFIX: latest_archived_ticker_dataset_path(
            symbol, CASHFLOW_QUARTERLY_FILENAME_SUFFIX, history_dir
        ),
    }

    if history_only:
        income_statement_yearly = pd.DataFrame()
        income_statement_quarterly = pd.DataFrame()
        balance_sheet_yearly = pd.DataFrame()
        balance_sheet_quarterly = pd.DataFrame()
        cashflow_yearly = pd.DataFrame()
        cashflow_quarterly = pd.DataFrame()
        for suffix in STATEMENT_DATASET_SUFFIXES:
            dataset_statuses[suffix] = "not_applicable_history_only"
    else:
        if cached_statement_paths[INCOME_STATEMENT_YEARLY_FILENAME_SUFFIX] and is_same_utc_run_day(
            cached_statement_paths[INCOME_STATEMENT_YEARLY_FILENAME_SUFFIX], run_timestamp
        ):
            income_statement_yearly = strip_run_metadata(
                load_cached_dataframe(
                    cached_statement_paths[INCOME_STATEMENT_YEARLY_FILENAME_SUFFIX]
                )
            )
            dataset_statuses[INCOME_STATEMENT_YEARLY_FILENAME_SUFFIX] = "reused_cached_same_day"
        else:
            pause_for_network(request_pause_seconds)
            income_statement_yearly = normalize_statement_dataframe(ticker.income_stmt)
            dataset_statuses[INCOME_STATEMENT_YEARLY_FILENAME_SUFFIX] = "downloaded"

        if cached_statement_paths[INCOME_STATEMENT_QUARTERLY_FILENAME_SUFFIX] and is_same_utc_run_day(
            cached_statement_paths[INCOME_STATEMENT_QUARTERLY_FILENAME_SUFFIX], run_timestamp
        ):
            income_statement_quarterly = strip_run_metadata(
                load_cached_dataframe(
                    cached_statement_paths[INCOME_STATEMENT_QUARTERLY_FILENAME_SUFFIX]
                )
            )
            dataset_statuses[INCOME_STATEMENT_QUARTERLY_FILENAME_SUFFIX] = "reused_cached_same_day"
        else:
            pause_for_network(request_pause_seconds)
            income_statement_quarterly = normalize_statement_dataframe(ticker.quarterly_income_stmt)
            dataset_statuses[INCOME_STATEMENT_QUARTERLY_FILENAME_SUFFIX] = "downloaded"

        if cached_statement_paths[BALANCE_SHEET_YEARLY_FILENAME_SUFFIX] and is_same_utc_run_day(
            cached_statement_paths[BALANCE_SHEET_YEARLY_FILENAME_SUFFIX], run_timestamp
        ):
            balance_sheet_yearly = strip_run_metadata(
                load_cached_dataframe(
                    cached_statement_paths[BALANCE_SHEET_YEARLY_FILENAME_SUFFIX]
                )
            )
            dataset_statuses[BALANCE_SHEET_YEARLY_FILENAME_SUFFIX] = "reused_cached_same_day"
        else:
            pause_for_network(request_pause_seconds)
            balance_sheet_yearly = normalize_statement_dataframe(ticker.balance_sheet)
            dataset_statuses[BALANCE_SHEET_YEARLY_FILENAME_SUFFIX] = "downloaded"

        if cached_statement_paths[BALANCE_SHEET_QUARTERLY_FILENAME_SUFFIX] and is_same_utc_run_day(
            cached_statement_paths[BALANCE_SHEET_QUARTERLY_FILENAME_SUFFIX], run_timestamp
        ):
            balance_sheet_quarterly = strip_run_metadata(
                load_cached_dataframe(
                    cached_statement_paths[BALANCE_SHEET_QUARTERLY_FILENAME_SUFFIX]
                )
            )
            dataset_statuses[BALANCE_SHEET_QUARTERLY_FILENAME_SUFFIX] = "reused_cached_same_day"
        else:
            pause_for_network(request_pause_seconds)
            balance_sheet_quarterly = normalize_statement_dataframe(ticker.quarterly_balance_sheet)
            dataset_statuses[BALANCE_SHEET_QUARTERLY_FILENAME_SUFFIX] = "downloaded"

        if cached_statement_paths[CASHFLOW_YEARLY_FILENAME_SUFFIX] and is_same_utc_run_day(
            cached_statement_paths[CASHFLOW_YEARLY_FILENAME_SUFFIX], run_timestamp
        ):
            cashflow_yearly = strip_run_metadata(
                load_cached_dataframe(cached_statement_paths[CASHFLOW_YEARLY_FILENAME_SUFFIX])
            )
            dataset_statuses[CASHFLOW_YEARLY_FILENAME_SUFFIX] = "reused_cached_same_day"
        else:
            pause_for_network(request_pause_seconds)
            cashflow_yearly = normalize_statement_dataframe(
                first_available_frame((getattr(ticker, "cash_flow", None), ticker.cashflow))
            )
            dataset_statuses[CASHFLOW_YEARLY_FILENAME_SUFFIX] = "downloaded"

        if cached_statement_paths[CASHFLOW_QUARTERLY_FILENAME_SUFFIX] and is_same_utc_run_day(
            cached_statement_paths[CASHFLOW_QUARTERLY_FILENAME_SUFFIX], run_timestamp
        ):
            cashflow_quarterly = strip_run_metadata(
                load_cached_dataframe(cached_statement_paths[CASHFLOW_QUARTERLY_FILENAME_SUFFIX])
            )
            dataset_statuses[CASHFLOW_QUARTERLY_FILENAME_SUFFIX] = "reused_cached_same_day"
        else:
            pause_for_network(request_pause_seconds)
            cashflow_quarterly = normalize_statement_dataframe(
                first_available_frame(
                    (
                        getattr(ticker, "quarterly_cash_flow", None),
                        getattr(ticker, "quarterly_cashflow", None),
                    )
                )
            )
            dataset_statuses[CASHFLOW_QUARTERLY_FILENAME_SUFFIX] = "downloaded"

    all_expiries = tuple() if history_only else tuple(ticker.options or ())
    weekly_options = bool(source_metadata.get("screen_query") == "cboe_weekly") or has_weekly_options(all_expiries)
    selected_expiries: dict[str, str] = {}
    option_outputs: dict[str, str] = {}
    option_frames: list[pd.DataFrame] = []
    cached_option_paths = {
        "current": latest_archived_ticker_dataset_path(
            symbol,
            CURRENT_WEEK_OPTIONS_FILENAME_SUFFIX,
            history_dir,
            allow_trailing_tokens=True,
        ),
        "next_week": latest_archived_ticker_dataset_path(
            symbol,
            NEXT_WEEK_OPTIONS_FILENAME_SUFFIX,
            history_dir,
            allow_trailing_tokens=True,
        ),
    }

    cached_option_frames: dict[str, pd.DataFrame] = {}
    for label, cached_path in cached_option_paths.items():
        if cached_path is None or not is_same_utc_run_day(cached_path, run_timestamp):
            continue
        cached_frame = load_cached_dataframe(cached_path)
        if cached_frame.empty:
            continue
        refreshed_frame = refresh_run_metadata(cached_frame, run_timestamp, symbol)
        cached_option_frames[label] = refreshed_frame
        if "expiry" in refreshed_frame.columns:
            option_outputs[label] = str(refreshed_frame["expiry"].iloc[0])

    if history_only:
        dataset_statuses[OPTIONS_FILENAME_SUFFIX] = "not_applicable_history_only"
    elif len(cached_option_frames) == 2:
        option_frames = list(cached_option_frames.values())
        dataset_statuses[OPTIONS_FILENAME_SUFFIX] = "reused_cached_same_day"
    else:
        selected_expiries = select_option_expiries(all_expiries)
        for label, expiry in selected_expiries.items():
            if label in cached_option_frames:
                options_df = cached_option_frames[label]
            else:
                try:
                    pause_for_network(request_pause_seconds)
                    chain = ticker.option_chain(expiry)
                except Exception as exc:  # pragma: no cover
                    LOGGER.warning(
                        "Option chain download failed for %s %s (%s): %s",
                        symbol,
                        label,
                        expiry,
                        exc,
                    )
                    continue

                options_df = combine_option_chain(
                    symbol=symbol,
                    chain=chain,
                    expiry=expiry,
                    label=label,
                    run_timestamp=run_timestamp,
                    current_price=current_price,
                )
                if options_df.empty:
                    continue

            option_outputs[label] = expiry
            option_frames.append(options_df)
        dataset_statuses[OPTIONS_FILENAME_SUFFIX] = (
            "downloaded"
            if selected_expiries
            else "no_options_available"
        )

    for label, options_df in (
        ("current", next((frame for frame in option_frames if not frame.empty and frame["option_snapshot_label"].iloc[0] == "current"), None)),
        ("next_week", next((frame for frame in option_frames if not frame.empty and frame["option_snapshot_label"].iloc[0] == "next_week"), None)),
    ):
        if options_df is None:
            continue
        expiry = str(options_df["expiry"].iloc[0])
        suffix = (
            CURRENT_WEEK_OPTIONS_FILENAME_SUFFIX
            if label == "current"
            else NEXT_WEEK_OPTIONS_FILENAME_SUFFIX
        )
        write_csv(
            options_df,
            ticker_dir / ticker_filename(run_timestamp, suffix, expiry=expiry),
        )

    refreshed_equity_row = build_equity_fundamentals_row(
        symbol=symbol,
        run_timestamp=run_timestamp,
        info=info,
        fast_info=fast_info,
        income_statement=income_statement_yearly,
        cashflow=cashflow_yearly,
        current_price=current_price,
        source_metadata=source_metadata,
        selected_expiries=option_outputs,
        weekly_options=weekly_options,
    )
    equity_row = (
        merge_prefer_non_null(cached_equity_row, refreshed_equity_row)
        if cached_equity_row
        else refreshed_equity_row
    )
    equity_row["downloaded_on"] = run_timestamp
    equity_row["symbol"] = symbol
    equity_row["screen_query"] = source_metadata.get("screen_query")
    equity_df = pd.DataFrame([equity_row])
    write_csv(
        equity_df,
        ticker_dir / ticker_filename(run_timestamp, EQUITY_FUNDAMENTALS_FILENAME_SUFFIX),
    )

    datasets: dict[str, pd.DataFrame] = {
        EQUITY_FUNDAMENTALS_FILENAME_SUFFIX: equity_df
    }

    if previous_history_path is None:
        history_output = normalize_dataframe(history.reset_index())
    if not history_output.empty:
        history_output = refresh_run_metadata(history_output, run_timestamp, symbol)
        write_csv(
            history_output,
            ticker_dir / ticker_filename(run_timestamp, PRICE_HISTORY_FILENAME_SUFFIX),
        )
        datasets[PRICE_HISTORY_FILENAME_SUFFIX] = history_output

    if not intraday_history.empty and intraday_interval:
        intraday_output = refresh_run_metadata(
            normalize_dataframe(intraday_history.reset_index()),
            run_timestamp,
            symbol,
        )
        intraday_output.insert(2, "history_interval", intraday_interval)
        write_csv(
            intraday_output,
            ticker_dir / ticker_filename(run_timestamp, PRICE_HISTORY_TODAY_FILENAME_SUFFIX),
        )
        datasets[PRICE_HISTORY_TODAY_FILENAME_SUFFIX] = intraday_output

    if not income_statement_yearly.empty:
        income_statement_output = refresh_run_metadata(
            income_statement_yearly, run_timestamp, symbol
        )
        write_csv(
            income_statement_output,
            ticker_dir
            / ticker_filename(run_timestamp, INCOME_STATEMENT_YEARLY_FILENAME_SUFFIX),
        )
        datasets[INCOME_STATEMENT_YEARLY_FILENAME_SUFFIX] = income_statement_output

    if not income_statement_quarterly.empty:
        income_statement_quarterly_output = refresh_run_metadata(
            income_statement_quarterly, run_timestamp, symbol
        )
        write_csv(
            income_statement_quarterly_output,
            ticker_dir
            / ticker_filename(run_timestamp, INCOME_STATEMENT_QUARTERLY_FILENAME_SUFFIX),
        )
        datasets[INCOME_STATEMENT_QUARTERLY_FILENAME_SUFFIX] = (
            income_statement_quarterly_output
        )

    if not balance_sheet_yearly.empty:
        balance_sheet_output = refresh_run_metadata(
            balance_sheet_yearly, run_timestamp, symbol
        )
        write_csv(
            balance_sheet_output,
            ticker_dir / ticker_filename(run_timestamp, BALANCE_SHEET_YEARLY_FILENAME_SUFFIX),
        )
        datasets[BALANCE_SHEET_YEARLY_FILENAME_SUFFIX] = balance_sheet_output

    if not balance_sheet_quarterly.empty:
        balance_sheet_quarterly_output = refresh_run_metadata(
            balance_sheet_quarterly, run_timestamp, symbol
        )
        write_csv(
            balance_sheet_quarterly_output,
            ticker_dir
            / ticker_filename(run_timestamp, BALANCE_SHEET_QUARTERLY_FILENAME_SUFFIX),
        )
        datasets[BALANCE_SHEET_QUARTERLY_FILENAME_SUFFIX] = balance_sheet_quarterly_output

    if not cashflow_yearly.empty:
        cashflow_output = refresh_run_metadata(cashflow_yearly, run_timestamp, symbol)
        write_csv(
            cashflow_output,
            ticker_dir / ticker_filename(run_timestamp, CASHFLOW_YEARLY_FILENAME_SUFFIX),
        )
        datasets[CASHFLOW_YEARLY_FILENAME_SUFFIX] = cashflow_output

    if not cashflow_quarterly.empty:
        cashflow_quarterly_output = refresh_run_metadata(
            cashflow_quarterly, run_timestamp, symbol
        )
        write_csv(
            cashflow_quarterly_output,
            ticker_dir / ticker_filename(run_timestamp, CASHFLOW_QUARTERLY_FILENAME_SUFFIX),
        )
        datasets[CASHFLOW_QUARTERLY_FILENAME_SUFFIX] = cashflow_quarterly_output

    if option_frames:
        datasets[OPTIONS_FILENAME_SUFFIX] = normalize_dataframe(
            pd.concat(option_frames, ignore_index=True, sort=False)
        )

    write_symbol_status_manifest(
        ticker_dir=ticker_dir,
        run_timestamp=run_timestamp,
        symbol=symbol,
        status="downloaded",
        dataset_statuses=dataset_statuses,
        metadata={
            "yahoo_symbol": yahoo_symbol,
            "history_only": history_only,
            "is_etf": bool(source_metadata.get("is_etf")),
        },
    )

    return {
        "symbol": symbol,
        "current_price": format_number(current_price),
        "equity_row": equity_row,
        "current_expiry": option_outputs.get("current"),
        "next_week_expiry": option_outputs.get("next_week"),
        "datasets": datasets,
        "dataset_statuses": dataset_statuses,
    }


def missing_required_dataset_suffixes(
    data_dir: Path, symbol: str, required_suffixes: Iterable[str] = REQUIRED_DATASET_SUFFIXES
) -> list[str]:
    ticker_dir = data_dir / symbol.upper()
    return [
        suffix
        for suffix in required_suffixes
        if latest_file_matching(ticker_dir, suffix) is None
    ]


def attempt_symbol_download(
    *,
    candidate: dict[str, Any],
    context: dict[str, Any],
    attempt_count: int,
) -> SymbolDownloadAttempt:
    symbol = candidate["symbol"]
    ticker_dir = context["data_dir"] / symbol
    ticker_dir.mkdir(parents=True, exist_ok=True)
    try:
        payload = run_with_symbol_timeout(
            int(context["symbol_timeout_seconds"]),
            fetch_ticker_payload,
            symbol=symbol,
            run_timestamp=context["run_timestamp"],
            data_dir=context["data_dir"],
            history_dir=context["history_dir"],
            min_price=context["min_price"],
            history_period=context["history_period"],
            source_metadata=candidate,
            request_pause_seconds=float(context["request_pause_seconds"]),
        )
    except Exception as exc:  # pragma: no cover
        LOGGER.exception("Failed to download %s: %s", symbol, exc)
        write_symbol_status_manifest(
            ticker_dir=ticker_dir,
            run_timestamp=context["run_timestamp"],
            symbol=symbol,
            status="error",
            dataset_statuses={},
            error=str(exc),
            metadata={
                "yahoo_symbol": candidate.get("yahoo_symbol") or yahoo_symbol_for(symbol),
                "history_only": bool(candidate.get("history_only")),
                "is_etf": bool(candidate.get("is_etf")),
            },
        )
        return SymbolDownloadAttempt(
            symbol=symbol,
            status="error",
            payload=None,
            error=str(exc),
            attempt_count=attempt_count,
        )

    if payload is None:
        write_symbol_status_manifest(
            ticker_dir=ticker_dir,
            run_timestamp=context["run_timestamp"],
            symbol=symbol,
            status="skipped",
            dataset_statuses={},
            error="Missing price or below min-price filter",
            metadata={
                "yahoo_symbol": candidate.get("yahoo_symbol") or yahoo_symbol_for(symbol),
                "history_only": bool(candidate.get("history_only")),
                "is_etf": bool(candidate.get("is_etf")),
            },
        )
        return SymbolDownloadAttempt(
            symbol=symbol,
            status="skipped",
            payload=None,
            error="Missing price or below min-price filter",
            attempt_count=attempt_count,
        )

    missing_files = missing_required_dataset_suffixes(
        context["data_dir"], symbol, required_dataset_suffixes_for_candidate(candidate)
    )
    if missing_files:
        return SymbolDownloadAttempt(
            symbol=symbol,
            status="incomplete",
            payload=payload,
            error=f"Missing required datasets: {', '.join(missing_files)}",
            attempt_count=attempt_count,
        )

    return SymbolDownloadAttempt(
        symbol=symbol,
        status="downloaded",
        payload=payload,
        error=None,
        attempt_count=attempt_count,
    )


def manifest_row_for_attempt(
    *,
    run_timestamp: str,
    candidate: dict[str, Any],
    attempt: SymbolDownloadAttempt,
) -> dict[str, Any]:
    payload = attempt.payload or {}
    dataset_statuses = payload.get("dataset_statuses") or {}
    return {
        "downloaded_on": run_timestamp,
        "symbol": attempt.symbol,
        "status": attempt.status,
        "error": attempt.error,
        "attempt_count": attempt.attempt_count,
        "screen_query": candidate.get("screen_query"),
        "exchange": candidate.get("exchange"),
        "security_name": candidate.get("security_name"),
        "is_etf": candidate.get("is_etf"),
        "etf": candidate.get("is_etf"),
        "yahoo_symbol": candidate.get("yahoo_symbol"),
        "history_only": candidate.get("history_only"),
        "current_price": payload.get("current_price"),
        "current_expiry": payload.get("current_expiry"),
        "next_week_expiry": payload.get("next_week_expiry"),
        "price_history_status": dataset_statuses.get("price_history"),
        "intraday_status": dataset_statuses.get("price_history_today"),
        "options_status": dataset_statuses.get(OPTIONS_FILENAME_SUFFIX),
        "equity_info_status": dataset_statuses.get("equity_info"),
    }


def dataset_names_for_combine() -> tuple[str, ...]:
    return (
        EQUITY_FUNDAMENTALS_FILENAME_SUFFIX,
        PRICE_HISTORY_FILENAME_SUFFIX,
        PRICE_HISTORY_TODAY_FILENAME_SUFFIX,
        INCOME_STATEMENT_YEARLY_FILENAME_SUFFIX,
        INCOME_STATEMENT_QUARTERLY_FILENAME_SUFFIX,
        BALANCE_SHEET_YEARLY_FILENAME_SUFFIX,
        BALANCE_SHEET_QUARTERLY_FILENAME_SUFFIX,
        CASHFLOW_YEARLY_FILENAME_SUFFIX,
        CASHFLOW_QUARTERLY_FILENAME_SUFFIX,
        OPTIONS_FILENAME_SUFFIX,
    )


def load_current_combined_datasets(
    data_dir: Path,
    symbols: Iterable[str] | None = None,
) -> dict[str, list[pd.DataFrame]]:
    selected_symbols = {symbol.upper() for symbol in symbols} if symbols is not None else None
    datasets: dict[str, list[pd.DataFrame]] = {}
    for ticker_dir in sorted(entry for entry in data_dir.iterdir() if entry.is_dir() and not entry.name.startswith(".")):
        symbol = ticker_dir.name.upper()
        if selected_symbols is not None and symbol not in selected_symbols:
            continue
        for dataset_name in dataset_names_for_combine():
            if dataset_name == OPTIONS_FILENAME_SUFFIX:
                option_paths = [
                    latest_file_matching(
                        ticker_dir,
                        CURRENT_WEEK_OPTIONS_FILENAME_SUFFIX,
                        allow_trailing_tokens=True,
                    ),
                    latest_file_matching(
                        ticker_dir,
                        NEXT_WEEK_OPTIONS_FILENAME_SUFFIX,
                        allow_trailing_tokens=True,
                    ),
                ]
                for path in option_paths:
                    if path is None or not path.exists():
                        continue
                    dataframe = pd.read_csv(path)
                    append_dataset(datasets, dataset_name, dataframe)
                continue

            path = latest_file_matching(ticker_dir, dataset_name)
            if path is None or not path.exists():
                continue
            dataframe = pd.read_csv(path)
            append_dataset(datasets, dataset_name, dataframe)
    return datasets


def enrich_current_snapshot_files(
    *,
    config: DownloadConfig,
    data_dir: Path,
    history_dir: Path,
    run_timestamp: str,
    candidates: list[dict[str, Any]],
    downloaded_symbols: list[str],
) -> dict[str, Path | None]:
    if not downloaded_symbols:
        return {
            "weekly_universe_csv": None,
            "signal_snapshots_csv": None,
            "short_interest_csv": None,
            "filing_signals_csv": None,
            "macro_signals_csv": None,
            "social_signals_csv": None,
            "provider_status_csv": None,
        }

    provider_status_rows: list[dict[str, Any]] = []
    all_signals: list[dict[str, Any]] = []

    weekly_universe_df = latest_weekly_universe_frame(candidates, run_timestamp)
    weekly_universe_csv = write_output_dataset(
        data_dir=data_dir,
        run_timestamp=run_timestamp,
        dataset_suffix=WEEKLY_UNIVERSE_FILENAME_SUFFIX,
        dataframe=weekly_universe_df,
    )

    macro_provider = PublicMacroSnapshotProvider()
    try:
        macro_df, macro_signals = macro_provider.fetch()
        provider_status_rows.append(
            {"provider": "macro", "status": "success", "records": len(macro_df)}
        )
    except Exception as exc:  # pragma: no cover
        LOGGER.warning("Macro enrichment failed: %s", exc)
        macro_df, macro_signals = pd.DataFrame(), []
        provider_status_rows.append(
            {"provider": "macro", "status": "error", "records": 0, "error": str(exc)}
        )
    all_signals.extend(macro_signals)

    downloaded_set = set(downloaded_symbols)

    finra_provider = FinraShortInterestCsvProvider()
    try:
        short_interest_df, short_interest_signals = finra_provider.fetch(downloaded_set)
        provider_status_rows.append(
            {
                "provider": "finra_short_interest",
                "status": "success",
                "records": len(short_interest_df),
            }
        )
    except Exception as exc:  # pragma: no cover
        LOGGER.warning("FINRA short-interest enrichment failed: %s", exc)
        short_interest_df, short_interest_signals = pd.DataFrame(), []
        provider_status_rows.append(
            {
                "provider": "finra_short_interest",
                "status": "error",
                "records": 0,
                "error": str(exc),
            }
        )
    all_signals.extend(short_interest_signals)

    filings_provider = SecEdgarFilingsProvider()
    try:
        filings_df, filing_signals = filings_provider.fetch(downloaded_set)
        provider_status_rows.append(
            {"provider": "sec_filings", "status": "success", "records": len(filings_df)}
        )
    except Exception as exc:  # pragma: no cover
        LOGGER.warning("SEC filing enrichment failed: %s", exc)
        filings_df, filing_signals = pd.DataFrame(), []
        provider_status_rows.append(
            {"provider": "sec_filings", "status": "error", "records": 0, "error": str(exc)}
        )
    all_signals.extend(filing_signals)

    ftd_provider = SecFtdSignalProvider()
    try:
        ftd_df, ftd_signals = ftd_provider.fetch(downloaded_set)
        provider_status_rows.append(
            {"provider": "sec_ftd", "status": "success", "records": len(ftd_df)}
        )
    except Exception as exc:  # pragma: no cover
        LOGGER.warning("SEC FTD enrichment failed: %s", exc)
        ftd_df, ftd_signals = pd.DataFrame(), []
        provider_status_rows.append(
            {"provider": "sec_ftd", "status": "error", "records": 0, "error": str(exc)}
        )
    all_signals.extend(ftd_signals)

    radar_provider = SecLitigationRadarProvider()
    try:
        litigation_df, litigation_signals = radar_provider.fetch(downloaded_set)
        provider_status_rows.append(
            {"provider": "sec_litigation_rss", "status": "success", "records": len(litigation_df)}
        )
    except Exception as exc:  # pragma: no cover
        LOGGER.warning("SEC litigation RSS enrichment failed: %s", exc)
        litigation_df, litigation_signals = pd.DataFrame(), []
        provider_status_rows.append(
            {
                "provider": "sec_litigation_rss",
                "status": "error",
                "records": 0,
                "error": str(exc),
            }
        )
    all_signals.extend(litigation_signals)

    social_provider = OptionalSocialSentimentProvider()
    social_df, social_signals = social_provider.fetch(downloaded_set)
    provider_status_rows.append(
        {"provider": "optional_social", "status": "unavailable", "records": len(social_df)}
    )
    all_signals.extend(social_signals)

    short_interest_lookup = {
        str(row["symbol"]).upper(): row for row in short_interest_df.to_dict(orient="records")
    }
    filings_lookup = {
        str(row["ticker"]).upper(): row for row in filings_df.to_dict(orient="records")
    }
    ftd_lookup = {str(row["ticker"]).upper(): row for row in ftd_df.to_dict(orient="records")}
    litigation_lookup = {
        str(row["ticker"]).upper(): row for row in litigation_df.to_dict(orient="records")
    }
    risk_free_rate = None
    macro_as_of_date = date.today().isoformat()
    if not macro_df.empty:
        risk_free_rate = safe_float(macro_df.iloc[0].get("risk_free_rate_annual"))
        macro_as_of_date = str(macro_df.iloc[0].get("as_of_date") or macro_as_of_date)

    for symbol in downloaded_symbols:
        ticker_dir = data_dir / symbol.upper()
        equity_path = latest_file_matching(ticker_dir, EQUITY_FUNDAMENTALS_FILENAME_SUFFIX)
        if equity_path is None or not equity_path.exists():
            continue
        equity_df = pd.read_csv(equity_path)
        if equity_df.empty:
            continue
        equity_row = equity_df.iloc[0].to_dict()
        current_price = safe_float(equity_row.get("current_price"))
        float_shares = safe_float(equity_row.get("float_shares") or equity_row.get("shares_outstanding"))

        current_option_path = latest_file_matching(
            ticker_dir,
            CURRENT_WEEK_OPTIONS_FILENAME_SUFFIX,
            allow_trailing_tokens=True,
        )
        next_week_option_path = latest_file_matching(
            ticker_dir,
            NEXT_WEEK_OPTIONS_FILENAME_SUFFIX,
            allow_trailing_tokens=True,
        )
        current_option_frame = pd.DataFrame()
        for option_path in (current_option_path, next_week_option_path):
            if option_path is None or not option_path.exists():
                continue
            option_frame = pd.read_csv(option_path)
            option_frame = enrich_option_metrics_frame(
                option_frame,
                underlying_price=current_price,
                risk_free_rate=risk_free_rate,
                as_of_date=macro_as_of_date,
            )
            write_csv(option_frame, option_path)
            if option_path == current_option_path:
                current_option_frame = option_frame

        current_iv = current_atm_iv(current_option_frame, current_price)
        trailing_iv = historical_atm_iv_series(symbol, history_dir)
        iv_percentile_value, iv_observation_count = iv_percentile(current_iv, trailing_iv)
        equity_row["iv_current_atm"] = format_number(current_iv)
        equity_row["iv_percentile_252d"] = format_number(iv_percentile_value)
        equity_row["iv_percentile_observations"] = iv_observation_count
        if current_iv is not None:
            all_signals.append(
                {
                    "ticker": symbol,
                    "signal_group": "options",
                    "signal_name": "iv_current_atm",
                    "signal_value": current_iv,
                    "signal_text": None,
                    "as_of_date": macro_as_of_date,
                    "retrieved_at": datetime.now(UTC).replace(microsecond=0).isoformat(),
                    "source_name": "Yahoo option chain",
                    "source_url": "",
                    "reliability_class": "derived_free",
                    "license_class": "derived",
                    "confidence": 0.82,
                    "raw_payload_ref": str(current_option_path) if current_option_path else None,
                    "status": "available",
                }
            )
        if iv_percentile_value is not None:
            all_signals.append(
                {
                    "ticker": symbol,
                    "signal_group": "options",
                    "signal_name": "iv_percentile_252d",
                    "signal_value": iv_percentile_value,
                    "signal_text": None,
                    "as_of_date": macro_as_of_date,
                    "retrieved_at": datetime.now(UTC).replace(microsecond=0).isoformat(),
                    "source_name": "Polytheta derived IV percentile",
                    "source_url": "",
                    "reliability_class": "derived_free",
                    "license_class": "derived",
                    "confidence": 0.8,
                    "raw_payload_ref": str(current_option_path) if current_option_path else None,
                    "status": "available",
                }
            )

        short_interest_row = short_interest_lookup.get(symbol.upper())
        if short_interest_row:
            equity_row["short_interest_shares"] = format_number(
                short_interest_row.get("current_short_position_quantity")
            )
            equity_row["days_to_cover"] = format_number(
                short_interest_row.get("days_to_cover_quantity")
            )
            equity_row["short_interest_settlement_date"] = short_interest_row.get("settlement_date")
            if float_shares and short_interest_row.get("current_short_position_quantity") is not None:
                short_interest_pct = (
                    float(short_interest_row["current_short_position_quantity"]) / float_shares
                ) * 100.0
                equity_row["short_interest_pct_float"] = format_number(short_interest_pct)
                all_signals.append(
                    {
                        "ticker": symbol,
                        "signal_group": "short_interest",
                        "signal_name": "short_interest_pct_float",
                        "signal_value": round(short_interest_pct, 2),
                        "signal_text": None,
                        "as_of_date": short_interest_row.get("settlement_date"),
                        "retrieved_at": datetime.now(UTC).replace(microsecond=0).isoformat(),
                        "source_name": "FINRA + float shares",
                        "source_url": short_interest_row.get("source_url") or "",
                        "reliability_class": "authoritative_free",
                        "license_class": "official_free",
                        "confidence": 0.9,
                        "raw_payload_ref": short_interest_row.get("source_url") or "",
                        "status": "available",
                    }
                )

        filing_row = filings_lookup.get(symbol.upper())
        if filing_row:
            equity_row["buyback_score"] = filing_row.get("buyback_score")
            equity_row["acquisition_radar_flag"] = filing_row.get("acquisition_radar_flag")
            equity_row["downside_gap_radar_flag"] = filing_row.get("downside_gap_radar_flag")
            equity_row["filing_evidence_url"] = filing_row.get("evidence_url")
            equity_row["filing_forms_reviewed"] = filing_row.get("forms_reviewed")

        ftd_row = ftd_lookup.get(symbol.upper())
        if ftd_row:
            equity_row["ftd_spike_ratio"] = format_number(ftd_row.get("ftd_spike_ratio"))
            equity_row["latest_ftd_quantity"] = format_number(ftd_row.get("latest_ftd_quantity"))

        litigation_row = litigation_lookup.get(symbol.upper())
        if litigation_row:
            equity_row["sec_litigation_rss_match"] = True

        refreshed_equity_df = pd.DataFrame([equity_row])
        write_csv(refreshed_equity_df, equity_path)

    signal_snapshots_df = pd.DataFrame(all_signals)
    provider_status_df = pd.DataFrame(provider_status_rows)

    return {
        "weekly_universe_csv": weekly_universe_csv,
        "signal_snapshots_csv": write_output_dataset(
            data_dir=data_dir,
            run_timestamp=run_timestamp,
            dataset_suffix=SIGNAL_SNAPSHOTS_FILENAME_SUFFIX,
            dataframe=signal_snapshots_df,
        ),
        "short_interest_csv": write_output_dataset(
            data_dir=data_dir,
            run_timestamp=run_timestamp,
            dataset_suffix=SHORT_INTEREST_SIGNALS_FILENAME_SUFFIX,
            dataframe=short_interest_df,
        ),
        "filing_signals_csv": write_output_dataset(
            data_dir=data_dir,
            run_timestamp=run_timestamp,
            dataset_suffix=FILING_SIGNALS_FILENAME_SUFFIX,
            dataframe=filings_df,
        ),
        "macro_signals_csv": write_output_dataset(
            data_dir=data_dir,
            run_timestamp=run_timestamp,
            dataset_suffix=MACRO_SIGNALS_FILENAME_SUFFIX,
            dataframe=macro_df,
        ),
        "social_signals_csv": write_output_dataset(
            data_dir=data_dir,
            run_timestamp=run_timestamp,
            dataset_suffix=SOCIAL_SIGNALS_FILENAME_SUFFIX,
            dataframe=pd.concat(
                [frame for frame in (ftd_df, litigation_df, social_df) if not frame.empty],
                ignore_index=True,
                sort=False,
            )
            if any(not frame.empty for frame in (ftd_df, litigation_df, social_df))
            else pd.DataFrame(),
        ),
        "provider_status_csv": write_output_dataset(
            data_dir=data_dir,
            run_timestamp=run_timestamp,
            dataset_suffix=PROVIDER_STATUS_FILENAME_SUFFIX,
            dataframe=provider_status_df,
        ),
    }


def write_run_level_outputs(
    *,
    data_dir: Path,
    run_timestamp: str,
    combined_datasets: dict[str, list[pd.DataFrame]],
) -> Path | None:
    consolidated_csv: Path | None = None
    for dataset_name, frames in combined_datasets.items():
        prepared_frames = []
        for frame in frames:
            if frame.empty:
                continue
            prepared = frame.loc[:, ~frame.isna().all(axis=0)].copy()
            if dataset_name in STATEMENT_DATASET_SUFFIXES:
                prepared = reshape_statement_for_combined_export(prepared)
            prepared_frames.append(prepared)
        if not prepared_frames:
            continue
        combined_df = pd.concat(prepared_frames, ignore_index=True, sort=False)
        if dataset_name in STATEMENT_DATASET_SUFFIXES:
            combined_df = combined_df.sort_values(
                by=["symbol", "line_item", "period_index", "period_end"]
            )
        elif "symbol" in combined_df.columns:
            combined_df = combined_df.sort_values(by=["symbol"])
        output_path = data_dir / combined_filename(run_timestamp, dataset_name)
        write_csv(combined_df, output_path)
        write_json_records(combined_df, output_path.with_suffix(".json"))
        if dataset_name == EQUITY_FUNDAMENTALS_FILENAME_SUFFIX:
            consolidated_csv = output_path
    return consolidated_csv


def run_download(config: DownloadConfig) -> DownloadResult:
    project_root = config.project_root.resolve()
    data_dir, history_dir = ensure_data_directories(project_root)
    run_timestamp = run_timestamp_label()
    rotated_to = None if config.missing_only else rotate_current_data(data_dir, history_dir, run_timestamp)

    if config.tickers:
        candidates = [
            {"symbol": ticker, "screen_query": "manual", "exchange": None}
            for ticker in config.tickers
        ]
    else:
        candidates = discover_symbols(
            config.min_price,
            config.max_tickers,
            screener_queries=config.screener_queries,
            symbol_source=config.symbol_source,
        )
    if config.include_cboe_weekly_indexes and not config.tickers:
        candidates = extend_with_index_overrides(
            candidates,
            max_tickers=config.max_tickers,
        )
    if config.missing_only:
        candidates = filter_candidates_missing_only(candidates, data_dir)
    candidates = candidates[: config.max_tickers]
    candidate_by_symbol = {candidate["symbol"]: candidate for candidate in candidates}
    context = {
        "run_timestamp": run_timestamp,
        "data_dir": data_dir,
        "history_dir": history_dir,
        "min_price": config.min_price,
        "history_period": config.history_period,
        "symbol_timeout_seconds": config.symbol_timeout_seconds,
        "request_pause_seconds": config.request_pause_seconds,
    }

    configure_request_pause_seconds(config.request_pause_seconds)

    attempts_by_symbol: dict[str, SymbolDownloadAttempt] = {}
    manifest_rows_by_symbol: dict[str, dict[str, Any]] = {}
    attempt_counts: dict[str, int] = {}
    payloads_by_symbol: dict[str, dict[str, Any]] = {}

    for candidate in candidates:
        symbol = candidate["symbol"]
        attempt_counts[symbol] = attempt_counts.get(symbol, 0) + 1
        LOGGER.info("Downloading %s", symbol)
        attempt = attempt_symbol_download(
            candidate=candidate,
            context=context,
            attempt_count=attempt_counts[symbol],
        )
        attempts_by_symbol[symbol] = attempt
        if attempt.payload is not None:
            payloads_by_symbol[symbol] = attempt.payload
        manifest_rows_by_symbol[symbol] = manifest_row_for_attempt(
            run_timestamp=run_timestamp,
            candidate=candidate,
            attempt=attempt,
        )
        pause_for_network(config.ticker_pause_seconds)

    expected_symbols = [candidate["symbol"] for candidate in candidates]
    for retry_round in range(1, 4):
        missing_symbols = [
            symbol
            for symbol in expected_symbols
            if attempts_by_symbol.get(symbol) is None
            or attempts_by_symbol[symbol].status in {"error", "incomplete"}
        ]
        if not missing_symbols:
            break
        LOGGER.warning(
            "Retry round %s: redownloading %s missing or incomplete symbols before combine.",
            retry_round,
            len(missing_symbols),
        )
        for symbol in missing_symbols:
            candidate = candidate_by_symbol[symbol]
            attempt_counts[symbol] = attempt_counts.get(symbol, 0) + 1
            attempt = attempt_symbol_download(
                candidate=candidate,
                context=context,
                attempt_count=attempt_counts[symbol],
            )
            attempts_by_symbol[symbol] = attempt
            if attempt.payload is not None:
                payloads_by_symbol[symbol] = attempt.payload
            elif symbol in payloads_by_symbol:
                payloads_by_symbol.pop(symbol, None)
            manifest_rows_by_symbol[symbol] = manifest_row_for_attempt(
                run_timestamp=run_timestamp,
                candidate=candidate,
                attempt=attempt,
            )
            pause_for_network(config.ticker_pause_seconds)

    downloaded_symbols = sorted(
        symbol for symbol, attempt in attempts_by_symbol.items() if attempt.status == "downloaded"
    )
    skipped_symbols = sorted(
        symbol for symbol, attempt in attempts_by_symbol.items() if attempt.status != "downloaded"
    )
    enrichment_outputs = enrich_current_snapshot_files(
        config=config,
        data_dir=data_dir,
        history_dir=history_dir,
        run_timestamp=run_timestamp,
        candidates=candidates,
        downloaded_symbols=downloaded_symbols,
    )
    symbols_for_combine = [
        entry.name
        for entry in data_dir.iterdir()
        if entry.is_dir() and not entry.name.startswith(".") and ticker_dir_has_any_files(data_dir, entry.name)
    ]
    combined_datasets = load_current_combined_datasets(data_dir, symbols_for_combine)
    consolidated_csv = write_run_level_outputs(
        data_dir=data_dir,
        run_timestamp=run_timestamp,
        combined_datasets=combined_datasets,
    )

    manifest_df = pd.DataFrame(
        [manifest_rows_by_symbol[symbol] for symbol in sorted(manifest_rows_by_symbol)]
    )
    manifest_csv = data_dir / ticker_filename(run_timestamp, MANIFEST_FILENAME_SUFFIX)
    write_csv(manifest_df, manifest_csv)

    download_result = DownloadResult(
        run_timestamp=run_timestamp,
        rotated_to=rotated_to,
        downloaded_symbols=downloaded_symbols,
        skipped_symbols=skipped_symbols,
        consolidated_csv=consolidated_csv,
        manifest_csv=manifest_csv,
        signal_snapshots_csv=enrichment_outputs.get("signal_snapshots_csv"),
        macro_signals_csv=enrichment_outputs.get("macro_signals_csv"),
    )
    download_result.verification_report = verify_download_completeness(
        config=config,
        result=download_result,
    )
    return download_result


def list_current_tickers(project_root: str | Path | None = None) -> list[str]:
    root = find_project_root(project_root)
    data_dir, _ = ensure_data_directories(root)
    return sorted(
        entry.name
        for entry in data_dir.iterdir()
        if entry.is_dir() and not entry.name.startswith(".")
    )


def list_history_runs(project_root: str | Path | None = None) -> list[str]:
    root = find_project_root(project_root)
    _, history_dir = ensure_data_directories(root)
    return sorted(
        entry.name
        for entry in history_dir.iterdir()
        if entry.is_dir() and not entry.name.startswith(".")
    )


def list_files_for_ticker(
    ticker: str,
    project_root: str | Path | None = None,
    include_history: bool = False,
) -> list[str]:
    root = find_project_root(project_root)
    data_dir, history_dir = ensure_data_directories(root)
    symbol = ticker.upper()
    paths: list[Path] = []

    current_dir = data_dir / symbol
    if current_dir.exists():
        paths.extend(sorted(current_dir.glob("*.csv")))

    if include_history:
        for run_dir in sorted(history_dir.iterdir()):
            historical_dir = run_dir / symbol
            if historical_dir.exists():
                paths.extend(sorted(historical_dir.glob("*.csv")))

    return [str(path) for path in paths]


def latest_file_matching(
    directory: Path,
    suffix_fragment: str,
    *,
    allow_trailing_tokens: bool = False,
) -> Path | None:
    matcher = (
        suffix_with_trailing_token_matches if allow_trailing_tokens else exact_suffix_matches
    )
    matches = sorted(
        path
        for path in directory.glob("*.csv")
        if matcher(path.stem, suffix_fragment)
    )
    return matches[-1] if matches else None


def ticker_dir_has_any_files(data_dir: Path, symbol: str) -> bool:
    ticker_dir = data_dir / symbol.upper()
    if not ticker_dir.exists():
        return False
    return any(path.is_file() for path in ticker_dir.iterdir())


def filter_candidates_missing_only(
    candidates: list[dict[str, Any]], data_dir: Path
) -> list[dict[str, Any]]:
    return [
        candidate
        for candidate in candidates
        if not ticker_dir_has_any_files(data_dir, candidate["symbol"])
    ]


def run_with_symbol_timeout(timeout_seconds: int, func, /, *args, **kwargs):
    if timeout_seconds <= 0:
        return func(*args, **kwargs)

    previous_handler = signal.getsignal(signal.SIGALRM)

    def _handle_timeout(signum, frame):  # pragma: no cover
        raise SymbolDownloadTimeoutError(
            f"Symbol download exceeded {timeout_seconds} seconds."
        )

    signal.signal(signal.SIGALRM, _handle_timeout)
    signal.setitimer(signal.ITIMER_REAL, timeout_seconds)
    try:
        return func(*args, **kwargs)
    finally:
        signal.setitimer(signal.ITIMER_REAL, 0)
        signal.signal(signal.SIGALRM, previous_handler)


def latest_archived_ticker_dataset_path(
    ticker: str,
    dataset_suffix: str,
    history_dir: Path,
    *,
    allow_trailing_tokens: bool = False,
) -> Path | None:
    symbol = ticker.upper()
    for run_dir in sorted(
        (entry for entry in history_dir.iterdir() if entry.is_dir() and not entry.name.startswith(".")),
        key=lambda entry: entry.name,
        reverse=True,
    ):
        ticker_dir = run_dir / symbol
        if not ticker_dir.exists():
            continue
        match = latest_file_matching(
            ticker_dir, dataset_suffix, allow_trailing_tokens=allow_trailing_tokens
        )
        if match is not None:
            return match
    return None


def latest_ticker_dataset_path(
    ticker: str,
    dataset: str,
    project_root: str | Path | None = None,
) -> Path | None:
    root = find_project_root(project_root)
    data_dir, _ = ensure_data_directories(root)
    ticker_dir = data_dir / ticker.upper()
    if not ticker_dir.exists():
        return None

    patterns = {
        "quote": EQUITY_FUNDAMENTALS_FILENAME_SUFFIX,
        "fundamentals": EQUITY_FUNDAMENTALS_FILENAME_SUFFIX,
        "price_history": PRICE_HISTORY_FILENAME_SUFFIX,
        "price_history_today": PRICE_HISTORY_TODAY_FILENAME_SUFFIX,
        "income_statement": INCOME_STATEMENT_YEARLY_FILENAME_SUFFIX,
        "income_statement_yearly": INCOME_STATEMENT_YEARLY_FILENAME_SUFFIX,
        "income_statement_quarterly": INCOME_STATEMENT_QUARTERLY_FILENAME_SUFFIX,
        "balance_sheet": BALANCE_SHEET_YEARLY_FILENAME_SUFFIX,
        "balance_sheet_yearly": BALANCE_SHEET_YEARLY_FILENAME_SUFFIX,
        "balance_sheet_quarterly": BALANCE_SHEET_QUARTERLY_FILENAME_SUFFIX,
        "cashflow": CASHFLOW_YEARLY_FILENAME_SUFFIX,
        "cashflow_yearly": CASHFLOW_YEARLY_FILENAME_SUFFIX,
        "cashflow_quarterly": CASHFLOW_QUARTERLY_FILENAME_SUFFIX,
        "options": OPTIONS_FILENAME_SUFFIX,
        "options_current": CURRENT_WEEK_OPTIONS_FILENAME_SUFFIX,
        "options_next_week": NEXT_WEEK_OPTIONS_FILENAME_SUFFIX,
    }

    suffix = patterns.get(dataset)
    if not suffix:
        raise ValueError(f"Unsupported dataset: {dataset}")

    return latest_file_matching(
        ticker_dir,
        suffix,
        allow_trailing_tokens=dataset in {"options_current", "options_next_week"},
    )


def latest_consolidated_path(project_root: str | Path | None = None) -> Path | None:
    root = find_project_root(project_root)
    data_dir, _ = ensure_data_directories(root)
    return latest_file_matching(
        data_dir, combined_dataset_output_name(EQUITY_FUNDAMENTALS_FILENAME_SUFFIX)
    )


def latest_manifest_path(project_root: str | Path | None = None) -> Path | None:
    root = find_project_root(project_root)
    data_dir, _ = ensure_data_directories(root)
    return latest_file_matching(data_dir, MANIFEST_FILENAME_SUFFIX)


def latest_verification_report_path(project_root: str | Path | None = None) -> Path | None:
    root = find_project_root(project_root)
    data_dir, _ = ensure_data_directories(root)
    return latest_file_matching(data_dir, "download_verification")


def expected_symbols_for_config(config: DownloadConfig) -> list[str]:
    if config.tickers:
        return list(config.tickers)
    data_dir, _ = ensure_data_directories(config.project_root.resolve())
    candidates = discover_symbols(
        min_price=config.min_price,
        max_tickers=config.max_tickers,
        screener_queries=config.screener_queries,
        symbol_source=config.symbol_source,
    )
    if config.missing_only:
        candidates = filter_candidates_missing_only(candidates, data_dir)
    return [candidate["symbol"] for candidate in candidates[: config.max_tickers]]


def expected_candidates_for_verification(config: DownloadConfig) -> list[dict[str, Any]]:
    if config.tickers:
        return [
            {
                "symbol": ticker,
                "screen_query": "manual",
                "exchange": None,
                "yahoo_symbol": yahoo_symbol_for(ticker),
                "history_only": is_history_only_symbol(ticker),
            }
            for ticker in config.tickers
        ]
    return discover_symbols(
        min_price=config.min_price,
        max_tickers=config.max_tickers,
        screener_queries=config.screener_queries,
        symbol_source=config.symbol_source,
    )[: config.max_tickers]


def current_snapshot_symbols(data_dir: Path) -> set[str]:
    return {
        entry.name.upper()
        for entry in data_dir.iterdir()
        if entry.is_dir() and not entry.name.startswith(".") and ticker_dir_has_any_files(data_dir, entry.name)
    }


def latest_symbol_status_manifest(data_dir: Path, symbol: str) -> dict[str, Any]:
    ticker_dir = data_dir / symbol.upper()
    path = None
    matches = sorted(
        candidate
        for candidate in ticker_dir.glob("*.json")
        if exact_suffix_matches(candidate.stem, DATASET_MANIFEST_FILENAME_SUFFIX)
    )
    if matches:
        path = matches[-1]
    if path is None or not path.exists():
        return {}
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return {}


def verify_download_completeness(
    *,
    config: DownloadConfig,
    result: DownloadResult,
) -> Path:
    project_root = config.project_root.resolve()
    data_dir, _ = ensure_data_directories(project_root)
    expected_candidates = expected_candidates_for_verification(config)
    expected_symbols = [candidate["symbol"] for candidate in expected_candidates]
    expected_set = set(expected_symbols)
    expected_candidate_by_symbol = {
        candidate["symbol"]: candidate for candidate in expected_candidates
    }

    manifest_df = pd.DataFrame()
    if result.manifest_csv.exists():
        try:
            manifest_df = pd.read_csv(result.manifest_csv)
        except pd.errors.EmptyDataError:
            manifest_df = pd.DataFrame()
    attempted_symbols = set()
    downloaded_symbols = set()
    skipped_symbols = set()
    error_symbols = set()
    if not manifest_df.empty and "symbol" in manifest_df.columns:
        attempted_symbols = set(manifest_df["symbol"].dropna().astype(str))
        downloaded_symbols = set(
            manifest_df.loc[manifest_df["status"] == "downloaded", "symbol"]
            .dropna()
            .astype(str)
        )
        skipped_symbols = set(
            manifest_df.loc[manifest_df["status"] == "skipped", "symbol"]
            .dropna()
            .astype(str)
        )
        error_symbols = set(
            manifest_df.loc[manifest_df["status"] == "error", "symbol"]
            .dropna()
            .astype(str)
        )

    missing_from_manifest = sorted(expected_set - attempted_symbols)
    snapshot_symbols = current_snapshot_symbols(data_dir)
    current_missing_symbols = sorted(expected_set - snapshot_symbols)
    current_missing_required_files: dict[str, list[str]] = {}
    current_skipped_symbols: list[str] = []
    current_error_symbols: list[str] = []
    current_downloaded_symbols: set[str] = set()

    for symbol in sorted(snapshot_symbols & expected_set):
        status_manifest = latest_symbol_status_manifest(data_dir, symbol)
        current_status = str(status_manifest.get("status") or "").strip().lower()
        if current_status == "skipped":
            current_skipped_symbols.append(symbol)
            continue
        if current_status == "error":
            current_error_symbols.append(symbol)
            continue

        metadata = status_manifest.get("metadata") or {}
        symbol_history_only = bool(
            metadata.get("history_only")
            or expected_candidate_by_symbol.get(symbol, {}).get("history_only")
        )
        symbol_is_etf = bool(
            metadata.get("is_etf")
            or expected_candidate_by_symbol.get(symbol, {}).get("is_etf")
            or expected_candidate_by_symbol.get(symbol, {}).get("etf")
        )
        required_suffixes = required_dataset_suffixes_for_candidate(
            {"history_only": symbol_history_only, "is_etf": symbol_is_etf}
        )
        missing = missing_required_dataset_suffixes(data_dir, symbol, required_suffixes)
        if missing:
            current_missing_required_files[symbol] = missing
            continue
        current_downloaded_symbols.add(symbol)

    combined_equity_path = data_dir / combined_filename(
        result.run_timestamp, EQUITY_FUNDAMENTALS_FILENAME_SUFFIX
    )
    combined_equity_symbols: list[str] = []
    if combined_equity_path.exists():
        combined_equity_df = pd.read_csv(combined_equity_path)
        if "symbol" in combined_equity_df.columns:
            combined_equity_symbols = sorted(
                combined_equity_df["symbol"].dropna().astype(str).unique().tolist()
            )

    report = {
        "run_timestamp": result.run_timestamp,
        "project_root": str(project_root),
        "symbol_source": config.symbol_source,
        "min_price": config.min_price,
        "max_tickers": config.max_tickers,
        "expected_symbol_count": len(expected_symbols),
        "attempted_symbol_count": len(attempted_symbols),
        "downloaded_symbol_count": len(downloaded_symbols),
        "skipped_symbol_count": len(skipped_symbols),
        "error_symbol_count": len(error_symbols),
        "missing_from_manifest_count": len(missing_from_manifest),
        "missing_required_file_count": len(current_missing_required_files),
        "current_snapshot_symbol_count": len(snapshot_symbols),
        "current_downloaded_symbol_count": len(current_downloaded_symbols),
        "current_skipped_symbol_count": len(current_skipped_symbols),
        "current_error_symbol_count": len(current_error_symbols),
        "current_missing_symbol_count": len(current_missing_symbols),
        "combined_equity_symbol_count": len(combined_equity_symbols),
        "missing_from_manifest": missing_from_manifest,
        "error_symbols": sorted(error_symbols),
        "current_missing_symbols": current_missing_symbols,
        "current_skipped_symbols": current_skipped_symbols,
        "current_error_symbols": current_error_symbols,
        "missing_required_files": current_missing_required_files,
        "combined_equity_missing_symbols": sorted(
            current_downloaded_symbols - set(combined_equity_symbols)
        ),
        "complete": (
            not current_missing_symbols
            and not current_error_symbols
            and not current_missing_required_files
        ),
    }
    output_path = data_dir / json_filename(
        ticker_filename(result.run_timestamp, "download_verification")
    )
    output_path.write_text(json.dumps(report, ensure_ascii=True, indent=2), encoding="utf-8")
    return output_path


def read_csv_preview(path: Path, rows: int = 20) -> list[dict[str, Any]]:
    if not path.exists():
        raise FileNotFoundError(path)
    df = pd.read_csv(path)
    preview = df.head(max(rows, 1)).fillna(value=pd.NA)
    return [
        {key: as_scalar(value) for key, value in record.items()}
        for record in preview.to_dict(orient="records")
    ]
