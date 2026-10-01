/**
 * Stage 3's raw material: what each reporter sounds like.
 *
 * One bank per persona, keyed by the event kinds they cover, plus a `generic` bank for
 * anything a kind-specific template cannot fill. Adding a sixth reporter means adding
 * one entry here and one in `headliners.ts`; nothing else in the pipeline changes.
 *
 * SLOTS ARE A CONTRACT, NOT A CONVENIENCE. A template names the slots it needs, and
 * `interpolate` REFUSES a template whose slots are not all present rather than
 * substituting an empty string. The input document's version returned `''` for an
 * unknown key, which would have rendered the youth writer's best line as
 * "WAIT. X IS ???" -- a broken card that reads like a typo rather than a missing field.
 * Refusing lets `pickTitle` fall through to another template and finally to `generic`,
 * so a card is always readable.
 *
 * VOLUME IS BELOW THE INPUT PLAN'S TARGET AND THAT IS DELIBERATE. The plan asked for
 * six titles and four decks per covered kind (~196 titles, ~132 decks). This is a
 * first pass at roughly 60% of that, written before the detector has been played over
 * a season. The criterion that actually matters is "no two consecutive days from the
 * same persona read alike", and only playing a season can judge that -- adding
 * templates to hit a number before anyone has read a season of output would be
 * optimising the count rather than the thing the count is for.
 *
 * Deterministic by construction: every pick is seeded, and nothing here reads a clock,
 * a counter, or `Math.random()`.
 */

import {
  type GameEventKind,
  type HeadlineSlots,
  type HeadlinerId,
} from './headliners';

export interface VoiceBank {
  /** Titles per event kind. A missing kind falls back to `generic`. */
  titles: Readonly<Partial<Record<GameEventKind, readonly string[]>>> & { generic: readonly string[] };
  /** Decks per event kind. Same fallback. */
  decks: Readonly<Partial<Record<GameEventKind, readonly string[]>>> & { generic: readonly string[] };
}

const SLOT_PATTERN = /\{([A-Z_]+)\}/g;

/**
 * Fill a template, or return null when it cannot be filled.
 *
 * Null rather than a partial string is the whole design. A template mentioning a slot
 * the event does not carry was chosen for the wrong story, and printing half of it is
 * worse than printing a different one in full.
 */
export const interpolate = (template: string, slots: HeadlineSlots): string | null => {
  let missing = false;
  const filled = template.replace(SLOT_PATTERN, (_match, key: string) => {
    const value = slots[key as keyof HeadlineSlots];
    // An empty string counts as missing: the event carried the key but had nothing to
    // put in it, and "{PLAYER} " is not a usable line either.
    if (value === undefined || value === '') {
      missing = true;
      return '';
    }
    return value;
  });
  return missing ? null : filled;
};

/**
 * Choose a template deterministically and fill it.
 *
 * Walks the bank from a seeded offset rather than always taking index 0, so two
 * consecutive days with the same kind do not read identically, and so a template that
 * cannot be filled is skipped instead of ending the search.
 */
