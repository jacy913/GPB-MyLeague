import { Team } from '../types';

const NEUTRAL_RATING = 50;
const NEUTRAL_BASELINE_WINS = 77;

const createTeam = (
  id: string,
  city: string,
  name: string,
  league: 'Platinum' | 'Prestige',
  division: 'North' | 'South' | 'East' | 'West',
  _rating: number,
  _previousBaselineWins: number
): Team => ({
  id,
  city,
  name,
  league,
  division,
  rating: NEUTRAL_RATING,
  previousBaselineWins: NEUTRAL_BASELINE_WINS,
  wins: 0,
  losses: 0,
  runsScored: 0,
  runsAllowed: 0,
});

export const INITIAL_TEAMS: Team[] = [
  // --- PLATINUM LEAGUE ---
  // North
  createTeam('alc', 'Alcondale', 'Aerials', 'Platinum', 'North', 82, 102),
  createTeam('val', 'Vallile', 'Crimsons', 'Platinum', 'North', 56, 78),
  createTeam('luf', 'Luffenkreg', 'Shields', 'Platinum', 'North', 58, 80),
  createTeam('hui', 'Huidor', 'Shepherds', 'Platinum', 'North', 52, 74),

  // South
  createTeam('ara', 'Arabay', 'Marines', 'Platinum', 'South', 66, 86),
  createTeam('des', 'Desseldein', 'Muskets', 'Platinum', 'South', 80, 98),
  createTeam('suk', 'Sukensi', 'Prawns', 'Platinum', 'South', 50, 72),
  createTeam('gar', 'Garsollo', 'Mustangs', 'Platinum', 'South', 54, 76),

  // West
  createTeam('gra', 'Grandland', 'Cobalts', 'Platinum', 'West', 78, 96),
  createTeam('tru', 'Trusceland', 'Apes', 'Platinum', 'West', 74, 92),
  createTeam('caf', 'Calfein', 'Phantoms', 'Platinum', 'West', 57, 79),
  createTeam('rag', 'Ragnahas', 'Crows', 'Platinum', 'West', 55, 77),

  // East
  createTeam('win', 'Wingten', 'Generals', 'Platinum', 'East', 68, 88),
  createTeam('aub', 'Aubagne', 'Vipers', 'Platinum', 'East', 85, 105),
  createTeam('dwi', 'Dwifdern', 'Hooves', 'Platinum', 'East', 60, 82),
  createTeam('hou', 'Houssen', 'Brazens', 'Platinum', 'East', 53, 75),

  // --- PRESTIGE LEAGUE ---
  // North
  createTeam('ock', 'Ockshein', 'Nighthawks', 'Prestige', 'North', 50, 74),
  createTeam('bal', 'Baltdorsch', 'Engineers', 'Prestige', 'North', 75, 94),
  createTeam('fes', 'Festor', 'Leopards', 'Prestige', 'North', 70, 90),
  createTeam('urb', 'Urbington', 'Lads', 'Prestige', 'North', 30, 53),

  // South
  createTeam('sin', 'Sinope', 'Seals', 'Prestige', 'South', 72, 94),
  createTeam('loy', 'Loyaton', 'Blacksails', 'Prestige', 'South', 52, 76),
  createTeam('niy', 'Niyoli', 'Reefs', 'Prestige', 'South', 45, 68),
  createTeam('ars', 'Arsagam', 'Dunes', 'Prestige', 'South', 30, 53),

  // West
  createTeam('der', 'Derackdran', 'Electrics', 'Prestige', 'West', 90, 111),
  createTeam('rei', 'Reinland', 'Rogues', 'Prestige', 'West', 40, 66),
  createTeam('fey', 'Feyford', 'Diesels', 'Prestige', 'West', 65, 85),
  createTeam('cal', 'Calukan', 'Agents', 'Prestige', 'West', 40, 66),

  // East
  createTeam('sta', 'Stantral', 'Demons', 'Prestige', 'East', 92, 115),
  createTeam('bra', 'Brasshoem', 'Stripes', 'Prestige', 'East', 32, 51),
  createTeam('geb', 'Gebrook', 'Griffins', 'Prestige', 'East', 38, 62),
  createTeam('and', 'Andrard', 'Smokies', 'Prestige', 'East', 28, 48),
];
