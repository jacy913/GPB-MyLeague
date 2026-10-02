import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Flame, LineChart, Receipt, ShieldCheck, Trophy, Users } from 'lucide-react';
import type { MediaId } from '../../data/media';
import { MEDIA_PROFILES, MEDIA_BY_ID } from '../../data/media';
import type { FieldMarket, LineMarket } from '../../lib/markets';
import { formatAmerican, WORLD_SERIES_MARKET_KEY } from '../../lib/markets';
import { futuresRiskRead, type FuturesRiskTier } from '../../lib/futuresRisk';
import macrobetLogo from '../../assets/macrobetlogo-trim.png';
import { formatResolutionDate, resolveDateFor, type SeasonCalendar } from '../../lib/marketDates';
import type { GameLine } from '../../lib/mediaOdds';
import { propMarketTitle, propSelectionLabel } from '../../lib/mediaProps';
import { MAX_PROPS_PER_OUTLET } from '../../lib/mediaProps';
import { propSidePrices, type PropMarket, type PropSide, type PropStatKey, type PropTemperament } from '../../lib/playerProps';
import type { PlacedBet, BetKind, BetStatus, Selection } from '../../lib/wallet';
import { MAX_STAKE, MIN_STAKE, STARTING_BALANCE, settleReturn } from '../../lib/wallet';
import type { PropFocus } from '../../hooks/useBettingSlip';
import { MEDIA_MARKS_SQUARE } from '../media/mediaImages';
import { Panel, RetroButton, SegmentedControl, TeamLogo } from '../ui';
import { BetFixtureLine, buildFixtureLookup, fixtureForBet } from './BetFixtureLine';
import type { Team } from '../../types';

type BettingView = 'slate' | 'props' | 'futures' | 'awards';

interface BettingSlateProps {
  view: BettingView;
  onView: (view: BettingView) => void;
  lines: LineMarket[];
  moneyline: GameLine[];
  /** Each outlet's published props for the slate, at most five apiece. */
  propBoards: Map<MediaId, PropMarket[]>;
  /** A prop arrived at from The Media: the id, and the outlet whose card was clicked. */
  focusedProp: PropFocus | null;
  futures: FieldMarket[];
  awards: FieldMarket[];
  /**
   * Every club, so a field row can draw the crest.
   *
   * `MarketOutcome.key` is already the team id -- settlement looks the club up by it --
   * so this map is the only new thing a crest needs, and it removes any second way of
   * writing down which club a row is about.
   */
  teams: Team[];
  /**
   * The season's projected calendar, so every market can say when it resolves.
   *
   * Passed in rather than recomputed per row, because the calendar is derived from
   * the whole schedule and a component recomputing it would be a second derivation
   * that could disagree with the first. One calendar, one answer.
   */
  calendar: SeasonCalendar;
  slateDate: string | null;
  bets: PlacedBet[];
  onPlace: (input: {
    kind: BetKind;
    marketKey: string;
    marketTitle: string;
    selection: Selection;
    selectionLabel: string;
    price: number;
    line?: number;
    /**
     * When this market settles, from the board that is offering it.
     *
     * Required in spirit and optional in type only so that a caller who genuinely has
     * no date cannot be blocked from placing a bet. Every board that offers a real
     * market knows one: a game knows its own date, a prop carries its game's, and a
     * future resolves through `resolveDateFor`. A bet placed without one is recorded
     * without one and the open-bets list says so.
     */
    resolvesOn?: string;
    backedMedia: MediaId | null;
    propStat?: PropStatKey;
    propPlayerId?: string;
    propPlayerName?: string;
    propLine?: number;
  }) => void;
  balance: number;
}

/**
 * Betting.
 *
 * The three published markets in one place, against the same numbers The Media
 * shows. The separation is deliberate: The Media is the outlets' opinion, this is
 * your stake against it.
 *
 * Nothing is wagered from a house line the bettor cannot also see the reasoning
 * behind. Every row carries the consensus and, where the outlets split, which one
 * is furthest from it, because a bet placed against an outlier is the only
 * version of this that is a decision rather than a coin toss.
 */
export const BettingHub: React.FC<BettingSlateProps> = ({
  view, onView, lines, moneyline, propBoards, focusedProp, futures, awards, teams, calendar, slateDate, bets, onPlace, balance,
}) => {
  const propCount = MEDIA_PROFILES.reduce((sum, profile) => sum + (propBoards.get(profile.id)?.length ?? 0), 0);

  return (
    <section className="space-y-5">
      {/*
        THE HEADER IS THE LOGO.

        The page is called MacroBet and now says so in its own wordmark rather than in an
        `<h1>Betting</h1>` with a paragraph explaining the pricing underneath. The paragraph was
        not wrong, but it was the wrong thing at the top of the page: it described the model to
        somebody who had come to place a bet, and it pushed the tabs a third of a screen down.

        The one thing that must not go is the ACCESSIBLE NAME. A logo is an image, and an image
        whose alt text is empty leaves a screen reader announcing nothing at all for the page's
        own name. So the alt is the name, the `<h1>` is the name, and the pixels are decoration
        on top of a real heading -- which is the only arrangement where the logo can be removed
        tomorrow without losing the page title.

        Sized off the crop's own 2.18:1 aspect rather than by eye, and tall enough to hold the
        swash flourishes without competing with the tab row beneath it.
      */}
      <Panel variant="hero" className="p-4 md:p-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <h1 className="min-w-0">
            <img
              src={macrobetLogo}
              alt="MacroBet"
              className="h-12 w-auto select-none md:h-14"
            />
          </h1>
          <div className="border-l-[3px] border-l-[var(--color-gold)] bg-[var(--color-sunken)] px-4 py-3 text-right">
            <p className="t-caption text-[var(--color-ink-faint)]">Balance</p>
            <p className="t-stat-lg text-[var(--color-gold-hi)]">${Math.round(balance)}</p>
          </div>
        </div>
      </Panel>

      <div className="flex flex-wrap items-center gap-3">
        <SegmentedControl
          aria-label="Betting market"
          mode="fill"
          value={view}
          onChange={(value) => onView(value as BettingView)}
          options={[
            { value: 'slate', label: 'Next Slate' },
            { value: 'props', label: propCount > 0 ? `Props (${propCount})` : 'Props' },
            { value: 'futures', label: 'Season Futures' },
            { value: 'awards', label: 'Awards' },
          ]}
        />
        {view === 'slate' && (
          <span className="t-caption text-[var(--color-ink-faint)]">
            {slateDate ? `${slateDate} · ${lines.length} ${lines.length === 1 ? 'game' : 'games'}` : 'No slate ahead'}
          </span>
        )}
        {view === 'props' && (
          <span className="t-caption text-[var(--color-ink-faint)]">
            {slateDate ? `${slateDate} · up to ${MAX_PROPS_PER_OUTLET} per outlet` : 'No slate ahead'}
          </span>
        )}
      </div>

      <OpenBets bets={bets} moneyline={moneyline} />

      {view === 'slate' && <SlateView lines={lines} moneyline={moneyline} onPlace={onPlace} balance={balance} />}
      {view === 'props' && (
        <PropsView
          boards={propBoards}
          focusedProp={focusedProp}
          onPlace={onPlace}
          balance={balance}
          slateDate={slateDate}
          moneyline={moneyline}
        />
      )}
      {view === 'futures' && <FuturesView markets={futures} onPlace={onPlace} balance={balance} calendar={calendar} teams={teams} />}
      {view === 'awards' && <AwardsView markets={awards} onPlace={onPlace} balance={balance} calendar={calendar} teams={teams} />}
    </section>
  );
};

/* ------------------------------------------------------------------ *
 * Slate -- moneyline, total and first five
 * ------------------------------------------------------------------ */

