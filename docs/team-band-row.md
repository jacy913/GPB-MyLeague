# The Club Band — the house style for "a team's row"

This is the design standard behind the Booth Metrics boards, extracted so every screen
that shows **a row with a team crest** describes a club the same way. It was written
after the Booth boards were called the best UI in the app; the point of writing it down
is that the next screen does not have to reinvent it.

The executable form of this document is `src/components/ui/ClubBand.tsx`. **If the code
and this document disagree, the code is right** — fix this file.

---

## What the band is

A club band is a **row** made of exactly three parts:

1. **The fill.** The row is filled with `clubTint(club, 0.22, surface)` — the club's
   colour mixed *into the surface*, never the raw palette primary.
2. **The edge.** A **5px** bar of full-strength `clubInk(club, surface)` down the
   **leading** side.
3. **The cropped crest.** The crest is drawn **larger than the row** and clipped to the
   row's height, so it bleeds off the top and bottom.

That is the whole design. The rank numeral, the figures and the name are content the
caller supplies; they are not part of the band.

```
┌──────────────────────────────────────────────────────────┐
│▌ 1   ╭────╮   9 teams above .500 faced            12–7   │  ← row height H
│▌    │crest│                                             │
│▌    ╰────╯                                             │
└──────────────────────────────────────────────────────────┘
 └5px └ fill = clubTint(club, 0.22, 'panel')      crest = H × 1.45, clipped to H
  clubInk
```

---

## Why each part is the way it is

### The fill is a tint, never the raw colour

Real uniforms run from near-black to white, and this app's surfaces are dark navy.
Measured against `--color-panel`, three of the 32 club primaries are **below 1.2:1** and
would be *invisible* as a fill. `clubInk` lifts a colour into the legible band while
holding its hue, and `clubTint` mixes it into the named surface in OKLab. The result:
all 32 clubs get the same treatment, and none of them is the club whose colour happens
to be bright enough to work.

Never hardcode a club colour. Never read `teamColors[id].primary` directly. Ask
`clubBandPalette`.

### The edge is at the leading side, not under the text

The full-strength colour is the part you actually recognise, but a full-strength club
colour under a figure is a legibility problem. So it goes on an edge, where it cannot sit
underneath anything.

### `0.22` is the club's share

`clubTint(club, amount)` — `amount` is the club's share, so `0.22` means "22% club, 78%
surface". It is a **chosen** number, shared with the Results scorebug's band. If you want
a different weight, change `CLUB_BAND_TINT` in one place, not a call site.

### The crest is cropped, not shrunk

The crest is drawn at `height × 1.45` (≈1.45× the row) inside a window that is exactly
the row's height, with `overflow: hidden`. It bleeds ~16px off the top and bottom on a
72px row. The window is exactly the crest's **width**, so the mark is only ever clipped
**vertically** — a club's crest is never cut off at the sides.

Why crop at all: at a small overdraw (1.34 was tested) the discarded margin is almost all
transparent padding inside the PNG, so the numbers say "cropped" and the picture says
"not". The overdraw has to take a real bite of the outer edge before the mark reads as
fitted *into* the row rather than merely drawn on it.

---

## The one rule that is easy to get wrong

> **Row height and crest size are inline styles, not Tailwind arbitrary classes.**

An **interpolated** class name — `` `h-[${height}px]` `` — never reaches the Tailwind
scanner. It compiles to nothing, the element sizes to its content, and the crop silently
does not happen. This is not hypothetical: the Results scorebug shipped with
`` `h-[${BAND_H}px]` `` and **never actually cropped**, while the code and its comment
both claimed it did.

- **Static** arbitrary classes are fine: `w-[5px]`, `w-[86px]`.
- **Computed** sizes go in `style={{ height, width }}`.

## The other rule (it is older and it still holds)

> **Club colour never carries meaning. It may decorate; it may never be the only thing
> distinguishing one state from another.**

28 club slots sit within CIE Lab ΔE 12 of a semantic token. A red tint that means "this
club" and a red tint that means "you lost money" cannot share a pixel. So:

