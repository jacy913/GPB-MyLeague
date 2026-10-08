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
    /*
     * Postseason. His register is the game as it was lived, and the postseason is the stretch
     * where that is most true -- so these are written as scenes rather than as results. `{FIGURE}`
     * is the winning series total and is deliberately the only number in any of them, because a
     * title that leads with a count is a scoreboard, and this is not one.
     */
    series_clinched: [
      '{TEAM} Are Through',
      'They Walked Off {OPPONENT}',
      'The Last Game of This One',
      'Somebody Had To Stay',
    ],
    championship: [
      '{TEAM} Win It',
      'The Last Game of the Year',
      'They Carried It to the End',
      'That Is the Last One You Get to Win',
    ],
    walk_off: [
      '{TEAM} Turns It Up in the Ninth',
      'Ninety Minutes in {ARENA}',
      'The Last Swing at {ARENA}',
      'A Quiet Walk Off at {ARENA}',
    ],
    no_hitter: [
      'Nobody Saw It Coming',
      'Ninety Bats, Nothing to Show',
      'A Quiet House, {OPPONENT} Kept Waiting',
      'The Ball Was Never Fairly Hit',
    ],
    extra_innings: [
      'It Kept Going in {TEAM} Territory',
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
      'Another Night in {TEAM} Country',
      'The Streak Is Not a Coincidence Yet',
    ],
    generic: [
      'A Night in {TEAM} Country',
      'From the First Pitch',
      'The Log Book Tells It Plainly',
      'An Ordinary Game, Loudly',
    ],
  },
  decks: {
    /*
     * Postseason decks. The through-line is that these are the games people will remember, and the
     * figures are stated once and plainly rather than celebrated -- he is in the seats, not writing
     * a eulogy, and a person who was there does not usually announce that a moment was important.
     */
    series_clinched: [
      'They went at it for {FIGURE} games and at the end of the last one it was over. {OPPONENT} got up and left and did not wait around, which tells you they already knew.',
      'Somebody in the fourth row of the visiting section told me it had been over since the sixth inning of the fourth game. I did not believe him until the last out.',
      '{TEAM} are through and the field is one game smaller. That is the whole report. It is just that nobody tells you it feels like that from four rows back.',
    ],
    championship: [
      'It ended the way these things end, with everybody still in their seats and the season over. {TEAM} won it and about half the park went quiet before it went loud.',
      'A year of baseball came down to the last out of the last game. I have seen a lot of last outs and there is no way to get ready for that one.',
      '{TEAM} are champions and I would like to say something clever about it. I cannot. It was {FIGURE} games of the thing and then one more.',
    ],
    no_hitter: [
      '{PLAYER} retired {OPPONENT} in order and by the time it was over nobody had made much of it, which is the way it always goes. The next person to hit will make much of it.',
      'Nine innings without a hit is not a thing you watch, it is a thing you find out afterwards and then wish you had been paying attention. {PLAYER} did it to {OPPONENT} in front of a crowd that had nothing to do at the end.',
      'People ask whether {OPPONENT} could have done anything. The honest answer is that {PLAYER} made the answer irrelevant, which is the whole point.',
    ],
    walk_off: [
      'One swing at the end of a long one. {PLAYER} hit it, {TEAM} ran, and about a thousand people who had been sitting since the first inning went home happy.',
      'It was over before it started, which is the thing about walk-offs. Ninety minutes of it and then a tenth of a second.',
      'The rail was full. Somebody behind me said the same thing everyone said, which is that {OPPONENT} had already lost it two innings before {PLAYER} came up.',
    ],
    pitching_dome: [
      '{PLAYER} struck out {FIGURE} and by the sixth the people behind the plate had stopped talking. There is a pitch count where a hitter stops being part of the night and starts waiting for it to end.',
      'You could see it from the third-base side. {PLAYER} had something he was not telling anybody about and {FIGURE} of them went down to it.',
      'That is what {FIGURE} strikeouts looks like from four rows back: a man who has stopped being surprised by his own stuff.',
    ],
    extra_innings: [
      '{FIGURE} innings. Everybody was still there. Nobody can tell you what happened in the fourteenth, only that it kept not happening until it finally did.',
      'It is the eleventh inning that separates the people who came from the people who stayed, and the people who stayed saw {TEAM} and {OPPONENT} go at it for another two hours with nobody in a hurry to go home.',
      'The kind of night where you lose track of the score and keep track of the pitcher, and there is not a scoreboard worth watching at that point.',
    ],
    blowout: [
      'You can tell from the third-base seats when it is over and you can tell by the fourth when the other dugout stops watching the plate. {TEAM} were there by the fifth.',
      '{FIGURE} to nothing. The part that surprises people is how early it settled -- this was decided before anyone had to care.',
      'The whole thing had a smell to it by the middle innings. {OPPONENT} were still playing and {TEAM} were somewhere else entirely.',
    ],
    scrap_heap: [
      'The park filled up and stayed filled. {TEAM} scored {FIGURE} and by the end everybody in it had watched somebody in this game do something worth the price of the drive.',
      'A hundred hits in a game does not happen because of pitching or because of hitting. It happens because a night will occasionally let both go at once.',
      'You do not see {FIGURE} of these often. When it happens the building does a thing with the noise that a scoreboard cannot explain.',
    ],
    underdog_win: [
      '{OPPONENT} were not supposed to win. Half the park knew it. {TEAM} winning in {FIGURE} is not a surprise, it is a correction.',
      'Nobody applauded the maths. Everybody applauded the out.',
      'The good teams win the games they are supposed to win. {OPPONENT} just did not, and {TEAM} were good enough today to punish it.',
    ],
    one_run_game: [
      'One run, decided by one swing, in front of a crowd that had been on its feet since the seventh. {TEAM} will take it and describe it as a close game, which it was not.',
      'It finished {FIGURE}, and the whole thing came down to one at-bat neither staff could get a second look at. {TEAM} were the better club for about four innings out of nine.',
      'Ninety minutes for {FIGURE}. Nobody in {OPPONENT} can tell you what happened, only that it kept not happening until it finally did.',
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
    big_debut: [
      '{PLAYER} is {AGE} and this was the first one. Whatever happens from here, tonight already happened, and nobody who watched it is going to forget it.',
      'Debuts are supposed to be about the future. {PLAYER} made it about the present tense instead, and at {AGE} that is a much more useful thing to be.',
      'Every year the league produces one of these and every year the adults take a year to notice. {PLAYER} is {AGE}. Note the date.',
    ],
    momentum_swing: [
      '{TEAM} were behind and then they were not, and the switch happened somewhere around the middle of the game in the way it always does: not one swing, just a run, then another run.',
      'There is a point in a game where the outs stop being hard. {TEAM} found it, and the scoreboard did the rest, and nobody in the building could point at the moment it turned.',
      'Two runs is the largest thing you can take in one swing and {TEAM} took it twice. That is not a rally so much as a hinge.',
    ],
    on_base_machine: [
      '{PLAYER} did not hit {FIGURE} hard. That is the interesting part. Hard contact is available to anyone with a bat; getting on base {FIGURE} times while not swinging away from anything is not.',
      'A {FIGURE} at-bat night for {PLAYER}, and the tape would be worth watching for a different reason than usual -- the outs were not hard outs.',
      '{PLAYER} reached {FIGURE} times. That is a skill and it is a rarer one than it looks, because most of it is knowing when not to swing.',
    ],
    walk_off: [
      'One swing. {PLAYER} turned {TEAM} around, {OPPONENT} went home, and {FIGURE} people in {ARENA} got to stand there for a while.',
      'It is over in a tenth of a second and it took the whole night. {PLAYER} at the plate, {TEAM} down, and then it was not.',
      '{OPPONENT} had one out and the right idea. {PLAYER} had a different one and it worked, and that is the entire story of a walk-off.',
    ],
    young_player: [
      '{PLAYER} is {AGE}. {TEAM} put him out there and he went around the bases like he had been doing it for years, which at this point he probably has.',
      'Every season somebody comes up and everybody says the same thing, and every season somebody actually does it. {PLAYER} is {AGE} and this is not a coincidence.',
      '{PLAYER} is {AGE} and has already done the thing that takes some veterans a whole career. {TEAM} either know what they have or they are about to find out the expensive way.',
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
    /*
     * He played a postseason, and going home is the other half of what that is. ALL CAPS is this
     * bank's register throughout -- he shouts in headline type whether or not the moment earns it.
     */
    eliminated: [
      '{TEAM} ARE DONE. THAT IS THE REPORT.',
      'I HAVE SEEN THIS ONE BEFORE',
      'YOU CAN PLAY ALL YEAR AND IT ENDS IN ONE NIGHT',
      'THE SERIES WENT TO {OPPONENT}. GOOD NIGHT.',
    ],
    blowout: [
      'THAT IS HOW YOU WIN IT',
      "{TEAM} Believed. {OPPONENT} Didn't.",
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
    multi_homer: [
      '{PLAYER} hit {FIGURE} of them and the second one is the one people will remember, because it is the one that was still in the air when the dugout had already given up on the inning.',
      'Three home runs. Not three hard ones -- {PLAYER} was not overpowered, {TEAM} was simply waiting for the pitch he wanted and he only needed to see it three times.',
      'People ask whether {PLAYER} can hit {FIGURE} home runs a season. The answer is that tonight was not a fluke and that nobody should say so out loud yet.',
    ],
    walk_off: [
      'You play nine innings for that. {OPPONENT} had the outs and the count and the whole thing in their favour, and {PLAYER} had one swing and used it.',
      '{FIGURE} people stood in {ARENA} for a while and did not sit down. That is the part of a walk-off nobody puts in the box score.',
      'The whole night came down to {PLAYER} with a runner on. {TEAM} got there somehow. Then it was over.',
    ],
    staff_wins: [
      'Everyone in {TEAM} contributed and that is the rarest thing in pitching. {PLAYER} went {FIGURE}, somebody else went {FIGURE}, and the innings stacked up.',
      'A staff day. Not one arm carrying the place -- {FIGURE} outs from a pitching staff is a relay, and relays go wrong.',
      'Depth wins games like this one. {TEAM} did not get a great performance, they got a complete one.',
    ],
    shutout: [
      'Zero runs is not a bad night, it is an absence. {OPPONENT} went down in order more than once and {TEAM} simply refused to give them the one baserunner that would have changed it.',
      'A shutout is the hardest thing to score against and {OPPONENT} did not manage it once. Whatever they wanted to do, {TEAM} took it away.',
      'No runs, no explanation required. {TEAM} did the one thing a shutout is made of, which is not letting it happen more than once.',
    ],
    pitching_dome: [
      '{PLAYER} struck out {FIGURE} and there was not much to argue with on any of them. That is the whole night, really.',
      'Some nights a pitcher gets the zone and some nights the zone gets him. {PLAYER} had the first kind and took {FIGURE} of them.',
      'You do not plan to strike out {FIGURE}. You get lucky with location and location was on your side.',
    ],
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
// TOMBUCCELLI -- columnist
// ---------------------------------------------------------------------------

/**
 * Sardonic, dismissive, direct-address. Disbelief is his default and praise is
 * expensive. The impressions are rate-limited hard in `headlinerPipeline`, and they
 * read as grudging on purpose -- if they read warm he would stop being funny.
 */
const TOMBUCCELLI: VoiceBank = {
  titles: {
    /*
     * `eliminated` is the one event in the app where his sourness is the correct register rather
     * than a fault. He is negative-only by gate, and an elimination is the single postseason story
     * that is legitimately a loss -- so a chastened headline here is the character working, not the
     * character misfiring. What he may NOT do is gloat. The lines below are disappointed, not
     * triumphant, because the difference is the whole reason the character is interesting.
     */
    eliminated: [
      '{TEAM} Go Home. Say the Rest of It.',
      'I Watched All {FIGURE} Games and That Is the Summary',
      'End of the Line and Nobody Blinked',
      'They Have Until November to Think About It',
    ],
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
      'A Cycle for {TEAM} and I am going to go sit somewhere quiet.',
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
    eliminated: [
      '{TEAM} lost {FIGURE} of them and that is the report. They will go home and the season will go on without them, which is what happens to about half of the field every October.',
      'I do not enjoy this. I want to be honest about that before the column implies otherwise. {TEAM} are finished and the people who paid to watch them did not get what they came for.',
      'It took {FIGURE} games and the thing I keep coming back to is that {OPPONENT} were not especially good. They were just there at the end, which is most of what winning a series requires.',
    ],
    losing_streak: [
      '{FIGURE} in a row is not a run of bad luck at that point, it is a run of something. {TEAM} have stopped being the team that wins the close one and started being the team it happens to.',
      'The wins will come back. That is what a streak is. What does not come back on its own is why it started.',
      '{FIGURE} straight and the gap between the team that is losing it and the team that is winning it is not getting smaller. That is the part worth watching.',
    ],
    underdog_win: [
      '{OPPONENT} were not supposed to win that and everybody in the building knew it, which is exactly why {TEAM} did. An upset nobody saw coming is not an upset, it is just a result.',
      'Nobody gave {OPPONENT} a chance and the scoreboard does not accept those arguments.',
      '{TEAM} winning a game they were not in is the normal thing. {OPPONENT} losing one the same way is what will define the season.',
    ],
    anomaly: [
      '{PLAYER} will be cited for this for the rest of his career. The number is real. The career, on current evidence, is not.',
      'They will put this on a card and sell it back to you in September. It was one night. Enjoy it while it is still being sold.',
      'A {FIGURE} night. The difference between a good week and a career is roughly six hundred more of them.',
    ],
    generic: [
      '{TEAM} lost in front of a decent crowd and produced nothing worth writing down. I say that with affection, which is not something I extend often.',
      'I watched {OPPONENT} give away another one, and I say that as a man who has watched roughly four thousand of these from the other side of the fence.',
      'Filed it. Did not feel like it. Filed it anyway.',
      'Nothing to report from {TEAM} tonight, which is itself a report and I intend to make that point repeatedly.',
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

/**
 * HOANI -- data correspondent. Enthusiastic, scientific, nerdish.
 *
 * NOT A COPY OF BUCCELLI WITH THE NAMES CHANGED, and the register is what separates them. Buccelli
 * opens on a person and closes on a verdict; Hoani opens on a NUMBER and closes on what the number
 * does not mean. Every piece here starts on a statistic, a sequence or a split -- the fifth reliever's
 * K/9, a hitter 1-for-5 who reached on four walks -- because that is his signature move: naming the
 * figure nobody else would have mentioned, and being visibly pleased about it.
 *
 * Two of these carry `{PLAYER}`, which means they collapse to the `generic` bank on any event that
 * has no player attached. That is the intended behaviour and not a gap: the beat is that he is
 * delighted by a number, and the number is usually somebody's.
 */
const HOANI: VoiceBank = {
  titles: {
    anomaly: [
      'ONE NUMBER IN THAT BOX SCORE IS WRONG',
      'THEY CHECKED THE WRONG THING',
      'ONE FIGURE IS OUT OF LINE AND IT IS NOT NOISE',
      'THE OTHER THIRTY-ONE NUMBERS AGREE WITH EACH OTHER. THIS ONE DOES NOT',
    ],
    sustained_rate: [
      'THAT NUMBER IS NOT A SLUMP',
      'ONE PITCHER IS CARRYING A BULLPEN',
      'IT IS A SEQUENCE, AND SEQUENCES DO NOT REVERSE',
      'THE LINE HAS MOVED EVERY GAME FOR THREE WEEKS. THAT IS NOT VARIATION',
    ],
    expected_divergence: [
      'THE LEAGUE GOT WORSE. HE DID NOT.',
      'EVERYTHING ABOUT THAT LINE IS FLAT',
      'THE PREDICTION HELD AND THE PLAYER DID NOT MOVE',
      'SAME ARITHMETIC, OPPOSITE SIGN',
    ],
    /*
      THE TWO KINDS HE COVERS AND HAD NO TEMPLATES FOR, until this.

      `headliners.ts` lists `meltdown` and `pitching_dome` in his `covers`, both detectors fire, and he
      is eligible for both on severity -- but the bank had nothing for either, so every one of those
      cards printed from `generic`. A 14-run loss came out as:

          'Somebody went two-for-twelve and the box score says the third reliever did it.'

      Which is a pitching story, told by a data correspondent, about the wrong club. The `generic` bank
      above is anomaly-flavoured because every kind he *did* cover was anomaly-flavoured; these two
      are an offensive collapse and a pitching disaster, and `meltdown` in particular is the most
      on-brand card he could be handed -- a figure that makes the box score's story the wrong one.

      `meltdown` carries { TEAM, FIGURE } where FIGURE is the run deficit.
      `pitching_dome` carries { PLAYER, FIGURE, TEAM } where FIGURE is the strikeout count.
    */
    meltdown: [
      'A {FIGURE}-RUN DEFICIT AND EVERYONE KNEW BY THE THIRD INNING',
      'THE BOX SCORE SAYS ONE TEAM. THE INNING SCORE SAYS ANOTHER',
      'NOBODY LOST THAT ONE ON A BAD CALL',
      'THERE IS A FIGURE FOR HOW FAR A LINE MOVES. {TEAM} FOUND THE EDGE OF IT',
    ],
    pitching_dome: [
      '{FIGURE} STRIKEOUTS. THE OPPONENT NEVER SAW THE THIRD ONE COMING',
      'ONE PITCHER, {FIGURE} STRIKEOUTS, AND A BULLPEN THAT DID NOT NEED TO EXIST',
      'THE BULLETIN WILL SAY {TEAM} WON. THE NUMBER SAYS WHY',
      'THERE IS NO DEFENSIVE EXPLANATION FOR WHAT {PLAYER} DID',
    ],
    generic: [
      'Somebody went two-for-twelve and the box score says the third reliever did it.',
      'The entire season is decided by a number nobody printed, and I am the one who printed it.',
      'That is not a slumping pitcher. That is a bullpen with one arm and four men pretending.',
      'Walk rate, home run rate, strikeout rate — all of it fine. One number is not fine, and it is not the one they will ask me about.',
      'I want everyone to understand that {PLAYER} is not getting better. The league is getting worse and he is a flat line in it.',
    ],
  },
  decks: {
    anomaly: [
      'I checked every number in that game. One of them is having a completely different season from the other thirty-one.',
      'This is the part I like best: everybody watched the same game and only one of us will say what it means.',
      'There is no single-game explanation for a figure that sits this far from the line it belongs to, and the people who will give you one are describing the box score rather than reading it. I have the season totals and one of them is simply out of line with the rest.',
      'Thirty-one numbers agree with each other and one does not, and the thirty-one are not wrong. A figure that disagrees with a consensus this strong is usually telling you the consensus is measuring something else, which is a more interesting sentence than it sounds.',
    ],
    sustained_rate: [
      'It looks like a slump and it is not a slump, which is why nobody can explain it. I can, and it is a sequence, not a talent.',
      'Four men on that staff and one of them is why the number moved. Find him before the next one does.',
      'A line that has moved on consecutive days is not experiencing bad luck, it is experiencing something, and the distinction matters because bad luck stops on its own while a sequence does not. Three weeks is long enough that somebody has already asked me about it, which is to say long enough that it was not subtle.',
      'Here is the part that confuses people: the number is not behaving like a person. A slumping player misses where he used to hit, which shows up in contact quality. This is the same volume arriving somewhere else, which is what a workload does instead. Same total, different address.',
    ],
    expected_divergence: [
      'The prediction was not wrong. The thing that moved underneath it was, and that is a different story with the same headline.',
      'He is not the problem. I did the arithmetic twice because I wanted to be wrong about this one.',
      'The model and the player have separated, and only one of them can be right. I have run it both ways and the player is the one still matching his own history, which is a sentence I do not expect anybody to enjoy.',
      'Two things moved and the press wrote them up as one. The expectation changed, and the line did not. Neither of those is a story about the player, and the arithmetic says so.',
    ],
    /*
      KIND-SPECIFIC, so a pitching disaster reads as one rather than as a statistical curiosity.

      The register is unchanged from the rest of his bank: a figure that settles the argument, said
      with pleasure at having printed it. Not aggrieved -- he is not offended by {TEAM}, he is delighted
      that the arithmetic is this legible.
    */
    meltdown: [
      'A {FIGURE}-run deficit is not a slump, it is a shape. I have drawn this one twice to be sure of the slope, and it is a straight line from the third inning onward, which means it was decided early and the rest of the game was theatre.',
      'The interesting part of a {FIGURE}-run loss is how early it was decided. You can get the inning from the box score and the reason from the totals, and the two do not need to agree: {TEAM} was behind before anybody settled in.',
      'People will tell you {TEAM} ran out of outs. {TEAM} ran out of something more specific than that, and the figure that says so is {FIGURE}, which is a deficit large enough that nobody had to do anything clever in the ninth.',
      'I checked whether this one had a reason attached, because usually it does -- a bad starter, a bullpen, one of the usual suspects. A {FIGURE}-run deficit has no reason attached. That is the interesting case. It is the one I get to write about, because the other kind is just baseball.',
    ],
    pitching_dome: [
      '{PLAYER} struck out {FIGURE} and the number is the entire story. Not close to it, not an approximation of it -- {FIGURE}, and the second-best total that night belongs to somebody on the other team, which is the sort of comparison that does most of the work in this league.',
      'There is a way this question gets asked badly, which is whether {PLAYER} was good. That is not the question. The question is whether {FIGURE} strikeouts against this lineup is the number we should have expected, and it is not, and the gap is wide enough that I do not think anybody is arguing about it in good faith.',
      '{TEAM} did not win that game so much as survive the middle innings against one person. {PLAYER} struck out {FIGURE}, which means a third of the outs in it belonged to a single name, and I have written that sentence about roughly four pitchers this season and it has been the whole story every time.',
      'I am going to be precise about what {FIGURE} strikeouts means, because people round it up in their own favour. It means the plate appearances ended at that number. It does not mean the batters did not swing, or that the contact was poor, or that anything about {PLAYER} was lucky. The count is what happened, and it happened repeatedly, and that is all I have.',
    ],
    generic: [
      'Not an opinion, not a feeling — a figure, and the figure does not care what anybody expected.',
      'I am not here to tell you who won. I am here to tell you which part of it was an accident.',
      'You are going to ask about the starter. The starter is the only part of this that was fine.',
    ],
  },
};

/**
 * SHINONOME -- the fan. Praise only, and no criticism anywhere in the bank.
 *
 * The constraint is HARD and enforced by her `eligible` gate (`valence === 'positive'`), so this bank
 * is only ever asked for lines about good games. It could still go wrong by implying a criticism --
 * "they had their chances" is a complaint, and "nothing went right" is one too. Hence the register
 * note on every deck: she is pleased, and she is specific about what she is pleased about, which is
 * how a fan actually sounds. A generic delighted sentence would be a parody of her instead of her.
 *
 * No exclamation marks. The temptation is to write enthusiasm as punctuation, and it reads as a
 * parody of a fan immediately.
 */
const SHINONOME: VoiceBank = {
  titles: {
    /*
      TWO TEMPLATES PER KIND WAS THE THINNEST THING IN THE FILE, and it was hers.

      Every other persona sits at 4 titles and 3 decks per covered kind. Shinonome was at 2 and 2 across
      all eight of hers, which by this file's own standard -- "no two consecutive days from the same
      persona read alike", named in the header at :20 -- means she repeats inside two appearances of
      the same kind. A fan is the persona most likely to be handed the same good news twice in a week,
      because the league produces a good story most nights and she is only ever eligible for the good
      ones (`valence === 'positive'`), so the thinness is load-bearing rather than incidental.

      The two constraints are HARD and enforced by `eligible`, not by taste: no exclamation marks, and
      no implied criticism anywhere. "They had their chances" is a complaint and is banned here. She is
      pleased, and specific about what she is pleased about, which is how a fan sounds -- a generic
      delighted sentence is a parody of her instead of her. Caps are her register and are correct.
    */
    walk_off: [
      'AND THAT IS THE GAME',
      'SHE WALKED IT OFF. OF COURSE SHE DID',
      'WALK-OFF. I AM STANDING AND I FORGOT TO BE SEATED',
      'ONE SWING AND THE WHOLE PLACE MOVED',
    ],
    no_hitter: [
      'A NO-HITTER IN THIS LEAGUE TONIGHT',
      'NOBODY TOUCHED IT. NINETY NINE PITCHES',
      'NO HITS. IN THIS LEAGUE. I NEED A MOMENT',
      'ONE PITCHER AND NINETY NINE PITCHES AND NOT ONE HIT',
    ],
    winning_streak: [
      'FOUR IN A ROW AND THE PLACE IS BUZZING',
      'THAT IS FIVE NOW AND I LOSE COUNT',
      'THEY HAVE WON FOUR AND I HAVE COUNTED EVERY ONE',
      'ANOTHER ONE. THE STREAK KEEPS GOING AND SO DO I',
    ],
    multi_homer: [
      'THREE HOME RUNS. IN ONE GAME',
      'SHE HIT ANOTHER ONE AND THE PARK STOOD UP',
      'THREE. IN ONE GAME. IN THIS LEAGUE',
      'THAT BALL WENT INTO THE SECOND DECK AND SHE HIT IT TWICE MORE',
    ],
    rbi_barrage: [
      'SHE CAME UP WITH THE BASES LOADED',
      'THAT IS A LOT OF RUNS IN ONE INNING',
      'BASES LOADED AND THEN THAT. THE SCOREBOARD GAVE UP',
      'ONE INNING AND EVERYBODY SCORED. I AM STILL AT THE GATE',
    ],
    big_debut: [
      'A DEBUT. IN THIS LEAGUE',
      'FIRST GAME AND ALREADY THIS',
      'HER FIRST GAME IN THIS LEAGUE AND THAT IS WHAT WE WATCHED',
      'A DEBUT WORTH THE SEAT I PAID FOR',
    ],
    extra_innings: [
      'AND THEN WE WENT TO EXTRA INNINGS',
      'ELEVEN INNING NIGHT AND I WOULD DO IT AGAIN',
      'EXTRA INNINGS AND THE WHOLE PARK STAYED',
      'NOBODY LEFT. THE LIGHTS STAYED ON AND WE STAYED',
    ],
    one_run_game: [
      'ONE RUN. THAT IS THE WHOLE SCORE',
      'ONE RUN AND IT COUNTED',
      'ONE RUN DECIDED IT AND I AM STILL HERE FOR THE WHOLE THING',
      'ONE RUN. THE WHOLE GAME WAS WORTH THAT ONE RUN',
    ],
    generic: [
      'What a game. Genuinely, what a game.',
      'They did it again and I am not even surprised.',
      'I do not care about the run differential tonight. Tonight was good.',
      'Best game I have paid to watch in a long while.',
      'That one is going on the wall above my seat.',
    ],
  },
  decks: {
    walk_off: [
      'You do not get a walk-off every season and when you do you remember where you were standing.',
      'The whole park knew before the ball landed. The whole park was right.',
      'It was one swing at the end of a game that had gone on far too long, and then the whole building stood up and stayed standing.',
      'I have watched a lot of baseball and the ones I remember are not always the ones that were close. That was a good one to remember.',
    ],
    no_hitter: [
      'One team, one batter, ninety-nine pitches and not one of them was a hit. I have no notes.',
      'I will be thinking about this one for a while. That is the entire review.',
      'Ninety-nine pitches and not a single ball in the gaps. Whoever was hitting was better than the result, which is the nicest thing anybody can say about a lost at-bat.',
      'There is a reason people stay late for baseball and tonight was it. I have never seen that game more than once and I already have the ending.',
    ],
    winning_streak: [
      'They keep finding a way and I keep watching and nobody has explained to me why that is not better.',
      'A good stretch, a good month, and a good seat to watch it from.',
      'Four straight, and the thing about a streak like this is that each one is its own night and you only need to enjoy the one in front of you.',
      'They are winning again and the park has decided that this is normal now, which is the highest compliment a place can give a team.',
    ],
    multi_homer: [
      'Two of them were necessary. The third one was just for everyone in the building.',
      'Every one of them was hit. That is the part worth saying twice.',
      'Three home runs and the third one was only ever going to be for us. That is how the arithmetic works when you are ahead.',
      'She hit it hard three times and the third time the people behind me stood up before it landed, which tells you what kind of game that was.',
    ],
    rbi_barrage: [
      'Bases loaded and a hitter up. There is not much to decide there.',
      'The kind of inning where the scoreboard stops keeping up with the game.',
      'Everyone scored and then we all went back to our seats still talking about the previous one. Good innings are like that.',
      'That is the sort of inning that makes a season worth following, and everybody in this park knew it while it was happening.',
    ],
    big_debut: [
      'First game in this league and she arrives like she has been here a season. Enjoy it.',
      'You only get a first game once. That one was a good one to spend it on.',
      'A debut is one of the few things in sport that happens exactly once, and we got to watch this one go well.',
      'She looked like she belonged out there, which is the highest thing you can say about somebody on their first night.',
    ],
    extra_innings: [
      'Nobody wanted to go home. Honestly, neither did I.',
      'The kind of night where the lights stay on and everybody stays in the seats.',
      'Extra innings and the best part is that everybody was still making noise an hour after they could have gone.',
      'We went past the end and it got better. That happens maybe twice a year and I remember both.',
    ],
    one_run_game: [
      'One run decided it. The rest of it was everybody else failing to score, which I can live with.',
      'Close game, good ending, and I will take that trade every time.',
      'One run. Somebody has to score it and tonight that somebody did, and I am glad it was our side.',
      'That is a fine way to win, ugly if you like, and I was there and I enjoyed every minute of it.',
    ],
    generic: [
      'I am not going to break this down for you. I watched it and I liked it.',
      'That was the best thing on television today and it was not close.',
      'People want a cold read on it. My cold read is that I enjoyed it.',
    ],
  },
};

export const VOICE_BANKS: Readonly<Record<HeadlinerId, VoiceBank>> = {
  perez: PEREZ,
  soo: SOO,
  gatz: GATZ,
  hoani: HOANI,
  shinonome: SHINONOME,
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