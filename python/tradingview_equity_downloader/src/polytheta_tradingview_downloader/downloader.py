from __future__ import annotations

import csv
import json
import logging
import re
import shutil
import time
from dataclasses import dataclass
from datetime import UTC, datetime
from html.parser import HTMLParser
from pathlib import Path
from typing import Any
from urllib.request import Request, urlopen

import pandas as pd
import rookiepy
from tradingview_screener import Query, col

LOGGER = logging.getLogger(__name__)

CSV_FILENAME_SUFFIX = "tradingview_equities"
OPTIONS_CSV_FILENAME_SUFFIX = "tradingview_options"
CALCULATED_CSV_FILENAME_SUFFIX = "tradingview_calculated_fields"
MANIFEST_FILENAME_SUFFIX = "tradingview_manifest"
VERIFICATION_FILENAME_SUFFIX = "tradingview_verification"
FIELDS_CACHE_FILENAME = "tradingview_stock_fields.json"
OPTION_FIELDS_CACHE_FILENAME = "tradingview_option_fields.json"
STOCK_FIELDS_URL = "https://shner-elmo.github.io/TradingView-Screener/fields/stocks.html"
OPTION_FIELDS_URL = "https://shner-elmo.github.io/TradingView-Screener/fields/options.html"
CBOE_WEEKLYS_URL = "https://www.cboe.com/markets/us/options/symbol-directory/weeklys-options"
CBOE_WEEKLYS_DOWNLOAD_URL = "https://www.cboe.com/us/options/symboldir/weeklys-options/download/"
DEFAULT_COLUMN_BATCH_SIZE = 125
DEFAULT_OPTION_EXPIRATIONS = 2
DEFAULT_OPTION_STRIKE_DISTANCE_PCT = 30.0
OPTION_REQUEST_DELAY_SECONDS = 0.2
DEFAULT_REQUEST_PAUSE_SECONDS = 0.5
OPTION_RATE_LIMIT_RETRY_DELAYS = (15.0, 30.0, 60.0)
SCAN_RATE_LIMIT_RETRY_DELAYS = (15.0, 30.0, 60.0)
RESOLVER_BATCH_SIZE = 1000
TARGET_TICKER_BATCH_SIZE = 250
CBOE_WEEKLY_EXTRA_TICKERS = ("SP:SPX", "CBOE:VIX")
WEEKLY_CANDIDATE_EXCHANGES = ("NASDAQ", "NYSE", "AMEX", "CBOE", "ARCA", "BATS")
OPTION_EXPORT_FIELDS = (
    "type",
    "is_primary",
    "active_symbol",
    "change",
    "change_abs",
    "close",
    "volume",
    "Perf.All",
    "change_from_open",
    "change_from_open_abs",
    "exchange",
    "submarket",
    "currency",
    "ask",
    "bid",
    "bid_ask_spread_pct",
    "days_to_maturity",
    "description",
    "expiration",
    "market",
    "maturity_date",
    "name",
    "option-type",
    "strike",
    "subtype",
    "update_mode",
    "volume_change",
    "volume_change_abs",
    "base_currency_kind",
    "currency_id",
    "currency_kind",
    "fractional",
    "is_blacklisted",
    "is_symbol_primary_listing",
    "kind",
    "pricescale",
    "typespecs",
)
CORE_EQUITY_COLUMNS = (
    "downloaded_on",
    "ticker",
    "symbol",
    "name",
    "description",
    "exchange",
    "market",
    "country",
    "sector",
    "industry",
    "type",
    "subtype",
    "is_primary",
    "is_etf",
    "currency",
    "close",
    "change",
    "change_abs",
    "change_from_open",
    "change_from_open_abs",
    "volume",
    "Value.Traded",
    "market_cap_basic",
    "number_of_employees",
    "price_earnings_ttm",
    "price_sales_current",
    "price_book_fq",
    "dividend_yield_recent",
    "earnings_per_share_diluted_ttm",
    "earnings_per_share_basic_ttm",
    "earnings_release_next_date",
    "earnings_release_next_trading_date",
    "earnings_release_next_trading_date_fq",
    "revenue_ttm",
    "gross_margin",
    "operating_margin",
    "return_on_equity_fq",
    "return_on_assets_fq",
    "debt_to_equity",
    "current_ratio",
    "free_cash_flow",
    "AnalystRating",
    "Recommend.All",
    "Perf.1M",
    "Perf.3M",
    "Perf.6M",
    "Perf.Y",
    "price_52_week_high",
    "price_52_week_low",
    "average_volume_10d_calc",
    "average_volume_30d_calc",
    "average_volume_60d_calc",
    "average_volume_90d_calc",
)
CORE_OPTION_COLUMNS = (
    "downloaded_on",
    "underlying_ticker",
    "underlying_symbol",
    "underlying_close",
    "option_ticker",
    "name",
    "description",
    "option_type",
    "expiration",
    "maturity_date",
    "days_to_maturity",
    "strike",
    "close",
    "bid",
    "ask",
    "bid_ask_spread_pct",
    "volume",
    "exchange",
    "market",
    "currency",
    "type",
    "subtype",
)
IDENTIFIER_COLUMNS = (
    "downloaded_on",
    "ticker",
    "symbol",
    "name",
    "description",
    "exchange",
    "market",
    "country",
    "sector",
    "industry",
    "type",
    "subtype",
    "is_primary",
    "is_etf",
    "currency",
    "close",
)
RESOLVER_COLUMNS = (
    "symbol",
    "exchange",
    "market",
    "name",
    "type",
)
CALCULATED_FIELD_PREFIXES = (
    "adr",
    "adrp",
    "adx",
    "ao",
    "aroon",
    "bb",
    "bbpower",
    "candle",
    "candlestick",
    "chaikin",
    "cci",
    "chop",
    "donch",
    "ema",
    "hull",
    "ichimoku",
    "klt",
    "macd",
    "mom",
    "pivot",
    "rec",
    "rsi",
    "sma",
    "stoch",
    "supertrend",
    "trix",
    "uo",
    "ultimate_oscillator",
    "vwap",
    "w_r",
    "williams",
)


@dataclass(slots=True)
class DownloadConfig:
    project_root: Path
    min_price: float
    batch_size: int = 500
    max_records: int = 0
    column_batch_size: int = DEFAULT_COLUMN_BATCH_SIZE
    option_expirations: int = DEFAULT_OPTION_EXPIRATIONS
    option_strike_distance_pct: float = DEFAULT_OPTION_STRIKE_DISTANCE_PCT
    ticker_pause_seconds: float = OPTION_REQUEST_DELAY_SECONDS
    request_pause_seconds: float = DEFAULT_REQUEST_PAUSE_SECONDS
    include_calculated_fields: bool = False
    skip_calculated_fields: bool = False
    target_tickers: tuple[str, ...] | None = None
    extra_tickers: tuple[str, ...] = ("SP:SPX", "CBOE:VIX")
    browser: str = "edge"
    market: str = "america"
    exchanges: tuple[str, ...] = ("NASDAQ", "NYSE", "AMEX")
    instrument_types: tuple[str, ...] = ("stock", "fund")


@dataclass(slots=True)
class DownloadResult:
    run_timestamp: str
    records_downloaded: int
    unique_symbols: int
    option_records_downloaded: int
    rotated_to: Path | None
    csv_output: Path
    options_csv_output: Path | None
    calculated_csv_output: Path | None
    json_output: Path
    options_json_output: Path | None
    calculated_json_output: Path | None
    manifest_csv: Path
    verification_report: Path


