# Polytheta TradingView Downloader

Python subproject for downloading TradingView screener results into the repository `data_trading_view/` folder.

## Install

From the repository root:

```bash
python3 -m venv python/tradingview_equity_downloader/.venv
source python/tradingview_equity_downloader/.venv/bin/activate
pip install -e ./python/tradingview_equity_downloader
```

Or reuse the Yahoo downloader virtualenv:

```bash
/absolute/path/to/python/yahoo_equity_downloader/.venv/bin/pip install -e ./python/tradingview_equity_downloader
```

## Run

```bash
polytheta-tradingview-downloader --min-price 5
```

Full-universe run:

```bash
polytheta-tradingview-downloader --full-download
```

Current Cboe Weeklys run:

```bash
polytheta-tradingview-downloader --cboe-weeklys-only
```

Optional flags:

```bash
polytheta-tradingview-downloader \
  --project-root /absolute/path/to/polytheta \
  --min-price 5 \
  --full-download \
  --cboe-weeklys-only \
  --exchanges NASDAQ,NYSE,AMEX \
  --instrument-types stock,fund \
  --batch-size 500 \
  --column-batch-size 125 \
  --option-expirations 2 \
  --option-strike-distance-pct 30 \
  --ticker-pause-seconds 0.2 \
  --request-pause-seconds 0.5 \
  --skip-calculated-fields \
  --browser edge
```

The default run includes both common stocks and ETFs/funds over the selected minimum price, downloads the full TradingView stock field catalog in chunked requests, exports a separate options-contract CSV for the nearest two expirations per underlying inside a configurable strike band, and splits technical/calculated field families into a separate companion CSV. Use `--full-download` to pull the full NASDAQ/NYSE/AMEX universe with the configured indexes and options export. Use `--cboe-weeklys-only` to fetch the current Cboe Weeklys underlyings plus `SPX` and `VIX`. Use `--skip-calculated-fields` if you want to avoid fetching and writing the calculated field set entirely.

## Verify

```bash
polytheta-tradingview-verify \
  --project-root /absolute/path/to/polytheta
```

This reads the latest TradingView snapshot in `./data_trading_view/`, validates row counts and duplicates,
and compares the saved snapshot to the current live TradingView total for the same filters.

## Recover

```bash
polytheta-tradingview-recover \
  --project-root /absolute/path/to/polytheta
```

If the latest TradingView verification report is incomplete, recovery reruns the full snapshot with the
same saved filters to replace the partial result.

## Output Layout

- Current run: `./data_trading_view/`
- Prior runs: `./data_trading_view_history/<timestamp>/`
- Per-run flat CSV: `./data_trading_view/<timestamp>_tradingview_equities.csv`
- Per-run options CSV: `./data_trading_view/<timestamp>_tradingview_options.csv`
- Per-run calculated fields CSV: `./data_trading_view/<timestamp>_tradingview_calculated_fields.csv`
- Per-run JSON mirror: `./data_trading_view/<timestamp>_tradingview_equities.json`
- Per-run options JSON mirror: `./data_trading_view/<timestamp>_tradingview_options.json`
- Per-run calculated fields JSON mirror: `./data_trading_view/<timestamp>_tradingview_calculated_fields.json`
- Per-run manifest CSV: `./data_trading_view/<timestamp>_tradingview_manifest.csv`
- Per-run verification report: `./data_trading_view/<timestamp>_tradingview_verification.json`
- Cached stock field catalog: `./data_trading_view_history/tradingview_stock_fields.json`

All CSV filenames use a UTC prefix in `YYYY-MM-DD HH-MM-SS` format.

## Notes

- The downloader uses TradingView screener cookies from your selected local browser profile.
- Before writing a new snapshot, it moves the previous `data_trading_view/` contents into `data_trading_view_history/<timestamp>/`, leaving only the latest run in `data_trading_view/`.
- It refreshes the official stock-field catalog from [TradingView Screener field docs](https://shner-elmo.github.io/TradingView-Screener/fields/stocks.html) and caches the result locally.
- It also refreshes the official options-field catalog from [TradingView Screener option field docs](https://shner-elmo.github.io/TradingView-Screener/fields/options.html).
- The options CSV uses a verified, practical subset of the TradingView options fields rather than the entire published catalog, because some published options fields do not return stable bulk scan results.
- Because the full stock field set is large, it requests fields in chunks and merges each page back by ticker before writing the snapshot.
- The options export queries each downloaded underlying separately, keeps only the configured nearest expirations, and applies the configured strike-distance filter around the current underlying close.
- `--cboe-weeklys-only` fetches the current symbol set from Cboe’s Weeklys symbol directory and resolves those bare symbols to TradingView tickers before downloading.
- `--ticker-pause-seconds` pauses between per-underlying options downloads to reduce rate limiting during large runs.
- `--request-pause-seconds` pauses before TradingView and Cboe HTTP requests so the default run is less aggressive toward free endpoints.
- By default, technical/calculated indicator families such as `bb`, `donch`, `candle`, `adx`, `ema`, `macd`, `pivot`, `rec`, `rsi`, `sma`, `stoch`, `vwap`, and similar groups are split into a separate CSV so the main export stays easier to work with.
- `--skip-calculated-fields` omits those calculated families from the upstream TradingView requests and suppresses the calculated CSV/JSON outputs.
- `atr` stays in the main export.
- `gap...` and `time...` fields are excluded from both the main and calculated exports.
- `--column-batch-size` lets you tune the request chunk size if TradingView changes request limits.
