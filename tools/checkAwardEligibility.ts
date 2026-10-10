/*
  A PLAYER WITH NO CLUB CANNOT WIN AN MVP.

  Found on the Awards screen in a third season, where three qualified candidates rendered as "Free
  Agent" with full-season lines -- 28 HR, 72 RBI -- and a TEAM term of exactly .000.

  WHY THIS NEEDS ITS OWN FILE, AND WHY IT IS NOT A DISPLAY BUG

  The obvious reading is that the page failed to look up the team. It did not. `teamsById` is built
  from the full team array, and a valid `teamId` cannot miss it. The `.000` is the tell: a genuine
  zero, produced by the TEAM term defaulting when the lookup returns null. So the player really had no
  club, and the real question became why a clubless player was in the race at all.

  Both race builders qualified on production alone -- 120 at-bats, or eight starts -- and then looked
  the team up, defaulting a miss to `null`. That default was wrong three times over:

    1. He could WIN. A manager who released a star in July left him atop the leaderboard on a club
       that does not exist.
    2. His score was computed differently. Everyone else's TEAM term is a real win percentage; his was
       a hard zero. Seven terms against everyone's eight, on a page that prints the arithmetic.
    3. It reached the ARCHIVE and the BOOK. `computeBattingMvpCandidates` in App.tsx ranks the season
       written to the season history, and `BettingPage` prices the market off the same field -- so a
       clubless player could be recorded as a season MVP with a null team, and the book would sell him.

  THE RELEASE IS THE APP'S OWN, NOT AN INVENTED ONE

  `useRosterTransactions.ts:284` and `automaticMarket.ts:77` both perform exactly this edit. Reusing it
  means this check exercises the real condition rather than a shape the app never produces, and it
  fails if that release ever changes.
*/
import { INITIAL_TEAMS } from '../src/data/teams';
import { buildNewUniverse } from '../src/logic/universeBootstrap';
import { recalculateTeamRatingsFromRosters } from '../src/logic/teamStrength';
import { DEFAULT_SETTINGS, generateSchedule, getDefaultSeasonStartDate } from '../src/logic/simulation';
import { SimulationManager } from '../src/logic/simulationManager';
import { getPreferredBattingStatsByPlayerId, getPreferredPitchingStatsByPlayerId } from '../src/logic/playerStats';
import { buildBattingAwards, buildPitchingAwards, type AwardEntry, type AwardInputs } from '../src/lib/awardRace';
import type { LeaguePlayerState, Player, Team } from '../src/types';

const YEAR = 2026;
const SEED = 4242;

const problems: string[] = [];

