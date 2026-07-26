from __future__ import annotations

import csv
import json
import math
import os
import re
import time
import zipfile
from dataclasses import asdict, dataclass
from datetime import UTC, date, datetime, timedelta
from html import unescape
from io import BytesIO, StringIO
from pathlib import Path
from statistics import NormalDist
from typing import Any, Protocol
from urllib.parse import quote
from urllib.request import Request, urlopen

import pandas as pd

HTTP_HEADERS = {
    "User-Agent": os.environ.get(
        "POLYTHETA_SEC_USER_AGENT",
        "PolythetaDataCollector/1.0 (contact: admin@polytheta.com)",
    )
}
DEFAULT_REQUEST_PAUSE_SECONDS = 0.75
REQUEST_PAUSE_SECONDS = DEFAULT_REQUEST_PAUSE_SECONDS
SEC_TICKERS_URL = "https://www.sec.gov/files/company_tickers.json"
SEC_SUBMISSIONS_URL = "https://data.sec.gov/submissions/CIK{cik}.json"
SEC_ARCHIVES_BASE_URL = "https://www.sec.gov/Archives/edgar/data"
SEC_FTD_PAGE_URL = "https://www.sec.gov/data/foiadocsfailsdatahtm"
SEC_LITIGATION_RSS_URL = "https://www.sec.gov/rss/litigation/litreleases.xml"
FINRA_SHORT_INTEREST_FILES_URL = (
    "https://www.finra.org/finra-data/browse-catalog/equity-short-interest/files"
)
FRED_CSV_URL = "https://fred.stlouisfed.org/graph/fredgraph.csv?id={series_id}"
DEFAULT_FRED_SERIES = {
    "hy_oas": "BAMLH0A0HYM2",
    "dgs2": "DGS2",
    "dgs5": "DGS5",
    "dgs10": "DGS10",
    "dgs30": "DGS30",
    "tbill_3m": "DTB3",
}
BUYBACK_PATTERNS = (
    r"share repurchase",
    r"stock repurchase",
    r"repurchase program",
    r"repurchase authorization",
    r"authorized .* repurchase",
    r"buyback",
)
ACQUISITION_PATTERNS = (
    r"strategic alternatives",
    r"merger agreement",
    r"definitive agreement.*acquire",
    r"definitive agreement.*merge",
    r"to be acquired",
    r"takeover",
    r"activist investor",
    r"board seat",
)
DOWNSIDE_PATTERNS = (
    r"fraud",
    r"restatement",
    r"bankruptcy",
    r"chapter 11",
    r"cyber incident",
    r"data breach",
    r"recall",
    r"going concern",
    r"customer loss",
    r"material weakness",
    r"covenant",
    r"subpoena",
    r"department of justice",
    r"sec investigation",
)
SEVERE_DOWNSIDE_PATTERNS = (
    r"fraud",
    r"restatement",
    r"bankruptcy",
    r"chapter 11",
    r"cyber incident",
    r"data breach",
    r"going concern",
    r"department of justice",
    r"sec investigation",
    r"subpoena",
)


class ShortInterestProvider(Protocol):
    def fetch(self, tickers: set[str]) -> tuple[pd.DataFrame, list[dict[str, Any]]]: ...


class FilingsProvider(Protocol):
    def fetch(self, tickers: set[str]) -> tuple[pd.DataFrame, list[dict[str, Any]]]: ...


class MacroProvider(Protocol):
    def fetch(self, history_window_days: int = 30) -> tuple[pd.DataFrame, list[dict[str, Any]]]: ...


class RadarProvider(Protocol):
    def fetch(self, tickers: set[str]) -> tuple[pd.DataFrame, list[dict[str, Any]]]: ...


class SocialSignalProvider(Protocol):
    def fetch(self, tickers: set[str]) -> tuple[pd.DataFrame, list[dict[str, Any]]]: ...


@dataclass(slots=True)
class MacroSnapshot:
    as_of_date: str
    retrieved_at: str
    vix_close: float | None
    vix_change_1d: float | None
    skew_close: float | None
    hy_oas: float | None
    hy_oas_5y_avg: float | None
    hy_oas_delta_vs_5y: float | None
    move_proxy: float | None
    equity_put_call_ratio: float | None
    risk_free_rate_annual: float | None
    gsrs_proxy_score: float | None


def now_iso() -> str:
    return datetime.now(UTC).replace(microsecond=0).isoformat()


