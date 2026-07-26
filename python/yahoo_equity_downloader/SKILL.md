# Yahoo Downloader Skill

Use this downloader when you need fresh Yahoo Finance equity snapshots with rotating current/history storage.

## Core commands

Install:

```bash
python3 -m venv python/yahoo_equity_downloader/.venv
source python/yahoo_equity_downloader/.venv/bin/activate
pip install -e ./python/yahoo_equity_downloader
```

Download:

```bash
python/yahoo_equity_downloader/.venv/bin/polytheta-yahoo-downloader --min-price 8
```

MCP server:

```bash
python/yahoo_equity_downloader/.venv/bin/polytheta-yahoo-mcp --project-root /absolute/path/to/polytheta
```

## Data layout

- `data/` contains only the latest run
- `data_history/` contains rotated prior runs
- `data/<TICKER>/` contains per-ticker CSV snapshots
- `data/<TICKER>/*_equity_fundamentals.csv` is the merged per-ticker quote + fundamentals snapshot
- `data/*_combined_equity_fundamentals.csv` is the run-level consolidated file

## Notes

- The downloader uses `yfinance.screen`, `Ticker.info`, `Ticker.history`, and `Ticker.option_chain`.
- It selects the nearest and second-nearest future expiries as the current and next-week options snapshots.
- Price history defaults to `period=max`.
- If a field such as capitalized software impairments is unavailable from Yahoo data, the output leaves it blank rather than inventing a value.