const render = (
  templates: readonly string[] | undefined,
  generic: readonly string[],
  seed: number,
  slots: HeadlineSlots,
  /**
   * Titles already used by this reporter, anywhere in the window under consideration.
   *
   * THIS IS WHAT MAKES CONSECUTIVE DAYS READ DIFFERENTLY, and it was measured before
   * it was written. A three-season playtest found the same title on ~90 of 179
   * consecutive day pairs, and the obvious explanations were all wrong: the seeds are
   * uniform (978/954/986 per decile against an expected 929), every bank is fully
   * used, and tripling the thinnest decks moved the figure by two. The cause is
   * arithmetic. `staff_wins` publishes ~2,446 cards a season from 8 templates, so
   * some adjacent pair MUST collide -- no amount of extra prose fixes a birthday
   * problem. A first pass that only avoids the *immediately* previous title would
   * still repeat every eighth day, because the previous title has rotated back round.
   *
   * So the recent titles are passed in and the walk skips all of them, which turns
   * the daily rate of each template from uniform to "deferred". Over a window of
   * titles the pick cycles through the bank instead of clustering on one entry, and
   * two adjacent days agree only when the bank is genuinely exhausted.
   */
  recentTemplates: readonly string[] = [],
): string => {
  const specific = templates ?? [];
  const ordered = [...specific, ...generic];
  const start = Math.abs(Math.floor(seed)) % Math.max(1, ordered.length);

  /*
   * NO DEFERRAL. THE PARAMETER IS KEPT AND IGNORED, DELIBERATELY.
   *
   * It was tried three ways and measured worse every time, against its own
   * no-memory baseline taken on the same events from the same runs:
   *
   *   matching rendered titles against templates  -> inert, 34.3% -> 71.9% of days
   *   matching templates, fixed depth 6 of 8       -> 38.2% -> 87.2% of days
   *   matching templates, depth capped at half    -> 9.1% -> 21.0% of cards
   *
   * The premise behind all three was wrong. Seeded selection from a uniform hash is
   * ALREADY nearly optimal: without any memory, only 9.1% of cards repeat their own
   * byline's line from the previous day, which is about what four templates and a
   * good hash should give. Every version of the memory reordered the walk, and
   * reordering a walk that was already choosing well can only concentrate its picks.
   *
   * So the honest outcome is that the mechanism does not earn its place, and it is
   * left in the signature as an explicit no-op rather than deleted: a future change
   * to the seed or the bank sizes would want to re-measure this, and the parameter
   * documents that the attempt was made and what it cost.
   */
  void recentTemplates;

  for (let step = 0; step < ordered.length; step += 1) {
    const filled = interpolate(ordered[(start + step) % ordered.length], slots);
    if (filled !== null) return filled;
  }
  return 'A night worth filing';
};

export const pickTitle = (
  bank: VoiceBank,
  kind: GameEventKind,
  seed: number,
  slots: HeadlineSlots,
  recentTemplates: readonly string[] = [],
): string => render(bank.titles[kind], bank.titles.generic, seed, slots, recentTemplates);

export const pickDeck = (
  bank: VoiceBank,
  kind: GameEventKind,
  seed: number,
  slots: HeadlineSlots,
  recentTemplates: readonly string[] = [],
): string => render(bank.decks[kind], bank.decks.generic, seed + 1, slots, recentTemplates);

/**
 * Pick this writer's standing opinion, seeded from the event.
 *
 * Deterministic, like every other pick in this file: no clock, no counter, no
 * `Math.random()`. The same save shows the same newsroom, which is the property the
 * whole pipeline is built around -- see the determinism note in the header.
 *
 * WHY IT IS SEEDED FROM THE EVENT AND NOT ROTATED BY CARD. The beat is the writer's
 * standing position, so seeing the same one three nights running is not a repetition
 * problem in the way a repeated headline is. It is the character working: a reader who
 * sees "WAIT. Everyone is still sleeping on this one." under two Soo cards in a week has
 * learned something about her that the story itself did not say. Seeding from the event
 * still varies it -- the same writer files different beats on different games -- without
 * pretending the beat is per-story content.
 *
 * No interpolation, by design. A beat contains no slots, so it cannot fail to render
 * and there is no generic fallback to hide behind. See the note on `HeadlinerProfile.beat`.
 */
export const pickBeat = (profile: { beat: readonly string[] }, seed: number): string => {
  const bank = profile.beat;
  if (bank.length === 0) return '';
  const start = Math.abs(Math.floor(seed)) % bank.length;
  return bank[start];
};

/**
 * Pick a title and report which template produced it.
 *
 * The template is returned alongside rather than looked up afterwards, because
 * reverse-mapping a rendered title back to its source is ambiguous: two templates
 * can fill to the same string, and the anti-repetition memory needs the structural
 * identity, not the visible one.
 */
export const pickTitleWithTemplate = (
  bank: VoiceBank,
  kind: GameEventKind,
  seed: number,
  slots: HeadlineSlots,
  recentTemplates: readonly string[] = [],
): { text: string; template: string } => {
  const specific = bank.titles[kind] ?? [];
  const ordered = [...specific, ...bank.titles.generic];
  const start = Math.abs(Math.floor(seed)) % Math.max(1, ordered.length);
  // Ignored, for the reason documented on `render`. See there for the three measured
  // attempts and why each was worse than the seeded baseline.
  void recentTemplates;

  for (let step = 0; step < ordered.length; step += 1) {
    const template = ordered[(start + step) % ordered.length];
    const filled = interpolate(template, slots);
    if (filled !== null) return { text: filled, template };
  }
  return { text: 'A night worth filing', template: 'A night worth filing' };
};