const check = (label: string, pass: boolean, detail: string) => {
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${label}`);
  if (detail) console.log(`          ${detail}`);
  if (!pass) problems.push(label);
};

/**
 * Run a real season. An empty race makes every assertion below pass vacuously, so the field being
 * empty is a FAILURE rather than an early return -- a check that cannot tell "nothing to test" from
 * "everything correct" is decoration.
 */
const buildSeason = async (): Promise<{ state: LeaguePlayerState; teams: Team[] }> => {
  const built = buildNewUniverse({
    teams: INITIAL_TEAMS.map((t) => ({ ...t })),
    seasonYear: YEAR,
    seed: SEED,
    effectiveDate: `${YEAR}-12-15`,
  });
  const teams = recalculateTeamRatingsFromRosters(
    INITIAL_TEAMS.map((t) => ({ ...t, wins: 0, losses: 0, runsScored: 0, runsAllowed: 0 })),
    built.playerState,
    YEAR,
  );
  const manager = new SimulationManager({
    teams,
    games: generateSchedule(teams, { seasonStartDate: getDefaultSeasonStartDate(YEAR), seasonDays: 180 }),
    playerState: built.playerState,
    settings: DEFAULT_SETTINGS,
    currentDate: getDefaultSeasonStartDate(YEAR),
  });
  let latest = await manager.run({ scope: 'day' });
  for (let d = 0; d < 190; d += 1) latest = await manager.run({ scope: 'day' });
  // The MANAGER'S teams, not the input array. The array handed in is the zeroed
  // 0-0 template, and a first version of this file returned that instead -- which
  // made every club read 0-for-162 and silently turned the TEAM-term check below
  // into a no-op that reported PASS while testing nothing. The check now carries its
  // own guard for exactly that, and prints when it has nothing to calibrate against.
  return { state: latest.playerState, teams: latest.teams };
};

const toInputs = (state: LeaguePlayerState, teams: Team[]): AwardInputs => ({
  players: state.players,
  teamsById: new Map(teams.map((t) => [t.id, t])),
  battingStats: getPreferredBattingStatsByPlayerId(state.battingStats, 'regular_season'),
  pitchingStats: getPreferredPitchingStatsByPlayerId(state.pitchingStats, 'regular_season'),
  battingRatings: new Map(state.battingRatings.map((r) => [r.playerId, r])),
  pitchingRatings: new Map(state.pitchingRatings.map((r) => [r.playerId, r])),
});

/** The release the app performs when a club cuts a player. Copied, not imported: importing the app's
 *  own edit would make this check agree with the thing it exists to catch. */
const release = (players: Player[], playerId: string): Player[] => players.map((p) =>
  p.playerId === playerId
    ? { ...p, teamId: null, status: 'free_agent' as const, contractYearsLeft: 0 }
    : p,
);

const teamlessNames = (entries: AwardEntry[]): string[] =>
  entries.filter((e) => !e.team).map((e) => e.name);

const main = async () => {
  console.log('\nAWARD ELIGIBILITY -- a player with no club cannot win an MVP\n');
  const { state, teams } = await buildSeason();
  const inputs = toInputs(state, teams);

  const batting = buildBattingAwards(inputs);
  const pitching = buildPitchingAwards(inputs);

  if (batting.length === 0 || pitching.length === 0) {
    console.log('  FIELD EMPTY -- every assertion below would pass vacuously');
    process.exit(1);
  }

  console.log(`  batting field of ${batting.length}, pitching field of ${pitching.length}\n`);

  // -- 1. THE FIELD IS CLEAN IN A HEALTHY LEAGUE -----------------------------------------------
  const dirtyBatting = teamlessNames(batting);
  const dirtyPitching = teamlessNames(pitching);
  check(
    'every candidate on a healthy race has a club',
    dirtyBatting.length === 0 && dirtyPitching.length === 0,
    `${batting.length} batters and ${pitching.length} pitchers, none without a team`,
  );

  // -- 2. THE TEAM TERM IS DERIVED FROM A REAL CLUB ---------------------------------------------
  /*
    The first version of this asserted "every TEAM term is above zero", which is wrong: a club 0-for-162
    has a genuine win percentage of zero, so its candidates legitimately score 0 on the term. Asserting
    it was asserting that no club may be bad at baseball.

    The real invariant is that the term is a FUNCTION OF THE PLAYER'S CLUB -- read off the team, not
    defaulted. So it is checked against the team's actual record. The weight is inferred from the field
    rather than hardcoded as 60 or 40, so a legitimate refit of the TEAM term does not break this check;
    and it is skipped outright when no club in the field has a non-zero record, because then there is
    nothing to calibrate against and the assertion would be vacuous.
  */
  const winPctOf = (entry: AwardEntry): number => {
    const t = entry.team;
    if (!t) return NaN;
    const played = t.wins + t.losses;
    return played > 0 ? t.wins / played : 0;
  };

  const calibrate = (entries: AwardEntry[]): { weight: number; basis: AwardEntry } | null => {
    const basis = entries.find((e) => winPctOf(e) > 0);
    if (!basis) return null;
    const term = basis.components.find((c) => c.label === 'TEAM');
    if (!term) return null;
    return { weight: term.contribution / winPctOf(basis), basis };
  };

  const teamTermIsReal = (entries: AwardEntry[], label: string): { pass: boolean; detail: string } => {
    const cal = calibrate(entries);
    if (!cal) {
      return { pass: true, detail: `${label}: no candidate's club has a non-zero record this season, so the TEAM term cannot be calibrated and the check is vacuous` };
    }
    const bad = entries.filter((e) => {
      const pct = winPctOf(e);
      const term = e.components.find((c) => c.label === 'TEAM');
      if (Number.isNaN(pct) || !term) return true;
      return Math.abs(term.contribution - pct * cal.weight) > 0.05;
    });
    return {
      pass: bad.length === 0,
      detail: bad.length === 0
        ? `${label}: weight inferred as ${cal.weight.toFixed(1)} per win-pct from ${cal.basis.name}, and all`
          + ` ${entries.length} candidates match their own club's record. A defaulted term would not track the club.`
        : `${label}: ${bad.length} candidates whose TEAM term does not match their club's record`,
    };
  };

  const battingTerms = teamTermIsReal(batting, 'batting');
  const pitchingTerms = teamTermIsReal(pitching, 'pitching');
  // A calibration that could not happen is a FAILURE, not a pass. This check reported green once
  // already while testing nothing, because it was handed a 0-0 template instead of the season's
  // records -- so the "nothing to calibrate against" case is now loud rather than silent.
  const calibrated = battingTerms.detail.includes('vacuous') || pitchingTerms.detail.includes('vacuous');
  check(
    'every TEAM term is read off the candidate\'s actual club',
    battingTerms.pass && pitchingTerms.pass && !calibrated,
    [battingTerms.detail, pitchingTerms.detail].join(' | '),
  );

  // -- 3. REPRODUCE THE REPORTED BUG: RELEASE THE RACE LEADER ---------------------------------
  const leader = batting[0];
  const afterRelease = buildBattingAwards({ ...inputs, players: release(state.players, leader.playerId) });

  check(
    'a released player leaves the race',
    !afterRelease.some((e) => e.playerId === leader.playerId),
    `released ${leader.name} (${leader.team?.city ?? 'no team'}, ${leader.total.toFixed(1)} pts) exactly as`
    + ' useRosterTransactions does: teamId null, status free_agent',
  );

  /*
    The first version of this asserted the field SHRANK, which is also wrong: the board is a ranked top
    eight, so removing one candidate correctly promotes the ninth. A field that refused to refill would
    mean a dead slot.

    The invariant worth holding is that a release REMOVES a candidate and REWRITES NOBODY -- everyone
    still on the board keeps the identical score, because none of their inputs changed. If a refactor
    made a release perturb the rest of the field, that would be a quieter and far worse bug than the one
    this file was written for.
  */
  const scoresUnchanged = batting
    .filter((e) => e.playerId !== leader.playerId)
    .every((e) => afterRelease.find((a) => a.playerId === e.playerId)?.total === e.total);
  check(
    'and the survivors keep byte-identical scores',
    scoresUnchanged,
    `field went ${batting.length} -> ${afterRelease.length}, promoting the next-ranked candidate into the`
    + ` vacated slot. ${batting.length - 1} survivors, every score unchanged to the decimal`,
  );

  // -- 4. THE SAME FOR PITCHING, SO THE GATE CANNOT BE PATCHED ON ONE BOARD ONLY ----------------
  const pitLeader = pitching[0];
  const afterPitchRelease = buildPitchingAwards({ ...inputs, players: release(state.players, pitLeader.playerId) });
  check(
    'and a released pitcher leaves the pitching race too',
    !afterPitchRelease.some((e) => e.playerId === pitLeader.playerId),
    `released ${pitLeader.name} (${pitLeader.total.toFixed(1)} pts)`,
  );

  // -- 5. THE ARCHIVE PATH, WHICH IS WHERE A TEAMLESS MVP WOULD HAVE BEEN WRITTEN ---------------
  // `computeBattingMvpCandidates` in App.tsx maps `entry.team?.id ?? null`. Every archived winner
  // must therefore carry a club, or the season history records an MVP belonging to nobody.
  const archivedNullTeam = [...batting, ...pitching].filter((e) => !e.team?.id);
  check(
    'no candidate can be archived as an MVP with a null team',
    archivedNullTeam.length === 0,
    'the season-history builder reads `entry.team?.id ?? null`, so a clubless winner would be written to'
    + ' the archive as an MVP who belongs to nobody',
  );

  // -- 6. AND THE SURVIVORS STILL SCORE ON EIGHT TERMS, NOT SEVEN ------------------------------
  const termCounts = new Set(batting.map((e) => e.components.length));
  check(
    'every candidate is still scored on the same eight terms',
    termCounts.size === 1 && batting.every((e) => e.components.length === 8),
    `term counts across the field: ${[...termCounts].join(', ')}. A clubless candidate carried a hard-zero TEAM`
    + ' term while everyone else carried a real win percentage, so they were compared on seven terms against eight',
  );

  console.log('');
  if (problems.length) {
    problems.forEach((p) => console.log(`  FAIL  ${p}`));
    console.log(`\n  ${problems.length} problem(s).\n`);
    process.exit(1);
  }
  console.log('  a player on no club is not a candidate, on any surface, in either race.\n');
};

main().catch((e) => { console.error(e); process.exit(1); });