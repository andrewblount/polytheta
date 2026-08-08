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

- [ ] **Add polyspreads to Polytheta.** Polyspreads is a smart-execution
      engine: it enters a sell order inside the bid/ask spread and then
      chases the best fill — repricing about once a minute, walking from the
      favorable side toward the market until filled — instead of dumping the
      order at bid or hoping at ask. Lives in `schwab/polyspreads/` (Bun +
      React + Schwab order API). Why it matters here: basket credits are
      small ($0.12–$0.76) at large size, so captured spread is real money —
      $0.02 better on 344 contracts is ~$688 on one leg.

      Natural integration (closed loop):
      1. Polyspreads reads the week's basket (proposal file or site API) and
         prefills its queue with the six orders — Andrew reviews and starts
         it; Polytheta still never initiates execution itself.
      2. On each fill, polyspreads POSTs the actual price to
         `/api/mobile/trades` — the ledger fills itself, no manual entry.
      3. Slippage vs. the recommended credit becomes a tracked stat per leg,
         feeding the modeled-vs-actual view — and measures how much the
         chasing algorithm actually earns vs. naive fills.

      Prereqs: Schwab API credentials in `.env.local` (same blocker as
      actuals), and a decision on where it runs (it's a local web app —
      likely stays on the Mac, launched Monday mornings).
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

      **IBKR, decided.** Use the Client Portal Web API, not TWS. TWS needs a
      gateway process running locally with a session that expires and needs
      re-authenticating by hand, which is the wrong shape for anything on a
      schedule — the same weekly-token problem Schwab already imposes, twice
      over. Client Portal is OAuth and runs headless.

      Scope it as read-then-write, in that order: pull positions and fills
      first so IBKR accounts appear in briefings and the ledger alongside
      Schwab, and only add order placement once the read path has been right
      for a few weeks. Account mode (paper | live) from the item below has to
      exist before any IBKR write path, or paper fills contaminate the real
      track record. Nothing about this changes the rule that Polytheta never
      initiates execution on its own.
- [ ] **Paper vs. real account switching.** Add an account-mode concept
      (paper | live) on trades and snapshots so paper results never
      contaminate the real track record, with the mode visible in the apps and
      briefings. Verify first whether Schwab's API exposes paperMoney
      accounts at all — if it doesn't, paper mode may need to be a local-only
      ledger flag rather than a broker connection.
- [x] **Settled history: every past position clickable, showing its
      original thesis, what it actually did, and why.** Three parts that
      only pay off together, because the point is reading the reasoning and
      the result on one screen.

      1. *Join the data.* Entry thesis already exists per position in
         `baskets/<date>/data/basket_proposal.json` under `picks` (side,
         ticker, family, px, K, bid, ask, cr, iv, delta, atr, buf). Settled
         outcomes already exist via `netlify/functions/settle-weekend.mts`
         and `scripts/backfill_settled.mjs`. Nothing currently joins them.
         Write one settled record per position holding both, plus whether
         and when it breached the strike.
      2. *Show it.* The Basket tab already renders per-position decision
         cards (signals, weights, pass/fail, screen checks) and "Why this
         basket." Reuse that component in the Archive tab
         (`src/app/(app)/app/baskets`), position detail
         (`src/app/(app)/app/positions`) and the public site archive, with
         an outcome panel added: credit collected, settle price, modeled
         P&L, strike breach and when. Once real fills land in the ledger,
         the same panel carries actual against modeled.
      3. *Attach the post mortem.* Link each losing position to its autopsy
         (below), so clicking a loss shows what the system saw, what
         happened, and which guard has since been added for it.

- [x] **Generate an autopsy for every losing leg, and cover the put side.**
      Mostly done for calls and worth reading before starting:
      `docs/trade_autopsy_2026-05-11.md` already covers all four ITM call
      losses, validates across all 53 settled call legs (thrusty entries
      averaged −$4,133, calm entries +$7,070), and three fixes shipped on
      26 July off the back of it — the frenzy guard, Monday revalidation
      (`scripts/verify_basket_live.mjs`) and stop-breach alerts.

      What is left:
      - **The put side has never had this treatment.** The whole analysis
        above is call-only. Run the same method on settled put legs before
        assuming the same failure modes apply, because they probably do not.
      - **Make it a generated artifact, not a hand-written doc.** Every
        future loss should get an autopsy automatically, on the same four
        headings the FCEL one uses: what the system saw at entry, what
        actually happened, why the loss was that size, and whether it
        generalizes. Hand-written analysis does not survive contact with a
        busy month.
      - Test each shipped guard against the record it was built from, so
        the frenzy guard and revalidation are measured rather than assumed.
- [ ] **Modeled-vs-actual performance view** once real fills accumulate in the
      trades ledger — the slippage between what the system recommended and
      what actually filled.

---

- [ ] **Link each losing position's autopsy from its position page.** The
      autopsies exist as generated files in `docs/autopsies/`; the site
      does not surface them yet.

## Research

- [x] **Study missed opportunities to improve the evaluation system.**
      Done 8 Aug: `scripts/research/replay_rejections.mjs` →
      `docs/rejection_retro.md`. 1,490 rejected legs settled across 14
      weeks: the rejected pool was modestly profitable overall, frenzied
      rejects matched calm ones, and the 2x ATR floor rejected the best
      performing slice in the pool, which reads as capacity rather than a
      broken screen. Band untestable, the refined shortlists are already
      band-filtered. Modeled at expiry, no stops. The
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
- [x] **Review the ~21 uncommitted WIP files in `src/`** (UI polish + admin
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
