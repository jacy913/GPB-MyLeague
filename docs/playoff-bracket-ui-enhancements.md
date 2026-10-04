# Playoff Bracket UI — Enhancement Summary
## What changed, why, and what remains

---

> **Files touched:** `src/components/PlayoffsBracket.tsx`, `src/App.tsx`
> **Date:** 2026-10-04
> **Type:** Presentation only. No bracket logic, seeding, scheduling, or settlement was modified.

---

# 1. WHAT CHANGED

Four issues were reported from the running product. All four were confirmed against source before any edit, and all four turned out to be presentation rather than logic.

| # | Issue | Root cause | Fix |
|---|---|---|---|
| 1 | `BO3` / `BO5` / `BO7` in card headers | Developer shorthand printed directly | Line deleted |
| 2 | Extra text: "1 from 3", "Match point", "eliminated" | Redundant restatement of on-card numbers | 3 strings deleted + dead plumbing removed |
| 3 | Seed number disappears; leagues not colour-coded | Gold overrode league colour; trailing seed receded onto a dark chip | League colour now primary; gold reassigned |
| 4 | Old simulation popup | Last unmigrated surface in the shell | Unmounted |

**Typecheck went from 15 errors to 10.** The five that disappeared were the unused import plus unused-symbol warnings in the edited region. The remaining 10 are pre-existing and live in other files — see §7.

---

# 2. FIX 1 — `BO3` / `BO5` / `BO7`

## Before

```
┌──────────────────────────────────────────────┐
│ WILD CARD                 [IN PROGRESS]  BO3 │
├──────────────────────────────────────────────┤
```

## After

```
┌──────────────────────────────────────────────┐
│ WILD CARD                 [IN PROGRESS]     │
├──────────────────────────────────────────────┤
```

## Why

`BO3` is spreadsheet shorthand. It is what an engineer writes in a planning table, not what belongs above a matchup. Real broadcast and scoreboard convention names the round — *Wild Card*, *Divisional*, *League Series* — and leaves the length to be read off the pips.

It was also redundant. `SeriesPips` already draws **one diamond per game in the series**, so a three-game series is visibly three diamonds. The number stated what the shape beside it already showed.

## Detail

The label sat in a header row that had been deliberately redesigned to "say what it means." The redesign rebuilt the header and left this one node in place — the tell of an edit that missed a child.

---

# 3. FIX 2 — THE REDUNDANT TEXT

Three strings, all removed:

| Was | Where | Replaced by |
|---|---|---|
| `1 from 3` | Beside each club's win count | Nothing — the diamonds |
| `Match point — X needs one more` | Card footer | Nothing — the wins are printed |
| `{City} eliminated` | Card footer | Nothing — the series winner is shown |

## Before

```
┌──────────────────────────────────────────────┐
│ WILD CARD                 [IN PROGRESS]     │
├──────────────────────────────────────────────┤
│ ▌[3] Sinope Seals                           │
│ ▌     Seals · 94-52        1 from 3     2◆◆ │
│ ▌[5] Calfein Phantoms                       │
│ ▌     Phantoms · 71-63               1 ◆◆◇│
├──────────────────────────────────────────────┤
│ Match point — Sinope Seals needs one more    │
│ Calfein Phantoms eliminated                  │
└──────────────────────────────────────────────┘
```

## After

```
┌──────────────────────────────────────────────┐
│ WILD CARD                 [IN PROGRESS]     │
├──────────────────────────────────────────────┤
│ ▌[3] Sinope Seals                           │
│ ▌     Seals · 94-52                    2 ◆◆ │
│ ▌[5] Calfein Phantoms                       │
│ ▌     Phantoms · 71-63                  1 ◆◆◇│
└──────────────────────────────────────────────┘
```

## Why

The requirement was a number that increments. Everything else on that card was a restatement of two figures already printed directly above it.

A reader looking at `2◆◆` against `1◆◆◇` needs no prose to conclude that Sinope is one win from ending it. The prose occupied a third of the card to say what the shapes said for free — and on a card whose entire purpose is to be scanned, that is the worst possible trade.

## The plumbing that went with it

Removing the strings orphaned a chain of props that existed **only** to support them:

