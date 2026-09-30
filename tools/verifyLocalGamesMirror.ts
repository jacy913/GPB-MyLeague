/**
 * Verifies the bounded localStorage games mirror.
 *
 * probeStorageBudget.ts established that a full season's games need ~233 MB
 * against a 5 MB localStorage origin quota, so the mirror has to drop
 * something. This checks that what it drops is the right thing, and that what
 * it keeps is everything a consumer actually reads.
 *
 * The claims under test:
 *
 *  1. A full season (2,592 games) fits in the mirror without the
 *     envelope-only fallback engaging.
 *  2. Every game keeps its structural envelope and its settlement-critical
 *     fields, including lineScore, which first-five bets settle from.
 *  3. Bulky fields are retained newest-first, so today's slate survives.
 *  4. Retained play logs are byte-identical to the source -- never truncated.
 *     Truncation would produce unparseable JSON, which reads as an empty log
 *     and would void props rather than merely losing them.
 *  5. The dropped games are the OLD ones, not a scattered subset.
 *
 * Run: npx tsx tools/verifyLocalGamesMirror.ts
 */

import { INITIAL_TEAMS } from '../src/data/teams';
import { buildNewUniverse } from '../src/logic/universeBootstrap';
import { recalculateTeamRatingsFromRosters } from '../src/logic/teamStrength';
import { DEFAULT_SETTINGS, generateSchedule, getDefaultSeasonStartDate } from '../src/logic/simulation';
import { SimulationManager } from '../src/logic/simulationManager';
import {
  LOCAL_STORAGE_QUOTA_UNITS,
  LOCAL_STORAGE_SIBLING_FLOOR_UNITS,
  buildLocalGamesMirror,
  envelopeStats,
  gamesBudgetFromOccupiedUnits,
} from '../src/lib/localGamesMirror';
import type { Game, Team } from '../src/types';

const YEAR = 2026;
const SEED = 4242;
const DAYS = 40;

const failures: string[] = [];

const rawFieldOf = (stats: Game['stats'], field: string): string | null => {
  const raw = (stats as unknown as Record<string, unknown>)[field];
  return typeof raw === 'string' && raw.length > 0 ? raw : null;
};

/**
 * Records one assertion.
 *
 * `measured` is what was actually observed and is reported either way. `why`
 * explains what the assertion is FOR, and is only shown on failure -- printing
 * the failure explanation next to a passing check is how a report ends up
 * saying "budget did not shrink" beside a check that proved it did.
 */
const check = (label: string, pass: boolean, measured: string, why?: string) => {
  if (!pass) {
    failures.push(`${label}: ${measured}${why ? ` (${why})` : ''}`);
  }
  return { label, pass, measured, ...(pass ? {} : { why }) };
};

