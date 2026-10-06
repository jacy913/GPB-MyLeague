import React from 'react';
import { ChevronDown, ChevronRight, Flame, ShieldCheck } from 'lucide-react';
import type { MediaId } from '../../data/media';
import type { Team } from '../../types';
import { MEDIA_BY_ID } from '../../data/media';
import { MIN_STAKE } from '../../lib/wallet';
import { RetroButton } from '../ui/RetroButton';
import { TeamLogo } from '../ui/TeamLogo';
import { MEDIA_MARKS_SQUARE } from '../media/mediaImages';
import { formatResolutionDate } from '../../lib/marketDates';
import type { GameLine } from '../../lib/mediaOdds';
import { propTemperamentFor } from '../../lib/mediaProps';
import {
  propSidePrices,
  type PropMarket, type PropSide, type PropTemperament,
} from '../../lib/playerProps';
import { formatAmerican } from '../../lib/markets';
import { propSelectionLabel, propMarketTitle } from '../../lib/mediaProps';
import { PROP_FADE_THRESHOLD, readsByGap, forecasterLabel, type PropOutletRead, type PropRowModel } from './propRows';

/**
 * The `onPlace` input, restated locally.
 *
 * `BettingSlateProps` is private to `BettingHub`, and importing it would make this card depend on
 * the 1,600-line file it is meant to replace. The fields used here are the ones a prop bet already
 * carries -- `propStat`, `propPlayerId`, `propLine` and friends exist so a bet stays resolvable
 * after the season that produced it has ended, so none of this is new surface.
 */
type PropPlaceInput = {
  kind: 'prop';
  marketKey: string;
  marketTitle: string;
  selection: PropSide;
  selectionLabel: string;
  price: number;
  line: number;
  backedMedia: MediaId | null;
  resolvesOn: string;
  propStat: PropMarket['stat'];
  propPlayerId: string;
  propTeamId: string;
  propPlayerName: string;
  propLine: number;
};

/**
 * A DOM id for one card's disclosure.
 *
 * `propId` is `${gameId}:${playerId}:${stat}:${line}` and the colons have to go. A colon is legal
 * inside an HTML id and `document.getElementById` will find it, but it is also the CSS pseudo-class
 * character -- so `#prop-detail-g1:p1:hits:2.5` does not select that element, it parses as an
 * unknown pseudo-class and throws. Anything reaching for the panel by selector, a test harness
 * included, has to be able to.
 *
 * The `data-prop-row` attribute keeps the raw id. Data attributes are matched by attribute name,
 * not parsed as selectors, so `[data-prop-row="g1:p1:hits:2.5"]` works untouched -- which means the
 * id stays readable for the reader and the DOM id stays legal for the machine.
 */
const disclosureId = (propId: string): string => `prop-detail-${propId.replace(/[^a-zA-Z0-9_-]/g, '_')}`;

/**
 * Temperament, as a border colour.
 *
 * Mirrors the map in `BettingHub` rather than importing it, because that one is private to that
 * file and this card is deliberately standalone -- it is the unit the new props board is built
 * from, so it must not depend on the 1,600-line file it is meant to replace. If the two ever
 * disagree, the board is wrong in two places at once, which is the failure this separation exists
 * to prevent.
 *
 * The house read is derived with the same `propTemperamentFor` the outlets are classified by, so
 * the chip colour means exactly what it meant when it was per-outlet: this price's own probability
 * against the measured safe/hot floors.
 */
const TEMPERAMENT: Record<PropTemperament, { border: string; label: string; Icon: React.FC<{ className?: string }> }> = {
  safe: { border: 'var(--color-pos)', label: 'Safe', Icon: ShieldCheck },
  hot: { border: 'var(--color-warn)', label: 'Hot', Icon: Flame },
};

/**
 * One prop, one card, every outlet's opinion behind a disclosure.
 *
 * ============================================================================
 * WHAT THE CARD LEADS WITH
 * ============================================================================
 *
 * The HOUSE line, not an outlet's. That is a deliberate inversion of the old board, where every
 * card was an outlet's card and the house price was one button among three.
 *
 * It is the right way round for the same reason the house price is what you are offered: the
 * consensus is the thing being sold, and an outlet's number is commentary on it. Leading with an
 * outlet's read made the commentary look like the product and the price like one option among
 * several.
 *
 * ============================================================================
 * WHY THE OUTLET STRIP IS DOTS AND NOT NAMES
 * ============================================================================
 *
 * A nine-name row per card is the congestion this rebuild exists to remove, and it would be worse
 * than the nine panels it replaces. The strip answers only "how many published this, and can I see
 * who", which is one number and a disclosure affordance. Names appear when the reader asks for
 * them, in the disclosure, sorted widest-gap-first so the tradeable opinion is the first row
 * rather than something the reader has to find.
 */

