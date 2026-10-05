# GPB MyLeague — Handover

Updated 2026-10-05. `HEAD` is `e68dc29`, the working tree is clean, and this file
is tracked.

**This revision is a catch-up, not a rewrite.** The previous one stopped at
`ae3d07d` and everything below it — storage, metrics, run value, the boards — is
still accurate. But **115 commits have landed since**, and they did not extend the
existing subsystems. They built four new ones:

| Landed | What it is |
|---|---|
| **The HXSE** | A share-price market with its own valuation, Monte Carlo playoff probability, five-archetype crowd, and a long-only position ledger |
| **The headliner newsroom** | Six named sideline reporters filing against the day's results, with a priority carousel |
| **Park factors** | Three phases, and a measured answer: the engine can take them, and it broke the totals market doing it |
| **Leaders + splits** | The Dashboards route, quadrant plots, and a split explorer |

Plus the work that most recently changed what a session should believe: the
**MacroBet board rebuild** (the props board was showing 135 rows for 69 distinct
questions), **postseason elimination** (eliminated clubs were still being priced
all October), the **MVP race closure** (five weeks earlier than before, and then
a fix to the closure itself), and the **bracket UI pass**.

Five claims in this file were wrong before this revision and are corrected below,
each marked **CORRECTED** with what it used to say. The navigation section was the
worst of them.

**Three numbers worth having before you read anything else**, all re-measured
today rather than copied forward:

- **`tsc --noEmit` reports 10 errors**, unchanged since the UX phases began, all
  in files this work never touched. That is the baseline, not a regression.