def configure_request_pause_seconds(value: float) -> None:
    global REQUEST_PAUSE_SECONDS
    REQUEST_PAUSE_SECONDS = max(0.0, float(value))


def pause_for_request() -> None:
    if REQUEST_PAUSE_SECONDS > 0:
        time.sleep(REQUEST_PAUSE_SECONDS)


def fetch_text(url: str, timeout: int = 30) -> str:
    pause_for_request()
    with urlopen(Request(url, headers=HTTP_HEADERS), timeout=timeout) as response:
        return response.read().decode("utf-8", "ignore")


def fetch_json(url: str, timeout: int = 30) -> Any:
    return json.loads(fetch_text(url, timeout=timeout))


def fetch_csv(url: str, delimiter: str = ",", timeout: int = 30) -> pd.DataFrame:
    text = fetch_text(url, timeout=timeout)
    return pd.read_csv(StringIO(text), delimiter=delimiter)


def make_signal_row(
    *,
    ticker: str,
    signal_group: str,
    signal_name: str,
    signal_value: Any,
    as_of_date: str | None,
    source_name: str,
    source_url: str,
    reliability_class: str,
    license_class: str,
    confidence: float,
    signal_text: str | None = None,
    raw_payload_ref: str | None = None,
    status: str = "available",
) -> dict[str, Any]:
    return {
        "ticker": ticker,
        "signal_group": signal_group,
        "signal_name": signal_name,
        "signal_value": signal_value,
        "signal_text": signal_text,
        "as_of_date": as_of_date,
        "retrieved_at": now_iso(),
        "source_name": source_name,
        "source_url": source_url,
        "reliability_class": reliability_class,
        "license_class": license_class,
        "confidence": confidence,
        "raw_payload_ref": raw_payload_ref,
        "status": status,
    }


def coerce_float(value: Any) -> float | None:
    if value is None:
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    if math.isnan(number) or math.isinf(number):
        return None
    return number


def black_scholes_delta(
    *,
    spot: float | None,
    strike: float | None,
    days_to_expiry: float | None,
    implied_volatility: float | None,
    option_type: str,
    risk_free_rate: float | None,
) -> float | None:
    s = coerce_float(spot)
    k = coerce_float(strike)
    t_days = coerce_float(days_to_expiry)
    sigma = coerce_float(implied_volatility)
    if s is None or k is None or t_days is None or sigma is None or s <= 0 or k <= 0:
        return None
    t = max(t_days, 0) / 365.0
    if t <= 0 or sigma <= 0:
        return None
    r = coerce_float(risk_free_rate) or 0.0
    sigma = sigma if sigma <= 2 else sigma / 100.0
    if sigma <= 0:
        return None
    dist = NormalDist()
    d1 = (math.log(s / k) + (r + 0.5 * sigma * sigma) * t) / (sigma * math.sqrt(t))
    if option_type == "call":
        return round(dist.cdf(d1), 4)
    return round(dist.cdf(d1) - 1.0, 4)


def probability_of_touch_from_delta(delta: float | None) -> float | None:
    if delta is None:
        return None
    return round(min(1.0, abs(delta) * 2.0), 4)


def iv_percentile(current_value: float | None, trailing_values: list[float]) -> tuple[float | None, int]:
    if current_value is None:
        return None, len(trailing_values)
    clean = [value for value in trailing_values if value is not None and not math.isnan(value)]
    if not clean:
        return None, 0
    count = sum(1 for value in clean if value <= current_value)
    percentile = round((count / len(clean)) * 100.0, 2)
    return percentile, len(clean)


def extract_finra_short_interest_url(html: str) -> str | None:
    matches = re.findall(r"https://cdn\.finra\.org/equity/otcmarket/biweekly/shrt\d+\.csv", html)
    return matches[0] if matches else None


def strip_html(text: str) -> str:
    without_script = re.sub(r"<script.*?</script>", " ", text, flags=re.I | re.S)
    without_style = re.sub(r"<style.*?</style>", " ", without_script, flags=re.I | re.S)
    stripped = re.sub(r"<[^>]+>", " ", without_style)
    return re.sub(r"\s+", " ", unescape(stripped)).strip()


def score_text_matches(text: str, patterns: tuple[str, ...]) -> bool:
    lowered = text.lower()
    return any(re.search(pattern, lowered, flags=re.I) for pattern in patterns)


