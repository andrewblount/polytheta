# Data Index

This document describes all data files available to the options trading system. Files are organized into two primary directories: `./data/` (core trading data from Yahoo Finance, FINRA, SEC, and CBOE) and `./data_trading_view/` (supplemental TradingView market data). Each file is timestamped at download time; the most recent snapshot is `2026-04-04 21-28-02` for core data and `2026-04-04 20-52-14` for TradingView data.

The equities and price history files contain data for the 677 stocks that have weekly options data, plus the VIX and SPX indices. The 694 per-ticker subdirectories include these plus additional ETFs and index symbols carried along from the CBOE weeklys universe.

All file descriptions below reference the relevant sections of the [Options Trading System v2](./options_trading_system.md) trading plan where each dataset is consumed.

---

## 1. Consolidated Root-Level Files (`./data/`)

Each file below exists as both a `.csv` and `.json` pair under two timestamp snapshots (`2026-04-04 21-26-58` and `2026-04-04 21-28-02`). The later snapshot is canonical.


### 1.1 Equities

**File:** [`data/2026-04-04 21-28-02_equities.csv`](../data/2026-04-04%2021-28-02_equities.csv)

Comprehensive equity screening data for all 677+ symbols. Key columns include `symbol`, `current_price`, `sector`, `industry`, `market_cap`, `exchange`, `beta`, `short_interest_pct_float`, `iv_current_atm`, `iv_percentile_252d`, `trailing_pe`, `price_to_book`, `buyback_score`, `acquisition_radar_flag`, `downside_gap_radar_flag`, and `filing_evidence_url`.

**Trading plan relevance:**

- **Universe Filter** — The `current_price`, `exchange`, and `average_volume` fields are used to enforce the mandatory pre-screening criteria (price $8–$40, NYSE/NASDAQ listing, sufficient liquidity).
- **Thesis Confirmation** — `short_interest_pct_float` feeds the short-interest signal (30% weight on both sides). `buyback_score` feeds the Buyback Score signal (15% weight). `acquisition_radar_flag` and `downside_gap_radar_flag` feed the monitoring radars.
- **Portfolio-Level Rules** — `sector` and `industry` enforce the sector correlation limit (no more than 50% of total risk in the same sector).


### 1.2 Options Chains

**File:** [`data/2026-04-04 21-28-02_options.csv`](../data/2026-04-04%2021-28-02_options.csv)

Full options chain data across all expirations for all symbols. Columns: `symbol`, `option_snapshot_label` (current or next week), `expiry`, `option_type` (call/put), `underlying_price`, `strike`, `bid`, `ask`, `volume`, `openInterest`, `impliedVolatility`, `mid_price`, `modeled_delta`, `probability_of_touch`, `model_source`.

**Trading plan relevance:**

- **Universe Filter** — `volume` and bid-ask spread (derived from `bid`/`ask`) enforce the minimum 500 contracts/day and ≤$0.10–$0.15 spread requirements. `impliedVolatility` feeds IV rank calculations for the 80th percentile threshold.
- **Strategy Execution** — `modeled_delta` identifies far-OTM strikes in the 0.15–0.20 delta range. `mid_price` provides the estimated credit collected. `expiry` and `option_snapshot_label` identify weekly expirations for the 7 DTE preferred entry.
- **Mean-Reversion Buffer** — `probability_of_touch` enforces the ≤35–40% POT requirement on put-side strikes.
- **Double-Down Protocol** — `bid`/`ask` and `mid_price` are used to construct illustrative limit-order examples and calculate margin requirements at each doubling stage.


### 1.3 Price History

**File:** [`data/2026-04-04 21-28-02_price_history.csv`](../data/2026-04-04%2021-28-02_price_history.csv)

Historical OHLCV data for all symbols, with records going back to 1962 for long-listed equities. Columns: `symbol`, `date`, `Open`, `High`, `Low`, `Close`, `Adj Close`, `Volume`, `Dividends`, `Stock Splits`, `Capital Gains`.

**Trading plan relevance:**