- **`tools/` now holds 116 scripts**, up from 37. Four of them are **injection
  gauntlets** that re-inject a known bug and assert the suite catches it. See
  [Verification state](#verification-state).
- **The forecaster Brier band has shifted and one entry is now a coin flip.**
  Nine forecasters, re-fitted across five outlets; see
  [The forecaster pool](#the-forecaster-pool-nine-outlets-re-fitted).

The prop work since is recorded under [Player props](#player-props). It is the
largest single subsystem added after the betting layer, and it changed two things
about how this app is reasoned about: settlement reads the play log rather than a
box score, and the three outlets tilt props by a **modelling choice** that is
explicitly not a measured character property. Both are easy to misread from the
code.

The prop work since is recorded under [Player props](#player-props). It is the
largest single subsystem added after the betting layer, and it changed two things
about how this app is reasoned about: settlement reads the play log rather than a
box score, and the three outlets tilt props by a **modelling choice** that is
explicitly not a measured character property. Both are easy to misread from the
code.

**Six things have landed since, and four of them change what this file should say.**
The storage layer was rebuilt after measuring that localStorage quota pressure was
destroying the play log; the offline metric layer was added and verified, and that
work turned up a live bug in the Slugging leaderboard where the board's total-bases
formula had drifted from the accumulator's; the park-factor question is now
**settled by measurement** — there are none, and wRC+ must be park-neutral — which
removed a large planned chunk of work; **Stage B added wOBA fitted to this league and
a park-neutral batter-only wRC+**; the four deferred metric boards shipped; and wRC+
was then **measured and deliberately kept off the leaderboard**. See
[Storage](#storage-the-play-log-was-being-destroyed),
[Metrics](#the-offline-metric-layer),
[Run value](#run-value-woba-fitted-here-and-a-park-neutral-wrc-02b90f0),
[Boards](#the-four-deferred-metric-boards-8fb2610) and
[Open questions](#open-questions-for-the-user).

Two of those findings reshape work that has not started, and both were corrections
to claims this file previously made. **A season is not a pure function of its
universe seed**, because `generateSchedule` shuffles dates with an unseeded
`Math.random` — so league-level constants must be measured, never stored. And
**wOBA precision tracks home run count, not plate appearances** (+0.807 vs −0.048),
which matters for any sample-size floor anyone writes next.

## Source design document

`C:\Users\ADMIN\.opencode\plan\gpb-ux-overhaul.md` — the Interface &
Navigation Revitalization proposal, Revision 1. It remains the design authority
for the UX work. It does **not** cover the media, betting, exchange, newsroom or
leader modules, all of which were built without one.

Where this file and the proposal disagree, this file records what was actually
built and why; the proposal has not been edited.

The `opencode/plan` folder holds the proposals for everything that landed after
the UX phases. **One of them is marked SUPERSEDED and must not be built**:
`gpb-award-ballot.md` describes an exploit, not a market. Its banner is the
explanation. `gpb-macrobet-hxse.md` is the HXSE design and its Phase 0–4 exit
lists are all closed; `gpb-postseason-newsroom.md` covers the newsroom.

## Navigation — CORRECTED, this file was wrong

**This section previously described a seven-folder rail with `Betting` under
LEAGUE and `Scores` under SCORES. Both are wrong, and both were wrong because a
session read them instead of reading `folders.ts`.**

The rail is now five folders, and the grouping is a considered decision rather
than an accident — the reasoning is at `folders.ts:79-118` and is worth reading
before moving anything:

```
PLAY          Dashboard · The Media · MacroBet · Exchange
SCORES        Results · Schedule
LEAGUE        Standings · Leaders · History · Map
TEAMS         Rosters · Players
PLAYOFFS      Bracket
COMMISSIONER  Simulate · Trades · Free Agents · Draft · Lottery · Offseason
SYSTEM        GPB Engine · System Logs · Settings
```

The folder count is still seven and that part of the old section was right. What
changed is **which leaves sit where**, and two of them were renamed.

Three corrections that each have a reason worth not undoing:

| Was | Now | Why |
|---|---|---|
| LEAGUE › Betting | PLAY › **MacroBet** | Media, betting and the dashboard were asked for as one group, and "Betting" beside a screen headed with the MacroBet wordmark was two names for one page |
| SCORES › Scores | SCORES › **Results** | The rail printed "Scores" twice within three lines, which is the same fault MacroBet had |
| *(absent)* | PLAY › **Exchange** | The HXSE is its own destination, **not** a fifth tab inside MacroBet. MacroBet already stacks four sub-views; putting the market under the bookmaker would have made it a feature of the book |

**`BettingRecordScreen` has no `NAV_FOLDERS` leaf and must not get one.** It is
reachable only from the slip, by design. `VIEW_TO_FOLDER` maps it only so
auto-expand knows which folder to open. The missing leaf is the mechanism that
keeps it off the rail — this is the single most "obviously broken" thing in the
file and it is correct.

## Commits

Newest first. `77fa260 Ver 0.0.10` is the last non-UX commit.

**Not pushed.** `local` is **39 commits ahead of `origin/local`**. Everything below
is local only.

### The recent run — verification, exploits, and the crowd

| Commit | Scope |
|---|---|
| `e68dc29` | Close the last open crowd check, by moving the constant to where the fade happens |
| `02f7ea8` | Four bracket complaints, and gold was crowding out what it was crowding |
| `f9726c1` | The price ceiling was never missing. The check was asserting the bug. |
| `4a31516` | The crowd's largest share was not the largest, and two checks were hiding it |
| `f04caed` | Make two dead checks run, and make six stale ones honest |
| `d384a64` | Fix the MVP closure derivation, which the running app found and the suite could not |
| `709cb5e` | Postseason elimination, and the MVP races closed at the end of the regular season |
| `cca675c` | Rebuild the season awards popup on the design system |
| `25cbcca` | Cleanup: mark the ballot plan as the exploit it was, drop two dead portraits |
| `b637fde` | Close the "bet on an already-decided race" exploit, and settle league champions from the series |
| `978e64d` | Betting board overhaul: dedupe props, redesign Next Slate, forecaster bylines |
| `79c45a3` | The Exchange gets MacroBet's hero header, sized by the logo rather than by eye |
| `ed12a33` | Two probes that killed my own proposal, and one of them found the risk I tried to invent |
| `7135eec` | The HXSE book follows you: a portfolio drawer in the header, beside Parlays |
| `d3660a3` | Trade in dollars: "I want to own $150 of the Nighthawks" |
| `137a4de` | Season settlement: the compounding bound, and the book moves up to App |
| `b8d5d60` | The chart axis steps instead of clipping a premium off the top of the plot |
| `4d972ab` | Measure freezing instead of proximity to a constant |
| `11e17b4` | Give price room to disagree with its own fair value |
| `5eb8d5e` | Measure whether any club ever pins at the $1000 ceiling |
| `8bc3c3f` | Chart 680 → 480: the taller chart was showing empty panel, not market |

### The HXSE — build, then the trading desk

| Commit | Scope |
|---|---|
| `7e5adfc` | The trading desk: buy, sell, and a book that survives a reload |
| `0a8253c` | HXSE positions: a long-only ledger that cannot drift by a cent |
| `a140919` | HXSE portfolio persistence: cash derived on load, corruption reported not swallowed |
| `d55477d` | Measure whether the HXSE is tradeable before putting a buy button on it |
| `101720c` | Exchange: open on a club, dollars to the cent, a legend, and headroom |
| `da608bb` | Exchange: two columns, a 680px chart, and the roster in a rail |
| `158d69c` | Exchange: the league's price board, all 32 crests at 340px |
| `e3b5976` | Exchange: club crests, the league mark, and the HXSE wordmark |
| `34cf7f3` | Exchange: compare two clubs on the same axis |
| `bc4fdd4` | Exchange: stop stretching the chart, and restore the ledger on every boot path |
| `977ffad` | Measure when the Exchange is actually worth looking at |
| `78f5b31` | Finish the Exchange: hover readout, range control, and an honest header |
| `ac73ee4` | Pin the futures-risk season, and report the check it was hiding |
| `cfd79c2` | Let the Exchange drill down to one club |
| `f28c76f` | Give the Exchange a fair-value line, and break it where the record stops |
| `a81c130` | Scintilla crosses to the forecaster side, and the pool is re-fitted |
| `9a960b2` | **Make the HXSE survive a reload (CHECKPOINT)** |
| `ea875e2` | Rename the SCORES leaf to Results so the rail stops printing Scores twice |
| `4f34669` | Scaffold the Exchange page, and find that the price ledger never reaches the save |
| `8a38382` | HXSE part 1: the price chart geometry, and the check that proves it is not lying |
| `e8d4fd7` | Continue the market across worker runs instead of reopening it at fair value every time |
| `a7e52c8` | Wire the HXSE price path into the worker day loop and the save |
| `61a669f` | Price the day on the interactive step path too |
| `a3e84f8` | Wire the crowd into the price path on both the worker and the interactive step |
| `bcece36` | Have the crowd check assemble the crowd through the shipping function |
| `9059fdf` | Make the crowd check call the shipping consensus instead of its own copy |
| `3dd725a` | Measure the crowd on the real price path, and report that the fade edge is negative |
| `9dda170` | Add the crowd: five archetypes, and an honest report that the fade edge is marginal |
| `e593810` | Derive club market size and liquidity; measure it is not a strength proxy |
| `9acd8ce` | Set the daily Monte Carlo cadence from measurement, and fix a look-ahead bias |
| `3cc83f3` | Wire the HXSE price series to a live league day |
| `d8f54f3` | Add the HXSE share price series, its persistence, and deterministic bet ids |
| `5daeb3d` | Fit the team-value weights against realised win totals; open the index gate |
| `1816d21` | Add playoff probability by Monte Carlo over the remaining season |
| `4a87ded` | Add HXSE team valuation function and value-weighted index |

### The forecaster pool — eight outlets, then three institutions

| Commit | Scope |
|---|---|
| `e710161` | Collapse the six renamed outlets into three institutions and one solo channel |
| `434dc9b` | Fix `fitMediaOdds` reading a frozen roster, then measure how stable its output is |
| `b907597` | Re-fit all eight slopes and derive confidence from measured Brier |
| `6785094` | Eight forecasters: five profiles, five real reads, calibration state made visible |
| `7be50c1` | Build the five new forecasters' marks as WebP, and correct the plan's premise about them |
| `702f31a` | Weight the forecaster consensus by confidence, before the five new outlets land |
| `64b4f4a` | Group the three screens you read, and assert the tree agrees with itself |

### The newsroom

| Commit | Scope |
|---|---|
| `b977a41` | Rebuild Fuyuka's byline mark from the new art, and loosen the crop |
| `61d4d5d` | Move Fuyuka Shinonome from forecaster to sideline reporter |
| `09ac813` | Move the award race into the right column, loosen Hoani's crop, rebuild the dossier |
| `7173893` | Remove a stray `);` from the newsroom, put the newsroom in the wide column |
| `7673aaf` | Take the reporter wallpaper out of the dashboard byline and leave it in the dossier |
| `6c84664` | Give the sideline reporters a backdrop and a dossier you can open from the byline |
| `c2850c3` | Add Simon Hoani, and the coverage check that makes his reason for existing testable |
| `7cd97be` | Give reporters an outlet and turn `house` from a dead grey token into a real accent |
| `0d3b80a` | Add Fuyuka Shinonome as a ninth outlet, and use the supplied wallpapers |
| `eb486f7` | Wire Gary Sallow's wallpaper into the outlet card |
| `97541bc` | Give the character popup the portraits, and check the right files are wired in |

### Park factors — three phases and a measured answer

| Commit | Scope |
|---|---|
| `ad7ca65` | Wire park factors into the engine, and measure them until one of them broke the totals market |
| `f9ed408` | Measure the park channels instead of arguing about them |
| `6800abf` | Measure the run factor before recalibrating it, and find it was not the problem |
| `a613291` | Assert on the identified part of the park signal, and report the cancellation it finds |
| `5104769` | Park Phase 3: HR, FB, GB and run factors, calibrated against ten archetypes |
| `e3da8ec` | Park Phase 2: derive the physical profile, and a physics check validating a copy |
| `c31e28f` | Park profiles for all 32 clubs, in fixed mode |

### Leaders, splits, and the dashboard

| Commit | Scope |
|---|---|
| `f54ddc3` | **Correct** the split derivation cost: 0.31s, not the 8.42s reported last time |
| `f9fdac7` | Give every board the same column header, and the header the dashboard's hero |
| `d326642` | Fill the empty decks: 54 to 120, and retire nine templates that could never render |
| `9efc974` | Split explorer: does this player hit the same everywhere? |
| `f508097` | Replace the Glorest Press mark, and recover the trim rule instead of guessing it |
| `fb867e7` | Leaders Phase 3: the two quadrant plots, and a comment the tests caught being false |
| `02299a9` | Measure the splits derivation before building it: 8.4s, and it reconciles exactly |
| `16fb200` | Leaders Phase 2: the Dashboards route, with the league's own shape on it |
| `260b24e` | Leaders Phase 1: the context layer, and a typecheck hole I had to close first |

### MacroBet, props, and the betting board

| Commit | Scope |
|---|---|
| `d5a81d3` | Density pass: media, betting, and the dashboard front page |
| `d89dfbf` | Slate and props to columns; props now name their game; dead counters removed |
| `48ab839` | The slip names its bets too: three surfaces, one answer |
| `17c1f00` | A placed bet now names its game and its date |
| `b0a24ad` | Rename the page MacroBet, and give every betting card one border language |
| `b104ef6` | One box per card, and the outlets are the columns |
| `452df7d` | Rebuild the slate as a two-team tile, and stop the shape check reading comments |
| `82ff515` | A render loop in the futures lookup, which froze the page |
| `7b39cad` | Fix the blank page: BettingSlip was missing two props at its call site |
| `59082bd` | `verifyPropCardDiversity`: replicate the overlap gate, fix a dead affinity term |
| `a733934` | Team props: built, measured, and **not enabled** |
| `a44700b` | Resolution dates, and four new prop lines that survived the gate |
| `e3cf87d` | New prop lines, first batch: two rejected, and a gate the plan was missing |
| `a6d05af` | Outlet prop cards: fifteen distinct props, and the cap was never the defect |
| `b43fe01` | Championship futures: the title market, and a risk curve that had to be built |
| `11d0799` | Futures: measure the fade claim before shipping it, and finish elimination |

### Headliners, feedback loop, and handover

| Commit | Scope |
|---|---|
| `894e835` | Record where run value ended up, and close Open Question 10 |
| `5b04780` | Headliner steps 8–10: the ledger, the panel, and a played season |
| `c8dc4fb` | Headliner stages 1–3: event detection, the voice banks, the pipeline |
| `9df0cde` | Extract the play-log walk so the persona pipeline can share it |
| `ee2b65c` | Headliner newsroom: portraits, persona registry, portrait primitive |
| `36c881e` | Give each writer a standing opinion, and measure where the banks are thin |
| `e4e4308` | Record the feedback loop and its standing caveat |
| `a3d2068` | Let a measured season influence player development |
| `bdcc0d0` | `verifyDevelopmentFeedback`: replicate both sides, fix a statistical error |

### Before this run

| Commit | Scope |
|---|---|
| `ae3d07d` | Put wRC+ on the player card, which is where the compression can be explained |
| `c83d466` | Measure whether wRC+ is presentable on a leaderboard before building one |
| `8fb2610` | The four deferred metric boards, and one that was silently broken on the way |
| `2db19ad` | Track PHASE_HANDOVER.md in git |
| `02b90f0` | Stage B: wOBA fitted to this league, and a park-neutral wRC+ |
| `454cde2` | Stop the slugging board from disagreeing with the OPS beside it |
| `e7272d2` | Derive season metrics from counts, and verify them against the engine |
| `a8da0d9` | Measure whether this simulation has park factors, and settle the wRC+ question |
| `5d072a6` | Stop localStorage quota pressure from destroying the play log |
| `370a0c6` | Present props on the media and betting pages, and make them bettable |
| `490bded` | Price and settle player props, with the model fitted rather than guessed |
| `b48e800` | Prove player props can settle from a saved league |
| `8fb0f78` | Refresh free agency before every sim; a completion receipt |
| `250f6d1` | Fix the table drift properly, and the two headers that were lying |
| `7b5d827` | Lift the slip into the shell; settlement off the Betting screen |
| `1495537` | Chevrons, a gold sweep, and two dashboard rebuilds |
| `e3f968d` | Betting: give the house a real margin, make the futures board a forecast |
| `7d9f711` | Betting: four crashes and three pricing bugs, found in a browser |
| `300e223` | Betting layer: markets, wallet, Betting screen |
| `1c2ec47` | Media: published lines for the next slate, one switchable club table |
| `8e638fa` | The Media: three forecasters, a live read, where they disagree |
| `0cd5059` | Strip every panel eyebrow; clean roster and player lists; crawl hover |
| `9b0d1a8` | Raise the whole type scale; rebuild headline and World Series |
| `08e7bc0` | Bigger crests; one-line panel headers; retokenise History |
| `e655921` | Slow the score crawl to a third of its speed |
| `6fb7111` | Move the crawl to a global scoreboard ticker |
| `8bf321c` | Remove the selected-team strip; migrate the broadcast crawl |
| `5172de8` | Roomier rows; fix the black Prestige tab; drop the FA subtitle |
| `3f342a2` | `NoPlayersGate`: a way back from a playerless league |
| `440d64d` | Standings: one league at a time, larger rows, unplated logos |
| `7d19322` | UX Group E: simulation centre and game screen |
| `af37142` | UX Group D: club and player screens |
| `33f2151` | UX Group C: decompose the front page, unify award scoring |
| `626c3b3` | UX Group B: the commissioner cluster |
| `9a18a1c` | UX Group A: TeamLogo into the system, chrome-frame the radar |
| `05a6185` | Phase 2.3: rebuild the playoff bracket |
| `785c2d2` | Phase 2.2: replace the Leaders carousel with a dense board |
| `81224ea` | Phases 0–2.1: design system, folder navigation, Standings |

## What is done

### Phase 0 — foundation

- `src/index.css` — navy/gold token system, type scale, three surface
  elevations, radius hard rule, zero-blur shadow ladder, motion tokens, skew
  geometry, and the skew-shadow wrapper that stops `clip-path` clipping a bevel.
  Two font families only: Saira Condensed and Barlow.
- `src/components/ui/` — the primitive set and a barrel: `Panel`,
  `PanelHeader`, `SkewedPanel`, `SkewedTab`, `RetroButton`,
  `SegmentedControl`, `StatTable`, `StatValue`, `Meter`, `LeagueBadge`,
  `SectionTitle`, `TeamLogo`, `MediaMark`.
- `src/components/UiKitGallery.tsx` — dev-only route rendering every primitive.
  It is an `AppView` named `ui_kit`, deliberately **excluded from
  `NAV_FOLDERS`**. There is no nav button for it.
- `src/logic/statFormatting.ts` — the formatting authority. `fmtAvg` and `fmtPct`
  are deliberately separate implementations, not aliases.
  `formatBattingAverage` is a `@deprecated` re-export kept alive only because
  unmigrated screens still import it; delete it when the last one lands.
- `src/navigation/folders.ts` — seven folders, twenty leaves. `AppView` lives in
  `src/types.ts`. **Betting** was added to the LEAGUE folder. `betting_record`
  is mapped in `VIEW_TO_FOLDER` but has **no** `NAV_FOLDERS` leaf — see the slip
  section for why that is deliberate.
- Type scale raised ~15–20% globally across a full-season playthrough; crawl
  slowed to 9 px/s; all panel eyebrows removed except where noted under Open
  Questions; roster and player lists cleaned of per-row crests.
- Chevron, `parallelogram` and `arrow-tag` utilities in `index.css` plus
  `src/components/ui/Chevron.tsx`; `gold-sweep` / `gold-edge` for the sidebar's
  left-to-right hover flash.

### Phases 1–2 and Groups A–E

Shell, navigation, Standings, Leaders, Playoffs, HomeDashboard, TeamLogo
retokenisation, the commissioner cluster, club and player screens, and the
simulation centre and game screen are all rebuilt and committed. The full
component-by-component detail that used to live here has been compressed; the
commit messages carry it, and each names what it changed and why.

### Not UX work, but landed since

Two subsystems that are not part of any UX phase and each have their own section
below, because each is easy to break and neither is obvious from reading the
code: the **storage rebuild** ([Storage](#storage-the-play-log-was-being-destroyed))
and the **offline metric layer** ([Metrics](#the-offline-metric-layer)). The park
factors measurement that settles the wRC+ design has its own section too. All
three are verified; the metric layer's addition also fixed a live bug on the
Slugging leaderboard.

### Dashboard polish (`1495537`)

Fixed a headline showing one club's crest over another club's score; crest
176→240px. **Featured Matchup became Featured Odds**, carrying the house
moneyline with 96px crests, city names, and a split warning where the two sides
disagree. This is a deliberate substitution — the old panel was the least
informative thing on the front page and it was above the fold.

### Simulation fixes (pre-UX baseline work)

Two real simulation bugs found by measurement, not by reading:

1. **1–0 scores are forfeits.** `completeBrokenGameByFinal` /
   `completeBrokenGameByForfeit` in `gameEngine.ts` scored a participantless game
   as `max(loser, winner+1, 1)` = 0–1, home always winning. Measured 94/94 games
   at 0–1 with an empty pool, mean 1.00 runs/game; 7.43 after repair.
2. **`NoPlayersGate`.** An empty player pool is unplayable and had no exit —
   `onGeneratePlayers` was implemented and threaded through the router with zero
   UI consumers. The gate is blocking and non-dismissible; Generate Players is
   now paired with Terminate Universe.

## Table geometry — read this before touching any list

This cost the longest debugging session in the project and the cause was not
where the symptom appeared.

**A fixed `chrome-bar` height of 38px is not negotiable** without re-cutting every
panel's bevels in the app. Therefore, when a title bar's contents are too tall,
**the contents are wrong, not the bar.**

**Decoration must never go inside a table.** `tr.chrome-bar` is
`position: static` with `content: none` on both pseudo-elements.

### The drift bug, and what actually caused it

`position: relative` on a `<tr>` takes that row out of the table's column-width
algorithm. The header row then sized itself independently of the body, and every
column after the first inherited the error. `StatTable.tsx` puts `chrome-bar` on
a `<tr>`, which is where the rule came from.

Measured header-vs-body left-edge deltas across six tables **before** the fix:
141, 65, 42, 41, 39, 235px. After: 0, 0, 0, 0, 0, 0.

Two things went wrong while fixing this, both recorded so they are not repeated:

- **A padding change credited with the fix was a coincidence.** An earlier commit
  tightened padding and the drift appeared to go. It had not. The real cause was
  the `position: relative`.
- **The diagnostic that should have caught it passed the whole time.** Cell
  *counts* agreed 6/6 at every step, which is what disguised the fault. So did
  downscaled screenshots — columns can be 235px out and still look plausibly
  aligned at reduced scale.

**Never verify table alignment by cell count or by a downscaled screenshot.**
Measure per-column `getBoundingClientRect().left` deltas between the header row
and the body. The harness now reports exactly that.

Sweep after the fix: Dashboard, Standings, Leaders, Scores, Schedule, Rosters,
Players, Free Agents, The Media — 15 tables, max drift 0 everywhere.

### Headers that were lying (`250f6d1`)

- **Rosters** carried a `TEAM DIRECTORY` eyebrow and printed the club name three
  times on one screen. Eyebrow removed, crest plate's city+name lines removed,
  crest 112→160px on the 200px column, `Prestige · Central` eyebrow removed
  (duplicated by the Division/League tiles).
- **Players was titled "Rosters"** — a different screen — and held a four-tile
  grid *inside* the 38px chrome bar. Tiles were ~60px, so they broke out of the
  bar background and flex-wrap stranded the heading with nothing. This is the
  clearest example of the 38px rule being violated by content volume rather than
  by styling. Replaced with inline `HeaderFigure` label-and-number pairs at
  module scope (`Showing 1282 · Of 1282 · Signed 928 · Season 2026`), a divider
  between the scope buttons and the club crests, and a 40px trailing mask on the
  crest scroller so a mid-crest hard edge reads as scrollable.
- **Free Agency's offer-interest column** had no explicit width and collapsed to
  one crest, stacking six vertically — ~250px rows on a 154-player list. Given
  `26ch`.

## The media module

Three AI forecasters publishing opinions on a 32-team league. Presentation only;
no simulation behaviour is touched.

- `src/data/media.ts` — the three characters: weights, thesis, stated weakness,
  voice, confidence, accent. No image imports.
- `src/lib/mediaReads.ts` — per-outlet 32-team reads, raw scores plus the
  spread denominators, and the disagreement table.
- `src/lib/mediaOdds.ts` — moneyline for the next slate. Re-exports the odds
  maths from `markets.ts`; there is exactly one probability-to-price conversion
  in the codebase.
- `src/components/media/` — the page, cards, sortable tables, odds slate.
  Images in `src/assets/media/`, used as card mastheads and square mark chips.

**Verified.** Accuracy over 8 seasons × 2 seeds: The Booth ρ 0.65–0.73, Glorest
0.57–0.58, Lined Sharply 0.29–0.38. Odds calibration over ~4,800 priced games:
Booth Brier 0.2467 and Glorest 0.2477 both beat a 0.250 coin flip; Sharply
0.2561, deliberately worse, because his overconfidence is a designed, exploitable
number rather than a claim. Guards: `tools/verifyMediaReads.ts`,
`tools/verifyMediaOdds.ts`, `tools/fitMediaOdds.ts`.

**Known and deliberately left:** the three outlets price strong favourites 2–8
points too high in the middle bands. This is mostly Sharply's designed
overconfidence bleeding into the consensus. It is the exploitable thing a bettor
is meant to hunt, so it is not smoothed away. The 65%+ tail has only ~79 games
and must not be read as signal.

## The betting layer

A Betting nav leaf beside The Media. The split is deliberate: **The Media is
the outlets' opinion, Betting is your stake against it.** Both read the same
`buildMediaReads`, so a price cannot appear in one and be hidden in the other.

- `src/lib/markets.ts` — the framework. One construction for every price: each
  forecaster states a fair value, the house takes the mean of the *fair values*
  (never the mean of prices) and applies a margin. Two shapes, because two kinds
  of question exist — field markets (moneyline, futures, awards) and line
  markets (totals, first five).
- `src/lib/mediaMarkets.ts` — futures and totals. The run model is centred on
  this simulator's measured environment, 3.83 runs per team-game against a real
  4.28, so a game totals ~7.7 here.
- `src/lib/wallet.ts` — balance, slip, settlement, persistence. Two rules
  enforced in the module rather than the UI: a bet locks when placed, and only
  games completed *after* that can settle it. Games settle from the final score,
  first-five from the line score the engine already persists, season markets from
  archived history. No bet needs a result the simulation does not already record.
- `src/components/betting/` — the screen, three tabs: Next Slate, Season
  Futures, Awards. `BettingPage` now *consumes* a `slip` prop and no longer owns
  the wallet.

### Measured constants, and why they are what they are

Every one of these was fitted against settled games, not chosen.

| Constant | Value | Basis |
|---|---|---|
| `HOME_ADVANTAGE_LOGIT` | 0.04 | Sim home win rate is 49.9–51.4%, not real baseball's 53–54% |
| `FIRST_HALF_SHARE` | 0.5718 | Read off the persisted line score of 4,814 completed games, not assumed |
| `TOTAL_LINE_CENTRE` | 0.92 | Fitted against the model's *own* total with the half-run grid applied |
| `LINE_MARGIN` | 0.25 runs | Priced at the measured ~3-run spread of a game total |
| `HOUSE_SHADE` | 0.20 | Mildest shade where both flat strategies lose on every seed tried |
| `FUTURES_TEMPERATURE` | 8.0 (score units) | Reads name the right division winner 62.5% vs 25% for a blind pick |

**Slopes stay as fitted, deliberately.** Hollis 0.30, Glorest 0.25, Sharply
**0.80**. The first two are Brier optima. Sharply's fitted optimum is 0.25 — he
posts roughly 3× what the data supports, which is what makes him fadeable. That
is a character, not a bug, and `HOUSE_SHADE` exists so the *house* can be safe
without editing him.

### The four classes of bug this layer shipped with

All four survived a clean build and a clean `tsc`, which is the argument for
having driven a browser. Each is documented at the point it was fixed.

1. **The screen never painted.** Settlement was committed with
   `if (settled !== wallet) onWallet(settled)` inline in the render body — a
   setState on the parent fired while the child rendered.
2. **A bet was computed and thrown away.** `confirm()` called `placeBet` and
   never assigned the result. The slip cleared, a confirmation appeared, the
   balance never moved.
3. **Every bet voided itself on placement.** `resultFor` had no "pending" state,
   so a bet on an unplayed game took the same branch as an abandoned one and was
   refunded immediately.
4. **The award race threw on open.** It reads `Map`s keyed by player id; the app
   stores arrays. It type-checked because `AwardInputs` is not exported.

Plus three pricing bugs: the moneyline's second side was the negation of the
first (a zero-vig pair, sums to exactly 1.0000); the vig was charged twice, in
the line *and* the price; and prices were derived from the unrounded line while
bets settled against the rounded one.

And one that only a screenshot could show: **Season Futures opened with every
club at exactly +143.** The read index is a *rank* rescaled 0–100, so inside a
division it always spans exactly 100 points whether the clubs are miles apart or
dead level. It discards the strength gap by construction. Futures now read the
raw score.

## The global betting slip (`7b5d827`)

An e-commerce-cart panel that slides in from the right, auto-opens on add, and is
reachable from any screen. This moved a lot of authority out of `BettingPage`.

- `src/hooks/useBettingSlip.ts` owns the wallet, the pending selection, the
  stake, the open flag, and place/withdraw/settle. It is mounted once, in the
  shell.
- `src/components/betting/BettingSlip.tsx` — the panel. Escape closes it, focus
  moves in and is returned on exit. A bet is withdrawable until its game is
  played.
- `src/components/betting/BettingRecordScreen.tsx` — the record, as AppView
  `betting_record`. **Reachable only from the slip**, by design. It has no
  `NAV_FOLDERS` leaf; `VIEW_TO_FOLDER` maps it only so auto-expand knows which
  folder to open. The missing leaf is what keeps it off the rail — do not "fix"
  that by adding one.
- **Settlement moved to the shell**, as a single effect in `App.tsx` keyed on the
  game list. A bulk month-end sim now settles forty bets in one pass, and
  settlement no longer depends on the Betting screen being mounted at all.
- **Parlays** button top-right, replacing both the notification bell and the
  LOCAL database status readout, carrying the open-bet count. Nothing was
  orphaned: the bell's view is System Logs and still has a nav leaf.

**The global slip is deliberately NOT a parlay.** Every leg is a separate stake
settling against its own result. See Open Questions for why parlays are not
specced.

## Simulation housekeeping and the completion receipt (`8fb0f78`)

### The free-agency market now refreshes before every sim

It used to be a button a manager had to remember to press. Nothing in a save
recorded whether it had been run, so a league could sit for weeks playing against
static rosters while unsigned talent went to waste. Every simulation now passes
through `runSimulationTarget` in `App.tsx`, which runs the shake-up first.

Three structural consequences, all deliberate:

1. **One implementation, not two.** `handleFreeAgencyShakeUp` gained a `silent`
   option and now *returns* its result. The simulation entry points were moved
   ~100 lines to sit **below** `useRosterTransactions` so the funnel can reference
   it. Two call sites would have been two sets of rules about when the market is
   open, and a stats-nerd manager would notice them disagreeing.
2. **Silent mode writes nothing and sets no state.** The result is handed to the
   engine as `playerStateOverride`. Going through `setPlayerState` would have been
   silently wrong: React state is async, so the engine's closure would still hold
   the pre-shake-up rosters, the days would be played against them, and the closing
   snapshot would overwrite the shake-up with no error anywhere. The worker's
   message contract is unchanged; only the value sent in it changes.
3. **A run blocked by an offseason gate does not shake up.** Nothing is simulated
   in that case, so moving rosters would be a change to a league that did not move.

Measured decay over three consecutive single-day sims: **24, then 3, then 0
signings.** The market drains rather than running dry forever.

### The receipt

`src/components/simulation/SimCompletePanel.tsx` — slides in from the right, on
the same axis as the betting slip so the two share a direction and a vocabulary.
Reads *"N days simulated and events completed through DATE"*, with games played
and free-agent signings below.

Every figure is counted, not inferred. **The day count comes off the date plan
handed to the worker**, so "One Week" is measured at seven days rather than
assumed to be it. Games come from the worker's own tally. Signings come from the
market refresh.

Three details worth preserving:

- **The signings row is hidden at zero.** A run that finds no upgrades is the
  normal case for most of the season; a permanent "0" row on every single-day sim
  teaches a manager to stop reading the panel.
- **It fires on the transition into `'complete'`**, not on every render where the
  status happens to be `'complete'`. The run state is replaced with a new object on
  each update, so keying on the object alone re-fired it on every subsequent
  write. A second guard consumes the pending-run ref, so even a reset between runs
  cannot produce a duplicate report.
- **It is cleared when a new run starts.** Otherwise the previous run's day count
  and signing figure sat on screen through the whole next run — not wrong, but
  about a simulation that was no longer the one running, which is worse because it
  still looks authoritative.

## Player props

Three commits: `b48e800` (settlement gate), `490bded` (the model), `370a0c6` (the
UI). Read this section before changing anything in `src/lib/playerProps.ts` or
`src/lib/mediaProps.ts`. Two of the decisions below look like mistakes from the
code alone and are not.

### Props settle from the play log, not from a box score

A completed game does **not** persist a per-player box score. It leaves the engine
as a `playerStatDelta`, which is folded into season aggregates and discarded. So
there is nothing to settle against on a saved league. `game.stats.playLog` is the
only on-save record with enough per-player detail.

`tools/verifyPlayLogProps.ts` is the authority for the counting rules. Use it
directly rather than re-deriving. Two of the engine's rules are easy to get wrong
and both were verified exact (14 of 14 fields at 100.00% across seed 20261 × 12
days — 168 games, 3,024 player-games — and seed 777 × 20 days, 2,910 pitching
lines):

- An `ERR` on a reached base scores the runner but credits **no RBI**.
- A `BB` is a plate appearance **without** an at-bat.
- Hits are credited only on `1B`/`2B`/`3B`/`HR`. `rbi` goes to `batterId` only when
  `rbi > 0`. Each id in `scoringPlayerIds` scores exactly one run.

`propStat` / `propPlayerId` / `propLine` are **stored on the bet**, never looked up
at settlement, so a bet stays resolvable after trades, rate rebuilds and renames.

A prop **voids** when the player is unreadable. A completed game whose play log
cannot be read is a genuine void, not a wait: the game is over, so the answer will
never improve.

### Two layers, and the second one is a modelling choice

A fitted, calibrated base rate per player/stat/line (`playerProps.ts`), then a
per-outlet tilt on the logit scale (`mediaProps.ts`). The tilt is the outlet's
standardised club score — a z-score against the field, capped at ±1.5σ — times
`PROP_TILT` (hollis 0.10, glorest 0.08, sharply 0.26; ratios inherited from the
fitted moneyline slopes 0.30/0.25/0.80 with magnitudes cut to roughly a third).

**This tilt is a modelling choice, not a measured character property.** It is
stated as such in the `mediaProps.ts` header. Do not cite it as evidence that
Sharply is better or worse at player props — nothing in the fit supports that.

There is no matchup, platoon, park or hot-hand modelling, because the engine models
none of these either.

### Props publish a ladder of lines, half lines only

One line per stat made the board bimodal by stat — every hits prop landed at 65%
(safe) and every runs prop at 30% (hot), with the middle band empty. The stat
decided the label; the player did not. So each (player, stat) publishes a ladder.

Half lines only, for two reasons. The ladder emitted "over 1 Hits" beside "over 0.5
Hits" at the same price, and whole-number totals are decided by ties and splits
rather than by the line. `Math.max(1, Math.ceil(line))` — over a half line is a
**ceiling, not a rounding**.

`selectOutletProps` picks 3 safe + 2 hot, one per player, at most
`MAX_PROPS_PER_OUTLET = 5` per outlet per day, with a deterministic tiebreak.

### The fit, and what it actually shows

`tools/fitPropLines.ts` is the authority for the fitted constants. Seed 4242 × 70
days, 959 games, **107,016 prop observations**.

| | Fitted | Held out (seed 90210 × 60 days) |
|---|---|---|
| Per-stat Brier | 0.2194 | 0.2216 |
| Pooled Brier | 0.2251 | — |
| Safest fifth realised | 65.3% | 63.3% |
| Hottest fifth realised | 23.7% | 24.0% |

Every calibration bucket is within 4 points. Thin data holds: under 5 games,
predicted 0.444 / realised 0.458. `SAFE_PROBABILITY_FLOOR = 0.48` and
`HOT_PROBABILITY_CEILING = 0.35` were cut where that distribution changes, not
chosen for looks.

`pitcherStrikeouts` is fitted at `priorGames: 8` against 96 for every other stat.
That is the fit's own finding about a role proxy, flagged in code, and left as
measured rather than smoothed to match the rest.

### The two counting traps in this model

- **`propStatMaps` must use `getPreferred*ByPlayerId`.** `playerState.battingStats`
  and `pitchingStats` hold one row per player per season year per season phase.
  Indexing by `playerId` directly silently keeps the wrong row. `BettingPage`
  already uses the helpers.
- **`pitchingDenominator`** uses `gamesStarted` when `gamesStarted * 2 > games`,
  else `games` — a role proxy for innings, since a bullpen's appearances are
  fractions of an inning.

### Props in the UI

`usePropBoard` builds the board **once**, shared by the media and betting pages.
Two independent builds would drift on season aggregates, the slate date or a score
spread, and the drift would be invisible — a receipt for a line that no longer
appears anywhere. It also makes agreement mean something: the three outlets choose
from one set of markets, so a prop two outlets both picked is a prop they agree on.

Safe props are green-bordered (`--color-pos`), hot orange (`--color-warn`).

`SlipEntry` and the slip's `confirm` path carry the prop terms. Without them a prop
staked through the slip was accepted, deducted, shown as pending, and then **voided
at completion** — silently refunding a bet the manager thought they were on, with no
error anywhere. `resultFor` treats a prop with no stat, no player or no line as
unresolvable.

### `strictFunctionTypes` is off — pass objects, not positional arguments

The tsconfig does not enable `strictFunctionTypes`, so parameters are checked
bivariantly. A two-argument function assigned to a one-argument slot type-checks
cleanly and then **silently discards the second argument at runtime**.

This shipped: `MediaHub` passed the outlet as a second positional argument into
`focusProp`, which takes a single object, so `focusedProp` received a bare prop-id
string with no outlet on it. The betting page keys its rows by outlet *and* prop,
so it matched no row. Nothing failed — no type error, no console error, no crash.
The highlight simply never appeared. As a single object the same mistake is a
missing or misspelled property, which is reported in either strictness mode.

**When a callback crosses a module boundary and its identity matters, pass an
object.** `tsc --noEmit` will not catch the alternative.

### The prop rows are keyed by outlet *and* prop

The same prop is published by up to three outlets, and the betting page renders one
row per outlet. Keyed by prop id alone, a ref map keeps only the last row
registered, and arrival scrolls to the bottom outlet's copy with the clicked one
315px above the fold. Rows carry `data-prop-row` and `data-focused` so a probe can
name a row from outside — without it, "the highlight landed on the wrong copy" and
"the highlight did not land" are indistinguishable and both read as the same 0.

## Storage: the play log was being destroyed

`5d072a6`. Read this before touching `src/lib/storage.ts` or anything that reads
`glb_games`. The short version: **localStorage retains one slate of play logs, not
a season.** That is a measurement, not a preference, and it is the ceiling a 5 MB
origin allows once the league state takes its measured 1.48 MB.

- `src/lib/localGamesMirror.ts` (new) — the bounded mirror. Owns the quota
  constants, `measureOccupiedUnits`, `measureGamesBudgetUnits`,
  `gamesBudgetFromOccupiedUnits`, `envelopeStats` and `buildLocalGamesMirror`. It
  lives here rather than in `storage.ts` so the browser test and the app run the
  same function instead of two implementations that can disagree.
- `src/lib/storage.ts` — `saveLocalLeagueState` rewritten: scalar keys first, full
  payload to IndexedDB, guarded envelope-only fallback to localStorage.
- `tools/verifyLocalGamesMirror.ts` — 21 checks, PASS.
- `tools/verifyStorageBudgetBrowser.mjs` — CDP quota round trip, PASS.
- `tools/probeStorageBudget.ts`, `tools/probeMirrorAccounting.ts` — the
  measurement base.

**The retention rule, because it is easy to get subtly wrong.** Grouped by
**date**, not by game, all-or-nothing per field, `playLog` before `participants`.
A date may be only partially filled in exactly one case: when it is the *newest*
date and the whole thing cannot be afforded. Measured at 14/14 play logs and 14/14
participant snapshots on the newest date of a 2,592-game projection, 1 of 180 dates
covered, origin 4,946,846 of 5,242,880 units, 95.5% of budget used — the remaining
4.5% is deliberately unspent rather than fragmented. In the browser: newest slate
16 of 16 play logs, origin 4,424,815 units, 818,065 headroom, build 27 ms, write
10 ms.

**Why one slate is the right answer rather than a shortfall.** Dropped play logs
void props outright (`wallet.ts:169`), kill headlines, and break interactive replay.
Same-slate props and headlines are exactly what the retained slate serves, and it is
the *newest* slate, so today's games still settle. Older games remain reachable from
IndexedDB, which is the store of record.

Retention depth varies run to run (14–17 logs) because the engine is unseeded. **The
invariant is whole-slate coverage, not a fixed count.** Two verifier traps worth
not repeating: a strict "prefix" retention check is wrong — the real invariants are
date-grouped all-or-nothing plus one allowed trailing partial on the newest date
(`replayBuckets` is newest-first, so the trailing edge is index 0); and an
empty-retention run passes *every* fits-in-quota assertion while settling nothing.
Seeding localStorage over pre-existing app keys also makes nominal-size arithmetic
wrong — assert against the origin's real non-games total instead.

Measured sizes in UTF-16 code units: a full game runs 94,357–94,661 with a p95 of
109,202; of that, `playLog` is 60,540 (63.8%), `participants` 33,254 (35.3%),
`lineScore` 345, and the envelope-only stub is 174. JSON escape inflation is
1.123x, so the cost model measures serialized length rather than a parsed shape.
The accounting gap is exactly 0.

**Five real bugs were found and fixed during this work**, all of which had been
shipping silently: a stale-spread clobber; interleaved budget accounting; a
split-cost undercount; a fixed-fraction budget; and stranded-slate ordering, where
the old per-game retention order charged `participants` — needed only for
interactive replay — before the next game's `playLog`, which pays out. Measured
consequence: 2 of 14 games logged on a second slate, a fragment that settles
nothing.

## The offline metric layer

`e7272d2` and `454cde2`. `src/lib/analytics/metrics.ts` derives BABIP, ISO, XBH,
total bases, BB%/K%/K-BB%, K/9, BB/9, (K-BB)/9, KBB, WHIP, ERA and per-game rates as
pure functions of **integer counts**. No engine change, no new persisted field, and
nothing a forecast reads, so forecaster and prop output is byte-identical.

BABIP, ISO, K − BB% and XBH are now on the batting boards (`8fb2610`) — see
[The four deferred metric boards](#the-four-deferred-metric-boards-8fb2610).

**Every rate must be derived from counts, never from the stored rate.** The season
rows store pre-rounded figures — `avg` and `ops` to 3dp (`playerStats.ts:125-126`),
`era` and `whip` to 2dp (`:150-151`). Recomposing ISO as `slg - avg` from stored
values inherits rounding error in each, and sorting ERA by the stored value ties two
pitchers who are in truth 0.01 apart. Rounding happens once, at display.

**Division by zero returns `null`, never 0.** A player with no at-bats has an
*undefined* average; reporting 0.000 would rank them at the bottom of a board as
though they had gone 0-for-0, which is a different and false claim. For the same
reason the module returns each binomial proportion's standard error alongside the
proportion, so a caller can choose its own precision floor and be able to say what
that floor is worth.

Definitions are **transcribed** from the engine, each annotated with the line that
makes it true, because a later engine change would silently invalidate one. Three
consequences are load-bearing:

- `atBats === plateAppearances - walks` exactly, which is why the on-base
  denominator *is* plate appearances.
- An `ERR` is an at-bat but not a hit, so a reach on an error is a ball in play.
- `hits === singles + doubles + triples + homeRuns` exactly.

### The slugging bug this layer exposed

`LeadersHub.tsx` recomputed total bases, with a comment claiming the formula was
copied from `playerStats.ts` *"so a leaderboard can never disagree with the OPS it
sits beside"*. It was not the same expression:

```
playerStats.ts:116-117   singles + 2·2B + 3·3B + 4·HR   →   hits + 1·2B + 2·3B + 3·HR
LeadersHub.tsx:46        hits + 2·2B + 3·3B + 3·HR
```

The difference is exactly `(doubles + triples)`. Expanded by hand it is easy to be
wrong about which side is correct, so `tools/probeTotalBases.ts` measures it: it
recovers the engine's own SLG from the persisted OPS by subtracting the separately
computable OBP, then checks which candidate reproduces it. Over 30 days the
accumulator formula matched for **every** player and the board's for **none** of the
307 with extra-base hits; worst overstatement **0.250** in SLG, one player reading
.906 against a true .757. Confirmed in the live app against 309 stored rows, where
the accumulator matched 309/309 and the board's 76/309.

Because the error scaled with doubles and triples, it inflated precisely the hitters
a slugging board exists to rank. The fix delegates to the shared module, so there is
now one SLG in the codebase and the board cannot drift from OPS. Verified in the
browser: module SLG agrees with the accumulator to 0.000000 on all 309 rows.

**The generalisable lesson, and it is the reason the module exists.** Two formulas
for one quantity, one of them wrong, and a comment asserting they were identical.
This is the same shape as the storage bugs and the props bugs in this file: nothing
errors, the number is just wrong. Centralise the definition rather than patching
the copy.

### Verification

`tools/verifyMetrics.ts` — 10 checks, PASS. The strongest compares log-derived
counts against **the engine's own accumulator**: each game's `participants`
snapshot holds every batter's line from *immediately before* that game
(`simulationManager.ts:707` reads it to build the snapshot, `:719` applies the
delta), so snapshot-at-last minus snapshot-at-first telescopes into the engine's real
arithmetic with no per-game alignment needed. 336 players, 3,360 fields, all
identical.

The hit and run checks are labelled for what they prove. The engine **already
throws** if accumulator and box score disagree (`gameEngine.ts:1036`, `:1040`), so
those invariants hold for every completed game and are not independently confirmed
here. What is tested is that the *serialized play log* agrees with the accumulator,
which the engine's guard does not cover — both could be wrong the same way and the
guard would still pass. That matters because every split view and this metric layer
read the log.

Measured over 620 games: **BABIP 0.282, AVG 0.246, BB% 0.088, K% 0.185, mean player
ISO 0.147** — all pooled as totals over totals, never averaged across players, since
unweighted averaging of rates is a different quantity and disagreed with the pooled
figure by 0.12 R/G in the park-factor probe. `tools/probeOutcomeMix.ts` measures the
distribution behind BABIP: 50% of at-bats are outs, 18% strikeouts, 1% errors.

The leaderboard sample floor is **derived, not chosen**: 82 at-bats, the sample size
at which a binomial proportion's standard error reaches 0.05 at this league's
measured 0.282 BABIP. That 0.05 target is a stated design choice and is labelled as
one. Measured at 45 days it admits 16 more qualified batters (284 vs 268 under the
old unexplained 120). The pitching floor is 20 outs — a convention, labelled as
such rather than dressed up as fitted.

### Three bugs in the metric layer itself

All would have shipped plausible-looking numbers, and all are recorded because the
diagnostic failures are the useful part:

1. **BABIP computed as balls-in-play ÷ at-bats**, which measures the share of
   at-bats that are *in play*, not the share of in-play balls that are *hits*. It
   reported **0.768** where 0.277 is correct. The impossible value is what caught
   it — the argument for printing measured league rates, not only asserting
   identities. The verifier now asserts the exact numerator and denominator,
   because a range assertion passes both versions.
2. **Runs credited only to the batter.** The engine scores every id in
   `scoringPlayerIds` (`gameEngine.ts:848`), so a runner coming home on someone
   else's at-bat scores while the batter is a different player. Crediting only the
   batter reported accumulator totals roughly 3× too low, caught on 320 fields.
3. A fabricated function call and a misnamed field, caught by `tsc` before running.

### What is deliberately absent, and why

Each was considered and left out because the data to compute it correctly does not
exist. None is recoverable by a cleverer formula, and each is the kind of metric
that looks cheap to add and would then be quietly wrong.

- **FIP, HR/9, anything needing home runs allowed.** The season pitching row has no
  HR-allowed field. It is derivable from the play log, but the play log is a bounded
  mirror holding one slate, so a season figure is not available.
- **FIP additionally** needs HBP — which has **no outcome at all** in this
  simulation — and IFFB, which needs batted-ball data that does not exist. Two of
  FIP's five inputs are unavailable, so a fitted FIP would be mostly invented.
- **Quality start** needs team run support, which is a team-level quantity the
  player rows do not carry. A raw completion rate published under that name would
  overstate what it measures, which is the specific failure the rest of this list
  is guarding against.
- **Situational splits of any kind** (go-to, with-RISP, vs LHP, count) need base
  occupancy and handedness at the moment of the plate appearance, which live only in
  the play log. A season split computed from a one-slate mirror would be a one-day
  split wearing a season label. Accumulating split counters as games are played would
  fix it, but that means changing `src/logic/playerStats.ts`, outside the
  presentation-only scope.
- **Home/away splits.** See below — measured as noise-dominated.

### The engine already collects what a wOBA fit needs

Discovered while planning Stage B, and it changes how that work has to be done.

`GameEngineProbe` (`gameEngine.ts:792-799`) exists for exactly this problem, and
its own header says so: *"questions about scoring cannot be answered from the box
score, because the box score records what happened to hitters and never what
happened to runners already aboard."* `recordProbeAtBat(session.bases, outcome,
runsScored)` at `:1388` is called with the **pre-at-bat** base state — the engine
comments on this at `:1386` — and the probe accumulates `runsByOutcome` and
`plateAppearancesByOutcome`. It is inert unless `startGameEngineProbe()` is called,
persists nothing, and ordinary simulation pays nothing for it. `leagueLab.ts`
already drives it.

So the regression for wOBA is **already instrumented through a supported API** and
needs no engine change to read. It does need one *additive* change to be usable:
the probe collapses base state, keeping `baseCounts` as a marginal over occupancy
and `runsByOutcome` as a marginal over outcomes, but never the **joint**. An HR with
bases loaded is therefore indistinguishable from an HR with bases empty, and a
fitted HR weight would absorb the runner context instead of the hit. The fix is a
`runsByOutcomeAndOccupancy[outcome][0..3]` table alongside the existing
accumulators — additive, inert, and inside a diagnostic that was designed for this.

This is a much smaller ask than the batted-ball model, which needs a *destructive*
change to at-bat resolution: a batted-ball profile is gone by the time the play log
is written. Both still require the standing scope relaxation, in separate commits.

Two supporting findings from the same pass:

- **`simulateGame` in `simulation.ts:140` is dead code** — zero importers. The
  season path is `simulationManager.ts:711 -> simulateGameToFinal` in
  `gameEngine.ts`. Its Poisson run simulator and its `Math.random` calls never run
  during a season. Do not read it as the season simulator.
- **The outcome weights do not read base state.** `getOutcomeWeights` (`:470-522`)
  takes the session but consults only pitcher fatigue, defence quality, batter and
  pitcher form, team edge and the home bonus. So outcome probabilities are
  *mechanically* independent of occupancy — but the fit still controls for it,
  because that independence is a claim about the weights and the runner context it
  produces (`scoreChance`, `:771`) is real.

## Park factors: there are none, and wRC+ must not adjust for them

`a8da0d9`. This was the open question that would have shaped wRC+, and answering it
removed a large chunk of planned work. It was **settled by measurement**, not by
reading the code.

Reading `gameEngine.ts:481` says there is exactly one home-field term: a single
global `homeFieldAdvantage` added to the outcome weights, with no per-team or
per-park input anywhere. But reading is not measuring, and one mechanism can hide
per-team variation — a uniform shift moves every batter toward hits, and *which*
hits it produces depends on the batter, so a slugging-heavy roster could plausibly
gain more at home than a contact-heavy one. So `tools/probeHomeAwayFactors.ts`
measures each team's home-minus-away run rate and tests whether the spread across
teams exceeds sampling noise.

**It does not.** Sum of squared z-scores across 32 teams is **31.3 on 31 df**,
against 46.19 at 5% and 53.49 at 1%. The observed spread of 1.581 R/G between most
and least home-favourable is fully accounted for by a typical per-team SE of 0.453.
Mean z is −0.273, so no team systematically gains at home either. **wRC+ is
park-neutral by construction and must not park-adjust.**

The null is reported with its **power floor**, not as a bare claim: this sample would
reject at 95% for per-team factors of **0.31 R/G or larger**, with roughly even odds
at 0.3. Real ballparks do not approach that, and the model has no per-park term to
begin with. This is a conclusion about effects above a stated floor, not a proof that
every park is identical.

**The home-field setting is a separate, real finding.** Pooled over 2,464 completed
games, home 3.666 R/G vs away 3.806 — a difference of **-0.141**, paired SE 0.081,
n=2464, z -1.75 — where the setting intends roughly +0.02 R/G. This is **not**
reported as an away-field advantage: three runs gave -0.133, -0.165 and -0.002, so
the sign is not stable and |z| stayed under 2. The honest reading is that home and
away are **noise-dominated** in this league. The intended +0.02 R/G is about a
quarter of the paired standard error a season provides, so the setting cannot be
observed at this scale — meaning it is not doing what its label implies in
CommissionerSettings. Correcting it means changing weight coefficients in
`gameEngine.ts`, outside the presentation-only scope, so it is
**reported rather than fixed** — the user's explicit decision. A line-score
cross-check agrees with the final score to 0.004 R/G, confirming home is credited to
the bottom half, so this is not a run-crediting inversion.

Two earlier versions of that measurement were wrong in ways that would have been
reported as findings, and both are recorded in the probe: averaging per-team rates
unweighted is a different quantity from the pooled figure whenever teams play
unequal home games (it disagreed by 0.12 R/G), and reconstructing a per-game delta by
repeating a team's season rate once per game understated the SE badly enough to
produce a z of -27 for a sub-run effect.

Those three runs were independent *universes*, not independent seeds — this file
previously recorded them as non-deterministic seasons. See the corrected
held-out-sample guardrail. The measurement is unaffected, because a null result
cannot be manufactured by choosing a different universe.

## Run value: wOBA fitted here, and a park-neutral wRC+ (`02b90f0`)

Stage A recomputed rates the engine already stored. This adds the run-value layer on
top: how many runs a counting line was worth, and how that compares to the league.

- `src/lib/analytics/woba.ts` — seven fitted weights, `runsCreated`, `woba`, and
  `leagueRelativeWoba`.
- `src/lib/analytics/wrcPlus.ts` — `leagueBaseline`, `wrcPlus`, batter side only.
- `tools/fitWobaWeights.ts` — the fit, on two seeds with three replicates.
- `tools/verifyWrc.ts` — 22 checks, all passing.

### The weights are fitted, not transplanted

FanGraphs publishes BB 0.689, 1B 0.884, 2B 1.261, 3B 1.601, HR 2.072 against MLB.
This league is not MLB and the difference is not noise, so the fit reads off each
outcome's conditional mean of runs scored, **holding runners aboard as a control**.
That control is not a refinement: `getOutcomeWeights` (`:470-522`) does not read base
state, so outcome probabilities are mechanically independent of occupancy — but a HR
with bases loaded scores differently from one with bases empty, and without the
control the HR coefficient absorbs the league's average runner context and reports it
as the value of the hit.

Shipped constants, the mean over three 90-day replicates at seed 4242:

| category | weight | replicate range as % of mean |
| --- | --- | --- |
| OUT_OR_ERR | 0.0035 | 18.07% |
| SO | 0.0000 | n/a |
| BB | 0.0405 | 18.32% |
| 1B | 0.1800 | 3.85% |
| 2B | 0.2807 | 6.17% |
| 3B | 0.6497 | 11.54% |
| HR | 1.7048 | 2.07% |

The ranking-carrying weights (HR, 1B, 2B) are pinned to 2-6%. BB and OUT_OR_ERR swing
~18%, because their weights are a small numerator over a large count and move on a
handful of scoring events. Three replicates fixes the *direction* of every weight; it
does not make the small ones exact, and the header says so.

### The schedule is not seeded, and that is why replicates exist

`generateSchedule` shuffles game dates through `shuffleArray`
(`simulation.ts:193-200`), which calls `Math.random`. So a universe seed fixes **who**
the players are and never **when** they play. Two runs at seed 4242 over 90 days gave
a BB weight of 0.0403 and 0.0367 — a 9% swing from schedule order alone.

This corrects an earlier claim in this file. The at-bat engine *is* fully
deterministic given its universe (zero `Math.random` in `gameEngine.ts`; every draw
via the seeded LCG at `:35-38`, seeded at `:1107` from the game's own identity), but a
season is not a pure function of its seed, because the schedule is drawn separately.
The previous "a season is a pure function of its universe" was true of the engine and
false of the season.

Consequence for the metric: **league wOBA cannot be a stored constant.** Measured
across runs it came out 0.0948, 0.0933, 0.0897 and 0.0920 — about 5%. A fixed divisor
would bias every player by up to 5% depending on their league's schedule draw, on a
100-centred scale that is the entire width of the gap between a strong hitter and an
average one. Worse, a common divisor cannot reorder a leaderboard, so it would look
correct while every printed number was wrong. `leagueRelativeWoba` therefore takes the
league value as an argument, and `wrcPlus` takes a measured `LeagueBaseline`.

### OUT and ERR ship as one category

`PlayerSeasonBatting` has **no `errors` field**, so a season batting line cannot
distinguish a retired-on-an-error from any other out. It is recoverable from the play
log, but that log is the bounded one-slate mirror, so there is no season-long version
to recover it from.

"OUT or ERR" is therefore the outcome a season row can actually measure, and wOBA is
only computable over measurable categories. The weights fit that partition. Fitting
the eight outcomes separately and *then* discovering errors are unreachable would ship
a constant no player could ever earn, which is worse than folding: a dead constant
reads as a live one. The eight-way split is still printed as a diagnostic — the folded
weight is small but **not zero**, because errors reach on with a runner aboard often
enough to score occasionally.

Using the probe's league wOBA as the wRC+ denominator while scoring players without
error credit would have depressed every wRC+ in the app systematically.

### wOBA precision tracks home runs, not sample size

The least obvious measured property of the metric, and it drives the shrinkage design.
Substituting `n_j = PA * p_j` into the multinomial variance reduces it to

```
Var(wOBA) = [ sum_j w_j^2 * p_j * (1 - p_j) ] / PA
```

so precision depends on the player's own **outcome mix** as well as on PA, and home
runs dominate the numerator: `w_HR^2` is 2.906 against 0.032 for a single. Measured
across qualified players:

| correlated with wOBA standard error | Spearman |
| --- | --- |
| home run **count** | **+0.807** |
| plate appearances | **-0.048** |

Sample size is essentially uninformative about how well wOBA is measured. So a 600-PA
slugger hitting .050 carries *more* wOBA variance than a 100-PA contact hitter hitting
.010, and is shrunk harder for it. That is correct — the slugger's wOBA rests on ~30
home runs whose own count is noisy — but it means **shrinking on plate appearances
would have got this exactly backwards**. The shrinkage follows the standard error.

This took three attempts to establish. Two verifier checks asserted that the
shrinkage weight rises with PA and both failed (Pearson 0.23, then Spearman 0.05);
the second failure falsified the hypothesis rather than refining it, and the arithmetic
above is why. The verifier now tests the ordering that actually holds — the most
precisely measured third of the league is trusted more than the least (measured 0.460
vs 0.287) — plus the two correlations above as reported diagnostics.

### Shrinkage is heavy, and that is the correct reading

Across three 90-day verify leagues of ~292 qualified hitters:

| quantity | measured |
| --- | --- |
| between-player variance | 0.99e-4, 1.02e-4, 1.38e-4 |
| mean sampling variance | 2.56e-4, 2.59e-4 |
| PA-weighted sd of wRC+, raw | 21.3, 22.1 |
| PA-weighted sd of wRC+, shrunk | 6.9, 8.6 |
| mean correction | 13-15 points |

A hitter's **true** wOBA sits about as far from league average as the error in
measuring it. The unshrunk PA-weighted mean is exactly `100.000000000` by construction,
which is the check that would fail if a hardcoded divisor crept back in; the shrunk mean
runs 98.5-98.7 and **cannot** be 100, because per-player weights do not preserve a
PA-weighted mean. An earlier verifier asserted it and failed at 98.53 — the assertion
was wrong, not the shrinkage.

Players genuinely differ here (`getOutcomeWeights:486-490` makes outcome probabilities
depend on the batter's power, contact, discipline and avoid-strikeout against the
pitcher's stuff and movement), but the differences are small relative to what a season
can resolve. A full season can separate a clearly above-average hitter from the pack
and cannot finely rank the top twenty.

### What is deliberately absent

- **Park adjustment.** See the park-factor section above. Neutral because there is
  nothing to neutralise.
- **A pitching wRC+.** It would need weights for what a batter's outcome is worth
  *against* a given pitcher, and this engine keeps nothing at the pitch level to fit
  them from. `PlayerSeasonPitching` gives hits allowed, earned runs, walks and
  strikeouts, and a run-allowed rate per nine can be built from those — but that is
  runs allowed, not run prevention, and calling it wRC+ would put a different quantity
  under a name readers trust. `PitchingWrcNote` in the module says this where someone
  looking for one will find it.
- **Per-outcome-and-base-state weights.** The single-weight approximation is coarse
  exactly where interesting hitters live: every scoring outcome's occupancy spread
  equals its bases-loaded value (BB 1.000, 1B 1.450, 2B 1.837, 3B 2.938, HR 3.000),
  because bases-loaded PAs score and bases-empty ones do not. The user's explicit
  choice was the simple version; this is the cost of it, quantified rather than
  hidden. The probe already holds the joint table, so the fix is nearly free if wanted.

### Verification

`tools/verifyWrc.ts` — **22/22 PASS** on a league built from seed 20240613, which is
not the seed the constants were fitted on. Each shipped weight is re-fitted from that
league and compared within a per-category tolerance (tight where the weight ranks
players, loose where it is a small numerator over a large count). Also asserted: PA
totals agree between the season rows and the probe exactly; weights are monotone in
scoring value; a strikeout creates no runs; zero PAs give null rather than 0; the
baseline is exactly pooled runs over pooled PAs; halving the league value doubles the
ratio; and 292 players clear the floor.

Labelled in the tool as **not** independently confirmed: the engine already throws if a
game's hits or runs disagree with its scoreboard (`gameEngine.ts:1036, 1040`), so that
is the engine's guarantee; check 1 compares the module to the probe and both read the
same games, so it shows agreement rather than independent correctness; the weights are
validated against a different league, not ground truth; and player-level wOBA has no
cross-check at all because the probe does not record which player was batting.

Stage A is unaffected — `verifyMetrics` still 10/10, `tsc` holds at its 10
pre-existing diagnostics.

## The four deferred metric boards (`8fb2610`)

BABIP, Isolated Power, K − BB% and Extra-Base Hits, added to the batting boards —
the work deferred to last by explicit choice. All four already existed as verified
functions in `metrics.ts`; **no rate is re-derived in the screen.**

### The real fix was making the categories declarative

Each board was three parallel if-chains on `category.key` — sort value, detail cell,
display string — each ending in a **fallthrough to On-Base**. A category added to the
list without touching all three, or a mistyped key, rendered a perfectly
plausible-looking On-Base board instead of failing.

That is the same shape as the SLG bug already recorded above: a board that looks
right and is measuring the wrong thing. Each category now carries its own
accessors, so the compiler enforces they exist and **there is no default to fall
into.**

### K − BB% sorts ascending, and that was wrong on the first pass

Every other batting category sorts descending. K − BB% is the one where **low is
good**, so descending led the board with the league's *worst* plate discipline — the
first browser render put a player with **42 strikeouts against 7 walks at rank 1**.

Reading the code did not catch this. Running it did. The category comment records it
so the next person does not "fix" the direction back.

### Two smaller correctness fixes found the same way

- The expanded panel's header read **`N QUALIFIED` unconditionally**, which was
  already loose for counting boards and became plainly wrong once a third
  unqualified board joined them — it displayed **"710 QUALIFIED" over Home Runs**.
  It now reads `PLAYERS` where the at-bat floor does not apply.
- ISO was formatted with a leading plus. It cannot be negative here (`metrics.ts`:
  `totalBases >= hits` always), so the sign was decoration *and* it broke visual
  consistency with the `.397` and `.344` beside it. Now `fmtAvg`, same as BABIP.

### One floor for four new boards, deliberately

82 at-bats was derived from the measured league BABIP of 0.282 at target SE 0.05, so
it is **exactly right for BABIP**. ISO and K − BB% ride on it because a per-stat floor
is a per-stat argument to defend, and 82 is conservative for both: ISO is a
difference of two positively correlated proportions, so its standard error is
smaller than the parts suggest, and K − BB% rests on large, well-behaved counts. The
simplification is stated at the constant rather than left to be found.

### Verified in the browser, not by reading it

Over 60 simulated days: all ten boards render; every qualified board reports the same
290 hitters and the three counting boards 710; chrome-bar heights are **exactly 38px
on every panel**; panels lay out in three rows; no horizontal overflow; every table
reports **3/3 header-to-body drift 0**. The only console error is the pre-existing
`animationPlayState` one.

Arithmetic spot-checked against rendered output: `66 H / 172 BIP` reads `.384`;
`14 2B + 3 3B + 16 HR` reads `33 XBH`; `35 (K−BB) / ~166 PA` reads `+21.1`.

## Is wRC+ presentable on a leaderboard? Measured: no, not yet (`c83d466`)

The question below asks where to go next, and its recommendation said the
base-state weight upgrade matters *"if wOBA is going on a main board"* — which made
presentability a prerequisite rather than a preference. `verifyWrc` now prints the
top ten by shrunk wRC+ (the rows a board would render) plus the two numbers that
decide it.

Measured over 90 days, 292 qualified hitters:

| quantity | measured |
| --- | --- |
| top ten spans | **4.0 points** |
| distinct whole numbers from 10 rows | **5** |
| adjacent pairs that tie once rounded | **5** |

Ranks 2 through 9 sit inside **1.7 points**. At the integer precision a leaderboard
renders, that board reads roughly `117 116 116 115 115 115 115 114 114 113` — five
players visibly tied, and the ordering below rank 1 carrying nothing the reader can
act on.

**This is the compression from the Stage B section appearing in its own units**, and
it is not a rounding problem. The shrunk values *are* the measurement; that spread is
what a full season of this engine can resolve about player differences.

So: **do not put wRC+ on a top-ten leaderboard yet.** It belongs where the compression
is explainable rather than implied — a player card, or a board showing the raw value
and shrinkage weight beside it. The base-state weight upgrade would help, but it
attacks the *occupancy* approximation, not this, and the two are independent
problems. Doing it will not un-compress the board.

## Where run value ended up: the player card (`ae3d07d`)

`c83d466` measured that a top-ten wRC+ leaderboard is not worth building. This is
the other half of that answer: run value goes on the **card**, where the reader is
looking at one player and the number has room to be qualified.

The batting panel gains two rows, `wOBA` and `wRC+`, beside `AVG` and `OPS` —
they answer the same question those two answer. Under them sits one caption:

> 100 is league average. Shrunk toward average: 69 unshrunk, 41% trusted.

That line is the whole reason this is a card and not a board. It shows the figure
before the correction and how much survived, which is the part a ranked list has
nowhere to put. Deliberately **not a tooltip** — tooltips are invisible on touch,
and the caveat is exactly the part that stops the number being over-read.

`wRC+` is rounded to a whole number. Not laziness: the top ten produce 5 distinct
integers from 10 rows, so a decimal implies precision the measurement lacks. The
caption carries the raw figure so the shrinkage stays visible.

### The part that was easy to get wrong: which league

The card shows whichever row `getPreferredBattingStatsByPlayerId` picks — latest
season, preferring regular season, falling back to another phase when a player has
only that one. A baseline derived any other way could **score a player against a
league they are not shown in**.

So `runValueBaseline` takes that same map, and both callers (`PlayersHub`,
`TeamsHub`) pass it down rather than each deriving their own. `RosterPanel` receives
it as a prop because a league average has to come from the whole league's rows and
that panel only holds one club's roster.

Players below the variance floor are still pooled into the league *rate* — it is
PA-weighted, so a small row barely moves it, and excluding them would make the
league figure jump as individuals crossed the floor. `leagueBaseline` applies the
floor only where it belongs, to the spread.

### Verified in the browser on both cards

| card | wRC+ | caption | arithmetic |
| --- | --- | --- | --- |
| Players | 99 | 98 unshrunk, 28% trusted | `100 + 0.28(98−100) = 99.4` |
| Roster | 88 | 69 unshrunk, 41% trusted | `100 + 0.405(69.5−100) = 87.6` |

A player with no batting line shows `---` for both figures and no caption — the
existing convention, not a new one. Caption box measures **315×39 with no
clipping**. All tables 0 drift; only console error is the pre-existing
`animationPlayState` one.

`verifyMetrics` PASS, `verifyWrc` 22/22, `tsc` at its 10 pre-existing diagnostics,
build 6.14s.

## The performance feedback loop — shipped, with a caveat that outranks its checks

Wiring wRC+ into player development. This is the **second** relaxation of the
presentation-only rule, after the batted-ball model, and it is categorically
different from the first.

Stage A and Stage B were **read-only**: every metric so far is a sufficient statistic
of the existing play log, which is exactly why the metric layer deliberately needed
no relaxation. This is the first thing that **writes back** into the simulation and
changes future seasons. There is no presentation-only path to it — the signal has to
reach `projectAttributeDelta` (`playerDevelopment.ts:261`), which turns age, potential,
wear and playing time into a rating delta.

**The loop it feeds already existed and is not what this work created.** A higher
rating makes the top nine, the top nine earns plate appearances, and
`getUsageMultiplier` scales development by playing time. `gameEngine.ts:287` draws each
batter *uniformly* from the nine-man lineup, so batting-order slot barely affects PA —
PA is driven by selection, and `generateBattingOrder` (`shared.tsx:146`) sorts on
ratings. So today: **rating → top nine → PA → larger usage multiplier → bigger
development.** This work adds a second loop in series, which is why the multi-season
proof was not optional.

### What the signal is, and what it deliberately is not

Shrunk **wRC+**, batter-side only. The shrinkage is the reason this is safe to wire
in at all: wOBA's standard error is dominated by home run count rather than plate
appearances (**+0.807 against −0.048**), so an unshrunk figure would reward whoever
got lucky with a handful of long balls. `wrcPlus` already pulls each player toward
league average in proportion to how badly that noise is measured.

Pitchers are excluded because there is no pitching wRC+ — the engine records nothing at
the pitch level to fit run-prevention weights from, and a run-allowed rate is a
different metric wearing the name. Inventing one would put an unvalidated signal into
the simulation's central loop. So the asymmetry is real, and the verifier measures
batter/pitcher balance rather than assuming it holds.

### Three wrong designs, each caught by measurement

This is the substance of the work. Every one of these would have shipped plausible
numbers.

**1. A gain of 0.15 was inert, not conservative.** The reasoning was that annual
development is only 1.0–1.7 rating points, so the effect should be a few tenths.
Measured: it moved the league by a mean absolute **0.0163** rating points and shifted
**16 of 704** players by a single point. The cause is `clampRating`, which rounds to
whole numbers — a 1.03 multiplier on a 1.2-point delta moves the result ~0.04 points,
and 0.04 almost never survives rounding to an integer.

**The trap:** an inert feedback loop reads *exactly* like a safe one in every
league-level statistic. Compression stable, talent level stable, balance stable — all
of it true, none of it evidence. That is why `verifyDevelopmentFeedback` attributes
the effect exactly, by calling `applyPlayerDevelopment` **twice on identical input**,
once at the run's gain and once at zero. Everything the two disagree on is caused by
the signal, with no schedule term in it. Without that control the whole file is
decorative.

**2. The multiplicative form was a ratchet.** At gain 4 it inflated ratings by a mean
**+0.157 points per season**. The cause is a covariance a multiplier cannot avoid:
most players are pre-peak and rising, so their deltas are positive, and a player who
outperformed is disproportionately one of them. Multiplying each delta by a
performance-correlated factor gives `E[multiplier × delta] > E[delta]` — more when the
two correlate, which they do. Structural, so no threshold on a multiplier removes it.

The fix is **additive**, applied after the usage multiplier and before the headroom
check. Both placements are deliberate: additive because it has no covariance term, and
before the headroom check so a player already at his ceiling cannot bank performance
he has nowhere to put — which would be the quietest possible form of stratification.

**3. Centring on 100 was wrong, and the sign flipped.** The additive form cut the bias
to a bias *ratio* of **0.395** — but negative, not positive. The cause: the league
baseline is pooled **plate-appearance**-weighted and is exactly 100 by construction,
while ratings are **per-player**, and PA correlates positively with ability. So the
unweighted mean of wRC+ sits below 100. Centring on the observed *player mean* dropped
the ratio to **0.037** — essentially centred.

### What shipped, and the caveat that outranks the checks

`PERFORMANCE_GAIN = 2.5` rating points per year per unit of relative wRC+ edge. At the
shipped gain, measured over 12 seasons: **0.052 rating points** mean absolute movement,
**44 of ~800 batters** moved by a single point in a year. Against annual development
of 1.0–1.7 points, performance is a minor term rather than the dominant one.

**And the honest limit: the rich-get-richer proof could not be completed.**

The schedule is unseeded, so two runs at one seed are two different leagues. The
baseline is therefore replicated three times to get a noise floor — and across
invocations that floor came out at sd **0.00071, 0.00066, 0.00070, 0.00110 and
0.00004** per season. Three replicates cannot pin down a standard deviation that
unstable.

Consequently the excess spread drift attributable to the feedback is
indistinguishable from the baseline's own variation: measured excesses across runs
ranged **−0.00085 to +0.00193** per season, mixed in sign. The stratification check
therefore **cannot fail** at any gain small enough to be defensible.

So the verdict is **no detectable harm, not demonstrated safety.** Those are
materially different claims and the difference is recorded here rather than smoothed
over. `verifyDevelopmentFeedback` prints this as a standing caveat on every run.

It is reported rather than asserted on purpose: a power check built on a 3-replicate
standard deviation flips from run to run, and *a check that fails at random is worse
than no check*, because it teaches a reader to ignore it.

### What would actually settle it

- **More replicates.** The effect is a ~0.001/season signal against a ~0.001 noise
  floor; separating them needs enough runs that the floor is known to a factor of
  several. That is compute, not cleverness.
- **A longer horizon.** Twelve seasons cannot show a century-long stratification, and
  the drift this guards against is precisely the kind that only appears over decades.
- **A stronger signal.** The deeper problem is upstream: shrunk wRC+ in this league
  has a standard deviation near 8 points and its top ten span 4.0. There is little
  performance information to feed back. A metric that separated players better would
  make the loop both more meaningful and more dangerous, in that order.

## Deviations from the proposal — all deliberate, all recorded in commit messages

1. **Leaders: no `SB` category.** There is no stolen-bases field anywhere in the
   simulation. `OBP` replaces it.
2. **Leaders: proportional bar, not the 20-cell `Meter`, on award races.** With
   eight candidates the leader holds ~20%, filling 4 of 20 cells, so the cells
   cannot separate the candidates the panel exists to compare. `Meter` remains
   for progress bars it suits.
3. **Bracket: league brackets stack full width, not side by side at `xl`.** Two
   five-round brackets abreast leave ~150px per series card. Below `xl` the
   connectors are dropped and rounds become labelled groups.
4. **GPBBook's monospace exception does not hold.** §9.4 permits monospace there
   "for formulae and constants". All 127 usages are on prose, dates and counts.
5. **The media and betting modules have no proposal.** They were built to a
   different standard — calibrated against settled games, with a guard per claim.
6. **Featured Matchup became Featured Odds** on the dashboard, carrying the house
   moneyline rather than restating the fixture.
7. **Completion does not always return to the dashboard.** See Open Questions 1.
8. **A media prop card navigates rather than betting.** The brief asked for a card
   that takes the manager to the betting page, and that turned out to be the only
   nesting-free option: a card with two price buttons inside it cannot itself be a
   button, because nested buttons are invalid HTML. The card identifies the prop;
   the betting page places it, like every other market.
9. **Props are published per outlet, not as one house board.** A prop's safe/hot
   border is a claim about *that outlet's* read, so it is meaningless without the
   outlet attached. Grouping by outlet also keeps the board at fifteen rows instead
   of the several hundred a full board would be.

## The forecaster pool: nine outlets, re-fitted

**CORRECTED.** This file said "three forecasters" throughout, and quoted
Booth 0.2467 / Glorest 0.2477 / Sharply 0.2561. The pool is now **nine forecasters
across five outlets**, re-fitted end to end (`6785094`, `b907597`), and those three
numbers are stale.

`verifyMediaOdds`, re-measured today at seed 1337, 7,225 settled priced games:

| Outlet | Brier | | Outlet | Brier |
|---|---|---|---|---|
| The Booth (Hollis) | 0.2461 | | Calibrated Sports (Boyle) | 0.2482 |
| Glorest Sports | 0.2472 | | Calibrated Sports (Mussad) | 0.2490 |
| Lined Sharply Podcast | 0.2557 | | Glorest Sports (Wardley) | **0.2500** |
| The Booth (Sallow) | 0.2468 | | Scintilla | 0.2472 |
| The Booth (Jardins) | 0.2516 | | | |

**Read the Wardley row carefully.** 0.2500 is *exactly* a coin flip — the score of a
forecaster posting 50/50 on everything. A flat 50/50 call scores precisely 0.2500, so
anything at or above that is worse than random information wearing a price. He is
currently the weakest forecaster in the pool and the gap is not rounding. This is a
**known open item**, not a settled result: the earlier plan set an acceptance bar of
"every Brier below 0.2500" and he does not meet it. Two readings are possible and
this file does not pretend to know which is right — the `scout` method may be
re-fitted against a longer horizon, or Wardley may be understood as deliberately
close to worthless because long-horizon re-rating is *supposed* to look like noise.
That is a product decision, not a fitting one.

**Sharply's overconfidence is preserved and must stay that way.** His posted slope is
roughly 3× his fitted optimum. That gap is the exploitable flaw the betting layer is
built around, and a recalibration pass that "fixes" him destroys the most valuable
play in the game. `HOUSE_SHADE` exists so the *house* can be safe without editing
him.

**Mean predicted away win rate is 49.2%,** against 50.0% for a coin — so the pool as
a whole is slightly under-confident rather than merely regressive.

### The unweighted-mean bug, which was a bug only at eight

The consensus was an unweighted mean of the forecasters' probabilities, and
`confidence` fed only the on-screen error bar — **it never touched the
arithmetic**. With three outlets that is defensible. With eight it is a bug: a
0.55-confidence outlet moved the house line exactly as much as a 0.84 one.

Fixed at `702f31a`, deliberately *before* the new forecasters landed rather than
after. Re-fitting everything afterwards would have produced a consistent but wrong
model, which is harder to notice than an obviously broken one.

**This changed every price in the game.** The 0.045 margin and the 0.20 shade were
fitted against an unweighted three-outlet mean, so `fitHouseShading` and
`verifyShadedHouse` had to be re-run. The load-bearing property is not a price level
but this:

> a bettor with no edge at all, betting one side relentlessly, must not print money

0.20 is the mildest shade where **both** flat strategies lose on every seed tried.
That is what "the house is safe" means here, and if it breaks the weighting was wrong.

Note the two consensus figures are not the same number: the plain mean drives the
**analysts** archetype and the confidence-weighted one drives **fair value**. That is
deliberate, and it is the only reason those are two archetypes rather than one.

## The HXSE — a market, not a decoration

`gpb-macrobet-hxse.md` is the design document; all of its Phase 0–4 exit lists are
closed. What matters to a reader who did not build it:

| Layer | File | Note |
|---|---|---|
| Valuation | `analytics/teamValue.ts` | Weights **fitted** against realised end-of-season win totals, not chosen |
| Index | `analytics/hxseIndex.ts` | Value-weighted, not equal-weighted |
| Playoff probability | `analytics/playoffMonteCarlo.ts` | Monte Carlo over the remaining season, memoised by `(season, date)`, worker-only |
| Price series | `analytics/sharePrice.ts` | Two volatility regimes, seeded throughout |
| Crowd | `analytics/crowd.ts` | Five archetypes; see the fade strategy below |
| Liquidity | `analytics/fanbase.ts` | Thin markets **gap**; the gap multiplier is never applied to game results |
| Ledger | `lib/portfolio.ts` | Long-only, dollars, cash moves only on trades |
| UI | `components/markets/ExchangeView.tsx` | Its own nav leaf, not a MacroBet tab |

**Three properties that are load-bearing and easy to break:**

1. **`PRICE_MAX = 1000` is a ceiling on the FAIR VALUE ESTIMATE, not on price.**
   `sharePrice.ts` says so in its own words: *"IT IS NOT A CEILING ON PRICE, and
   treating it as one is a bug that shipped and was played on."* The close used to be
   clamped to it too, which pinned the fair value, which pinned the close, which made
   the **entire price mechanism for that club go inert** — mean reversion, crowd, game
   shocks, all of it. It hit the best club in the league, because the valuation is a
   z-score against the league. Measured p99 for `close / fair` on a real ledger is
   **1.576**, so a $1,335 close is a premium, not a breach.
2. **Positions are denominated in dollars, cash-only, no outcome-based payout.** So a
   share above 1,000 is holdable and settleable and nothing is capped at fair. If that
   ever changes, the ceiling question reopens.
3. **The ledger is long-only and cash-only.** Unrealised P&L is displayed and never
   touches cash. This was chosen to keep cash-moving events to a small, auditable
   set — `wallet.ts` has already shipped two ledger bugs, and positions are a larger
   surface than slips.

### The crowd, and why the fade edge is NEGATIVE

This is the counter-intuitive result and the one most likely to be re-litigated, so
it is worth stating plainly.

The design premise is that **the momentum crowd is the largest and the most wrong**,
because a learnable strategy is the difference between a feature and a gambling
mechanic. Momentum carries a **0.40** share, the largest of five.

For several commits that was false. `momentumSignal` returned a per-day *rate* while
`towardFairSignal` returned a raw *level* — **summing a rate with a level**. A 12% gap
to fair produced 0.119 while a hot three-day run produced 0.014, so the archetype with
the smallest share out-shouted the largest by 1.3×. Fixed by dividing `towardFair`
by `PASSIVE_DRIFT_DAYS`: momentum vs passive went 0.76× → 2.29×.

The remaining honest finding: **measured over 99 emergent runs, chasing beats fading
by 12.4 points, and on a control path with no crowd at all by 11.5.** So the crowd is
not creating the edge — the price path's own mean reversion is. Both numbers are
negative, meaning momentum *works* at this horizon on both paths.

That is a design premise that measurement did not confirm, and it is recorded as
**unresolved rather than reframed**. What is confirmed is that the crowd buys an
established run (+0.683% mean net flow) and stops buying it (−0.571% with no run), and
that it measurably moves the market — 28 of 32 clubs ended more than 1% from where
the no-crowd control put them.

**`CROWD_SATURATION` is 15, and it is a chosen number with a located boundary.**
`e68dc29` moved it from 10. At 10 the crowd never turned. The boundary was found by
running the suite rather than trusted from a comment: **S = 13 fails check 12, S = 14
passes, S = 15 carries a full unit of margin** above the highest value that still
fails. There is no ground truth for crowd appetite in this project — what is measured
is the consequence, and the consequence is now gated by a suite that fails two units
below the shipped value.

## Recent bug fixes a session should know about

Four of these are the same shape, and the shape is the lesson: **each survived a green
suite.**

**1. Postseason elimination (`709cb5e`).** A club knocked out in the wild card was still
being offered prices on its LEAGUE board throughout the league championship series.
Two causes, only one visible from outside:

- `titleContenders` is regular-season arithmetic, and it **freezes** at the end of the
  regular season because playoff games never touch `team.wins` (`simulationManager`
  gates every increment on `isRegularSeasonGame`). It went on calling a club that had
  lost the wild card a contender.
- `leagueSeriesLosers` counted **venues, not clubs** — it tallied `homeWins` against
  `awayWins` and eliminated `row.away`. A best-of-seven alternates venues, so a real
  4-2 arrived as 2-2 and returned an **empty set**, and an empty set cannot eliminate
  anyone.

This was the same bug found once before in `lockedRaces`. The response was to delete
the second tally rather than patch it: one `seriesTallies` counts by club, scoped by
round for its two readers.

**2. The MVP closure (`d384a64`).** The races did not close — 16 buttons, 0 disabled.
`regularSeasonOver` was `gamesRemainingByTeamId.size > 0 && …every(v => v <= 0)`, but
that map records a club **only when it has an unfinished game**. So a completed season
reads as **EMPTY, not zeroes**, and `size > 0` read finished as unfinished. The guard
existed to stop "no schedule at all" being mistaken for "finished", and it did that by
making the real case unreachable.

**Why no suite caught it, which is the part worth remembering:** every award assertion
called `buildAwardMarket` with an explicit `decided` flag, so the suite structurally
**could not see how that flag was derived**. Fifty-odd checks, nine suites, two
injection gauntlets, all green, and the feature did not work.

**3. A guard that asserted the bug (`f9726c1`).** A check read *"no price left the
band"* and asserted `close <= 1000`. **That assertion was the historical bug.** A
green result would have been evidence of a regression. The check now looks for the
real failure mode — a price **pinning** at a bound while fair value moves.

Its detail line was worse: hardcoded prose reading *"512 closes, all inside (0, 1000]"*
printed **while the check was failing**. It did not merely miss the problem, it
contradicted the failure printed directly above it. That is the guard against
hardcoded detail prose, not just the assertion.

**4. The award tie-break, and the same trap as #3 (`709cb5e`).** Closing a market on
`entries[0]` while settlement reads `candidates[0]` is only safe if those are the same
ranking. They were not: the board had no tie-break (stable sort, so roster order) and
the archive broke ties alphabetically. On an exact tie the board could name one MVP and
settlement pay another. The same commit also fixed `take` being capped at eight —
the ranking was sliced before `take` applied, so the archive asking for ten silently
received eight.

`d384a64`'s lesson generalises and is now asserted rather than remembered:
**vary one input, then attribute the result to it.** `4a31516` hit the identical trap
in a crowd check that compared a mid-run value against an end-of-run value on a
fixture whose run *accelerated*, so two effects cancelled and the check could not
distinguish a working term from a broken one.

**5. Season history was being erased on every reload (`3dde3f7`).** Reported as "the
History page only keeps the previous season". The page was innocent; the bug was a
class. Three keys in `App.tsx` had a load effect followed by an **ungated** persist
effect, and on mount the load queues a state update while the writer persists the value
belonging to the render that just committed — the initial empty value. The empty value
lands in localStorage while the real contents sit unused in a local variable. Under
StrictMode the effects re-run immediately, so the load **re-reads what the first pass
just overwrote**.

Measured, three seasons seeded and then reloaded:

    StrictMode on, ungated   [2023,2024,2025] -> []                n=3 -> n=0
    StrictMode off, ungated  [2023,2024,2025] -> [2025,2024,2023] n=3 -> n=3
    StrictMode on, gated     [2023,2024,2025] -> [2025,2024,2023] n=3 -> n=3

**Three archived seasons reduced to none on every reload.** In production the ungated
version self-corrects, because the re-render re-runs the writer with the loaded value.
That is why this read as a dev-only ghost and survived for so long. The wallet and the
portfolio are architecturally immune — the wallet uses a lazy `useState` initializer and
the portfolio has no mount-time writer — which is why the bug was confined to three keys
rather than being systemic.

`tools/proveSeasonHistoryReloadGuard.mjs` is the permanent check. It drives real Chrome
over CDP, and it **removes the gate and requires the measurement to notice** — two of the
three gates, because the third cannot be asserted from a throwaway profile (below). One
injection is deliberately an **expected survivor**, and it exists because writing the fix
produced a claim that turned out to be false: the comment on `isLocalKeysLoaded` argued
that one shared flag was required rather than convenient, since a per-key flag could
"unblock a writer while an earlier sibling in the same commit is still mid-flight". The
harness injects the per-key scheme and **requires the data to survive**, because all
three loads are declared before all three writers and the claim never held. The comment
was corrected.

**The confound the harness exposed, which is worth more than the verdict:** the
offseason workflow key gets clobbered on a fresh profile *regardless of the gate*, because
`useSeasonLifecycle.ts:385` resets any non-idle stage to idle whenever the season is not
complete — the app being right, since you cannot be at the lottery with an unfinished
season. Only watching writes rather than reading the key at the end revealed it: the key is
written with the correct value, then overwritten ~17 ms later. Reading only at the end would
have attributed that to whichever writer ran last, and the ungated-writer injections would
have looked as though they destroyed a key they never touched. That key is injected and
reported, but never decides pass or fail.

## Current state

`HEAD` is `e68dc29`, the working tree is clean, and `local` is **38 commits ahead of
`origin/local`** — **nothing has been pushed.** `PHASE_HANDOVER.md` is tracked
(`2db19ad`).

**This section previously said `HEAD` was `ae3d07d`, pushed and in sync.** Both
halves were wrong, and it had been wrong through every commit since.

**`local` is 39 commits ahead of `origin/local`** (`git rev-list --count
origin/local..HEAD`). Nothing has been pushed.

Nine subsystems are complete end to end: the **media module** (nine forecasters,
re-fitted — see above), the **betting layer**, **player props**, the **storage
rebuild**, the **offline metric layer**, **Stage B run value** (wOBA + park-neutral
wRC+, `verifyWrc` 22/22), the **development feedback loop**, the **headliner
newsroom**, and the **HXSE**.

**Two asset facts a session will trip over immediately.** `src/assets/media/`
holds ~22 MB of raw outlet PNGs next to their 3 KB WebP versions; `HeadlinerPortrait`
and `TeamLogo` glob `*.webp` and never touch the PNGs. There is also an untracked
`fuyukashinonome2.png` (3.1 MB) that **nothing references**. This has happened three
times in this project — the same "22 MB for five 40px avatars" defect. New art ships
as WebP at display resolution.

**The work staged, in the order it was decided:**

1. **The new metric leaderboards are done** (`8fb2610`). Note the 82-AB floor is a
   *display* floor; `wrcPlus` shrinks on precision rather than filtering, so it does
   not use it as a gate.
2. **wRC+ is deliberately NOT on a leaderboard**, on measured evidence. It is on the
   **player card** instead (`ae3d07d`).
3. **The development feedback loop is done and shipped**, with the standing caveat: no
   detectable harm at the shipped gain, and no demonstrated safety either.
4. **The batted-ball model** is the remaining item needing the presentation-only scope
   relaxed.
5. Optionally, upgrading wOBA to **per-outcome-and-base-state weights**. This attacks
   the occupancy problem, **not** the wRC+ compression and **not** the feedback loop's
   weak signal — three separate things that are easy to conflate.
6. **NEW — Wardley's Brier.** See the forecaster pool section. Either re-fit the
   `scout` method or decide he is deliberately near-worthless.

**If the feedback loop is to be trusted rather than merely shipped**, the next step is
not more tuning: it is enough replicated runs to establish the noise floor to a factor
of several, and a horizon long enough to see a century of drift. Both are compute.

**A shared `Modal` primitive exists** at `src/components/ui/Modal.tsx`. The app
had four hand-rolled dialogs with divergent scrim, z-index and Escape behaviour;
the primitive owns Escape, focus-in, focus-return, Tab trap, scroll lock by body
position, backdrop-only dismiss, and portal-to-body — which the media and betting
pages need, since both sit inside scroll containers. **Prefer it to a new
dialog.** Note that nested buttons are invalid HTML, which is why a media prop card
navigates rather than containing price buttons.

**Remaining UX debt** is the unmigrated Group F screens, measured as
hardcoded-hex colors + large radii + `font-mono` + soft blurred shadows:
`GPBBook.tsx` (73 KB, 172 instances), `CommissionerSettings.tsx` (46 KB, 46),
`TeamCalendar.tsx` (42), `MapHub.tsx` (14), plus `Controls.tsx`,
`TradeInterruptionModal.tsx` and `NewUniversePreview.tsx`. `SeasonAwardsModal.tsx` is
**no longer on this list** — it was replaced by `SeasonAwardsSummary.tsx` (`cca675c`),
which is on the design system.

`SimulationFloatingPanel.tsx` is **deliberately unmounted, not deleted** (`02f7ea8`).
It was the last unmigrated surface in the app shell. `SimulationHub` is the
replacement and carries the same three facts. The mount site in `App.tsx` has a
comment explaining the removal, so it is reversible.

## Verification state

**Re-verified 2026-10-05**, by running the suites rather than reading the output of a
previous session.

| | Result |
|---|---|
| `npx tsc --noEmit` | **7 errors** — all triaged below, none blocking |
| `checkBettingCardShape` | **29/29** |
| `checkCrowd` | **14/14** |
| `checkCrowdOnRealPath` | **6/6** |
| `proveCrowdCeilingGuard` | **3/3 injected bugs caught** |
| `checkSharePrice` | **21/21** |
| `checkPriceBoard` | **20/20** |
| `checkPortfolio` | **28/28** |
| `checkSharePersistence` | **26/26** |
| `probeTerminateThenExchange` | **green** (terminate → Exchange renders, no throw) |
| `checkFanbase` | **11/11** |
| `checkWorkerPriceHandoff` | **8/8** |
| `checkPlayoffElimination` | **all passed** |
| `provePlayoffEliminationGuard` | **7/7 injected bugs caught** |
| `verifyLockedRaces` | **exploit closed** |
| `proveBettingCardShapeGuard` | **9/9 injected bugs caught** |
| `checkPropCard` | **all passed** |
| `verifyMediaOdds` | 9 forecasters priced, Wardley at 0.2500 |

- **`npx tsc --noEmit` reports 7 diagnostics. Every one is triaged below, and none
  of them blocks anything.** This section exists because the count used to be
  carried as verbal tradition ("the 10 baseline"), which is not a safe way to
  hold a number: a session that introduced an 8th error would have seen "8, not
  10" and had no way to judge whether the new one mattered.

  **They do not block a build.** `npm run build` is `vite build`, which does not
  run `tsc` (`npm run lint` does, separately). Verified: `✓ built in 9.63s`. So a
  type error cannot stop a build or a ship, and "fix the errors" is never a
  release blocker here.

  ### `tsc` DOES NOT CHECK A SINGLE COMPONENT PROP IN THIS PROJECT

  **`@types/react` is not installed.** Verified: `Test-Path node_modules/@types/react`
  is `False`, and `const x: number = React` compiles clean in a `.tsx` file.

  `React` therefore resolves to `any`, so `React.FC<Props>` is `any`, so **every
  component's prop contract is unchecked**. All 7 diagnostics above are in plain
  `.ts` logic files. `tsc` has never looked at a prop type in this codebase: not
  `MediaReadInput`, not the 32-club ranking rows, not the betting slip, not the
  season gate.

  This is not theoretical. `MediaHub.clubsOf` handed `Game.awayTeam` — which
  `types.ts` types as `string // Team ID` — back as a `Team`, and the renderer
  passed a string into `TeamLogo`. It threw during render; with no error boundary
  anywhere in `src/`, React unmounted the whole tree, and The Media rendered as a
  **completely blank page**. Confirmed at runtime: `document.body.innerText` length
  `0`, `#root` child count `0`.

  A scratch file asserting `const away: Team = game.awayTeam` errors correctly, so
  the rule works — it simply never ran against the component. **A clean `tsc` here
  means the logic layer is clean and says nothing whatsoever about the component
  tree.** Installing `@types/react` will surface a large batch of new diagnostics
  and is a decision to make deliberately, not as part of a fix.

  | Diagnostic | Verdict |
  |---|---|
  | `Controls.tsx:50`, `SeasonCalendarStrip.tsx:41`, `TeamCalendar.tsx:53` — `localeCompare` on `unknown` | **Narrowing gap.** Values are strings at runtime; the compiler cannot see it. Lowest priority of the seven. |
  | `lib/storage.ts:1249` — `number` not assignable to `Timeout` | **DOM vs Node lib conflict.** `window.setTimeout` returns a number in a browser; the variable is typed with Node's `Timeout`. Runtime-correct. |
  | `simulationWorker.ts:21` — `self` cast to `DedicatedWorkerGlobalScope` | **Needs `as unknown as`.** A worker really does have that scope; the two lib types just don't overlap enough for TS. |
  | `simulationWorker.ts:211` — `Game[]` vs an inferred literal type | **`playoff` is optional on `Game` and required in the inferred shape.** Widening the inferred type is the fix; no behaviour depends on it. |
  | `playerGenerator.ts:596` — no overload matches | **Not yet triaged in detail.** Left alone deliberately rather than guessed at. |

  **What was here before, and why it went:**

  - `tradeLogic.ts:146` — **fixed.** `getTargetPositionForSlot` ended in
    `return slotCode`, where `CoreRosterSlotCode` includes `'SP1'`..`'SP5'` and
    `'RP1'`..`'RP4'`, none of which is a `PlayerPosition`. The runtime was
    *correct* — three `startsWith` early-returns caught every pitching slot first
    — but `startsWith` is not a type guard, so TypeScript could not prove it. Now
    a `isBatterSlot` type predicate does, and the proof lives with the code rather
    than in a reader's head. Verified behaviourally identical against the old
    implementation across all 19 slots in `CORE_ROSTER_SLOTS`.
  - `playerGenerator.ts` ×2 — **fixed.** `OverallTierKey` was declared twice in one
    module scope: a hand-written union at the top and `OverallTier['key']` at the
    old `:503`. The second was circular — `OverallTier.key` is typed *as*
    `OverallTierKey` — so it resolved straight back to the union and deleting it
    changed no type. **One drift direction remains unguarded:** adding a tier to
    `ACTIVE_OVERALL_TIERS` fails the type check, but *removing* one does not, so
    the union can hold a key no array produces. Recorded at the site.
- **`checkPropCard` cannot run under plain `npx tsx`** — it throws
  `ERR_UNKNOWN_FILE_EXTENSION` on the `.jpg` asset imports. It needs the asset stub:
  **`npm run propcard`**, which is `tsx --import ./tools/assetStub.mjs`. This is a
  package script and not an accident.
- **The PowerShell build exits 1 even on success** — Tailwind's chunk-size
  warning goes to stderr. Real signal is `✓ built in Ns`.
- **A browser harness exists.** No desktop browser is attached to this session,
  so `tools/cdp.mjs` drives headless Chrome over the DevTools protocol.
  `--user-data-dir` is a fresh temp profile **per run**, so localStorage starts
  empty and any repair must happen in one session. Chrome is at
  `C:\Program Files\Google\Chrome\Application\chrome.exe`.

  ```
  $env:GPB_VIEW="Rosters|Players"; $env:GPB_SIM="1"; $env:GPB_SIM_SCOPE="week"
  $env:GPB_KEY="Escape"; $env:GPB_CLICK="SIM MONTH"; $env:GPB_HOVER="Betting"
  node tools/cdp.mjs "http://localhost:3000/" "Repair Player Pool" out.png
  ```

  The final probe reports per-column table drift, `parlaysExpanded`, `slipOpen`,
  and the active nav item.
  **`tools/cdp.mjs` takes `<url> [viewLabel] [outPng]`, and PowerShell drops empty
  string arguments** — so passing `""` for `viewLabel` shifts `outPng` into the
  label slot. Pass a placeholder such as `"none"` instead. Chrome is **not on
  PATH**; use the absolute path above.
- **Two harness bugs were found by running probes rather than reading them**, and
  both are the same shape of mistake — worth not repeating:
  - `evalJs` was declared *inside* the `GPB_BET` block, so every later block that
    called it (GPB_SETTLE included) worked only if `GPB_BET` was also set, and
    threw a bare `ReferenceError` otherwise. `GPB_BET` was also never closed,
    which is why `GPB_SETTLE` was silently conditional on it.
  - `GPB_KEY` checked panel state *immediately* after dispatching a key and
    reported "still open" for a panel that had closed correctly. React had not
    processed the event yet and `AnimatePresence` holds the node through the exit.
    **A probe must settle before it reports.**
  - A prior version of `GPB_CLICK` matched `button[aria-expanded]`, which also
    caught the Parlays disclosure, and ran before `GPB_BET`. Order matters.
  - A third, found while building props: every fixed probe ran **before**
    `GPB_SIM`, because the file reads top to bottom. Nothing could therefore
    measure a state the simulation produced, which is the only kind of state
    props exist in. `GPB_EVAL` / `GPB_EVAL_MORE` / `GPB_EVAL_THIRD` now evaluate
    an arbitrary expression once everything else has run, and `GPB_SIM` clears
    the empty-player gate first so one session can reach a played season.
    (Every run gets a throwaway profile, so a fresh one lands on a save with 32
    clubs and no players, where there is no Sim Day button to press.)
- Four assertion tools guard the pricing, because none of it is visible from the
  page: `checkVig`, `checkTotalVig`, `checkOverUnderSides`, `checkFuturesShape`.
  Four fit/verify tools produce the numbers: `fitHouseShading`,
  `verifyShadedHouse`, `fitFuturesTemperature`, `fitFuturesScale`, plus
  `checkEv` for the price and payout arithmetic alone. The prop stack adds
  `verifyPlayLogProps` (settlement exactness), `fitPropLines` (the fitted
  constants), `verifyPropBoard` (end-to-end board and settlement) and
  `probePropRates` (per-stat rates). The storage and metrics work adds
  `verifyLocalGamesMirror` (21 checks), `verifyStorageBudgetBrowser.mjs` (CDP quota
  round trip), `probeStorageBudget`, `probeMirrorAccounting`, `verifyMetrics`
  (10 checks), `probeOutcomeMix`, `probeTotalBases` and `probeHomeAwayFactors`.
  Stage B adds `fitWobaWeights` (the wOBA fit, two seeds x three replicates) and
  `verifyWrc` (22 checks, including a re-fit of every shipped weight against an
  independent league).
- **A verifier check must report what it *measured*, not a label it was told to
  print.** Each of the 21 storage checks, 10 metric checks and 22 run-value checks
  prints its measured number on pass, and keeps failure prose for failure only. That
  is the guard that would have caught the BABIP denominator bug: a tool printing
  `BABIP ok` on a wrong formula passes it forever.
- **A verifier check can itself be wrong — check the invariant, not the output.**
  Three of `verifyWrc`'s checks failed on first run and **all three were bad checks
  rather than module bugs**: one asserted the shrunk mean equals 100 when per-player
  weights cannot preserve a PA-weighted mean; one used Pearson correlation to test a
  monotonicity claim; one assumed the shrinkage weight follows plate appearances when
  it follows the standard error. A failing check is a question ("what is the right
  invariant here?"), not automatically a defect in the code under test — and
  re-thresholding one to make it green without explaining the reasoning is the
  failure mode to avoid. Each is documented in the tool and in the Stage B section.
- **Sim throughput is measured: ~4s per 90-day seed, ~1,230 games, ~98,000 plate
  appearances.** So the two-pass Stage B fit costs ~8s total and `verifyWrc` ~4s.
  Compute is not a constraint on any metric work in this plan.
- **`npm run build` passes after Stage B** (re-run, ~6s). The run-value modules are
  plain pure functions importing only `metrics.ts` and `woba.ts`, and nothing in the
  app imports them yet, so the bundle is unchanged by them.

## Guardrails

- **Never carry a diagnostic count as verbal tradition.** The "10 baseline" phrase
  survived several sessions and every one of them had to re-derive what it meant.
  A count with no per-item verdict is not a safety net: the session that introduces
  an 11th error sees "11, not 10" and cannot tell whether the new one matters. The
  tsc errors are now tabled with a verdict each, under **Verification state**. Same
  rule for any "known failures" list — record *why* each is acceptable, or it is
  not known, it is only deferred.
- **A type error is a claim about proof, not about behaviour — but "the runtime was
  right" is still not a reason to leave it.** `tradeLogic.ts:146` had been an error
  for months on exactly that justification. It was true (three `startsWith` guards
  did catch every pitching slot) and it was still worth fixing: the compiler was
  asking for a proof it could not get, and the fix was one type predicate. When the
  runtime is right and the type is unproven, make the type provable — do not
  annotate the error away.
- **Presentation layer only, as a standing rule rather than a UX-phase one.** Do not
  touch `src/logic/` or `src/workers/`. `AppViewRouter.tsx` is the sole exception
  and is presentation routing. Leave all Supabase lines, imports, hooks and calls
  alone. New components go in `src/components/ui/`.
  **Exactly TWO deliberate relaxations are on record, and they are not the same kind
  of thing.** Keeping them distinct is the point; collapsing them into "sometimes we
  touch logic" is how a rule stops meaning anything.
  1. **The batted-ball model** (Tier 2) must reach into the per-at-bat resolution in
     `gameEngine.ts` to classify contact, because a batted-ball profile cannot be
     recovered from the play log afterwards — it is gone. **Additive instrumentation
     that stays inert**: a probe table that only fills when something asks for it.
  2. **The performance feedback loop** reaches `playerDevelopment.ts` so a measured
     season can influence the next one. This is the first work that **writes back** into
     the simulation; everything before it was read-only derivation from the play log.
     Different in kind, not just in degree.
  Neither may become a precedent for a third. The metric layer itself needed no
  relaxation, which is worth knowing: every metric it produces is a sufficient
  statistic of the existing play log.
- **Derive every rate from integer counts, never from a stored rate.** `avg` and
  `ops` are persisted at 3dp and `era`/`whip` at 2dp, so composing one from another
  inherits two roundings and can tie players who are not tied. Round once, at
  display.
- **Division by zero returns `null`, never `0`.** No at-bats is an *undefined*
  average. Reporting `0.000` ranks the player at the bottom of a board as though
  they had gone 0-for-0, which is a different and false claim.
- **A fitted constant needs a held-out sample, and the engine makes that cheap.**
  Corrected 2026-10-01, after an earlier revision of this file claimed the at-bat
  engine had 24 unseeded `Math.random` calls. **It has none.** Every draw inside a
  game goes through a seeded LCG (`gameEngine.ts:35-38`) seeded from
  `gameId:date:awayTeam:homeTeam` (`:1107`), so a season is **fully
  deterministic** given its universe. `playerDevelopment.ts` has no randomness at
  all, and `simulationManager.ts` has none. The `Math.random` uses in the repo are
  confined to universe generation, the draft and free agency — and even those take
  an `rng: RandomSource` seam (`playerGenerator.ts:24`) that `buildNewUniverse`
  feeds from a real `seed` parameter (`universeBootstrap.ts:179-190`).

  So the correct procedure is: **build two universes with different `seed` values
  and fit on one, validate on the other.** Do not monkey-patch `Math.random`; the
  engine supports seeds natively and a patch would hide that. The earlier claim also
  overstated the consequence — it implied reproducibility was impossible, which
  would have made every fit in this repo weaker than it needed to be.

  **CORRECTED AGAIN 2026-10-01, and this one matters.** A season is deterministic
  given its universe *and its schedule*, and **the schedule is not seeded**:
  `generateSchedule` shuffles game dates through `shuffleArray`
  (`simulation.ts:193-200`), which calls `Math.random`. So two runs at the same
  universe seed are **not** the same league. Measured: league wOBA came out 0.0948,
  0.0933, 0.0897 and 0.0920 across four runs at seed 4242 — about 5% spread from
  schedule order alone, and a 9% swing on the walk weight.

  The at-bat engine claim above is still exactly right and is the important half:
  there is no `Math.random` inside a game. What is wrong is the leap from that to
  "a season is fully deterministic given its universe", which ignored a second
  unseeded draw upstream of the engine.

  Two consequences, both acted on:
  - **Shipped constants are means over replicates, not one run's output**, because a
    single run's numbers are not precise enough to hardcode. `fitWobaWeights` runs
    three replicates at the fit seed and reports the spread alongside the mean.
  - **League-level values must be measured from the population in front of the
    caller, never stored.** A stored league wOBA would bias every player by up to 5%
    while still ranking correctly — invisible in a leaderboard, wrong in every printed
    number.

  The same correction applies to `probeHomeAwayFactors.ts`, whose three 180-day
  runs were run as independent samples because non-determinism was assumed. Its
  conclusion (no park factors) stands — it is a null result and re-running it
  cannot manufacture a spread that sampling noise did not produce — but with
  seeds available, its "three independent runs" framing is the wrong description of
  what it measured. Its own numbers are unaffected.
- **`PRICE_MAX` is a ceiling on the fair-value ESTIMATE, never on price.** Treating
  it as a price ceiling is a bug that shipped and was played on: it clamped the close
  as well as the fair value, which pinned both and made the whole price mechanism
  inert for that club — mean reversion, crowd, shocks. Measured p99 for `close/fair`
  is 1.576, so premiums above 1,000 are expected and are the dislocation the crowd
  exists to create. The failure mode to look for is a price **pinning** at a bound
  while fair value moves, never a price exceeding an estimate.
- **`betId()` is no longer `Date.now()` + `Math.random()`.** Fixed in `d8f54f3`
  along with the price path. This file previously cited it as a live sync hazard;
  it is seeded now. `wallet.ts:168` records the scar it left — trusting an undefined
  localStorage entry produced `bet-undefined`.
- **A check can assert the bug it is meant to catch.** `f9726c1` removed a check that
  read `close <= 1000`, because that assertion *was* the historical bug — a green
  result would have been evidence of a regression. When a guard is inverted, ask
  what a green result would prove before keeping it.
- **Never hardcode the conclusion into a check's detail line.** One read
  `"512 closes, all inside (0, 1000]"` in prose **while the check was failing
  directly above it**. It did not merely miss the problem, it contradicted it and sent
  the reader elsewhere. Compute the detail.
- **An empty collection is not a zero.** `remainingRegularSeasonGames` records a club
  only when it has an **unfinished** game, so a completed season yields an **empty
  map, not zeroes** — and "nothing left to play" and "no season was ever scheduled"
  are the same value. The disambiguation has to come from the schedule. This bit the
  MVP closure in `d384a64` and the feature shipped broken through a fully green
  suite.
- **Count by club, never by venue.** `leagueSeriesLosers` tallied `homeWins` against
  `awayWins`, which is wrong for every best-of-seven because venues alternate. Found
  twice in this project, once in each copy of the function.
- **Vary one input, then attribute the result to it.** Twice now: the award tie-break
  and the crowd saturation check both compared two moments and blamed one factor when
  two moved. `4a31516` hit it with a fixture whose run accelerated, so the effects
  cancelled and the check could not distinguish a working term from a broken one.
- **A suite cannot check a derivation it supplies.** Every award assertion passed an
  explicit `decided` flag, so the suite structurally could not see how that flag was
  computed. Pass explicit values to reach a branch; assert the *derivation* separately,
  and assert the property that made the first version wrong.
- **Do not write a key you have not read.** Added `3dde3f7`, after three `App.tsx`
  localStorage writers each ran a load effect followed by an ungated persist effect: on
  mount the writer persists the initial empty value while the real contents sit unused in
  a local variable. **Gate the writer on the matching read.** Under StrictMode this loses
  the data outright; in production it self-corrects on the re-render, which is why it
  survived so long and why "it only happens in dev" is not a reason to leave it.
  Use a lazy `useState` initializer (`useBettingSlip.ts:149`) where the value allows it —
  that form is immune, because there is no window in which the writer can run before the
  reader. Wallet and portfolio are both architecturally safe for this reason.
- **Watch the writes, not just the final value.** Building the reload harness, the
  offseason key read as "lost" in two of four runs. Only instrumenting `setItem` showed it
  was written **correctly** and then overwritten ~17 ms later by
  `useSeasonLifecycle.ts:385` repairing an inconsistent state. Reading the key at the end
  attributes the loss to whichever writer ran last, which would have made the ungated
  injections look as though they destroyed a key they never touched. **When a key is lost,
  find out who wrote it before you name a culprit.**
- **Constants must be measured or fitted, or labelled as chosen.** The 0.05 target
  SE that yields the 82-AB floor is a stated design choice; the 20-out pitching
  floor is a convention; `homeFieldAdvantage` is a model constant whose effect is
  not measurable; `PASSIVE_DRIFT_DAYS = 3` is chosen for the same reason
  `CROWD_SATURATION` is. All are named as such at the point of use. The inverse —
  presenting a chosen number as measured — is the failure this project has actually
  produced, repeatedly.
- **Report a null result with its power floor.** The park-factor probe does not
  claim "there is no home-field effect"; it claims the spread is below **0.31 R/G**
  at 95% confidence on this sample. A bare null reads as proof and is not one.
- **`src/App.tsx` is shared and high-risk.** It was modified once for the shell.
  Serialize any further edits.
- **Decoration must never go inside a table.** See Table geometry above. The
  `chrome-bar` is 38px and that height is not negotiable; tall content means wrong
  content.
- **Do not assemble source files through PowerShell string concatenation.** It
  double-encoded UTF-8 and added a BOM during the bracket rebuild: a middle dot
  written as `·` came back as `Â·`, which is the `U+00C2` this guard tells you to
  scan for. That one character is the whole tell. Use the edit/write tools. If a
  file is scanned, check for `U+00C2` and a leading `EF BB BF`. PowerShell may
  also *render* correct UTF-8 in this file as mojibake; that is a display
  artifact, not damage, so check the bytes rather than trusting the console.
  (The BOM/`U+00C2` scan false-positives on binary PNGs — exclude image files.)
- **Tailwind v4 rejects `@utility` names containing `::`.** It logs to the
  terminal and silently serves the last good file. Use plain CSS instead.
- **Never verify table alignment by cell count or by a downscaled screenshot.**
  Measure per-column `getBoundingClientRect().left` deltas.
- **Do not run the global Phase 4 token-drift greps yet.** Unmigrated screens are
  expected to fail them.
- **`GPBBook` will need a scoped exclusion** for the `font-mono` acceptance
  grep, but only for genuine formulae.
- **Never correct a forecaster to fix the book.** If a price is wrong, change the
  house's construction — shade, margin, or the line's centre — not the
  character. That separation is the whole design of this layer.
- **A diagnostic that cannot be shown to be right does not ship.** Several tools
  in this repo were wrong before the code they guarded; each is corrected at the
  point of the mistake, with what it got wrong recorded. When a later fix
  invalidates an earlier measurement, say so and re-measure rather than quoting
  the stale number.
- **Commit messages must go through a `-F` message file.** A `"` inside a
  double-quoted PowerShell string terminates the command mid-message and silently
  skips the commit. Write the message file with the **write tool**, or
  `[System.IO.File]::WriteAllText($p, $s, [System.Text.UTF8Encoding]::new($false))`
  — `Set-Content -Encoding utf8` in PowerShell 5.1 writes a **BOM**, which
  contaminated a commit subject until it was amended. The BOM does not show in
  `git log` as anything other than a stray character, so scan the message file
  for a leading `EF BB BF` the same way you scan source files.
- **`tsc --noEmit` is not a sufficient check here.** `strictFunctionTypes` is off,
  so it will not catch a mismatched callback arity — see the props section for a
  bug that shipped clean through it with no runtime error either. It also does not
  catch `Map` `for...of` under the project's `target`, which predates
  `downlevelIteration`; use `Array.from(...)` with `forEach` (TS2802).
- **Verify in a browser, not from the type checker.** Every claim in the media,
  betting, props, storage and metrics sections above was driven in headless Chrome
  via `tools/cdp.mjs` or a `tools/` verifier. Four of the bugs recorded in this
  file produced no error anywhere — no type error, no console error, no crash — and
  were only visible as a wrong number or a missing highlight. **I cannot see
  screenshots:** DOM reads and measurements are the evidence in this project, not
  images. Anything asserted here about the UI should have been read out of the DOM.
- **A regression that would ship "plausible" numbers needs a probe, not a code
  review.** All seven bugs in the storage and metrics work shared one shape: no
  throw, no bad type, no console error — just a wrong number that looked fine. The
  four `tools/probe*.ts` files exist because reading the code did not catch them.

## Known limitations

- **The wallet is localStorage only.** It survives a refresh and closing the tab,
  but does not follow the user between machines and is not in the same save file
  as the season. Wiring it into the Supabase pipeline was out of scope. It is the
  obvious next thing to fix.
- **The residual band mispricing is real and unfixed.** Best-priced band is
  worth 2–3 points, worst is 6–9 off. Shading is a uniform transform and cannot
  correct error that varies across bands; closing it means moving the
  forecasters' slopes. The best-priced-band figure is an upper bound on a
  strategy, not a strategy.
- **The crowd's fade strategy does not work as designed, and this is measured.**
  Chasing beat fading by 12.4 points over 99 emergent runs — and beat it by 11.5
  with **no crowd at all**. So the edge comes from the price path's own mean
  reversion, not from the crowd. The design premise ("the momentum crowd is the
  largest and the most wrong") is **not confirmed by measurement**. What is
  confirmed is that the crowd buys a run and then stops buying it, and that it
  moves the market. Re-tuning the archetypes will not fix this, because the
  control path has the same sign.
- **One forecaster is a coin flip.** Wardley (Glorest Sports, `scout`) sits at
  **Brier 0.2500** — exactly what a flat 50/50 call scores. The earlier acceptance
  bar was "every forecaster below 0.2500" and he does not meet it. Either the
  `scout` method needs a longer-horizon re-fit, or he is deliberately near-
  worthless because long-horizon re-rating is supposed to look like noise. That
  is a product decision, and it is open.
- **The corrupt-save guard in `sharePrice.ts` is unreachable by any test.**
  `PRICE_SANITY_MAX` "exists to catch a corrupt save rather than to bound a
  market", and no run of the model produces the corrupt save it defends against.
  A unit test over computed closes cannot reach it, because by construction those
  closes are not corrupt. Two attempts to inject coverage for it both failed to
  bite. This is **recorded in `proveCrowdCeilingGuard.mjs` as an expected
  survivor** rather than papered over with a claim of coverage it does not have.
- **Futures temperature is fitted on four-team divisions** and applied to
  sixteen-team leagues via a `sqrt(fieldSize/4)` correction. That correction is
  principled but not itself fitted.
- **No first-five market is exposed in the UI.** `buildFirstHalfMarkets` and the
  settlement path both exist; the Betting screen only offers full-game totals.
- **Props are same-slate only.** `buildPropMarkets` prices a player for a game on
  the next slate, so there is no "over the season" prop. That was not asked for
  and the ladder machinery would not carry it unchanged.
- **The per-outlet prop tilt is unvalidated as an outlet property.** It is
  defensible — it inherits the fitted moneylines' ratios — but no fit has ever
  measured whether Sharply's prop reads are better or worse than Hollis's. Treat
  the tilt as a way to make the three outlets disagree on props, not as a
  discovery about them.
- **Parlays are not built and not specced.** See Open Questions 6.
- **The completion receipt is unverified on month and season scopes.** Day and
  week were driven end to end. A month sim was only observed *mid-run* (as the
  stale-receipt test), and a season sim was never run — which matters, because at
  season end the offseason transition begins and that is the one case where
  "return to the dashboard" could be wrong or could strand the manager.
- **Seasons are deterministic given a universe AND a schedule, and the schedule is
  not seeded.** Corrected 2026-10-01, twice over. `gameEngine.ts` contains no
  `Math.random` at all, so the at-bat engine is fully deterministic — but
  `generateSchedule` shuffles dates with an unseeded `Math.random`
  (`simulation.ts:193-200`), so **two runs at the same `buildNewUniverse` seed are
  not the same league.** Two seeds still give two genuinely independent samples, which
  is what any fit needs, but one seed does not give a reproducible league. Measured:
  league wOBA varied ~5% across four runs at seed 4242. Without a seed you get a
  different universe every run *as well*. This is why retention depth and league-level
  totals vary between runs, and it is why no league-level constant is stored.
- **wOBA uses one weight per outcome, which is coarse exactly where the interesting
  hitters are.** Every scoring outcome's occupancy spread equals its bases-loaded
  value (BB 1.000, 1B 1.450, 2B 1.837, 3B 2.938, HR 3.000) because bases-loaded PAs
  score and bases-empty ones do not. A player whose extra-base hits came with men on
  base is credited less than his counting stats suggest. Per-outcome-and-base-state
  weights are the fix, the probe already holds the joint table, and the user's
  explicit choice was the simple version. **This is the single largest known
  approximation in the metric layer.**
- **wRC+ cannot finely rank the top twenty.** Measured: between-player variance
  0.99e-4 to 1.38e-4 against mean sampling variance 2.56e-4, so a hitter's true wOBA
  sits about as far from average as the error in measuring it. PA-weighted sd is
  ~21 raw and ~7 shrunk. A full season can separate a clearly above-average hitter
  from the pack and no more. Display differences inside a few points as ties.
- **A top-ten wRC+ leaderboard would be actively misleading**, measured rather than
  assumed: the top ten spans 4.0 points and produces 5 distinct whole numbers from 10
  rows, with 5 adjacent pairs tying once rounded. Ranks 2-9 sit inside 1.7 points.
  Deliberately not built. See the presentability section.
- **The batting boards all share one 82-AB floor.** It was derived from BABIP, so it
  is exactly right there and conservative for ISO and K − BB%. Stated at the constant
  rather than left to be discovered; a per-stat floor is a per-stat argument.
- **There is no pitching wRC+, and no park adjustment.** Both deliberate, both
  documented in the Stage B section: there is nothing at the pitch level to fit
  run-prevention weights from, and no park factor exists to divide out (measured
  spread below the sampling floor).
- **localStorage retains one slate of play logs, not a season.** Measured, not a
  preference — see Storage. Anything that needs season-long play-log data (FIP,
  situational splits, a season-split prop) is therefore unavailable from that
  store. IndexedDB holds the full history and is the store of record; the mirror
  exists only to give the quota-free envelope a working set.
- **Retention depth varies run to run** (14–17 play logs) because both the universe
  and the schedule differ each run, so a slightly larger slate costs slightly more.
  The invariant is whole-slate coverage, not a fixed count — do not write a check
  that asserts a number.
- **Home and away are noise-dominated in this league.** The setting intends about
  +0.02 R/G; three 180-day runs measured −0.133, −0.165, −0.002 with |z| under 2.
  So the home/away split is **omitted from the metric layer entirely** rather than
  published as a split full of sampling noise, and the setting in
  CommissionerSettings does not do what its label implies. Correcting it means
  editing weight coefficients in `gameEngine.ts`, which is outside the standing
  scope — so it is reported, deliberately unfixed.
- **The performance feedback loop ships, but its safety is NOT demonstrated.** Measured
  at the shipped gain: 0.052 rating points of mean movement, 44 of ~800 batters moving
  by one point a year, and **no league-level compression effect resolvable above the
  noise floor**. Excess spread drift ranged −0.00085 to +0.00193 per season across runs,
  mixed in sign, which is indistinguishable from the baseline's own run-to-run
  variation. Read the verdict as *no detectable harm*, never as *proven safe*. The
  deeper limit is upstream: shrunk wRC+ here has a standard deviation near 8 points, so
  there is very little performance information to act on.
- **Ratings are integers, which puts a floor under any feedback.** `clampRating` rounds
  to whole numbers, so a sub-half-point signal usually changes nothing. A gain that looks
  conservative can therefore be completely inert — and an inert loop passes every
  league-level health check while doing nothing at all. This is why the verifier
  attributes the effect by running development twice on identical input.
- **Pitch-level simulation is deferred.** Storing a distribution of pitch types
  per at-bat would roughly **10x the largest persisted object**, which is what
  broke localStorage in the first place. It would need the mirror rebuilt first.
- **`inningsPitched` is decimal innings at 3dp**, so outs must be recovered as
  `IP * 3`. There is no inherited-runner concept anywhere in the model, which
  means ERA is internally consistent but is not a real-baseball-analogous
  quantity. Error plays under-count both RBI and earned runs.
- **Board detail columns were reading the wrong stat in two places** (WHIP's
  detail showed ERA; AVG's repeated the average). Both fixed; recorded because both
  were individually plausible and neither changed a number a user would compare.

## Open questions for the user

1. **Should completion always return to the dashboard?** The instruction was "when
   it is done simming, it should take us back to the dashboard." As built, it
   returns there for Sim Day/Week/Month/Season and the desk buttons, but **not**
   for the inline paths — next game, advance-to-date, play-this-playoff-game —
   because those pass `keepCurrentView` specifically so they do not yank you off
   the game or bracket you asked about, and sending them to the dashboard would
   strand you mid-bracket. This is a deliberate deviation and it is a one-line
   change either way.
2. **Schedule still has eyebrow captions.** Every other panel's eyebrows were
   stripped. Schedule is on the unmigrated Group F list, so its captions survive.
   It was flagged and never answered; it was left alone rather than half-fixed.
3. **GPBBook monospace.** Confirm the exception applies only to actual formulae
   and constants, so the 127 prose usages get converted.
4. **Bracket layout.** League brackets currently stack full width. If
   side-by-side is wanted, the bracket must drop to three columns and the
   connectors get much shorter.
5. **`ui_kit` reachability.** It is intentionally not in the nav. If the user
   wants it in the UI rather than by direct view selection, that is a decision.
6. **Parlays: build the parlay, or stop.** The slip is built. Against three
   measured forecasters, parlay EV is *worse* than flat betting because legs
   compound. The global slip was deliberately built as separate settling stakes to
   avoid that trap. Parlays remain unspecced and the recommendation is not to
   build them on the current forecaster calibration.
7. **Wallet persistence.** Whether to wire it into Supabase alongside the rest of
   the league state, or leave it local deliberately.
8. **What the betting layer does next.** Player props are **built**. Correct score
   and live/in-play lines are not. The first-five market is the cheapest of what
   remains because the settlement path already exists and it is the only one with
   no pricing problem to solve first.
9. ~~**Should `PHASE_HANDOVER.md` be tracked in git?**~~ **Closed: yes, tracked in
   `2db19ad`.** Asked four times. It stays a working document in tone, but tracked,
   because two of its claims had gone stale and wrong and an untracked file is
   invisible to review.
10. **Where should wRC+ live?** **Answered and done: the player card** (`ae3d07d`).
    A top-ten leaderboard is not worth building (top ten span 4.0 points, 5 distinct
    integers from 10 rows), so wRC+ and wOBA sit in the card's batting panel with the
    unshrunk figure and the shrinkage percentage in a caption beneath.

    What remains is the **development feedback loop** (~1.5h, the one item that could
    destabilise a season) and the **batted-ball model** (the one item needing the
    scope relaxation). Upgrading wOBA to per-outcome-and-base-state weights needs no
    relaxation and is nearly free, but it addresses the occupancy approximation and
    **will not** change the wRC+ compression — the two are independent.
11. **NEW — Wardley's Brier is 0.2500, a coin flip.** The `scout` method either needs
    a longer-horizon re-fit or he is deliberately near-worthless. See Known
    limitations; this is the one open item the forecaster pool has.
12. **NEW — the crowd's fade strategy does not survive measurement.** Chasing beat
    fading on both the crowd path and the no-crowd control, so the edge is the price
    path's own mean reversion rather than anything the crowd adds. Is the design
    premise being kept for now and reported honestly, or revised?
13. ~~**`buildPlayoffProjection` is dead code with two confirmed red bugs.**~~ **RESOLVED
    — deleted, not fixed.** It was dead on arrival: `3a5eebd` ("Ver 0.0.4",
    2026-03-02) created `src/logic/playoffs.ts` and `PlayoffsBracket.tsx` in a single
    commit, and searching every file in every commit turned up exactly one line ever
    added containing the string `buildPlayoffProjection` — its own definition. **No
    caller ever existed**, so the two confirmed red bugs (wild cards paired by seed
    index rather than role, so a runner-up can appear in a card labelled "Wild Card";
    and weak wild-card matchups projecting as 2–0 sweeps at a 6-win separation
    threshold) were never seen by a player and were fixed by deletion instead.
    111 lines and 7 symbols removed: types `ProjectedSeries`,
    `LeaguePlayoffProjection`, `PlayoffProjection`, and private
    `getLeagueProjection`, `buildProjectedSeries`, `getProjectedSeriesScore`.

    **Deletion chosen over shipping**, because "who wins" is already a shipped
    capability — `analytics/playoffMonteCarlo.ts` samples the remaining schedule, is
    live in `priceBoard.ts:405`, and is fitted into `teamValue.ts`. Shipping the
    projection would have added a second and worse mechanism for a question already
    answered properly.

    **The trap, recorded because it is one line away:** `SeededPlayoffTeam.clinchType`
    is **live** (`simulationManager.ts:535,546`, `PlayoffsBracket.tsx:102`,
    `TeamCalendar.tsx:102,109`). The exported `ClinchType` alias has no importers —
    those sites use the literal `'wildcard'` — but the field is load-bearing, so both
    the alias and the field stayed. Verified after the delete: `tsc` still 10 errors
    (the documented baseline), `checkPlayoffElimination` all passed,
    `provePlayoffEliminationGuard` 7/7, `checkLockedRaces` all passed,
    `verifyLockedRaces` exploit closed, `proveLockedRacesGuard` 9/9.

    One stale sentence was found by the delete rather than by any check: the in-app
    book claimed the Playoffs page "uses a live projection engine seeded from current
    standings". That was never true. Corrected to say the bracket seeds a real field
    and plays series out, with outcome probabilities in the Monte Carlo engine.
14. **NEW — the bracket's empty live-card footer needs eyes.** Removing the stakes
    footer left live series cards with an empty lower region. The card still reads
    correctly (gold left-edge, IN PROGRESS label) but the vertical balance changed
    and only a browser can confirm whether it looks hollow. If it does, the fix is a
    borderless padding strip — **not** reinstated prose.
15. **NEW — 39 commits are unpushed.** `local` is ahead of `origin/local` and no push
    has been attempted.
16. **NEW — the ~22 MB of raw PNGs in `src/assets/media/` should probably go.** They
    are unreferenced next to their WebP versions, and an untracked
    `fuyukashinonome2.png` (3.1 MB) sits among them. Third time this project has
    shipped oversized art.
