import {
  BULLPEN_ROSTER_SLOTS,
  Player,
  PlayerBattingRatings,
  PlayerPitchingRatings,
  PlayerSeasonBatting,
  PlayerSeasonPitching,
  PlayerTransaction,
  RosterSlotCode,
  STARTING_PITCHER_SLOTS,
  Team,
  TeamRosterSlot,
} from '../types';
import { getPreferredBattingStatsByPlayerId, getPreferredPitchingStatsByPlayerId } from './playerStats';
import { parseOffseasonMeta } from './offseasonFreeAgency';

export interface FreeAgencyOfferCard {
  team: Team;
  slotCode: RosterSlotCode;
  slotLabel: string;
  interest: number;
  contractYears: number;
  incumbentName: string | null;
  incumbentOverall: number | null;
  isQualifyingOffer: boolean;
  note: string;
}

export interface FreeAgentMarketEntry {
  player: Player;
  overall: number;
  batting: PlayerBattingRatings | null;
  pitching: PlayerPitchingRatings | null;
  battingStat: PlayerSeasonBatting | null;
  pitchingStat: PlayerSeasonPitching | null;
  marketValue: number;
  offers: FreeAgencyOfferCard[];
}

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

const getLatestSeasonYear = (rosterSlots: TeamRosterSlot[]): number =>
  rosterSlots.length > 0 ? Math.max(...rosterSlots.map((slot) => slot.seasonYear)) : new Date().getUTCFullYear();

const getWinPct = (team: Team): number => {
  const gamesPlayed = team.wins + team.losses;
  return gamesPlayed > 0 ? team.wins / gamesPlayed : 0;
};

const getLatestBattingRatings = (ratings: PlayerBattingRatings[]): Map<string, PlayerBattingRatings> => {
  const next = new Map<string, PlayerBattingRatings>();
  [...ratings].sort((left, right) => right.seasonYear - left.seasonYear).forEach((rating) => {
    if (!next.has(rating.playerId)) next.set(rating.playerId, rating);
  });
  return next;
};

const getLatestPitchingRatings = (ratings: PlayerPitchingRatings[]): Map<string, PlayerPitchingRatings> => {
  const next = new Map<string, PlayerPitchingRatings>();
  [...ratings].sort((left, right) => right.seasonYear - left.seasonYear).forEach((rating) => {
    if (!next.has(rating.playerId)) next.set(rating.playerId, rating);
  });
  return next;
};

const getRosterSlotLabel = (slotCode: RosterSlotCode): string => {
  if (slotCode.startsWith('SP')) return 'Rotation';
  if (slotCode.startsWith('RP')) return 'Bullpen';
  if (slotCode === 'CL') return 'Closer';
  return `${slotCode} lineup`;
};

const getBattingFormValue = (stat: PlayerSeasonBatting | null): number => {
  if (!stat || stat.atBats < 25) return 0;
  const avgBoost = clamp((stat.avg - 0.245) * 220, -10, 14);
  const opsBoost = clamp((stat.ops - 0.72) * 30, -8, 12);
  const powerBoost = clamp(stat.homeRuns * 0.35, 0, 8);
  return avgBoost + opsBoost + powerBoost;
};

const getPitchingFormValue = (stat: PlayerSeasonPitching | null): number => {
  if (!stat || stat.inningsPitched < 12) return 0;
  const eraBoost = clamp((4.15 - stat.era) * 3.2, -10, 14);
  const whipBoost = clamp((1.28 - stat.whip) * 16, -8, 10);
  const strikeoutBoost = clamp(stat.strikeouts / Math.max(stat.inningsPitched, 1) * 6 - 4.5, -4, 6);
  return eraBoost + whipBoost + strikeoutBoost;
};

const getMarketValue = (entry: Omit<FreeAgentMarketEntry, 'marketValue' | 'offers'>): number =>
  entry.player.playerType === 'pitcher'
    ? entry.overall + getPitchingFormValue(entry.pitchingStat) - Math.max(entry.player.age - 32, 0) * 0.6
    : entry.overall + getBattingFormValue(entry.battingStat) - Math.max(entry.player.age - 33, 0) * 0.55;