const SlateView: React.FC<{
  lines: LineMarket[];
  moneyline: GameLine[];
  balance: number;
  onPlace: BettingSlateProps['onPlace'];
}> = ({ lines, moneyline, balance, onPlace }) => {
  if (lines.length === 0 && moneyline.length === 0) {
    return (
      <Panel className="p-6">
        <p className="t-body text-[var(--color-ink-dim)]">No further games are scheduled this season.</p>
      </Panel>
    );
  }

  // One card per game, moneyline above the total. A real board groups a game's
  // markets under the game, and comparing "who wins" against "how many runs" is
  // a decision about the same fixture, not two screens.
  const totalsByGame = new Map(lines.map((line) => [line.key.replace(/^(total|first5):/, ''), line]));

  /*
   * Game id to date, off the slate's OWN moneyline list.
   *
   * The fallback branch below renders a total market as a standalone card, and a total
   * market carries no date of its own -- only `<kind>:<gameId>`. This supplies it from
   * the same array every other market on this screen reads, so a total bet is stored
   * with the date of the game it is about rather than a second derivation from the
   * schedule.
   */
  const dateOf = useCallback(
    (gameId: string) => moneyline.find((game) => game.gameId === gameId)?.date,
    [moneyline],
  );

  return (
    /*
     * THREE COLUMNS OF GAMES, from two up.
     *
     * The slate was one full-width card per game, and a card that used to hold a
     * moneyline table, a total table and a 300px action rail is not a card that
     * benefits from being 1200px wide -- roughly half of it was empty. Fifteen games
     * meant fifteen screens of scrolling to find the one you wanted.
     *
     * `md` and not `xl`, because the betting page is often the right pane of the shell
     * rather than a full-width route, and a three-column grid keyed off the viewport
     * would give three cramped columns in a 900px pane. The columns are content-width
     * enough to hold a crest, a price and a date on one line, which is what the card
     * needs and all it needs.
     */
    <div className="grid items-start gap-3 md:grid-cols-2 2xl:grid-cols-3">
      {moneyline.length > 0
        ? moneyline.map((game) => (
          <GameBetCard
            key={game.gameId}
            game={game}
            total={totalsByGame.get(game.gameId) ?? null}
            balance={balance}
            onPlace={onPlace}
          />
        ))
        : lines.map((line) => (
          <TotalMarketCard key={line.key} market={line} balance={balance} dateOf={dateOf} onPlace={onPlace} />
        ))}
    </div>
  );
};

const GameBetCard: React.FC<{
  game: GameLine;
  total: LineMarket | null;
  balance: number;
  onPlace: BettingSlateProps['onPlace'];
}> = ({ game, total, balance, onPlace }) => {
  /*
    ONE HALF OF THE TILE, AND IT IS THE BIGGEST THING ON THE CARD.

    This used to be a small `size="sm"` button holding a 24px crest and a 17px price --
    one chip in a row of chips. Three of those passes were rejected in a row, and the
    mistake they all shared is that I was reshaping a card rather than changing what a
    card IS: it kept the chrome-bar header, the Panel-in-a-grid, and the small button,
    and none of those are what the eye rejects.

    So the pitchfork. Two equal halves, crest above price, and the price is the biggest
    number anywhere on the board at `t-stat-hero` (30-44px). Backing a team is the act
    the screen exists to offer, so the thing you press is the thing you read.

    `flex-col` turns the button's own `inline-flex items-center justify-center` into a
    column, which stacks crest over price and centres both. No display override is
    needed, and that matters: fighting `inline-flex` with `flex` in a `className` is a
    coin toss on Tailwind's utility order, whereas `py-5` beating the `size` utility's own
    padding is not a coin toss, because padding utilities are emitted in ascending order.

    `size="sm"` NOT `lg`, which looks like a step backwards and is not. On this button the
    size utility only sets padding and a font class that both children override anyway, so
    its whole visible effect is `px-3` against `px-6`. At the slate's `md` two-column
    breakpoint a half-tile is about 170px, and 48px of that is the button's own horizontal
    padding -- against a hero price that can be six characters wide on a +1800 long shot.
    The vertical padding is set by `py-5` either way, which is the half that matters.

    THE CREST IS THE LABEL. The user was asked and said keep crests only. The city is
    still the button's accessible name, its tooltip, and the bet's `selectionLabel`, so
    the slip, the wallet and the settlement log all still say "Baltimore".
  */
  const side = (
    team: GameLine['awayTeam'],
    pick: 'away' | 'home',
    price: number,
  ) => (
    <RetroButton
      variant="default"
      size="sm"
      disabled={balance < MIN_STAKE}
      className="w-full flex-col gap-3 py-5"
      aria-label={`Back ${team.city} ${formatAmerican(price)}`}
      title={`${team.city} ${team.name}`}
      onClick={() => onPlace({
        kind: 'moneyline',
        marketKey: game.gameId,
        marketTitle: `${game.awayTeam.city} at ${game.homeTeam.city}`,
        selection: pick,
        selectionLabel: team.city,
        price,
        backedMedia: null,
        resolvesOn: game.date,
      })}
    >
      <TeamLogo team={team} sizeClass="h-14 w-14" />
      <span className="t-stat-hero">{formatAmerican(price)}</span>
    </RetroButton>
  );

  return (
    /*
      THE TILE. NO HEADER STRIP.

      The `chrome-bar` band that used to sit on top of every game card -- two crests, an
      "at", and the date -- is gone entirely, and that deletion is most of the redesign.
      It was the single oldest-looking element on the screen: a filled strip across the
      top of a card reads as a table row header, which is what makes a board look like a
      1990s box score. Every pass before this one kept it.

      What replaced it is two lines of plain text at the top of the tile and nothing with
      a background behind it. The date still leads, because on a board of fifteen games
      "when is this" is the question that decides whether you read the rest at all, but
      it is now a caption floating in the tile's own surface rather than a band.

      The tile is a `flex-col` with the footer pushed to the bottom by `mt-auto`, so
      tiles in the same grid row agree on their total height and the footers line up.
      Without that the pitchfork heights float and the row reads as ragged.
    */
    <Panel
      className="flex flex-col overflow-hidden"
      style={{ borderLeft: `3px solid ${NEUTRAL_BORDER}` }}
    >
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-3 pt-3">
        <h2 className="sr-only">{game.awayTeam.city} at {game.homeTeam.city}</h2>
        <span className="t-caption text-[var(--color-ink-dim)]">{formatResolutionDate(game.date)}</span>
        {game.disagreement >= 0.12 && (
          <span className="t-caption text-[var(--color-neutral-hi)]">
            outlets split
          </span>
        )}
      </div>

      {/*
        THE PITCHFORK.

        Two columns, equal, no divider between them. A divider was tried on the reasoning
        that two halves need separating, and the tile is better without it: the two crests
        face each other across a small gap and that gap IS the separation, while a rule
        between them reads as a table column rule and pulls the whole tile back toward the
        box-score look the redesign is trying to leave.

        `gap-2` rather than a gap between halves and a gap between rows -- there is only
        ever one row, so a two-axis gap would be a grid pretending to be a table.
      */}
      <div className="grid grid-cols-2 gap-2 px-3 pt-2">
        {side(game.awayTeam, 'away', game.houseOdds)}
        {side(game.homeTeam, 'home', game.homeOdds)}
      </div>

      {/*
        THE THIN FOOTER. Everything that is not the moneyline.

        This is where the three outlets and the run total went, and the user's instruction
        was to collapse them into a thin strip rather than let them compete with the
        prices. Two things make it work.

        First, the marks drop to h-4. Earlier passes argued at length that h-4 was too
        small and pushed them to h-5, and that argument was correct for a strip that sat
        beside prices in a card whose subject was the outlet read. It is wrong here. The
        tile's subject is the moneyline; a mark in the footer is a citation, and a
        citation does not need to be legible across the room, it needs to be identifiable
        at the foot of the card. Making them h-5 is what kept the footer competing.

        Second, the row is ONE line. Label, three mark+price pairs, house price, spread.
        No wrapping second line, no second label row.

        THE LABEL SAYS WHICH SIDE. `game.odds` is each outlet's posted price for the AWAY
        club only (`GameLine.odds` is documented as exactly that), so an unlabelled row
        of three prices under a tile showing two would be genuinely ambiguous -- a reader
        could take them for the home side. "Away, per outlet" is the honest label and it
        costs five words.
      */}
      <div className="mt-auto border-t border-[var(--color-chrome-lo)] px-3 py-2">
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
          <span className="t-caption text-[var(--color-ink-faint)]">Away, per outlet</span>
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
            {MEDIA_PROFILES.map((profile) => (
              <span key={profile.id} className="flex items-center gap-1">
                <img
                  src={MEDIA_MARKS_SQUARE[profile.id]}
                  alt=""
                  aria-hidden="true"
                  className="h-4 w-4 object-contain"
                />
                <span className="t-caption tabular-nums text-[var(--color-ink-dim)]">
                  {formatAmerican(game.odds[profile.id])}
                </span>
              </span>
            ))}
          </div>
          <span className="t-caption tabular-nums text-[var(--color-ink-faint)]">
            House {formatAmerican(game.houseOdds)} · {Math.round(game.disagreement * 100)} pts apart
          </span>
        </div>
      </div>

      {/*
        THE TOTAL, as a second strip in the same footer language.

        Its own hairline rather than sharing the outlets' row, because the two are
        different kinds of fact: one is what three forecasters say about WHO wins, the
        other is how many runs the house is offering. Merging them into one row would
        read as a single six-figure row of numbers, which is the mess this screen was
        redesigned to remove.

        The line is the hero here and the prices are captions, because on a total the
        LINE is the decision -- 8.5 is what you agree to, -110 is just what it costs.
        That inverts the moneyline's hierarchy deliberately: there the price is the
        decision because there is no line to agree to.
      */}
      {total && (
        <div className="border-t border-[var(--color-chrome-lo)] px-3 py-2">
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
            <span className="flex items-baseline gap-2">
              <span className="t-caption text-[var(--color-ink-faint)]">Total</span>
              <span className="t-stat-sm tabular-nums">{total.houseLine.toFixed(1)}</span>
            </span>
            <div className="flex items-center gap-1.5">
              <RetroButton
                variant="primary"
                size="sm"
                disabled={balance < MIN_STAKE}
                onClick={() => onPlace({
                  kind: 'total',
                  marketKey: game.gameId,
                  marketTitle: `${game.awayTeam.city} at ${game.homeTeam.city} total`,
                  selection: 'over',
                  selectionLabel: `Over ${total.houseLine.toFixed(1)}`,
                  price: total.overPrice,
                  line: total.houseLine,
                  backedMedia: null,
                  resolvesOn: game.date,
                })}
                /*
                  The button now reads "O -110" and the line sits beside it as its own
                  figure, so the accessible name and the tooltip have to carry the pairing.
                  "O" alone is not a bet -- over WHAT -- and an abbreviation that only makes
                  sense next to a number in the same visual group is not a name at all.
                */
                aria-label={`Back over ${total.houseLine.toFixed(1)} at ${formatAmerican(total.overPrice)}`}
                title={`Over ${total.houseLine.toFixed(1)} at ${formatAmerican(total.overPrice)}`}
              >
                O {formatAmerican(total.overPrice)}
              </RetroButton>
              <RetroButton
                variant="ghost"
                size="sm"
                disabled={balance < MIN_STAKE}
                onClick={() => onPlace({
                  kind: 'total',
                  marketKey: game.gameId,
                  marketTitle: `${game.awayTeam.city} at ${game.homeTeam.city} total`,
                  selection: 'under',
                  selectionLabel: `Under ${total.houseLine.toFixed(1)}`,
                  price: total.underPrice,
                  line: total.houseLine,
                  backedMedia: null,
                  resolvesOn: game.date,
                })}
                aria-label={`Back under ${total.houseLine.toFixed(1)} at ${formatAmerican(total.underPrice)}`}
                title={`Under ${total.houseLine.toFixed(1)} at ${formatAmerican(total.underPrice)}`}
              >
                U {formatAmerican(total.underPrice)}
              </RetroButton>
            </div>
          </div>
        </div>
      )}
    </Panel>
  );
};
const TotalMarketCard: React.FC<{
  market: LineMarket;
  balance: number;
  /**
   * Game id to the date that game is played, from the slate's own moneyline list.
   *
   * `LineMarket` carries no date of its own -- its key is `<kind>:<gameId>` and that
   * is all. Rather than add a field to every line market to serve one card, this
   * resolves the date through the same `moneyline` array the rest of this screen reads,
   * so the date on a total bet is the date of the game the card is about and cannot
   * disagree with the slate.
   *
   * Undefined when the game is not on the current slate. The bet is then placed
   * without a stored date and the open-bets list says so, rather than being given a
   * guessed one.
   */
  dateOf: (gameId: string) => string | undefined;
  onPlace: BettingSlateProps['onPlace'];
}> = ({ market, onPlace, balance, dateOf }) => {
  const firstHalf = market.kind === 'first5';
  const gameId = market.key.replace(/^(total|first5):/, '');
  const resolvesOn = dateOf(gameId);

  return (
    <Panel className="overflow-hidden">
      <div className="chrome-bar flex flex-wrap items-center justify-between gap-3 px-4">
        <div className="flex items-center gap-2">
          <LineChart className="h-4 w-4 text-[var(--color-gold)]" aria-hidden="true" />
          <h2 className="t-h3">{market.title}</h2>
        </div>
        <span className="t-caption text-[var(--color-ink-faint)]">{market.subtitle}</span>
      </div>

      <div className="grid gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_280px]">
        <div>
          <p className="t-caption text-[var(--color-ink-faint)]">
            {firstHalf ? 'First five innings' : 'Full game'} — each outlet's own fair number
          </p>
          <div className="mt-2 grid gap-2 sm:grid-cols-3">
            {MEDIA_PROFILES.map((profile) => (
              <div
                key={profile.id}
                className="border-l-[3px] bg-[var(--color-sunken)] px-3 py-2"
                style={{ borderLeftColor: `var(--color-media-${profile.accent})` }}
              >
                <div className="flex items-center gap-2">
                  <img
                    src={MEDIA_MARKS_SQUARE[profile.id]}
                    alt=""
                    aria-hidden="true"
                    className="h-5 w-5 object-contain"
                  />
                  <span className="t-caption text-[var(--color-ink-dim)]">{profile.outlet}</span>
                  {market.outlier === profile.id && (
                    <span className="t-caption text-[var(--color-warn)]" title="Furthest from the middle two">◆</span>
                  )}
                </div>
                <p className="t-stat-lg mt-1 tabular-nums">{market.fair[profile.id].toFixed(1)}</p>
              </div>
            ))}
          </div>
          <p className="t-caption mt-2 text-[var(--color-ink-faint)]">
            House line {market.houseLine.toFixed(1)} including margin, {market.spread.toFixed(1)} runs apart across the three.
          </p>
        </div>

        <div className="flex flex-col gap-2">
          <p className="t-caption text-[var(--color-ink-faint)]">Bet the house line</p>
          <RetroButton
            variant="primary"
            disabled={balance < MIN_STAKE}
            onClick={() => onPlace({
              kind: firstHalf ? 'first5' : 'total',
              marketKey: gameId,
              marketTitle: `${market.title} ${firstHalf ? 'first five' : 'total'}`,
              selection: 'over',
              selectionLabel: `Over ${market.houseLine.toFixed(1)}`,
              price: market.overPrice,
              line: market.houseLine,
              resolvesOn,
              backedMedia: null,
            })}
          >
            Over {market.houseLine.toFixed(1)} {formatAmerican(market.overPrice)}
          </RetroButton>
          <RetroButton
            variant="default"
            disabled={balance < MIN_STAKE}
            onClick={() => onPlace({
              kind: firstHalf ? 'first5' : 'total',
              marketKey: gameId,
              marketTitle: `${market.title} ${firstHalf ? 'first five' : 'total'}`,
              selection: 'under',
              selectionLabel: `Under ${market.houseLine.toFixed(1)}`,
              price: market.underPrice,
              line: market.houseLine,
              resolvesOn,
              backedMedia: null,
            })}
          >
            Under {market.houseLine.toFixed(1)} {formatAmerican(market.underPrice)}
          </RetroButton>
        </div>
      </div>
    </Panel>
  );
};