def compute_gsrs_proxy_score(snapshot: MacroSnapshot) -> float | None:
    if snapshot.vix_close is None or snapshot.skew_close is None or snapshot.hy_oas_delta_vs_5y is None:
        return None
    component_vix = min(10.0, max(0.0, ((snapshot.vix_close - 12.0) / 3.0)))
    if snapshot.vix_change_1d is not None:
        component_vix = min(10.0, component_vix + max(0.0, snapshot.vix_change_1d / 2.0))
    component_skew = min(10.0, max(0.0, (snapshot.skew_close - 120.0) / 4.0))
    component_hy = min(10.0, max(0.0, snapshot.hy_oas_delta_vs_5y * 4.0))
    component_move = 0.0
    if snapshot.move_proxy is not None:
        component_move = min(10.0, max(0.0, (snapshot.move_proxy - 6.0) / 1.0))
    component_pcr = 0.0
    if snapshot.equity_put_call_ratio is not None:
        component_pcr = min(10.0, max(0.0, (snapshot.equity_put_call_ratio - 0.55) * 20.0))
    total = (
        component_vix * 0.4
        + component_skew * 0.2
        + component_hy * 0.2
        + component_move * 0.1
        + component_pcr * 0.1
    )
    return round(total, 2)


class FinraShortInterestCsvProvider:
    source_name = "FINRA Equity Short Interest"
    source_url = FINRA_SHORT_INTEREST_FILES_URL

    def fetch(self, tickers: set[str]) -> tuple[pd.DataFrame, list[dict[str, Any]]]:
        html = fetch_text(self.source_url)
        latest_url = extract_finra_short_interest_url(html)
        if latest_url is None:
            return pd.DataFrame(), []
        frame = fetch_csv(latest_url, delimiter="|")
        if frame.empty:
            return pd.DataFrame(), []
        frame["symbol"] = frame["symbolCode"].astype(str).str.upper()
        filtered = frame.loc[frame["symbol"].isin(tickers)].copy()
        filtered["current_short_position_quantity"] = filtered["currentShortPositionQuantity"].map(coerce_float)
        filtered["average_daily_volume_quantity"] = filtered["averageDailyVolumeQuantity"].map(coerce_float)
        filtered["days_to_cover_quantity"] = filtered["daysToCoverQuantity"].map(coerce_float)
        filtered["settlement_date"] = filtered["settlementDate"].astype(str)
        filtered["source_url"] = latest_url
        signals: list[dict[str, Any]] = []
        for record in filtered.to_dict(orient="records"):
            ticker = str(record["symbol"])
            signals.append(
                make_signal_row(
                    ticker=ticker,
                    signal_group="short_interest",
                    signal_name="short_interest_shares",
                    signal_value=record["current_short_position_quantity"],
                    as_of_date=record["settlement_date"],
                    source_name=self.source_name,
                    source_url=latest_url,
                    reliability_class="authoritative_free",
                    license_class="official_free",
                    confidence=0.98,
                    raw_payload_ref=latest_url,
                )
            )
            signals.append(
                make_signal_row(
                    ticker=ticker,
                    signal_group="short_interest",
                    signal_name="days_to_cover",
                    signal_value=record["days_to_cover_quantity"],
                    as_of_date=record["settlement_date"],
                    source_name=self.source_name,
                    source_url=latest_url,
                    reliability_class="authoritative_free",
                    license_class="official_free",
                    confidence=0.95,
                    raw_payload_ref=latest_url,
                )
            )
        return filtered, signals


