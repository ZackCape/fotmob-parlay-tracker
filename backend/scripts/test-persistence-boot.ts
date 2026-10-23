/**
 * Cape Predictor — boot persistence, competition priority, pre-kickoff filtering
 * and interaction-speed verification.
 *
 * Usage: npx tsx backend/scripts/test-persistence-boot.ts
 *
 * Runs offline against stubbed providers and exercises the REAL modules:
 *
 *   1. Boot state recovery — a saved slip (legs, ACTIVE_TRACKING, settled legs)
 *      and the live subscriptions survive a process restart. The restart is not
 *      simulated in-process: the script re-runs itself as a child process
 *      (`--probe`) so a genuinely fresh module graph reads the same files, which
 *      is exactly what a Render redeploy or a scale-to-zero wake does.
 *
 *   2. Premier League / UEFA Champions League priority — the statistical parlay
 *      builder, the morning briefing, the Discord generator and the HTTP
 *      generator all rank EPL and UCL candidates ahead of secondary leagues
 *      without ever promoting a leg that fails the probability gate.
 *
 *   3. Pre-kickoff filtering — a fixture that has kicked off, a live fixture and
 *      a finished fixture can never carry a leg, on any of the three surfaces.
 *
 *   4. Interaction speed — every component branch acknowledges Discord before it
 *      touches a provider, and the acknowledgement helpers behave correctly.
 *
 *   5. The 30-second active-fixture cache window and the Render self-ping.
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
  getActiveSavedParlaysForUserChannel,
} from '../src/discord/savedParlays.js';
import {
  initLiveSubscriptions,
  subscribeLive,
  getSubscribedFixtureIdsForUserChannel,
} from '../src/discord/liveEvents.js';
import { getParlay, addLeg } from '../src/discord/parlayBuilder.js';
import { ackInteraction, editOrFollowUp } from '../src/discord/interactions.js';
import { filterPreKickoffFixtures, isPreKickoffFixture } from '../src/discord/fixtureStatus.js';
import {
  isPriorityLeague,
  canonicalPriorityId,
  competitionPriority,
  orderPredictionsByPriority,
} from '../src/utils/competitionPriority.js';
import { buildStatisticalParlay } from '../src/parlays/parlay-builder.js';
import {
  ACTIVE_FIXTURE_TTL_MS,
  isActiveFixtureDate,
  fixtureCacheTtlMs,
} from '../src/providers/provider-factory.js';
import { createParlaysRouter } from '../src/routes/parlays.js';
import { DiscordBotService } from '../src/discord/bot.js';

/* ------------------------------------------------------------------ *
 * Probe mode — a genuinely fresh process, used as the "reboot".
 * ------------------------------------------------------------------ */
const PROBE_FLAG = '--probe';

