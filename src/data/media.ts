/*
 * The eight forecasters.
 *
 * `MediaId` is the key type for `Record<MediaId, ...>` in several modules -- outcome scales,
 * scores, spreads, slopes -- so widening it makes the compiler surface every place that has to
 * learn about a new forecaster. That is the point: the alternative is discovering a missing
 * key at runtime, on the first game a new outlet is asked to price.
 */
export type MediaId =
  | 'hollis' | 'glorest' | 'sharply'
  | 'sallow' | 'jardins' | 'boyle' | 'mussad' | 'wardley';

/*
 * The eight forecasting methods.
 *
 * Widened 2026-10-02 for the HXSE expansion. Every one of these is a key into `SCORERS` in
 * `lib/mediaReads.ts`, which is typed `Record<MediaMethod, ...>` -- so adding a member here
 * makes the compiler demand a real read function for it. That is the mechanism that stops a
 * widened union becoming five stubs that all return the same number, which is what "extend
 * every dispatch site" would otherwise mean in practice.
 *
 * The first five are the original three plus the five new forecasters. Their names describe how
 * each one arrives at a number, not how confident it is.
 */
export type MediaMethod =
  | 'advanced'          // Hollis   -- latent quality, weighted toward what a club IS
  | 'conventional'      // Glorest  -- what a club has actually DONE
  | 'attention'         // Sharply  -- what a crowd is looking at
  | 'systematic'        // Sallow   -- the fitted base rate, no editorial tilt
  | 'contrarian'        // Jardins  -- the inverse of the crowd
  | 'beat'              // Boyle    -- deep on one division, near-blind outside it
  | 'macro'             // Mussad   -- the league, not the clubs
  | 'scout';            // Wardley  -- organizational depth and development curve

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
  /**
   * Whether `confidence` was measured or guessed.
   *
   * This exists because `confidence` stopped being decoration. It is now the WEIGHT that
   * `weightedConsensus` in `lib/markets.ts` gives this forecaster's opinion, so a guessed value
   * is no longer a cosmetic guess -- it moves the house price.
   *
   * The five new forecasters arrive with plausible-looking provisional numbers. Shipping those
   * into the arithmetic would be exactly the failure this project keeps paying for: a number
   * that looks like a measurement and is not one, driving something real. So the state is a
   * field on the type rather than a comment, `tools/checkMediaProfiles.ts` reads it, and it
   * cannot be forgotten by editing a comment.
   *
   * Step 5 of the HXSE build -- re-fitting all eight slopes and confidences with
   * `tools/fitMediaOdds.ts` -- is what turns these from `provisional` to `fitted`. Until then
   * this flag is the honest record.
   */
  confidenceStatus: 'fitted' | 'provisional';
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
    confidenceStatus: 'fitted',
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
    confidenceStatus: 'fitted',
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
    confidenceStatus: 'fitted',
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
{
    /*
     * 4 -- THE REFERENCE MODEL
     *
     * A pure fitted feed with a human's name on it.
     *
     * Every other outlet in this file is a character: they tilt, they argue, they have an
     * audience. Sallow is the control condition. He publishes what the fit produces and declines
     * to have an opinion about it, which makes him the only forecaster whose number can be used
     * as a baseline for measuring the other seven.
     *
     * He is the reason the other seven can be traded against each other. Without a forecaster who
     * is definitionally unbiased, every disagreement is just seven people disagreeing. With him, a
     * gap is a signal.
     */
    id: 'sallow',
    name: 'Gary Sallow',
    outlet: 'Baseline Analytics',
    role: 'Automated Read',
    thesis:
      'He runs the fit and publishes it. Nothing he posts is an opinion, which is precisely why everything else he publishes is worth measuring against.',
    weakness:
      'No narrative layer at all. He cannot price a trade, an injury, or a dugout change, because none of those reach his inputs. He reacts to news late and gets caught by it every single time, and he will tell you so before you notice.',
    /*
      * PROVISIONAL, and it is a weight now.
      *
      * This is not the 0.86 the draft proposed. `weightedConsensus` gives this number the
      * influence in the house line, and shipping a guessed 0.86 as if it were the best-calibrated
      * forecaster in the league would be inventing a result and then pricing with it.
      *
      * It is set LOW on purpose. A low provisional weight means the five new opinions enter the
      * consensus gently, so the eight-outlet league is not built on five guesses, and it is
      * replaced by a fitted value in step 5. The character of the outlet -- the most reliable
      * read in the league -- is carried by his `method` and his read function, not by a number
      * nobody has measured.
      */
    confidence: 0.55,
    confidenceStatus: 'provisional',
    method: 'systematic',
    methodLabel: 'Fitted base rate',
    weights: [
      { label: 'Pythagorean expectation', weight: 0.4 },
      { label: 'Run differential', weight: 0.3 },
      { label: 'Team rating', weight: 0.2 },
      { label: 'Home field', weight: 0.1 },
    ],
    voice: [
      'That is the number the fit produces. I have no view on it beyond that.',
      'I am not going to tell you I called it. The model called it, and the model is not taking credit.',
      'Three variables are significant. The other nine are noise, and I have removed them.',
      'You are asking me for an opinion. I do not have one. I have a distribution.',
    ],
    accent: 'sallow',
  },
  {
    /*
     * 5 -- THE CONTRARIAN
     *
     * The most profitable forecaster in the game, and the most dangerous one to model.
     *
     * The temptation is to fit her against the other forecasters, which would score beautifully
     * and prove nothing -- "predict the inverse of consensus" is a strategy, and if it is allowed
     * to define truth it becomes a rigged game rather than a market. She must be fitted against
     * independently computed truth, the same as everyone else. See step 5 of the HXSE build.
     *
     * Expect her genuine edge to be small. That is the correct outcome. A contrarian who is
     * reliably right is not a contrarian, she is a certainty, and certainty in a market this
     * noisy is a liability dressed as an edge. She is valuable because she is spectacular roughly
     * twice a season and wrong in long stretches between.
     *
     * Her weakness is written to be exploitable on purpose: she inverts by reflex rather than by
     * analysis, so when the crowd is right she is confidently wrong for months. Fading her when
     * she fades everyone is a real, learnable, second-order play.
     */
    id: 'jardins',
    name: 'Audrey Jardins',
    outlet: 'The Other Side',
    role: 'Independent Columnist',
    thesis:
      'When seven people agree on a team, one of them is about to be wrong, and it is almost never the team they are praising.',
    weakness:
      'She inverts by reflex rather than by analysis, so when the consensus is right she is confidently wrong for months at a stretch. The reflex is also partly performance — she has an audience that pays her to be contrary, which means contrarianism is sometimes her point rather than her conclusion.',
    /*
      * PROVISIONAL and deliberately mid-range.
      *
      * The draft proposed 0.62. A contrarian's fitted confidence is the single most likely number
      * in this file to be wrong in either direction, and the draft itself says so: fit her
      * against independent truth and expect a small result. Shipping 0.62 now would assert a
      * precision nobody has. 0.52 keeps her present in the pool without making her either an
      * oracle or a rounding error.
      */
    confidence: 0.52,
    confidenceStatus: 'provisional',
    method: 'contrarian',
    methodLabel: 'Crowd inversion',
    weights: [
      { label: 'What the market overprices', weight: 0.4 },
      { label: 'Roster quality', weight: 0.25 },
      { label: 'Recent form', weight: 0.2 },
      { label: 'Home field', weight: 0.15 },
    ],
    voice: [
      'Six people love this team. I am the seventh. That is not a personality, that is a position.',
      'I have been wrong about this club for four months and I expect to be wrong about it for four more. Ask me why.',
      'You want to know what I think? I think the thing everybody likes is already priced.',
      'Do not follow me. Fade me. That is the entire strategy, and so far it has worked twice.',
    ],
    accent: 'jardins',
  },
  {
    /*
     * 6 -- THE BEAT
     *
     * Regional differentiation -- the forecaster that makes different teams behave differently.
     *
     * Every other outlet here prices all thirty-two clubs on the same basis, which means each of
     * them pushes every team in roughly the same direction at the same time. Boyle is the
     * exception. He knows one division intimately, and his opinion should move his own teams
     * measurably more than it moves everyone else's.
     *
     * That asymmetry is the point. It is what lets a bettor find a team whose price has moved for
     * a reason only one forecaster in the league can explain.
     *
     * NOTE ON CONFIDENCE, and it is a real limitation rather than a note: his confidence is
     * almost certainly not global. He should be well-calibrated on his own division and close to
     * worthless outside it, and a single scalar cannot express that. The honest fix is a
     * per-market confidence that depends on whether the market is in his beat. It is NOT papered
     * over here with one number -- his read function applies the beat asymmetry to the READ, and
     * step 5 is where the scalar has to be faced.
     */
    id: 'boyle',
    name: 'Landon Boyle',
    outlet: 'The Inning Order',
    role: 'Division Beat',
    thesis:
      'Thirty-two clubs is too many to know and eight is plenty. He knows his division down to which catcher gets benched against a lefty, and he prices all the others anyway.',
    weakness:
      'Near-blind outside his division, and he does not know that. He applies the same confidence to a team he has never watched as to one he has followed for six years, and he will be wrong with total conviction.',
    confidence: 0.5,
    confidenceStatus: 'provisional',
    method: 'beat',
    methodLabel: 'Division beat knowledge',
    weights: [
      { label: 'Lineup quality', weight: 0.3 },
      { label: 'Bullpen availability', weight: 0.25 },
      { label: 'Manager tendencies', weight: 0.2 },
      { label: 'Home field', weight: 0.15 },
      { label: 'Recent form', weight: 0.1 },
    ],
    voice: [
      'I have been to nine of their home games. I know which catcher they sit against a lefty. What does your statistician know?',
      'Their third starter has thrown forty innings and none of them were good. Read the number, not the name on the jersey.',
      'I do not have an opinion about the other twenty-four clubs. I have a preference about the eight I cover.',
      'They are not better than you. They are just better-informed about you, right now.',
    ],
    accent: 'boyle',
  },
  {
    /*
     * 7 -- THE MACRO DESK
     *
     * The only forecaster here who does not cover teams.
     *
     * Mussad prices the league rather than the clubs, which makes him the source of beta: when
     * his view moves, all thirty-two teams move together. He is the reason the market has a
     * market-wide risk a bettor can observe, and the reason "my team beat the index" is a
     * statement that means something.
     *
     * NOTE ON MEASUREMENT: his Brier score is not comparable to the others' if it is measured on
     * game outcomes. He should be scored on SEASON outcomes -- final run environment, playoff
     * rate, league-wide bullpen performance -- because that is the horizon he trades on. Scoring
     * him per-game will make him look bad and will not be true.
     *
     * A NOTE ON WHAT THIS MEANS FOR HIS READ, which is a genuine tension and not a bug:
     *
     * A macro forecaster cannot produce a differentiated team ordering. That is what "he does
     * not cover teams" means. But the read pipeline normalises every outlet's scores into a
     * ranking, so a perfectly flat read would be a degenerate one -- every club tied, and the
     * outlier detector unable to find one.
     *
     * What his read function does instead is tilt each team by its EXPOSURE to the environment he
     * is pricing, which keeps him nearly flat (he is beta) while leaving him well-defined. The
     * flatness is the character; the small tilt is what stops him being a divide-by-zero. Both
     * are deliberate and both are commented at the function.
     */
    id: 'mussad',
    name: 'Tariq Mussad',
    outlet: 'Baseline Macro',
    role: 'League Environment Desk',
    thesis:
      'He does not cover teams. He covers the league they all play in, which moves every one of them and is why the market has a direction at all.',
    weakness:
      'Slow. He is describing a season, not a week, so his view is directionally useful over months and actively unhelpful over days — which is most of a baseball season. He will be right about October in April and useless on a Tuesday.',
    confidence: 0.5,
    confidenceStatus: 'provisional',
    method: 'macro',
    methodLabel: 'League environment',
    weights: [
      { label: 'League run environment', weight: 0.35 },
      { label: 'Bullpen depth, league-wide', weight: 0.25 },
      { label: 'Aging curve', weight: 0.2 },
      { label: 'Roster construction', weight: 0.2 },
    ],
    voice: [
      'Every club in this league plays the same park, the same rules, and the same air in October. You are watching the wrong variable.',
      'This is not a two-week story. Nothing in this league has been decided by anything that happened this week.',
      'The run environment is the tide. Every team in here is a boat. I am telling you the water level.',
      'You want to know who won tonight. I want to know what this league looks like in September.',
    ],
    accent: 'mussad',
  },
  {
    /*
     * 8 -- THE SCOUT
     *
     * The only forecaster whose opinion is about the future rather than the present, and the
     * only one who can be right in September about something that happens in three years.
     *
     * Wardley prices organizational depth -- the farm system, the development curve, the age
     * profile -- which makes him the forecaster most likely to disagree violently with the other
     * seven during a rebuild and be the only one who was right.
     *
     * His weakness predicts his own behaviour, which is what makes him a character rather than a
     * statistic: a bust costs him years of standing, so he overcorrects and holds prospects
     * longer than he should. A bettor who can see that coming can trade it.
     */
    id: 'wardley',
    name: 'Vance Wardley Jr.',
    outlet: 'Farm System',
    role: 'Organizational Analyst',
    thesis:
      'The season everyone is watching was decided two years ago on a scouting sheet, by people who were not in the room when it happened.',
    weakness:
      'A bust costs him years of standing, so he overcorrects and holds prospects past the point where he should abandon them. He will tell you a prospect is ready long after the evidence has turned, because admitting he was early is the one thing he cannot afford.',
    confidence: 0.5,
    confidenceStatus: 'provisional',
    method: 'scout',
    methodLabel: 'Organizational depth',
    weights: [
      { label: 'Farm system grade', weight: 0.35 },
      { label: 'Development trajectory', weight: 0.3 },
      { label: 'Age curve', weight: 0.2 },
      { label: 'Current roster surplus', weight: 0.15 },
    ],
    voice: [
      'That club has three twenty-two-year-olds who have not had a big-league at-bat. Two of them are worth more than your shortstop.',
      'I said he would be a second-division starter by twenty-five. I said it two years ago and nobody wrote it down.',
      'You are looking at his batting average. I am looking at his age, his plate discipline, and the organization that developed him.',
      'Draft slot is a price. It is not a prophecy. We treat it like a prophecy and then we act surprised every June.',
    ],
    accent: 'wardley',
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