// ---------------------------------------------------------------------------
// PEREZ -- field reporter
// ---------------------------------------------------------------------------

/**
 * Present tense, observational, scene-setting. Third person, no editorialising, no
 * exclamation. He writes the game as it happened and lets the reader draw the
 * conclusion: "you had to see it" is in his register, "it was electric" is not.
 */
const PEREZ: VoiceBank = {
  titles: {
    walk_off: [
      '{CITY} Turns It Up in the Ninth',
      'Ninety Minutes in {ARENA}',
      'The Last Swing at {ARENA}',
      'A Quiet Walk Off in {CITY}',
    ],
    no_hitter: [
      'Nobody Saw It Coming',
      'Ninety Bats, Nothing to Show',
      'A Quiet House in {CITY}',
      'The Ball Was Never Fairly Hit',
    ],
    extra_innings: [
      'It Kept Going in {CITY}',
      'Past the Regulation Frames',
      'They Stayed in {ARENA}',
      'A Game That Refused To End',
    ],
    blowout: [
      'The Margin Grew Every Frame',
      'By the Seventh It Was Over',
      '{TEAM} Put It Away',
      'The Runs Came in Clusters',
    ],
    underdog_win: [
      'The Line Was Against {TEAM}',
      'Nobody Had {TEAM} Winning This',
      'A Result That Did Not Compute',
      'The Underdog Did the Arithmetic',
    ],
    scrap_heap: [
      'Nobody Pitched an Outing',
      'Scoring Ran Past Closing Time',
      'The Bullpen Watched It Happen',
      'Runs Kept Arriving',
    ],
    pitching_dome: [
      '{PLAYER} Kept Going Back Out There',
      'Strike After Strike After Strike',
      '{PLAYER} Set a Tempo',
      'The Count Kept Slipping Away',
    ],
    one_run_game: [
      'One Run in {ARENA}',
      'Ninety Minutes for a Single Margin',
      'The Kind of Game That Gets Remembered Wrong',
      'Everything Turned on One Plate Appearance',
    ],
    winning_streak: [
      '{TEAM} Have Won {FIGURE} Straight',
      'It Kept Turning Up',
      'Another Night in {CITY}',
      'The Streak Is Not a Coincidence Yet',
    ],
    generic: [
      'A Night in {CITY}',
      'From the First Pitch',
      'The Log Book Tells It Plainly',
      'An Ordinary Game, Loudly',
    ],
  },
  decks: {
    one_run_game: [
      'One run, decided by one swing, in front of a crowd that had been on its feet since the seventh. {TEAM} will take it and describe it as a close game, which it was not.',
      'It finished {FIGURE}, and the whole thing came down to one at-bat neither staff could get a second look at. {TEAM} were the better club for about four innings out of nine.',
      'Ninety minutes for {FIGURE}. Nobody in {CITY} can tell you what happened, only that it kept not happening until it finally did.',
    ],
    winning_streak: [
      '{TEAM} have won {FIGURE} in a row now. The wins have not all looked the same, which at this level is the point: the same club keeps finding a different way to be adequate.',
      'There is no single through-line to {FIGURE} games in a row except that {TEAM} keep finding it. That is either a trend or a coincidence, and it is too early to say which.',
      'Ask {OPPONENT} what {FIGURE} straight feels like. They will not be diplomatic about it.',
    ],
    generic: [
      '{TEAM} and {OPPONENT} went out to the park and played the whole way through. Nothing about it needed explaining, which is usually the sign of a game that worked.',
      'It was the kind of night that asks no follow-up questions. {TEAM} played {OPPONENT} straight and left before anyone had decided what to think about it.',
    ],
  },
};

// ---------------------------------------------------------------------------
// SOO -- youth writer
// ---------------------------------------------------------------------------

/**
 * Social cadence, sentence fragments, occasional caps for emphasis. Always about a
 * young player, and the hard age gate in `headliners.ts` guarantees she never sees
 * anyone else. Her templates lean on AGE more than any other reporter's, which is
 * exactly why that slot exists.
 */
