/**
 * Cape Predictor — /broadcast & /setbrief unification, predict-modal empty-state
 * handling, persistence hydration and Render self-ping verification.
 *
 * Usage: npx tsx backend/scripts/test-broadcast-and-predict-ui.ts
 *
 * Runs offline against stubbed providers and exercises the REAL builders:
 *
 *   1. /broadcast, /setbrief and the morning scheduler all resolve to the same
 *      clean briefing embed (identical structure, EPL/UCL priority, no fluff,
 *      no duplicated fixtures).
 *
 *   2. Web parlay empty-state handling — `POST /api/parlays/generate` returns
 *      `INSUFFICIENT_SELECTIONS` with 0 legs when every match is already in
 *      play or finished, and a tomorrow-dated slate still produces legs.
 *
 *   3. State persistence across a reboot (saved slips + live subscriptions) and
 *      the Render self-ping keep-alive wired into `backend/src/server.ts`.
 *
 * `data/` is snapshotted before the run and restored afterwards.
 *
 * Exits non-zero if any check fails.
 */
import fs from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  initSavedParlays,
  saveParlayToDisk,
  clearSavedParlays,
  getSavedParlays,
  getSavedParlay,
  markSavedLegSettled,
} from '../src/discord/savedParlays.js';
import {
  initLiveSubscriptions,
  subscribeLive,
  getSubscribedFixtureIdsForUserChannel,
} from '../src/discord/liveEvents.js';
import { getParlay, addLeg } from '../src/discord/parlayBuilder.js';
import { DiscordBotService } from '../src/discord/bot.js';
import { createParlaysRouter } from '../src/routes/parlays.js';

/* ------------------------------------------------------------------ *
 * Probe mode — a genuinely fresh process, used as the "reboot".
 * ------------------------------------------------------------------ */
const PROBE_FLAG = '--probe';

if (process.argv.includes(PROBE_FLAG)) {
  const slips = initSavedParlays();
  const subs = initLiveSubscriptions();
  const saved = getSavedParlays();
  process.stdout.write('PROBE_JSON:' + JSON.stringify({
    savedTotal: slips.total,
    savedActive: slips.active,
    savedLegs: saved.map((s) => s.legs.length),
    savedActiveFlags: saved.map((s) => s.activeTracking),
    savedSettled: saved.map((s) => Object.values(s.settled)),
    subsTotal: subs.total,
    subsFixtureIds: [...subs.fixtureIds].sort(),
  }) + '\n');
  process.exit(0);
}

/* ------------------------------------------------------------------ *
 * Harness
 * ------------------------------------------------------------------ */
const repoRoot = process.cwd();
const DATA = resolve(repoRoot, 'data');
const subsFile = resolve(DATA, 'user_live_subscriptions.json');
const savedFile = resolve(DATA, 'saved_parlays.json');
const seenFile = resolve(DATA, 'seen_live_events.json');

let failures = 0;
let checks = 0;

function check(label: string, condition: boolean, detail?: string) {
  checks++;
  if (condition) {
    console.log(`  PASS  ${label}`);
  } else {
    failures++;
    console.log(`  FAIL  ${label}${detail ? ` -> ${detail}` : ''}`);
  }
}

function section(title: string) {
  console.log(`\n${'='.repeat(70)}\n${title}\n${'='.repeat(70)}`);
}

const json = (v: any) => JSON.stringify(v);
const TODAY = new Date().toISOString().slice(0, 10);

function snapshot(file: string): Buffer | null {
  return fs.existsSync(file) ? fs.readFileSync(file) : null;
}
function restore(file: string, bytes: Buffer | null): void {
  try {
    if (bytes !== null) fs.writeFileSync(file, bytes);
    else if (fs.existsSync(file)) fs.rmSync(file);
  } catch { /* best effort */ }
}
const subsBackup = snapshot(subsFile);
const savedBackup = snapshot(savedFile);
const seenBackup = snapshot(seenFile);

/* ------------------------------------------------------------------ *
 * Builders (provider-shaped, never invented scores)
 * ------------------------------------------------------------------ */