- **Mean-Reversion Buffer** — Used to calculate the 14-day Average True Range (ATR) that sets the minimum distance for put-side strikes (≥2× ATR below current price).
- **Double-Down Protocol** — Historical support and resistance levels derived from price history define Break #1 and Break #2 levels for the doubling triggers.
- **Backtesting** — Walk-forward validation uses historical prices to simulate Monday entries and Friday expirations across the 52-week test period.
- **GSRS Calculation** — VIX and SPX index history within this file feed the VIX level and 1-day change component (40% weight of GSRS).


### 1.4 Macro Signals

**File:** [`data/2026-04-04 21-28-02_macro_signals.csv`](../data/2026-04-04%2021-28-02_macro_signals.csv)

Single-row market-wide risk metrics. Columns: `as_of_date`, `vix_close`, `vix_change_1d`, `skew_close`, `hy_oas`, `hy_oas_5y_avg`, `hy_oas_delta_vs_5y`, `move_proxy`, `equity_put_call_ratio`, `risk_free_rate_annual`, `gsrs_proxy_score`.

**Trading plan relevance:**

- **GSRS Calculation** — This is the primary input for the Grok Systemic Risk Score. `vix_close` + `vix_change_1d` = 40% weight; `skew_close` = 20% weight; `hy_oas` vs `hy_oas_5y_avg` = 20% weight; `move_proxy` = 10% weight; `equity_put_call_ratio` = 10% weight. The pre-computed `gsrs_proxy_score` provides a ready-to-use composite.
- **Put-Side Sizing** — GSRS directly controls put-side position sizing: 0–3 = full aggressive, 3–5 = halve sizing, 5–7 = 1% max risk, 7–10 = pause puts and hedge.


### 1.5 Short Interest Signals

**File:** [`data/2026-04-04 21-28-02_short_interest_signals.csv`](../data/2026-04-04%2021-28-02_short_interest_signals.csv)

Biweekly FINRA short interest data. Columns: `symbol`, `currentShortPositionQuantity`, `previousShortPositionQuantity`, `averageDailyVolumeQuantity`, `daysToCoverQuantity`, `changePercent`, `settlementDate`, `source_url`.

**Trading plan relevance:**

- **Thesis Confirmation** — Short interest as a percentage of float is the highest-weighted signal on both sides (30% weight). Call-side requires ≥30% of float; put-side requires <15% of float. The `changePercent` field tracks whether short interest is increasing (bearish momentum for call-side thesis) or decreasing.


### 1.6 Filing Signals

**File:** [`data/2026-04-04 21-28-02_filing_signals.csv`](../data/2026-04-04%2021-28-02_filing_signals.csv)

SEC filing-derived signals. Columns: `ticker`, `as_of_date`, `buyback_score`, `acquisition_radar_flag`, `downside_gap_radar_flag`, `evidence_url`, `forms_reviewed`.

**Trading plan relevance:**

- **Buyback Score** — `buyback_score` directly feeds the binary buyback signal (15% weight). Call-side wants 0 (no buyback); put-side wants +1 (active buyback).
- **Monitoring Radars** — `acquisition_radar_flag` triggers immediate exit on call-side positions if True. `downside_gap_radar_flag` triggers immediate exit on put-side positions if True. These override all other rules including the double-down protocol.
- **Thesis Confirmation** — `evidence_url` and `forms_reviewed` (10-K, 8-K, etc.) provide the audit trail for fraud/litigation/distress evidence on the call side (20% weight).


### 1.7 Social Signals

**File:** [`data/2026-04-04 21-28-02_social_signals.csv`](../data/2026-04-04%2021-28-02_social_signals.csv)

Sentiment and social media data. Columns: `ticker`, `as_of_date`, `latest_ftd_quantity`, `ftd_baseline_quantity`, `ftd_spike_ratio`, `source_url`, `provider_status`.

**Trading plan relevance:**

- **Fan Score Calculation** — Fails-to-deliver (FTD) spikes feed into the QuiverQuant Meme Score component (40% weight of Fan Score). Social volume from Reddit threads and StockTwits watchers feeds the 25% weight component. FTD spike ratios help identify meme-stock behavior patterns.
- **Call-Side Screening** — Fan Score ≤7 allows full sizing; ≥8 requires reduced risk (0.5% of account) or skip.
- **Put-Side Screening** — Fan Score 7–10 is preferred (buy-the-dip loyalty provides support).


### 1.8 Signal Snapshots

