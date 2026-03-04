import { PlayerPosition, PlayerStatus } from '../types';

type RandomSource = () => number;

type PhysicalBaseline = {
  heightInches: number;
  weightLbs: number;
};

const PITCHER_BASELINE: PhysicalBaseline = {
  heightInches: 74.75,
  weightLbs: 210.66,
};

const POSITION_BASELINES: Record<PlayerPosition, PhysicalBaseline> = {
  C: { heightInches: 72.5, weightLbs: 211.45 },
  '1B': { heightInches: 74.25, weightLbs: 221.78 },
  '2B': { heightInches: 71.25, weightLbs: 191.37 },
  '3B': { heightInches: 72.75, weightLbs: 202.11 },
  SS: { heightInches: 72.5, weightLbs: 190.22 },
  LF: { heightInches: 73, weightLbs: 202.94 },
  CF: { heightInches: 73.5, weightLbs: 198.68 },
  RF: { heightInches: 73.25, weightLbs: 207.28 },
  DH: { heightInches: 74, weightLbs: 223.33 },
  SP: PITCHER_BASELINE,
  RP: PITCHER_BASELINE,
  CL: PITCHER_BASELINE,
};

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

const sampleNormalish = (mean: number, standardDeviation: number, rng: RandomSource): number => {
  const centered = (rng() + rng() + rng() + rng() + rng() + rng() - 3) / 1.5;
  return mean + centered * standardDeviation;
};

export const formatHeightImperial = (heightInches: number): string => {
  const feet = Math.floor(heightInches / 12);
  const inches = heightInches % 12;
  return `${feet}'${inches}"`;
};

export const getGeneratedContractYearsLeft = (
  status: PlayerStatus,
  age: number,
  rng: RandomSource,
): number => {
  if (status === 'free_agent' || status === 'retired') {
    return 0;
  }
  if (status === 'prospect') {
    return clamp(3 + Math.floor(rng() * 3), 1, 5);
  }
  const veteranPenalty = age >= 34 ? 1 : 0;
  return clamp(1 + Math.floor(rng() * 5) - veteranPenalty, 1, 5);
};

export const generatePlayerBio = (
  primaryPosition: PlayerPosition,
  status: PlayerStatus,
  age: number,
  rng: RandomSource,
): { height: string; weightLbs: number; contractYearsLeft: number } => {
  const baseline = POSITION_BASELINES[primaryPosition];
  const heightStdDev = primaryPosition === 'SP' || primaryPosition === 'RP' || primaryPosition === 'CL' ? 1.8 : 1.5;
  const weightStdDev = primaryPosition === 'C' || primaryPosition === '1B' || primaryPosition === 'DH' ? 14 : 12;
  const sampledHeight = clamp(Math.round(sampleNormalish(baseline.heightInches, heightStdDev, rng)), 67, 81);
  const adjustedWeightMean = baseline.weightLbs + (sampledHeight - baseline.heightInches) * 6;
  const sampledWeight = clamp(Math.round(sampleNormalish(adjustedWeightMean, weightStdDev, rng)), 160, 295);

  return {
    height: formatHeightImperial(sampledHeight),
    weightLbs: sampledWeight,
    contractYearsLeft: getGeneratedContractYearsLeft(status, age, rng),
  };
};

export const getFallbackPlayerBio = (
  primaryPosition: PlayerPosition,
  status: PlayerStatus,
  age: number,
): { height: string; weightLbs: number; contractYearsLeft: number } => {
  const baseline = POSITION_BASELINES[primaryPosition];
  const roundedHeight = Math.round(baseline.heightInches);
  const roundedWeight = Math.round(baseline.weightLbs);

  return {
    height: formatHeightImperial(roundedHeight),
    weightLbs: roundedWeight,
    contractYearsLeft:
      status === 'free_agent' || status === 'retired'
        ? 0
        : status === 'prospect'
          ? 4
          : age >= 34
            ? 2
            : 3,
  };
};