class SecEdgarFilingsProvider:
    source_name = "SEC EDGAR"
    source_url = SEC_TICKERS_URL

    def __init__(self, max_documents_per_ticker: int = 3) -> None:
        self.max_documents_per_ticker = max_documents_per_ticker
        self._ticker_map: dict[str, dict[str, Any]] | None = None

    def _load_ticker_map(self) -> dict[str, dict[str, Any]]:
        if self._ticker_map is not None:
            return self._ticker_map
        raw = fetch_json(SEC_TICKERS_URL)
        mapping: dict[str, dict[str, Any]] = {}
        for row in raw.values():
            ticker = str(row.get("ticker") or "").upper()
            if not ticker:
                continue
            mapping[ticker] = row
        self._ticker_map = mapping
        return mapping

    def _recent_filing_records(self, ticker: str) -> list[dict[str, Any]]:
        mapping = self._load_ticker_map()
        ticker_row = mapping.get(ticker.upper())
        if not ticker_row:
            return []
        cik = str(int(ticker_row["cik_str"])).zfill(10)
        submissions = fetch_json(SEC_SUBMISSIONS_URL.format(cik=cik))
        recent = submissions.get("filings", {}).get("recent", {})
        forms = recent.get("form", [])
        accession_numbers = recent.get("accessionNumber", [])
        primary_documents = recent.get("primaryDocument", [])
        filing_dates = recent.get("filingDate", [])
        accepted_dates = recent.get("acceptanceDateTime", [])
        records: list[dict[str, Any]] = []
        for form, accession, primary_document, filing_date, accepted in zip(
            forms,
            accession_numbers,
            primary_documents,
            filing_dates,
            accepted_dates,
            strict=False,
        ):
            if form not in {"10-Q", "10-K", "8-K", "SC 13D", "SC 13G", "13D", "13G"}:
                continue
            accession_nodash = str(accession).replace("-", "")
            filing_url = (
                f"{SEC_ARCHIVES_BASE_URL}/{int(ticker_row['cik_str'])}/"
                f"{accession_nodash}/{quote(str(primary_document))}"
            )
            records.append(
                {
                    "ticker": ticker,
                    "cik": cik,
                    "form": form,
                    "filing_date": str(filing_date),
                    "accepted_at": str(accepted),
                    "filing_url": filing_url,
                }
            )
            if len(records) >= self.max_documents_per_ticker:
                break
        return records

    def fetch(self, tickers: set[str]) -> tuple[pd.DataFrame, list[dict[str, Any]]]:
        rows: list[dict[str, Any]] = []
        signals: list[dict[str, Any]] = []
        for ticker in sorted(tickers):
            try:
                filing_records = self._recent_filing_records(ticker)
            except Exception:
                continue
            if not filing_records:
                continue
            combined_text = ""
            text_by_form: list[tuple[str, str, str]] = []
            latest_filing_date = filing_records[0]["filing_date"]
            for record in filing_records:
                try:
                    filing_text = strip_html(fetch_text(record["filing_url"]))
                except Exception:
                    continue
                combined_text = f"{combined_text} {filing_text}"
                text_by_form.append((record["form"], filing_text, record["filing_url"]))
            recent_forms = {record["form"] for record in filing_records}
            buyback_score = 1 if score_text_matches(combined_text, BUYBACK_PATTERNS) else 0
            acquisition_flag = bool(
                recent_forms.intersection({"SC 13D", "13D", "SC 13G", "13G"})
                or any(
                    form == "8-K" and score_text_matches(text, ACQUISITION_PATTERNS)
                    for form, text, _ in text_by_form
                )
            )
            downside_flag = bool(
                any(
                    form == "8-K" and score_text_matches(text, SEVERE_DOWNSIDE_PATTERNS)
                    for form, text, _ in text_by_form
                )
            )
            evidence_url = filing_records[0]["filing_url"]
            row = {
                "ticker": ticker,
                "as_of_date": latest_filing_date,
                "buyback_score": buyback_score,
                "acquisition_radar_flag": acquisition_flag,
                "downside_gap_radar_flag": downside_flag,
                "evidence_url": evidence_url,
                "forms_reviewed": "|".join(record["form"] for record in filing_records),
            }
            rows.append(row)
            signals.append(
                make_signal_row(
                    ticker=ticker,
                    signal_group="filings",
                    signal_name="buyback_score",
                    signal_value=buyback_score,
                    as_of_date=latest_filing_date,
                    source_name=self.source_name,
                    source_url=evidence_url,
                    reliability_class="authoritative_free",
                    license_class="official_free",
                    confidence=0.92,
                    raw_payload_ref=evidence_url,
                )
            )
            signals.append(
                make_signal_row(
                    ticker=ticker,
                    signal_group="radar",
                    signal_name="acquisition_radar_flag",
                    signal_value=acquisition_flag,
                    as_of_date=latest_filing_date,
                    source_name=self.source_name,
                    source_url=evidence_url,
                    reliability_class="authoritative_free",
                    license_class="official_free",
                    confidence=0.85,
                    raw_payload_ref=evidence_url,
                )
            )
            signals.append(
                make_signal_row(
                    ticker=ticker,
                    signal_group="radar",
                    signal_name="downside_gap_radar_flag",
                    signal_value=downside_flag,
                    as_of_date=latest_filing_date,
                    source_name=self.source_name,
                    source_url=evidence_url,
                    reliability_class="authoritative_free",
                    license_class="official_free",
                    confidence=0.85,
                    raw_payload_ref=evidence_url,
                )
            )
        return pd.DataFrame(rows), signals