/* ------------------------------------------------------------------ *
 * Props
 * ------------------------------------------------------------------ */

/**
 * Temperament, as a border colour.
 *
 * Green for safe, orange for hot, and the border is the whole of the treatment.
 * The thresholds behind them are measured rather than chosen: SAFE_PROBABILITY_FLOOR
 * and HOT_PROBABILITY_CEILING in mediaProps.ts were cut where the fitted
 * distribution says the behaviour changes, and ranking every published prop into
 * quintiles puts the safest fifth at 65.3% realised against 23.7% for the hottest
 * (107,016 observations, confirmed out of sample at 63.3% and 24.0%).
 *
 * So this is a claim about frequency, and frequency belongs on the outside of the
 * row where it is read before the price rather than after.
 *
 * THE RULE THESE COLOURS OBEY, because it is the rule the whole screen depends on: green and
 * orange may only ever mean something a MEDIA OUTLET said. They are per-outlet judgements on a
 * prop -- "this outlet's own read says it lands more often than not" -- and nothing else on
 * this screen may use either colour to make a claim. A reader who has learned the association
 * would reasonably carry it onto a card that carries no outlet's opinion at all.
 *
 * Which is what NEUTRAL is for. Every non-outlet border, and the two cooler risk tiers, are
 * teal. Not grey: a risk label that disappears into its own card is worse than a misleading
 * one, so it has to be visible.
 */
const TEMPERAMENT: Record<PropTemperament, { border: string; label: string; Icon: React.FC<{ className?: string }> }> = {
  safe: { border: 'var(--color-pos)', label: 'Safe', Icon: ShieldCheck },
  hot: { border: 'var(--color-warn)', label: 'Hot', Icon: Flame },
};

/**
 * The risk tier's colour, and the second place the outlet-only rule is enforced.
 *
 * HAIL MARY and LONG SHOT are orange, because they name the outcome a bettor is choosing to
 * take a variance position on -- the same thing the props tab calls "hot". FAVOURITE and
 * CONTENDER are NEUTRAL rather than gold and rather than green: gold is this app's accent for a
 * highlighted row and would read as an endorsement of the pick, and green is reserved for an
 * outlet saying something will land, and no outlet has said anything about a futures outcome.
 *
 * Worth being blunt that orange means something slightly different here than on the props tab.
 * On props it is one outlet's read of one prop. On futures it is the HOUSE's read of an
 * outcome, derived from all three. Both carry "this is the hot one", which is the colour's job,
 * and each tab's caption says which of the two you are looking at.
 */