- gold stays gold for elite OVR,
- `--color-pos` / `--color-neg` stay for money and playoff state,
- and when a row stops using a **semantic border** to mark a state (e.g. the Division
  Snapshot's gold left border for the top two), **move that state somewhere that still
  reads** — the ordinal in gold — rather than letting the club edge eat it.

---

## How to apply it

### A list (`<li>`) — the easy case

Use `ClubBandRow`. It renders the fill, the edge, an optional ordinal, the cropped crest
and your content:

```tsx
import { ClubBandRow } from '../ui';

<ClubBandRow
  team={team}                    // the club; null is fine (neutral band)
  teamId={teamId}                // the id, in case `team` is not resolved
  height={72}                    // row height in px — drives the crop
  rank={index + 1}
  name={`${team.city} ${team.name}`}   // sr-only + tooltip, for a row that drops the name
>
  <p className="min-w-0 flex-1 truncate t-caption text-[var(--color-ink-dim)]">
    {support}
  </p>
  <span className="shrink-0 t-stat-lg text-[var(--color-gold)]">{primary}</span>
</ClubBandRow>
```

### A table (`<tr>`) — a `<tr>` cannot be an `<li>`

Use the two pieces directly:

1. `clubBandPalette(teamId)` → `{ fill, edge }`.
2. `CroppedCrest` → the crest window, in the team cell.

```tsx
import { clubBandPalette, CroppedCrest } from '../ui';

const rows: StatTableRow[] = teams.map((team, index) => ({
  id: team.id,
  band: clubBandPalette(team.id as TeamId),   // StatTable paints the fill + leading edge
  cells: {
    team: (
      <>
        <span>{index + 1}</span>
        <CroppedCrest team={team} height={ROW_H} />
        <span>{team.city} {team.name}</span>
      </>
    ),
    // …the rest of the columns
  },
}));
```

`StatTable` already understands `row.band`: it replaces the zebra stripe with the club
fill and draws the club's edge as the first cell's left border. **Pass the row height you
gave `density`** (`StatTable`'s `large` is 58, `default` is 50, `dense` is 34); the crest
is cropped to it, so the two numbers must agree.

#### A hand-built `<table>` (not a `StatTable`)

Some boards are their own `<table>` and never went through `StatTable`. They still take the
same three parts, wired by hand — the `<tr>` wears the fill, the **first** cell's left
border is the edge, and the crest lives in the club cell:

```tsx
const { fill, edge } = clubBandPalette(row.teamId as TeamId);
<tr style={{ background: fill, height: ROW_H }}>
  <td style={{ borderLeft: `${CLUB_BAND_EDGE_WIDTH}px solid ${edge}` }} className="py-0 align-middle">
    <span className="t-stat tabular-nums">{row.rank}</span>
  </td>
  <td className="px-2 py-0 align-middle">{/* CroppedCrest + city + name */}</td>
  …
</tr>
```

Three details that are not optional:

- **`py-0` on every cell, and `height` on the `<tr>`.** This is the no-vertical-padding rule
  below, and a table makes it easier to break because the old markup usually had `py-2`.
  A `py-2` cell lets the row grow past the crest window and the crest floats free of the
  top and bottom edges with a strip of club colour around it.
- **`align-middle` on the cells.** `height` on a `<tr>` is only a minimum; cells of unequal
  content height otherwise baseline-align, and the figures beside a 52px crest drift.
- **`border-collapse` on the `<table>`.** With the default `separate` borders model, a
  background on a `<tr>` leaves hairline gaps at the row seams.

Note that the edge lands on the **first** cell, which is usually the rank column rather
than the club. That is deliberate — the edge belongs to the row, and the rank is where the
row starts. Nudge that cell's `pl` down by the edge width if the ordinal shifts.

#### A list row that is also a disclosure

`ClubBandRow` renders the crest and the ordinal *before* its children, so it cannot be
used when the whole row has to be a `<button>` — the mark would fall outside the click
target. In that case put the band on the `<li>` and the crest inside the button, using the
same two pieces directly:

```tsx
const { fill, edge } = clubBandPalette((entry.team?.id ?? null) as TeamId | null);
<li className="relative overflow-hidden" style={{ background: fill }}>
  <span aria-hidden="true" className="absolute inset-y-0 left-0"
        style={{ width: CLUB_BAND_EDGE_WIDTH, background: edge }} />
  <button className="flex w-full items-center gap-3 px-3">   {/* pl/pr only — no py */}
    {entry.team ? <CroppedCrest team={entry.team} height={ROW_H} /> : <span style={{ height: ROW_H, width: … }} />}
    …
  </button>
</li>
```

Two notes specific to this shape:

- **The fill goes on the `<li>`, not the `<button>`,** so a hover on the button cannot bury
  it. An inline `style` beats a `hover:bg-*` class on the *same* element, so putting the
  fill on the button would silently kill the hover highlight; on the `<li>` the button
  overlays it, so the hover colour is what has to be translucent. The Awards page uses
  `hover:bg-[color:color-mix(in_srgb,var(--color-ink)_6%,transparent)]` — a light wash that
  lifts the club tint instead of replacing it with a neutral panel.
- **An expanded row tints its breakdown too,** because the disclosure panel is a sibling of
  the button inside the `<li>`. That is wanted: it ties the expanded arithmetic to the club
  it belongs to. It is worth knowing before someone "fixes" it.

The leading edge also displaces the leader marker. When a row marked its leader with a
semantic left border or a lifted background, that has to move: **club colour may never
carry meaning.** Put the marker on the ordinal in gold (what the dashboard Award Race and
the Awards page now do).

### No vertical padding on a band row

This is the mistake that makes a band row look wrong, and it is easy to make because it
is invisible in the code: **the crest IS the row height, so any vertical padding on the
row pushes the crest in from the top and bottom edges and leaves a strip of club colour
above and below the mark.**

A first cut of the Power Rankings strip kept the old `py-2` on the row's inner flex box.
The crest window was 44px, the row grew to 60px to hold it plus the padding, and the
crest floated with an 8px margin. It cropped correctly and still looked wrong.

So a band row has **horizontal padding only**:

```tsx
// right
<div className="flex items-center gap-3 pl-4 pr-4"> … <CroppedCrest height={H} /> … </div>

// wrong -- 8px of club colour above and below the crest
<div className="flex items-center gap-3 px-4 py-2"> … <CroppedCrest height={H} /> … </div>
```

If you want a taller row, raise `height`; do not pad around the crest.

### Choosing a row height

| Context | Height | Density |
| --- | --- | --- |
| Booth Metrics board | 72 | — (custom list) |
| Awards race row — Awards page | 64 | `ClubBandRow` |
| Season Awards modal card row | 64 | `ClubBandRow` |
| Standings | 58 | `large` |
| Power Rankings board | 52 | — (custom `<table>`) |
| Award Race | 48 | `ClubBandRow` |
| Power Rankings strip | 44 | — (custom list) |
| Division Snapshot | 34 | `dense` |

The crest is always that number × 1.45, clipped back to it.

Roughly, the height follows how much else the row has to hold: a row with only an ordinal
and figures is comfortable at 34–44, a row that also carries a name and a second line wants
52–64, and a board whose crest is the whole point (Booth, Awards) goes to 64–72. The two
Power Rankings rows differing (strip 44, board 52) is the same data at two altitudes — the
strip is a glance, the board is a read — and they are allowed to differ because each is
tuned against what it sits next to, not against the other.

---

## Where it is used

- `src/components/league/BoothMetrics.tsx` — the boards (the original)
- `src/components/StandingsHub.tsx` — the standings tables
- `src/components/leaders/PowerRankingsView.tsx` — the full board (hand-built `<table>`)
- `src/components/awards/AwardsPage.tsx` — the award race (disclosure rows)
- `src/components/SeasonAwardsSummary.tsx` — the season-end modal's award cards
- `src/components/home/PowerRankingsStrip.tsx` — the dashboard's top five
- `src/components/home/Panels.tsx` — the dashboard's Division Snapshot
- `src/components/home/MvpRacePanel.tsx` — the dashboard's Award Race (the row wears the
  candidate's club; the leader is marked by a gold ordinal, since the club edge owns the
  left border)
- `src/components/game/ScorebugCard.tsx` — the Results scorebug (its own three crop
  modes; shares the inline-style crop rule)

## Where it should go next

Any surface that renders a crest in a row and does **not** yet wear the band. The
remaining ones are the team hub and roster rows, the Draft board, and the trade desk.
`src/components/LeadersHub.tsx` has crest cells too, but they are 24px marks inside a
*player's* row — the row belongs to a person, not a club, so banding it would tint a
player's row with a club's colour. That is a case where the rule should **not** be applied.