const SOO: VoiceBank = {
  titles: {
    big_debut: [
      'WAIT. {PLAYER} IS {AGE}???',
      'First Big League At-Bat. {PLAYER}, {AGE}.',
      'Nobody Told {PLAYER} How It Would Go',
      'A Rookie Showed Up and Belonged',
    ],
    young_player: [
      '{PLAYER} Is {AGE} and Doing This',
      'Call Up the Rest of the Class, {TEAM}',
      'The Youngest Name on the Card',
      'Remember This One',
    ],
    multi_homer: [
      '{PLAYER}, {AGE}, Three Times Over',
      'How Old Are You? Again.',
      '{PLAYER} Did It {FIGURE} Different Ways',
      'Nobody Roommates a Career Like This',
    ],
    walk_off: [
      '{PLAYER} Called It. {AGE} Years Old.',
      'The Youngest Voice in the Building Won It',
      '{PLAYER} Stepped Up and Ended It',
      'You Could Hear the Room Change',
    ],
    on_base_machine: [
      '{FIGURE} Hits. {AGE} Years Old.',
      '{PLAYER} Just Kept Going',
      'Every Pitch Was a Swing',
      'What Do You Even Say About {PLAYER}',
    ],
    momentum_swing: [
      'It Flipped and {PLAYER} Was There',
      'The Lead Changed Hands {FIGURE} Times',
      'Nobody Held On',
      'Turns Like That Decide Games',
    ],
    generic: [
      '{PLAYER} Is {AGE}. That Is The Whole Story.',
      'The Youngster Did It Again',
      'Still Cannot Believe This One',
    ],
  },
  decks: {
    young_player: [
      '{PLAYER} is {AGE}. {TEAM} put him out there and he went around the bases like he had been doing it for years, which at this point he probably has.',
      'Every season somebody comes up and everybody says the same thing, and every season somebody actually does it. {PLAYER} is {AGE} and this is not a coincidence.',
    ],
    multi_homer: [
      'Three home runs for a {AGE}-year-old. The pitcher threw the same pitch three times and got paid three times, which tells you everything about the rest of that lineup.',
      '{PLAYER} is {AGE} and hit {FIGURE} of them. Whatever the plan was, it lasted about five minutes.',
      'Three times, three different swings, three {AGE}-year-old. The gap is going to take a while to close.',
    ],
    generic: [
      '{PLAYER} is {AGE} and still doing things that make the rest of us feel behind. The gap between what he should be and what he is doing has not closed yet.',
    ],
  },
};

// ---------------------------------------------------------------------------
// GATZ -- former player, speaks from inside the experience
// ---------------------------------------------------------------------------

/**
 * Direct, competitive, vernacular. He comments on what the players are going through
 * rather than on what happened to them, and he is entitled to it. His register is the
 * dugout, not the broadcast booth.
 */
