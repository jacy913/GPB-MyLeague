import {
  BULLPEN_ROSTER_SLOTS,
  Player,
  PlayerBattingRatings,
  PlayerPitchingRatings,
  PlayerSeasonBatting,
  PlayerSeasonPitching,
  RosterSlotCode,
  STARTING_PITCHER_SLOTS,
  Team,
  TeamRosterSlot,
} from '../types';
import { getPreferredBattingStatsByPlayerId, getPreferredPitchingStatsByPlayerId } from './playerStats';

export interface FreeAgencyOfferCard {
  team: Team;
  slotCode: RosterSlotCode;
  slotLabel: string;
  interest: number;
  contractYears: number;
  incumbentName: string | null;
  incumbentOverall: number | null;
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

const buildOfferBoard = (
  freeAgent: Omit<FreeAgentMarketEntry, 'offers'> & { marketValue: number },
  teams: Team[],
  activeRosterSlots: TeamRosterSlot[],
  playersById: Map<string, Player>,
  battingRatingsByPlayerId: Map<string, PlayerBattingRatings>,
  pitchingRatingsByPlayerId: Map<string, PlayerPitchingRatings>,
): FreeAgencyOfferCard[] => {
  if (freeAgent.marketValue < 72 || freeAgent.overall < 68) return [];

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

    candidateSlots.forEach((slotCode) => {
      const slot = activeRosterSlots.find((entry) => entry.teamId === team.id && entry.slotCode === slotCode) ?? null;
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
        note,
      };

      if (!bestOffer || candidate.interest > bestOffer.interest) bestOffer = candidate;
    });

    if (bestOffer) results.push(bestOffer);
  });

  return results.sort((left, right) => right.interest - left.interest).slice(0, 6);
};

export const buildFreeAgencyMarketEntries = (
  teams: Team[],
  players: Player[],
  battingRatings: PlayerBattingRatings[],
  pitchingRatings: PlayerPitchingRatings[],
  battingStats: PlayerSeasonBatting[],
  pitchingStats: PlayerSeasonPitching[],
  rosterSlots: TeamRosterSlot[],
): FreeAgentMarketEntry[] => {
  const playersById = new Map(players.map((player) => [player.playerId, player]));
  const battingRatingsByPlayerId = getLatestBattingRatings(battingRatings);
  const pitchingRatingsByPlayerId = getLatestPitchingRatings(pitchingRatings);
  const battingStatsByPlayerId = getPreferredBattingStatsByPlayerId(battingStats, 'regular_season');
  const pitchingStatsByPlayerId = getPreferredPitchingStatsByPlayerId(pitchingStats, 'regular_season');
  const latestSeasonYear = getLatestSeasonYear(rosterSlots);
  const activeRosterSlots = rosterSlots.filter((slot) => slot.seasonYear === latestSeasonYear);

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
          teams,
          activeRosterSlots,
          playersById,
          battingRatingsByPlayerId,
          pitchingRatingsByPlayerId,
        ),
      };
    })
    .sort((left, right) => {
      const offerGap = right.offers.length - left.offers.length;
      if (offerGap !== 0) return offerGap;
      return right.overall - left.overall || left.player.lastName.localeCompare(right.player.lastName);
    });
};