if (process.argv.includes(PROBE_FLAG)) {
  // Exactly what DiscordBotService.start() does with persisted state.
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

// Snapshot the persisted state so a developer's real slips are never touched.
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
 * Fixture / prediction builders (provider-shaped, never invented scores)
 * ------------------------------------------------------------------ */
function fixture(id: string, status: string, league: string, extra: Record<string, unknown> = {}): any {
  return {
    id,
    externalId: id,
    league,
    season: '2026',
    round: 'Matchday 8',
    date: TODAY,
    // A kick-off a few hours out, so the same fixture set works for the
    // pre-kickoff filter at whatever time of day this is run.
    kickoffTime: new Date(Date.now() + 3 * 3600_000).toISOString(),
    status,
    homeTeam: { id: `${id}-h`, name: `Home ${id}`, shortName: 'HOM', code: 'HOM', league, stadium: '', city: '', logo: '' },
    awayTeam: { id: `${id}-a`, name: `Away ${id}`, shortName: 'AWY', code: 'AWY', league, stadium: '', city: '', logo: '' },
    homeScore: status === 'LIVE' || status === 'FINISHED' ? 1 : null,
    awayScore: status === 'LIVE' || status === 'FINISHED' ? 0 : null,
    htHomeScore: null,
    htAwayScore: null,
    venue: 'Test Ground',
    statistics: null,
    dataSource: 'ESPN Public Scoreboard (Free)',
    ...extra,
  };
}

function prediction(fixtureId: string, league: string, market: string, probability: number): any {
  return {
    id: `${fixtureId}-${market}`,
    fixtureId,
    league,
    fixtureDescription: `Fixture ${fixtureId}`,
    kickoff: '23:30:00Z',
    market,
    marketLabel: 'Market',
    selection: `Selection ${market}`,
    estimatedProbability: probability,
    rawProbability: probability,
    confidenceLower: probability - 0.05,
    confidenceUpper: probability + 0.05,
    supportingStatistics: {
      homeGoalAverageLast5: 1.5, awayGoalAverageLast5: 1.2, homeConcededAverageLast5: 1.0,
      awayConcededAverageLast5: 1.1, homeXgAverage: 1.4, awayXgAverage: 1.1, bttsFrequencyLast10: 0.5,
      over25FrequencyLast10: 0.5, h2hSummary: 'H2H', cleanSheetRateHome: 0.3, cleanSheetRateAway: 0.2,
    },
    sampleSize: 10,
    dataFreshnessDays: 1,
    riskFactors: [],
    actualOutcome: 'PENDING',
  };
}

/** Stubbed provider: no network, fully deterministic. */
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
  for (const fx of slate) map.set(fx.id, { fixture: fx, marketPredictions: preds.get(fx.id) ?? [], injuries: null });
  return map;
}

