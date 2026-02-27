import { Team } from '../types';

// Helper to generate a random rating centered around 1500 (Elo-like) or 0-100 scale?
// The prompt mentions "strength ratings" and "win_prob (sigmoidal)". 
// Let's assume a scale where 0.5 is average win prob.
// We'll use a 0-100 scale where 50 is average.

const createTeam = (
  id: string,
  city: string,
  name: string,
  league: 'Platinum' | 'Prestige',
  division: 'North' | 'South' | 'East' | 'West',
  rating: number,
  previousBaselineWins: number
): Team => ({
  id,
  city,
  name,
  league,
  division,
  rating,
  previousBaselineWins,
  wins: 0,
  losses: 0,
  runsScored: 0,
  runsAllowed: 0,
});

export const INITIAL_TEAMS: Team[] = [
  // --- PRESTIGE LEAGUE ---
  // North
  createTeam('bal', 'Baltdorsch', 'Engineers', 'Prestige', 'North', 75, 94),
  createTeam('fes', 'Festor', 'Leopards', 'Prestige', 'North', 70, 90),
  createTeam('ock', 'Ockshein', 'Nighthawks', 'Prestige', 'North', 50, 74),
  createTeam('urb', 'Urbington', 'Lads', 'Prestige', 'North', 30, 53),
  
  // South
  createTeam('sin', 'Sinope', 'Seals', 'Prestige', 'South', 72, 94),
  createTeam('loy', 'Loyaton', 'Blacksails', 'Prestige', 'South', 52, 76),
  createTeam('niy', 'Niyoli', 'Reefs', 'Prestige', 'South', 45, 68),
  createTeam('ars', 'Arsagam', 'Dunes', 'Prestige', 'South', 30, 53),
  
  // West
  createTeam('der', 'Derackdran', 'Electrics', 'Prestige', 'West', 90, 111),
  createTeam('fey', 'Feyford', 'Diesels', 'Prestige', 'West', 65, 85),
  createTeam('rei', 'Reinland', 'Rogues', 'Prestige', 'West', 40, 66),
  createTeam('cal', 'Calukan', 'Corsairs', 'Prestige', 'West', 40, 66),
  
  // East
  createTeam('sta', 'Stantral', 'Demons', 'Prestige', 'East', 92, 115),
  createTeam('geb', 'Gebrook', 'Griffins', 'Prestige', 'East', 38, 62),
  createTeam('bra', 'Brasshoem', 'Stripes', 'Prestige', 'East', 32, 51),
  createTeam('and', 'Andrard', 'Smokies', 'Prestige', 'East', 28, 48),

  // --- PLATINUM LEAGUE ---
  // North (Inferred/Invented to balance)
  createTeam('gra', 'Grandland', 'Cobalts', 'Platinum', 'North', 78, 96),
  createTeam('win', 'Wingten', 'Generals', 'Platinum', 'North', 68, 88),
  createTeam('nor', 'Nordvacht', 'Guardians', 'Platinum', 'North', 55, 78), // Invented
  createTeam('ice', 'Icebay', 'Glaciers', 'Platinum', 'North', 35, 60), // Invented

  // South
  createTeam('alc', 'Alcondale', 'Aerials', 'Platinum', 'South', 82, 102),
  createTeam('aub', 'Aubagne', 'Vipers', 'Platinum', 'South', 85, 105),
  createTeam('sou', 'Southshore', 'Sharks', 'Platinum', 'South', 48, 70), // Invented
  createTeam('mar', 'Marino', 'Marlins', 'Platinum', 'South', 42, 65), // Invented

  // West
  createTeam('tru', 'Trusceland', 'Apes', 'Platinum', 'West', 74, 92),
  createTeam('des', 'Desseldein', 'Muskets', 'Platinum', 'West', 80, 98),
  createTeam('wes', 'Westford', 'Wranglers', 'Platinum', 'West', 45, 68), // Invented
  createTeam('can', 'Canyon', 'Coyotes', 'Platinum', 'West', 38, 62), // Invented

  // East
  createTeam('eas', 'Eastport', 'Eagles', 'Platinum', 'East', 60, 81), // Invented
  createTeam('hig', 'Highland', 'Hawks', 'Platinum', 'East', 58, 79), // Invented
  createTeam('riv', 'Riverdale', 'Rangers', 'Platinum', 'East', 50, 72), // Invented
  createTeam('val', 'Valley', 'Vanguards', 'Platinum', 'East', 40, 64), // Invented
];