| Removed | Threaded through |
|---|---|
| `isClinch` | `BracketTeamRow` signature, both call sites, and its two conditional branches |
| `winsNeeded` | Same path, plus the `1 from {winsNeeded}` interpolation |
| `topClinch` / `bottomClinch` | `BracketSeriesCard` derivation |
| `eliminated` | `BracketSeriesCard` string build |
| `winsNeeded` (card level) | `BracketSeriesCard` derivation and the footer line |

The clinch state also drove a **second visual**: `isClinch` selected a red left-edge and a `base-2` background on a trailing team at match point. That red edge is gone. The trailing team now falls through to `border-l-transparent`, which is what a non-leading team shows in every other state — so **match point no longer repaints the card.**

Verified clean afterwards: a repo-wide search for `isClinch`, `winsNeeded`, `topClinch`, `bottomClinch`, `eliminated`, and `1 from` returns **no hits in `PlayoffsBracket.tsx`**. Remaining hits elsewhere are unrelated — `winsNeeded` is legitimate in `simulationManager`, `playoffs`, `futuresRisk`, and `playoffMonteCarlo`, where it decides when a series is over.

---

# 4. FIX 3 — THE SEED BADGE

This was **two bugs in one component**, and the second was masking the first.

## 4.1 Leagues were not colour-coded

The badge forced seeds 1 and 2 to gold regardless of league:

```tsx
const isTopSeed = seed <= 2;
const fill = isTopSeed ? 'bg-[var(--color-gold)]' : leagueFill;
```

So a seed-1 in Prestige and a seed-1 in Platinum were **both gold** — and the two best clubs in the league were the one pair a reader could not tell apart. The league colour only appeared at seeds 3 and 4.

The original reasoning was that "a top-two seed is the only seeding distinction that means something postseason." That is true *within* a league, and irrelevant *between* them.

**Fix:** the gold override is gone. Every badge carries its league colour. Gold is now free.

**Gold was reassigned to the thing it was crowding out** — the series lead. `isLeader` already drives a gold left-edge and gold row background on `BracketTeamRow`, so gold now means *"leading a series,"* which is the distinction that changes what happens next.

## 4.2 The seed number disappeared

The trailing team was dimmed twice:

```tsx
dimmed ? 'bg-[var(--color-panel-2)] text-[var(--color-ink-dim)]'
       : `${fill} text-[var(--color-ink-invert)]`
```

The chip dropped to a **dark recessed surface** with dim grey text. On a dark navy card, a seed-3 team that was behind rendered as a barely-visible digit — the least readable number anywhere on the card, and it was the number most likely to matter.

**Fix:** the chip keeps its league colour whether the team is leading or not. Only the **ink** softens.

| | Leading | Trailing |
|---|---|---|
| **Before** | Gold chip (seeds 1–2) or league chip (3+), ink-invert | **Dark recessed chip, dim ink** |
| **After** | League chip, ink-invert | League chip, dim ink |

## 4.3 Result

```
Prestige                            Platinum
▌[1] Andria Arcs              ▌[1] Sinope Seals
▌[3] Calfein Phantoms         ▌[3] Baytoloc Railbirds
```

Both leagues read at a glance, and **every seed stays legible in both states.**

---

# 5. FIX 4 — THE OLD SIMULATION POPUP

`SimulationFloatingPanel` was unmounted from `App.tsx`.

## Why it qualified as "old UI"

Every element in it predated the design system:

| Element | Problem |
|---|---|
| `font-mono` | The retired developer typeface; one of 737 instances targeted for removal |
| `font-headline` | **Declared as "Norwester" — a family never loaded anywhere.** It silently fell back to Teko |
| `rounded-[1.75rem]`, `rounded-2xl`, `rounded-1.5rem`, `rounded-full` | Five distinct large radii in one 93-line component |
| `bg-[linear-gradient(135deg,#121212,#1b1b1b,#101010)]` | Hardcoded hex gradient |
| `border-[#d4bb6a]/20`, `text-[#d8c88b]`, `text-[#f3dea1]` | More hardcoded hex |
| `shadow-[0_20px_60px_rgba(0,0,0,0.52)]` | Blurred soft shadow, explicitly prohibited |

