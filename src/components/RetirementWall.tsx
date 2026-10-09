import React, { useMemo } from 'react';
import { Award, Clock3, Handshake } from 'lucide-react';
import {
  collectRetirements,
  finalSeasonSummary,
  tierRetirements,
  type RetirementRecord,
} from '../lib/retirements';
import type { LeaguePlayerState, Team } from '../types';
import { Panel, RetroButton, SectionTitle, TeamLogo } from './ui';

/**
 * THE CAREERS THAT ENDED.
 *
 * ============================================================================
 * WHY THIS IS A STAGE OF THE OFFSEASON AND NOT A LINE IN A NOTICE
 * ============================================================================
 *
 * `applyOffseasonRetirements` reports a count. Seven players retired and the interface said "7". A
 * retirement is the only event in a season that is genuinely, permanently final: the pennant gets
 * handed over, the draft produces a career that has not started yet, but a man putting the bat down
 * is the one thing that cannot be undone by next April. It deserves to be something a manager walks
 * into, which is why the stage shows this before it will let you continue.
 *
 * ============================================================================
 * BIG NAMES AND CRESTS, AND WHY THAT IS THE SPECIFICATION RATHER THAN THE DECORATION
 * ============================================================================
 *
 * The tiering is not styling. A league that retires three franchise players and nine reserves is
 * making three different-sized announcements, and a flat list of twelve identical rows would state
 * that all twelve are equal. The headline tier is what makes the screen say something.
 *
 * The cut point (84) is the SAME number `headlineEngine` uses to file a story about a retirement.
 * If the newsroom covered a player's final season and the farewell screen passed him over, the game
 * would be contradicting itself about how big a deal it was.
 *
 * ============================================================================
 * WHY THIS RENDERS THE SAME AFTER A RELOAD
 * ============================================================================
 *
 * It reads retired players and their final clubs out of `playerState` and derives the tiers at
 * render. There is no snapshot taken when the stage ran, so there is nothing to lose: a manager who
 * refreshes this screen sees the same wall. That is deliberate, and it is the property the recovery
 * work was built on -- a presentation that only exists in React memory is a presentation that
 * disappears.
 */

interface RetirementWallProps {
  playerState: LeaguePlayerState;
  teams: Team[];
  seasonYear: number;
  /** The retirements have not been simulated yet, so there is nothing to show. */
  isPending: boolean;
  onContinue: () => void;
  /** Marks the step resolved; the checklist hides its own button once this is true. */
  isComplete: boolean;
}

/**
 * THE CONTINUOUS STANDARD FOR A RETAIRCARD.
 *
 * Left undefined rather than defaulting to a note, because "retired after an age-N season" with a
 * bare integer is what the notice already says and it is not a sentence. A club that has just seen a
 * man retire in front of its fans deserves the club's name in it.
 */
const retirementNote = (record: RetirementRecord, team: Team | null): string => {
  const service = record.player.yearsPro === 1 ? 'one season' : `${record.player.yearsPro} seasons`;
  if (team) {
    return `${team.city} · retired after ${service} and age ${record.player.age}`;
  }
  return `Retired as a free agent after ${service} and age ${record.player.age}`;
};

const RetirementCard: React.FC<{
  record: RetirementRecord;
  team: Team | null;
  /** The headline tier gets the oversized treatment; veterans get a slightly smaller cut. */
  emphasis: 'headline' | 'veteran';
}> = ({ record, team, emphasis }) => {
  const { player } = record;
  const name = `${player.firstName} ${player.lastName}`.trim();

  return (
    <Panel variant={emphasis === 'headline' ? 'hero' : 'default'} className="overflow-hidden">
      <div className="flex items-start gap-4 p-4">
        {team
          ? <TeamLogo team={team} sizeClass={emphasis === 'headline' ? 'h-16 w-16' : 'h-12 w-12'} />
          : <div
              className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full border border-dashed border-[var(--color-ink-faint)]"
              aria-hidden="true"
            >
              <Handshake className="h-6 w-6 text-[var(--color-ink-faint)]" />
            </div>}
        <div className="min-w-0 flex-1">
          {/* The name is the event. It is set at display size for a headline retirement because
              a farewell that renders the subject at the same size as the metadata has decided the
              metadata is the news. */}
          <h3 className={emphasis === 'headline' ? 't-display truncate' : 't-h2 truncate'}>
            {name}
          </h3>
          <p className="t-caption mt-1 text-[var(--color-ink-faint)]">
            {team ? team.city : 'Free agent'} · {player.primaryPosition}
            {player.secondaryPosition ? ` / ${player.secondaryPosition}` : ''}
            {' · '}{player.age} years old · {player.yearsPro} {player.yearsPro === 1 ? 'season' : 'seasons'}
          </p>
          <p className="t-body mt-2 text-[var(--color-ink)]">{finalSeasonSummary(record)}</p>
          <p className="t-caption mt-1 text-[var(--color-ink-faint)]">{retirementNote(record, team)}</p>
        </div>
        {record.overall > 0 && (
          <div className="shrink-0 text-right">
            <p className="t-label text-[var(--color-ink-faint)]">OVR</p>
            <p className="t-h2 text-[var(--color-gold)]">{Math.round(record.overall)}</p>
          </div>
        )}
      </div>
    </Panel>
  );
};

