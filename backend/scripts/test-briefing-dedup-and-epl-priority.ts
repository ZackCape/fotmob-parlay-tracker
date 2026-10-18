/**
 * Cape Predictor — briefing de-duplication, EPL/UCL priority and boot
 * hydration verification.
 *
 * Usage: npx tsx backend/scripts/test-briefing-dedup-and-epl-priority.ts
 *
 * Runs offline against a stubbed provider and exercises the REAL builders:
 *
 *   1. Briefing de-duplication — `buildMorningBriefing()` must never repeat a
 *      fixture from section 1 (Top Value Picks) inside section 2 (Featured
 *      5-Leg High-Probability Slip). The slip is built from the remaining pool,
 *      so it is a second angle on the slate rather than the same games re-listed.
 *
 *   2. EPL / UCL priority — both sections rank Premier League and Champions
 *      League fixtures ahead of the secondary domestic leagues, and priority
 *      never drags in a leg that fails the probability gate.
 *
 *   3. Briefing layout — exact title/section names, no fluff or risk
 *      disclaimers, upcoming fixtures only.
 *
 *   4. Boot hydration — saved slips and live subscriptions survive a process
 *      restart. The restart is a genuinely fresh child process (`--probe`), which
 *      is what a Render redeploy or a scale-to-zero wake does.
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
import { competitionPriority } from '../src/utils/competitionPriority.js';
import { DiscordBotService } from '../src/discord/bot.js';

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
 * Fixture / prediction builders (provider-shaped, never invented scores)
 * ------------------------------------------------------------------ */
function fixture(id: string, league: string, status = 'TIMED'): any {
  return {
    id,
    externalId: id,
    league,
    season: '2026',
    round: 'Matchday 8',
    date: TODAY,
    kickoffTime: new Date(Date.now() + 3 * 3600_000).toISOString(),
    status,
    homeTeam: { id: `${id}-h`, name: `Home ${id}`, shortName: 'HOM', code: 'HOM', league, stadium: '', city: '', logo: '' },
    awayTeam: { id: `${id}-a`, name: `Away ${id}`, shortName: 'AWY', code: 'AWY', league, stadium: '', city: '', logo: '' },
    homeScore: null,
    awayScore: null,
    htHomeScore: null,
    htAwayScore: null,
    venue: 'Test Ground',
    statistics: null,
    dataSource: 'ESPN Public Scoreboard (Free)',
  };
}

