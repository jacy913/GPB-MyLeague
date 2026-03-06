export type OffseasonEventKey = 'awards' | 'lottery' | 'draft' | 'free_agency';

const OFFSEASON_EVENT_DAY_BY_KEY: Record<OffseasonEventKey, string> = {
  awards: '11-02',
  lottery: '11-05',
  draft: '11-08',
  free_agency: '11-06',
};

export interface OffseasonEventSchedule {
  seasonYear: number;
  awardsDate: string;
  lotteryDate: string;
  draftDate: string;
  freeAgencyDate: string;
}

export const getOffseasonEventDate = (
  seasonYear: number,
  key: OffseasonEventKey,
): string => `${seasonYear}-${OFFSEASON_EVENT_DAY_BY_KEY[key]}`;

export const buildOffseasonEventSchedule = (seasonYear: number): OffseasonEventSchedule => ({
  seasonYear,
  awardsDate: getOffseasonEventDate(seasonYear, 'awards'),
  lotteryDate: getOffseasonEventDate(seasonYear, 'lottery'),
  draftDate: getOffseasonEventDate(seasonYear, 'draft'),
  freeAgencyDate: getOffseasonEventDate(seasonYear, 'free_agency'),
});
