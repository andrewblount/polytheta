# Polytheta — Project TODO

## TradingView automation (added 2026-07-27)

**Goal: fully automated weekly watchlist + strike alerts in TradingView, no
manual steps.** Current state and blockers:

- The Monday build generates `baskets/<date>/tradingview_watchlist.txt` and
  `tradingview_alerts.md` automatically.
- A scheduled assistant task (Mon 08:50) applies them via the browser — but
  it needs TradingView logged in **in Chrome**, which it currently is not.
  One-time login unblocks it.
- The TradingView **desktop app** is logged in, but macOS grants automation
  only read access to it (no clicks/typing) — not a usable path.
- TradingView has **no public write API** for alerts/watchlists. Options to
  investigate, roughly in order of promise:
  1. Log into tradingview.com in Chrome once and let the scheduled browser
     task do it weekly (works today, mild UI-drift fragility).
  2. TradingView webhook-less alert import — check whether TV's
     "alerts on watchlist" or multi-symbol alert features reduce the per-name
     clicking to one alert for the whole list.
  3. Unofficial TV alert API endpoints (used by some open-source libs) —
     research stability/ToS risk before touching; account flag risk.
  4. Reconsider whether TV alerts are needed at all: the system already
     emails + iMessages strike-cross attention levels and radar exit signals
     from its own hourly monitor. TV may be redundant except as chart overlay.

## Other open items

- [ ] Maintain `baskets/thesis_overrides.json` weekly (fan score, Glassdoor,
      buyback per candidate) — raises thesis coverage past 2/5; the call-side
      buyback disqualifier only works when this is filled in.
- [ ] IV-rank data source (ORATS / Market Chameleon / other) so the 80th-
      percentile IVR rule can run as written instead of the HV-rank proxy.
- [ ] Modeled-vs-actual performance view once real fills accumulate in the
      trades ledger (Trades tab) — slippage between recommendation and
      execution.
- [ ] Review the ~21 uncommitted WIP files in `src/` (UI polish + admin from
      an earlier session) — commit or discard; they've already caused one
      deploy failure via a hidden dependency.
- [ ] Polytheta app on the iPad — install fails with a developer-disk-image
      error; needs the iPad awake/unlocked and possibly an Xcode device
      support update.
- [ ] Neon: set an org spending limit and raise the polytheta project's
      restore-history window (currently 6h) — both are dashboard clicks,
      Andrew's account decisions.
- [ ] Rebuild the two Python downloader venvs after the repo rename
      (`bash scripts/rebuild_venvs.sh`) — only matters if the standalone
      TradingView/Yahoo downloaders are used again; the weekly pipeline
      doesn't depend on them.