const getOfferContractYears = (player: Player, overall: number): number => {
  if (player.age <= 24) return overall >= 80 ? 5 : 4;
  if (player.age <= 27) return overall >= 78 ? 5 : 4;
  if (player.age <= 30) return overall >= 82 ? 4 : 3;
  if (player.age <= 33) return overall >= 80 ? 3 : 2;
  if (player.age <= 36) return 2;
  return 1;
};

interface PersistedQualifyingOffer {
  teamId: string;
  contractYears: number;
}

/**
 * The LATEST release per player, indexed once.
 *
 * `resolvePersistedQualifyingOffer` used to `filter` the whole transaction log for one player and
 * then copy-and-sort what came back to read its first element. Called once per free agent, that is
 * O(free agents x transactions) per market build -- and the log only ever grows, so it got steadily
 * worse every month of a season. It was the largest single item of JavaScript self time in a CPU
 * profile of three simulated days: 9.2% of all samples (`tools/profileSimCpu.mjs`).
 *
 * Built once per market build, and it keeps only the LATEST release per player rather than all of
 * them, so each lookup is O(1) and the map is bounded by the number of players rather than by the
 * number of transactions.
 *
 * `effectiveDate` is compared as a string, which is safe because it is an ISO date written by this
 * app and so sorts identically lexically and chronologically. A tie on the date keeps the first
 * release seen, which is what the previous stable sort produced for equal keys.
 */
const indexLatestReleases = (
  transactions: PlayerTransaction[],
): Map<string, PlayerTransaction> => {
  const latestByPlayerId = new Map<string, PlayerTransaction>();
  for (const transaction of transactions) {
    if (transaction.eventType !== 'released') continue;
    const current = latestByPlayerId.get(transaction.playerId);
    if (!current || transaction.effectiveDate > current.effectiveDate) {
      latestByPlayerId.set(transaction.playerId, transaction);
    }
  }
  return latestByPlayerId;
};

const resolvePersistedQualifyingOffer = (
  playerId: string,
  latestReleaseByPlayerId: Map<string, PlayerTransaction>,
): PersistedQualifyingOffer | null => {
  const latestRelease = latestReleaseByPlayerId.get(playerId) ?? null;

  if (!latestRelease) {
    return null;
  }

  const meta = parseOffseasonMeta(latestRelease.notes);
  if (!meta || meta.qoDecision !== 'declined') {
    return null;
  }

  const previousTeamId = latestRelease.fromTeamId;
  if (!previousTeamId || !meta.qoTeamId || meta.qoTeamId !== previousTeamId) {
    return null;
  }

  return {
    teamId: previousTeamId,
    contractYears: meta.qoYears && meta.qoYears > 0 ? meta.qoYears : 1,
  };
};