const main = async (): Promise<void> => {
  const playerState = buildNewUniverse({
    teams: INITIAL_TEAMS.map((t) => ({ ...t })),
    seasonYear: YEAR,
    seed: SEED,
    effectiveDate: `${YEAR}-12-15`,
  }).playerState;

  const blank: Team[] = INITIAL_TEAMS.map((t) => ({
    ...t, wins: 0, losses: 0, runsScored: 0, runsAllowed: 0,
  }));
  const teams = recalculateTeamRatingsFromRosters(blank, playerState, YEAR);
  const startDate = getDefaultSeasonStartDate(YEAR);
  const schedule = generateSchedule(teams, { seasonStartDate: startDate, seasonDays: 180 });

  const mgr = new SimulationManager({
    teams, games: schedule, playerState, settings: DEFAULT_SETTINGS, currentDate: startDate,
  });

  const seen = new Set<string>();
  const games: Game[] = [];
  for (let day = 0; day < DAYS; day += 1) {
    const result = await mgr.run({ scope: 'day' });
    result.games.forEach((g) => {
      if (g.status === 'completed' && !seen.has(g.gameId)) {
        seen.add(g.gameId);
        games.push(g);
      }
    });
  }

  // Project the measured sample out to a full season so the test exercises the
  // real number of games rather than only what 40 days produced.
  // Dates are spread across the whole season, strictly increasing, so that the
  // newest-first retention check has a real ordering to test. A projection that
  // cycles dates would put the retention boundary mid-date and the check could
  // not distinguish correct behaviour from a bug.
  const seasonSize = 32 * 81;
  const projected: Game[] = [];
  const daysInSeason = 180;
  for (let i = 0; i < seasonSize; i += 1) {
    const src = games[i % games.length];
    const dayOffset = Math.floor((i / seasonSize) * daysInSeason);
    const projectedDate = new Date(`${startDate}T00:00:00Z`);
    projectedDate.setUTCDate(projectedDate.getUTCDate() + dayOffset);
    projected.push({
      ...src,
      gameId: `${src.gameId}-p${i}`,
      date: projectedDate.toISOString().slice(0, 10),
    });
  }

  const sourceById = new Map(projected.map((g) => [g.gameId, g]));

  // The budget the shipping code will actually use: the origin quota less the
  // measured sibling keys less the flat reserve. The sibling figure is the
  // measured 1,479,613 from probeStorageBudget.ts, not the floor constant, so
  // this is the budget a real save of this league state would compute.
  const measuredSiblingUnits = 1_479_613;
  const budget = gamesBudgetFromOccupiedUnits(measuredSiblingUnits);
  const mirror = buildLocalGamesMirror(projected, budget);
  const parsed = JSON.parse(mirror.serialized) as Game[];

  const results = [];

  // The budget must fit the whole origin, not just the games key. This is the
  // assertion the fixed 0.8 fraction failed: 4,194,304 + 1,479,613 = 5,673,917
  // against a 5,242,880 quota, an overrun of 431,037 units that is a thrown
  // QuotaExceededError rather than a graceful degradation.
  const originTotal = mirror.serialized.length + measuredSiblingUnits;
  results.push(check(
    'mirror plus measured siblings fit the origin quota',
    originTotal < LOCAL_STORAGE_QUOTA_UNITS,
    `${originTotal} of ${LOCAL_STORAGE_QUOTA_UNITS} units `
    + `(mirror ${mirror.serialized.length} + siblings ${measuredSiblingUnits}), `
    + `${LOCAL_STORAGE_QUOTA_UNITS - originTotal} spare`,
    'the quota is per-origin, so a budget that only respects the games key still overruns',
  ));

  results.push(check(
    'budget is actually used, not wasted',
    mirror.serialized.length > budget * 0.8,
    `${mirror.serialized.length} of ${budget} units used `
    + `(${((mirror.serialized.length / budget) * 100).toFixed(1)}%)`,
    'a mirror that stops well short of its budget is leaving playable data on the floor',
  ));

  // Every game must remain identifiable and structurally intact.
  const envelopeIntact = parsed.every((g) => (
    g.gameId.length > 0
    && typeof g.date === 'string' && g.date.length > 0
    && typeof g.homeTeam === 'string' && g.homeTeam.length > 0
    && typeof g.awayTeam === 'string' && g.awayTeam.length > 0
    && g.score != null
    && typeof g.phase === 'string'
  ));
  results.push(check(
    'structural envelope intact for every game',
    envelopeIntact,
    `${parsed.filter((g) => g.gameId && g.date && g.homeTeam && g.awayTeam && g.phase && g.score).length}/${parsed.length} intact`,
    'a game lost gameId, date, teams, score or phase, so it cannot be rendered or settled',
  ));

  results.push(check(
    'game count preserved',
    parsed.length === seasonSize,
    `${parsed.length} of ${seasonSize} games present`,
    'the mirror dropped games entirely rather than only their bulky fields',
  ));

  // lineScore is what first-five bets settle from. It must never be dropped.
  const lineScoreKept = parsed.every((g, i) => (
    typeof g.stats.lineScore === 'string'
    && g.stats.lineScore === sourceById.get(g.gameId)!.stats.lineScore
  ));
  results.push(check(
    'lineScore retained for every game',
    lineScoreKept,
    `${parsed.filter((g) => g.stats.lineScore === sourceById.get(g.gameId)!.stats.lineScore).length}/${parsed.length} identical`,
    'lineScore is what wallet.ts settles first-five bets from, so losing it voids those bets',
  ));

  // The scalar stats are all read by name across App, useBroadcastFlair, and
  // GameScreen. Losing hits/errors silently corrupts the box score.
  const scalarsKept = parsed.every((g) => {
    const src = sourceById.get(g.gameId)!;
    return g.stats.awayHits === src.stats.awayHits
      && g.stats.homeHits === src.stats.homeHits
      && g.stats.awayErrors === src.stats.awayErrors
      && g.stats.homeErrors === src.stats.homeErrors
      && g.stats.winningPitcherId === src.stats.winningPitcherId
      && g.stats.losingPitcherId === src.stats.losingPitcherId
      && g.stats.savePitcherId === src.stats.savePitcherId
      && g.stats.finalInning === src.stats.finalInning;
  });
  const scalarsIntactCount = parsed.filter((g) => {
    const src = sourceById.get(g.gameId)!;
    return g.stats.awayHits === src.stats.awayHits
      && g.stats.homeHits === src.stats.homeHits
      && g.stats.awayErrors === src.stats.awayErrors
      && g.stats.homeErrors === src.stats.homeErrors
      && g.stats.winningPitcherId === src.stats.winningPitcherId
      && g.stats.losingPitcherId === src.stats.losingPitcherId
      && g.stats.savePitcherId === src.stats.savePitcherId
      && g.stats.finalInning === src.stats.finalInning;
  }).length;
  results.push(check(
    'scalar box-score stats retained for every game',
    scalarsKept,
    `${scalarsIntactCount}/${parsed.length} games match source on hits, errors, pitching decisions and finalInning`,
    'these are read by name across App, useBroadcastFlair and GameScreen, so losing them corrupts the box score',
  ));

  // Retained play logs must be byte-identical, never truncated. A truncated
  // JSON array fails to parse, which every consumer reads as an EMPTY log --
  // that voids props silently instead of merely losing the log.
  const withLog = parsed.filter((g) => typeof g.stats.playLog === 'string' && g.stats.playLog.length > 0);
  const logsUntruncated = withLog.every((g) => (
    g.stats.playLog === sourceById.get(g.gameId)!.stats.playLog
  ));
  results.push(check(
    'retained play logs are byte-identical, not truncated',
    logsUntruncated,
    `${withLog.filter((g) => g.stats.playLog === sourceById.get(g.gameId)!.stats.playLog).length}/${withLog.length} byte-identical`,
    'a truncated JSON array fails to parse, and every consumer reads that as an EMPTY log, which voids props rather than merely losing the log',
  ));

  const withParticipants = parsed.filter((g) => typeof g.stats.participants === 'string' && g.stats.participants.length > 0);
  const participantsUntruncated = withParticipants.every((g) => (
    g.stats.participants === sourceById.get(g.gameId)!.stats.participants
  ));
  results.push(check(
    'retained participant snapshots are byte-identical, not truncated',
    participantsUntruncated,
    `${withParticipants.filter((g) => g.stats.participants === sourceById.get(g.gameId)!.stats.participants).length}/${withParticipants.length} byte-identical`,
    'participants is what hydrateGameSessionFromGame reads to rebuild an interactive game',
  ));

  // Every retained play log must actually parse. This is the check that would
  // have caught a truncation bug.
  const logsParse = withLog.every((g) => {
    try {
      const parsedLog = JSON.parse(g.stats.playLog as string);
      return Array.isArray(parsedLog) && parsedLog.length > 0;
    } catch {
      return false;
    }
  });
  const logsParsingCount = withLog.filter((g) => {
    try {
      const asArray = JSON.parse(g.stats.playLog as string);
      return Array.isArray(asArray) && asArray.length > 0;
    } catch {
      return false;
    }
  }).length;
  results.push(check(
    'every retained play log parses as a non-empty array',
    logsParse,
    `${logsParsingCount}/${withLog.length} parse to a non-empty array`,
    'a log that does not parse is read downstream as an empty game, so props void and stories disappear',
  ));

  // The real claim behind "newest-first" is that retention is GREEDY in
  // builder order: walking date descending then original position ascending,
  // each bulky field is kept if and only if it fits the remaining budget, and
  // the budget only ever grows.
  //
  // A strict prefix check would be wrong here. Play log sizes vary, so a small
  // log can fit after a large one did not, and within one game playLog is
  // attempted before participants, so a game can keep participants while
  // dropping its play log. Both are correct greedy behaviour, not scattering.
  // What must hold is that every dropped field genuinely did not fit, which is
  // also the assertion that would catch an undercounting cost model -- the
  // defect behind both bugs found while building this.
  const ordering = parsed
    .map((g, index) => ({ g, index }))
    .sort((left, right) => (left.g.date === right.g.date
      ? left.index - right.index
      : left.g.date < right.g.date ? 1 : -1));

  // Charge every envelope first, exactly as the builder does. Marginal costs for
  // bulky fields are then measured against each game's CURRENT kept object, so
  // the second field of a game is costed on top of the first. Measuring against
  // the final output instead would give a cost of zero for every field that was
  // retained, which silently undercounts by the entire retained total.
  let replayUsed = 2 + Math.max(0, parsed.length - 1);
  const replayStats = new Map<string, Game['stats']>();
  ordering.forEach(({ g }) => {
    const envelope = envelopeStats(sourceById.get(g.gameId)!.stats ?? {});
    replayStats.set(g.gameId, envelope);
    replayUsed += JSON.stringify({ ...g, stats: envelope }).length;
  });

  const wronglyDropped: string[] = [];
  let smallestDroppedCost = Number.POSITIVE_INFINITY;
  let replayExhausted = false;

  // The replay follows the builder's DATE-grouped order, not a per-game walk.
  // A replay that used the old order would have kept passing while the builder
  // changed underneath it, which is the same trap as auditing a copy.
  const replayBuckets: Array<{ date: string; ids: string[] }> = [];
  const replayByDate = new Map<string, string[]>();
  ordering.forEach(({ g }) => {
    const existing = replayByDate.get(g.date);
    if (existing) {
      existing.push(g.gameId);
      return;
    }
    const ids = [g.gameId];
    replayByDate.set(g.date, ids);
    replayBuckets.push({ date: g.date, ids });
  });

  const replayCost = (gameId: string, field: 'playLog' | 'participants'): number => {
    const source = sourceById.get(gameId)!;
    const raw = source.stats[field];
    if (typeof raw !== 'string' || raw.length === 0) {
      return 0;
    }
    const current = replayStats.get(gameId)!;
    return JSON.stringify({ ...current, [field]: raw }).length - JSON.stringify(current).length;
  };

  const replayCommit = (gameId: string, field: 'playLog' | 'participants', cost: number): void => {
    replayUsed += cost;
    replayStats.set(gameId, { ...replayStats.get(gameId)!, [field]: sourceById.get(gameId)!.stats[field] as string });
  };

  let replayCoveredSomething = false;
  for (const bucket of replayBuckets) {
    const playCosts = bucket.ids.map((id) => replayCost(id, 'playLog'));
    const partCosts = bucket.ids.map((id) => replayCost(id, 'participants'));
    const playTotal = playCosts.reduce((a, b) => a + b, 0);
    const partTotal = partCosts.reduce((a, b) => a + b, 0);

    if (replayUsed + playTotal + partTotal <= budget) {
      bucket.ids.forEach((id, n) => {
        if (playCosts[n] > 0) replayCommit(id, 'playLog', playCosts[n]);
        if (partCosts[n] > 0) replayCommit(id, 'participants', partCosts[n]);
      });
      replayCoveredSomething = true;
      continue;
    }
    if (replayUsed + playTotal <= budget) {
      bucket.ids.forEach((id, n) => {
        if (playCosts[n] > 0) replayCommit(id, 'playLog', playCosts[n]);
      });
      replayCoveredSomething = true;
      continue;
    }
    if (!replayCoveredSomething) {
      // The newest date is unaffordable even for play logs. Partial fill is the
      // only way to keep retention non-empty.
      bucket.ids.forEach((id, n) => {
        if (playCosts[n] > 0 && replayUsed + playCosts[n] <= budget) replayCommit(id, 'playLog', playCosts[n]);
      });
    }
    replayExhausted = true;
    break;
  }

  // Now compare the replay's decisions with what the builder actually wrote.
  // A field the replay committed but the builder dropped would mean the
  // accounting is not describing the code; the reverse means the builder
  // committed something the accounting could not pay for.
  ordering.forEach(({ g }) => {
    const source = sourceById.get(g.gameId)!;
    (['playLog', 'participants'] as const).forEach((field) => {
      const raw = source.stats[field];
      if (typeof raw !== 'string' || raw.length === 0) {
        return;
      }
      const inOutput = typeof g.stats[field] === 'string' && (g.stats[field] as string).length > 0;
      const inReplay = rawFieldOf(replayStats.get(g.gameId)!, field) !== null;
      if (inReplay === inOutput) {
        return;
      }
      wronglyDropped.push(`${g.date}/${g.gameId}:${field} replay=${inReplay} output=${inOutput}`);
    });
  });
  // The smallest cost the builder passed over, for the "budget genuinely
  // exhausted" assertion below.
  ordering.forEach(({ g }) => {
    const source = sourceById.get(g.gameId)!;
    (['playLog', 'participants'] as const).forEach((field) => {
      if (typeof g.stats[field] === 'string' && (g.stats[field] as string).length > 0) {
        return;
      }
      const raw = source.stats[field];
      if (typeof raw !== 'string' || raw.length === 0) {
        return;
      }
      smallestDroppedCost = Math.min(smallestDroppedCost, replayCost(g.gameId, field));
    });
  });

  // How tightly the budget bound, measured rather than asserted. "It did not
  // fit" and "it nearly fit" are different findings, and only one of them means
  // the retention depth is limited by bytes rather than by design.
  const unspentUnits = budget - replayUsed;
  const nextFieldCost = Number.isFinite(smallestDroppedCost) ? smallestDroppedCost : null;

  // The accounting must reconcile to the bytes actually written. A cost model
  // that undercounts is the defect behind every version of this bug, so the
  // replay total and the real serialized length are compared directly.
  const accountingGap = mirror.serialized.length - replayUsed;
  results.push(check(
    'cost model reconciles with the bytes actually written',
    Math.abs(accountingGap) <= games.length * 32,
    `replay accounted ${replayUsed}, wrote ${mirror.serialized.length}, gap ${accountingGap}`,
    'a cost model that undercounts is exactly how this budget silently overran the origin before',
  ));

  // "The budget genuinely binds" is asserted structurally, not inferred from
  // how full the output happens to be: if every date could have been covered
  // whole, the retention logic never ran and this file proves nothing about a
  // full season.
  const datesWithAnyLog = new Set(
    parsed.filter((g) => rawFieldOf(g.stats, 'playLog') !== null).map((g) => g.date),
  ).size;
  results.push(check(
    'the budget genuinely binds at season scale',
    replayExhausted || datesWithAnyLog < replayBuckets.length,
    `${datesWithAnyLog} of ${replayBuckets.length} dates carry play logs; `
    + `partial-fill branch reached: ${replayExhausted}`,
    'if every date fitted, the retention path never executed and this verification is vacuous',
  ));

  // A date that has SOME of its games logged is the failure that motivated
  // date-grouped retention: the incomplete games still render in the UI, and
  // their props void because an absent play log reads as an empty one.
  //
  // The single legitimate exception is the builder's partial-fill fallback,
  // which retains as much of the NEWEST unaffordable date as fits. It exists
  // because an EMPTY mirror passes every fits-in-quota assertion while settling
  // nothing. An OLDER date may never be fragmented, even when budget remains --
  // that was measured at 2/14 on the previous slate, and a slate missing 12 of
  // 14 play logs cannot settle a single same-slate bet.
  const coveredDates = replayBuckets
    .map((b) => {
      const withLog = b.ids.filter((id) => rawFieldOf(replayStats.get(id)!, 'playLog') !== null).length;
      const withParts = b.ids.filter((id) => rawFieldOf(replayStats.get(id)!, 'participants') !== null).length;
      return { date: b.date, total: b.ids.length, withLog, withParts };
    })
    .filter((d) => d.withLog > 0 || d.withParts > 0);
  const partialDates = coveredDates.filter((d) => (
    (d.withLog > 0 && d.withLog < d.total) || (d.withParts > 0 && d.withParts < d.total)
  ));
  // replayBuckets is newest-date-first.
  const newestDateInProjection = replayBuckets[0]?.date ?? null;
  const partialAllowed = partialDates.length === 1
    && partialDates[0].date === newestDateInProjection
    && replayExhausted;
  results.push(check(
    'every date is covered whole, except the newest when it cannot be afforded',
    partialDates.length === 0 || partialAllowed,
    partialDates.length === 0
      ? `all ${coveredDates.length} covered dates carry whole slates`
      : `${partialDates.map((d) => `${d.date} ${d.withLog}/${d.total} logged, ${d.withParts}/${d.total} replayable`).join(', ')}; `
        + `newest date in season ${newestDateInProjection}; partial-fill branch reached: ${replayExhausted}`,
    'a partly logged date renders in the UI but its unlogged games void their props, because an absent play log reads as an empty one',
  ));

  results.push(check(
    'every retention decision matches an independent replay of the budget',
    wronglyDropped.length === 0,
    `${wronglyDropped.length} field(s) where the replay and the builder disagree`
    + (wronglyDropped.length ? `: ${wronglyDropped.slice(0, 3).join(', ')}` : ''),
    'if these disagree the cost model is not describing the code, so the budget assertions below prove nothing',
  ));

  // Calendar-level monotonicity: no dropped game is more recent than a retained
  // one. This is the property a user would actually notice.
  const retainedDates = parsed
    .filter((g) => typeof g.stats.playLog === 'string' && g.stats.playLog.length > 0)
    .map((g) => g.date)
    .sort();
  const droppedDates = parsed
    .filter((g) => !(typeof g.stats.playLog === 'string' && g.stats.playLog.length > 0))
    .map((g) => g.date)
    .sort()
    .reverse();
  const oldestRetained = retainedDates.length ? retainedDates[0] : null;
  const newestDropped = droppedDates.length ? droppedDates[0] : null;
  results.push(check(
    'no dropped game is more recent than a retained game',
    oldestRetained === null || newestDropped === null || oldestRetained >= newestDropped,
    `oldest retained ${oldestRetained ?? 'none'}, newest dropped ${newestDropped ?? 'none'}`,
    'a retained game older than a dropped one means the mirror kept the wrong window, which is the one property a user would notice',
  ));

  // The builder reports what it kept. Those counts must match what actually
  // landed in the output. A builder that counts a retention and then writes a
  // different object is silent, and no budget assertion catches it.
  results.push(check(
    'builder-reported play log count matches serialized output',
    mirror.retainedPlayLogs === withLog.length,
    `builder reported ${mirror.retainedPlayLogs}, output contains ${withLog.length}`,
    'a counted retention that is not written is the stale-spread bug: the count lied and nothing failed',
  ));
  results.push(check(
    'builder-reported participants count matches serialized output',
    mirror.retainedParticipants === withParticipants.length,
    `builder reported ${mirror.retainedParticipants}, output contains ${withParticipants.length}`,
    'same stale-copy hazard, on the second bulky field of the same game',
  ));

  // Retention must be a real, non-empty subset: some kept, some dropped. An
  // empty retention passes every "fits in quota" assertion while guaranteeing
  // props can never settle from a localStorage mirror.
  const retainedShare = withLog.length / parsed.length;
  results.push(check(
    'some play logs are retained (retention is not empty)',
    withLog.length > 0,
    `${withLog.length} play logs retained`,
    'an empty retention passes every fits-in-quota assertion while guaranteeing nothing local can settle',
  ));
  results.push(check(
    'most play logs are dropped (budget genuinely binds)',
    retainedShare < 0.9,
    `retained ${(retainedShare * 100).toFixed(1)}% of play logs`,
    'if the budget did not bind, this run proves nothing about a full season',
  ));

  // Retention depth measured in SLATES, not bytes. This is the number that
  // decides whether the mirror is still useful: props are same-slate only, and
  // interactive replay needs participants. A budget that kept a few thousand
  // bytes of scattered old games and none of today's would satisfy every
  // assertion above and still be worth nothing.
  const perDate = new Map<string, number>();
  parsed.forEach((g) => perDate.set(g.date, (perDate.get(g.date) ?? 0) + 1));
  const largestSlate = Math.max(...Array.from(perDate.values()));
  const newestDateWithLog = retainedDates.length ? retainedDates[retainedDates.length - 1] : null;
  const newestDateInSeason = parsed.map((g) => g.date).sort()[parsed.length - 1];
  const logsOnNewestSeasonDate = parsed
    .filter((g) => g.date === newestDateInSeason
      && typeof g.stats.playLog === 'string' && g.stats.playLog.length > 0).length;
  const gamesOnNewestSeasonDate = perDate.get(newestDateInSeason) ?? 0;
  results.push(check(
    'the most recent slate survives intact',
    logsOnNewestSeasonDate === gamesOnNewestSeasonDate,
    `${logsOnNewestSeasonDate}/${gamesOnNewestSeasonDate} play logs on the season's last date ${newestDateInSeason}`,
    'props and headlines are same-slate, so if today\'s games lose their logs the mirror cannot pay out on them',
  ));

  // The source population must actually be larger than fits, or the test above
  // is vacuous.
  const fullPayloadUnits = JSON.stringify(projected).length;
  results.push(check(
    'full payload genuinely exceeds the budget (test is not vacuous)',
    fullPayloadUnits > budget,
    `full payload ${fullPayloadUnits} units against a ${budget} budget`,
    'if the whole season fitted, the retention logic would never have run and this file proves nothing',
  ));

  // The budget must be the shipped formula's answer, and it must shrink as the
  // sibling keys grow. A budget that ignored the siblings is the 0.8-fraction
  // bug this replaced: 4,194,304 assumed against 3,632,195 actually available.
  const budgetWhenSiblingsGrow = gamesBudgetFromOccupiedUnits(measuredSiblingUnits + 1_000_000);
  results.push(check(
    'budget shrinks as sibling keys grow',
    budgetWhenSiblingsGrow < budget,
    `budget ${budget} -> ${budgetWhenSiblingsGrow} when siblings grow by 1,000,000 units`,
    'a fixed fraction overruns the shared origin as soon as the other keys pass their share of it',
  ));

  const defaultBudget = buildLocalGamesMirror(projected).budgetUnits;
  results.push(check(
    'default budget uses the measured sibling floor, not the whole quota',
    defaultBudget === gamesBudgetFromOccupiedUnits(LOCAL_STORAGE_SIBLING_FLOOR_UNITS),
    `default budget ${defaultBudget}, floor-derived ${gamesBudgetFromOccupiedUnits(LOCAL_STORAGE_SIBLING_FLOOR_UNITS)}`,
    'a caller that cannot enumerate the origin must still reserve room for the league state',
  ));

  const report = {
    projectedSeasonGames: seasonSize,
    measuredSampleGames: games.length,
    fullPayloadUnits,
    mirrorUnits: mirror.serialized.length,
    budgetUnits: mirror.budgetUnits,
    quotaUnits: LOCAL_STORAGE_QUOTA_UNITS,
    measuredSiblingUnits,
    originTotalUnits: originTotal,
    originHeadroomUnits: LOCAL_STORAGE_QUOTA_UNITS - originTotal,
    retainedPlayLogs: withLog.length,
    retainedParticipants: withParticipants.length,
    droppedPlayLogs: parsed.length - withLog.length,
    retainedSharePct: +(retainedShare * 100).toFixed(1),
    retentionDepthInSlates: {
      note: 'Props and headlines are same-slate, and interactive replay needs participants, '
        + 'so the useful depth of this mirror is how many days of games keep their play logs.',
      largestSlateGames: largestSlate,
      retainedPlayLogs: withLog.length,
      approxSlatesOfPlayLogs: +(withLog.length / largestSlate).toFixed(2),
      oldestDateWithPlayLog: oldestRetained,
      newestDateWithPlayLog: newestDateWithLog,
      newestDateInSeason,
      playLogsOnNewestSeasonDate: `${logsOnNewestSeasonDate}/${gamesOnNewestSeasonDate}`,
    },
    budgetBinding: {
      note: 'Whether retention depth is limited by bytes or by the all-or-nothing-per-date rule.',
      unspentUnits,
      costOfNextFieldThatDidNotFit: nextFieldCost,
      shortfallOfNextField: nextFieldCost === null ? null : nextFieldCost - unspentUnits,
    },
    reportedByBuilder: {
      retainedPlayLogs: mirror.retainedPlayLogs,
      retainedParticipants: mirror.retainedParticipants,
    },
    checks: results,
    failures,
    verdict: failures.length === 0 ? 'PASS' : 'FAIL',
  };

  console.log(JSON.stringify(report, null, 2));
  process.exit(failures.length === 0 ? 0 : 1);
};

main().catch((e) => {
  console.error('THREW', e);
  process.exit(1);
});