@dataclass(slots=True)
class VerificationResult:
    latest_csv: Path
    latest_manifest_csv: Path
    latest_verification_report: Path
    verification_output: Path
    expected_total_saved: int
    expected_total_live: int
    records_downloaded: int
    unique_tickers: int
    duplicate_ticker_rows: int
    page_rows_total: int
    is_complete_against_saved_total: bool
    matches_live_total: bool


class StockFieldCatalogParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.in_tbody = False
        self.in_tr = False
        self.in_td = False
        self.in_details = False
        self.in_summary = False
        self.in_li = False
        self.td_index = -1
        self.fields: list[str] = []
        self.row_first_column: list[str] = []
        self.current_data: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag == "tbody":
            self.in_tbody = True
        elif self.in_tbody and tag == "tr":
            self.in_tr = True
            self.td_index = -1
            self.row_first_column = []
        elif self.in_tr and tag == "td":
            self.in_td = True
            self.td_index += 1
            self.current_data = []
        elif self.in_td and tag == "details":
            self.in_details = True
        elif self.in_details and tag == "summary":
            self.in_summary = True
            self.current_data = []
        elif self.in_details and tag == "li":
            self.in_li = True
            self.current_data = []

    def handle_endtag(self, tag: str) -> None:
        if tag == "tbody":
            self.in_tbody = False
        elif tag == "tr" and self.in_tr:
            self.in_tr = False
            self.fields.extend(self.row_first_column)
        elif tag == "td" and self.in_td:
            if self.td_index == 0 and not self.in_details:
                text = " ".join(self.current_data).strip()
                if text:
                    self.row_first_column.append(text)
            self.in_td = False
            self.current_data = []
        elif tag == "details":
            self.in_details = False
        elif tag == "summary":
            text = " ".join(self.current_data).strip()
            if text:
                self.row_first_column.append(text)
            self.in_summary = False
            self.current_data = []
        elif tag == "li":
            text = " ".join(self.current_data).strip()
            if text:
                self.fields.append(text)
            self.in_li = False
            self.current_data = []

    def handle_data(self, data: str) -> None:
        if not self.in_tbody:
            return
        text = data.strip()
        if not text:
            return
        if self.in_summary or self.in_li or (self.in_td and self.td_index == 0 and not self.in_details):
            self.current_data.append(text)


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


def run_timestamp_label() -> str:
    return datetime.now(UTC).strftime("%Y-%m-%d %H-%M-%S")


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


def ensure_data_directory(project_root: Path) -> Path:
    data_dir = project_root / "data_trading_view"
    data_dir.mkdir(parents=True, exist_ok=True)
    (data_dir / ".gitkeep").touch(exist_ok=True)
    return data_dir


def ensure_history_directory(project_root: Path) -> Path:
    history_dir = project_root / "data_trading_view_history"
    history_dir.mkdir(parents=True, exist_ok=True)
    (history_dir / ".gitkeep").touch(exist_ok=True)
    return history_dir


def rotate_current_data(data_dir: Path, history_dir: Path, run_timestamp: str) -> Path | None:
    movable_paths = [path for path in data_dir.iterdir() if path.name != ".gitkeep"]
    if not movable_paths:
        return None

    rotation_dir = history_dir / run_timestamp
    rotation_dir.mkdir(parents=True, exist_ok=True)
    for path in movable_paths:
        shutil.move(str(path), str(rotation_dir / path.name))
    return rotation_dir


def stock_fields_cache_path(project_root: Path) -> Path:
    return ensure_history_directory(project_root) / FIELDS_CACHE_FILENAME


def option_fields_cache_path(project_root: Path) -> Path:
    return ensure_history_directory(project_root) / OPTION_FIELDS_CACHE_FILENAME


def fetch_field_catalog(url: str, *, request_pause_seconds: float = DEFAULT_REQUEST_PAUSE_SECONDS) -> tuple[str, ...]:
    request = Request(url, headers={"User-Agent": "Mozilla/5.0"})
    pause_for_request(request_pause_seconds)
    html = urlopen(request, timeout=20).read().decode("utf-8")
    parser = StockFieldCatalogParser()
    parser.feed(html)

    seen: set[str] = set()
    fields: list[str] = []
    for field in parser.fields:
        normalized = field.strip()
        if not normalized or normalized in seen:
            continue
        seen.add(normalized)
        fields.append(normalized)
    if not fields:
        raise RuntimeError(f"TradingView field catalog fetch returned no fields from {url}.")
    return tuple(fields)


def write_field_catalog_cache(path: Path, fields: tuple[str, ...]) -> None:
    with path.open("w", encoding="utf-8") as handle:
        json.dump({"source": "dynamic", "fields": list(fields)}, handle, indent=2)
        handle.write("\n")


def read_field_catalog_cache(path: Path) -> tuple[str, ...]:
    with path.open("r", encoding="utf-8") as handle:
        payload = json.load(handle)
    if not isinstance(payload, dict):
        raise ValueError(f"Invalid field catalog payload in {path}.")
    fields = payload.get("fields")
    if not isinstance(fields, list):
        raise ValueError(f"Invalid field catalog payload in {path}.")
    normalized = tuple(str(item) for item in fields if str(item).strip())
    if not normalized:
        raise ValueError(f"Field catalog cache {path} was empty.")
    return normalized


def load_stock_field_catalog(
    project_root: Path, *, request_pause_seconds: float = DEFAULT_REQUEST_PAUSE_SECONDS
) -> tuple[str, ...]:
    cache_path = stock_fields_cache_path(project_root)
    try:
        fields = fetch_field_catalog(
            STOCK_FIELDS_URL, request_pause_seconds=request_pause_seconds
        )
        write_field_catalog_cache(cache_path, fields)
        LOGGER.info("Loaded %s TradingView stock fields from %s", len(fields), STOCK_FIELDS_URL)
        return fields
    except Exception as exc:
        if cache_path.exists():
            fields = read_field_catalog_cache(cache_path)
            LOGGER.warning(
                "Falling back to cached TradingView stock field catalog (%s fields) after refresh failed: %s",
                len(fields),
                exc,
            )
            return fields
        raise RuntimeError(
            f"Unable to fetch TradingView stock field catalog from {STOCK_FIELDS_URL}"
        ) from exc


def load_option_field_catalog(
    project_root: Path, *, request_pause_seconds: float = DEFAULT_REQUEST_PAUSE_SECONDS
) -> tuple[str, ...]:
    cache_path = option_fields_cache_path(project_root)
    try:
        fields = fetch_field_catalog(
            OPTION_FIELDS_URL, request_pause_seconds=request_pause_seconds
        )
        write_field_catalog_cache(cache_path, fields)
        LOGGER.info(
            "Loaded %s TradingView option fields from %s", len(fields), OPTION_FIELDS_URL
        )
        return fields
    except Exception as exc:
        if cache_path.exists():
            fields = read_field_catalog_cache(cache_path)
            LOGGER.warning(
                "Falling back to cached TradingView option field catalog (%s fields) after refresh failed: %s",
                len(fields),
                exc,
            )
            return fields
        raise RuntimeError(
            f"Unable to fetch TradingView option field catalog from {OPTION_FIELDS_URL}"
        ) from exc