/** Run this script in a fresh process and parse its probe report. */
function runProbe(): any {
  const tsxCli = resolve(repoRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs');
  const res = spawnSync(process.execPath, [tsxCli, fileURLToPath(import.meta.url), PROBE_FLAG], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  const line = (res.stdout || '').split(/\r?\n/).find((l) => l.startsWith('PROBE_JSON:'));
  if (!line) return { error: (res.stderr || '').trim().slice(0, 400) || 'probe produced no output' };
  try { return JSON.parse(line.slice('PROBE_JSON:'.length)); } catch { return { error: 'probe output was not JSON' }; }
}

/** Invoke the real /api/parlays/generate handler with a stubbed provider. */
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
   * 1) Boot state recovery — saved slips
   * ================================================================ */
  section('1) Boot state recovery — saved slips');

  clearSavedParlays();

  const userId = 'boot-probe-user';
  const channelId = 'boot-probe-channel';

  const slip = getParlay(userId);
  addLeg(slip, {
    fixtureId: 'espn-9001', description: 'Home espn-9001 vs Away espn-9001', league: 'EPL',
    market: 'OVER_0_5', selection: 'Over 0.5 Goals', probability: 0.9, marketOdds: 1.25,
  });
  addLeg(slip, {
    fixtureId: 'espn-9002', description: 'Home espn-9002 vs Away espn-9002', league: 'CHAMPIONS_LEAGUE',
    market: 'OVER_8_5_CORNERS', selection: 'Over 8.5 Corners', probability: 0.62, marketOdds: 1.9,
  });
  const saved = saveParlayToDisk(slip, { userId, channelId, guildId: 'boot-guild' });
  markSavedLegSettled(saved.id, saved.legs[0], 'HIT');

  check('slip is written with ACTIVE_TRACKING set', getSavedParlay(saved.id)?.activeTracking === true);
  check('settled leg is recorded in the slip', Object.keys(getSavedParlay(saved.id)?.settled ?? {}).length === 1);

  // Simulated restart: drop every in-memory slip, keep the file as the only truth.
  const savedBytes = fs.readFileSync(savedFile);
  clearSavedParlays();
  check('in-memory store is empty after the simulated restart', getSavedParlays().length === 0);

  fs.writeFileSync(savedFile, savedBytes);
  const bootReport = initSavedParlays();
  check('initSavedParlays() restores the slip count from disk', bootReport.total === 1 && bootReport.active === 1, json(bootReport));
  check('restored slip keeps both legs', getSavedParlay(saved.id)?.legs.length === 2);
  check('restored slip keeps ACTIVE_TRACKING', getSavedParlay(saved.id)?.activeTracking === true);
  check('restored slip keeps its settled leg', Object.keys(getSavedParlay(saved.id)?.settled ?? {}).length === 1);
  check('/track still finds the restored slip', getActiveSavedParlaysForUserChannel(userId, channelId).length === 1);

  /* ================================================================ *
   * 2) Boot state recovery — live subscriptions + the 60s live worker
   * ================================================================ */
  section('2) Boot state recovery — live subscriptions');

  subscribeLive(userId, channelId, 'espn-9101');
  subscribeLive(userId, channelId, 'espn-9102');
  subscribeLive(userId, 'boot-probe-other', 'espn-9102');

  const subReport = initLiveSubscriptions();
  check('initLiveSubscriptions() reloads the subscription file', subReport.total === 3, json(subReport));
  check('…and reports the distinct fixtures to re-arm', json([...subReport.fixtureIds].sort()) === json(['espn-9101', 'espn-9102']), json(subReport.fixtureIds));
  check('subscriptions resolve for the user/channel pair',
    json(getSubscribedFixtureIdsForUserChannel(userId, channelId).sort()) === json(['espn-9101', 'espn-9102']));

  const bot: any = new DiscordBotService({ enableHourlyUpdates: false } as any, makeStubFactory([], new Map()));
  await bot.start();
  check('start() pins the restored fixtures for the 60s live worker',
    ['espn-9101', 'espn-9102'].every((id) => bot.liveEventPinnedFixtureIds.has(id)),
    json([...bot.liveEventPinnedFixtureIds]));
  check('start() rehydrates the saved slip as well', getSavedParlay(saved.id) !== undefined);

  /* --- a genuine fresh process reads the same files --- */
  const probe = runProbe();
  check('a fresh process hydrates the saved slip', probe?.savedTotal === 1, json(probe));
  check('…and keeps the settled leg settled', json(probe?.savedSettled) === json([['HIT']]), json(probe?.savedSettled));
  check('…and keeps ACTIVE_TRACKING on', json(probe?.savedActiveFlags) === json([true]), json(probe?.savedActiveFlags));
  check('…and restores the live subscriptions', json(probe?.subsFixtureIds) === json(['espn-9101', 'espn-9102']), json(probe?.subsFixtureIds));

  /* ================================================================ *
   * 3) EPL / UCL competition priority
   * ================================================================ */
  section('3) EPL / UCL competition priority');

  check('the Premier League is a priority competition', isPriorityLeague('EPL'));
  check('the Champions League resolves from the provider slug', canonicalPriorityId('uefa.champions') === 'CHAMPIONS_LEAGUE');
  check('`eng.1` resolves to the Premier League', canonicalPriorityId('eng.1') === 'EPL');
  check('EPL ranks ahead of UCL', competitionPriority('EPL') < competitionPriority('CHAMPIONS_LEAGUE'));
  check('secondary leagues rank last', competitionPriority('LALIGA') > competitionPriority('CHAMPIONS_LEAGUE'));

  const weakPriority = [
    ...Array.from({ length: 20 }, (_, i) => prediction(`laliga-${i + 1}`, 'LALIGA', 'HOME_WIN', 0.82)),
    ...Array.from({ length: 5 }, (_, i) => prediction(`epl-${i + 1}`, 'EPL', 'HOME_WIN', 0.62)),
  ];
  const priorityParlay = await buildStatisticalParlay(weakPriority as any, { targetLegsCount: 5, minProbability: 0.6 });
  check('the builder prefers weaker EPL legs over stronger secondary-league legs',
    priorityParlay.legs.length === 5 && priorityParlay.legs.every((l) => l.league === 'EPL'),
    json(priorityParlay.legs.map((l) => l.league)));

  const unprioritised = await buildStatisticalParlay(weakPriority as any, {
    targetLegsCount: 5, minProbability: 0.6, prioritizePriorityLeagues: false,
  });
  check('prioritisation can be switched off for a pure probability pool',
    unprioritised.legs.every((l) => l.league === 'LALIGA'),
    json(unprioritised.legs.map((l) => l.league)));

  const gatePool = [
    ...Array.from({ length: 5 }, (_, i) => prediction(`epl-low-${i + 1}`, 'EPL', 'HOME_WIN', 0.5)),
    ...Array.from({ length: 5 }, (_, i) => prediction(`laliga-ok-${i + 1}`, 'LALIGA', 'HOME_WIN', 0.75)),
  ];
  const gated = await buildStatisticalParlay(gatePool as any, { targetLegsCount: 5, minProbability: 0.6 });
  check('priority never promotes a leg that fails the probability gate',
    gated.legs.length === 5 && gated.legs.every((l) => l.league === 'LALIGA'),
    json(gated.legs.map((l) => l.league)));

  const orderCheck = orderPredictionsByPriority([
    prediction('laliga-1', 'LALIGA', 'HOME_WIN', 0.9),
    prediction('ucl-1', 'CHAMPIONS_LEAGUE', 'HOME_WIN', 0.61),
    prediction('epl-1', 'EPL', 'HOME_WIN', 0.62),
  ] as any);
  check('predictions reorder to EPL, UCL, then the strongest of the rest',
    json(orderCheck.map((p) => p.fixtureId)) === json(['epl-1', 'ucl-1', 'laliga-1']),
    json(orderCheck.map((p) => p.fixtureId)));

  /* --- briefing: priority pick beats a stronger secondary-league pick --- */
  const briefSlate = [
    fixture('laliga-strong', 'TIMED', 'LALIGA'),
    fixture('epl-pick', 'TIMED', 'EPL'),
    fixture('ucl-pick', 'TIMED', 'CHAMPIONS_LEAGUE'),
  ];
  const briefPreds = new Map<string, any[]>([
    ['laliga-strong', [prediction('laliga-strong', 'LALIGA', 'HOME_WIN', 0.88)]],
    ['epl-pick', [prediction('epl-pick', 'EPL', 'HOME_WIN', 0.72)]],
    ['ucl-pick', [prediction('ucl-pick', 'CHAMPIONS_LEAGUE', 'HOME_WIN', 0.70)]],
  ]);
  const briefBot = new DiscordBotService({} as any, makeStubFactory(briefSlate, detailsFor(briefSlate, briefPreds)));
  const briefing: any = (await briefBot.buildMorningBriefing()).toJSON();
  const pickText = briefing.fields?.[0]?.value ?? '';
  check('briefing section 1 leads with the EPL pick', pickText.indexOf('epl-pick') >= 0
    && pickText.indexOf('epl-pick') < pickText.indexOf('ucl-pick'), pickText);
  check('briefing lists the UCL pick before the stronger LALIGA pick',
    pickText.indexOf('ucl-pick') < pickText.indexOf('laliga-strong'), pickText);
  check('briefing discloses the priority policy', String(briefing.footer?.text ?? '').includes('EPL & UCL priority'),
    String(briefing.footer?.text ?? ''));

  /* --- Discord /generateparlay --- */
  const genSlate = [
    ...Array.from({ length: 6 }, (_, i) => fixture(`laliga-g${i + 1}`, 'TIMED', 'LALIGA')),
    ...Array.from({ length: 5 }, (_, i) => fixture(`epl-g${i + 1}`, 'TIMED', 'EPL')),
    ...Array.from({ length: 5 }, (_, i) => fixture(`ucl-g${i + 1}`, 'TIMED', 'CHAMPIONS_LEAGUE')),
  ];
  const genPreds = new Map<string, any[]>();
  genSlate.forEach((fx) => {
    // The secondary leagues carry the stronger prices, so priority — not model
    // strength — is what decides this parlay.
    genPreds.set(fx.id, [prediction(fx.id, fx.league, 'HOME_WIN', fx.league === 'LALIGA' ? 0.82 : 0.64)]);
  });
  const genBot = new DiscordBotService({} as any, makeStubFactory(genSlate, detailsFor(genSlate, genPreds)));
  const genReply = await genBot.generateParlayReply({ legs: 5, minProbability: 0.6 });
  const genLegLines = genReply.split('\n').filter((l: string) => /^\d+\. \*\*/.test(l));
  check('Discord /generateparlay builds only EPL + UCL legs',
    genLegLines.length === 5 && genLegLines.every((l: string) => /\(.*% \| (EPL|CHAMPIONS_LEAGUE)\)$/.test(l.trim())),
    genLegLines.join(' | '));
  check('Discord /generateparlay discloses the priority policy', genReply.includes('EPL & UCL priority'));

  /* --- HTTP /api/parlays/generate --- */
  const httpRoute = await callGenerateRoute(makeStubFactory(genSlate, detailsFor(genSlate, genPreds)), {
    date: TODAY, legsCount: 5, minProbability: 0.6,
  });
  check('HTTP generator responds 200', httpRoute.statusCode === 200, String(httpRoute.statusCode));
  check('HTTP generator returns only EPL + UCL legs',
    httpRoute.body?.legs?.length === 5
      && httpRoute.body.legs.every((l: any) => l.league === 'EPL' || l.league === 'CHAMPIONS_LEAGUE'),
    json(httpRoute.body?.legs?.map((l: any) => l.league)));

  const httpUnprioritised = await callGenerateRoute(makeStubFactory(genSlate, detailsFor(genSlate, genPreds)), {
    date: TODAY, legsCount: 5, minProbability: 0.6, prioritizePriorityLeagues: false,
  });
  check('HTTP generator honours prioritizePriorityLeagues:false',
    httpUnprioritised.body?.legs?.every((l: any) => l.league === 'LALIGA'),
    json(httpUnprioritised.body?.legs?.map((l: any) => l.league)));

  /* ================================================================ *
   * 4) Strict pre-kickoff filtering
   * ================================================================ */
  section('4) Strict pre-kickoff filtering');

  const PAST_KICKOFF = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const slate = [
    fixture('future-1', 'TIMED', 'EPL', { kickoffTime: new Date(Date.now() + 3 * 3600_000).toISOString() }),
    fixture('future-2', 'TIMED', 'EPL', { kickoffTime: new Date(Date.now() + 4 * 3600_000).toISOString() }),
    fixture('future-3', 'TIMED', 'EPL', { kickoffTime: new Date(Date.now() + 5 * 3600_000).toISOString() }),
    fixture('kicked-off', 'TIMED', 'EPL', { kickoffTime: PAST_KICKOFF }),
    fixture('live-1', 'LIVE', 'EPL'),
    fixture('ft-1', 'FINISHED', 'EPL'),
    fixture('pp-1', 'POSTPONED', 'EPL'),
  ];
  const kept = filterPreKickoffFixtures(slate as any).map((f: any) => f.id);
  check('only the not-yet-kicked-off fixtures survive', json(kept) === json(['future-1', 'future-2', 'future-3']), json(kept));
  check('a TIMED match whose kick-off has passed is rejected', !isPreKickoffFixture(slate[3]));
  check('a live match is rejected', !isPreKickoffFixture(slate[4]));
  check('a finished match is rejected', !isPreKickoffFixture(slate[5]));

  // Every banned fixture carries a 0.99 prediction, so a filtering regression
  // would show up as a leg rather than being hidden by a weak model price.
  const prePreds = new Map<string, any[]>([
    ...slate.map((fx) => [fx.id, [prediction(fx.id, fx.league, 'HOME_WIN', 0.99)]] as [string, any[]]),
  ]);
  const preBot = new DiscordBotService({} as any, makeStubFactory(slate, detailsFor(slate, prePreds)));
  const preReply = await preBot.generateParlayReply({ legs: 5, minProbability: 0.6 });
  check('Discord generator never legs a started/live/finished match',
    !['kicked-off', 'live-1', 'ft-1', 'pp-1'].some((id) => preReply.includes(id)),
    preReply.split('\n').slice(0, 8).join(' | '));

  const preRoute = await callGenerateRoute(makeStubFactory(slate, detailsFor(slate, prePreds)), {
    date: TODAY, legsCount: 5, minProbability: 0.6,
  });
  check('HTTP generator never legs a started/live/finished match',
    !(preRoute.body?.legs ?? []).some((l: any) => ['kicked-off', 'live-1', 'ft-1', 'pp-1'].includes(l.fixtureId)),
    json(preRoute.body?.legs?.map((l: any) => l.fixtureId)));

  const pausedFixture = fixture('ht-1', 'LIVE', 'EPL', { providerStatus: 'PAUSED' });
  const pausedRoute = await callGenerateRoute(
    makeStubFactory([pausedFixture], detailsFor([pausedFixture], new Map())),
    { date: TODAY, legsCount: 5 },
  );
  check('a halted (PAUSED) match yields no legs and no persisted record',
    pausedRoute.statusCode === 200 && pausedRoute.body?.legs?.length === 0,
    json(pausedRoute.body?.legs));

  /* ================================================================ *
   * 5) Instant interaction acknowledgement
   * ================================================================ */
  section('5) Instant interaction acknowledgement');

  let deferredUpdate = 0;
  let deferredReply: any = null;
  const freshMock: any = {
    deferred: false, replied: false,
    async deferUpdate() { deferredUpdate++; },
    async deferReply(opts: any) { deferredReply = opts ?? {}; },
  };
  await ackInteraction(freshMock);
  check('ackInteraction() defers an update by default', deferredUpdate === 1 && deferredReply === null, `${deferredUpdate}/${json(deferredReply)}`);

  deferredReply = null;
  const freshEphemeral: any = {
    deferred: false, replied: false,
    async deferUpdate() { deferredUpdate++; },
    async deferReply(opts: any) { deferredReply = opts ?? {}; },
  };
  await ackInteraction(freshEphemeral, { ephemeral: true });
  check('ackInteraction({ephemeral:true}) sends an ephemeral deferred reply', deferredReply?.ephemeral === true, json(deferredReply));

  let doubleAck = 0;
  const alreadyAcked: any = { deferred: true, replied: false, async deferUpdate() { doubleAck++; } };
  await ackInteraction(alreadyAcked);
  check('ackInteraction() never acknowledges twice', doubleAck === 0);

  let edited = 0;
  const editMock: any = { async editReply() { edited++; } };
  await editOrFollowUp(editMock, { content: 'ok' });
  check('editOrFollowUp() edits the acknowledged message', edited === 1);

  let followedUp: any = null;
  const staleMock: any = {
    async editReply() { throw new Error('Unknown Message'); },
    async followUp(p: any) { followedUp = p; },
  };
  await editOrFollowUp(staleMock, { content: 'ok' });
  check('editOrFollowUp() falls back to an ephemeral follow-up', followedUp?.ephemeral === true && followedUp?.content === 'ok', json(followedUp));

  /* --- structural: every component branch acknowledges before provider work --- */
  const botSrc = fs.readFileSync(resolve(repoRoot, 'backend/src/discord/bot.ts'), 'utf8');
  check('no handler bulk-updates a message without acknowledging first',
    !botSrc.includes('interaction.update('),
    `${(botSrc.match(/interaction\.update\(/g) || []).length} occurrence(s)`);

  const lines = botSrc.split(/\r?\n/);
  const branchStarts: number[] = [];
  lines.forEach((l, i) => { if (/^ {8}if \(id (===|\.startsWith\()/.test(l)) branchStarts.push(i); });

  const ACK_PATTERN = /(interaction\.deferUpdate|interaction\.deferReply|interaction\.reply|CP\.ackInteraction|rerenderParlayMessage)/;
  const offenders: string[] = [];
  for (let i = 0; i < branchStarts.length; i++) {
    const start = branchStarts[i];
    const end = i + 1 < branchStarts.length ? branchStarts[i + 1] : Math.min(start + 140, lines.length);
    const body = lines.slice(start, end).join('\n');
    const idMatch = /id (?:=== '([^']+)'|\.startsWith\('([^']+)')/.exec(lines[start]);
    const id = idMatch?.[1] ?? idMatch?.[2] ?? 'unknown';
    const awaitIdx = body.indexOf('await ');
    if (awaitIdx === -1) { offenders.push(`${id} (no await)`); continue; }
    if (!ACK_PATTERN.test(body.slice(awaitIdx, awaitIdx + 60))) {
      offenders.push(`${id} -> ${body.slice(awaitIdx, awaitIdx + 50).replace(/\s+/g, ' ')}`);
    }
  }
  check(`all ${branchStarts.length} component branches acknowledge before their first provider call`,
    offenders.length === 0, offenders.join(' ; '));

  const trackerBlock = botSrc.slice(
    botSrc.indexOf('const live = CP.findTrackerByCustomId(id);'),
    botSrc.indexOf('/* ---------- live match picker ---------- */'),
  );
  const trackerAckIdx = (() => {
    const a = trackerBlock.indexOf('CP.ackInteraction(interaction)');
    const b = trackerBlock.indexOf('interaction.deferUpdate()');
    if (a === -1) return b;
    if (b === -1) return a;
    return Math.min(a, b);
  })();
  check('tracker buttons acknowledge before the match analysis call',
    trackerAckIdx > -1 && trackerAckIdx < trackerBlock.indexOf('analysisFor(tracker.fixtureId)'),
    trackerBlock.slice(0, 120).replace(/\s+/g, ' '));

  /* ================================================================ *
   * 6) Fast fixture cache + Render self-ping
   * ================================================================ */
  section('6) Fast fixture cache + Render self-ping');

  check('the active fixture window is 30 seconds', ACTIVE_FIXTURE_TTL_MS === 30_000, String(ACTIVE_FIXTURE_TTL_MS));
  const nowMs = Date.now();
  const todayIso = new Date(nowMs).toISOString().slice(0, 10);
  const threeDaysAgo = new Date(nowMs - 3 * 86_400_000).toISOString().slice(0, 10);
  check('today is an active fixture date', isActiveFixtureDate(todayIso, nowMs));
  check('a settled date keeps the long TTL',
    fixtureCacheTtlMs(threeDaysAgo, 900_000, ACTIVE_FIXTURE_TTL_MS, nowMs) === 900_000);
  check('an active date gets the 30-second TTL',
    fixtureCacheTtlMs(todayIso, 900_000, ACTIVE_FIXTURE_TTL_MS, nowMs) === 30_000);

  const serverSrc = fs.readFileSync(resolve(repoRoot, 'backend/src/server.ts'), 'utf8');
  check('the Render self-ping keep-alive is armed in production',
    serverSrc.includes('startSelfKeepAlive') && serverSrc.includes('/api/system/status')
      && serverSrc.includes('10 * 60 * 1000') && serverSrc.includes('RENDER_EXTERNAL_URL'));
  check('the self-ping only starts on Render / production',
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
  console.error(`\nPERSISTENCE & BOOT VERIFICATION FAILED (${failures} check(s))`);
  process.exit(1);
}
console.log('\nPERSISTENCE & BOOT VERIFICATION PASSED');