const RISK_TIER_ACCENT: Record<FuturesRiskTier, string> = {
  hail_mary: 'var(--color-warn)',
  long_shot: 'var(--color-warn)',
  contender: 'var(--color-neutral)',
  favourite: 'var(--color-neutral)',
};

/**
 * The border for anything that is not an outlet's opinion.
 *
 * Teal, for the reason in `TEMPERAMENT`. A game's card, a futures card, a run-total block and
 * the slate's price strip all carry this, so that every green and orange pixel on the screen
 * can be traced to a named outlet saying something specific.
 */
const NEUTRAL_BORDER = 'var(--color-neutral)';

const PropsView: React.FC<{
  boards: Map<MediaId, PropMarket[]>;
  focusedProp: PropFocus | null;
  slateDate: string | null;
  balance: number;
  /** The slate's games, so a prop row can name the fixture it belongs to. */
  moneyline: GameLine[];
  onPlace: BettingSlateProps['onPlace'];
}> = ({ boards, focusedProp, slateDate, balance, moneyline, onPlace }) => {
  /*
   * Scroll the arrived-at row into view.
   *
   * Keyed by outlet AND prop, because the same prop is published by every outlet
   * that picked it and the betting page renders one row per outlet. Keyed by prop
   * alone, the map keeps only the last row registered -- the bottom one -- and
   * the manager arrives at the bottom of the page having been sent to a card
   * they did not click, with the card they did click scrolled off the top.
   * Measured at 315px above the fold before this was keyed by outlet.
   *
   * The effect keys on the whole focus, so it fires once per arrival and not on
   * every render. Keyed on truthiness instead, returning to a prop already looked
   * at would yank the view away from wherever the manager had since wandered.
   */
  const rowRefs = useRef(new Map<string, HTMLDivElement | null>());
  useEffect(() => {
    if (!focusedProp) return;
    rowRefs.current.get(propRowKey(focusedProp))?.scrollIntoView({ block: 'center' });
  }, [focusedProp]);

  /*
   * Game id to the fixture, from the slate's OWN moneyline list.
   *
   * Not a second copy of the schedule and not a fresh build. The same `moneyline`
   * array the Slate tab renders is already in props, it is keyed by `gameId`, and
   * `PropMarket.gameId` is that key -- so the fixture a prop belongs to is a lookup
   * rather than a new source that could disagree with the one the slate shows. A prop
   * whose game is absent resolves to null and says so on the row.
   */
  const fixtureById = useMemo(
    () => new Map(moneyline.map((game) => [game.gameId, game])),
    [moneyline],
  );

  const total = MEDIA_PROFILES.reduce((sum, profile) => sum + (boards.get(profile.id)?.length ?? 0), 0);

  if (total === 0) {
    return (
      <Panel className="p-6">
        <p className="t-body text-[var(--color-ink-dim)]">
          {slateDate
            ? 'No props are published for this slate. Props are priced from each player’s own rate, shrunk toward the league, so a player with no games behind him has no rate to price from and the model will not invent one.'
            : 'No further games are scheduled this season.'}
        </p>
      </Panel>
    );
  }

  /*
    * THE OUTLET PANELS ARE THE COLUMNS. Not a grid of cards inside three stacked panels.
    *
    * I got this wrong once. The user's first request was "one column per media outlet" and I
    * read it as "one card per row inside each outlet's panel" -- so each panel became a single
    * column of full-width cards and the three panels stacked down the page. That is a column
    * per outlet in the only sense that was already true, and it is not what was asked for.
    *
    * What was asked for is three panels SIDE BY SIDE, one per outlet, each holding that
    * outlet's props in a single column of its own. So the three columns are siblings in one
    * grid, and a reader comparing outlets compares them by looking left and right rather than
    * by scrolling. That is the whole reason to show three outlets: they disagree, and a
    * disagreement you have to scroll to see is a disagreement you will not see.
    *
    * `items-start` so a short outlet's column does not stretch to match a full one -- a
    * fifteen-prop panel next to a nine-prop panel is information, and padding the shorter one
    * out to match would throw that away. The panels are then unequal in height, which is
    * honest and is the price of comparing them.
    *
    * `2xl` rather than `xl` because each column holds a full prop card -- a fixture strip, a
    * name, a chip, a line, a read and three buttons -- and three of those need more room than
    * two columns of market cards do.
    */
  const visibleOutlets = MEDIA_PROFILES.filter((profile) => (boards.get(profile.id)?.length ?? 0) > 0);

  return (
    <div className="grid gap-4">
      <p className="t-caption px-1 text-[var(--color-ink-faint)]">
        Each outlet publishes up to {MAX_PROPS_PER_OUTLET} props a day, in its own column. The border
        says how that outlet rates it: green for a prop its own read says lands more often than not,
        orange for one it expects to lose. Prices are the mean of the three published probabilities plus
        the margin.
      </p>

      <div className="grid items-start gap-4 lg:grid-cols-2 2xl:grid-cols-3">
        {visibleOutlets.map((profile) => {
          const markets = boards.get(profile.id) ?? [];
          if (markets.length === 0) return null;
          return (
            <Panel key={profile.id} className="overflow-hidden">
            <div
              className="chrome-bar flex flex-wrap items-center justify-between gap-3 px-4"
              style={{ borderLeft: `3px solid var(--color-media-${profile.accent})` }}
            >
              <div className="flex min-w-0 items-center gap-2.5">
                {/*
                  h-8 rather than h-6, at the user's request for bigger logos.

                  This is the OUTLET panel header, and the mark is the only thing on it that
                  says which outlet the board below belongs to. At h-6 the mark and the `t-h3`
                  name beside it were nearly the same size, so the header had no clear primary.
                  At h-8 the mark leads and the name supports it, which matches how the cards
                  underneath are read: logo first, then whose number it is.
                */}
                <img
                  src={MEDIA_MARKS_SQUARE[profile.id]}
                  alt=""
                  aria-hidden="true"
                  className="h-8 w-8 object-contain"
                />
                <h2 className="t-h3 truncate" style={{ color: `var(--color-media-${profile.accent}-hi)` }}>
                  {profile.outlet}
                </h2>
              </div>
              <span className="t-caption text-[var(--color-ink-faint)]">
                {markets.length} of {MAX_PROPS_PER_OUTLET} slots used
              </span>
            </div>

            {/*
          ONE CARD PER ROW INSIDE ITS OUTLET'S COLUMN.

          This was `md:grid-cols-2 2xl:grid-cols-3` -- cards across INSIDE each panel, so three
          cards wide in a panel that is itself a third of the page. The user asked for one column
          per outlet, and the two things that means are now both true: the three outlet panels
          are the three columns, and each holds its cards in a single column of its own.

          The inner grid had to go as well as the outer one. A prop card carries a fixture
          strip, a player name, a temperament chip, an O/U line, a per-outlet read and three
          buttons; squeezed into a third of a column those wrap, and the button row -- the part
          a manager actually acts on -- ends up across three lines with one button orphaned.
        */}
        <div className="flex flex-col gap-2 p-3">
              {markets.map((market) => {
                const key = propRowKey({ propId: market.propId, mediaId: profile.id });
                return (
                  <PropBetRow
                    key={key}
                    market={market}
                    mediaId={profile.id}
                    rowKey={key}
                    // Only the clicked copy is ringed. The other outlets' copies of
                    // the same prop are still on screen, and ringing all of them
                    // would leave the manager unsure which one to act on.
                    focused={focusedProp !== null && key === propRowKey(focusedProp)}
                    balance={balance}
                    fixture={fixtureById.get(market.gameId) ?? null}
                    onPlace={onPlace}
                    registerRef={(node) => rowRefs.current.set(key, node)}
                  />
                );
              })}
            </div>
          </Panel>
          );
        })}
      </div>
    </div>
  );
};

/** Ref key for one row: a prop is only unique within an outlet's board. */
const propRowKey = (focus: { propId: string; mediaId: MediaId }) => `${focus.mediaId}:${focus.propId}`;

