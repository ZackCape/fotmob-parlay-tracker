/**
 * Cape Predictor — briefing, /live clock and dual /track verification.
 *
 * Usage: npx tsx backend/scripts/test-briefing-and-live.ts
 *
 * Runs entirely offline against a stubbed DataProviderFactory and exercises the
 * REAL builders/modules, verifying:
 *
 *   1. /live clock formatting — the provider's own minute ("68'") is rendered
 *      verbatim in the header, half-time shows HT, and stats (shots, on target,
 *      xG, corners, cards, possession) come straight from the provider.
 *
 *   2. Briefing upcoming-only filtering — `buildMorningBriefing()` never lists a
 *      fixture that is LIVE or FINISHED, and carries no prose padding.
 *
 *   3. Team-news integration — provider-reported injuries surface as bullets,
 *      and an honest message is shown when the provider publishes none.
 *
 *   4. Dual-embed /track — a saved slip AND individually tracked matches render
 *      as two embeds, and ⚡ Track Match persists the (user, channel) pair.
 *
 * `data/user_live_subscriptions.json` and `data/saved_parlays.json` are
 * snapshotted before the run and restored afterwards.
 *
 * Exits non-zero if any check fails.
 */
import fs from 'node:fs';
import { resolve } from 'node:path';

import {
  buildLiveMatchesEmbed,
  buildLiveActionRows,
  buildTrackedMatchesEmbed,
  MAX_LIVE_MATCH_ROWS,
} from '../src/discord/liveTracker.js';
import { subscribeLive, getSubscribedFixtureIdsForUserChannel } from '../src/discord/liveEvents.js';
import { saveParlayToDisk, clearSavedParlays, setSavedParlayActiveTracking, getActiveSavedParlaysForUserChannel } from '../src/discord/savedParlays.js';
import { getParlay, clearParlay, addLeg } from '../src/discord/parlayBuilder.js';
import { DiscordBotService } from '../src/discord/bot.js';

const repoRoot = process.cwd();
const subsFile = resolve(repoRoot, 'data', 'user_live_subscriptions.json');
const savedFile = resolve(repoRoot, 'data', 'saved_parlays.json');

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

const TODAY = new Date().toISOString().slice(0, 10);
const json = (v: any) => JSON.stringify(v);

/* ------------------------------------------------------------------ *
 * Sample fixtures / predictions (provider-shaped, never invented scores)
 * ------------------------------------------------------------------ */
function fixture(id: string, status: string, extra: Record<string, unknown> = {}): any {
  return {
    id,
    externalId: id,
    league: 'EPL',
    season: '2026',
    round: 'Matchday 8',
    date: TODAY,
    kickoffTime: `${TODAY}T15:00:00Z`,
    status,
    homeTeam: { id: `${id}-h`, name: `Home ${id}`, shortName: 'HOM', code: 'HOM', league: 'EPL', stadium: '', city: '', logo: '' },
    awayTeam: { id: `${id}-a`, name: `Away ${id}`, shortName: 'AWY', code: 'AWY', league: 'EPL', stadium: '', city: '', logo: '' },
    homeScore: null,
    awayScore: null,
    htHomeScore: null,
    htAwayScore: null,
    venue: 'Test Ground',
    statistics: null,
    dataSource: 'ESPN Public Scoreboard (Free)',
    ...extra,
  };
}

function prediction(fixtureId: string, market: string, probability: number): any {
  return {
    id: `${fixtureId}-${market}`,
    fixtureId,
    league: 'EPL',
    fixtureDescription: `Home ${fixtureId} vs Away ${fixtureId}`,
    kickoff: `${TODAY}T15:00:00Z`,
    market,
    marketLabel: market,
    selection: market === 'HOME_WIN' ? `Home ${fixtureId} to Win` : market === 'DRAW' ? 'Draw' : `Away ${fixtureId} to Win`,
    estimatedProbability: probability,
    rawProbability: probability,
    confidenceLower: probability * 0.9,
    confidenceUpper: Math.min(1, probability * 1.1),
    supportingStatistics: {},
    sampleSize: 10,
    dataFreshnessDays: 1,
    riskFactors: [],
  };
}

const liveFixture = fixture('live-1', 'LIVE', {
  homeScore: 2,
  awayScore: 0,
  liveClock: "68'",
  providerStatus: 'STATUS_IN_PROGRESS',
  statistics: {
    possessionHome: 58, possessionAway: 42,
    shotsHome: 12, shotsAway: 5,
    shotsOnTargetHome: 4, shotsOnTargetAway: 2,
    xgHome: 1.42, xgAway: 0.63,
    cornersHome: 6, cornersAway: 3,
    yellowCardsHome: 2, yellowCardsAway: 1,
    redCardsHome: 0, redCardsAway: 0,
  },
});

