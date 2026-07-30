# Polytheta — Project TODO

Grouped by what's blocking each item. Anything under "Blocked on Andrew" needs
an account action, business attestation, or terms acceptance that can't be
delegated; everything else is buildable.

---

## Blocked on Andrew (account / legal actions)

- [ ] **SMS blocked by A2P 10DLC registration.** Test send returned Twilio
      error **30034** — "message from an unregistered number." US carriers
      require brand + campaign registration for application-to-person SMS on
      a 10-digit long code. Sends to this number also failed 30034 back in
      Jan 2026, so the account has never completed it. Register at Console →
      Messaging → Regulatory Compliance → A2P 10DLC (sole-prop brand is fine;
      ~$4/mo campaign fee; carrier approval takes days). Until then SMS fails
      silently and email/iMessage carry the load.
- [ ] **WhatsApp sandbox not activated.** Console → Messaging → Try it out →
      Send a WhatsApp message shows an "Activate Your Sandbox" terms dialog to
      accept, then join by texting the code to +1 415 523 8886. Bypasses
      10DLC, so it's the faster path to phone alerts. Sandbox sessions expire
      every 72h unless re-joined; a production sender needs Meta business
      verification.
- [ ] **Schwab actuals** — drop SCHWAB_APP_KEY / SCHWAB_APP_SECRET /
      SCHWAB_REFRESH_TOKEN / SCHWAB_ACCOUNT_HASH into `.env.local` to light up
      real account numbers in the daily briefings. Refresh tokens expire every
      7 days and renewal is interactive — accept the weekly ritual or automate
      a reminder.
- [ ] **TradingView login in Chrome** — the Monday scheduled task can set the
      watchlist and strike alerts automatically, but only once tradingview.com
      is logged in *in Chrome* (the desktop app is automation-read-only).
- [ ] **Neon housekeeping** — set an org spending limit; raise the polytheta
      project's restore-history window (currently 6h) now that the trade
      ledger lives there.

---

## Build queue

- [ ] **Add polyspreads to Polytheta.** `schwab/polyspreads/` is a working
      Bun + React options-ladder tool with its own engine, CSV import, and
      Schwab order plumbing — currently a separate project sitting in a
      gitignored directory. Decide the shape first: (a) fold its ladder/
      laddering engine in as a Polytheta feature, (b) keep it standalone but
      share the trades ledger and Schwab credentials, or (c) port only the
      order-construction logic. Note it can *place* orders, which crosses the
      line Polytheta currently holds (recommend + track, never execute) — that
      boundary needs an explicit decision before merging.
- [ ] **Broker integrations: thinkorswim, Robinhood, Interactive Brokers.**
      Worth knowing before starting: **thinkorswim is Schwab** (post-TD
      Ameritrade acquisition) — the Schwab API already scaffolded in
      `scripts/schwab_snapshot.mjs` and the ladder tool *is* the thinkorswim
      path, so that one is mostly done once credentials are in. IBKR needs
      either the Client Portal Web API (OAuth, no gateway) or TWS API (local
      gateway process — awkward for scheduled jobs). Robinhood has no
      supported public API; only unofficial reverse-engineered clients, which
      carry account-lockout risk — recommend skipping or treating as
      manual-import only.
- [ ] **Paper vs. real account switching.** Add an account-mode concept
      (paper | live) on trades and snapshots so paper results never
      contaminate the real track record, with the mode visible in the apps and
      briefings. Verify first whether Schwab's API exposes paperMoney
      accounts at all — if it doesn't, paper mode may need to be a local-only
      ledger flag rather than a broker connection.
- [ ] **Make historical entries clickable with thesis.** Partly done: the
      Basket tab already drills into per-position decision cards (signals,
      weights, pass/fail, screen checks) and "Why this basket." Remaining
      work is the *Archive* tab and the site's basket archive — make each
      historical basket and position open the same decision view, so a past
      trade can be read back with the reasoning that produced it.
- [ ] **Modeled-vs-actual performance view** once real fills accumulate in the
      trades ledger — the slippage between what the system recommended and
      what actually filled.

---

## Research

- [ ] **Study missed opportunities to improve the evaluation system.** The
      highest-value analysis left. Every week the pipeline screens hundreds of
      names and takes 6–8; the losers are already studied (see
      `docs/trade_autopsy_2026-05-11.md`), but the *rejected* names never are.
      Build a retro job that, for each past basket, replays the candidate pool
      (the shortlist CSVs are on disk per week), settles every rejected
      candidate at its expiry, and asks: which filter rejected the winners?
      Specifically test whether the frenzy guard, the 2× ATR put floor, the
      $8–$100 band, and the family cap each pay for themselves or cost more
      than they save. Same method as `scripts/research/sim_exit_policies.mjs`,
      pointed at rejections instead of entries.
- [ ] **IV-rank data source** (ORATS / Market Chameleon / other) so the
      80th-percentile IV-rank rule can run as written instead of the current
      HV-rank proxy.

---

## Maintenance

- [ ] **Maintain `baskets/thesis_overrides.json` weekly** (fan score,
      Glassdoor, buyback per candidate) — raises thesis coverage past 2/5, and
      the call-side buyback disqualifier only works when it's filled in.
- [ ] **Review the ~21 uncommitted WIP files in `src/`** (UI polish + admin
      from an earlier session) — commit or discard; they already caused one
      deploy failure via a hidden dependency.
- [ ] **iPad app install** fails with a developer-disk-image error — needs the
      iPad awake and unlocked, possibly an Xcode device-support update.
- [ ] **Rebuild the Python downloader venvs** after the repo rename
      (`bash scripts/rebuild_venvs.sh`) — only matters if the standalone
      TradingView/Yahoo downloaders get used again; the weekly pipeline
      doesn't depend on them.

---

## TradingView automation (detail)

Artifacts generate automatically each Monday
(`baskets/<date>/tradingview_watchlist.txt` + `tradingview_alerts.md`), and a
scheduled task applies them via the browser — blocked only on the Chrome login
above. Options if that proves fragile:

1. Chrome login + weekly browser task (works today; mild UI-drift risk).
2. Check whether TV's watchlist-level alerts collapse six per-name alerts into
   one.
3. Unofficial TV alert endpoints — research ToS/account-flag risk first.
4. Consider dropping TV alerts entirely: the system already emails and
   iMessages strike-cross attention levels and radar exit signals from its own
   hourly monitor. TV may be redundant except as a chart overlay.