const PropBetRow: React.FC<{
  market: PropMarket;
  mediaId: MediaId;
  rowKey: string;
  focused: boolean;
  balance: number;
  /**
   * The game this prop belongs to, resolved from the slate's own moneyline list.
   *
   * Null when the game is not on the current slate -- a stale board, or a prop on a
   * fixture that has dropped off the slate since the outlet published it. The strip
   * degrades to the date alone rather than disappearing, because a prop with a date
   * and no fixture is still placeable and still needs its resolution stated.
   */
  fixture: GameLine | null;
  onPlace: BettingSlateProps['onPlace'];
  registerRef: (node: HTMLDivElement | null) => void;
}> = ({ market, mediaId, rowKey, focused, balance, fixture, onPlace, registerRef }) => {
  const temperament = TEMPERAMENT[market.temperament[mediaId]];
  const { Icon } = temperament;
  const house = propSidePrices(market.consensusProbability);
  const own = propSidePrices(market.probability[mediaId]);
  const marketTitle = propMarketTitle(market);

  /**
   * The outlet's own number, on the side it favours.
   *
   * Only offered where the outlet is far enough from the other two for taking
   * someone's number to be a decision rather than a vote. The same rule the
   * futures rows use, and deliberately the same threshold: a "fade to theirs"
   * button on a market where the three agree within two points is a button that
   * cannot lose money for a reason nobody can see.
   */
  const ownSide: PropSide = market.probability[mediaId] >= 0.5 ? 'over' : 'under';
  const ownPrice = ownSide === 'over' ? own.overPrice : own.underPrice;
  const canFade = market.spread >= 0.06;

  const place = (side: PropSide, price: number, backed: MediaId | null) => onPlace({
    kind: 'prop',
    marketKey: market.gameId,
    marketTitle,
    selection: side,
    selectionLabel: propSelectionLabel(market, mediaId, side),
    price,
    line: market.line,
    backedMedia: backed,
    resolvesOn: market.date,
    propStat: market.stat,
    propPlayerId: market.playerId,
    propPlayerName: market.playerName,
    propLine: market.line,
  });

  return (
    <div
      ref={registerRef}
      // The row's identity, in the DOM as well as in the ref map.
      //
      // A prop is published by up to three outlets and rendered once per outlet,
      // so the props view carries several rows that a prop id alone cannot tell
      // apart. Without a way to name a row from outside, "the highlight landed on
      // the wrong copy" is indistinguishable from "the highlight did not land",
      // and both read as the same 0 from a query. Measured that way already: a
      // scroll target picked by prop id alone scrolled to the last outlet's copy
      // with the clicked one 315px above the fold, and the only evidence was
      // that no row matched.
      data-prop-row={rowKey}
      data-focused={focused ? 'true' : undefined}
      className={`flex flex-col gap-2 border bg-[var(--color-sunken)] p-3 ${
        focused ? 'ring-2 ring-[var(--color-gold)]' : ''
      }`}
      style={{ borderColor: temperament.border, borderLeftWidth: '3px' }}
    >
      {/*
        WHICH GAME, AND WHEN.

        This is the fix for a real gap: the row said a player's name, a stat and a
        line, and nothing about the fixture or the date. A manager could read a prop,
        take it, and still not know which game to watch or on what day. The bet record
        carried `marketKey: market.gameId` and the settlement could find the game --
        but nothing on screen could.

        The information was never missing. `PropMarket` has carried `gameId` and `date`
        since the family was built; neither was ever painted. So this is a row that
        says what it always knew.

        Two crests and a date rather than a text matchup, for the same reason as
        everywhere else on this screen: the marks identify the fixture in a third of
        the width, and the city names are still the crests' accessible names.

        The date is on the strip rather than buried in a tooltip because a prop bet
        resolves when the game is played, which makes the date the second half of the
        bet's identity. It settles the same night the game does.
      */}
      <div className="flex items-center justify-between gap-2 border-b border-[var(--color-chrome-lo)] pb-2">
        <span className="flex min-w-0 items-center gap-1.5">
          {fixture ? (
            <>
              <TeamLogo team={fixture.awayTeam} sizeClass="h-6 w-6" />
              <span className="text-[var(--color-ink-faint)]" aria-hidden="true">at</span>
              <TeamLogo team={fixture.homeTeam} sizeClass="h-6 w-6" />
              <span className="sr-only">
                {fixture.awayTeam.city} at {fixture.homeTeam.city}
              </span>
            </>
          ) : (
            <span className="t-caption text-[var(--color-warn)]">Fixture not on this slate</span>
          )}
        </span>
        <span className="t-caption shrink-0 tabular-nums text-[var(--color-ink-dim)]">
          {formatResolutionDate(market.date)}
        </span>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
        <span className="t-stat truncate">{market.playerName}</span>
        <span
          className="inline-flex shrink-0 items-center gap-1 border px-1.5 py-0.5 t-caption"
          style={{ borderColor: temperament.border, color: temperament.border }}
        >
          <Icon className="h-3 w-3" aria-hidden="true" />
          {temperament.label}
        </span>
      </div>

      <p className="t-caption text-[var(--color-ink-dim)]">
        O/U {market.line} {market.statPlural}
        {' · '}
        {MEDIA_BY_ID[mediaId].outlet} reads {Math.round(market.probability[mediaId] * 100)}% over
        {canFade && ` · ${Math.round(market.spread * 100)}pt from the other two`}
      </p>

      <div className="mt-auto flex flex-wrap items-center gap-1.5">
        <RetroButton
          variant="primary"
          size="sm"
          disabled={balance < MIN_STAKE}
          onClick={() => place('over', house.overPrice, null)}
        >
          Over {formatAmerican(house.overPrice)}
        </RetroButton>
        <RetroButton
          variant="default"
          size="sm"
          disabled={balance < MIN_STAKE}
          onClick={() => place('under', house.underPrice, null)}
        >
          Under {formatAmerican(house.underPrice)}
        </RetroButton>
        {canFade && (
          <RetroButton
            variant="ghost"
            size="sm"
            disabled={balance < MIN_STAKE}
            title={`Take ${MEDIA_BY_ID[mediaId].outlet}'s own read of this prop instead of the house line`}
            onClick={() => place(ownSide, ownPrice, mediaId)}
          >
            Fade to theirs
          </RetroButton>
        )}
      </div>
    </div>
  );
};
 /* ------------------------------------------------------------------ *
 * Field markets -- futures and awards
 * ------------------------------------------------------------------ */

