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

## Twilio delivery (code done 2026-07-28, blocked on account setup)

Credentials are wired (Netlify env + .env.local) and both channels are coded
and toggleable per category in the apps. Two carrier/vendor gates remain —
both require Andrew personally (business attestations / terms acceptance):

- [ ] **SMS blocked by A2P 10DLC registration.** Test send returned Twilio
      error **30034** — "message from an unregistered number." US carriers
      require brand + campaign registration for application-to-person SMS on
      a 10-digit long code. Note: sends to this number also failed 30034 back
      in Jan 2026, so the account has never completed it. Register at
      Console → Messaging → Regulatory Compliance → A2P 10DLC (sole-prop
      brand is fine; ~$4/mo campaign fee; carrier approval takes days).
      Until then SMS silently fails and the other channels carry the load.
- [ ] **WhatsApp sandbox not activated.** Console → Messaging → Try it out →
      Send a WhatsApp message shows an "Activate Your Sandbox" terms dialog
      that must be accepted, then join the sandbox from WhatsApp by texting
      the join code to +1 415 523 8886. WhatsApp sandbox bypasses 10DLC
      entirely, so it's the faster path to phone alerts. Sandbox sessions
      expire every 72h unless re-joined — a production WhatsApp sender needs
      Meta business verification.
- [ ] Schwab actuals: drop SCHWAB_APP_KEY / SCHWAB_APP_SECRET /
      SCHWAB_REFRESH_TOKEN / SCHWAB_ACCOUNT_HASH into .env.local to light up
      account numbers in the briefings. Schwab refresh tokens expire every
      7 days — needs the ladder tool's interactive auth weekly, or accept
      manual refresh.

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
