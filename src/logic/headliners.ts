/**
 * The newsroom: five named reporters, what each will write about, and how each is
 * allowed to be chosen.
 *
 * This module holds REGISTRY DATA and the pure predicates over it. It writes no
 * prose -- template banks live in `headlinerVoices.ts` and event detection in
 * `headlinerEvents.ts` -- and it holds no portrait URLs, because `import.meta.glob`
 * is a build-time transform and an asset import in `src/logic/` would be a new
 * precedent. The profile names a `portraitKey`; `ui/HeadlinerPortrait.tsx` resolves
 * it.
 *
 * THE PRINCIPLE THIS EXISTS TO SERVE: one event, five possible readings. A no-hitter
 * should get a neutral on-the-ground recap, a hot take, a data autopsy and a
 * dismissal. If all five cards read the same, the feature has failed however many
 * templates were written -- so the personas are defined by what they REFUSE to write
 * at least as much as by what they cover.
 *
 * DETERMINISM. Nothing in this module may call `Math.random()`. `headlineEngine.ts`
 * has zero such calls today and a season's headline feed is part of the persistent
 * world; an unseeded pick here would make a reloaded save show a different newsroom
 * for the same games. `stableSeed` is the only source of variation and it is derived
 * from the event's identity.
 */

import type { Game } from '../types';

/** A reporter. Adding a sixth touches this file and its voice bank, nothing else. */
export type HeadlinerId = 'perez' | 'soo' | 'gatz' | 'hoani' | 'tombuccelli' | 'shinonome';

/**
 * A semantic accent name, never a gradient string.
 *
 * These resolve to existing tokens in `src/index.css`; none of them requires a new
 * token. The point of the indirection is that `headlineEngine.ts` currently carries
 * 40 `from-[#…] via-[#…] to-[#…]` gradients that nothing consumes, and a card that
 * names its accent rather than inlining one cannot grow a new raw hex.
 */
export type AccentToken = 'neutral' | 'youth' | 'fire' | 'data' | 'sour' | 'house';

export const ACCENT_VAR: Readonly<Record<AccentToken, string>> = {
  neutral: 'var(--color-ink-dim)',
  youth: 'var(--color-info)',
  fire: 'var(--color-gold)',
  data: 'var(--color-platinum)',
  sour: 'var(--color-neg)',
  /*
   * `house` was declared and then never assigned, and its colour was a placeholder:
   * `--color-ink-faint`, the dimmest ink in the theme. That is a bad trade for a named reporter,
   * because an accent is how the eye finds the byline, and "faintest" reads as "least important"
   * -- the opposite of what a byline is for.
   *
   * It now points at Shinonome's own measured forecaster accent. Two reasons rather than one. She
   * keeps the same colour when she crosses from forecasting to reporting, so a reader who learned
   * her in one role still recognises her in the other. And it is a colour that has already been
   * through `pickAccent.ts` against the 0.10 OKLab floor, so choosing it here measures nothing new
   * -- whereas picking a fresh hex for this slot would have meant running that search for a
   * character who does not exist yet.
   *
   * "House" means HER house: Fuyuka TV is her own channel, which is the one reporter here who files
   * for an outfit that belongs to her rather than to a desk that hired her.
   */
  house: 'var(--color-media-shinonome)',
};

/**
 * What can happen in a game that a reporter might care about.
 *
 * Grouped by the kind of story it makes rather than alphabetically, because the
 * grouping is what the affinity matrix below reads against.
 */