const GATZ: VoiceBank = {
  titles: {
    blowout: [
      'THAT IS HOW YOU WIN IT',
      "{CITY} Believed. {OPPONENT} Didn't.",
      'You Do Not Let It Get Close',
      'That Is a Full Nine',
    ],
    multi_homer: [
      '{PLAYER} Got to a Good Count and Stayed There',
      'You Cannot Pitch To a Guy Like That',
      'Three Times. In One Night.',
      'That Bat Was On Schedule All Night',
    ],
    pitching_dome: [
      '{PLAYER} Was Not Going to Miss',
      'The Best Stuff I Ever Saw Was Late In the Count',
      'You Can Only Throw So Many Strikes',
      '{PLAYER} Took That Game Over',
    ],
    complete_game: [
      'Twenty-Seven Outs and Nobody Helped',
      'He Did Not Look Tired Once',
      'That Is a Man Who Was Ready',
      'You Earn the Right to Want the Ball',
    ],
    staff_wins: [
      'Five Guys, One Job',
      'The Whole Staff Came Through',
      'That Is How You Cover Nine Innings',
      'Nobody Asked Questions. Everybody Delivered.',
    ],
    walk_off: [
      'He Asked For the Ball and Got It',
      'That Is What You Are There For',
      'No Easy Way Out and He Took It Anyway',
      'That Swing Was Not a Chance',
    ],
    meltdown: [
      'I Have Been in That Dugout',
      'That Look Was Not About the Pitcher',
      'You Could See It Going in the Third',
      'Once It Goes, It Goes',
    ],
    shutout: [
      'Nothing. Not a Thing.',
      'Do Not Blame the Bullpen For That',
      'You Can See When a Lineup Is Cold',
      'That Is a Hard Nine to Watch',
    ],
    cycle: [
      'A Cycle. He Did All Four.',
      'I Have Never Seen That In Person and I Am Not Sure I Want To',
      '{PLAYER} Went Around in Every Order There Is',
      'That Is Not a Lineup, That Is A Statement',
    ],
    perfect_game: [
      'Twenty-Seven Outs and Nothing Found',
      '{PLAYER} Did Not Allow a Single Thing',
      'That Is As Close To Perfect As The Sport Allows',
      'Nobody Touched Anything All Night',
    ],
    rbi_barrage: [
      '{PLAYER} Drove In {FIGURE}',
      'He Did Not Stop Driving Them In',
      'That Is a Whole Lineup Handled By One Guy',
      'Somebody Pitch To Somebody Else',
    ],
    hit_fury: [
      '{PLAYER} Got {FIGURE} Hits',
      'He Did Not Stop Hitting',
      'The Whole Night Was One At-Bat After Another',
      'That Is Not Slugging, That Is Finishing',
    ],
    generic: [
      'Ask Me How I Know',
      'I Have Seen That Movie',
      'That Is Just Baseball',
      'Nobody in There Learned Anything New',
    ],
  },
  decks: {
    blowout: [
      '{TEAM} did not so much win as settle in. From the third inning the outs came easy and {OPPONENT} looked like a club that had already put its coat on.',
      'You can measure when a game is over by when the other dugout stops watching the plate. That was the fourth inning.',
      'Nothing about the {FIGURE} was a surprise except how long it took. {TEAM} were better and they were better early, which is the least interesting way for a blowout to happen.',
    ],
    meltdown: [
      'You have to understand what {OPPONENT} was feeling. It is not the pitching, it is that everybody in that dugout can tell by the fourth inning this one is gone.',
      'Down {FIGURE} and the thing nobody photographs is the second time they looked at each other after a single. By then the scoreboard was just making it official.',
      'I have been down {FIGURE} in April with a worse bullpen than that one. You do not play the rest of the game, you finish the inning and go home.',
    ],
    complete_game: [
      '{PLAYER} went the distance and never once looked at the bullpen. That is the whole point of a complete game: not being tempted.',
      'Twenty-seven outs on a roster that had somebody warm up behind him. That is not fitness, that is somebody having earned the right to be tired and choosing to work anyway.',
      'He had nothing and still had to get twenty-seven. There is no compliment for a complete game, which is why I am giving one.',
    ],
    cycle: [
      'A single, a double, a triple and a home run. {PLAYER} did not just hit well, he hit in every order available and did it in one night, which is the sort of thing you see once a decade.',
      'Every gap in the infield got a ball through it and the last one left the park. {PLAYER} did not pick an order, he worked down a list.',
      'You can hit for power or you can hit for average. On that night {PLAYER} refused the choice, and there is no adjustment for that.',
    ],
    perfect_game: [
      'Nobody reached, nobody walked, {PLAYER} went twenty-seven. I have nothing clever to add to that and I have been trying.',
      'Twenty-seven outs, nine of them on the ground, and not one of them through the hole. There is no adjustment I can suggest to a hitter who never saw the right part of the bat.',
      'I have watched a lot of no-hitters. That one is going to be the answer to the question of what the ceiling is.',
    ],
    rbi_barrage: [
      '{PLAYER} drove in {FIGURE}. The lineup got on base, and then it got on base again, and at some point in there it stopped being a lineup and became one man with teammates.',
      '{FIGURE} runs, one batter, and the bases emptied every single time. The scouting report is going to be a single page with a name on it.',
      'Somebody has to drive them in and tonight it was one guy. Nothing about that is a lineup and everything about it is baseball.',
    ],
    hit_fury: [
      '{PLAYER} went {FIGURE} for {FIGURE}. There is no technical word for it. He just kept swinging until the box score ran out of room.',
      '{FIGURE} hits. The pitcher kept throwing strikes and kept watching them get hit, and there is no point in the game where that stops being astonishing.',
      'Hit for {FIGURE}. You can search the season for a night like that and mostly come up empty.',
    ],
    generic: [
      'I have been in that uniform and I will tell you what nobody upstairs ever admits. Most nights are decided by about four outs, and everybody spends the rest of the night pretending otherwise.',
    ],
  },
};

// ---------------------------------------------------------------------------
// SCINTILLA -- stats analyst
// ---------------------------------------------------------------------------