const upsertQualifyingOffer = (
  offers: FreeAgencyOfferCard[],
  freeAgent: Omit<FreeAgentMarketEntry, 'offers'> & { marketValue: number },
  persistedQualifyingOffer: PersistedQualifyingOffer | null,
  teams: Team[],
  slotIndex: Map<string, TeamRosterSlot>,
  playersById: Map<string, Player>,
  battingRatingsByPlayerId: Map<string, PlayerBattingRatings>,
  pitchingRatingsByPlayerId: Map<string, PlayerPitchingRatings>,
): FreeAgencyOfferCard[] => {
  if (!persistedQualifyingOffer) {
    return offers.map((offer) => ({ ...offer, isQualifyingOffer: false }));
  }

  const qualifyingTeam = teams.find((team) => team.id === persistedQualifyingOffer.teamId) ?? null;
  if (!qualifyingTeam) {
    return offers.map((offer) => ({ ...offer, isQualifyingOffer: false }));
  }

  const candidateSlots =
    freeAgent.player.primaryPosition === 'SP'
      ? STARTING_PITCHER_SLOTS
      : freeAgent.player.primaryPosition === 'RP'
        ? BULLPEN_ROSTER_SLOTS.filter((slot) => slot !== 'CL')
        : freeAgent.player.primaryPosition === 'CL'
          ? ['CL']
          : [freeAgent.player.primaryPosition];

  const slotCode = candidateSlots[0];
  if (!slotCode) {
    return offers;
  }
  const slot = slotAt(slotIndex, qualifyingTeam.id, slotCode);
  const incumbent = slot ? playersById.get(slot.playerId) ?? null : null;
  const incumbentOverall = incumbent
    ? battingRatingsByPlayerId.get(incumbent.playerId)?.overall ?? pitchingRatingsByPlayerId.get(incumbent.playerId)?.overall ?? 0
    : 0;

  const qualifyingOfferInterest = clamp(
    Math.round(70 + Math.max(freeAgent.overall - 70, 0) * 1.1 + Math.max(freeAgent.marketValue - 72, 0) * 0.65),
    72,
    99,
  );

  const qualifyingOffer: FreeAgencyOfferCard = {
    team: qualifyingTeam,
    slotCode: slotCode as RosterSlotCode,
    slotLabel: getRosterSlotLabel(slotCode as RosterSlotCode),
    interest: qualifyingOfferInterest,
    contractYears: persistedQualifyingOffer.contractYears,
    incumbentName: incumbent ? `${incumbent.firstName} ${incumbent.lastName}` : null,
    incumbentOverall: incumbent ? incumbentOverall : null,
    isQualifyingOffer: true,
    note: `${qualifyingTeam.city} hold qualifying-offer rights as ${freeAgent.player.lastName}'s previous club.`,
  };

  const sanitizedOffers = offers.map((offer) => ({ ...offer, isQualifyingOffer: false }));
  const nonQualifyingOffers = sanitizedOffers.filter((offer) => offer.team.id !== qualifyingOffer.team.id);
  const merged = [qualifyingOffer, ...nonQualifyingOffers]
    .sort((left, right) => right.interest - left.interest);

  const topSix = merged.slice(0, 6);
  if (topSix.some((offer) => offer.isQualifyingOffer)) {
    return topSix;
  }

  return [...topSix.slice(0, 5), qualifyingOffer]
    .sort((left, right) => right.interest - left.interest);
};

/**
 * Roster slots by `teamId` + `slotCode`, for O(1) occupancy lookups.
 *
 * THE SCAN THIS REPLACED WAS THE LARGEST HOTSPOT IN THE APP. Every offer decision asked "is this
 * slot filled?" with `activeRosterSlots.find((entry) => entry.teamId === team.id && entry.slotCode
 * === slotCode)`. That is a linear scan of every roster slot in the league -- around 800 rows for 32
 * clubs -- repeated for every club times every slot the player could fill, for every free agent. At
 * 32 clubs, ~5 compatible slots and 24 free agents that is roughly THREE MILLION string comparisons
 * per market build, on the main thread, on every simulated day.
 *
 * Measured, not guessed: `tools/profileSimCpu.mjs` put `freeAgencyLogic.ts` at 9.1% of all self time
 * across three simulated days, by a wide margin the largest JS contributor in the app. Indexing once
 * per market build turns those three million comparisons into about 800 map inserts.
 *
 * The key uses a NUL separator rather than a colon because both parts are app-controlled ids and a
 * delimiter collision would silently merge two different slots into one entry.
 *
 * A duplicate (team, slot) pair keeps the LAST one, matching `Array.prototype.find`, which returns
 * the first. Roster data is one row per slot so this cannot arise in practice; it is stated because
 * the two implementations disagree and a reader should know which way.
 */
const rosterSlotsByTeamAndSlot = (slots: TeamRosterSlot[]): Map<string, TeamRosterSlot> => {
  const index = new Map<string, TeamRosterSlot>();
  for (const slot of slots) {
    index.set(`${slot.teamId}\u0000${slot.slotCode}`, slot);
  }
  return index;
};

