export type MediaId = 'hollis' | 'glorest' | 'sharply';

export type MediaMethod = 'advanced' | 'conventional' | 'attention';

export interface MediaWeights {
  /** Human-readable input labels paired with their contribution. */
  label: string;
  weight: number;
}

export interface MediaProfile {
  id: MediaId;
  name: string;
  outlet: string;
  /** Short role label shown under the name. */
  role: string;
  /** The one-line argument for why this outlet exists. */
  thesis: string;
  /** Stated plainly, because a forecaster you cannot audit is not usable. */
  weakness: string;
  /**
   * How confident this outlet is. Deliberately not 1.0 for anyone, and lowest
   * for the attention-driven read, which is the whole point of it. Feeds the
   * error bar shown on the page and later the width of the published line.
   */
  confidence: number;
  method: MediaMethod;
  methodLabel: string;
  weights: MediaWeights[];
  /** Sample lines in the outlet's own register. */
  voice: string[];
  /** Identity colour token family, resolved in index.css. */
  accent: string;
}

/**
 * The three forecasters.
 *
 * These are the only place media identity is defined. Each one reads the league
 * a different way, and the difference is carried in the arithmetic rather than
 * in the prose: see lib/mediaReads.ts. The prose exists to make the arithmetic
 * legible, not the other way round.
 *
 * The three reads are computed independently and then compared, never averaged
 * into a single view. A consensus would erase the disagreement, and the
 * disagreement is the useful part -- it is where a betting line would later be
 * sharpest and where the least popular opinion tends to be right.
 */
export const MEDIA_PROFILES: MediaProfile[] = [
  {
    id: 'hollis',
    name: 'Quincy Hollis',
    outlet: 'The Booth',
    role: 'League Correspondent',
    thesis:
      'Twenty years in the press box. Rates a club by what it is made of rather than what it has done, which means he is rarely wrong and rarely interesting.',
    weakness:
      'Slow. He rates a rebuilt roster well before anyone else can see it, and rates a sudden collapse well after everyone else already knows.',
    confidence: 0.84,
    method: 'advanced',
    methodLabel: 'Latent team quality',
    weights: [
      { label: 'Roster strength', weight: 0.6 },
      { label: 'Recent form', weight: 0.25 },
      { label: 'Home field', weight: 0.15 },
    ],
    voice: [
      'The results are the scoreboard, not the team. Look at the roster and tell me what you actually expect to watch on a Tuesday.',
      'I do not forecast. I have an opinion about what is likely, and I will show my working.',
      'Everyone saw that one coming except the people who were paid to see it coming.',
      'You can win a lot of games on talent. You can only win a season on talent plus depth, and depth is what nobody watches until it is gone.',
    ],
    accent: 'hollis',
  },
  {
    id: 'glorest',
    name: 'Glorest Press',
    outlet: 'Glorest Sports',
    role: 'Flagship Network',
    thesis:
      'The outlet the whole league agrees with. Wins, runs, ERA, home runs -- the numbers printed on the back of the programme, taken seriously and taken often.',
    weakness:
      'No edge of its own. Its view is very close to the consensus view, so there is rarely a moment where backing or fading it is a clever move.',
    confidence: 0.72,
    method: 'conventional',
    methodLabel: 'Observed season output',
    weights: [
      { label: 'Win percentage', weight: 0.35 },
      { label: 'Run differential', weight: 0.3 },
      { label: 'Team ERA', weight: 0.2 },
      { label: 'Runs scored', weight: 0.15 },
    ],
    voice: [
      'Here is where we are, and here is what it means for your season.',
      'The number is the number. You can like it or argue with it, but it is the number.',
      'We do not trend here. We report, and then we tell you what it means.',
      'That club has won four of five and nobody in this league is still asking why.',
    ],
    accent: 'glorest',
  },
  {
    id: 'sharply',
    name: 'Lined Sharply',
    outlet: 'Lined Sharply Podcast',
    role: 'Two Hosts, No Filter',
    thesis:
      'The loudest voice in the league, and the one most likely to be talking about the team everybody is already talking about.',
    weakness:
      'Overconfident by a wide margin, and the overconfidence clusters exactly where the attention is. Its most emphatic takes are its least reliable.',
    confidence: 0.55,
    method: 'attention',
    methodLabel: 'Attention and momentum',
    weights: [
      { label: 'Popularity', weight: 0.5 },
      { label: 'Best player on the roster', weight: 0.25 },
      { label: 'Current streak', weight: 0.25 },
    ],
    voice: [
      'We are not saying this is a playoff team. We are saying nobody wants to play this team right now.',
      'Listen. The whole league saw it. The only question is how early you called it.',
      'Hot, and getting hotter, and I will not be taking questions on that.',
      'I have been saying this for six weeks and I was right six weeks ago.',
    ],
    accent: 'sharply',
  },
];

export const MEDIA_BY_ID: Record<MediaId, MediaProfile> = MEDIA_PROFILES.reduce(
  (accumulator, profile) => {
    accumulator[profile.id] = profile;
    return accumulator;
  },
  {} as Record<MediaId, MediaProfile>,
);

/** Accent CSS custom property for a medium, for use in inline styles. */
export const mediaAccentVar = (id: MediaId): string => `var(--color-media-${id})`;
