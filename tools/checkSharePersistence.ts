/**
 * Does the share-price ledger survive a save/load, and are bet ids deterministic?
 *
 * ===========================================================================
 * WHY THIS IS A SEPARATE TOOL FROM checkSharePrice
 * ===========================================================================
 *
 * That one asks whether the price path is a market. This one asks whether the market SURVIVES being
 * written to disk and reloaded, and whether the bet ids next to it are facts or accidents.
 *
 * Both questions have the same underlying stakes, which the design discussion calls out directly: a
 * reloaded save must show the same market. A perfectly deterministic price path that gets coerced
 * on the way back out of a save is not deterministic in any sense a player would recognise.
 *
 * ===========================================================================
 * THE LOadER DROPS BAD DAYS RATHER THAN REPAIRING THEM, AND THAT IS ASSERTED
 * ===========================================================================
 *
 * A malformed day is DROPPED, not repaired. The difference is not stylistic. Repairing invents a
 * price nobody traded at, and this ledger is the record of what the market did. Dropping leaves a
 * gap, which is honest, and the series resumes from the last good day.
 *
 * So the checks below assert that specific corrupt inputs come out ABSENT rather than coerced into
 * plausible numbers. A reader that quietly substituted a default would pass a "does it load" test
 * and put a fabricated price on a chart.
 *
 * ===========================================================================
 * THE BET ID, AND WHY `bets.length` WAS NOT GOOD ENOUGH
 * ===========================================================================
 *
 * `removeBet` in `useBettingSlip` voids open bets and filters them out of the array, so the length
 * is not monotonic. Place a bet, void it, place another, and a length-derived id repeats one that
 * `removeBet` will look up BY ID -- refunding the wrong stake or voiding the wrong bet.
 *
 * The check reproduces exactly that sequence. It is the case a reader would not think to test and
 * the one that costs a player money.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  createLocalUniverseBundle,
  readSharePriceLedger,
  validateLocalUniverseBundle,
  type LocalUniverseBundle,
} from '../src/logic/localUniverseState';
import { createWallet, placeBet, type Wallet } from '../src/lib/wallet';
import { PRICE_MAX, PRICE_MIN, type PriceSeries } from '../src/lib/analytics/sharePrice';

const checks: Array<{ label: string; pass: boolean; detail?: string }> = [];
const check = (label: string, pass: boolean, detail?: string): void => {
  checks.push({ label, pass, detail });
};

const iso = (d: number): string => new Date(Date.UTC(2026, 3, 1 + d)).toISOString().slice(0, 10);

const sampleLedger = (): PriceSeries[] => [
  { date: iso(0), close: { a: 500, b: 520.5 } },
  { date: iso(1), close: { a: 512.25, b: 498 } },
  { date: iso(2), close: { a: 487.5, b: 505.125 } },
];

const main = (): void => {
  // -- 1. every existing save loads ---------------------------------------------------------
  check(
    'a save with no price ledger at all reads as empty rather than failing',
    readSharePriceLedger(undefined).length === 0
      && readSharePriceLedger(null).length === 0
      && readSharePriceLedger({}).length === 0,
    'absence means the market has not traded yet, not a broken save -- which is why the field is '
    + 'optional and additive and needs no migration',
  );

  const roundTrip = readSharePriceLedger(JSON.parse(JSON.stringify(sampleLedger())));
  check(
    'a well-formed ledger survives a JSON round trip unchanged',
    JSON.stringify(roundTrip) === JSON.stringify(sampleLedger()),
    JSON.stringify(roundTrip) === JSON.stringify(sampleLedger())
      ? `${roundTrip.length} days and ${Object.keys(roundTrip[0].close).length} closes preserved exactly`
      : `got ${JSON.stringify(roundTrip)}`,
  );

  // -- 2. bad days are DROPPED, not repaired -------------------------------------------------
  /*
    Each of these is a day the reader must refuse. The assertion is that the entry is ABSENT, not
    that it came back with a default -- a reader that substituted a number would put a price on a
    chart that no price path could have produced.
  */
  const corrupt: Array<{ label: string; entry: unknown }> = [
    { label: 'a non-ISO date', entry: { date: 'April 1st', close: { a: 500 } } },
    { label: 'a missing date', entry: { close: { a: 500 } } },
    { label: 'a non-object close', entry: { date: iso(5), close: 'up' } },
    { label: 'a NaN close', entry: { date: iso(5), close: { a: Number.NaN } } },
    { label: 'a null close', entry: { date: iso(5), close: { a: null } } },
    { label: 'a close above the band', entry: { date: iso(5), close: { a: PRICE_MAX + 1 } } },
    { label: 'a close below the band', entry: { date: iso(5), close: { a: PRICE_MIN - 1 } } },
    { label: 'a non-numeric close', entry: { date: iso(5), close: { a: '500' } } },
    { label: 'a day whose every club was corrupt', entry: { date: iso(5), close: { a: Number.NaN, b: Number.NaN } } },
    { label: 'an entry that is not an object at all', entry: 'closed at 500' },
  ];
  const droppedCleanly = corrupt.filter((c) => readSharePriceLedger([c.entry]).length === 0);
  check(
    'every malformed day is DROPPED, and none is coerced into a plausible-looking price',
    droppedCleanly.length === corrupt.length,
    droppedCleanly.length === corrupt.length
      ? `${corrupt.length} corruption kinds all refused: ${corrupt.map((c) => c.label).join(', ')}. `
      + 'Repairing a bad day would invent a price nobody traded at; dropping it leaves an honest gap.'
      : `ACCEPTED: ${corrupt.filter((c) => !droppedCleanly.includes(c)).map((c) => c.label).join(', ')}`,
  );

  const partial = readSharePriceLedger([{ date: iso(0), close: { a: 500, b: Number.NaN, c: 480 } }]);
  check(
    'a day with SOME corrupt clubs keeps the good ones rather than discarding the whole day',
    partial.length === 1 && Object.keys(partial[0].close).join() === 'a,c',
    `read ${JSON.stringify(partial[0]?.close)}. Two of three clubs were usable, and a chart showing only `
    + 'them is more truthful than a day with a fabricated value where the gap was.',
  );

  // -- 3. ordering and duplicates -------------------------------------------------------------
  const shuffled = readSharePriceLedger([
    { date: iso(3), close: { a: 1 } }, { date: iso(1), close: { a: 2 } }, { date: iso(2), close: { a: 3 } },
  ]);
  check(
    'days come back in ascending date order whatever order they were saved in',
    shuffled.map((d) => d.date).join() === [iso(1), iso(2), iso(3)].join(),
    `read as ${shuffled.map((d) => d.date).join(', ')}. A caller must be able to treat the LAST entry as `
    + 'today without sorting every render.',
  );

  const duplicated = readSharePriceLedger([
    { date: iso(1), close: { a: 100 } },
    { date: iso(1), close: { a: 250 } },
  ]);
  check(
    'a re-saved day collapses to the LAST value, not the first',
    duplicated.length === 1 && duplicated[0].close.a === 250,
    duplicated.length === 1
      ? `kept close ${duplicated[0].close.a}. A day that was re-simulated is more recent than the copy it replaced.`
      : `kept ${duplicated.length} days with the same date, so "the last entry is today" is false`,
  );

  // -- 4. the bundle carries it, and defaults it honestly -------------------------------------
  const stub = { league: {}, players: {}, seasonHistory: [], pendingTrades: [], offseasonWorkflow: {}, draftCenter: {} };
  const noLedger = createLocalUniverseBundle(stub as unknown as Omit<LocalUniverseBundle, 'format' | 'version' | 'exportedAt'>);
  check(
    'a bundle built without a ledger gets an empty array, not undefined',
    Array.isArray(noLedger.sharePriceLedger) && noLedger.sharePriceLedger.length === 0,
    `sharePriceLedger is ${JSON.stringify(noLedger.sharePriceLedger)}. An explicit undefined would have `
    + 'overwritten the default and left the save carrying a missing field it was supposed to have.',
  );

  const withLedger = createLocalUniverseBundle({
    ...stub,
    sharePriceLedger: sampleLedger(),
  } as unknown as Omit<LocalUniverseBundle, 'format' | 'version' | 'exportedAt'>);
  check(
    'and a bundle built WITH one keeps every day',
    withLedger.sharePriceLedger?.length === sampleLedger().length,
    `${withLedger.sharePriceLedger?.length} days`,
  );

  // -- 5. a malformed ledger WARNS rather than refusing the save ------------------------------
  const brokenBundle = { ...stub, format: 'nope', version: 0, exportedAt: 'x', sharePriceLedger: 'not an array' };
  const validation = validateLocalUniverseBundle(brokenBundle);
  const priceWarning = validation.warnings.some((w) => /price ledger/i.test(w));
  const priceIsError = validation.errors.some((e) => /price/i.test(e));
  check(
    'a malformed ledger produces a WARNING and not an error',
    priceWarning && !priceIsError,
    `warnings: ${validation.warnings.filter((w) => /price/i.test(w)).join(' | ') || '(none)'}. `
    + 'Refusing to load an entire league over a corrupt price would be a far worse outcome than a chart with a gap.',
  );

  // -- 6. the bet id is a fact about the save, not about the clock ----------------------------
  /*
    `Date.now` and `Math.random` are poisoned first, for the same reason the price path poisons
    `Math.random`: an id drawn from the clock is a fact about when the save was written, and two
    devices would disagree about whether a bet happened once or twice.
   */
  const realRandom = Math.random;
  const realNow = Date.now;
  let clockUsed = '';
  (Math as unknown as { random: () => number }).random = () => { clockUsed = 'Math.random'; throw new Error('unseeded Math.random in betId'); };
  (Date as unknown as { now: () => number }).now = () => { clockUsed = 'Date.now'; throw new Error('Date.now in betId'); };

  let placed: Wallet = createWallet();
  let betError = '';
  const ids: string[] = [];
  try {
    for (let i = 0; i < 40; i += 1) {
      const result = placeBet(placed, {
        kind: 'moneyline', marketKey: `game-${i}`, marketTitle: `Game ${i}`,
        selection: { side: 'home', line: null }, selectionLabel: 'Home',
        stake: 10, price: -110, placedOn: iso(0),
      } as never);
      if ('error' in result) { betError = result.error; break; }
      placed = result.wallet;
      ids.push(result.bet.id);
    }
  } catch (e) {
    betError = (e as Error).message;
  } finally {
    (Math as unknown as { random: () => number }).random = realRandom;
    (Date as unknown as { now: () => number }).now = realNow;
  }
  check(
    'forty bets place with both Math.random and Date.now replaced by throwers',
    betError === '' && ids.length === 40,
    betError !== '' ? `it reached for ${clockUsed}: ${betError}` : `${ids.length} bets placed with the clock poisoned`,
  );

  check(
    'every id is unique',
    new Set(ids).size === ids.length,
    `${new Set(ids).size} distinct ids from ${ids.length} bets${new Set(ids).size === ids.length ? '' : ' -- DUPLICATES'}`,
  );

  /*
    THE CASE THAT KILLED `bets.length`.
    Place a bet, void it, place another. A length-derived id repeats the voided bet's id, and
    `removeBet` looks bets up BY ID -- so this is a wrong-stake refund, not a cosmetic collision.

    THE FIRST VERSION OF THIS CHECK WAS VACUOUS. It asked whether the new id matched any id in
    `afterVoid.bets`, and that array is empty by construction, so `.some()` was always false and the
    check passed whatever the id scheme did. It could not fail for the thing it was about.

    The real property is that the NEW id differs from the VOIDED one -- the voided bet is gone, so
    it cannot be found by scanning for it. And for the test to mean anything the precondition has to
    hold: the wallet must be back to its starting length, which is precisely the condition that
    makes `bets.length` unsafe. Both are asserted, so a length-derived scheme fails here.
   */
  const first = placeBet(createWallet(), {
    kind: 'moneyline', marketKey: 'g1', marketTitle: 'G1', selection: { side: 'home', line: null },
    selectionLabel: 'Home', stake: 10, price: -110, placedOn: iso(0),
  } as never);
  const afterFirst = 'error' in first ? null : first.wallet;
  // Exactly what `removeBet` does: refund the stake and filter the bet out.
  const afterVoid = afterFirst
    ? { balance: afterFirst.balance + 10, bets: afterFirst.bets.filter(() => false), nextBetNumber: afterFirst.nextBetNumber }
    : null;
  const second = afterVoid
    ? placeBet(afterVoid, {
      kind: 'moneyline', marketKey: 'g2', marketTitle: 'G2', selection: { side: 'home', line: null },
      selectionLabel: 'Home', stake: 10, price: -110, placedOn: iso(0),
    } as never)
    : null;
  const voidedId = first && !('error' in first) ? first.bet.id : '';
  const nextId = second && !('error' in second) ? second.bet.id : '';
  check(
    'voiding a bet returns the wallet to its starting LENGTH while the id counter is untouched',
    afterVoid !== null && afterVoid.bets.length === 0 && afterVoid.nextBetNumber === afterFirst?.nextBetNumber,
    afterVoid !== null && afterFirst
      ? `after voiding ${voidedId} the wallet holds ${afterVoid.bets.length} bets but its counter is still `
      + `${afterVoid.nextBetNumber}, unchanged by the void. The length is a trap and the counter is not: `
      + 'removeBet looks bets up BY ID, so a repeated id would refund the wrong stake.'
      : 'could not place the first bet',
  );
  check(
    'and the next bet gets an id that differs from the voided one',
    nextId !== '' && voidedId !== '' && nextId !== voidedId,
    `voided ${voidedId}, next bet got ${nextId}. removeBet looks bets up BY ID, so a reused id would `
    + 'refund the wrong stake or void the wrong bet.',
  );

  check(
    'the same wallet state always yields the same next id',
    (() => {
      const w = createWallet();
      const a = placeBet(w, { kind: 'moneyline', marketKey: 'g', marketTitle: 'G', selection: { side: 'home', line: null }, selectionLabel: 'H', stake: 10, price: -110, placedOn: iso(0) } as never);
      if ('error' in a) return false;
      const b = placeBet(w, { kind: 'moneyline', marketKey: 'g', marketTitle: 'G', selection: { side: 'home', line: null }, selectionLabel: 'H', stake: 10, price: -110, placedOn: iso(0) } as never);
      return !('error' in b) && a.bet.id === b.bet.id;
    })(),
    'two identical calls from identical state produce identical ids, which is what makes the id a fact about the save',
  );

  // -- 7. legacy ids are left alone and cannot collide -----------------------------------------
  const legacyWallet: Wallet = {
    balance: 1000,
    bets: [
      { id: 'mdk3n2-8f2a1', kind: 'moneyline', marketKey: 'old', marketTitle: 'Old', selection: { side: 'home', line: null }, selectionLabel: 'H', stake: 10, price: -110, placedOn: iso(0), status: 'settled', payout: 0 },
      { id: 'mdk3n3-zz91qq', kind: 'moneyline', marketKey: 'old2', marketTitle: 'Old2', selection: { side: 'home', line: null }, selectionLabel: 'H', stake: 10, price: -110, placedOn: iso(0), status: 'settled', payout: 0 },
    ],
  } as unknown as Wallet;
  const onLegacy = placeBet(legacyWallet, {
    kind: 'moneyline', marketKey: 'new', marketTitle: 'New', selection: { side: 'home', line: null },
    selectionLabel: 'Home', stake: 10, price: -110, placedOn: iso(0),
  } as never);
  const legacySafe = !('error' in onLegacy)
    && !legacyWallet.bets.some((b) => b.id === onLegacy.bet.id)
    && /^bet-\d+$/.test(onLegacy.bet.id);
  check(
    'a wallet holding only pre-existing ids still gets a fresh, non-colliding one',
    legacySafe,
    !('error' in onLegacy)
      ? `legacy ids ${legacyWallet.bets.map((b) => b.id).join(', ')} -> new id ${onLegacy.bet.id}. `
      + 'Legacy ids do not parse as `bet-<n>`, so they are ignored by the scan and cannot collide.'
      : 'could not place a bet on a legacy wallet',
  );

  // -- 8. the source itself carries the invariant --------------------------------------------
  /*
    A behavioural check cannot stop someone deleting `nextBetNumber` from the void path -- it would
    only fail on the NEXT void. So the call site is read directly, comment-stripped so the prose
    cannot satisfy it, the same pattern `checkBettingCardShape` uses.
   */
  const hookSource = readFileSync(resolve(process.cwd(), 'src', 'hooks', 'useBettingSlip.ts'), 'utf8');
  const hookBody = hookSource.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  check(
    'the void path carries the id counter rather than dropping it',
    /nextBetNumber:\s*current\.nextBetNumber/.test(hookBody),
    'SCRIPPED THE MATCH IN src/hooks/useBettingSlip.ts. If the void stops carrying the counter, the next '
    + 'bet reuses the voided number and removeBet -- which looks bets up by id -- refunds the wrong stake.',
  );

  /*
    ===========================================================================
    THE FLAT-KEY PATH, WHICH WAS UNTESTED AND IS WHY ALL OF THE ABOVE SHIPPED GREEN
    ===========================================================================

    Every check above exercises `LocalUniverseBundle` -- the MANUAL backup/restore path. The product
    does not use it. At runtime the league is saved as flat `glb_*` keys and read back by
    `loadLocalLeagueStateAsync`, and the ledger was not in that set at all.

    So the suite was 16/16 green, in CI, while the feature it was written to protect did not work.
    A check that cannot fail for the thing it is about is worse than no check, so these are the ones
    that matter.

    Two distinct defects lived in this path, and both were invisible to every behavioural check above:

      1. The loader reads IndexedDB FIRST and returns early if it holds anything; localStorage is
         consulted only when IndexedDB is completely empty. A ledger written to localStorage alone
         is therefore invisible to every league that has ever been played.

      2. `raw` holds UNPARSED strings. `readSharePriceLedger` takes `unknown` and answers
         `Array.isArray(value) ? ... : []`, so handing it the raw text returned an empty ledger for
         every save. The key could be present, correct, and 7 days long in both stores and still
         reach the page as "No prices yet".

    These are SOURCE-WIRING assertions, and they are labelled as such. They measure that the wiring
    exists; they do not measure that the market works. The browser round-trip is what measures that,
    and it is not reproducible in Node.
  */

  const storageSource = readFileSync(resolve(process.cwd(), 'src', 'lib', 'storage.ts'), 'utf8');
  const storageBody = storageSource.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  const bootstrapSource = readFileSync(resolve(process.cwd(), 'src', 'hooks', 'useLeagueBootstrap.ts'), 'utf8');
  const bootstrapBody = bootstrapSource.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  const appSource = readFileSync(resolve(process.cwd(), 'src', 'App.tsx'), 'utf8');
  const appBody = appSource.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

  check(
    'the ledger key is in the flat-key READ MANIFEST, not only the bundle',
    /LOCAL_LEAGUE_STATE_KEYS[\s\S]{0,400}?STORAGE_KEYS\.sharePriceLedger/.test(storageBody),
    'If the key is not in LOCAL_LEAGUE_STATE_KEYS the loader never even asks for it, and the ledger is '
    + 'written and never read. This is the original defect: the key existed and was never loaded.',
  );

  check(
    'the ledger text is PARSED before the reader sees it',
    /sharePriceLedger:\s*readSharePriceLedger\(\s*parseJson/.test(storageBody),
    'SCRIPPED THE MATCH IN src/lib/storage.ts. `raw` holds strings and readSharePriceLedger answers '
    + 'Array.isArray(value) ? ... : [], so unparsed text silently becomes an empty ledger for every save.',
  );

  check(
    'the ledger is written to IndexedDB as well as localStorage',
    /writeIndexedDbValues\(\[\[STORAGE_KEYS\.sharePriceLedger/.test(storageBody),
    'SCRIPPED THE MATCH IN src/lib/storage.ts. loadLocalLeagueStateAsync reads IndexedDB first and '
    + 'returns early, so a localStorage-only write is invisible to any league that has been played.',
  );

  check(
    'the loader hands the parsed ledger to the strict reader',
    /readSharePriceLedger\(\s*parseJson<unknown>\(raw\[STORAGE_KEYS\.sharePriceLedger\]\)\s*\)/.test(storageBody),
    'The parse and the strict reader must be composed at the call site; either alone loses the ledger.',
  );

  check(
    'the loader restores the ledger into the app',
    /onRestorePriceLedger\?\s*:\s*\(ledger: PriceSeries\[\]\)\s*=>\s*void/.test(bootstrapBody)
    && /onRestorePriceLedger\(localState\.sharePriceLedger\)/.test(bootstrapBody),
    'SCRIPPED THE MATCH IN src/hooks/useLeagueBootstrap.ts. Without the restore leg the save is written '
    + 'and read and then thrown away, which is precisely the bug this whole change exists to fix.',
  );

  check(
    'App.tsx passes the restorer',
    /onRestorePriceLedger:\s*setPriceLedger/.test(appBody),
    'SCRIPPED THE MATCH IN src/App.tsx. The hook accepts the restorer but nothing supplies it.',
  );

  check(
    'the saver effect does NOT treat undefined as empty',
    /if\s*\(\s*!priceLedger\s*\)\s*\{[\s\S]{0,200}?return[\s\S]{0,120}?saveSharePriceLedger\(priceLedger\)/.test(appBody),
    'SCRIPPED THE MATCH IN src/App.tsx. The effect runs once on mount BEFORE the async loader has '
    + 'restored anything, so writing `?? []` there deletes the saved key on every reload and the market '
    + 'can never survive one. undefined means "not yet known"; only [] may clear it.',
  );

  // The reader's contract, asserted directly rather than inferred from its caller.
  check(
    'the strict reader refuses raw JSON TEXT, which is why the caller must parse',
    readSharePriceLedger(JSON.stringify(sampleLedger())).length === 0,
    'If readSharePriceLedger ever starts accepting strings, the parseJson at the call site becomes dead '
    + 'code and the composition above can no longer be trusted to be doing anything.',
  );

  // -- report ---------------------------------------------------------------------------------
  const failed = checks.filter((c) => !c.pass);
  console.log('\nSHARE PRICE PERSISTENCE AND BET IDS\n');
  console.log(`  ledger read back  ${roundTrip.length} days, ${Object.keys(roundTrip[0]?.close ?? {}).length} closes per day`);
  console.log(`  corruption kinds refused  ${droppedCleanly.length}/${corrupt.length}`);
  console.log(`  bet ids placed  ${ids.length}, distinct ${new Set(ids).size}`);
  console.log(`  id format      ${ids[0] ?? '(none)'}\n`);
  checks.forEach((c, i) => {
    console.log('  ' + (c.pass ? 'PASS' : 'FAIL') + '  ' + String(i + 1).padStart(2) + '. ' + c.label);
    if (!c.pass && c.detail) console.log('          ' + c.detail);
  });
  console.log('\n  ' + (checks.length - failed.length) + '/' + checks.length + ' checks PASS\n');
  if (failed.length > 0) process.exitCode = 1;
};

main();