**File:** [`data/2026-04-04 21-28-02_signal_snapshots.csv`](../data/2026-04-04%2021-28-02_signal_snapshots.csv)

Aggregated signal rows combining macro and per-ticker signals into a unified format. Columns: `ticker`, `signal_group`, `signal_name`, `signal_value`, `signal_text`, `as_of_date`, `source_name`, `source_url`, `reliability_class`, `confidence`, `status`.

**Trading plan relevance:**

- **Workflow Automation** — Provides a single denormalized view of all signals (macro, filing, short interest, social) with confidence scores and source attribution. Used to streamline the Monday morning screening workflow where all filters must be applied in sequence.


### 1.9 Weekly Universe

**File:** [`data/2026-04-04 21-28-02_weekly_universe.csv`](../data/2026-04-04%2021-28-02_weekly_universe.csv)

The filtered list of symbols eligible for weekly options trading. Columns: `symbol`, `exchange`, `security_name`, `screen_query`, `yahoo_symbol`, `is_etf`, `history_only`, `source_name`, `source_url`.

**Trading plan relevance:**

- **Universe Filter** — This is the starting universe. Only symbols appearing here have confirmed weekly options availability from the CBOE weeklys list, satisfying the first prerequisite before price, volume, and IV rank filters are applied.


### 1.10 Financial Statements

**Files (quarterly and yearly for each statement type):**

- [`data/2026-04-04 21-28-02_income_statement_quarterly.csv`](../data/2026-04-04%2021-28-02_income_statement_quarterly.csv)
- [`data/2026-04-04 21-28-02_income_statement_yearly.csv`](../data/2026-04-04%2021-28-02_income_statement_yearly.csv)
- [`data/2026-04-04 21-28-02_balance_sheet_quarterly.csv`](../data/2026-04-04%2021-28-02_balance_sheet_quarterly.csv)
- [`data/2026-04-04 21-28-02_balance_sheet_yearly.csv`](../data/2026-04-04%2021-28-02_balance_sheet_yearly.csv)
- [`data/2026-04-04 21-28-02_cashflow_quarterly.csv`](../data/2026-04-04%2021-28-02_cashflow_quarterly.csv)
- [`data/2026-04-04 21-28-02_cashflow_yearly.csv`](../data/2026-04-04%2021-28-02_cashflow_yearly.csv)

Income statements include `total_revenue`, `net_income`, `operating_margin`, `gross_margin`. Balance sheets include `total_assets`, `total_liabilities`, `shareholders_equity`, `current_ratio`, `debt_to_equity`. Cash flow statements include `operating_cash_flow`, `free_cash_flow`, `investing_cash_flow`.

**Trading plan relevance:**

- **Thesis Confirmation (Put Side)** — Positive fundamentals are the 20% weight signal. Earnings beats, raised guidance, and improving margins from income statements confirm the "strong/real name" thesis for naked puts.
- **Thesis Confirmation (Call Side)** — Deteriorating financials, negative free cash flow, and high debt-to-equity from balance sheets support the "weak/fake/hyped name" thesis for naked calls (part of the fraud/distress 20% weight signal).
- **Downside-Gap Radar** — Catastrophic earnings misses are detected by comparing recent quarterly income to prior periods.


### 1.11 Provider Status

**File:** [`data/2026-04-04 21-28-02_provider_status.csv`](../data/2026-04-04%2021-28-02_provider_status.csv)

Data source validation status. Columns: `provider`, `status`, `records`.

**Trading plan relevance:**

- **Data Quality** — Confirms that all upstream data providers (macro, short interest, filings, social, options) returned successfully before the screening workflow begins. A failed provider would indicate stale or missing signal data.


### 1.12 Download Manifest

**File:** [`data/2026-04-04 21-28-02_download_manifest.csv`](../data/2026-04-04%2021-28-02_download_manifest.csv)

Per-symbol ETL job tracking. Columns: `symbol`, `status`, `attempt_count`, `current_price`, `current_expiry`, `next_week_expiry`, `price_history_status`, `options_status`, `equity_info_status`.

**Trading plan relevance:**

- **Data Quality** — Tracks download status for every symbol across all data types (price history, options chains, equity info). Symbols with `status` other than `downloaded` may have incomplete data and should be flagged during the screening workflow.


---