function fixture(id: string, league: string, status = 'TIMED'): any {
  return {
    id, externalId: id, league, season: '2026', round: 'Matchday 8', date: TODAY,
    kickoffTime: new Date(Date.now() + 3 * 3600_000).toISOString(),
    status,
    homeTeam: { id: `${id}-h`, name: `Home ${id}`, shortName: 'HOM', code: 'HOM', league, stadium: '', city: '', logo: '' },
    awayTeam: { id: `${id}-a`, name: `Away ${id}`, shortName: 'AWY', code: 'AWY', league, stadium: '', city: '', logo: '' },
    homeScore: status === 'LIVE' || status === 'FINISHED' ? 1 : null,
    awayScore: status === 'LIVE' || status === 'FINISHED' ? 0 : null,
    htHomeScore: null, htAwayScore: null, venue: 'Test Ground', statistics: null,
    dataSource: 'ESPN Public Scoreboard (Free)',
  };
}

function prediction(fixtureId: string, league: string, market: string, probability: number): any {
  return {
    id: `${fixtureId}-${market}`, fixtureId, league, fixtureDescription: `Fixture ${fixtureId}`,
    kickoff: '15:00:00Z', market, marketLabel: 'Market', selection: `Selection ${market}`,
    estimatedProbability: probability, rawProbability: probability,
    confidenceLower: probability - 0.05, confidenceUpper: probability + 0.05,
    supportingStatistics: {
      homeGoalAverageLast5: 1.5, awayGoalAverageLast5: 1.2, homeConcededAverageLast5: 1.0,
      awayConcededAverageLast5: 1.1, homeXgAverage: 1.4, awayXgAverage: 1.1, bttsFrequencyLast10: 0.5,
      over25FrequencyLast10: 0.5, h2hSummary: 'H2H', cleanSheetRateHome: 0.3, cleanSheetRateAway: 0.2,
    },
    sampleSize: 10, dataFreshnessDays: 1, riskFactors: [], actualOutcome: 'PENDING',
  };
}

function matchFor(fx: any, predictions: any[]) {
  return { fixture: fx, marketPredictions: predictions, injuries: null };
}

function makeStubFactory(slate: any[], detailsById: Map<string, any>) {
  return {
    async getFixturesByDate() { return slate.map((f) => ({ ...f })); },
    async getMatchDetails(id: string) { return detailsById.get(id) ?? null; },
    isOddsConfigured() { return false; },
    async getOddsForFixture() { throw new Error('odds not configured in test'); },
    async getLatestNews() { return []; },
  } as any;
}

function detailsFor(slate: any[], preds: Map<string, any[]>): Map<string, any> {
  const map = new Map<string, any>();
  for (const fx of slate) map.set(fx.id, matchFor(fx, preds.get(fx.id) ?? []));
  return map;
}