/** The long tail, as names rather than cards. */
const RankAndFileList: React.FC<{ records: RetirementRecord[]; teamsById: Map<string, Team> }> = ({
  records,
  teamsById,
}) => (
  <Panel variant="sunken" className="p-4">
    <div className="mb-3 flex items-center gap-2">
      <Clock3 className="h-4 w-4 text-[var(--color-ink-faint)]" aria-hidden="true" />
      <p className="t-label text-[var(--color-ink-dim)]">Also retired</p>
      <span className="t-caption text-[var(--color-ink-faint)]">{records.length}</span>
    </div>
    <ul className="flex flex-wrap gap-x-4 gap-y-1">
      {records.map((record) => {
        const team = record.finalClubId ? teamsById.get(record.finalClubId) : undefined;
        return (
          <li key={record.player.playerId} className="t-caption text-[var(--color-ink-dim)]">
            {record.player.firstName} {record.player.lastName}
            {team ? <span className="text-[var(--color-ink-faint)]"> · {team.city}</span> : null}
          </li>
        );
      })}
    </ul>
  </Panel>
);

export const RetirementWall: React.FC<RetirementWallProps> = ({
  playerState,
  teams,
  seasonYear,
  isPending,
  onContinue,
  isComplete,
}) => {
  const teamsById = useMemo(() => new Map(teams.map((team) => [team.id, team])), [teams]);

  // Derived at render, from persisted state. No snapshot, so nothing to lose on a reload.
  const { headline, veteran, rank_and_file: rankAndFile, total } = useMemo(() => {
    const records = collectRetirements(playerState, seasonYear);
    const tiers = tierRetirements(records);
    return { ...tiers, total: records.length };
  }, [playerState, seasonYear]);

  if (isPending) {
    return (
      <Panel className="p-6 text-center">
        <p className="t-h3 text-[var(--color-ink)]">No retirements have been resolved yet</p>
        <p className="t-body mt-2 text-[var(--color-ink-dim)]">
          The league ages when this step runs. Nothing has left the game so far this winter.
        </p>
      </Panel>
    );
  }

  return (
    <div className="space-y-5">
      <Panel variant="hero" className="overflow-hidden">
        <div className="flex flex-wrap items-end justify-between gap-3 p-5">
          <div>
            <p className="t-label text-[var(--color-gold)]">{seasonYear} Winter</p>
            <h2 className="t-display mt-1">The Careers That Ended</h2>
            <p className="t-body mt-2 text-[var(--color-ink-dim)]">
              {total === 0
                ? 'Nobody retired after this season.'
                : `${total} ${total === 1 ? 'player' : 'players'} finished their careers after the ${seasonYear} season.`}
            </p>
          </div>
          <RetroButton variant="primary" onClick={onContinue} disabled={isComplete}>
            {isComplete ? 'Continue' : 'Continue to the Draft Lottery'}
          </RetroButton>
        </div>
      </Panel>

      {headline.length > 0 && (
        <section className="space-y-3">
          <SectionTitle secondary={<span className="flex items-center gap-1"><Award className="h-3.5 w-3.5" aria-hidden="true" />{headline.length}</span>}>
            Franchise Players
          </SectionTitle>
          <div className="space-y-3">
            {headline.map((record) => (
              <RetirementCard
                key={record.player.playerId}
                record={record}
                team={record.finalClubId ? teamsById.get(record.finalClubId) ?? null : null}
                emphasis="headline"
              />
            ))}
          </div>
        </section>
      )}

      {veteran.length > 0 && (
        <section className="space-y-3">
          <SectionTitle secondary={veteran.length}>{veteran.length === 1 ? 'Veteran' : 'Veterans'}</SectionTitle>
          <div className="grid gap-3 sm:grid-cols-2">
            {veteran.map((record) => (
              <RetirementCard
                key={record.player.playerId}
                record={record}
                team={record.finalClubId ? teamsById.get(record.finalClubId) ?? null : null}
                emphasis="veteran"
              />
            ))}
          </div>
        </section>
      )}

      {rankAndFile.length > 0 && (
        <RankAndFileList records={rankAndFile} teamsById={teamsById} />
      )}

      {headline.length === 0 && veteran.length === 0 && rankAndFile.length === 0 && (
        <Panel variant="sunken" className="p-4">
          <p className="t-body text-[var(--color-ink-dim)]">
            A quiet winter. Nobody retired, and the league's veterans all still have a contract year
            to run.
          </p>
        </Panel>
      )}
    </div>
  );
};