## 2. Per-Ticker Subdirectories (`./data/{TICKER}/`)

There are 694 ticker subdirectories (e.g., `./data/AAPL/`, `./data/GDX/`, `./data/AAL/`). Each contains the same set of files under both timestamp snapshots. Using AAPL as an example:


### 2.1 Current Week Options

**File:** `data/AAPL/2026-04-04 21-28-02_current_week_options_2026-04-06.csv`

Options expiring in the current week (6–8 days out, aligning with Monday weekly expiry). Same columns as the consolidated options file but filtered to a single ticker and the nearest weekly expiration.

**Trading plan relevance:**

- **Strategy Execution** — These are the primary contracts for 7 DTE entries. Delta 0.15–0.20 strikes are selected from this file for Monday morning basket construction.


### 2.2 Next Week Options

**File:** `data/AAPL/2026-04-04 21-28-02_next_week_options_2026-04-17.csv`

Options expiring the following week (13–15 days out). Same structure as current week options.

**Trading plan relevance:**

- **Strategy Execution** — Used when the trading plan specifies 7–14 DTE entries, or for roll-forward candidates when current-week positions need to be extended.


### 2.3 Per-Ticker Price History

**File:** `data/AAPL/2026-04-04 21-28-02_price_history.csv`

Same structure as the consolidated price history but isolated to the individual ticker. Full historical OHLCV.

**Trading plan relevance:**

- Same as Section 1.3 above but pre-filtered for single-stock analysis: ATR calculation, support/resistance identification for Break #1 and Break #2 levels, and backtesting.


### 2.4 Equity Fundamentals

**File:** `data/AAPL/2026-04-04 21-28-02_equity_fundamentals.csv`

Consolidated fundamental metrics for the single ticker, matching the equities file structure.

**Trading plan relevance:**

- Same as Section 1.1 above but pre-filtered for deep-dive analysis on individual candidates during thesis confirmation.


### 2.5 Per-Ticker Financial Statements

**Files:**

- `data/AAPL/2026-04-04 21-28-02_income_statement_quarterly.csv`
- `data/AAPL/2026-04-04 21-28-02_income_statement_yearly.csv`
- `data/AAPL/2026-04-04 21-28-02_balance_sheet_quarterly.csv`
- `data/AAPL/2026-04-04 21-28-02_balance_sheet_yearly.csv`
- `data/AAPL/2026-04-04 21-28-02_cashflow_quarterly.csv`
- `data/AAPL/2026-04-04 21-28-02_cashflow_yearly.csv`

**Trading plan relevance:**

- Same as Section 1.10 above but pre-filtered per ticker for detailed fundamental analysis during thesis confirmation.


### 2.6 Dataset Manifest

**File:** `data/AAPL/2026-04-04 21-28-02_dataset_manifest.json`

JSON metadata with file checksums and validation status for all data files in the ticker directory.

**Trading plan relevance:**

- **Data Quality** — Provides integrity verification for the per-ticker data bundle. Checksums confirm files were not corrupted during download.


---

## 3. TradingView Data (`./data_trading_view/`)

An alternative data source from TradingView providing supplemental technical and fundamental metrics. All files are timestamped `2026-04-04 20-52-14`.


### 3.1 TradingView Equities

**File:** [`data_trading_view/2026-04-04 20-52-14_tradingview_equities.csv`](../data_trading_view/2026-04-04%2020-52-14_tradingview_equities.csv)

Extremely wide dataset (974 columns) covering 356 equities. Includes price data, fundamentals (`price_earnings_ttm`, `price_sales_current`, `price_book_fq`, `gross_margin`, `operating_margin`, `return_on_equity`, `debt_to_equity`, `current_ratio`, `free_cash_flow`, `altman_z_score`), performance metrics (`perf_1_m`, `perf_3_m`, `perf_6_m`, `perf_y`), 52-week range, employee count, and extensive multi-timeframe technical indicators including ATR and ATRP at 5-minute through monthly intervals.

**Trading plan relevance:**

- **Mean-Reversion Buffer** — Multi-timeframe ATR values (especially daily ATR) provide a cross-reference for the 14-day ATR calculation used to set the minimum put-side strike distance (≥2× ATR below current price).
- **Thesis Confirmation** — Fundamentals like `altman_z_score`, `debt_to_equity`, and margin metrics provide additional confirmation for both sides. Low Altman Z-scores support the call-side distress thesis; high scores support put-side strength.
- **Universe Filter** — `exchange`, `close` (price), and volume fields provide a second-source validation of the core universe filter criteria.