const upcoming1 = fixture('up-1', 'TIMED');
const upcoming2 = fixture('up-2', 'TIMED');
const finished1 = fixture('ft-1', 'FINISHED', { homeScore: 1, awayScore: 1 });

const injuries = [
  { player: 'J. Doe', teamId: 'up-1-h', teamName: 'Home up-1', status: 'OUT', reason: 'Hamstring', reportedDate: TODAY },
  { player: 'A. Smith', teamId: 'up-1-a', teamName: 'Away up-1', status: 'SUSPENDED', reason: '5th yellow', reportedDate: TODAY },
];

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

/* ================================================================== *
 * 1) /live clock + stats formatting
 * ================================================================== */
section('1) /live — active matches, provider clock and stats');
{
  const embed = buildLiveMatchesEmbed([liveFixture, upcoming1, finished1]);
  const text = json(embed.toJSON());

  check('live embed titled', embed.data.title === '🔴 Cape Predictor — Live Matches');
  check("clock rendered verbatim as 68'", text.includes("🔴 **68'** • **Home live-1 2 — 0 Away live-1** [EPL]"));
  check('shots rendered', text.includes('`Shots 12 - 5`'));
  check('shots on target rendered', text.includes('`On Target 4 - 2`'));
  check('xG rendered', text.includes('`1.42 - 0.63`'));
  check('corners rendered', text.includes('**Corners:** `6 - 3`'));
  check('cards rendered', text.includes('**Cards:** `2 - 1`'));
  check('possession rendered', text.includes('`Possession 58% - 42%`'));
  check('live embed has no undefined/NaN', !text.includes('undefined') && !text.includes('NaN'));

  check('upcoming fixture excluded from /live', !text.includes('up-1'));
  check('finished fixture excluded from /live', !text.includes('ft-1'));

  // Half-time: labelled HT rather than a fabricated minute.
  const ht = buildLiveMatchesEmbed([{ ...liveFixture, liveClock: null, providerStatus: 'STATUS_HALFTIME' }]);
  check('half-time labelled HT', json(ht.toJSON()).includes('🔴 **HT**'));

  // No clock published -> honest LIVE label, never an invented minute.
  const noClock = buildLiveMatchesEmbed([{ ...liveFixture, liveClock: null, providerStatus: 'STATUS_IN_PROGRESS' }]);
  check('missing clock falls back to LIVE', json(noClock.toJSON()).includes('🔴 **LIVE**'));

  // Empty state wording.
  const none = buildLiveMatchesEmbed([upcoming1, finished1]);
  check(
    'empty /live message',
    json(none.toJSON()).includes('No live matches currently in play. Use `/fixtures` to see upcoming games.'),
  );

  // One action row per live match, each carrying a ⚡ Track Match button.
  const rows = buildLiveActionRows([liveFixture, { ...liveFixture, id: 'live-2' }, upcoming1]);
  check('one action row per live match', rows.length === 2, `rows=${rows.length}`);
  check('rows never exceed the Discord maximum', rows.length <= MAX_LIVE_MATCH_ROWS);
  const rowIds = rows.map((r: any) => r.toJSON().components.map((c: any) => c.custom_id));
  check('track button sits under match 1', rowIds[0]?.includes('cp:live:track:live-1'));
  check('track button sits under match 2', rowIds[1]?.includes('cp:live:track:live-2'));

  // The per-match builder supports up to 5 fixtures (Discord row cap).
  const many = Array.from({ length: 8 }, (_, i) => ({ ...liveFixture, id: `bulk-${i}` }));
  check('action rows capped at the Discord maximum', buildLiveActionRows(many).length === MAX_LIVE_MATCH_ROWS);
}

/* ================================================================== *
 * 2) Morning briefing — upcoming only, no fluff
 * ================================================================== */