interface PropCardProps {
  row: PropRowModel;
  focused: boolean;
  balance: number;
  /** The game this prop belongs to, resolved from the slate. Null when it has dropped off. */
  fixture: GameLine | null;
  /** Club lookup, so the card can say whose player this is. */
  teamById?: Map<string, Team>;
  onPlace: (input: PropPlaceInput) => void;
  registerRef: (node: HTMLDivElement | null) => void;
}

export const PropCard: React.FC<PropCardProps> = ({
  row,
  focused,
  balance,
  fixture,
  teamById,
  onPlace,
  registerRef,
}) => {
  const [open, setOpen] = React.useState(false);
  const { market } = row;
  const house = propSidePrices(market.consensusProbability);
  const marketTitle = propMarketTitle(market);

  /*
    * The temperament chip follows the HOUSE read, not an outlet's.
    *
    * On the old board this was per-outlet -- each column coloured the chip by that outlet's own
    * view -- which meant the same prop carried two different colours in two places. One card, one
    * colour, and it is the colour of the price you are actually being offered.
    */
  const temperament = TEMPERAMENT[propTemperamentFor(market.consensusProbability)];
  const TemperamentIcon = temperament.Icon;
  // The player's own club, NOT one of the fixture's -- the market carries 	eamId and dropping it is
  // what left the card unable to say which of the two teams this player belongs to.
  const playerTeam = teamById?.get(market.teamId) ?? null;

  const place = (side: PropSide, price: number, backed: MediaId | null) => onPlace({
    kind: 'prop',
    marketKey: market.gameId,
    marketTitle,
    selection: side,
    selectionLabel: backed ? propSelectionLabel(market, backed, side) : propSelectionLabel(market, 'hollis', side),
    price,
    line: market.line,
    backedMedia: backed,
    resolvesOn: market.date,
    propStat: market.stat,
    propPlayerId: market.playerId,
      propTeamId: market.teamId,
    propPlayerName: market.playerName,
    propLine: market.line,
  });

  return (
    <div
      ref={registerRef}
      data-prop-row={row.propId}
      data-focused={focused ? 'true' : undefined}
      className={`flex flex-col gap-2 border bg-[var(--color-sunken)] p-3 ${
        focused ? 'ring-2 ring-[var(--color-gold)]' : ''
      }`}
      style={{ borderColor: temperament.border, borderLeftWidth: '3px' }}
    >
      {/*
        WHICH GAME, AND WHEN.

        Two crests and a date, restored verbatim from the row this card replaces. The first pass
        at this rebuild rendered the fixture as the text "Reno at Mesa", on the grounds that it
        was the same information in fewer bytes. It is not the same information: a crest is
        identified at a glance from the standings, and a city pair is read. Two 24px marks plus
        "at" is narrower than the text and faster to parse, which is the reason the original
        author wrote the reasoning out at this length.

        The city names are kept as an sr-only span, so the marks stay the visual and the words stay
        the accessible name. Nothing about the fixture is lost by painting the crest instead.

        The date is on the strip rather than in a tooltip because a prop bet settles the night the
        game is played, which makes the date the other half of the bet's identity.

        A prop whose game is off the slate says so rather than showing a blank. It is still
        placeable and still needs its settlement stated.
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
        {/*
          WHOSE PLAYER, AND WHICH LINE -- THE TWO THINGS YOU ACTUALLY BET ON.

          The card had the game, the date, the player's name and then the line, each in its own row at
          its own weight, with the fixture crests one step larger than anything else on the card. So
          the two facts a wager is made of -- whose player, and what number -- were the two smallest
          things in it, and the club the player belongs to was not stated at all.

          The crest here is the player's OWN club, not the fixture's, and it is paired with the line
          rather than with the game. That is the correction: the opponent is context, the player and
          the number are the proposition.
        */}
        <span className="flex min-w-0 items-center gap-2">
          {playerTeam && (
            <>
              <TeamLogo team={playerTeam} sizeClass="h-5 w-5 shrink-0" />
              <span className="sr-only">Plays for {playerTeam.city}</span>
            </>
          )}
          <span className="t-stat truncate">{market.playerName}</span>
        </span>
        <span
          className="inline-flex shrink-0 items-center gap-1 border px-1.5 py-0.5 t-caption"
          style={{ borderColor: temperament.border, color: temperament.border }}
        >
          <TemperamentIcon className="h-3 w-3" aria-hidden="true" />
          {temperament.label}
        </span>
      </div>

      {/*
        THE LINE, PROMOTED.

        It was `t-caption` below the fold of the card's own hierarchy, which is the same size as the
        outlet count and about the same weight as a date. It is now the largest thing on the card
        after the player's name, because "over or under 2.5" IS the question and everything else is
        supporting information. The outlet count drops to its own line rather than trailing the number,
        so it cannot be read as part of it.
      */}
      <p className="mt-1 t-h3 tabular-nums text-[var(--color-ink)]">
        O/U {market.line} {market.statPlural}
      </p>
      {row.publishedBy > 1 && (
        <p className="t-caption text-[var(--color-ink-faint)]">
          {row.publishedBy} outlets published this
        </p>
      )}

      {/*
        HOUSE PRICE, then the strip. The two buttons sit on one row so the over/under decision --
        the part a manager acts on -- is a single glance rather than a scan past a disclosure.
      */}
      <div className="flex flex-wrap items-center gap-1.5">
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

        {/*
          THE OUTLET STRIP.

          One cell per publishing outlet, in registry order, filled at the outlet's own accent so
          the strip is also a legend you can read the disclosure against. Width is fixed at 6px so
          a card with two publishers is the same height as one with eight -- a strip that grew with
          the count would reintroduce the ragged row heights the dedupe just removed.
        */}
        <span className="ml-1 inline-flex items-center gap-[2px]">
          {row.reads.map((read) => (
            <span
              key={read.mediaId}
              className="h-[6px] w-[6px] shrink-0"
              style={{ background: `var(--color-media-${MEDIA_BY_ID[read.mediaId].accent})` }}
              aria-hidden="true"
            />
          ))}
        </span>

        <RetroButton
          variant="ghost"
          size="sm"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          aria-controls={disclosureId(row.propId)}
          title={`${row.publishedBy} outlet${row.publishedBy === 1 ? '' : 's'} published this prop`}
          className="ml-auto"
        >
          {open ? <ChevronDown className="h-3 w-3" aria-hidden="true" /> : <ChevronRight className="h-3 w-3" aria-hidden="true" />}
          {open ? 'Hide' : 'Outlets'}
        </RetroButton>
      </div>

      {open && (
        <PropOutletDisclosure
          id={disclosureId(row.propId)}
          row={row}
          balance={balance}
          onPlace={onPlace}
        />
      )}
    </div>
  );
};

