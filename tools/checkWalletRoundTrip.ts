/**
 * Does `resolvesOn` survive a save/load round trip?
 *
 * Not assumed. `loadWallet` validates with `isWallet`, which is a SHALLOW check -- it
 * only tests that `balance` is a number and `bets` is an array -- and then returns
 * `parsed.bets` untouched. That should carry every field through, including one added
 * today, but "should" is exactly the word that has preceded every silent-drop bug in
 * this project: a validator that rejects, or a load path that rebuilds each bet from a
 * whitelist, would drop the field and leave the open-bets list printing "No resolution
 * date recorded" on a bet that has one.
 *
 * So this drives the real functions through a real serialise/parse cycle with a stub
 * localStorage, and asserts the field comes back.
 *
 * Run: npx tsx tools/checkWalletRoundTrip.ts
 */

import {
  createWallet,
  loadWallet,
  placeBet,
  saveWallet,
  type Wallet,
} from '../src/lib/wallet';

/** Minimal localStorage stand-in. The wallet only ever calls getItem/setItem/removeItem. */
const installFakeStorage = (): Map<string, string> => {
  const store = new Map<string, string>();
  (globalThis as unknown as { localStorage: unknown }).localStorage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => { store.set(key, value); },
    removeItem: (key: string) => { store.delete(key); },
  };
  return store;
};

const main = (): void => {
  const store = installFakeStorage();

  const start: Wallet = createWallet();
  const result = placeBet(start, {
    kind: 'prop',
    marketKey: 'g-2026-04-14-balt-cleve',
    marketTitle: 'Quincy Hollis Over 1.5 Hits',
    selection: 'over',
    selectionLabel: 'Over 1.5 Hits',
    stake: 50,
    price: -110,
    placedOn: '2026-04-12',
    resolvesOn: '2026-04-14',
    backedMedia: null,
    propStat: 'hits',
    propPlayerId: 'p-1',
    propPlayerName: 'Quincy Hollis',
    propLine: 1.5,
  });
  // `placeBet` returns a union, and the error arm is unreachable here because the
  // stake is above MIN_STAKE and below the starting balance. Asserted rather than
  // cast, so this tool fails loudly if that ever stops being true.
  if (!('wallet' in result)) {
    console.log(`\n  FAIL  placeBet refused the bet: ${result.error}`);
    process.exitCode = 1;
    return;
  }

  saveWallet(result.wallet);

  const wallet = result.wallet;
  const raw = store.get('gpb_betting_wallet_v1') ?? '';
  const loaded = loadWallet();

  const checks: Array<{ name: string; ok: boolean; detail: string }> = [
    {
      name: 'the field is written to storage at all',
      ok: raw.includes('"resolvesOn":"2026-04-14"'),
      detail: raw.includes('resolvesOn') ? 'present in serialised JSON' : 'ABSENT from serialised JSON',
    },
    {
      name: 'it survives the load',
      ok: loaded.bets[0]?.resolvesOn === '2026-04-14',
      detail: `loaded value: ${String(loaded.bets[0]?.resolvesOn)}`,
    },
    {
      name: 'the balance and bet count are unchanged',
      ok: loaded.balance === wallet.balance && loaded.bets.length === 1,
      detail: `balance ${loaded.balance}, ${loaded.bets.length} bet(s)`,
    },
    {
      name: 'the prop terms still survive too',
      ok: loaded.bets[0]?.propPlayerName === 'Quincy Hollis' && loaded.bets[0]?.propLine === 1.5,
      detail: `player ${String(loaded.bets[0]?.propPlayerName)}, line ${String(loaded.bets[0]?.propLine)}`,
    },
  ];

  // A bet written before the field existed must load, and must NOT acquire a date.
  const legacy = { balance: 1000, bets: [{ ...loaded.bets[0], resolvesOn: undefined }] };
  store.set('gpb_betting_wallet_v1', JSON.stringify(legacy));
  const fromLegacy = loadWallet();
  checks.push({
    name: 'a pre-existing bet still loads rather than being rejected',
    ok: fromLegacy.bets.length === 1,
    detail: `${fromLegacy.bets.length} bet(s) loaded`,
  });
  checks.push({
    name: 'and it does not acquire a fabricated date',
    ok: fromLegacy.bets[0]?.resolvesOn === undefined,
    detail: `resolvesOn is ${String(fromLegacy.bets[0]?.resolvesOn)}`,
  });

  console.log('\nWALLET ROUND TRIP -- does resolvesOn persist?\n');
  let failed = 0;
  checks.forEach((check, index) => {
    if (!check.ok) failed += 1;
    console.log(`  ${check.ok ? 'PASS' : 'FAIL'}  ${index + 1}. ${check.name}`);
    console.log(`        ${check.detail}`);
  });
  console.log(`\n  ${checks.length - failed}/${checks.length} checks PASS\n`);
  if (failed > 0) process.exitCode = 1;
};

main();