export type GameEventKind =
  // achievements
  | 'no_hitter' | 'perfect_game' | 'cycle' | 'multi_homer' | 'rbi_barrage'
  | 'on_base_machine' | 'hit_fury' | 'walk_off' | 'pitching_dome'
  | 'complete_game' | 'staff_wins'
  // game shape
  | 'extra_innings' | 'momentum_swing' | 'blowout' | 'shutout'
  | 'scrap_heap' | 'one_run_game'
  // narrative
  | 'underdog_win' | 'meltdown' | 'big_debut' | 'young_player'
  | 'losing_streak' | 'winning_streak'
  // postseason
  //
  // Added because the newsroom had NOTHING to say about October. Every other kind is a single
  // game's statistical achievement or a season trend, which meant a 3-2 walk-off that ended a
  // seven-game series produced at best a generic walk-off story -- the series consequence, which is
  // the part anyone actually remembers, was invisible. These fire on SERIES STATE rather than on a
  // game's box score.
  //
  // A separate group rather than more names on 'walk_off', because these are decided by
  // `seriesId` bookkeeping across games and not by anything in the play log. Reusing a single-game
  // kind would have meant the two could not be told apart downstream, and a persona covering
  // `walk_off` would silently inherit the postseason too.
  | 'series_clinched' | 'eliminated' | 'championship'
  // analytic
  | 'anomaly' | 'sustained_rate' | 'expected_divergence';

/**
 * The substitutions available to a template.
 *
 * `AGE` is here because the youth writer's best line needs it
 * ('WAIT. {PLAYER} IS {AGE}???') and the input plan's slot list omitted it -- the
 * interpolation helper substitutes an empty string for an unknown key, so without
 * this the card renders as 'WAIT. X IS ???'. Every slot is optional: a persona must
 * never be handed a template whose slots it cannot fill, so a missing value collapses
 * the template to its `generic` bank instead.
 */
export interface HeadlineSlots {
  PLAYER?: string;
  AGE?: string;
  TEAM?: string;
  CITY?: string;
  RIVAL?: string;
  RIVAL_PITCHER?: string;
  ARENA?: string;
  OPPONENT?: string;
  LEAGUE?: string;
  FIGURE?: string;
}

export interface GameEvent {
  kind: GameEventKind;
  game: Game | null;
  slots: HeadlineSlots;
  playerId?: string;
  teamId?: string;
  /** 0-100. The shared currency for eligibility and priority. See `severityBand`. */
  severity: number;
  /** Negative events are the hater's primary fuel. */
  valence: 'positive' | 'negative' | 'neutral';
  /** Age of the player this event is about, when it is about one. */
  playerAge?: number;
}

/**
 * The facts a persona's gate may consult beyond the event itself.
 *
 * Deliberately narrow. Anything a gate needs should either be on the event or be one
 * of these three, because every extra input is another chance for a gate to depend on
 * something the rest of the pipeline does not.
 */
export interface HeadlinerContext {
  /** Win percentage of the away team entering the game. */
  awayWinPct: number;
  /** Win percentage of the home team entering the game. */
  homeWinPct: number;
  sameDivision: boolean;
  isPlayoffGame: boolean;
}

/**
 * A story a specific reporter will file about a specific event.
 *
 * The output of the pipeline and the input to the panel. Distinct from `GameEvent`,
 * which is the fact; this is the fact plus an opinion and an author.
 */
export interface HeadlineCandidate {
  event: GameEvent;
  byline: HeadlinerId;
  /** ALL-CAPS tag line, carries the self-insert. */
  title: string;
  /**
   * The raw template `title` came from, unfilled.
   *
   * Present because the anti-repetition memory has to compare templates, not
   * rendered text. A first version stored rendered titles and compared them to
   * templates, so the comparison never matched and the deferral was inert -- while
   * still reordering the pick and making repetition measurably worse. Exposing the
   * template makes that failure mode impossible to reintroduce silently.
   */
  titleTemplate: string;
  /** The supporting two lines. */
  deck: string;
  /** Final ranking score. See `priorityOf` in the pipeline. */
  priority: number;
  accentToken: AccentToken;
  game: Game | null;
}