section('2) Briefing — upcoming-only, clean layout');
{
  const details = new Map<string, any>([
    ['up-1', { fixture: fixture('up-1', 'TIMED'), marketPredictions: [prediction('up-1', 'HOME_WIN', 0.72), prediction('up-1', 'DRAW', 0.18), prediction('up-1', 'AWAY_WIN', 0.10)], injuries }],
    ['up-2', { fixture: fixture('up-2', 'TIMED'), marketPredictions: [prediction('up-2', 'HOME_WIN', 0.66), prediction('up-2', 'DRAW', 0.20), prediction('up-2', 'AWAY_WIN', 0.14)], injuries: null }],
    ['live-1', { fixture: liveFixture, marketPredictions: [prediction('live-1', 'HOME_WIN', 0.99)], injuries: null }],
    ['ft-1', { fixture: finished1, marketPredictions: [prediction('ft-1', 'HOME_WIN', 0.99)], injuries: null }],
  ]);

  const bot = new DiscordBotService({}, makeStubFactory([upcoming1, upcoming2, liveFixture, finished1], details));
  const embed = await bot.buildMorningBriefing();
  const data = embed.toJSON();
  const text = json(data);
  const fields = (data.fields ?? []) as Array<{ name: string; value: string }>;

  check('briefing titled with the date', data.title === `🏆 Cape Predictor Briefing • ${TODAY}`);
  check('no leftover morning prose', !text.includes('Good morning'));

  check('section 1 present', fields[0]?.name === '📊 Top Value Picks (EPL & Champions League Priority)');
  check('section 1 lists upcoming fixtures', fields[0]?.value.includes('Home up-1 vs Away up-1'));
  check('section 1 lists the second upcoming fixture', fields[0]?.value.includes('Home up-2 vs Away up-2'));
  check('section 1 shows calibrated probability', fields[0]?.value.includes('Calibrated'));
  check('section 1 shows fair odds', fields[0]?.value.includes('Fair'));
  check('section 1 excludes live fixtures', !fields[0]?.value.includes('live-1'));
  check('section 1 excludes finished fixtures', !fields[0]?.value.includes('ft-1'));

  check('section 2 present', fields[1]?.name === '⚡ Featured 5-Leg High-Probability Slip');
  check('section 2 shows combined probability', fields[1]?.value.includes('Combined Probability'));
  check('section 2 shows compound odds', fields[1]?.value.includes('Compound Odds'));
  check('section 2 shows a $10 return', fields[1]?.value.includes('$10 Returns'));

  check('section 3 present', fields[2]?.name === '🏥 Team News & Key Absences');
  check('section 3 lists a confirmed absence', fields[2]?.value.includes('J. Doe') && fields[2]?.value.includes('OUT'));
  check('section 3 lists a suspension', fields[2]?.value.includes('A. Smith') && fields[2]?.value.includes('SUSPENDED'));

  check('briefing has no undefined/NaN', !text.includes('undefined') && !text.includes('NaN'));
  check('briefing never advertises a live/finished match', !text.includes('live-1') && !text.includes('ft-1'));
}

/* ================================================================== *
 * 3) Team news — honest fallback
 * ================================================================== */
section('3) Team news — honest fallback');
{
  const details = new Map<string, any>([
    ['up-1', { fixture: upcoming1, marketPredictions: [prediction('up-1', 'HOME_WIN', 0.7)], injuries: null }],
  ]);
  const bot = new DiscordBotService({}, makeStubFactory([upcoming1], details));
  const data = (await bot.buildMorningBriefing()).toJSON();
  const fields = (data.fields ?? []) as Array<{ name: string; value: string }>;
  check(
    'no injuries -> honest provider message',
    /No confirmed injuries or suspensions published by the provider/i.test(fields[2]?.value ?? ''),
    fields[2]?.value,
  );
  check('team news is never invented', !(fields[2]?.value ?? '').includes('undefined'));
}

/* ================================================================== *
 * 4) /track — saved slip + individually tracked matches
 * ================================================================== */
section('4) /track — dual embed (saved slip + tracked matches)');
const hadSubs = fs.existsSync(subsFile);
const subsBackup: Buffer | null = hadSubs ? fs.readFileSync(subsFile) : null;
const hadSaved = fs.existsSync(savedFile);
const savedBackup: Buffer | null = hadSaved ? fs.readFileSync(savedFile) : null;