def latest_ftd_zip_urls(limit: int = 6) -> list[str]:
    html = fetch_text(SEC_FTD_PAGE_URL)
    matches = re.findall(r"/files/data/fails-deliver-data/cnsfails\d+[ab]?\.zip", html)
    urls = [f"https://www.sec.gov{match}" for match in matches[:limit]]
    return urls


class SecFtdSignalProvider:
    source_name = "SEC Fails-to-Deliver"

    def fetch(self, tickers: set[str]) -> tuple[pd.DataFrame, list[dict[str, Any]]]:
        aggregate: dict[str, list[tuple[str, float]]] = {}
        used_urls: list[str] = []
        for url in latest_ftd_zip_urls(limit=6):
            try:
                raw = urlopen(Request(url, headers=HTTP_HEADERS), timeout=30).read()
            except Exception:
                continue
            used_urls.append(url)
            with zipfile.ZipFile(BytesIO(raw)) as archive:
                member = archive.namelist()[0]
                text = archive.read(member).decode("utf-8", "ignore")
            reader = csv.DictReader(StringIO(text), delimiter="|")
            for row in reader:
                ticker = str(row.get("SYMBOL") or "").upper()
                if ticker not in tickers:
                    continue
                quantity = coerce_float(row.get("QUANTITY (FAILS)"))
                settlement_date = str(row.get("SETTLEMENT DATE") or "")
                if quantity is None or not settlement_date:
                    continue
                aggregate.setdefault(ticker, []).append((settlement_date, quantity))
        rows: list[dict[str, Any]] = []
        signals: list[dict[str, Any]] = []
        payload_ref = used_urls[0] if used_urls else SEC_FTD_PAGE_URL
        for ticker, observations in sorted(aggregate.items()):
            observations.sort(key=lambda item: item[0], reverse=True)
            latest_date, latest_quantity = observations[0]
            baseline = [quantity for _, quantity in observations[1:6]]
            avg_baseline = sum(baseline) / len(baseline) if baseline else None
            spike_ratio = (
                round(latest_quantity / avg_baseline, 2)
                if avg_baseline and avg_baseline > 0
                else None
            )
            rows.append(
                {
                    "ticker": ticker,
                    "as_of_date": latest_date,
                    "latest_ftd_quantity": latest_quantity,
                    "ftd_baseline_quantity": avg_baseline,
                    "ftd_spike_ratio": spike_ratio,
                    "source_url": payload_ref,
                }
            )
            signals.append(
                make_signal_row(
                    ticker=ticker,
                    signal_group="social",
                    signal_name="ftd_spike_ratio",
                    signal_value=spike_ratio,
                    as_of_date=latest_date,
                    source_name=self.source_name,
                    source_url=payload_ref,
                    reliability_class="authoritative_free",
                    license_class="official_free",
                    confidence=0.88,
                    raw_payload_ref=payload_ref,
                )
            )
        return pd.DataFrame(rows), signals


def fred_series_frame(series_id: str) -> pd.DataFrame:
    frame = fetch_csv(FRED_CSV_URL.format(series_id=series_id))
    if frame.empty:
        return frame
    frame.columns = ["date", "value"]
    frame["date"] = frame["date"].astype(str)
    frame["value"] = frame["value"].map(lambda value: None if value == "." else coerce_float(value))
    frame = frame.dropna(subset=["value"]).reset_index(drop=True)
    return frame


def move_proxy_from_fred() -> tuple[float | None, str | None]:
    series_frames = {
        name: fred_series_frame(series_id)
        for name, series_id in DEFAULT_FRED_SERIES.items()
        if name in {"dgs2", "dgs5", "dgs10", "dgs30"}
    }
    if any(frame.empty for frame in series_frames.values()):
        return None, None
    merged = None
    for name, frame in series_frames.items():
        renamed = frame.rename(columns={"value": name})
        merged = renamed if merged is None else merged.merge(renamed, on="date", how="inner")
    if merged is None or merged.empty:
        return None, None
    for column in ("dgs2", "dgs5", "dgs10", "dgs30"):
        merged[f"{column}_chg"] = merged[column].diff().abs()
    merged["proxy_move"] = (
        merged[[f"{column}_chg" for column in ("dgs2", "dgs5", "dgs10", "dgs30")]]
        .mean(axis=1)
        .rolling(20)
        .mean()
        * 100.0
    )
    merged = merged.dropna(subset=["proxy_move"])
    if merged.empty:
        return None, None
    latest = merged.iloc[-1]
    return round(float(latest["proxy_move"]), 2), str(latest["date"])