const slotAt = (
  index: Map<string, TeamRosterSlot>,
  teamId: string,
  slotCode: string,
): TeamRosterSlot | null => index.get(`${teamId}\u0000${slotCode}`) ?? null;

const buildOfferBoard = (
  freeAgent: Omit<FreeAgentMarketEntry, 'offers'> & { marketValue: number },
  persistedQualifyingOffer: PersistedQualifyingOffer | null,
  teams: Team[],
  slotIndex: Map<string, TeamRosterSlot>,
  playersById: Map<string, Player>,
  battingRatingsByPlayerId: Map<string, PlayerBattingRatings>,
  pitchingRatingsByPlayerId: Map<string, PlayerPitchingRatings>,
): FreeAgencyOfferCard[] => {
  const candidateSlots =
    freeAgent.player.primaryPosition === 'SP'
      ? STARTING_PITCHER_SLOTS
      : freeAgent.player.primaryPosition === 'RP'
        ? BULLPEN_ROSTER_SLOTS.filter((slot) => slot !== 'CL')
        : freeAgent.player.primaryPosition === 'CL'
          ? ['CL']
          : [freeAgent.player.primaryPosition];

  const results: FreeAgencyOfferCard[] = [];

  teams.forEach((team) => {
    let bestOffer: FreeAgencyOfferCard | null = null;

    candidateSlots.forEach((rawSlotCode) => {
      const slotCode = rawSlotCode as RosterSlotCode;
      const slot = slotAt(slotIndex, team.id, slotCode);
      const incumbent = slot ? playersById.get(slot.playerId) ?? null : null;
      const incumbentOverall = incumbent
        ? battingRatingsByPlayerId.get(incumbent.playerId)?.overall ?? pitchingRatingsByPlayerId.get(incumbent.playerId)?.overall ?? 0
        : 0;
      const vacancyBonus = slot ? 0 : 26;
      const weaknessBonus = Math.max(0, 76 - incumbentOverall) * 1.7;
      const upgradeBonus = Math.max(0, freeAgent.overall - incumbentOverall) * 2.35;
      const marketBonus = Math.max(0, freeAgent.marketValue - 72) * 1.25;
      const competitiveBonus = getWinPct(team) * 12;
      const score = vacancyBonus + weaknessBonus + upgradeBonus + marketBonus + competitiveBonus;

      if (score < 34) return;

      const interest = clamp(Math.round(28 + score * 0.82), 0, 99);
      const note = vacancyBonus > 0
        ? `${team.city} have an open ${getRosterSlotLabel(slotCode).toLowerCase()} and can move immediately.`
        : incumbentOverall <= 70
          ? `${team.city} see a weak spot at ${slotCode} and would cut the current option for an upgrade.`
          : `${team.city} view ${freeAgent.player.lastName} as a meaningful talent bump over ${incumbent?.lastName ?? 'their current option'} at ${slotCode}.`;

      const candidate: FreeAgencyOfferCard = {
        team,
        slotCode,
        slotLabel: getRosterSlotLabel(slotCode),
        interest,
        contractYears: getOfferContractYears(freeAgent.player, freeAgent.overall),
        incumbentName: incumbent ? `${incumbent.firstName} ${incumbent.lastName}` : null,
        incumbentOverall: incumbent ? incumbentOverall : null,
        isQualifyingOffer: false,
        note,
      };

      if (!bestOffer || candidate.interest > bestOffer.interest) bestOffer = candidate;
    });

    if (bestOffer) results.push(bestOffer);
  });

  const rankedOffers = results.sort((left, right) => right.interest - left.interest).slice(0, 6);
  // Even fringe players need a destination in automatic-market mode. If no
  // club cleared the normal interest threshold, use the weakest compatible
  // roster spot as a low-interest fallback offer.
  if (rankedOffers.length === 0 && teams.length > 0) {
    const fallback = teams.flatMap((team) => candidateSlots.map((rawSlotCode) => {
      const slotCode = rawSlotCode as RosterSlotCode;
      const slot = slotAt(slotIndex, team.id, slotCode);
      const incumbent = slot ? playersById.get(slot.playerId) ?? null : null;
      const incumbentOverall = incumbent
        ? battingRatingsByPlayerId.get(incumbent.playerId)?.overall ?? pitchingRatingsByPlayerId.get(incumbent.playerId)?.overall ?? 0
        : 0;
      return { team, slotCode, incumbent, incumbentOverall };
    }))
      .sort((left, right) => left.incumbentOverall - right.incumbentOverall || left.team.id.localeCompare(right.team.id))[0];
    if (fallback) {
      rankedOffers.push({
        team: fallback.team,
        slotCode: fallback.slotCode,
        slotLabel: getRosterSlotLabel(fallback.slotCode),
        interest: 1,
        contractYears: getOfferContractYears(freeAgent.player, freeAgent.overall),
        incumbentName: fallback.incumbent ? `${fallback.incumbent.firstName} ${fallback.incumbent.lastName}` : null,
        incumbentOverall: fallback.incumbent ? fallback.incumbentOverall : null,
        isQualifyingOffer: false,
        note: `${fallback.team.city} are the best available fallback fit for ${freeAgent.player.lastName}.`,
      });
    }
  }
  return upsertQualifyingOffer(
    rankedOffers,
    freeAgent,
    persistedQualifyingOffer,
    teams,
    slotIndex,
    playersById,
    battingRatingsByPlayerId,
    pitchingRatingsByPlayerId,
  );
};