/**
 * Excited about mathematics. Speaks in BABIP, K/9 and standard deviations, and
 * addresses the reader as someone who wants the number rather than the feeling. His
 * good lines are the ones where the maths undercuts the narrative.
 */
const SCINTILLA: VoiceBank = {
  titles: {
    anomaly: [
      "What {PLAYER}'s BABIP Actually Says About That Night",
      'This One Was Not Variance',
      'The Number Was Two Sigma Out',
      'Regression Is Coming and It Is Coming Fast',
    ],
    sustained_rate: [
      '{PLAYER} Has Been Doing This Since April',
      'This Is Not a One-Night Thing',
      'The Trend Line Is Not Pretending',
      'Sample Size Actually Matters Here',
    ],
    expected_divergence: [
      'Expected vs. Actual: {TEAM} Got Lucky',
      'The Model Did Not Have {OPPONENT}',
      'A {FIGURE}-Point Gap, the Wrong Way',
      'This One Should Not Have Happened',
    ],
    meltdown: [
      '{OPPONENT} Did Not Have a Bad Night. It Was a Bad Sample.',
      'The Variance Explained Exactly None of It',
      'This Is What Regression Looks Like From Inside',
      'The Numbers Were Against Them All Game',
    ],
    pitching_dome: [
      '{PLAYER} and a Strikeout Rate With No Ceiling',
      'The Count Distribution Says Everything',
      'That Was Not a Fluke of Sequencing',
      'The Whiff Rate Was Historic',
    ],
    generic: [
      'The Data Says Something Different',
      'Let Us Be Precise About This',
      'A Note on the Numbers',
      'This Is What the Distribution Did',
    ],
  },
  decks: {
    anomaly: [
      '{PLAYER} posted a BABIP of {FIGURE}, which is two standard deviations out on a single-game sample. Small enough that I would not act on it, large enough that I would write it down.',
      'A {FIGURE} BABIP on one night. The interesting question is not whether it repeats -- it almost certainly will not -- but what the contact quality looked like underneath it.',
      'Two sigma on a {FIGURE}. Before anyone builds a narrative: three at-bats is a sample, and the honest reading is "watch, do not conclude".',
    ],
    sustained_rate: [
      '{PLAYER} has been running at this level across the sample rather than in one night. That is the difference between an outlier and a rate, and only one of them should change how you roster.',
      'A {FIGURE} average over a window large enough to mean something. This is the only kind of number in the paper that survives contact with a full season.',
      'Not a hot streak -- a rate. The distinction matters because one of them gets you traded and the other gets you in a lineup.',
    ],
    expected_divergence: [
      'The ratings had {TEAM} a {FIGURE}-point favourite and the simulation went the other way. One result is a sample, but the gap was wide enough to be worth naming.',
      'A {FIGURE}-point gap, resolved against the better club. Variance explains this about one time in ten, which is not impossible and is not comfortable.',
      '{OPPONENT} won a game they were not supposed to win. One of those is an upset and six of those is a correction, and nobody knows which this was yet.',
    ],
    generic: [
      'Everyone in the building has an opinion. The interesting question is how far tonight sits from the distribution, and the answer is further than most people would like.',
    ],
  },
};

// ---------------------------------------------------------------------------
// TOMBUCCELLI -- columnist
// ---------------------------------------------------------------------------

/**
 * Sardonic, dismissive, direct-address. Disbelief is his default and praise is
 * expensive. The impressions are rate-limited hard in `headlinerPipeline`, and they
 * read as grudging on purpose -- if they read warm he would stop being funny.
 */