It was the **last unmigrated surface in the application shell**, and it sat on top of the bracket during exactly the runs a manager is watching — which is why it was noticed.

## Unmounted, not deleted

The component file is intact and the mount site carries a comment explaining the removal and pointing at the modern replacement. This is deliberately reversible.

**Dependency check performed before touching anything.** `isSimulating`, `simulationProgress`, and `cancelSimulationRun` all have other callers:

| Prop | Callers in `App.tsx` |
|---|---|
| `isSimulating` | 9 |
| `simulationProgress` | 3 |
| `cancelSimulationRun` | 4 |

`SimulationHub` and the completion receipt consume all three. **Nothing went dead with the panel.** The now-unused import was removed separately, which is what accounted for the error-count reduction.

## Replacement

`SimulationHub` carries the same three facts — label, active date, games completed — on tokens, and is reachable from the COMMISSIONER rail and from the completion receipt.

---

# 6. VERIFICATION

```powershell
npx tsc --noEmit
```

| | Before | After |
|---|---|---|
| Total errors | 15 | **10** |
| In files touched | 5 | **0** |

```powershell
# no orphaned clinch plumbing in the bracket
Select-String -Path "src\components\PlayoffsBracket.tsx" `
  -Pattern "isClinch|winsNeeded|topClinch|bottomClinch|eliminated|BO\{"
# EXPECT: no output
```

Both confirmed clean.

---

# 7. NOT TOUCHED — THE REAL LOGIC ISSUES

These were found in the same review and are **deliberately unchanged.** None is a display problem, and two are invisible because the code that contains them is never called.

| Finding | Severity | Why untouched |
|---|---|---|
| `getHomeRecords` files a **tied** game as a home loss | 🟠 | Unreachable — baseball games cannot tie. Two-minute defensive fix, worth doing |
| Wild card series paired by **seed index**, not by role | 🔴 | `clinchType` is stored on every seeded team and never read. Two wild cards can be drawn against each other while a runner-up sits in a card labelled "Wild Card" |
| Weak wild card matchups project as **2–0 sweeps** | 🔴 | Threshold is 6 wins of separation, which is ordinary in an 8-team field |
| **The entire projection system is dead code** | ⚪ | `buildPlayoffProjection` has **zero callers.** The real bracket is built in `simulationManager.ts`. Findings 2 and 3 above are correct bugs that **no player will ever see** |
| `seeds[5]` unguarded | 🟠 | Unreachable at 32 teams; throws if any division drops below two |
| World Series day offsets copied from League Series | 🟠 | Cosmetic. Real baseball varies the final-series format deliberately |

**The judgement call:** the two red findings were left alone because the projection is dead. Fixing bugs in code nothing calls is wasted motion, and doing it would suggest the projection is live. **The real decision is binary — ship the projection or delete it.**

---

# 8. ONE FOLLOW-UP THAT NEEDS EYES

Removing the card footer leaves **live series cards with an empty lower region.** The card still reads correctly — the gold left-edge, the leading row's gold edge, and the IN PROGRESS label all remain — but the vertical balance has changed and only a browser can confirm whether it looks hollow.

**If it does,** the fix is a borderless padding strip rather than reinstated text. The prose should not come back.

---

# 9. SUMMARY FOR THE RECORD

| Fix | Lines | Surface |
|---|---|---|
| Remove `BO{n}` | 1 deleted | `PlayoffsBracket.tsx:734` |
| Remove clinch/eliminated text | ~14 deleted | Lines 675–677, 715–717, 761–769 |
| Remove dead clinch plumbing | ~12 deleted | 5 signature/call-site locations |
| League colour over gold on seed badge | 2 changed | `SeedBadge` |
| Trailing seed stays legible | 1 changed | `SeedBadge` |
| Unmount old sim popup | 14 → comment | `App.tsx:3839` |
| Remove dead import | 1 deleted | `App.tsx:30` |

**Net: presentation only.** Bracket structure, seeding order, tiebreakers, scheduling offsets, series progression, and settlement are all byte-for-byte unchanged.

The one substantive judgment: **gold was reassigned from "top-two seed" to "leading a series."** That changes what a colour means on this screen, so it is the item most worth reviewing in the browser — alongside the empty card footer.