/**
 * The open state: every outlet that published this prop, widest disagreement first.
 *
 * Extracted from the card rather than inlined, for one reason that is about verification rather
 * than tidiness. The collapsed state is what a manager sees first, and it is what a screenshot
 * can check. The open state is the part that carries the nine forecasters' actual opinions, and
 * an inline `{open && ...}` block cannot be rendered without a click -- so the one thing the
 * rebuild most needs to be provably correct is the one thing that would otherwise only be
 * provable by hand. As its own component it renders on demand, and `tools/checkPropCard.tsx`
 * renders it both ways.
 *
 * The fade button lives HERE rather than on the card face, and that is the point of the whole
 * disclosure. Fading is a decision made against the pack, so it belongs next to the pack. On the
 * old board it sat on every one of nine duplicated cards, which is what made it read as a routine
 * third option rather than as taking a named outlet's side against a consensus.
 */
export const PropOutletDisclosure: React.FC<{
  id: string;
  row: PropRowModel;
  balance: number;
  onPlace: (input: PropPlaceInput) => void;
}> = ({ id, row, balance, onPlace }) => {
  const { market } = row;

  const place = (read: PropOutletRead) => {
    const own = propSidePrices(read.probability);
    onPlace({
      kind: 'prop',
      marketKey: market.gameId,
      marketTitle: propMarketTitle(market),
      selection: read.side,
      selectionLabel: propSelectionLabel(market, read.mediaId, read.side),
      price: read.side === 'over' ? own.overPrice : own.underPrice,
      line: market.line,
      backedMedia: read.mediaId,
      resolvesOn: market.date,
      propStat: market.stat,
      propPlayerId: market.playerId,
      propTeamId: market.teamId,
      propPlayerName: market.playerName,
      propLine: market.line,
    });
  };

  return (
    <div id={id} className="flex flex-col gap-1 border-t border-[var(--color-chrome-lo)] pt-2">
      <p className="t-caption text-[var(--color-ink-faint)]">
        House reads {Math.round(market.consensusProbability * 100)}% over
        {market.spread >= PROP_FADE_THRESHOLD && ` · ${Math.round(market.spread * 100)}pt spread across the pack`}
      </p>
      {readsByGap(row).map((read) => (
        <div key={read.mediaId} className="flex flex-wrap items-center gap-1.5 py-0.5">
          <img
            src={MEDIA_MARKS_SQUARE[read.mediaId]}
            alt=""
            aria-hidden="true"
            className="h-5 w-5 shrink-0 object-contain"
          />
          <span className="t-caption min-w-0 flex-1 truncate text-[var(--color-ink-dim)]">
            {forecasterLabel(read.mediaId)}
            <span className="ml-1 tabular-nums">{Math.round(read.probability * 100)}% {read.side}</span>
          </span>
          {read.isOutlier && (
            <span className="t-caption shrink-0 border border-[var(--color-warn)] px-1 py-0.5 text-[var(--color-warn)]">
              OUTLIER
            </span>
          )}
          {read.canFade && (
            <RetroButton
              variant="ghost"
              size="sm"
              disabled={balance < MIN_STAKE}
              title={`Take ${forecasterLabel(read.mediaId)}'s own read instead of the house line`}
              onClick={() => place(read)}
            >
              Fade to theirs
            </RetroButton>
          )}
        </div>
      ))}
    </div>
  );
};