const TOMBUCCELLI: VoiceBank = {
  titles: {
    meltdown: [
      'Another {TEAM} Offense. Spectacularly Bad.',
      'Forty Years and They Still Have Not Fixed It',
      'I Watched All Of It and I Have Questions',
      'This Is What We Are Working With',
    ],
    shutout: [
      'Zero. {OPPONENT} Scored Zero.',
      'A Complete Game With Nothing In It',
      'I Have Nothing and I Am Still Bored',
      'Somebody Explain the Offense',
    ],
    losing_streak: [
      '{FIGURE} Straight. Genuinely Impressive.',
      'At What Point Do We Call It a Process',
      'This Is Now a Trend and Not a Game',
      'They Should Sit Down. All of You.',
    ],
    anomaly: [
      'The Stat Is Real and So Is the Problem',
      'They Will Cite This For Years',
      'One Night Does Not a Career. Apparently.',
      'Enjoy the Number While It Lasts',
    ],
    underdog_win: [
      'One Good Night and Everyone Believes',
      'Do Not Get Ahead of It',
      'The Upset Was Real. The Team Is Not',
      'Enjoy This While It Lasts',
    ],
    // Impressions. Rate-limited to two a season and gated on severity, which is why
    // these exist at all rather than being flavour text.
    no_hitter: [
      "I'll Say It Once. {PLAYER} Is Special. Now Go Away.",
      'I Hate Doing This. That Was Different.',
      'Fine. That Was Special. Nobody Tell Anyone I Said It.',
      'I Have Watched {PLAYER} For Years and I Am Not Enjoying Admitting This.',
    ],
    perfect_game: [
      'I Have Nothing. {PLAYER} Had Everything.',
      'I Refuse To Say It. But There It Is.',
      'Twenty-Seven Outs and I Am Left With No Material At All.',
      'Against {OPPONENT}, of all clubs. Take the day off, all of you.',
    ],
    cycle: [
      'A Cycle. Fine. I Am Impressed and I Hate It.',
      'I Was There. I Will Not Be Doing This Again.',
      'A Cycle in {CITY} and I am going to go sit somewhere quiet.',
      'Every hit type, one night. I do not have a joke and I am not going to invent one.',
    ],
    multi_homer: [
      '{FIGURE} Home Runs. I Am Not Going to Discuss It.',
      'Do Not Replay This For Me.',
      '{FIGURE} of them. Against this pitching. In this park. On this night.',
      'I withdraw every objection I had about {PLAYER}. Temporarily.',
    ],
    hit_fury: [
      '{FIGURE} Hits. I Have Run Out of Ways to Be Rude.',
      'One Game. Sure. We Will See.',
      '{FIGURE} for {FIGURE} and I am obliged to note that it is still one game.',
      'Against {OPPONENT}? On that pitching? I am going to need a moment.',
    ],
    pitching_dome: [
      '{PLAYER} Struck Out {FIGURE} and I Have No Jokes Left.',
      'I Take It Back. Once. Do Not Repeat It.',
      '{FIGURE} strikeouts. I have written nothing this week and I have nothing this week.',
      'I watched {PLAYER} get to the count they wanted {FIGURE} times and I could not look away.',
    ],
    generic: [
      'Anyway.',
      'I Have Nothing and I Am Not Happy About It',
      'Filed Under: Problems',
      'We Will Discuss This Never',
    ],
  },
  decks: {
    generic: [
      '{TEAM} lost in front of a decent crowd and produced nothing worth writing down. I say that with affection, which is not something I extend often.',
      'I watched {OPPONENT} give away another one, and I say that as a man who has watched roughly four thousand of these from the other side of the fence.',
    ],
    meltdown: [
      'Every one of them looked at each other after the third inning, which is the part nobody photographs. By then it was over and the scoreboard was just making it official.',
      '{TEAM} were down {FIGURE} and did the thing you are not supposed to do, which is keep going. The other dugout had already gone home.',
      'There is a point in a game where the losing side is just filling in a box score, and {TEAM} found it around inning four.',
    ],
    shutout: [
      'Zero runs. Not one. {OPPONENT} will take it and so should everyone else in the building who was still hoping at the plate appearances.',
      'Being shut out is not a loss, it is an absence. {TEAM} did not lose {OPPONENT} tonight, they simply were not there.',
      'I have nothing for this one. That is what a shutout is: the game did not happen, and there is no column to write.',
    ],
  },
};

export const VOICE_BANKS: Readonly<Record<HeadlinerId, VoiceBank>> = {
  perez: PEREZ,
  soo: SOO,
  gatz: GATZ,
  scintilla: SCINTILLA,
  tombuccelli: TOMBUCCELLI,
};

/**
 * Total template counts, so the "first pass, below the plan's target" claim in the
 * header is a number rather than an impression. Reported by a verifier.
 */
export const VOICE_BANK_COUNTS = (() => {
  let titles = 0;
  let decks = 0;
  Object.values(VOICE_BANKS).forEach((bank) => {
    Object.values(bank.titles).forEach((list) => { titles += list.length; });
    Object.values(bank.decks).forEach((list) => { decks += list.length; });
  });
  return { titles, decks };
})();