export interface HeadlinerProfile {
  id: HeadlinerId;
  displayName: string;
  /** Ticker use. */
  shortName: string;
  role: string;
  /**
   * The institution this reporter files for.
   *
   * Added with the outlet restructure. Headliners carried no affiliation at all, so a byline named
   * a person with no newsroom behind them -- which is precisely the gap the forecaster side had
   * already closed and the reporter side had not. It is display-only, like `MediaProfile.outlet`:
   * nothing groups or filters on it yet, and nothing should until something wants to.
   *
   * Deliberately a plain string rather than a union of the four institutions. A union would need
   * re-editing every time an outlet is renamed, which is the kind of coupling that turns a label
   * into a migration. The forecaster side keeps a plain string for the same reason.
   */
  outlet: string;
  /** Asset basename under `src/assets/headliners/`, without extension. */
  portraitKey: string;
  accentToken: AccentToken;
  /** Event kinds this persona will consider. */
  covers: readonly GameEventKind[];
  /**
   * The opinion this writer walks in with, before the story.
   *
   * NOT FLAVOUR TEXT. This is the "lore" surface, and it is separate from the voice
   * banks on purpose: a deck is about tonight's game and is different every night,
   * whereas a beat is what the writer believes and says regardless. A reader who sees
   * three Perez cards in a week and reads the same line under all three learns that
   * Perez thinks this -- which is the difference between a name on a byline and a
   * person with a position.
   *
   * Deliberately containing NO slots. A beat is the writer's standing view, so it must
   * render on every card they file, and a template naming `{PLAYER}` would fall through
   * to the generic bank on any event that lacks one -- printing a different opinion, or
   * nothing, for the sake of a name that the headline above already carries.
   *
   * Seeded, not indexed: see `pickBeat`. Nothing here reads a clock or `Math.random()`,
   * so the same save shows the same newsroom.
   */
  beat: readonly string[];
  /** Extra gate, applied after `covers`. */
  eligible?: (event: GameEvent, ctx: HeadlinerContext) => boolean;
  /** Multiplier on final priority. */
  priorityWeight: number;
}

/**
 * The marquee gate, shared rather than restated per persona.
 *
 * "Nationally televised" is both teams above .550, or a divisional rivalry, or a
 * playoff game. `getFeaturedGame` (headlineEngine.ts:1157) already scores exactly
 * this shape at .580; the threshold here is slightly looser because a reporter
 * covering a good game is not the same claim as the app picking a featured game.
 */
const marqueeGate = (ctx: HeadlinerContext): boolean =>
  (ctx.awayWinPct >= 0.55 && ctx.homeWinPct >= 0.55) || ctx.sameDivision || ctx.isPlayoffGame;

/*
 * HOANI'S SEVERITY FLOOR, CARRIED FORWARD FROM SCINTILLA UNCHANGED, and deliberately so.
 *
 * Hoani inherited Scintilla's whole beat when Scintilla crossed over to forecasting, and this is the
 * gate that came with it. It was restated as its own constant rather than pointed at Scintilla's
 * precisely so that deleting his entry would leave this reading as a decision somebody made rather
 * than as a leftover with a dangling reference. That has now happened: Scintilla is a forecaster and
 * no longer files sideline reports, so his entry is gone and this constant is the whole of the
 * record of where the number came from.
 *
 * The gate is what keeps Hoani on the maths. He should not editorialise about a game that was merely
 * uneventful -- an event below the severity floor has nothing in it for him to interrogate.
 */
const HOANI_MIN_SEVERITY = 55;
const SOO_MAX_AGE = 25;

