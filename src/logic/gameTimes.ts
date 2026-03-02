import { Game } from '../types';

const DAILY_TIME_SLOTS = [
  12 * 60 + 5,
  12 * 60 + 35,
  13 * 60 + 5,
  13 * 60 + 35,
  15 * 60 + 5,
  16 * 60 + 10,
  16 * 60 + 40,
  17 * 60 + 10,
  18 * 60 + 40,
  19 * 60 + 5,
  19 * 60 + 35,
  20 * 60 + 5,
  21 * 60 + 10,
  21 * 60 + 40,
  22 * 60 + 5,
  22 * 60 + 35,
];

const compareGameOrder = (a: Game, b: Game): number => {
  if (a.date !== b.date) {
    return a.date.localeCompare(b.date);
  }
  return a.gameId.localeCompare(b.gameId);
};

export const formatMinutesToTime = (minutes: number): string => {
  const normalized = ((minutes % (24 * 60)) + (24 * 60)) % (24 * 60);
  const hour24 = Math.floor(normalized / 60);
  const minute = normalized % 60;
  const period = hour24 >= 12 ? 'PM' : 'AM';
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  return `${hour12}:${String(minute).padStart(2, '0')} ${period}`;
};

export const getScheduledGameMinutes = (game: Game, games: Game[]): number => {
  const dailyGames = games.filter((item) => item.date === game.date).sort(compareGameOrder);
  const gameIndex = Math.max(
    dailyGames.findIndex((item) => item.gameId === game.gameId),
    0,
  );
  if (gameIndex < DAILY_TIME_SLOTS.length) {
    return DAILY_TIME_SLOTS[gameIndex];
  }

  const overflowIndex = gameIndex - DAILY_TIME_SLOTS.length;
  return DAILY_TIME_SLOTS[DAILY_TIME_SLOTS.length - 1] + (overflowIndex + 1) * 25;
};

export const getScheduledGameTimeLabel = (game: Game, games: Game[]): string =>
  formatMinutesToTime(getScheduledGameMinutes(game, games));

export const getCurrentSimMinutes = (games: Game[], currentDate: string): number | null => {
  const dailyGames = games.filter((game) => game.date === currentDate).sort(compareGameOrder);
  if (dailyGames.length === 0) {
    return null;
  }

  const completedCount = dailyGames.filter((game) => game.status === 'completed').length;
  if (completedCount === 0) {
    return Math.max(getScheduledGameMinutes(dailyGames[0], games) - 25, 11 * 60 + 30);
  }

  if (completedCount >= dailyGames.length) {
    return Math.min(getScheduledGameMinutes(dailyGames[dailyGames.length - 1], games) + 170, 23 * 60 + 55);
  }

  return getScheduledGameMinutes(dailyGames[completedCount], games);
};

export const getCurrentSimTimeLabel = (games: Game[], currentDate: string): string => {
  const minutes = getCurrentSimMinutes(games, currentDate);
  if (minutes === null) {
    return 'No Time';
  }
  return formatMinutesToTime(minutes);
};

export const getGameWindowStatus = (
  game: Game,
  games: Game[],
  currentDate: string,
): 'final' | 'live_window' | 'scheduled' => {
  if (game.status === 'completed') {
    return 'final';
  }

  if (game.date !== currentDate) {
    return 'scheduled';
  }

  const currentMinutes = getCurrentSimMinutes(games, currentDate);
  if (currentMinutes === null) {
    return 'scheduled';
  }

  return currentMinutes >= getScheduledGameMinutes(game, games) ? 'live_window' : 'scheduled';
};