class PublicMacroSnapshotProvider:
    source_name = "Public Macro Composite"

    def __init__(self) -> None:
        import yfinance as yf

        self.yf = yf

    def _history_close(self, symbol: str, period: str = "10d") -> tuple[float | None, float | None, str | None]:
        try:
            history = self.yf.Ticker(symbol).history(period=period)
        except Exception:
            return None, None, None
        if history.empty:
            return None, None, None
        close = history["Close"].dropna()
        if close.empty:
            return None, None, None
        latest = float(close.iloc[-1])
        previous = float(close.iloc[-2]) if len(close) > 1 else None
        as_of_date = str(history.index[-1].date())
        return latest, previous, as_of_date

    def fetch(self, history_window_days: int = 30) -> tuple[pd.DataFrame, list[dict[str, Any]]]:
        vix, vix_prev, as_of_date = self._history_close("^VIX")
        skew, _, skew_date = self._history_close("^SKEW")
        put_call, _, pcr_date = self._history_close("^CPCE")
        hy_oas_frame = fred_series_frame(DEFAULT_FRED_SERIES["hy_oas"])
        hy_oas = None
        hy_oas_5y_avg = None
        hy_oas_delta = None
        hy_oas_date = None
        if not hy_oas_frame.empty:
            hy_oas_date = str(hy_oas_frame.iloc[-1]["date"])
            hy_oas = float(hy_oas_frame.iloc[-1]["value"])
            trailing_cutoff = (
                datetime.fromisoformat(hy_oas_date).date() - timedelta(days=365 * 5)
            ).isoformat()
            trailing = hy_oas_frame.loc[hy_oas_frame["date"] >= trailing_cutoff, "value"]
            if not trailing.empty:
                hy_oas_5y_avg = round(float(trailing.mean()), 2)
                hy_oas_delta = round(hy_oas - hy_oas_5y_avg, 2)
        move_proxy, move_date = move_proxy_from_fred()
        risk_free_rate = None
        tbill_frame = fred_series_frame(DEFAULT_FRED_SERIES["tbill_3m"])
        if not tbill_frame.empty:
            risk_free_rate = round(float(tbill_frame.iloc[-1]["value"]) / 100.0, 4)
        snapshot = MacroSnapshot(
            as_of_date=as_of_date or skew_date or hy_oas_date or move_date or pcr_date or date.today().isoformat(),
            retrieved_at=now_iso(),
            vix_close=round(vix, 2) if vix is not None else None,
            vix_change_1d=round(vix - vix_prev, 2) if vix is not None and vix_prev is not None else None,
            skew_close=round(skew, 2) if skew is not None else None,
            hy_oas=round(hy_oas, 2) if hy_oas is not None else None,
            hy_oas_5y_avg=hy_oas_5y_avg,
            hy_oas_delta_vs_5y=hy_oas_delta,
            move_proxy=move_proxy,
            equity_put_call_ratio=round(put_call, 2) if put_call is not None else None,
            risk_free_rate_annual=risk_free_rate,
            gsrs_proxy_score=None,
        )
        snapshot.gsrs_proxy_score = compute_gsrs_proxy_score(snapshot)
        frame = pd.DataFrame([asdict(snapshot)])
        signals: list[dict[str, Any]] = []
        for field_name, source_url in (
            ("vix_close", "https://finance.yahoo.com/quote/%5EVIX"),
            ("skew_close", "https://finance.yahoo.com/quote/%5ESKEW"),
            ("equity_put_call_ratio", "https://finance.yahoo.com/quote/%5ECPCE"),
            ("hy_oas", FRED_CSV_URL.format(series_id=DEFAULT_FRED_SERIES["hy_oas"])),
            ("move_proxy", FRED_CSV_URL.format(series_id=DEFAULT_FRED_SERIES["dgs10"])),
            ("gsrs_proxy_score", "derived"),
        ):
            value = frame.iloc[0].to_dict().get(field_name)
            is_available = value is not None and not pd.isna(value)
            signals.append(
                make_signal_row(
                    ticker="__MACRO__",
                    signal_group="macro",
                    signal_name=field_name,
                    signal_value=value,
                    as_of_date=snapshot.as_of_date,
                    source_name=self.source_name,
                    source_url=source_url,
                    reliability_class="derived_free" if field_name in {"move_proxy", "gsrs_proxy_score"} else "authoritative_free",
                    license_class="official_free" if field_name != "gsrs_proxy_score" else "derived",
                    confidence=(0.75 if field_name in {"move_proxy", "gsrs_proxy_score"} else 0.95) if is_available else 0.0,
                    raw_payload_ref=source_url,
                    status="available" if is_available else "unavailable",
                    signal_text=None if is_available else "Source was queried but did not return a usable value.",
                )
            )
        return frame, signals