export const HEADLINERS: readonly HeadlinerProfile[] = [
  {
    id: 'perez',
    displayName: 'HILDAGO PEREZ',
    shortName: 'PEREZ',
    role: 'FIELD REPORTER',
    outlet: 'Glorest Sports',
    portraitKey: 'hidalgoperez',
    accentToken: 'neutral',
    covers: [
      'walk_off', 'no_hitter', 'extra_innings', 'blowout',
      'underdog_win', 'scrap_heap', 'pitching_dome',
      // Added after the coverage diagnostic found six emittable kinds no persona
      // listed. A one-run game and a streak are on-the-ground material -- the game
      // as it was lived rather than as it was won -- which is his register.
      'one_run_game', 'winning_streak',
      // The postseason is the part of the calendar he is credentialed for: a club
      // walking off the field at the end of a seven-game series is exactly "the game
      // happened to people before it happened to a box score".
      'series_clinched', 'championship',
    ],
    /*
     * Perez files from the seats, on the ground, in the room. He is not interested in
     * what a number means; he is interested in what it looked like. So his standing
     * position is that the game happened to people before it happened to a box score,
     * and that the box score is the part nobody should be reading.
     */
    beat: [
      'I was there. That is my whole credential.',
      'The score is the last thing that happens in a ballpark.',
      'Ask the guy in section 114 what he saw. He will tell you more than the box score.',
      'I do not do numbers. I do people who watched a game.',
      'Somebody was standing near the dugout rail and they saw all of it.',
    ],
    eligible: (_event, ctx) => marqueeGate(ctx),
    priorityWeight: 1.0,
  },
  {
    id: 'soo',
    displayName: 'CHRISTINE SOO',
    shortName: 'SOO',
    role: 'YOUTH WRITER',
    outlet: 'Calibrated Sports',
    portraitKey: 'christinesoo',
    accentToken: 'youth',
    covers: [
      'big_debut', 'young_player', 'multi_homer',
      'walk_off', 'on_base_machine', 'momentum_swing',
    ],
    // A HARD gate, not a preference. Given a story without a qualifying young player
    // she does not write it. A persona that breaks its own rule stops being a persona,
    // and the acceptance criterion is that she never writes about anyone over 25.
    /*
     * Soo's standing position is that the young are systematically under-rated by
     * everyone who covers the sport, and she files about the ones nobody is watching
     * yet. The impatience is the character -- she is not angry at the player, she is
     * angry at the coverage, and she says so before the story every time.
     */
    beat: [
      'WAIT. Everyone is still sleeping on this one.',
      'Nobody was watching. I want that on the record.',
      'This kid is twenty-one and the box score people have not noticed yet.',
      'WAIT. Read the name again. Read it one more time.',
      'Every season somebody breaks out and it takes the adults a year to notice.',
    ],
    eligible: (event) => typeof event.playerAge === 'number' && event.playerAge <= SOO_MAX_AGE,
    priorityWeight: 1.05,
  },
  {
    id: 'gatz',
    displayName: 'CHRIS GATZ',
    shortName: 'GATZ',
    role: 'FORMER PLAYER',
    outlet: 'Glorest Sports',
    portraitKey: 'chrisgatz',
    accentToken: 'fire',
    // The most permissive persona. He comments from inside the experience, so almost
    // anything with a result in it is fair game.
    //
    // The last four were added after the coverage diagnostic found six emittable
    // kinds that no persona listed -- detected every time, written about never. A
    // cycle and a perfect game are exactly the achievements a former player would
    // have an opinion about, so they belong here rather than nowhere.
    covers: [
      'blowout', 'multi_homer', 'pitching_dome', 'complete_game',
      'staff_wins', 'walk_off', 'meltdown', 'shutout',
      'cycle', 'perfect_game', 'rbi_barrage', 'hit_fury',
      // He played a postseason. Somebody going home in October is the other half of
      // his register, and `eliminated` is the only negative-valued event he covers
      // that is decided by a season rather than by one bad night.
      'eliminated',
    ],
    /*
     * Gatz played. His standing position is that the parts of the game nobody
     * appreciates are the parts that decide it, and he says it from inside rather than
     * from a press box -- which is why his register is instructive without being
     * superior about it.
     */
    beat: [
      'I played this game. Let me tell you what nobody in here noticed.',
      'The thing that won it was decided in the fourth inning and nobody looked up.',
      'Trust me on this one. I have been on both ends of it.',
      'You do not win a game in the ninth. You win it in the fourth and wait.',
      'ALSO: the dugout decides more of this than the box score does.',
    ],
    priorityWeight: 1.0,
  },
  {
    id: 'hoani',
    displayName: 'SIMON HOANI',
    shortName: 'HOANI',
    role: 'DATA CORRESPONDENT',
    outlet: 'Calibrated Sports',
    portraitKey: 'simonhoani',
    /*
     * `data` INHERITED, not chosen. It was Scintilla's as a reporter and it frees up when he crosses
     * over to forecasting, so Hoani takes it rather than a second reporter ending up on the same
     * colour. Which is convenient, because Scintilla needs a forecaster-side accent anyway and the
     * two are being handed to each other.
     */
    accentToken: 'data',
    /*
     * SCINTILLA'S WHOLE BEAT, INHERITED WHOLESALE.
     *
     * This is the reason he exists. Scintilla held the only coverage of `sustained_rate` and
     * `expected_divergence` -- verified across all five `covers` arrays before this entry was
     * written -- so moving him to forecasting would have silenced two event kinds entirely, with no
     * persona left to file on them. Taking the list intact is what makes the move safe.
     *
     * `tools/checkHeadlinerCoverage.ts` asserts that no event kind has zero coverage, so this stays
     * true by measurement rather than by this comment.
     */
    covers: ['anomaly', 'sustained_rate', 'expected_divergence', 'meltdown', 'pitching_dome'],
    /*
     * HE TREATS EVERY BOX SCORE AS IF IT CONTAINS A CRIME, and -- this is the character -- he is not
     * aggrieved about it. He is delighted. Scintilla was specified as someone who "loves advanced
     * stats, anomalies, anything cool", which is a list of interests rather than a disposition.
     * A disposition is what makes a byline worth reading twice.
     *
     * The contrast with Buccelli is the point. Buccelli prosecutes PEOPLE -- players, clubs,
     * front offices -- and reaches indignation. Hoani prosecutes THE DATA -- rates, splits,
     * sequences -- and reaches delight. Same critic, opposite target and opposite temperature, which
     * is why he needed his own beat instead of being folded into an existing persona.
     *
     * No slots, per the beat rule: this is his standing view and must render on every card he files.
     */
    beat: [
      'In every box score there is one number nobody checked. I find it, and then I get to tell people about it.',
      'This is not a complaint. This is the best part of my job.',
      'They will ask me about the starter. The starter is fine. The thing that is wrong is in the eighth inning.',
      'Somebody is going to be very upset about a number I am about to say, and I cannot wait.',
      'I do not read a box score for the result. I read it for the mistake.',
    ],
    eligible: (event) => event.severity >= HOANI_MIN_SEVERITY,
    priorityWeight: 1.1,
  },
  {
    id: 'shinonome',
    displayName: 'FUYUKA SHINONOME',
    shortName: 'SHINONOME',
    role: 'FAN',
    outlet: 'Fuyuka TV',
    portraitKey: 'shinonome',
    accentToken: 'house',
    /*
      THE EXACT INVERSE OF TOM BUCCELLI, and that is the whole design of this entry.

        Buccelli          gate `valence === 'negative'`   writes about bad games
        Shinonome         gate `valence === 'positive'`   writes about good games
        Buccelli          criticism unrestricted
        Shinonome         CANNOT criticise. She cannot say a club is bad.

      Her stated weakness as a forecaster was "she cannot say a club is bad; every forecast she
      publishes is a variation on loving this team". As a forecaster that was a NARRATIVE limitation
      showing up as a biased number -- the worst place for it, because a number is supposed to be
      disinterested. As a reporter it is simply who she is: the fan in the third row who became a
      public figure, which is who she was before the league made her publish probabilities.

      Her old outlet name was "The Bleacher Seat" and it was her channel, not her employer. Renamed to
      Fuyuka TV on the way across; `house` -- which was a declared-but-unassigned token pointing at the
      dimmest ink in the theme -- is now hers and now points at her own measured accent.
    */
    covers: [
      'walk_off', 'no_hitter', 'extra_innings', 'one_run_game',
      'winning_streak', 'multi_homer', 'rbi_barrage', 'big_debut',
      // Her `eligible` gate is `valence === 'positive'`, so these hand her only the
      // advancing half of the postseason. A fan cannot be given the elimination and
      // there is no code path that would try: the kind is positive, she is not
      // negative, and the two never meet.
      'series_clinched', 'championship',
    ],
    /*
      SHE CANNOT WRITE A BAD GAME, so nothing in these beats is a criticism. They are what she is
      allowed to say, and the register is a person who is delighted rather than a person performing
      delight -- which is why there is no exclamation mark anywhere in the bank.
    */
    beat: [
      'I do not care about your run differential. I care that they have won four in a row.',
      'Buy the team you would rather lose with. That is the whole strategy.',
      'I have watched every one of these games in a seat I paid for and I have never once been disappointed.',
      'People ask me for analysis. I do not have analysis. I have a season I am enjoying.',
      'If you are not watching this team you are not watching the game.',
    ],
    eligible: (event) => event.valence === 'positive',
    priorityWeight: 0.85,
  },
  {
    id: 'tombuccelli',
    displayName: 'TOM BUCCELLI',
    shortName: 'TOM BUCCELLI',
    role: 'COLUMNIST',
    outlet: 'The Booth',
    portraitKey: 'tombuccelli',
    accentToken: 'sour',
    covers: ['meltdown', 'shutout', 'losing_streak', 'anomaly', 'underdog_win', 'eliminated'],
    // Negative only. Praise is routed through a separate rarity budget in
    // `headlinerPipeline`, not through this predicate, because the whole character is
    // the scarcity. He is meant to be silent during a good week.
    /*
     * Buccelli's standing position is that everyone in the building is being paid to be
     * excited and he is the only one who came. Praise from him is the scarce thing --
     * which is why these lines are all complaints, and why an actual compliment from
     * him still spends from the two-a-season impression budget.
     */
    beat: [
      'I have been coming here for decades and I am not going anywhere.',
      'Everybody else is having a wonderful time. I have questions.',
      'This is a business now. I suppose it always was.',
      'Do not wave at me. I am working.',
      'I would like one season where nothing interesting happens. Just one.',
    ],
    eligible: (event) => event.valence === 'negative',
    priorityWeight: 0.85,
  },
];