export const buildFreeAgencyMarketEntries = (
  teams: Team[],
  players: Player[],
  battingRatings: PlayerBattingRatings[],
  pitchingRatings: PlayerPitchingRatings[],
  battingStats: PlayerSeasonBatting[],
  pitchingStats: PlayerSeasonPitching[],
  rosterSlots: TeamRosterSlot[],
  transactions: PlayerTransaction[] = [],
): FreeAgentMarketEntry[] => {
  const playersById = new Map(players.map((player) => [player.playerId, player]));
  const battingRatingsByPlayerId = getLatestBattingRatings(battingRatings);
  const pitchingRatingsByPlayerId = getLatestPitchingRatings(pitchingRatings);
  const battingStatsByPlayerId = getPreferredBattingStatsByPlayerId(battingStats, 'regular_season');
  const pitchingStatsByPlayerId = getPreferredPitchingStatsByPlayerId(pitchingStats, 'regular_season');
  const latestSeasonYear = getLatestSeasonYear(rosterSlots);
  const activeRosterSlots = rosterSlots.filter((slot) => slot.seasonYear === latestSeasonYear);
  // Two indexes built once per market build, shared by every free agent below.
  // See `indexLatestReleases` and `rosterSlotsByTeamAndSlot`.
  const latestReleaseByPlayerId = indexLatestReleases(transactions);
  const slotIndex = rosterSlotsByTeamAndSlot(activeRosterSlots);

  const baseEntries = players.filter((player) => player.status === 'free_agent').map((player) => {
    const batting = battingRatingsByPlayerId.get(player.playerId) ?? null;
    const pitching = pitchingRatingsByPlayerId.get(player.playerId) ?? null;
    const overall = batting?.overall ?? pitching?.overall ?? 0;
    const battingStat = battingStatsByPlayerId.get(player.playerId) ?? null;
    const pitchingStat = pitchingStatsByPlayerId.get(player.playerId) ?? null;
    return { player, overall, batting, pitching, battingStat, pitchingStat };
  });

  return baseEntries
    .map((entry) => {
      const marketValue = getMarketValue(entry);
      return {
        ...entry,
        marketValue,
        offers: buildOfferBoard(
          { ...entry, marketValue },
          resolvePersistedQualifyingOffer(entry.player.playerId, latestReleaseByPlayerId),
          teams,
          slotIndex,
          playersById,
          battingRatingsByPlayerId,
          pitchingRatingsByPlayerId,
        ),
      };
    })
    .sort((left, right) => {
      return right.marketValue - left.marketValue || right.overall - left.overall || left.player.lastName.localeCompare(right.player.lastName);
    });
};