class SecLitigationRadarProvider:
    source_name = "SEC Litigation RSS"

    def fetch(self, tickers: set[str]) -> tuple[pd.DataFrame, list[dict[str, Any]]]:
        try:
            feed = fetch_text(SEC_LITIGATION_RSS_URL)
        except Exception:
            return pd.DataFrame(), []
        rows: list[dict[str, Any]] = []
        signals: list[dict[str, Any]] = []
        lowered_feed = feed.lower()
        for ticker in sorted(tickers):
            pattern = rf"\b{re.escape(ticker.lower())}\b"
            if re.search(pattern, lowered_feed) is None:
                continue
            rows.append(
                {
                    "ticker": ticker,
                    "as_of_date": date.today().isoformat(),
                    "litigation_rss_match": True,
                    "source_url": SEC_LITIGATION_RSS_URL,
                }
            )
            signals.append(
                make_signal_row(
                    ticker=ticker,
                    signal_group="radar",
                    signal_name="sec_litigation_rss_match",
                    signal_value=True,
                    as_of_date=date.today().isoformat(),
                    source_name=self.source_name,
                    source_url=SEC_LITIGATION_RSS_URL,
                    reliability_class="authoritative_free",
                    license_class="official_free",
                    confidence=0.7,
                    raw_payload_ref=SEC_LITIGATION_RSS_URL,
                )
            )
        return pd.DataFrame(rows), signals


class OptionalSocialSentimentProvider:
    source_name = "Optional Social Feeds"

    def fetch(self, tickers: set[str]) -> tuple[pd.DataFrame, list[dict[str, Any]]]:
        rows = []
        signals = []
        for ticker in sorted(tickers):
            rows.append(
                {
                    "ticker": ticker,
                    "as_of_date": date.today().isoformat(),
                    "provider_status": "unavailable_without_credentials",
                }
            )
            signals.append(
                make_signal_row(
                    ticker=ticker,
                    signal_group="social",
                    signal_name="optional_social_provider_status",
                    signal_value=None,
                    signal_text="Reddit and StockTwits adapters are reserved for credentialed access.",
                    as_of_date=date.today().isoformat(),
                    source_name=self.source_name,
                    source_url="",
                    reliability_class="optional_or_licensed",
                    license_class="optional_or_licensed",
                    confidence=0.0,
                    status="unavailable",
                )
            )
        return pd.DataFrame(rows), signals


def latest_weekly_universe_frame(symbols: list[dict[str, Any]], run_timestamp: str) -> pd.DataFrame:
    rows = []
    for symbol_row in symbols:
        screen_query = str(symbol_row.get("screen_query") or "")
        source_name = "Cboe Weeklys" if screen_query == "cboe_weekly" else screen_query or "manual"
        source_url = (
            "https://www.cboe.com/us/options/symboldir/weeklys-options/download/"
            if screen_query == "cboe_weekly"
            else ""
        )
        rows.append(
            {
                "downloaded_on": run_timestamp,
                "symbol": symbol_row.get("symbol"),
                "exchange": symbol_row.get("exchange"),
                "security_name": symbol_row.get("security_name"),
                "screen_query": screen_query,
                "yahoo_symbol": symbol_row.get("yahoo_symbol"),
                "is_etf": symbol_row.get("is_etf"),
                "history_only": symbol_row.get("history_only"),
                "source_name": source_name,
                "source_url": source_url,
            }
        )
    return pd.DataFrame(rows)