export const HEADLINER_BY_ID: Readonly<Record<HeadlinerId, HeadlinerProfile>> = Object.fromEntries(
  HEADLINERS.map((profile) => [profile.id, profile]),
) as Record<HeadlinerId, HeadlinerProfile>;

/** Positional arguments for `new RegExp`, not a template string. */
export const coversEvent = (profile: HeadlinerProfile, kind: GameEventKind): boolean =>
  profile.covers.includes(kind);

/**
 * The full gate: does this persona write about this event, in this game?
 *
 * `covers` first because it is the cheap set membership, then the persona's own
 * predicate. Both must pass.
 */
export const isEligible = (
  profile: HeadlinerProfile,
  event: GameEvent,
  ctx: HeadlinerContext,
): boolean => coversEvent(profile, event.kind) && (profile.eligible?.(event, ctx) ?? true);

/**
 * Severity bands, named so call sites read as an intent rather than a number.
 *
 * Existing game-story priorities in `headlineEngine.ts` run 140-180; severity x 2 +
 * 100 reproduces that range, so current tuning carries over.
 */
export const SEVERITY_BAND = {
  historic: 95,
  notable: 85,
  significant: 70,
  moderate: 55,
  minor: 40,
  negative: 25,
  routine: 10,
} as const;

/** Which band a severity falls in, for logs and for the analyser persona's floor. */
export const severityBand = (severity: number): keyof typeof SEVERITY_BAND => {
  if (severity >= SEVERITY_BAND.historic) return 'historic';
  if (severity >= SEVERITY_BAND.notable) return 'notable';
  if (severity >= SEVERITY_BAND.significant) return 'significant';
  if (severity >= SEVERITY_BAND.moderate) return 'moderate';
  if (severity >= SEVERITY_BAND.minor) return 'minor';
  if (severity >= SEVERITY_BAND.negative) return 'negative';
  return 'routine';
};

/**
 * A stable integer derived from a string. FNV-1a, matching the scheme
 * `playerDevelopment.ts` and `offseasonFreeAgency.ts` already use, so the repo reads
 * as one system rather than three hash conventions.
 */
export const hashString = (value: string): number => {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
};

/**
 * Pick from a bank, deterministically.
 *
 * The seed must come from the event's identity, never a counter and never
 * `Math.random()`: a reloaded save has to show the same newsroom for the same games,
 * and Tombuccelli's rare praise must not flicker between reloads.
 */
export const pickSeeded = <T,>(items: readonly T[], seed: number): T | null =>
  items.length === 0 ? null : items[Math.abs(Math.floor(seed)) % items.length];

/** The seed for an event's voice selection. */
export const eventSeed = (event: GameEvent): number =>
  hashString(`${event.game?.gameId ?? event.kind}:${event.kind}:${event.playerId ?? ''}`);