function prediction(fixtureId: string, league: string, market: string, probability: number): any {
  return {
    id: `${fixtureId}-${market}`,
    fixtureId,
    league,
    fixtureDescription: `Fixture ${fixtureId}`,
    kickoff: '15:00:00Z',
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

/** A "match" as the briefing analysis sees it. */
function matchFor(fx: any, predictions: any[]) {
  return { fixture: fx, marketPredictions: predictions, injuries: null };
}

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

/** Parse the briefing embed into { title, picks, slipLegs, news, footer }. */
function parseBriefing(embed: any) {
  const data = embed.toJSON();
  const fields = (data.fields ?? []) as Array<{ name: string; value: string }>;
  return {
    title: data.title ?? '',
    footer: data.footer?.text ?? '',
    sectionNames: fields.map((f) => f.name),
    picks: [...(fields[0]?.value ?? '').matchAll(/\*\*(\d+)\. (Fixture \S+?)\*\*/g)].map((m) => m[2]),
    pickLeagues: [...(fields[0]?.value ?? '').matchAll(/\*\*(\d+)\. Fixture \S+? \*\* \[([^\]]+)\]/g)].map((m) => m[2]),
    slipLegs: [...(fields[1]?.value ?? '').matchAll(/\*\*Leg \d+\*\*: (Fixture \S+?)\s/g)].map((m) => m[1]),
    slipProbabilities: [...(fields[1]?.value ?? '').matchAll(/\*\*Leg \d+\*\*: Fixture \S+? ➔ `[^\`]+` \((\d+)%\)/g)].map((m) => Number(m[1])),
    slipText: fields[1]?.value ?? '',
    news: fields[2]?.value ?? '',
  };
}

try {
  /* ================================================================ *
   * 1) Briefing de-duplication
   * ================================================================ */
  section('1) Briefing de-duplication — value picks vs featured slip');

  const prioritySlate = [
    ...Array.from({ length: 5 }, (_, i) => fixture(`epl-${i + 1}`, 'EPL')),
    ...Array.from({ length: 5 }, (_, i) => fixture(`ucl-${i + 1}`, 'CHAMPIONS_LEAGUE')),
    ...Array.from({ length: 4 }, (_, i) => fixture(`laliga-${i + 1}`, 'LALIGA')),
  ];
  // The secondary leagues carry the strongest prices, so any overlap would be
  // model strength winning over the de-duplication rule.
  const priorityPreds = new Map<string, any[]>(prioritySlate.map((fx) => [
    fx.id,
    [
      prediction(fx.id, fx.league, 'HOME_WIN', fx.league === 'LALIGA' ? 0.85 : 0.72),
      prediction(fx.id, fx.league, 'DRAW', 0.2),
    ],
  ]));
  const priorityBot = new DiscordBotService(
    {} as any,
    {
      async getFixturesByDate() { return prioritySlate.map((f) => ({ ...f })); },
      async getMatchDetails(id: string) { return matchFor(prioritySlate.find((f) => f.id === id), priorityPreds.get(id) ?? []); },
      isOddsConfigured() { return false; },
      async getOddsForFixture() { throw new Error('odds not configured in test'); },
      async getLatestNews() { return []; },
    } as any,
  );

  const brief = parseBriefing(await priorityBot.buildMorningBriefing());
  const overlap = brief.picks.filter((p) => brief.slipLegs.includes(p));
  check('section 1 and section 2 share no fixtures', overlap.length === 0, json(overlap));
  check('section 2 still carries a full 5-leg slip', brief.slipLegs.length === 5, json(brief.slipLegs));
  check('the slip falls through to the Champions League after the EPL picks',
    json(brief.slipLegs.map((l) => l.replace(/^Fixture /, ''))) === json(['ucl-1', 'ucl-2', 'ucl-3', 'ucl-4', 'ucl-5']),
    json(brief.slipLegs));

  /* ================================================================ *
   * 2) EPL / UCL priority inside the briefing
   * ================================================================ */
  section('2) EPL / UCL priority inside the briefing');

  check('EPL ranks ahead of UCL', competitionPriority('EPL') < competitionPriority('CHAMPIONS_LEAGUE'));
  check('secondary leagues rank last',
    competitionPriority('LALIGA') > competitionPriority('CHAMPIONS_LEAGUE'));

  // A slate where the only EPL/UCL fixtures are weaker than every secondary
  // one: priority must still put them first.
  const mixedSlate = [
    fixture('laliga-strong-1', 'LALIGA'),
    fixture('laliga-strong-2', 'LALIGA'),
    fixture('laliga-strong-3', 'LALIGA'),
    fixture('epl-weak', 'EPL'),
    fixture('ucl-weak', 'CHAMPIONS_LEAGUE'),
    fixture('serie-strong-1', 'SERIE_A'),
    fixture('serie-strong-2', 'SERIE_A'),
  ];
  const mixedPreds = new Map<string, any[]>(mixedSlate.map((fx) => [
    fx.id,
    [prediction(fx.id, fx.league, 'HOME_WIN', fx.league === 'LALIGA' || fx.league === 'SERIE_A' ? 0.9 : 0.62)],
  ]));
  const mixedBot = new DiscordBotService(
    {} as any,
    {
      async getFixturesByDate() { return mixedSlate.map((f) => ({ ...f })); },
      async getMatchDetails(id: string) { return matchFor(mixedSlate.find((f) => f.id === id), mixedPreds.get(id) ?? []); },
      isOddsConfigured() { return false; },
      async getOddsForFixture() { throw new Error('odds not configured in test'); },
      async getLatestNews() { return []; },
    } as any,
  );
  const mixed = parseBriefing(await mixedBot.buildMorningBriefing());
  check('value picks lead with the EPL fixture',
    mixed.picks[0] === 'Fixture epl-weak', json(mixed.picks));
  check('value picks second with the Champions League fixture',
    mixed.picks[1] === 'Fixture ucl-weak', json(mixed.picks));
  check('the slip leads with the priority fixtures',
    mixed.slipLegs[0] === 'Fixture epl-weak' && mixed.slipLegs[1] === 'Fixture ucl-weak', json(mixed.slipLegs));
  check('every slip leg clears the 60% model bar',
    mixed.slipProbabilities.length === 5 && mixed.slipProbabilities.every((p) => p >= 60), json(mixed.slipProbabilities));

  /* ================================================================ *
   * 3) Briefing layout
   * ================================================================ */
  section('3) Briefing layout');

  check('title is the dated Cape Predictor Briefing header',
    brief.title === `🏆 Cape Predictor Briefing • ${TODAY}`, brief.title);
  check('section 1 is titled with the EPL & Champions League priority label',
    brief.sectionNames[0] === '📊 Top Value Picks (EPL & Champions League Priority)', json(brief.sectionNames));
  check('section 2 is titled as a high-probability slip',
    brief.sectionNames[1] === '⚡ Featured 5-Leg High-Probability Slip', json(brief.sectionNames));
  check('section 3 is the team news section',
    brief.sectionNames[2] === '🏥 Team News & Key Absences', json(brief.sectionNames));
  check('no risk disclaimer in the footer', !/not (a )?guarantee|financial advice/i.test(brief.footer), brief.footer);
  check('no greeting prose', !/good morning|here are today/i.test(JSON.stringify(brief).toLowerCase()));
  check('no live or finished fixture is advertised',
    !JSON.stringify(brief).includes('LIVE') && !JSON.stringify(brief).includes('FINISHED'));

  /* ================================================================ *
   * 4) Boot hydration across a simulated reboot
   * ================================================================ */
  section('4) Boot hydration across a simulated reboot');

  const userId = 'dedup-probe-user';
  const channelId = 'dedup-probe-channel';

  clearSavedParlays();
  const slip = getParlay(userId);
  addLeg(slip, {
    fixtureId: 'espn-7001', description: 'Home espn-7001 vs Away espn-7001', league: 'EPL',
    market: 'OVER_0_5', selection: 'Over 0.5 Goals', probability: 0.9, marketOdds: 1.25,
  });
  addLeg(slip, {
    fixtureId: 'espn-7002', description: 'Home espn-7002 vs Away espn-7002', league: 'CHAMPIONS_LEAGUE',
    market: 'OVER_8_5_CORNERS', selection: 'Over 8.5 Corners', probability: 0.62, marketOdds: 1.9,
  });
  const saved = saveParlayToDisk(slip, { userId, channelId, guildId: 'dedup-guild' });
  markSavedLegSettled(saved.id, saved.legs[1], 'MISS');

  subscribeLive(userId, channelId, 'espn-7101');
  subscribeLive(userId, channelId, 'espn-7102');

  // Simulated restart: empty the in-memory stores, keep only the files.
  const savedBytes = fs.readFileSync(savedFile);
  clearSavedParlays();
  fs.writeFileSync(savedFile, savedBytes);
  const report = initSavedParlays();
  check('initSavedParlays() restores the slip after a restart', report.total === 1 && report.active === 1, json(report));
  check('restored slip keeps its legs', getSavedParlay(saved.id)?.legs.length === 2);
  check('restored slip keeps ACTIVE_TRACKING', getSavedParlay(saved.id)?.activeTracking === true);
  check('restored slip keeps its settled leg',
    json(Object.values(getSavedParlay(saved.id)?.settled ?? {})) === json(['MISS']));

  const subReport = initLiveSubscriptions();
  check('initLiveSubscriptions() restores the tracked fixtures',
    json([...subReport.fixtureIds].sort()) === json(['espn-7101', 'espn-7102']), json(subReport.fixtureIds));
  check('subscriptions resolve for the user/channel pair',
    json(getSubscribedFixtureIdsForUserChannel(userId, channelId).sort()) === json(['espn-7101', 'espn-7102']));

  const probe = runProbe();
  check('a fresh process hydrates the saved slip', probe?.savedTotal === 1, json(probe));
  check('…with ACTIVE_TRACKING intact', json(probe?.savedActiveFlags) === json([true]), json(probe?.savedActiveFlags));
  check('…with the settled leg intact', json(probe?.savedSettled) === json([['MISS']]), json(probe?.savedSettled));
  check('…and hydrates the live subscriptions',
    json(probe?.subsFixtureIds) === json(['espn-7101', 'espn-7102']), json(probe?.subsFixtureIds));
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
  console.error(`\nBRIEFING DEDUP & PRIORITY VERIFICATION FAILED (${failures} check(s))`);
  process.exit(1);
}
console.log('\nBRIEFING DEDUP & PRIORITY VERIFICATION PASSED');
