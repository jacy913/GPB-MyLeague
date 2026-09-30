import React, { useState } from 'react';
import { LineChart, Receipt, Trophy, Users } from 'lucide-react';
import type { MediaId } from '../../data/media';
import { MEDIA_PROFILES, MEDIA_BY_ID } from '../../data/media';
import type { FieldMarket, LineMarket } from '../../lib/markets';
import { formatAmerican } from '../../lib/markets';
import type { GameLine } from '../../lib/mediaOdds';
import type { PlacedBet, BetKind, BetStatus, Selection } from '../../lib/wallet';
import { MAX_STAKE, MIN_STAKE, STARTING_BALANCE, settleReturn } from '../../lib/wallet';
import { MEDIA_MARKS_SQUARE } from '../media/mediaImages';
import { Panel, RetroButton, SegmentedControl, TeamLogo } from '../ui';

type BettingView = 'slate' | 'futures' | 'awards';

interface BettingSlateProps {
  view: BettingView;
  onView: (view: BettingView) => void;
  lines: LineMarket[];
  moneyline: GameLine[];
  futures: FieldMarket[];
  awards: FieldMarket[];
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
    backedMedia: MediaId | null;
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
  view, onView, lines, moneyline, futures, awards, slateDate, bets, onPlace, balance,
}) => (
  <section className="space-y-5">
    <Panel variant="hero" className="p-4 md:p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="t-h1">Betting</h1>
          <p className="t-body mt-2 max-w-3xl text-[var(--color-ink-dim)]">
            Every price here is the mean of the three published probabilities, with a margin on top.
            Where an outlet sits well away from the other two, that is the number worth fading.
          </p>
        </div>
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
          { value: 'futures', label: 'Season Futures' },
          { value: 'awards', label: 'Awards' },
        ]}
      />
      {view === 'slate' && (
        <span className="t-caption text-[var(--color-ink-faint)]">
          {slateDate ? `${slateDate} · ${lines.length} ${lines.length === 1 ? 'game' : 'games'}` : 'No slate ahead'}
        </span>
      )}
    </div>

    <OpenBets bets={bets} />

    {view === 'slate' && <SlateView lines={lines} moneyline={moneyline} onPlace={onPlace} balance={balance} />}
    {view === 'futures' && <FuturesView markets={futures} onPlace={onPlace} balance={balance} />}
    {view === 'awards' && <AwardsView markets={awards} onPlace={onPlace} balance={balance} />}
  </section>
);

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

  return (
    <div className="grid gap-4">
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
          <TotalMarketCard key={line.key} market={line} balance={balance} onPlace={onPlace} />
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
  const side = (
    team: GameLine['awayTeam'],
    pick: 'away' | 'home',
    price: number,
  ) => (
    <RetroButton
      variant="default"
      size="sm"
      disabled={balance < MIN_STAKE}
      onClick={() => onPlace({
        kind: 'moneyline',
        marketKey: game.gameId,
        marketTitle: `${game.awayTeam.city} at ${game.homeTeam.city}`,
        selection: pick,
        selectionLabel: team.city,
        price,
        backedMedia: null,
      })}
    >
      <TeamLogo team={team} sizeClass="h-5 w-5" />
      {team.city} {formatAmerican(price)}
    </RetroButton>
  );

  return (
    <Panel className="overflow-hidden">
      <div className="chrome-bar flex flex-wrap items-center justify-between gap-3 px-4">
        <div className="flex min-w-0 items-center gap-2">
          <TeamLogo team={game.awayTeam} sizeClass="h-6 w-6" />
          <h2 className="t-h3 truncate">
            {game.awayTeam.city} <span className="text-[var(--color-ink-dim)]">at</span> {game.homeTeam.city}
          </h2>
          <TeamLogo team={game.homeTeam} sizeClass="h-6 w-6" />
        </div>
        <span className="t-caption text-[var(--color-ink-faint)]">{game.date}</span>
      </div>

      <div className="grid gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="flex flex-col gap-3">
          <div>
            <p className="t-caption text-[var(--color-ink-faint)]">Moneyline — each outlet's price</p>
            {/*
              Flex with content-width cells, not a three-column grid. A grid
              divides the available width three ways, so on a wide card each
              outlet's price sat alone in the middle of a long empty bar. These
              are three short numbers about to be compared, and they should sit
              next to each other rather than be spread across the panel.
            */}
            <div className="mt-2 flex flex-wrap gap-1.5">
              {MEDIA_PROFILES.map((profile) => (
                <div
                  key={profile.id}
                  className="flex items-center gap-1.5 border-l-[3px] bg-[var(--color-sunken)] px-2 py-1.5"
                  style={{ borderLeftColor: `var(--color-media-${profile.accent})` }}
                >
                  <img
                    src={MEDIA_MARKS_SQUARE[profile.id]}
                    alt=""
                    aria-hidden="true"
                    className="h-5 w-5 object-contain"
                  />
                  <span className="t-stat-sm tabular-nums">{formatAmerican(game.odds[profile.id])}</span>
                </div>
              ))}
            </div>
            <p className="t-caption mt-1 text-[var(--color-ink-faint)]">
              House {formatAmerican(game.houseOdds)} · the three span {Math.round(game.disagreement * 100)} points
              {game.disagreement >= 0.12 && ' — they are split on this one.'}
            </p>
          </div>

          {total && (
            <div>
              <p className="t-caption text-[var(--color-ink-faint)]">
                Run total — house line {total.houseLine.toFixed(1)}
              </p>
              <div className="mt-1 flex flex-wrap items-center gap-3">
                {MEDIA_PROFILES.map((profile) => (
                  <span key={profile.id} className="flex items-center gap-1.5">
                    <img src={MEDIA_MARKS_SQUARE[profile.id]} alt="" aria-hidden="true" className="h-4 w-4 object-contain" />
                    <span className="t-stat-sm tabular-nums">{total.fair[profile.id].toFixed(1)}</span>
                  </span>
                ))}
                <span className="t-caption text-[var(--color-ink-faint)]">spread {total.spread.toFixed(1)}</span>
              </div>
            </div>
          )}
        </div>

        <div className="flex flex-col gap-2">
          {side(game.awayTeam, 'away', game.houseOdds)}
          {side(game.homeTeam, 'home', -game.houseOdds)}
          {total && (
            <>
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
                })}
              >
                Over {total.houseLine.toFixed(1)} {formatAmerican(total.overPrice)}
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
                })}
              >
                Under {total.houseLine.toFixed(1)} {formatAmerican(total.underPrice)}
              </RetroButton>
            </>
          )}
        </div>
      </div>
    </Panel>
  );
};

