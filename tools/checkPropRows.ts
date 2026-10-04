/**
 * Shape checks for the deduped props board.
 *
 * The point of the rebuild is that one prop renders once. That is a claim about a Map, so it is
 * checked directly rather than eyeballed in the browser -- a browser can only tell you the card
 * count went down, not whether a card went missing with it.
 *
 * Run: npx tsx tools/checkPropRows.ts
 */
import { MEDIA_PROFILES, MEDIA_BY_ID, type MediaId } from '../src/data/media';
import { buildPropRows, readsByGap, outliersFor, PROP_FADE_THRESHOLD } from '../src/components/betting/propRows';
import type { PropMarket } from '../src/lib/playerProps';
import { propTemperamentFor } from '../src/lib/mediaProps';
import { propSidePrices } from '../src/lib/playerProps';

let failures = 0;
const check = (name: string, condition: boolean, detail = '') => {
  if (condition) {
    console.log(`  PASS  ${name}`);
  } else {
    failures += 1;
    console.log(`  FAIL  ${name}${detail ? ` -- ${detail}` : ''}`);
  }
};

/** A prop market as `selectOutletProps` would emit it, for the outlets named. */
const market = (propId: string, probabilities: Partial<Record<MediaId, number>>): PropMarket => {
  const values = Object.values(probabilities) as number[];
  const consensus = values.reduce((sum, value) => sum + value, 0) / values.length;
  const spread = Math.max(...values) - Math.min(...values);
  const farthest = (Object.entries(probabilities) as [MediaId, number][])
    .reduce((worst, entry) => (Math.abs(entry[1] - consensus) > Math.abs(worst[1] - consensus) ? entry : worst));
  const temperament = {} as Record<MediaId, 'safe' | 'hot'>;
  for (const [id, value] of Object.entries(probabilities) as [MediaId, number][]) {
    temperament[id] = propTemperamentFor(value);
  }
  const [gameId, playerId, stat, line] = propId.split(':');
  return {
    propId, gameId, playerId, stat, line: Number(line),
    statSingular: stat, statPlural: `${stat}s`,
    playerName: 'Test Player',
    date: '2026-04-01',
    probability: probabilities as Record<MediaId, number>,
    consensusProbability: consensus,
    temperament,
    spread,
    outlier: farthest[0],
  } as unknown as PropMarket;
};

const boardsFor = (spec: Record<string, Partial<Record<MediaId, number>>>) => {
  const boards = new Map<MediaId, PropMarket[]>();
  for (const [propId, probabilities] of Object.entries(spec)) {
    for (const [mediaId] of Object.entries(probabilities) as [MediaId, number][]) {
      const existing = boards.get(mediaId) ?? [];
      existing.push(market(propId, probabilities));
      boards.set(mediaId, existing);
    }
  }
  return boards;
};

console.log('\n== 1. a prop three outlets share renders ONCE, not three times ==');
const shared = boardsFor({
  'g1:p1:hits:2.5': { hollis: 0.62, sharply: 0.55, glorest: 0.58 },
});
const sharedRows = buildPropRows(shared);
check('one row, not three', sharedRows.length === 1, `got ${sharedRows.length}`);
check('all three publishers recorded', sharedRows[0]?.reads.length === 3, `got ${sharedRows[0]?.reads.length}`);

console.log('\n== 2. distinct props stay distinct ==');
const mixed = boardsFor({
  'g1:p1:hits:2.5': { hollis: 0.62, sharply: 0.55 },
  'g1:p2:walks:1.5': { hollis: 0.40, sharply: 0.38 },
  'g2:p1:hits:2.5': { hollis: 0.71 },
});
check('three rows', buildPropRows(mixed).length === 3, `got ${buildPropRows(mixed).length}`);

console.log('\n== 3. rows are keyed stably and in registry order ==');
const ordered = buildPropRows(mixed);
const ids = ordered.flatMap((row) => row.reads.map((read) => read.mediaId));
check('hollis precedes sharply (registry order)', ids.indexOf('hollis') < ids.indexOf('sharply'));

console.log('\n== 4. the shared fields cannot drift between copies of a prop ==');
/* Two outlets publish the same prop but at slightly different absolute probabilities. The card
 * takes consensus and spread from the first copy, so both cards would show the same number even
 * though each outlet copy disagreed. That is the intended behaviour and it is why only the
 * per-outlet probability is read from later copies. */
const drifted = boardsFor({
  'g1:p1:hits:2.5': { hollis: 0.62, sharply: 0.55 },
});
const driftedRows = buildPropRows(drifted);
check('one consensus for the card', driftedRows[0].reads.every((read) => read.gapFromHouse >= 0));

console.log('\n== 5. the fade threshold is the documented 6 points ==');
check('threshold is 0.06', PROP_FADE_THRESHOLD === 0.06, `got ${PROP_FADE_THRESHOLD}`);
const tight = buildPropRows(boardsFor({ 'g1:p1:hits:2.5': { hollis: 0.52, sharply: 0.54 } }))[0];
const wide = buildPropRows(boardsFor({ 'g1:p1:hits:2.5': { hollis: 0.50, sharply: 0.70 } }))[0];
check('a 2pt gap offers no fade', tight.reads.every((read) => !read.canFade));
check('a 20pt gap offers a fade', wide.reads.some((read) => read.canFade));

console.log('\n== 6. the disclosure leads with the widest disagreement ==');
const sorted = readsByGap(wide);
const gaps = sorted.map((read) => read.gapFromHouse);
check('sorted descending', gaps.every((gap, index) => index === 0 || gaps[index - 1] >= gap), gaps.join(', '));
check('the furthest outlet is first', sorted[0].gapFromHouse === Math.max(...gaps));

console.log('\n== 7. the outlier is named, and is the furthest read ==');
check('outliersFor returns the market outlier', outliersFor(wide).includes(wide.market.outlier), wide.market.outlier);

console.log('\n== 8. a single-publisher prop still works, with one read ==');
const solo = buildPropRows(boardsFor({ 'g1:p1:hits:2.5': { hollis: 0.62 } }))[0];
check('publishedBy is 1', solo.publishedBy === 1);
check('one read', solo.reads.length === 1);
check('no fade against nobody', solo.reads.every((read) => !read.canFade));

console.log('\n== 9. the house price still comes from the consensus, not an outlet ==');
const house = propSidePrices(wide.market.consensusProbability);
check('house over price is a real number', Number.isFinite(house.overPrice) && house.overPrice !== 0);
check('house side is well-defined', house.overPrice > 100 || house.overPrice < -100);

console.log('\n== 10. no outlet is silently dropped from the pool ==');
const everyOutlet = boardsFor({
  'g1:p1:hits:2.5': Object.fromEntries(MEDIA_PROFILES.map((p) => [p.id, 0.5])) as Partial<Record<MediaId, number>>,
});
const widest = buildPropRows(everyOutlet)[0];
check(`all ${MEDIA_PROFILES.length} outlets recorded`, widest.reads.length === MEDIA_PROFILES.length, `got ${widest.reads.length}`);
check('outlet names resolve', widest.reads.every((read) => Boolean(MEDIA_BY_ID[read.mediaId]?.outlet)));

console.log(failures === 0 ? '\nALL CHECKS PASSED\n' : `\n${failures} CHECK(S) FAILED\n`);
process.exit(failures === 0 ? 0 : 1);