def fetch_cboe_weekly_symbols(
    request_pause_seconds: float = DEFAULT_REQUEST_PAUSE_SECONDS,
) -> tuple[str, ...]:
    request = Request(CBOE_WEEKLYS_DOWNLOAD_URL, headers={"User-Agent": "Mozilla/5.0"})
    try:
        pause_for_request(request_pause_seconds)
        payload = urlopen(request, timeout=30).read().decode("utf-8-sig")
    except Exception:
        payload = ""

    if payload:
        reader = csv.DictReader(payload.splitlines())
        seen: set[str] = set()
        symbols: list[str] = []
        for row in reader:
            symbol = str(row.get(" Stock Symbol") or row.get("Stock Symbol") or "").strip().upper()
            if not symbol or symbol in seen:
                continue
            seen.add(symbol)
            symbols.append(symbol)
        if symbols:
            return tuple(symbols)

    request = Request(CBOE_WEEKLYS_URL, headers={"User-Agent": "Mozilla/5.0"})
    pause_for_request(request_pause_seconds)
    html = urlopen(request, timeout=30).read().decode("utf-8")
    marker = "Name of Underlying Equity"
    start = html.find(marker)
    if start == -1:
        raise RuntimeError(f"Could not locate the Weeklys table on {CBOE_WEEKLYS_URL}.")
    tbody_start = html.find("<tbody", start)
    tbody_open_end = html.find(">", tbody_start)
    tbody_end = html.find("</tbody>", tbody_open_end)
    if tbody_start == -1 or tbody_open_end == -1 or tbody_end == -1:
        raise RuntimeError(f"Could not parse the Weeklys table on {CBOE_WEEKLYS_URL}.")
    section = html[tbody_open_end + 1 : tbody_end]
    raw_symbols = re.findall(r"/([A-Z0-9.\-]+)/quote_table", section)
    seen = set()
    symbols = []
    for symbol in raw_symbols:
        if symbol in seen:
            continue
        seen.add(symbol)
        symbols.append(symbol)
    if not symbols:
        raise RuntimeError(
            f"No symbols were parsed from {CBOE_WEEKLYS_DOWNLOAD_URL} or {CBOE_WEEKLYS_URL}."
        )
    return tuple(symbols)


def chunk_columns(columns: tuple[str, ...], chunk_size: int) -> list[tuple[str, ...]]:
    return [
        columns[index : index + chunk_size]
        for index in range(0, len(columns), chunk_size)
    ]


def parse_numeric(value: Any) -> float | None:
    normalized = normalize_scalar(value)
    if normalized is None:
        return None
    try:
        return float(normalized)
    except (TypeError, ValueError):
        return None


def parse_yyyymmdd(value: Any) -> str | None:
    if value in (None, ""):
        return None
    text = str(value)
    if len(text) != 8 or not text.isdigit():
        return None
    try:
        return datetime.strptime(text, "%Y%m%d").strftime("%Y-%m-%d")
    except ValueError:
        return None


def is_rate_limit_error(exc: Exception) -> bool:
    message = str(exc)
    return "429" in message or "Too Many Requests" in message


def pause_for_request(seconds: float) -> None:
    if seconds > 0:
        time.sleep(seconds)


def run_with_rate_limit_retries(
    operation,
    *,
    context: str,
    request_pause_seconds: float = 0.0,
    retry_delays: tuple[float, ...] = SCAN_RATE_LIMIT_RETRY_DELAYS,
):
    for attempt_index, retry_delay in enumerate((0.0, *retry_delays), start=1):
        if request_pause_seconds > 0:
            pause_for_request(request_pause_seconds)
        if retry_delay > 0:
            LOGGER.info(
                "TradingView rate limit backoff for %s: sleeping %.0fs before retry %s",
                context,
                retry_delay,
                attempt_index,
            )
            time.sleep(retry_delay)
        try:
            return operation()
        except Exception as exc:
            if not is_rate_limit_error(exc) or attempt_index == len(retry_delays) + 1:
                raise
    raise RuntimeError(f"Rate-limited operation for {context} exhausted retries.")


def normalize_indexes_value(value: Any) -> Any:
    if not isinstance(value, (list, tuple, set)):
        return value

    pronames: list[str] = []
    seen: set[str] = set()
    for item in value:
        if isinstance(item, dict):
            proname = str(item.get("proname") or "").strip()
            if proname and proname not in seen:
                seen.add(proname)
                pronames.append(proname)
    if pronames:
        return pronames
    return value


def exact_suffix_matches(stem: str, suffix: str) -> bool:
    return stem == suffix or stem.endswith(f"_{suffix}")


def latest_file_for_suffix(data_dir: Path, suffix: str, extension: str) -> Path:
    candidates = sorted(data_dir.glob(f"*_{suffix}.{extension}"))
    if not candidates:
        raise FileNotFoundError(
            f"Could not find any '*_{suffix}.{extension}' files in {data_dir}."
        )
    return candidates[-1]


def file_for_timestamp(data_dir: Path, run_timestamp: str, suffix: str, extension: str) -> Path:
    path = data_dir / f"{run_timestamp}_{suffix}.{extension}"
    if not path.exists():
        raise FileNotFoundError(f"Expected file {path} to exist.")
    return path


def browser_cookie_loader(browser: str):
    loaders = {
        "edge": rookiepy.edge,
        "chrome": rookiepy.chrome,
        "chromium": rookiepy.chromium,
        "brave": rookiepy.brave,
        "firefox": rookiepy.firefox,
        "safari": rookiepy.safari,
    }
    try:
        return loaders[browser]
    except KeyError as exc:
        raise ValueError(f"Unsupported browser '{browser}'.") from exc


def load_tradingview_cookies(browser: str) -> dict[str, str]:
    loader = browser_cookie_loader(browser)
    raw_cookies = loader(domains=["tradingview.com"])
    cookies = {
        cookie["name"]: cookie["value"]
        for cookie in raw_cookies
        if cookie.get("name") and cookie.get("value")
    }
    if not cookies:
        raise RuntimeError(
            "No TradingView cookies were found in the selected browser profile."
        )
    return cookies


def build_query(config: DownloadConfig, columns: tuple[str, ...] | None = None) -> Query:
    query = (
        Query()
        .set_markets(config.market)
        .set_property("ignore_unknown_fields", True)
        .where(
            col("close") >= config.min_price,
            col("exchange").isin(config.exchanges),
            col("type").isin(config.instrument_types),
        )
        .order_by("name", ascending=True)
        .limit(config.batch_size)
    )
    if columns:
        query = query.select(*columns)
    return query


def build_ticker_query(
    config: DownloadConfig,
    tickers: tuple[str, ...],
    columns: tuple[str, ...] | None = None,
) -> Query:
    query = (
        Query()
        .set_tickers(*tickers)
        .limit(max(len(tickers), 1))
        .set_property("range", [0, max(len(tickers), 1)])
    )
    if columns:
        query = query.select(*columns)
    return query


def build_symbol_resolver_query(config: DownloadConfig, columns: tuple[str, ...]) -> Query:
    return (
        Query()
        .set_markets(config.market)
        .set_property("ignore_unknown_fields", True)
        .where(
            col("close") >= 0,
            col("exchange").isin(config.exchanges),
            col("type").isin(config.instrument_types),
        )
        .order_by("symbol", ascending=True)
        .limit(RESOLVER_BATCH_SIZE)
        .select(*columns)
    )