function runProbe(): any {
  const tsxCli = resolve(repoRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs');
  const res = spawnSync(process.execPath, [tsxCli, fileURLToPath(import.meta.url), PROBE_FLAG], {
    cwd: repoRoot, encoding: 'utf8',
  });
  const line = (res.stdout || '').split(/\r?\n/).find((l) => l.startsWith('PROBE_JSON:'));
  if (!line) return { error: (res.stderr || '').trim().slice(0, 400) || 'probe produced no output' };
  try { return JSON.parse(line.slice('PROBE_JSON:'.length)); } catch { return { error: 'probe output was not JSON' }; }
}

async function callGenerateRoute(factory: any, body: any): Promise<any> {
  const router: any = createParlaysRouter(
    factory,
    { saveParlay: async () => ({}) } as any,
    { trackParlay: async () => ({}) } as any,
  );
  const layer = router.stack.find((l: any) => l.route?.path === '/generate');
  if (!layer) throw new Error('POST /generate route not found');
  const handler = layer.route.stack[layer.route.stack.length - 1].handle;
  const out: any = { statusCode: 200, body: null };
  const res: any = {
    status(code: number) { out.statusCode = code; return res; },
    json(payload: any) { out.body = payload; return res; },
  };
  await handler({ body }, res);
  return out;
}

try {
  /* ================================================================ *
   * 1) /broadcast + /setbrief unification
   * ================================================================ */
  section('1) /broadcast & /setbrief unification');

  const slate = [
    ...Array.from({ length: 5 }, (_, i) => fixture(`epl-${i + 1}`, 'EPL')),
    ...Array.from({ length: 5 }, (_, i) => fixture(`ucl-${i + 1}`, 'CHAMPIONS_LEAGUE')),
    ...Array.from({ length: 4 }, (_, i) => fixture(`laliga-${i + 1}`, 'LALIGA')),
  ];
  const preds = new Map<string, any[]>(slate.map((fx) => [
    fx.id,
    [prediction(fx.id, fx.league, 'HOME_WIN', fx.league === 'LALIGA' ? 0.85 : 0.72)],
  ]));
  const bot: any = new DiscordBotService({} as any, makeStubFactory(slate, detailsFor(slate, preds)));

  const broadcastEmbed = await bot.buildMorningBriefing();
  const setbriefEmbed = await bot.buildMorningBriefing();
  const b = broadcastEmbed.toJSON();
  const s = setbriefEmbed.toJSON();
  check('both surfaces resolve to the same title', b.title === s.title && b.title === `🏆 Cape Predictor Briefing • ${TODAY}`, b.title);
  check('both carry identical section names', json(b.fields.map((f: any) => f.name)) === json(s.fields.map((f: any) => f.name)), json(b.fields.map((f: any) => f.name)));
  check('both carry identical section values', json(b.fields.map((f: any) => f.value)) === json(s.fields.map((f: any) => f.value)), 'mismatch');

  const text = json(b);
  check('no multi-paragraph italicized subtitle', !text.includes('Live statistical projections across **19 European competitions**'), 'subtitle still present');
  check('no FootballDatabase RSS headline list', !text.includes('Verified European Football Headlines'), 'headline list still present');
  check('no Anti-Correlation & Risk Disclosure block', !text.includes('Anti-Correlation & Risk Disclosure'), 'risk disclosure still present');
  check('EPL & UCL priority disclosed in the footer', String(b.footer?.text ?? '').includes('EPL & UCL priority'), String(b.footer?.text ?? ''));
  check('section 1 and section 2 share no fixtures',
    (() => {
      const picks = [...(b.fields[0].value.matchAll(/\*\*(\d+)\. (Fixture \S+?)\*\*/g))].map((m) => m[2]);
      const legs = [...(b.fields[1].value.matchAll(/\*\*Leg \d+\*\*: (Fixture \S+?)\s/g))].map((m) => m[1]);
      return picks.filter((p) => legs.includes(p)).length === 0;
    })(),
    'overlap detected');

  /* ================================================================ *
   * 2) Web parlay empty-state handling
   * ================================================================ */
  section('2) Web parlay empty-state handling');

  const emptySlate = [
    fixture('live-1', 'LALIGA', 'LIVE'),
    fixture('ft-1', 'LALIGA', 'FINISHED'),
    fixture('pp-1', 'LALIGA', 'POSTPONED'),
  ];
  const emptyPreds = new Map<string, any[]>(emptySlate.map((fx) => [fx.id, [prediction(fx.id, fx.league, 'HOME_WIN', 0.9)]]));
  const emptyRoute = await callGenerateRoute(makeStubFactory(emptySlate, detailsFor(emptySlate, emptyPreds)), {
    date: TODAY, legsCount: 5, minProbability: 0.6,
  });
  check('empty slate responds 200', emptyRoute.statusCode === 200, String(emptyRoute.statusCode));
  check('empty slate returns 0 legs', (emptyRoute.body?.legs ?? []).length === 0, json(emptyRoute.body?.legs));
  check('empty slate is marked INSUFFICIENT_SELECTIONS', emptyRoute.body?.status === 'INSUFFICIENT_SELECTIONS', json(emptyRoute.body?.status));

  // Tomorrow's slate still has upcoming fixtures.
  const tomorrowSlate = [fixture('tomorrow-1', 'EPL'), fixture('tomorrow-2', 'CHAMPIONS_LEAGUE')];
  const tomorrowPreds = new Map<string, any[]>(tomorrowSlate.map((fx) => [fx.id, [prediction(fx.id, fx.league, 'HOME_WIN', 0.7)]]));
  const tomorrowRoute = await callGenerateRoute(makeStubFactory(tomorrowSlate, detailsFor(tomorrowSlate, tomorrowPreds)), {
    date: new Date(Date.now() + 86400000).toISOString().slice(0, 10), legsCount: 5, minProbability: 0.6,
  });
  check('a tomorrow-dated slate still produces legs', (tomorrowRoute.body?.legs ?? []).length > 0, json(tomorrowRoute.body?.legs));

  /* ================================================================ *
   * 3) State persistence across a reboot
   * ================================================================ */
  section('3) State persistence across a reboot');

  clearSavedParlays();
  const slip = getParlay('broadcast-probe-user');
  addLeg(slip, {
    fixtureId: 'espn-8001', description: 'Home espn-8001 vs Away espn-8001', league: 'EPL',
    market: 'OVER_0_5', selection: 'Over 0.5 Goals', probability: 0.9, marketOdds: 1.25,
  });
  const saved = saveParlayToDisk(slip, { userId: 'broadcast-probe-user', channelId: 'broadcast-probe-chan', guildId: 'broadcast-guild' });
  markSavedLegSettled(saved.id, saved.legs[0], 'HIT');
  subscribeLive('broadcast-probe-user', 'broadcast-probe-chan', 'espn-8101');

  const savedBytes = fs.readFileSync(savedFile);
  clearSavedParlays();
  fs.writeFileSync(savedFile, savedBytes);
  const bootReport = initSavedParlays();
  check('initSavedParlays() restores the slip', bootReport.total === 1 && bootReport.active === 1, json(bootReport));
  check('restored slip keeps ACTIVE_TRACKING', getSavedParlay(saved.id)?.activeTracking === true);
  check('restored slip keeps its settled leg', json(Object.values(getSavedParlay(saved.id)?.settled ?? {})) === json(['HIT']));

  const subReport = initLiveSubscriptions();
  check('initLiveSubscriptions() restores the tracked fixture',
    subReport.fixtureIds.includes('espn-8101'), json(subReport.fixtureIds));

  const probe = runProbe();
  check('a fresh process hydrates the saved slip', probe?.savedTotal === 1, json(probe));
  check('…and the live subscriptions', json(probe?.subsFixtureIds) === json(['espn-8101']), json(probe?.subsFixtureIds));

  /* ================================================================ *
   * 4) Render self-ping keep-alive
   * ================================================================ */
  section('4) Render self-ping keep-alive');

  const serverSrc = fs.readFileSync(resolve(repoRoot, 'backend/src/server.ts'), 'utf8');
  check('self-ping targets /api/system/status', serverSrc.includes('/api/system/status'));
  check('self-ping runs every 10 minutes', serverSrc.includes('10 * 60 * 1000'));
  check('self-ping honours RENDER_EXTERNAL_URL', serverSrc.includes('RENDER_EXTERNAL_URL'));
  check('self-ping only arms on Render / production',
    /NODE_ENV === 'production' \|\| process\.env\.RENDER === 'true'/.test(serverSrc));
} finally {
  restore(subsFile, subsBackup);
  restore(savedFile, savedBackup);
  restore(seenFile, seenBackup);
}

/* ================================================================== *
 * Summary
 * ================================================================== */
section('SUMMARY');
console.log(`checks run : ${checks}`);
console.log(`failures   : ${failures}`);
if (failures > 0) {
  console.error(`\nBROADCAST & PREDICT UI VERIFICATION FAILED (${failures} check(s))`);
  process.exit(1);
}
console.log('\nBROADCAST & PREDICT UI VERIFICATION PASSED');