const FieldMarketCard: React.FC<{
  market: FieldMarket;
  balance: number;
  calendar: SeasonCalendar;
  teamById: Map<string, Team>;
  onPlace: BettingSlateProps['onPlace'];
}> = ({ market, balance, calendar, teamById, onPlace }) => {
  const kind: BetKind = market.kind === 'award' ? 'award' : market.kind;
  /*
   * The key that travels with the bet.
   *
   * Every OTHER futures kind has a key of "<kind>:<group>", and settlement looks the
   * group up by name, so only the group half travels. The title is the exception and
   * it has to be handled rather than routed through the same slice: its key is
   * already the constant `WORLD_SERIES_MARKET_KEY`, and settlement compares against
   * that whole string. Slicing it would post a bet keyed "champion" that then fails
   * its own settlement check and refunds every championship bet the manager takes.
   */
  const groupKey = market.kind === 'world_series'
    ? WORLD_SERIES_MARKET_KEY
    : market.key.slice(market.key.indexOf(':') + 1);

  /*
   * The date this market resolves, derived ONCE.
   *
   * The header shows it and every bet placed from this card stores it, so it is
   * computed here rather than in both places. Two calls to `resolveDateFor` on the
   * same inputs would be the same answer today and would be two things to keep in
   * step tomorrow -- and the failure mode is a bet that says it settles on a different
   * day from the one the card advertised when it sold it.
   */
  const resolvesOn = resolveDateFor(
    market.kind === 'award' ? 'season_awards' : 'championship_series',
    calendar,
  );

  return (
    <Panel className="overflow-hidden">
      <div className="chrome-bar flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-4 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <Trophy className="h-4 w-4 shrink-0 text-[var(--color-gold)]" aria-hidden="true" />
          <h2 className="truncate t-h3">{market.title}</h2>
        </div>
        <span className="t-caption text-[var(--color-ink-faint)]">
          {/*
            THE RESOLUTION DATE, on every market.

            Item 1 of the betting expansion, and the smallest-looking change in the
            document. It is also the one that answers a question a bettor cannot
            currently ask: a futures bet settles off `seasonComplete && seasonWinners`
            -- one boolean, no date -- so the only honest answer today is "not yet",
            which is not an answer.

            The basis differs per market because the DAY differs. A championship bet
            resolves on the last possible game of the World Series, roughly five
            weeks after a division bet, and that difference is exactly what nobody can
            see. Showing one date for all of them would be a lie in the cases that
            matter most.

            It is rendered on the header rather than each row because it is a property
            of the MARKET, not of an outcome, and repeating it fifteen times down a
            board would be noise.
          */}
          RESOLVES ON {formatResolutionDate(resolvesOn)}
          {' · '}
          {market.subtitle} · {market.outcomes.length} clubs
          {/*
            THE SEASON ADVANCING, IN THREE WORDS.

            "31 REMAINING" on an April board and "4 REMAINING" in September are the
            same market with completely different meaning, and a probability of
            0.003 does not convey that. Counted on the market rather than recomputed
            here so the live floor lives in exactly one place -- a component
            recomputing it would be a second definition to drift.

            It moved HERE from the individual rows during the compaction, and the
            rows kept only their risk tier. It is the same fact on every row of a
            market, so sixteen copies of it was sixteen chances to read as sixteen
            separate claims, and it was the largest single line of type in each cell.
          */}
          {market.liveOutcomes < market.outcomes.length && (
            <> · {market.liveOutcomes} REMAINING</>
          )}
        </span>
      </div>

      {/*
        TWO COLUMNS OF CLUBS, NOT A STACK OF FULL-WIDTH ROWS.

        This board was the least efficient surface in the app. Every division, every
        league, every award and the championship were each a full-width panel, and
        every club inside them a full-width row -- so a division title read "Baltimore
        at +240" consumed the same horizontal space as a line of prose sixteen words
        long. On a 1600px screen the manager saw two clubs.

        The crest replaces the name. A club's city and nickname are longer than the
        mark that already identifies it, they repeat across every market on the page,
        and the crest is the thing a manager recognises from the standings rather
        than reads. The name is still in the cell, in the accessible name, and in the
        bet's `selectionLabel`, so nothing is lost -- it is just no longer painted at
        a size that competes with the price.

        The cells are deliberately THICKER than the old rows rather than merely
        narrower: at two columns a cell is roughly 300px, and a 4px crest beside a
        12px price needs the vertical room to stop the two competing. Shrinking the
        type to win density would have made the only thing on the page -- the price --
        the hardest thing to read.
      */}
      {/*
        HOW MANY COLUMNS AN OUTCOME GRID GETS.

        The championship is a 32-club race and everything else on this tab is an eight-club
        race. At two columns the title board ran sixteen rows down the page for a field where
        the entire point is comparing the whole field, and it wasted the other half of a
        1600px screen -- the user reported it as "too long and doesn't utilise the half screen,
        it can fit four columns".

        So the column count follows the field size. A 32-way race goes four across, an 8-way
        race stays at two, and the AWARDS tab is untouched: it has eight candidates per race
        and the user called that screen picture perfect, so changing its density on the strength
        of a complaint about a different tab would be fixing something that is not broken.

        The thresholds are on `outcomes.length` rather than on `kind`, because they are the same
        question: how many things are being compared.
      */}
      <div
        className={`grid gap-2 p-3 ${
          market.outcomes.length > 20
            ? 'sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4'
            : 'sm:grid-cols-2'
        }`}
      >
        {market.outcomes.map((outcome) => {
          const isFavourite = outcome.key === market.outcomes[0]?.key;
          // A row where the three barely differ is not worth a second price. The
          // disagreement threshold is where taking someone's number stops being a
          // bet and starts being a vote.
          const split = outcome.disagreement >= 0.06;
          const team = outcome.teamId ? teamById.get(outcome.teamId) : undefined;

          return (
            <div
              key={outcome.key}
              className="flex flex-col gap-2 border-l-[3px] bg-[var(--color-sunken)] px-3 py-2.5"
              style={{ borderLeftColor: isFavourite ? 'var(--color-gold)' : 'transparent' }}
            >
              <div className="flex items-center gap-2.5">
                {/*
                  THE CREST, with the name kept beside it rather than replaced by it.

                  `outcome.teamId` rather than `outcome.key`, because an award market is
                  keyed by player and a lookup on `key` would silently find no club and
                  render a blank square on every award row -- a bug that looks exactly
                  like "this player has no team". The name stays: a crest alone cannot
                  be searched, selected, or read by a screen reader as a name.
                */}
                {team ? (
                  <TeamLogo team={team} sizeClass="h-9 w-9 shrink-0" />
                ) : (
                  <span className="h-9 w-9 shrink-0" aria-hidden="true" />
                )}
                <div className="min-w-0 flex-1">
                  <p className={`truncate t-stat ${isFavourite ? 'text-[var(--color-gold-hi)]' : ''}`}>
                    {outcome.label}
                  </p>
                  {outcome.sublabel && (
                    <p className="truncate t-caption text-[var(--color-ink-dim)]">{outcome.sublabel}</p>
                  )}
                  {/*
                    THE RISK TIER, and deliberately not the word VALUE.

                    Every bet in this layer is priced from a calibrated model plus a
                    margin, so every one of them is expected-value negative. A label
                    reading VALUE would tell a manager a 3% shot is a good bet and
                    make the whole calibration layer a lie to him. The tier names the
                    VARIANCE, which is the thing the bettor is actually choosing when
                    he takes a hail mary.

                    An eliminated club is shown as such and its Back button is
                    disabled below, because a title that can no longer be won is not a
                    bet at any price.
                  */}
                  {(() => {
                    /*
                     * Elimination is a SCHEDULE fact, not a small price.
                     *
                     * The probability floor cannot supply it: the title board's
                     * forecaster scores are roster-driven and barely move during a
                     * season, so no club ever drops below 0.001 and the floor reports
                     * 32 remaining all year. `outcome.eliminated` comes from whether
                     * the club can still win its division, which is arithmetic, and it
                     * is `undefined` rather than `false` when nobody supplied
                     * standings -- so "unknown" never renders as "in contention".
                     */
                    if (outcome.eliminated === true) {
                      return <p className="t-caption text-[var(--color-ink-faint)]">ELIMINATED</p>;
                    }
                    const read = futuresRiskRead(market.outcomes, outcome.consensusProbability);
                    /*
                      THE RISK TIER, COLOUR CODED.

                      HAIL MARY and LONG SHOT are orange, because they name the outcome a
                      bettor is choosing to take a variance position on. FAVOURITE and
                      CONTENDER are teal and not green, because green on this screen means an
                      OUTLET said something lands and no outlet has said anything about a
                      futures outcome -- the tier is the HOUSE's read, derived from all three.
                      The caption on the tab says so, because orange meaning "one outlet's
                      opinion" on props and "the house's read" on futures is a distinction a
                      reader should not have to infer from colour alone.

                      Rendered as a chip rather than bare text so it reads as a classification
                      of the row rather than as another caption competing with the club's name
                      for attention.
                    */
                    return (
                      <span
                        className="mt-0.5 inline-flex w-fit items-center border px-1.5 py-0.5 t-caption"
                        style={{ borderColor: RISK_TIER_ACCENT[read.tier], color: RISK_TIER_ACCENT[read.tier] }}
                      >
                        {read.label}
                      </span>
                    );
                  })()}
                </div>

                <span className="t-stat-lg shrink-0 tabular-nums text-[var(--color-gold-hi)]">
                  {formatAmerican(outcome.houseOdds)}
                </span>
              </div>

              {split && (
                <p className="t-caption text-[var(--color-warn)]">
                  {MEDIA_BY_ID[outcome.outlier].outlet} is {Math.round(outcome.disagreement * 100)} points
                  away from the other two
                </p>
              )}

              {/*
                THE GAP IS INFORMATION, NOT AN EDGE, and the label says so because
                it was measured rather than because it is modest.

                The expansion plan proposed surfacing a fade-the-outlier row as
                "the actual play in this layer". Measured over six seasons of
                championship futures it does not pay: fading returned -0.030 a bet
                and following returned -0.967, and both being negative is the
                signature of paying the house margin on every stake rather than
                of a strategy with an edge. So the disagreement is shown as the
                interesting fact it is -- these two forecasters really do differ by
                this much -- and nothing on this board invites a bettor to act on
                it.

                tools/checkOutlierFade.ts is the measurement. If the forecasters'
                slopes are ever refitted, that tool is what decides whether this
                line can change.
              */}
              <div className="flex items-center justify-between gap-2 border-t border-[var(--color-chrome-lo)] pt-2">
                <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                  {MEDIA_PROFILES.map((profile) => (
                    <span key={profile.id} className="flex items-center gap-1">
                      <img
                        src={MEDIA_MARKS_SQUARE[profile.id]}
                        alt=""
                        aria-hidden="true"
                        className="h-5 w-5 object-contain"
                      />
                      <span className="t-caption tabular-nums text-[var(--color-ink-dim)]">
                        {formatAmerican(outcome.odds[profile.id])}
                      </span>
                    </span>
                  ))}
                </div>

                <div className="flex shrink-0 items-center gap-1.5">
                  {split && (
                    <RetroButton
                      variant="ghost"
                      size="sm"
                      disabled={balance < MIN_STAKE}
                      title={`Take ${MEDIA_BY_ID[outcome.outlier].outlet}'s own price instead of the house`}
                      onClick={() => onPlace({
                        kind,
                        marketKey: groupKey,
                        marketTitle: market.title,
                        selection: outcome.key,
                        selectionLabel: `${outcome.label} (${MEDIA_BY_ID[outcome.outlier].outlet})`,
                        price: outcome.odds[outcome.outlier],
                        resolvesOn,
                        backedMedia: outcome.outlier,
                      })}
                    >
                      Fade
                    </RetroButton>
                  )}
                  <RetroButton
                    variant="primary"
                    size="sm"
                    disabled={balance < MIN_STAKE || outcome.eliminated === true}
                    onClick={() => onPlace({
                      kind,
                      marketKey: groupKey,
                      marketTitle: market.title,
                      selection: outcome.key,
                      selectionLabel: outcome.label,
                      price: outcome.houseOdds,
                      resolvesOn,
                      backedMedia: null,
                    })}
                  >
                    Back
                  </RetroButton>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </Panel>
  );
};
/**
 * The club lookup every field row needs.
 *
 * `useMemo`, and this was originally `useState` + `useEffect`. That version was a
 * render loop waiting for the day `teams` stopped being referentially stable: the
 * effect sets a fresh Map on every change, setting state re-renders, the render
 * produces another Map, and if the caller rebuilds the array each pass the page
 * spins forever. Nothing caught it because nothing caught it -- the same silent-failure
 * shape as every other bug this session, except this one freezes the UI instead of
 * printing a wrong number, which is louder and just as avoidable.
 *
 * `useMemo` recomputes when `teams` changes and does nothing otherwise, so a fresh
 * array reference costs a Map build and a re-render rather than an infinite one.
 * `BettingPage.tsx` already builds the identical lookup this way 300 lines above, so
 * this is now the same pattern rather than a second dialect of it.
 */
const useTeamLookup = (teams: Team[]): Map<string, Team> =>
  useMemo(() => new Map(teams.map((t) => [t.id, t])), [teams]);

/**
 * Season futures and awards.
 *
 * Both views are the same shape -- a caption explaining how these markets differ, then
 * every market in the view -- so they share a body rather than keeping two copies that
 * would drift the first time either was restyled.
 *
 * The grid is TWO COLUMNS OF MARKETS, and that is the whole change on this screen.
 * There are four divisions, two leagues, a championship and six awards: thirteen
 * full-width panels stacked in order, each holding a handful of rows that used the
 * entire width to say a club name and a price. The manager had to scroll to compare
 * two clubs on the same board, and had to scroll again to compare two divisions.
 *
 * Markets side by side is what makes a leaderboard comparable. A 2-column inner grid
 * of clubs inside a 2-column outer grid of markets puts four markets on screen at
 * once, so "who leads the North" and "who leads the batting title" are answerable
 * without scrolling between them.
 */
const FieldMarketsView: React.FC<{
  markets: FieldMarket[];
  balance: number;
  calendar: SeasonCalendar;
  teams: Team[];
  caption: string;
  emptyMessage: string;
  /**
   * A single heading for a board that is one kind of market.
   *
   * Futures gets sections derived from `market.kind` instead, because it mixes three kinds in
   * one list and the whole point of that tab's change is to stop them being indistinguishable.
   * Awards passes this because every market on it is already one kind and a heading per race
   * would be four headings in a row saying nothing.
   */
  groupLabel?: string;
  onPlace: BettingSlateProps['onPlace'];
}> = ({ markets, onPlace, balance, calendar, teams, caption, emptyMessage, groupLabel }) => {
  const teamById = useTeamLookup(teams);

  /*
    * THREE KINDS OF RACE, GROUPED AND LABELLED.

    * The user reported that the divisions and leagues "just don't organize well", and the
    * cause is visible in how this list was built: `BettingPage` concatenates the title, both
    * league races and all four division races into ONE flat array, and this component rendered
    * it in a two-column grid in that order.

    * So a Platinum League card sat directly beside an East Division card, both rendered
    * identically, with nothing on either to say they were different kinds of competition. A
    * manager could not tell a league title from a division title by looking at it, and the
    * two carry very different risk -- winning a division is arithmetic, winning a league
    * requires surviving a series of playoffs.

    * So the markets are bucketed by `kind` and each bucket gets a labelled section. The
    * section order is Championship, League races, Division races: broadest first, because a
    * manager reads this board top-down from "who could win it all" to "who is winning their
    * own division".
    *
    * `groupLabel` is optional because AWARDS shares this component and its markets are all
    * one kind -- there is nothing to group, and a heading per award race would be noise.
    */
  const SECTIONS: Array<{ kind: FieldMarket['kind']; label: string; note: string }> = [
    {
      kind: 'world_series',
      label: 'Championship',
      note: 'Every club in both leagues. The only market that spans the divisions.',
    },
    {
      kind: 'league',
      label: 'League races',
      note: 'Won by finishing top of a league. Eight clubs each.',
    },
    {
      kind: 'division',
      label: 'Division races',
      note: 'Won on the season record in your own division. Arithmetic, not a series.',
    },
  ];

  const grouped = groupLabel
    ? [{ label: groupLabel, note: null as string | null, markets }]
    : SECTIONS
      .map((section) => ({
        ...section,
        markets: markets.filter((market) => market.kind === section.kind),
      }))
      .filter((section) => section.markets.length > 0);

  return (
    <div className="grid gap-4">
      <p className="t-caption px-1 text-[var(--color-ink-faint)]">{caption}</p>
      {markets.length === 0
        ? <Panel className="p-6"><p className="t-body text-[var(--color-ink-dim)]">{emptyMessage}</p></Panel>
        : (
          <div className="grid gap-5">
            {grouped.map((section) => (
              <section key={section.label} className="grid gap-3">
                {/*
                  A section heading with a hairline under it, so the three groups read as three
                  bands rather than as one long board that happens to pause. The note beside
                  the label is the one sentence that tells a manager why the next panel is a
                  different KIND of race and not just another race.
                */}
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 border-b border-[var(--color-chrome-lo)] pb-1.5">
                  <h3 className="t-h3">{section.label}</h3>
                  {section.note && (
                    <span className="t-caption text-[var(--color-ink-faint)]">{section.note}</span>
                  )}
                  <span className="t-caption ml-auto tabular-nums text-[var(--color-ink-faint)]">
                    {section.markets.length} {section.markets.length === 1 ? 'market' : 'markets'}
                  </span>
                </div>
                {/*
                    A SECTION WITH ONE MARKET IN IT GETS THE FULL WIDTH.

                    The Championship section is one market. At `xl:grid-cols-2` it sat in the
                    left half of the screen with the right half empty, which is what the user
                    meant by "doesn't utilise the half screen" -- and it is also why widening
                    its outcome grid alone would not have been enough.

                    Sections with two or more markets keep two columns, because they are
                    genuinely side-by-side comparisons of the same kind of race.
                  */}
                <div
                  className={`grid items-start gap-4 ${
                    section.markets.length === 1 ? 'grid-cols-1' : 'xl:grid-cols-2'
                  }`}
                >
                  {section.markets.map((market) => (
                    <FieldMarketCard
                      key={market.key}
                      market={market}
                      balance={balance}
                      calendar={calendar}
                      teamById={teamById}
                      onPlace={onPlace}
                    />
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
    </div>
  );
};

const FuturesView: React.FC<{
  markets: FieldMarket[];
  balance: number;
  calendar: SeasonCalendar;
  teams: Team[];
  onPlace: BettingSlateProps['onPlace'];
}> = ({ markets, onPlace, balance, calendar, teams }) => (
  <FieldMarketsView
    markets={markets}
    balance={balance}
    calendar={calendar}
    teams={teams}
    onPlace={onPlace}
    caption="Season-long markets settle when a season is archived, not before. Each price is the mean of the three outlets' probabilities; the marks beside it show each outlet's own price, and where one of them sits furthest from the other two it is named. The risk tier is the HOUSE's read of the outcome, not any one outlet's."
    emptyMessage="No division or league races could be built."
  />
);

const AwardsView: React.FC<{
  markets: FieldMarket[];
  balance: number;
  calendar: SeasonCalendar;
  teams: Team[];
  onPlace: BettingSlateProps['onPlace'];
}> = ({ markets, onPlace, balance, calendar, teams }) => (
  <FieldMarketsView
    markets={markets}
    balance={balance}
    calendar={calendar}
    teams={teams}
    onPlace={onPlace}
    caption="The three outlets differ on awards by how hard they regress a hot start toward the field. The metrics forecaster pulls hardest, which makes a narrow leader look narrow; the narrative one barely regresses at all, so it will pay 5-to-1 for a player nobody else has noticed. The crest is the player's club -- these races are keyed by player, so the name beside it is the player and not the team."
    emptyMessage="No award race is available yet."
    groupLabel="Award races"
  />
);

/* ------------------------------------------------------------------ *
 * Open bets
 * ------------------------------------------------------------------ */

export const OpenBets: React.FC<{
  bets: PlacedBet[];
  /** The current slate's games, so a game bet can name its fixture. */
  moneyline: GameLine[];
}> = ({ bets, moneyline }) => {
  const open = bets.filter((bet) => bet.status === 'open');
  const fixtureById = useMemo(() => buildFixtureLookup(moneyline), [moneyline]);

  if (open.length === 0) return null;

  return (
    <Panel className="overflow-hidden">
      <div className="chrome-bar flex items-center gap-2 px-4">
        <Users className="h-4 w-4 text-[var(--color-gold)]" aria-hidden="true" />
        <h2 className="t-h3">Open Bets</h2>
        <span className="t-caption text-[var(--color-ink-faint)]">
          {open.length} open · ${open.reduce((sum, bet) => sum + bet.stake, 0)} at risk
        </span>
      </div>
      <div className="grid gap-1 p-3">
        {open.map((bet) => (
          <div
            key={bet.id}
            className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-l-[3px] border-l-[var(--color-gold)] bg-[var(--color-sunken)] px-3 py-2"
          >
            <div className="min-w-0">
              <p className="t-stat-sm truncate">
                {bet.selectionLabel} {formatAmerican(bet.price)}
              </p>
              <p className="t-caption text-[var(--color-ink-faint)]">
                {bet.marketTitle}
                {bet.note && ` · line ${Number(bet.note).toFixed(1)}`}
              </p>
              {/*
                WHICH GAME, AND WHEN.

                The shared `BetFixtureLine`, so this list and the slip's own "Open" list
                cannot say different things about the same wager. They did once: this
                one got the fixture and the date, the slip did not, and the slip is the
                surface a manager opens precisely to check on money at risk.
              */}
              <BetFixtureLine bet={bet} fixture={fixtureForBet(bet, fixtureById)} className="mt-0.5" />
            </div>
            <div className="flex items-center gap-2">
              {bet.backedMedia && (
                <img
                  src={MEDIA_MARKS_SQUARE[bet.backedMedia]}
                  alt={MEDIA_BY_ID[bet.backedMedia].outlet}
                  title={`Acted on ${MEDIA_BY_ID[bet.backedMedia].outlet}'s number`}
                  className="h-5 w-5 object-contain"
                />
              )}
              <span className="t-stat tabular-nums">${bet.stake}</span>
            </div>
          </div>
        ))}
      </div>
    </Panel>
  );
};
const statusAccent: Record<BetStatus, string> = {
  open: 'var(--color-gold)',
  won: 'var(--color-pos)',
  lost: 'var(--color-neg)',
  void: 'var(--color-ink-faint)',
};

export const BettingRecord: React.FC<{ bets: PlacedBet[]; balance: number; summary: WalletSummary }> = ({
  bets, balance, summary,
}) => {
  const settled = bets.filter((bet) => bet.status !== 'open');
  const net = balance - STARTING_BALANCE;

  return (
    <Panel className="overflow-hidden">
      <div className="chrome-bar flex flex-wrap items-center justify-between gap-3 px-4">
        <div className="flex items-center gap-2">
          <Receipt className="h-4 w-4 text-[var(--color-gold)]" aria-hidden="true" />
          <h2 className="t-h3">Betting Record</h2>
        </div>
        <div className="flex items-center gap-4">
          <span className="t-caption text-[var(--color-ink-faint)]">
            {summary.wins}-{summary.settled - summary.wins} of {summary.settled} settled
          </span>
          {/* Zero is neither a gain nor a loss, and colouring it green reads as
              a profit on a wallet that has simply not been used. */}
          <span className={`t-stat tabular-nums ${
            net > 0 ? 'text-[var(--color-pos)]' : net < 0 ? 'text-[var(--color-neg)]' : 'text-[var(--color-ink-faint)]'
          }`}>
            {net > 0 ? '+' : net < 0 ? '-' : ''}${Math.abs(Math.round(net))}
          </span>
        </div>
      </div>

      {settled.length === 0 ? (
        <p className="t-body p-4 text-[var(--color-ink-dim)]">
          Nothing has settled yet. Bets decide when a game finishes, and season markets decide when a
          season is archived.
        </p>
      ) : (
        <div className="grid gap-1 p-3">
          {settled.slice(0, 20).map((bet) => {
            const profit = bet.status === 'void'
              ? 0
              : bet.status === 'won' ? bet.payout - bet.stake : -bet.stake;
            return (
              <div
                key={bet.id}
                className="flex flex-wrap items-center justify-between gap-2 border-l-[3px] bg-[var(--color-sunken)] px-3 py-2"
                style={{ borderLeftColor: statusAccent[bet.status] }}
              >
                <div className="min-w-0">
                  <p className="t-stat-sm truncate">{bet.selectionLabel}</p>
                  <p className="t-caption text-[var(--color-ink-faint)]">{bet.marketTitle}</p>
                </div>
                <div className="flex items-center gap-3">
                  <span className="t-caption uppercase text-[var(--color-ink-faint)]">{bet.status}</span>
                  <span className={`t-stat-sm tabular-nums ${profit > 0 ? 'text-[var(--color-pos)]' : profit < 0 ? 'text-[var(--color-neg)]' : 'text-[var(--color-ink-faint)]'}`}>
                    {profit > 0 ? '+' : ''}${Math.round(profit)}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Panel>
  );
};

export interface WalletSummary {
  open: number;
  settled: number;
  wins: number;
  profit: number;
  net: number;
}

export interface BetSlipEntry {
  kind: BetKind;
  marketKey: string;
  marketTitle: string;
  selection: Selection;
  selectionLabel: string;
  price: number;
  line?: number;
  backedMedia: MediaId | null;
}

/**
 * The slip.
 *
 * Two-step on purpose. Clicking a price does not immediately stake anything, so
 * the bettor sees the number they are about to commit to, what it returns if it
 * wins, and which outlet's figure it came from, before the money leaves.
 */
export const BetSlip: React.FC<{
  entry: BetSlipEntry | null;
  stake: number;
  onStake: (value: number) => void;
  onConfirm: () => void;
  onClear: () => void;
  notice: string | null;
  summary: WalletSummary;
  backedBy: string | null;
}> = ({ entry, stake, onStake, onConfirm, onClear, notice, summary, backedBy }) => (
  <Panel className="overflow-hidden">
    <div className="chrome-bar flex flex-wrap items-center justify-between gap-3 px-4">
      <div className="flex items-center gap-2">
        <Receipt className="h-4 w-4 text-[var(--color-gold)]" aria-hidden="true" />
        <h2 className="t-h3">Bet Slip</h2>
      </div>
      <div className="flex items-center gap-4">
        <span className="t-caption text-[var(--color-ink-faint)]">
          {summary.settled === 0
            ? 'No settled bets'
            : `${summary.wins}/${summary.settled} won · ${summary.profit > 0 ? '+' : summary.profit < 0 ? '-' : ''}$${Math.abs(Math.round(summary.profit))}`}
        </span>
        <span className="t-caption text-[var(--color-ink-faint)]">Record</span>
      </div>
    </div>

    {!entry ? (
      <p className="t-body p-4 text-[var(--color-ink-dim)]">
        Pick a price to start a bet. Nothing is wagered until you confirm it here.
      </p>
    ) : (
      <div className="grid gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_260px]">
        <div>
          <p className="t-stat-lg">{entry.selectionLabel}</p>
          <p className="t-caption text-[var(--color-ink-faint)]">
            {entry.marketTitle} · {formatAmerican(entry.price)}
            {entry.line !== undefined && ` · line ${entry.line.toFixed(1)}`}
          </p>
          {backedBy && (
            <p className="t-caption mt-1 text-[var(--color-warn)]">
              Taken at {backedBy}&rsquo;s own price, not the house line.
            </p>
          )}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="t-caption text-[var(--color-ink-faint)]">Stake</span>
            {[10, 25, 50, 100, 250].map((value) => (
              <RetroButton
                key={value}
                size="sm"
                variant={stake === value ? 'primary' : 'ghost'}
                disabled={value > MAX_STAKE}
                onClick={() => onStake(value)}
              >
                {value}
              </RetroButton>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <div className="border-l-[3px] border-l-[var(--color-gold)] bg-[var(--color-sunken)] px-3 py-2">
            <p className="t-caption text-[var(--color-ink-faint)]">Returns if it wins</p>
            <p className="t-stat-lg tabular-nums text-[var(--color-gold-hi)]">
              ${Math.round(settleReturn(stake, entry.price, true))}
            </p>
          </div>
          <RetroButton variant="primary" onClick={onConfirm} disabled={stake < MIN_STAKE || stake > MAX_STAKE}>
            Place ${stake} bet
          </RetroButton>
          <RetroButton variant="ghost" onClick={onClear}>Clear</RetroButton>
          {notice && (
            <p className="t-caption text-[var(--color-warn)]" role="status">{notice}</p>
          )}
        </div>
      </div>
    )}
  </Panel>
);