def build_option_query(
    underlying_ticker: str,
    *,
    lower_strike: float,
    upper_strike: float,
    batch_size: int,
) -> Query:
    return (
        Query()
        .set_markets("options")
        .set_property("ignore_unknown_fields", True)
        .set_property(
            "index_filters",
            [{"name": "underlying_symbol", "values": [underlying_ticker]}],
        )
        .select(*OPTION_EXPORT_FIELDS)
        .where(
            col("strike").between(lower_strike, upper_strike),
        )
        .order_by("expiration", ascending=True)
        .limit(batch_size)
    )


def count_matching_records(config: DownloadConfig, cookies: dict[str, str]) -> int:
    query = build_query(config).copy().set_property("range", [0, 1])
    response = run_with_rate_limit_retries(
        lambda: query.get_scanner_data_raw(cookies=cookies),
        context="equity count",
        request_pause_seconds=config.request_pause_seconds,
    )
    return int(response.get("totalCount") or 0)


def normalize_scalar(value: Any) -> Any:
    if value is None:
        return None
    if isinstance(value, (list, tuple, set)):
        return "|".join(str(normalize_scalar(item)) for item in value if normalize_scalar(item) is not None)
    if isinstance(value, dict):
        return json.dumps(value, ensure_ascii=True, sort_keys=True)
    try:
        if pd.isna(value):
            return None
    except Exception:
        pass
    if hasattr(value, "item"):
        try:
            value = value.item()
        except Exception:
            pass
    if isinstance(value, float):
        rounded = round(value, 6)
        if rounded.is_integer():
            return int(rounded)
        return rounded
    return value


def to_snake_case(value: str) -> str:
    normalized = value.strip()
    normalized = normalized.replace("%", " pct ")
    normalized = normalized.replace("|", " ")
    normalized = normalized.replace(".", " ")
    normalized = normalized.replace("/", " ")
    normalized = normalized.replace("-", " ")
    normalized = re.sub(r"([a-z0-9])([A-Z])", r"\1_\2", normalized)
    normalized = re.sub(r"[^0-9a-zA-Z]+", "_", normalized)
    normalized = normalized.strip("_").lower()
    normalized = re.sub(r"_+", "_", normalized)
    return normalized


def snake_case_core_columns() -> tuple[str, ...]:
    return tuple(to_snake_case(column) for column in CORE_EQUITY_COLUMNS)


def snake_case_identifier_columns() -> tuple[str, ...]:
    return tuple(to_snake_case(column) for column in IDENTIFIER_COLUMNS)


def snake_case_option_core_columns() -> tuple[str, ...]:
    return tuple(to_snake_case(column) for column in CORE_OPTION_COLUMNS)


def is_calculated_field(field_name: str) -> bool:
    if field_name in {"downloaded_on", "ticker", "symbol", "name", "description", "exchange", "market", "country", "sector", "industry", "type", "subtype", "is_primary", "is_etf", "currency", "close"}:
        return False
    return field_name.startswith(CALCULATED_FIELD_PREFIXES)


def is_excluded_field(field_name: str) -> bool:
    if field_name.startswith("rates"):
        return True
    if field_name == "time":
        return True
    if field_name.startswith("gap") or "_gap" in field_name:
        return True
    if field_name.startswith("time_") or field_name.endswith("_time") or "_time_" in field_name:
        return True
    return False


def filter_stock_columns(
    columns: tuple[str, ...],
    *,
    include_calculated_fields: bool,
    skip_calculated_fields: bool,
) -> tuple[str, ...]:
    filtered: list[str] = []
    for column in columns:
        snake_key = to_snake_case(column)
        if not snake_key or is_excluded_field(snake_key):
            continue
        if skip_calculated_fields and is_calculated_field(snake_key):
            continue
        filtered.append(column)
    if include_calculated_fields:
        return tuple(filtered)
    return tuple(filtered)