### 3.2 TradingView Options

**File:** [`data_trading_view/2026-04-04 20-52-14_tradingview_options.csv`](../data_trading_view/2026-04-04%2020-52-14_tradingview_options.csv)

Options chain data with columns: `underlying_ticker`, `underlying_close`, `option_type`, `expiration`, `maturity_date`, `days_to_maturity`, `strike`, `bid`, `ask`, `bid_ask_spread_pct`, `volume`.

**Trading plan relevance:**

- **Universe Filter** — `bid_ask_spread_pct` provides a pre-calculated spread metric for validating the ≤$0.10–$0.15 spread requirement.
- **Strategy Execution** — Serves as a cross-reference for the primary options data, useful for validating strike selection and bid-ask quality.


### 3.3 TradingView Manifest

**File:** [`data_trading_view/2026-04-04 20-52-14_tradingview_manifest.csv`](../data_trading_view/2026-04-04%2020-52-14_tradingview_manifest.csv)

Pagination and field metadata. Columns: `page_index`, `offset`, `batch_size`, `rows_returned`, `expected_total`, `field_count`, `field_chunk_count`, `field_chunk_size`.

**Trading plan relevance:**

- **Data Quality** — Confirms the TradingView download captured all expected rows (356 of 356) and all 974 fields across 8 chunks.


### 3.4 TradingView Verification

**File:** [`data_trading_view/2026-04-04 20-52-14_tradingview_verification.json`](../data_trading_view/2026-04-04%2020-52-14_tradingview_verification.json)

Checksum and validation status for the TradingView download.

**Trading plan relevance:**

- **Data Quality** — Confirms download integrity before any TradingView data is used in the screening workflow.


---

## 4. Trading Plan Cross-Reference Summary

The table below maps each major section of the [Options Trading System v2](./options_trading_system.md) to the data files that feed it.

| Trading Plan Section | Primary Data Files | Supplemental (TradingView) |
|---|---|---|
| **Universe Filter** (price, exchange, volume, IV rank) | `equities.csv`, `options.csv`, `weekly_universe.csv` | `tradingview_equities.csv` |
| **Thesis Confirmation — Short Interest** (30% weight) | `short_interest_signals.csv`, `equities.csv` | — |
| **Thesis Confirmation — Fan Score** (25% weight) | `social_signals.csv` | — |
| **Thesis Confirmation — Fraud/Distress or Positive Fundamentals** (20% weight) | `filing_signals.csv`, `income_statement_*.csv`, `balance_sheet_*.csv`, `cashflow_*.csv` | `tradingview_equities.csv` (Altman Z, margins) |
| **Thesis Confirmation — Buyback Score** (15% weight) | `filing_signals.csv`, `equities.csv` | — |
| **Thesis Confirmation — Radar Clean** (10% weight) | `filing_signals.csv`, `equities.csv` | — |
| **GSRS Calculation** (put-side sizing) | `macro_signals.csv`, `price_history.csv` (VIX/SPX) | — |
| **Mean-Reversion Buffer** (put-side strike distance) | `price_history.csv`, `options.csv` | `tradingview_equities.csv` (ATR fields) |
| **Strategy Execution** (strike selection, order construction) | `options.csv`, per-ticker `current_week_options_*.csv`, `next_week_options_*.csv` | `tradingview_options.csv` |
| **Double-Down Protocol** (break levels, sizing) | `price_history.csv`, `options.csv`, `equities.csv` | — |
| **Monitoring Radars** (continuous exit triggers) | `filing_signals.csv`, `equities.csv` | — |
| **Portfolio-Level Rules** (sector limits, correlation) | `equities.csv` | `tradingview_equities.csv` |
| **Backtesting** (walk-forward validation) | `price_history.csv`, `options.csv`, all signal files | All TradingView files |
| **Data Quality / Validation** | `provider_status.csv`, `download_manifest.csv`, per-ticker `dataset_manifest.json` | `tradingview_manifest.csv`, `tradingview_verification.json` |