const TotalMarketCard: React.FC<{
  market: LineMarket;
  balance: number;
  onPlace: BettingSlateProps['onPlace'];
}> = ({ market, onPlace, balance }) => {
  const firstHalf = market.kind === 'first5';

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
              marketKey: market.key.replace(/^(total|first5):/, ''),
              marketTitle: `${market.title} ${firstHalf ? 'first five' : 'total'}`,
              selection: 'over',
              selectionLabel: `Over ${market.houseLine.toFixed(1)}`,
              price: market.overPrice,
              line: market.houseLine,
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
              marketKey: market.key.replace(/^(total|first5):/, ''),
              marketTitle: `${market.title} ${firstHalf ? 'first five' : 'total'}`,
              selection: 'under',
              selectionLabel: `Under ${market.houseLine.toFixed(1)}`,
              price: market.underPrice,
              line: market.houseLine,
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
 * Field markets -- futures and awards
 * ------------------------------------------------------------------ */

const FieldMarketCard: React.FC<{
  market: FieldMarket;
  balance: number;
  onPlace: BettingSlateProps['onPlace'];
}> = ({ market, balance, onPlace }) => {
  const kind: BetKind = market.kind === 'award' ? 'award' : market.kind;
  // The market key is "<kind>:<group>"; settlement looks the group up by name, so
  // only the group half travels with the bet.
  const groupKey = market.key.slice(market.key.indexOf(':') + 1);

  return (
    <Panel className="overflow-hidden">
      <div className="chrome-bar flex flex-wrap items-center justify-between gap-3 px-4">
        <div className="flex items-center gap-2">
          <Trophy className="h-4 w-4 text-[var(--color-gold)]" aria-hidden="true" />
          <h2 className="t-h3">{market.title}</h2>
        </div>
        <span className="t-caption text-[var(--color-ink-faint)]">
          {market.subtitle} · {market.outcomes.length} clubs
        </span>
      </div>
      <div className="grid gap-1 p-3">
        {market.outcomes.map((outcome) => {
          const isFavourite = outcome.key === market.outcomes[0]?.key;
          // A row where the three barely differ is not worth a second price. The
          // disagreement threshold is where taking someone's number stops being a
          // bet and starts being a vote.
          const split = outcome.disagreement >= 0.06;
          return (
            <div
              key={outcome.key}
              className="border-l-[3px] bg-[var(--color-sunken)] px-3 py-2"
              style={{ borderLeftColor: isFavourite ? 'var(--color-gold)' : 'transparent' }}
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className={`truncate t-stat ${isFavourite ? 'text-[var(--color-gold-hi)]' : ''}`}>
                    {outcome.label}
                    {outcome.sublabel && (
                      <span className="ml-2 t-caption text-[var(--color-ink-dim)]">{outcome.sublabel}</span>
                    )}
                  </p>
                  {split && (
                    <p className="t-caption text-[var(--color-warn)]">
                      {MEDIA_BY_ID[outcome.outlier].outlet} is {Math.round(outcome.disagreement * 100)} points
                      away from the other two
                    </p>
                  )}
                </div>

                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-1.5">
                    {MEDIA_PROFILES.map((profile) => (
                      <span key={profile.id} className="flex items-center gap-1">
                        <img
                          src={MEDIA_MARKS_SQUARE[profile.id]}
                          alt=""
                          aria-hidden="true"
                          className="h-4 w-4 object-contain"
                        />
                        <span className="t-caption tabular-nums text-[var(--color-ink-dim)]">
                          {formatAmerican(outcome.odds[profile.id])}
                        </span>
                      </span>
                    ))}
                  </div>

                  <span className="t-stat-lg w-16 text-right tabular-nums text-[var(--color-gold-hi)]">
                    {formatAmerican(outcome.houseOdds)}
                  </span>

                  <RetroButton
                    variant="primary"
                    size="sm"
                    disabled={balance < MIN_STAKE}
                    onClick={() => onPlace({
                      kind,
                      marketKey: groupKey,
                      marketTitle: market.title,
                      selection: outcome.key,
                      selectionLabel: outcome.label,
                      price: outcome.houseOdds,
                      backedMedia: null,
                    })}
                  >
                    Back
                  </RetroButton>

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
                        backedMedia: outcome.outlier,
                      })}
                    >
                      Fade to theirs
                    </RetroButton>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </Panel>
  );
};

const FuturesView: React.FC<{
  markets: FieldMarket[];
  balance: number;
  onPlace: BettingSlateProps['onPlace'];
}> = ({ markets, onPlace, balance }) => (
  <div className="grid gap-4">
    <p className="t-caption px-1 text-[var(--color-ink-faint)]">
      Season-long markets settle when a season is archived, not before. Each price is the mean of
      the three outlets' probabilities; the faint marks show which outlet sits furthest from the
      other two on that club.
    </p>
    {markets.length === 0
      ? <Panel className="p-6"><p className="t-body text-[var(--color-ink-dim)]">No division or league races could be built.</p></Panel>
      : markets.map((market) => (
        <FieldMarketCard key={market.key} market={market} balance={balance} onPlace={onPlace} />
      ))}
  </div>
);

const AwardsView: React.FC<{
  markets: FieldMarket[];
  balance: number;
  onPlace: BettingSlateProps['onPlace'];
}> = ({ markets, onPlace, balance }) => (
  <div className="grid gap-4">
    <p className="t-caption px-1 text-[var(--color-ink-faint)]">
      The three outlets differ on awards by how hard they regress a hot start toward the field. The
      metrics forecaster pulls hardest, which makes a narrow leader look narrow; the narrative one
      barely regresses at all, so it will pay 5-to-1 for a player nobody else has noticed.
    </p>
    {markets.length === 0
      ? <Panel className="p-6"><p className="t-body text-[var(--color-ink-dim)]">No award race is available yet.</p></Panel>
      : markets.map((market) => (
        <FieldMarketCard key={market.key} market={market} balance={balance} onPlace={onPlace} />
      ))}
  </div>
);

/* ------------------------------------------------------------------ *
 * Open bets
 * ------------------------------------------------------------------ */

export const OpenBets: React.FC<{ bets: PlacedBet[] }> = ({ bets }) => {
  const open = bets.filter((bet) => bet.status === 'open');
  if (open.length === 0) return null;

  return (
    <Panel className="overflow-hidden">
      <div className="chrome-bar flex items-center gap-2 px-4">
        <Users className="h-4 w-4 text-[var(--color-gold)]" aria-hidden="true" />
        <h2 className="t-h3">Open Bets</h2>
        <span className="t-caption text-[var(--color-ink-faint)]">
          {open.length} · ${open.reduce((sum, bet) => sum + bet.stake, 0)} at risk
        </span>
      </div>
      <div className="grid gap-1 p-3">
        {open.map((bet) => (
          <div key={bet.id} className="flex flex-wrap items-center justify-between gap-2 border-l-[3px] border-l-[var(--color-gold)] bg-[var(--color-sunken)] px-3 py-2">
            <div className="min-w-0">
              <p className="t-stat-sm truncate">
                {bet.selectionLabel} {formatAmerican(bet.price)}
              </p>
              <p className="t-caption text-[var(--color-ink-faint)]">
                {bet.marketTitle}
                {bet.note && ` · line ${Number(bet.note).toFixed(1)}`}
              </p>
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

/* ------------------------------------------------------------------ *
 * Settled bets and the slip
 * ------------------------------------------------------------------ */

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
          <span className={`t-stat tabular-nums ${net >= 0 ? 'text-[var(--color-pos)]' : 'text-[var(--color-neg)]'}`}>
            {net >= 0 ? '+' : '-'}${Math.abs(Math.round(net))}
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
            : `${summary.wins}/${summary.settled} won · ${summary.profit >= 0 ? '+' : '-'}$${Math.abs(Math.round(summary.profit))}`}
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
