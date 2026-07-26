# Polytheta Yahoo Downloader

Python subproject for downloading Yahoo Finance equity, options, and fundamentals data into the repository `data/` and `data_history/` folders.

## Install

From the repository root:

```bash
python3 -m venv python/yahoo_equity_downloader/.venv
source python/yahoo_equity_downloader/.venv/bin/activate
pip install -e ./python/yahoo_equity_downloader
```

## Run

```bash
polytheta-yahoo-downloader --min-price 0
```

Optional flags:

```bash
polytheta-yahoo-downloader \
  --min-price 0 \
  --max-tickers 20000 \
  --history-period max \
  --symbol-source cboe_weekly \
  --cboe-weeklys-with-indexes \
  --ticker-pause-seconds 1.5 \
  --request-pause-seconds 0.75 \
  --tickers AAPL,MSFT,NVDA
```

Default discovery now uses Cboe's weekly options symbol directory, so the downloader focuses on symbols with weekly options. Before writing the root-level run files, the downloader retries missing or incomplete symbols up to 3 times.
The default pacing is intentionally conservative: it pauses between ticker downloads and before upstream SEC/FINRA/FRED/Yahoo request groups so the collector is less likely to trip rate limits or abuse free endpoints.
Use `--cboe-weeklys-with-indexes` when you want the Cboe weekly-options universe plus the Yahoo index aliases for `SPX` and `VIX`.

The downloader now also enriches the market snapshots with:

- Cboe Weeklys universe snapshots
- FINRA short-interest data
- SEC EDGAR filing-derived buyback and radar flags
- SEC fails-to-deliver spike signals
- public macro snapshots for `VIX`, `SKEW`, `HY OAS`, equity put/call ratio, and a Treasury-volatility MOVE proxy
- modeled option `delta` and `probability_of_touch`
- rolling 252-observation ATM IV percentile built from archived option snapshots

Set `POLYTHETA_SEC_USER_AGENT` to a contactable identifier before heavier SEC usage. Example:

```bash
export POLYTHETA_SEC_USER_AGENT="PolythetaDataCollector/1.0 (contact: you@example.com)"
```

## Verification

Every download now writes a verification report JSON into `./data/` after the run completes.

You can also verify the latest snapshot manually:

```bash
polytheta-yahoo-verify \
  --project-root /absolute/path/to/polytheta \
  --min-price 0 \
  --max-tickers 20000 \
  --symbol-source cboe_weekly
```

If a run is incomplete, recover the missing or incomplete symbols from the latest verification report:

```bash
polytheta-yahoo-recover \
  --project-root /absolute/path/to/polytheta \
  --batch-size 500
```

## Output Layout

- Current run: `./data/`
- Previous runs: `./data_history/<rotation_timestamp>/`
- Per-ticker snapshots: `./data/<TICKER>/`
- Per-ticker merged equity snapshot: `./data/<TICKER>/<timestamp>_equity_fundamentals.csv`
- Run-level files by dataset: `./data/<timestamp>_<dataset>.csv`
- Consolidated equities file: `./data/<timestamp>_equities.csv`
- Run-level JSON mirrors: `./data/<timestamp>_<dataset>.json`
- Run-level verification report: `./data/<timestamp>_download_verification.json`
- Normalized source-signal export: `./data/<timestamp>_signal_snapshots.csv`
- Macro snapshot export: `./data/<timestamp>_macro_signals.csv`
- Filing signal export: `./data/<timestamp>_filing_signals.csv`
- Short-interest export: `./data/<timestamp>_short_interest_signals.csv`
- Social/FTD export: `./data/<timestamp>_social_signals.csv`
- Provider health export: `./data/<timestamp>_provider_status.csv`

All CSV filenames use a UTC prefix in `YYYY-MM-DD HH-MM-SS` format.

## Cron

Example cron entry:

```cron
15 6 * * 1-5 cd /absolute/path/to/polytheta && /absolute/path/to/python/yahoo_equity_downloader/.venv/bin/polytheta-yahoo-downloader --min-price 8 >> /tmp/polytheta_yahoo_downloader.log 2>&1
```

See also [`cron.example`](./cron.example).

## MCP Server

The project includes a local stdio MCP server that exposes the latest downloaded CSV data.

Run it directly:

```bash
polytheta-yahoo-mcp --project-root /absolute/path/to/polytheta
```

Useful for MCP clients such as Codex and Claude Code because it provides tools for:

- listing downloaded tickers
- listing current/history files for a ticker
- reading the latest consolidated fundamentals snapshot
- previewing recent price history
- previewing current and next-week options snapshots

If your MCP client supports stdio server registration, use this command:

```bash
/absolute/path/to/python/yahoo_equity_downloader/.venv/bin/polytheta-yahoo-mcp --project-root /absolute/path/to/polytheta
```

An example registration file is included at [`mcp.example.json`](./mcp.example.json).

## Tests

```bash
python -m unittest discover python/yahoo_equity_downloader/tests
```

## Skill Notes

See [`SKILL.md`](./SKILL.md) for a lightweight workflow reference that agents can follow when using the downloader outputs.