def split_main_and_calculated_rows(
    rows: list[dict[str, Any]], *, include_calculated_fields: bool, skip_calculated_fields: bool
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    if include_calculated_fields or skip_calculated_fields:
        return rows, []

    main_rows: list[dict[str, Any]] = []
    calculated_rows: list[dict[str, Any]] = []
    identifier_columns = set(snake_case_identifier_columns())

    for row in rows:
        main_row: dict[str, Any] = {}
        calculated_row: dict[str, Any] = {}
        for key, value in row.items():
            if is_excluded_field(key):
                continue
            if key in identifier_columns:
                main_row[key] = value
                calculated_row[key] = value
                continue
            if is_calculated_field(key):
                calculated_row[key] = value
            else:
                main_row[key] = value
        main_rows.append(main_row)
        calculated_rows.append(calculated_row)

    return main_rows, calculated_rows


def normalize_row(row: dict[str, Any], run_timestamp: str) -> dict[str, Any]:
    ticker = str(row.get("ticker") or "")
    exchange, _, symbol = ticker.partition(":")
    base: dict[str, Any] = {
        "downloaded_on": run_timestamp,
        "ticker": ticker,
        "symbol": symbol or ticker,
    }
    normalized: dict[str, Any] = {}
    seen_keys: set[str] = set()
    for key, value in base.items():
        normalized[key] = normalize_scalar(value)
        seen_keys.add(key)
    for key, value in row.items():
        snake_key = to_snake_case(key)
        if not snake_key:
            continue
        if snake_key == "indexes":
            value = normalize_indexes_value(value)
        deduped_key = snake_key
        dedupe_index = 2
        while deduped_key in seen_keys and deduped_key not in {"ticker", "symbol", "downloaded_on"}:
            deduped_key = f"{snake_key}_{dedupe_index}"
            dedupe_index += 1
        normalized[deduped_key] = normalize_scalar(value)
        seen_keys.add(deduped_key)
    if not normalized.get("exchange"):
        normalized["exchange"] = exchange or row.get("exchange")
    asset_type = str(normalized.get("type") or "")
    normalized["is_etf"] = asset_type == "fund"
    return {key: normalize_scalar(value) for key, value in normalized.items()}


def normalize_option_row(
    underlying_ticker: str,
    underlying_close: float,
    record: dict[str, Any],
    run_timestamp: str,
) -> dict[str, Any]:
    values = list(record.get("d") or [])
    option_ticker = str(record.get("s") or "")
    base: dict[str, Any] = {
        "downloaded_on": run_timestamp,
        "underlying_ticker": underlying_ticker,
        "underlying_symbol": underlying_ticker.split(":", 1)[-1],
        "underlying_close": underlying_close,
        "option_ticker": option_ticker,
    }
    normalized: dict[str, Any] = {}
    seen_keys: set[str] = set()
    for key, value in base.items():
        normalized[key] = normalize_scalar(value)
        seen_keys.add(key)

    for raw_key, raw_value in zip(OPTION_EXPORT_FIELDS, values, strict=False):
        snake_key = to_snake_case(raw_key)
        if not snake_key or is_excluded_field(snake_key):
            continue
        value: Any = raw_value
        if snake_key in {"expiration", "maturity_date"}:
            parsed = parse_yyyymmdd(raw_value)
            value = parsed if parsed is not None else raw_value
        deduped_key = snake_key
        dedupe_index = 2
        while deduped_key in seen_keys:
            deduped_key = f"{snake_key}_{dedupe_index}"
            dedupe_index += 1
        normalized[deduped_key] = normalize_scalar(value)
        seen_keys.add(deduped_key)

    return {key: normalize_scalar(value) for key, value in normalized.items()}


def fetch_symbol_resolver_rows(
    config: DownloadConfig,
    cookies: dict[str, str],
) -> list[dict[str, Any]]:
    columns = RESOLVER_COLUMNS
    offset = 0
    total_count: int | None = None
    normalized_rows: list[dict[str, Any]] = []

    while True:
        page_end = offset + RESOLVER_BATCH_SIZE
        if total_count is not None:
            page_end = min(page_end, total_count)
        page_index = (offset // RESOLVER_BATCH_SIZE) + 1
        page_query = (
            build_symbol_resolver_query(config, columns)
            .copy()
            .set_property("range", [offset, page_end])
        )
        expected_total, frame = run_with_rate_limit_retries(
            lambda pq=page_query: pq.get_scanner_data(cookies=cookies),
            context=f"symbol resolver page {page_index}",
            request_pause_seconds=config.request_pause_seconds,
        )
        if total_count is None:
            total_count = int(expected_total)
        raw_records = frame.to_dict(orient="records")
        if not raw_records:
            break
        for record in raw_records:
            ticker = str(record.get("ticker") or "").strip()
            exchange, _, ticker_symbol = ticker.partition(":")
            raw_symbol = str(record.get("symbol") or "").strip()
            symbol = (raw_symbol or ticker_symbol).upper()
            normalized_rows.append(
                {
                    "ticker": ticker,
                    "symbol": symbol,
                    "exchange": str(record.get("exchange") or exchange).strip().upper(),
                    "market": normalize_scalar(record.get("market")),
                    "name": normalize_scalar(record.get("name")),
                    "type": normalize_scalar(record.get("type")),
                }
            )
        offset += len(raw_records)
        if offset >= total_count:
            break

    return normalized_rows


def build_candidate_tickers(
    symbols: tuple[str, ...],
    exchanges: tuple[str, ...],
    extras: tuple[str, ...] = CBOE_WEEKLY_EXTRA_TICKERS,
) -> tuple[str, ...]:
    seen: set[str] = set()
    candidates: list[str] = []
    for symbol in symbols:
        normalized_symbol = str(symbol).strip().upper()
        if not normalized_symbol:
            continue
        for exchange in exchanges:
            ticker = f"{exchange}:{normalized_symbol}"
            if ticker in seen:
                continue
            seen.add(ticker)
            candidates.append(ticker)
    for ticker in extras:
        normalized_ticker = str(ticker).strip().upper()
        if not normalized_ticker or normalized_ticker in seen:
            continue
        seen.add(normalized_ticker)
        candidates.append(normalized_ticker)
    return tuple(candidates)


def resolve_candidate_tickers(
    config: DownloadConfig,
    cookies: dict[str, str],
    symbols: tuple[str, ...],
) -> tuple[tuple[str, ...], tuple[str, ...]]:
    candidate_exchanges = tuple(
        dict.fromkeys([*config.exchanges, *WEEKLY_CANDIDATE_EXCHANGES])
    )
    candidate_tickers = build_candidate_tickers(symbols, candidate_exchanges)
    if not candidate_tickers:
        return (), symbols

    found_by_symbol: dict[str, list[str]] = {}
    for offset in range(0, len(candidate_tickers), TARGET_TICKER_BATCH_SIZE):
        ticker_batch = candidate_tickers[offset : offset + TARGET_TICKER_BATCH_SIZE]
        query = build_ticker_query(config, ticker_batch, columns=RESOLVER_COLUMNS)
        _, frame = run_with_rate_limit_retries(
            lambda q=query: q.get_scanner_data(cookies=cookies),
            context=f"weekly candidate ticker resolution batch {(offset // TARGET_TICKER_BATCH_SIZE) + 1}",
            request_pause_seconds=config.request_pause_seconds,
        )
        for record in frame.to_dict(orient="records"):
            ticker = str(record.get("ticker") or "").strip()
            if not ticker:
                continue
            _, _, ticker_symbol = ticker.partition(":")
            symbol = ticker_symbol.strip().upper()
            if not symbol:
                continue
            found_by_symbol.setdefault(symbol, []).append(ticker)

    exchange_priority = {"NASDAQ": 0, "NYSE": 1, "AMEX": 2, "CBOE": 3, "SP": 4}
    resolved: list[str] = []
    unresolved: list[str] = []
    seen_resolved: set[str] = set()
    for symbol in symbols:
        symbol_key = str(symbol).strip().upper()
        matches = found_by_symbol.get(symbol_key, [])
        if not matches:
            unresolved.append(symbol_key)
            continue
        matches.sort(
            key=lambda ticker: (
                exchange_priority.get(ticker.partition(":")[0], 99),
                ticker,
            )
        )
        chosen = matches[0]
        if chosen not in seen_resolved:
            seen_resolved.add(chosen)
            resolved.append(chosen)

    for extra in CBOE_WEEKLY_EXTRA_TICKERS:
        if extra not in seen_resolved:
            seen_resolved.add(extra)
            resolved.append(extra)
    return tuple(resolved), tuple(unresolved)


def resolve_symbols_to_tickers(
    symbols: tuple[str, ...],
    resolver_rows: list[dict[str, Any]],
) -> tuple[tuple[str, ...], tuple[str, ...]]:
    exchange_priority = {"NASDAQ": 0, "NYSE": 1, "AMEX": 2, "CBOE": 3, "SP": 4}
    grouped: dict[str, list[dict[str, Any]]] = {}
    for row in resolver_rows:
        symbol = str(row.get("symbol") or "").strip().upper()
        ticker = str(row.get("ticker") or "").strip()
        if not symbol or not ticker:
            continue
        grouped.setdefault(symbol, []).append(row)

    resolved: list[str] = []
    unresolved: list[str] = []
    for symbol in symbols:
        candidates = grouped.get(symbol.upper(), [])
        if not candidates:
            unresolved.append(symbol)
            continue
        candidates.sort(
            key=lambda row: (
                exchange_priority.get(str(row.get("exchange") or ""), 99),
                str(row.get("ticker") or ""),
            )
        )
        resolved.append(str(candidates[0].get("ticker") or ""))

    seen: set[str] = set()
    deduped_resolved: list[str] = []
    for ticker in [*resolved, *CBOE_WEEKLY_EXTRA_TICKERS]:
        if not ticker or ticker in seen:
            continue
        seen.add(ticker)
        deduped_resolved.append(ticker)
    return tuple(deduped_resolved), tuple(unresolved)


def fetch_pages(
    config: DownloadConfig, cookies: dict[str, str], run_timestamp: str
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], int]:
    all_columns = filter_stock_columns(
        load_stock_field_catalog(
            config.project_root, request_pause_seconds=config.request_pause_seconds
        ),
        include_calculated_fields=config.include_calculated_fields,
        skip_calculated_fields=config.skip_calculated_fields,
    )
    if config.target_tickers:
        rows = fetch_ticker_rows(
            config,
            cookies,
            run_timestamp,
            config.target_tickers,
            label="target TradingView tickers",
        )
        page_manifest = [
            {
                "downloaded_on": run_timestamp,
                "page_index": 1,
                "offset": 0,
                "batch_size": len(config.target_tickers),
                "rows_returned": len(rows),
                "expected_total": len(config.target_tickers),
                "field_count": len(all_columns),
                "field_chunk_count": len(chunk_columns(all_columns, config.column_batch_size)),
                "field_chunk_size": config.column_batch_size,
            }
        ]
        return rows, page_manifest, len(config.target_tickers)
    column_chunks = chunk_columns(all_columns, config.column_batch_size)
    offset = 0
    total_count: int | None = None
    page_manifests: list[dict[str, Any]] = []
    normalized_rows: list[dict[str, Any]] = []

    while True:
        page_end = offset + config.batch_size
        if total_count is not None:
            page_end = min(page_end, total_count)
        if config.max_records:
            page_end = min(page_end, config.max_records)
        page_index = (offset // config.batch_size) + 1
        chunk_frames: list[pd.DataFrame] = []
        expected_total_for_page: int | None = None
        for chunk_index, column_chunk in enumerate(column_chunks, start=1):
            page_query = (
                build_query(config, columns=column_chunk)
                .copy()
                .set_property("range", [offset, page_end])
            )
            expected_total, frame = run_with_rate_limit_retries(
                lambda pq=page_query: pq.get_scanner_data(cookies=cookies),
                context=f"equity page {page_index} chunk {chunk_index}",
                request_pause_seconds=config.request_pause_seconds,
            )
            if total_count is None:
                total_count = int(expected_total)
            if expected_total_for_page is None:
                expected_total_for_page = int(expected_total)
            chunk_frames.append(frame)
            LOGGER.debug(
                "Fetched TradingView chunk %s/%s for page offset=%s columns=%s rows=%s",
                chunk_index,
                len(column_chunks),
                offset,
                len(column_chunk),
                len(frame),
            )

        if not chunk_frames:
            break

        merged_frame = chunk_frames[0]
        for frame in chunk_frames[1:]:
            merged_frame = merged_frame.merge(frame, on="ticker", how="outer")

        raw_records = merged_frame.to_dict(orient="records")
        page_size = len(raw_records)
        page_manifests.append(
            {
                "downloaded_on": run_timestamp,
                "page_index": page_index,
                "offset": offset,
                "batch_size": config.batch_size,
                "rows_returned": page_size,
                "expected_total": total_count,
                "field_count": len(all_columns),
                "field_chunk_count": len(column_chunks),
                "field_chunk_size": config.column_batch_size,
            }
        )
        LOGGER.info(
            "Fetched TradingView page %s offset=%s rows=%s expected_total=%s field_count=%s chunks=%s",
            page_index,
            offset,
            page_size,
            total_count,
            len(all_columns),
            len(column_chunks),
        )
        if page_size == 0:
            break

        normalized_rows.extend(
            normalize_row(record, run_timestamp=run_timestamp) for record in raw_records
        )
        offset += page_size

        if config.max_records and len(normalized_rows) >= config.max_records:
            normalized_rows = normalized_rows[: config.max_records]
            break
        if offset >= total_count:
            break

    if total_count is None:
        total_count = 0
    return normalized_rows, page_manifests, total_count


def fetch_ticker_rows(
    config: DownloadConfig,
    cookies: dict[str, str],
    run_timestamp: str,
    tickers: tuple[str, ...],
    *,
    label: str,
) -> list[dict[str, Any]]:
    if not tickers:
        return []

    all_columns = filter_stock_columns(
        load_stock_field_catalog(
            config.project_root, request_pause_seconds=config.request_pause_seconds
        ),
        include_calculated_fields=config.include_calculated_fields,
        skip_calculated_fields=config.skip_calculated_fields,
    )
    column_chunks = chunk_columns(all_columns, config.column_batch_size)
    raw_records: list[dict[str, Any]] = []
    requested = set(tickers)

    for ticker_offset in range(0, len(tickers), TARGET_TICKER_BATCH_SIZE):
        ticker_batch = tickers[ticker_offset : ticker_offset + TARGET_TICKER_BATCH_SIZE]
        chunk_frames: list[pd.DataFrame] = []
        for chunk_index, column_chunk in enumerate(column_chunks, start=1):
            query = build_ticker_query(config, ticker_batch, columns=column_chunk)
            _, frame = run_with_rate_limit_retries(
                lambda q=query: q.get_scanner_data(cookies=cookies),
                context=(
                    f"{label} ticker batch {(ticker_offset // TARGET_TICKER_BATCH_SIZE) + 1} "
                    f"column chunk {chunk_index}"
                ),
                request_pause_seconds=config.request_pause_seconds,
            )
            chunk_frames.append(frame)
            LOGGER.debug(
                "Fetched %s ticker_batch=%s chunk %s/%s rows=%s columns=%s",
                label,
                (ticker_offset // TARGET_TICKER_BATCH_SIZE) + 1,
                chunk_index,
                len(column_chunks),
                len(frame),
                len(column_chunk),
            )

        if not chunk_frames:
            continue

        merged_frame = chunk_frames[0]
        for frame in chunk_frames[1:]:
            merged_frame = merged_frame.merge(frame, on="ticker", how="outer")

        raw_records.extend(
            record
            for record in merged_frame.to_dict(orient="records")
            if str(record.get("ticker") or "") in requested
        )

    LOGGER.info(
        "Fetched %s rows=%s requested=%s",
        label,
        len(raw_records),
        ",".join(tickers[:25]) + ("..." if len(tickers) > 25 else ""),
    )
    return [
        normalize_row(record, run_timestamp=run_timestamp) for record in raw_records
    ]


def fetch_explicit_tickers(
    config: DownloadConfig,
    cookies: dict[str, str],
    run_timestamp: str,
) -> list[dict[str, Any]]:
    return fetch_ticker_rows(
        config,
        cookies,
        run_timestamp,
        config.extra_tickers,
        label="explicit TradingView tickers",
    )


def fetch_options_for_underlying(
    *,
    config: DownloadConfig,
    cookies: dict[str, str],
    run_timestamp: str,
    underlying_ticker: str,
    underlying_close: float,
) -> list[dict[str, Any]]:
    lower_strike = max(0.0, underlying_close * (1.0 - (config.option_strike_distance_pct / 100.0)))
    upper_strike = underlying_close * (1.0 + (config.option_strike_distance_pct / 100.0))
    expiration_index = OPTION_EXPORT_FIELDS.index("expiration")
    offset = 0
    selected_rows: list[dict[str, Any]] = []
    distinct_expirations: list[int] = []
    max_allowed_expiration: int | None = None

    while True:
        page_query = (
            build_option_query(
                underlying_ticker,
                lower_strike=lower_strike,
                upper_strike=upper_strike,
                batch_size=config.batch_size,
            )
            .offset(offset)
            .limit(offset + config.batch_size)
        )
        payload = None
        payload = run_with_rate_limit_retries(
            lambda pq=page_query: pq.get_scanner_data_raw(cookies=cookies),
            context=f"options {underlying_ticker} offset {offset}",
            request_pause_seconds=config.request_pause_seconds,
            retry_delays=OPTION_RATE_LIMIT_RETRY_DELAYS,
        )
        if payload is None:
            break
        raw_records = list(payload.get("data") or [])
        if not raw_records:
            break

        stop_after_page = False
        for record in raw_records:
            values = list(record.get("d") or [])
            expiration_raw = (
                values[expiration_index]
                if expiration_index is not None and len(values) > expiration_index
                else None
            )
            expiration_value = int(expiration_raw) if expiration_raw not in (None, "") else None
            if expiration_value is not None and expiration_value not in distinct_expirations:
                distinct_expirations.append(expiration_value)
                distinct_expirations.sort()
                if len(distinct_expirations) >= config.option_expirations:
                    max_allowed_expiration = distinct_expirations[config.option_expirations - 1]
            if max_allowed_expiration is not None and expiration_value is not None and expiration_value > max_allowed_expiration:
                stop_after_page = True
                continue

            selected_rows.append(
                normalize_option_row(
                    underlying_ticker,
                    underlying_close,
                    record,
                    run_timestamp,
                )
            )

        if stop_after_page:
            break
        offset += len(raw_records)

    return selected_rows


def fetch_options_rows(
    config: DownloadConfig,
    cookies: dict[str, str],
    run_timestamp: str,
    equity_rows: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    if config.option_expirations <= 0:
        return []

    load_option_field_catalog(
        config.project_root, request_pause_seconds=config.request_pause_seconds
    )
    option_rows: list[dict[str, Any]] = []
    seen_underlyings: set[str] = set()

    total_underlyings = len(equity_rows)
    for index, row in enumerate(equity_rows, start=1):
        underlying_ticker = str(row.get("ticker") or "").strip()
        if not underlying_ticker or underlying_ticker in seen_underlyings:
            continue
        seen_underlyings.add(underlying_ticker)
        if index == 1 or index % 250 == 0:
            LOGGER.info(
                "TradingView options progress %s/%s underlyings processed",
                index,
                total_underlyings,
            )
        underlying_close = parse_numeric(row.get("close"))
        if underlying_close is None or underlying_close <= 0:
            continue
        try:
            rows = fetch_options_for_underlying(
                config=config,
                cookies=cookies,
                run_timestamp=run_timestamp,
                underlying_ticker=underlying_ticker,
                underlying_close=underlying_close,
            )
        except Exception as exc:
            LOGGER.warning("Skipping options for %s after TradingView options query failed: %s", underlying_ticker, exc)
        else:
            option_rows.extend(rows)
        finally:
            if config.ticker_pause_seconds > 0:
                time.sleep(config.ticker_pause_seconds)

    return option_rows


def ordered_fieldnames(
    rows: list[dict[str, Any]], preferred_order: tuple[str, ...] | None = None
) -> list[str]:
    fieldnames: list[str] = []
    seen: set[str] = set()
    for row in rows:
        for key in row:
            if key in seen:
                continue
            seen.add(key)
            fieldnames.append(key)

    if not preferred_order:
        return fieldnames

    ordered: list[str] = []
    remaining = set(fieldnames)
    for key in preferred_order:
        if key in remaining:
            ordered.append(key)
            remaining.remove(key)
    ordered.extend(sorted(remaining))
    return ordered


def write_csv(
    path: Path,
    rows: list[dict[str, Any]],
    *,
    preferred_order: tuple[str, ...] | None = None,
) -> None:
    fieldnames = ordered_fieldnames(rows, preferred_order=preferred_order)

    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)


def write_json(path: Path, payload: Any) -> None:
    with path.open("w", encoding="utf-8") as handle:
        json.dump(payload, handle, indent=2, ensure_ascii=True)
        handle.write("\n")


def build_verification_payload(
    run_timestamp: str,
    expected_total: int,
    rows: list[dict[str, Any]],
    page_manifests: list[dict[str, Any]],
    config: DownloadConfig,
    supplemental_rows: int = 0,
) -> dict[str, Any]:
    unique_tickers = {str(row.get("ticker") or "") for row in rows if row.get("ticker")}
    duplicate_count = len(rows) - len(unique_tickers)
    has_complete_pages = bool(page_manifests) and sum(
        int(page.get("rows_returned") or 0) for page in page_manifests
    ) >= len(rows)
    is_truncated = bool(config.max_records and expected_total > config.max_records)
    expected_total_with_supplemental = expected_total + supplemental_rows
    is_complete = (
        len(rows) == expected_total_with_supplemental
        and duplicate_count == 0
        and not is_truncated
    )

    return {
        "run_timestamp": run_timestamp,
        "expected_total": expected_total,
        "supplemental_rows": supplemental_rows,
        "expected_total_with_supplemental": expected_total_with_supplemental,
        "records_downloaded": len(rows),
        "unique_tickers": len(unique_tickers),
        "duplicate_ticker_rows": duplicate_count,
        "page_count": len(page_manifests),
        "page_rows_total": sum(int(page.get("rows_returned") or 0) for page in page_manifests),
        "is_complete": is_complete,
        "is_truncated": is_truncated,
        "has_complete_pages": has_complete_pages,
        "max_records": config.max_records,
        "filters": {
            "market": config.market,
            "min_price": config.min_price,
            "exchanges": list(config.exchanges),
            "instrument_types": list(config.instrument_types),
            "browser": config.browser,
            "column_batch_size": config.column_batch_size,
            "option_expirations": config.option_expirations,
            "option_strike_distance_pct": config.option_strike_distance_pct,
            "ticker_pause_seconds": config.ticker_pause_seconds,
            "include_calculated_fields": config.include_calculated_fields,
            "skip_calculated_fields": config.skip_calculated_fields,
            "target_tickers": list(config.target_tickers or ()),
            "extra_tickers": list(config.extra_tickers),
        },
    }


def load_json(path: Path) -> dict[str, Any]:
    with path.open("r", encoding="utf-8") as handle:
        payload = json.load(handle)
    if not isinstance(payload, dict):
        raise ValueError(f"Expected a JSON object in {path}.")
    return payload


def read_csv_rows(path: Path) -> list[dict[str, Any]]:
    with path.open("r", encoding="utf-8", newline="") as handle:
        return list(csv.DictReader(handle))


def config_from_filters(
    project_root: Path,
    filters: dict[str, Any],
    *,
    batch_size: int = 500,
    max_records: int = 0,
) -> DownloadConfig:
    exchanges = filters.get("exchanges") or ["NASDAQ", "NYSE", "AMEX"]
    instrument_types = filters.get("instrument_types") or ["stock", "fund"]
    browser = str(filters.get("browser") or "edge")
    market = str(filters.get("market") or "america")
    min_price = float(filters.get("min_price") or 0)
    return DownloadConfig(
        project_root=project_root,
        min_price=min_price,
        batch_size=batch_size,
        max_records=max_records,
        column_batch_size=int(filters.get("column_batch_size") or DEFAULT_COLUMN_BATCH_SIZE),
        option_expirations=int(filters.get("option_expirations") or DEFAULT_OPTION_EXPIRATIONS),
        option_strike_distance_pct=float(
            filters.get("option_strike_distance_pct") or DEFAULT_OPTION_STRIKE_DISTANCE_PCT
        ),
        ticker_pause_seconds=float(
            filters.get("ticker_pause_seconds") or OPTION_REQUEST_DELAY_SECONDS
        ),
        include_calculated_fields=bool(filters.get("include_calculated_fields") or False),
        skip_calculated_fields=bool(filters.get("skip_calculated_fields") or False),
        target_tickers=tuple(str(item) for item in (filters.get("target_tickers") or [])) or None,
        extra_tickers=tuple(str(item) for item in (filters.get("extra_tickers") or ["SP:SPX", "CBOE:VIX"])),
        browser=browser,
        market=market,
        exchanges=tuple(str(item).upper() for item in exchanges),
        instrument_types=tuple(str(item).lower() for item in instrument_types),
    )


def load_saved_config(
    project_root: Path, verification_report: Path, *, batch_size: int = 500
) -> DownloadConfig:
    payload = load_json(verification_report)
    filters = payload.get("filters")
    if not isinstance(filters, dict):
        raise ValueError(f"Verification report {verification_report} is missing filters.")
    return config_from_filters(project_root, filters, batch_size=batch_size)


def verify_snapshot(
    project_root: Path,
    *,
    verification_report: Path | None = None,
    refresh_live_total: bool = True,
) -> VerificationResult:
    data_dir = ensure_data_directory(project_root)
    latest_verification_report = (
        verification_report
        if verification_report is not None
        else latest_file_for_suffix(data_dir, VERIFICATION_FILENAME_SUFFIX, "json")
    )
    report_name = latest_verification_report.name
    report_suffix = f"_{VERIFICATION_FILENAME_SUFFIX}.json"
    if not report_name.endswith(report_suffix):
        raise ValueError(
            f"Verification report filename {latest_verification_report.name} does not match the expected pattern."
        )
    run_timestamp = report_name[: -len(report_suffix)]
    latest_csv = file_for_timestamp(data_dir, run_timestamp, CSV_FILENAME_SUFFIX, "csv")
    latest_manifest_csv = file_for_timestamp(data_dir, run_timestamp, MANIFEST_FILENAME_SUFFIX, "csv")

    saved_payload = load_json(latest_verification_report)
    snapshot_rows = read_csv_rows(latest_csv)
    manifest_rows = read_csv_rows(latest_manifest_csv)
    expected_total_saved = int(saved_payload.get("expected_total") or 0)
    unique_tickers = len(
        {str(row.get("ticker") or "") for row in snapshot_rows if row.get("ticker")}
    )
    duplicate_ticker_rows = len(snapshot_rows) - unique_tickers
    page_rows_total = sum(int(row.get("rows_returned") or 0) for row in manifest_rows)
    is_complete_against_saved_total = (
        len(snapshot_rows) == expected_total_saved and duplicate_ticker_rows == 0
    )

    expected_total_live = expected_total_saved
    if refresh_live_total:
        config = load_saved_config(project_root, latest_verification_report)
        cookies = load_tradingview_cookies(config.browser)
        expected_total_live = count_matching_records(config, cookies)
    matches_live_total = len(snapshot_rows) == expected_total_live and duplicate_ticker_rows == 0

    verification_output = (
        data_dir / f"{run_timestamp_label()}_{VERIFICATION_FILENAME_SUFFIX}_check.json"
    )
    payload = {
        "latest_csv": str(latest_csv),
        "latest_manifest_csv": str(latest_manifest_csv),
        "latest_verification_report": str(latest_verification_report),
        "expected_total_saved": expected_total_saved,
        "expected_total_live": expected_total_live,
        "records_downloaded": len(snapshot_rows),
        "unique_tickers": unique_tickers,
        "duplicate_ticker_rows": duplicate_ticker_rows,
        "page_rows_total": page_rows_total,
        "is_complete_against_saved_total": is_complete_against_saved_total,
        "matches_live_total": matches_live_total,
    }
    write_json(verification_output, payload)
    return VerificationResult(
        latest_csv=latest_csv,
        latest_manifest_csv=latest_manifest_csv,
        latest_verification_report=latest_verification_report,
        verification_output=verification_output,
        expected_total_saved=expected_total_saved,
        expected_total_live=expected_total_live,
        records_downloaded=len(snapshot_rows),
        unique_tickers=unique_tickers,
        duplicate_ticker_rows=duplicate_ticker_rows,
        page_rows_total=page_rows_total,
        is_complete_against_saved_total=is_complete_against_saved_total,
        matches_live_total=matches_live_total,
    )


def run_download(config: DownloadConfig) -> DownloadResult:
    data_dir = ensure_data_directory(config.project_root)
    history_dir = ensure_history_directory(config.project_root)
    cookies = load_tradingview_cookies(config.browser)
    run_timestamp = run_timestamp_label()
    rows, page_manifests, expected_total = fetch_pages(config, cookies, run_timestamp)
    supplemental_rows = (
        []
        if config.target_tickers
        else fetch_explicit_tickers(config, cookies, run_timestamp)
    )
    if supplemental_rows:
        existing = {str(row.get("ticker") or "") for row in rows if row.get("ticker")}
        rows.extend(
            row for row in supplemental_rows if str(row.get("ticker") or "") not in existing
        )
    main_rows, calculated_rows = split_main_and_calculated_rows(
        rows,
        include_calculated_fields=config.include_calculated_fields,
        skip_calculated_fields=config.skip_calculated_fields,
    )
    option_rows = fetch_options_rows(
        config,
        cookies,
        run_timestamp,
        main_rows,
    )
    rotated_to = rotate_current_data(data_dir, history_dir, run_timestamp)

    csv_output = data_dir / f"{run_timestamp}_{CSV_FILENAME_SUFFIX}.csv"
    options_csv_output = (
        data_dir / f"{run_timestamp}_{OPTIONS_CSV_FILENAME_SUFFIX}.csv"
        if option_rows
        else None
    )
    calculated_csv_output = (
        None
        if config.include_calculated_fields or config.skip_calculated_fields
        else data_dir / f"{run_timestamp}_{CALCULATED_CSV_FILENAME_SUFFIX}.csv"
    )
    json_output = data_dir / f"{run_timestamp}_{CSV_FILENAME_SUFFIX}.json"
    options_json_output = (
        data_dir / f"{run_timestamp}_{OPTIONS_CSV_FILENAME_SUFFIX}.json"
        if option_rows
        else None
    )
    calculated_json_output = (
        None
        if config.include_calculated_fields or config.skip_calculated_fields
        else data_dir / f"{run_timestamp}_{CALCULATED_CSV_FILENAME_SUFFIX}.json"
    )
    manifest_csv = data_dir / f"{run_timestamp}_{MANIFEST_FILENAME_SUFFIX}.csv"
    verification_report = data_dir / f"{run_timestamp}_{VERIFICATION_FILENAME_SUFFIX}.json"

    write_csv(csv_output, main_rows, preferred_order=snake_case_core_columns())
    if options_csv_output is not None:
        write_csv(
            options_csv_output,
            option_rows,
            preferred_order=snake_case_option_core_columns(),
        )
        write_json(options_json_output, option_rows)
    if calculated_csv_output is not None:
        write_csv(
            calculated_csv_output,
            calculated_rows,
            preferred_order=snake_case_identifier_columns(),
        )
        write_json(calculated_json_output, calculated_rows)
    write_json(json_output, main_rows)
    write_csv(manifest_csv, page_manifests)
    verification_payload = build_verification_payload(
        run_timestamp=run_timestamp,
        expected_total=expected_total,
        rows=main_rows,
        page_manifests=page_manifests,
        config=config,
        supplemental_rows=len(supplemental_rows),
    )
    write_json(verification_report, verification_payload)

    unique_symbols = len({str(row.get("symbol") or "") for row in main_rows if row.get("symbol")})
    return DownloadResult(
        run_timestamp=run_timestamp,
        records_downloaded=len(main_rows),
        unique_symbols=unique_symbols,
        option_records_downloaded=len(option_rows),
        rotated_to=rotated_to,
        csv_output=csv_output,
        options_csv_output=options_csv_output,
        calculated_csv_output=calculated_csv_output,
        json_output=json_output,
        options_json_output=options_json_output,
        calculated_json_output=calculated_json_output,
        manifest_csv=manifest_csv,
        verification_report=verification_report,
    )
