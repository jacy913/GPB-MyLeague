/**
 * GPB MyLeague — Single Number Formatting Authority
 *
 * Every figure in the product renders through this module.
 * Two screens can never disagree about how a .571 is written.
 *
 * §9.5 conventions preserved:
 * - Leading-dot for averages/percentages (.571, .278)
 * - Two decimals for ERA/WHIP (3.61, 1.34)
 * - En-dash for records (72–54)
 * - Em-dash when leading GB (—)
 * - Always signed for differentials (+38, -12)
 * - One decimal for IP (184.1)
 * - One decimal + % sign for odds (34.2%)
 */

// --- Percentage / Average ---

/**
 * Win percentage, e.g. .571. Leading dot, three decimals.
 */
export const fmtPct = (value: number): string => {
  const fixed = value.toFixed(3);
  return fixed.startsWith('0.') ? fixed.slice(1) : fixed;
};

/**
 * Batting average, e.g. .278. Leading dot, three decimals.
 *
 * Deliberately not an alias of fmtPct. §9.5 lists these as two separate rows
 * because they are two different quantities that happen to share a display
 * convention today -- a slugging percentage and a winning percentage are not
 * the same stat, and nothing prevents one of them from needing a different
 * number of decimals later. Aliasing them would quietly make that change a
 * two-line edit in a screen instead of a one-line edit here.
 */
export const fmtAvg = (value: number): string => {
  const fixed = value.toFixed(3);
  return fixed.startsWith('0.') ? fixed.slice(1) : fixed;
};

// --- Pitching ---

/** 3.61 — two decimals */
export const fmtEra = (value: number): string => value.toFixed(2);

/** 1.34 — two decimals */
export const fmtWhip = (value: number): string => value.toFixed(2);

/** 184.1 — one decimal */
export const fmtIp = (value: number): string => value.toFixed(1);

// --- Records & Standings ---

/** 72–54 — en-dash, no space */
export const fmtRecord = (wins: number, losses: number): string =>
  `${wins}–${losses}`;

/** 3.0 or — (em-dash when leading) */
export const fmtGb = (gb: number): string =>
  gb <= 0 ? '—' : gb.toFixed(1);

/** +38 / -12 — always signed */
export const fmtDiff = (diff: number): string =>
  diff >= 0 ? `+${diff}` : `${diff}`;

/** 34.2% — one decimal + percent sign */
export const fmtOdds = (pct: number): string =>
  `${pct.toFixed(1)}%`;

/**
 * @deprecated Use `fmtAvg`. Retained because five screens that are still on the
 * pre-system styling -- GameScreen, HomeDashboard, LeadersHub, PlayersHub,
 * TeamsHub -- import this name, and deleting it would break the build before
 * those screens are migrated in Phase 3. Remove it when the last one lands.
 */
export const formatBattingAverage = fmtAvg;