try {
  clearSavedParlays();

  const userId = 'briefing-track-user';
  const channelId = 'briefing-track-chan';
  const details = new Map<string, any>([
    ['live-1', { fixture: liveFixture, marketPredictions: [], injuries: null }],
    ['up-1', { fixture: upcoming1, marketPredictions: [], injuries: null }],
  ]);
  const factory = makeStubFactory([liveFixture, upcoming1], details);

  /* --- ⚡ Track Match registers the user + channel on disk --- */
  const added = subscribeLive(userId, channelId, 'live-1');
  subscribeLive(userId, channelId, 'up-1');
  check('subscribeLive registers the user/channel pair', added === true);
  check(
    'subscription store resolves the tracked fixtures',
    json(getSubscribedFixtureIdsForUserChannel(userId, channelId).sort()) === json(['live-1', 'up-1']),
    json(getSubscribedFixtureIdsForUserChannel(userId, channelId)),
  );
  let persistedSubs = false;
  try {
    const parsed = JSON.parse(fs.readFileSync(subsFile, 'utf8')) as any[];
    persistedSubs = Array.isArray(parsed) && parsed.some(
      (s) => s.userId === userId && s.channelId === channelId && s.fixtureId === 'live-1',
    );
  } catch { persistedSubs = false; }
  check('data/user_live_subscriptions.json holds the (user, channel) pair', persistedSubs);

  /* --- Saved slip for the same (user, channel) --- */
  clearParlay(userId);
  const slip = getParlay(userId);
  addLeg(slip, {
    fixtureId: 'up-1', description: 'Home up-1 vs Away up-1', league: 'EPL',
    market: 'OVER_0_5', selection: 'Over 0.5 Goals', probability: 0.9, marketOdds: 1.25,
  });
  addLeg(slip, {
    fixtureId: 'up-2', description: 'Home up-2 vs Away up-2', league: 'EPL',
    market: 'OVER_8_5_CORNERS', selection: 'Over 8.5 Corners', probability: 0.62, marketOdds: 1.9,
  });
  saveParlayToDisk(slip, { userId, channelId, guildId: 'guild-test' });
  const savedSlip = getActiveSlipFor(userId, channelId);

  const bot = new DiscordBotService({}, factory);
  const reply = await bot.generateLiveTrackerReply({ userId, channelId });

  check('/track returns an embed array', Array.isArray(reply), typeof reply);
  const embeds = Array.isArray(reply) ? reply.map((e: any) => e.toJSON()) : [];
  check('/track returns TWO embeds when both sources have data', embeds.length === 2, `embeds=${embeds.length}`);

  const slipText = json(embeds[0]);
  check('embed 1 is the active parlay slip', (embeds[0]?.title ?? '').includes('Legs'));
  check('embed 1 shows ⏳ PENDING legs', slipText.includes('⏳ PENDING'));
  check('embed 1 lists the slip selections', slipText.includes('Over 0.5 Goals') && slipText.includes('Over 8.5 Corners'));

  const trackedText = json(embeds[1]);
  check('embed 2 is the tracked-matches card', embeds[1]?.title === '⚡ Tracked Matches');
  check('embed 2 renders the live clock', trackedText.includes("🔴 **68'**"));
  check('embed 2 renders the live scoreline', trackedText.includes('Home live-1 2 — 0 Away live-1'));
  check('embed 2 renders an upcoming kick-off', trackedText.includes('🕒'));
  check('embed 2 has no undefined/NaN', !trackedText.includes('undefined') && !trackedText.includes('NaN'));

  /* --- With no slip, only the tracked-matches embed is returned --- */
  setSavedParlayActiveTracking(savedSlip.id, false);
  const onlyTracked = await bot.generateLiveTrackerReply({ userId, channelId });
  const onlyTrackedEmbeds = Array.isArray(onlyTracked) ? onlyTracked.map((e: any) => e.toJSON()) : [];
  check('/track returns one embed when only matches are tracked', onlyTrackedEmbeds.length === 1, `embeds=${onlyTrackedEmbeds.length}`);
  check('that single embed is the tracked-matches card', onlyTrackedEmbeds[0]?.title === '⚡ Tracked Matches');

  /* --- With neither source, an honest text hint --- */
  const empty = await bot.generateLiveTrackerReply({ userId: 'nobody', channelId: 'nowhere' });
  check('/track falls back to text when nothing is tracked', typeof empty === 'string', typeof empty);

  /* --- The tracked-matches builder's empty state --- */
  check(
    'tracked-matches empty state explains how to track',
    json(buildTrackedMatchesEmbed([]).toJSON()).includes('⚡ Track Match'),
  );
} finally {
  try {
    if (subsBackup !== null) fs.writeFileSync(subsFile, subsBackup);
    else if (fs.existsSync(subsFile)) fs.rmSync(subsFile);
  } catch { /* best effort */ }
  try {
    if (savedBackup !== null) fs.writeFileSync(savedFile, savedBackup);
    else if (fs.existsSync(savedFile)) fs.rmSync(savedFile);
  } catch { /* best effort */ }
}

/** The freshest saved slip for a (user, channel) pair. */
function getActiveSlipFor(userId: string, channelId: string): any {
  const active = getActiveSavedParlaysForUserChannel(userId, channelId);
  if (!active.length) throw new Error('expected an active saved slip');
  return active[0];
}

/* ================================================================== *
 * Summary
 * ================================================================== */
section('SUMMARY');
console.log(`checks run : ${checks}`);
console.log(`failures   : ${failures}`);
if (failures > 0) {
  console.error(`\nBRIEFING & LIVE VERIFICATION FAILED (${failures} check(s))`);
  process.exit(1);
}
console.log('\nBRIEFING & LIVE VERIFICATION PASSED');
