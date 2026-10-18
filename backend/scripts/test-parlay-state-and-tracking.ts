/**
 * Cape Predictor — critical interaction fixes verification.
 *
 * Usage: npx tsx backend/scripts/test-parlay-state-and-tracking.ts
 *
 * Exercises the REAL modules (no mocks) and verifies:
 *   1. /customparlay state retention — League/Match/Market selections persist
 *      on the active slip instead of resetting, Add Leg is usable on an empty
 *      slip, and combined odds / payout / win % / EV recompute live.
 *   2. Command consolidation — /generateparlay exposes leg counts 5/10/15/20/25
 *      with a min-probability threshold and league filter, and the old
 *      overlapping /parlay and /sgp command names are gone.
 *   3. Live channel notifications — Track Match registers channelId alongside
 *      userId, and saved-parlay legs auto-settle against live match data with a
 *      PARLAY UPDATE broadcast to the originating channel.
 *
 * Exits non-zero if any check fails.
 */
import fs, { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  getParlay, clearParlay, addLeg, removeLeg,
  setParlayLeague, getParlayLeague,
  setParlayPendingMatch, getParlayPendingMatch,
  setParlayPendingMarket, getParlayPendingMarket, clearParlayPending,
  setParlayDestination,
  parlayCombinedProbability, parlayImpliedOdds, parlayMarketOdds,
  parlayExpectedPayout, parlayExpectedValue, parlayEdge,
  buildParlayActionRows, buildParlayEmbed, buildParlayPayload,
  marketLabel, MAX_LEGS,
} from '../src/discord/parlayBuilder.js';
import {
  saveParlayToDisk, getSavedParlaysForFixture, getSavedParlaysByChannel,
  evaluateSavedLeg, buildParlayUpdateEmbed, isSavedLegSettled,
  markSavedLegSettled, countSettledLegs, clearSavedParlays,
} from '../src/discord/savedParlays.js';
import {
  subscribeLive, unsubscribeLive, getSubscriptionsForFixture,
} from '../src/discord/liveEvents.js';
import { buildStatisticalParlay } from '../src/parlays/parlay-builder.js';
import { FixtureStatistics, League, MarketPrediction, MarketType } from '../src/types/football.js';

const repoRoot = process.cwd();

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
  console.log(`\n${title}`);
}

/** Build a valid-enough FixtureStatistics carrying only the fields under test. */
function stats(partial: Partial<FixtureStatistics>): FixtureStatistics {
  return {
    shotsHome: null, shotsAway: null, shotsOnTargetHome: null, shotsOnTargetAway: null,
    xgHome: null, xgAway: null, cornersHome: null, cornersAway: null,
    foulsHome: null, foulsAway: null, yellowCardsHome: null, yellowCardsAway: null,
    redCardsHome: null, redCardsAway: null, possessionHome: null, possessionAway: null,
    ...partial,
  } as FixtureStatistics;
}

/** Synthetic model predictions used only to exercise the generator options. */
function makePredictions(count: number, league: League = 'EPL', probability = 0.75): MarketPrediction[] {
  const preds: MarketPrediction[] = [];
  for (let i = 0; i < count; i++) {
    preds.push({
      id: `p-${league}-${i}`,
      fixtureId: `espn-${1000 + i}-${league}`,
      league,
      fixtureDescription: `Home ${league} ${i} v Away ${league} ${i}`,
      kickoff: new Date().toISOString(),
      market: 'HOME_WIN',
      marketLabel: 'Home Win',
      selection: 'Home Win',
      estimatedProbability: probability,
      rawProbability: probability,
      confidenceLower: Math.max(0, probability - 0.05),
      confidenceUpper: Math.min(1, probability + 0.05),
      supportingStatistics: {
        homeGoalAverageLast5: 1.5, awayGoalAverageLast5: 1.2,
        homeConcededAverageLast5: 1.0, awayConcededAverageLast5: 1.3,
        homeXgAverage: 1.6, awayXgAverage: 1.1,
        bttsFrequencyLast10: 0.5, over25FrequencyLast10: 0.5,
        h2hSummary: 'n/a', cleanSheetRateHome: 0.3, cleanSheetRateAway: 0.2,
      },
      sampleSize: 10,
      dataFreshnessDays: 1,
      riskFactors: [],
    });
  }
  return preds;
}

/* ================================================================== *
 * 1) /customparlay state retention
 * ================================================================== */
section('1) /customparlay state retention');
{
  const u = 'user-retention';
  clearParlay(u);

  const fresh = getParlay(u);
  check('fresh slip starts with no legs', fresh.legs.length === 0);

  const emptyRows = buildParlayActionRows(fresh);
  const addBtn = emptyRows[0].components[0].data as { custom_id?: string; disabled?: boolean };
  check('Add Leg is enabled on an empty slip (first leg can be committed)',
    addBtn.custom_id === 'cp:parlay:add' && !addBtn.disabled);

  // Simulate the three dropdown interactions in order.
  setParlayLeague(u, 'EPL');
  setParlayPendingMatch(u, 'espn-1', 'Chelsea v Opposition');
  setParlayPendingMarket(u, 'OVER_0_5');

  const staged = getParlay(u);
  check('league selection persists on the slip object', getParlayLeague(u) === 'EPL' && staged.pendingLeague === 'EPL');
  check('match selection persists on the slip object', getParlayPendingMatch(u) === 'espn-1' && staged.pendingMatchId === 'espn-1');
  check('market selection persists on the slip object', getParlayPendingMarket(u) === 'OVER_0_5' && staged.pendingMarket === 'OVER_0_5');
  check('slip is still leg-less, not reset to a new slip', staged.legs.length === 0 && staged.ownerId === u);

  const stagedEmbed = buildParlayEmbed(staged).toJSON();
  const stagedText = [stagedEmbed.description, ...(stagedEmbed.fields ?? []).map((f) => `${f.name} ${f.value}`)].join('\n');
  check('empty-slip embed reflects the staged selections',
    stagedText.includes('Selections') && stagedText.includes('EPL') && stagedText.includes('Chelsea v Opposition') && stagedText.includes('Over 0.5 Goals'));

  // Commit the staged leg.
  const add1 = addLeg(staged, {
    fixtureId: 'espn-1', description: 'Chelsea v Opposition', league: 'EPL',
    market: 'OVER_0_5', selection: 'Over 0.5 Goals', probability: 0.9, marketOdds: 1.25,
  });
  check('Add Leg pushes the staged leg into slip.legs', add1.ok && staged.legs.length === 1);

  // A second leg with different odds, added manually.
  const add2 = addLeg(staged, {
    fixtureId: 'espn-2', description: 'Madrid v Rivals', league: 'LALIGA',
    market: 'OVER_8_5_CORNERS', selection: 'Over 8.5 Corners', probability: 0.8, marketOdds: 1.5,
  });
  check('second leg is accepted', add2.ok && staged.legs.length === 2);

  const combined = parlayCombinedProbability(staged);
  const implied = parlayImpliedOdds(staged);
  const marketOdds = parlayMarketOdds(staged);
  const payout = parlayExpectedPayout(staged);
  const ev = parlayExpectedValue(staged);

  check('combined win probability recomputed (0.9 * 0.8 = 0.72)',
    Math.abs(combined - 0.72) < 1e-9, String(combined));
  check('model fair odds recomputed (1 / 0.72)',
    implied !== null && Math.abs(implied - 1 / 0.72) < 1e-9, String(implied));
  check('combined bookmaker odds recomputed (1.25 * 1.5 = 1.875)',
    marketOdds !== null && Math.abs(marketOdds - 1.875) < 1e-9, String(marketOdds));
  check('payout recomputed against the $10 base stake',
    payout !== null && Math.abs(payout - (1 / 0.72) * 10) < 0.01, String(payout));
  check('fair-odds EV is neutral (not a fake profit)',
    ev !== null && Math.abs(ev) < 0.01, String(ev));
  check('model edge over real prices is reported',
    parlayEdge(staged) !== null && (parlayEdge(staged) as number) > 0);

  // Consuming a staged leg must not wipe the slip.
  clearParlayPending(u);
  check('clearing staged selections keeps committed legs',
    getParlay(u).legs.length === 2 && getParlayPendingMatch(u) === undefined);

  const removeRes = removeLeg(staged, 1);
  check('removeLeg drops the selected leg and keeps the rest',
    removeRes.ok && staged.legs.length === 1 && staged.legs[0].fixtureId === 'espn-2');

  const payload = buildParlayPayload(staged, [], { league: 'EPL' });
  check('parlay payload stays within 5 action rows', payload.components.length <= 5, String(payload.components.length));

  clearParlay(u);
}

/* ================================================================== *
 * 2) /generateparlay generator options + command consolidation
 * ================================================================== */
section('2) /generateparlay leg options + command consolidation');
{
  const candidates = makePredictions(30, 'EPL', 0.75);
  for (const target of [5, 10, 15, 20, 25] as const) {
    const parlay = buildStatisticalParlay(candidates, {
      targetLegsCount: target, minProbability: 0.6, leagueFilter: 'ALL', mode: 'ANTI_CORRELATED',
    });
    check(`generator produces a ${target}-leg anti-correlated parlay`,
      parlay.legs.length === target && parlay.targetLegsCount === target && parlay.status === 'SUFFICIENT_SELECTIONS',
      `legs=${parlay.legs.length} status=${parlay.status}`);
  }

  const mixed = [...makePredictions(10, 'EPL', 0.75), ...makePredictions(10, 'LALIGA', 0.75)];
  const eplOnly = buildStatisticalParlay(mixed, {
    targetLegsCount: 5, minProbability: 0.6, leagueFilter: 'EPL', mode: 'ANTI_CORRELATED',
  });
  check('league filter restricts every leg to the chosen competition',
    eplOnly.legs.length === 5 && eplOnly.legs.every((l) => l.league === 'EPL'));

  const thresholds = makePredictions(12, 'EPL', 0.55).concat(makePredictions(12, 'EPL', 0.72));
  const highOnly = buildStatisticalParlay(thresholds, {
    targetLegsCount: 5, minProbability: 0.7, leagueFilter: 'ALL', mode: 'ANTI_CORRELATED',
  });
  check('min-probability threshold filters out weaker legs',
    highOnly.legs.length === 5 && highOnly.legs.every((l) => l.estimatedProbability >= 0.7));

  const botSrc = readFileSync(resolve(repoRoot, 'backend', 'src', 'discord', 'bot.ts'), 'utf-8');
  check('bot registers the consolidated /generateparlay command', botSrc.includes(".setName('generateparlay')"));
  check('old /parlay and /sgp top-level commands are removed',
    !botSrc.includes(".setName('parlay')") && !botSrc.includes(".setName('sgp')"));
  check('interactive /customparlay builder is retained', botSrc.includes(".setName('customparlay')"));
  check('generator exposes leg counts 5/10/15/20/25',
    ["{ name: '5 Legs (Standard)', value: 5 }", "{ name: '10 Legs (Deep Combo)', value: 10 }",
     "{ name: '15 Legs (Ultra Combo)', value: 15 }", "{ name: '20 Legs (Mega Combo)', value: 20 }",
     "{ name: '25 Legs (Max Multi-League)', value: 25 }"].every((c) => botSrc.includes(c)));
  check('generator exposes a min_probability threshold option', botSrc.includes(".setName('min_probability')"));
  check('generator exposes a league filter option', botSrc.includes(".setName('league')"));
  check('MAX_LEGS still bounds custom slips', MAX_LEGS === 10);
}

/* ================================================================== *
 * 3) Live channel notifications + parlay leg-hit tracking
 * ================================================================== */
section('3) Live channel notifications + parlay leg-hit tracking');
{
  const userId = 'user-live-1';
  const chanId = 'chan-live-1';
  const fixtureId = 'espn-555';

  check('Track Match registers channelId alongside userId', subscribeLive(userId, chanId, fixtureId) === true);
  const subs = getSubscriptionsForFixture(fixtureId);
  check('subscription stores the originating channelId',
    subs.some((s) => s.userId === userId && s.channelId === chanId));

  check('duplicate track in the same channel is a no-op',
    subscribeLive(userId, chanId, fixtureId) === false);
  check('tracking the same match from a second channel registers that channel',
    subscribeLive(userId, 'chan-live-2', fixtureId) === true);

  // Build and persist a slip. Note: OVER_0_5 + OVER_8_5_CORNERS are the exact
  // legs named in the requirements.
  const slip = getParlay(userId);
  slip.legs.push({
    fixtureId, description: 'Chelsea v Opposition', league: 'EPL',
    market: 'OVER_0_5', selection: 'Over 0.5 Goals', probability: 0.9, marketOdds: 1.25,
  });
  slip.legs.push({
    fixtureId, description: 'Chelsea v Opposition', league: 'EPL',
    market: 'OVER_8_5_CORNERS', selection: 'Over 8.5 Corners', probability: 0.62, marketOdds: 1.9,
  });
  setParlayDestination(userId, chanId, 'guild-1');

  const saved = saveParlayToDisk(slip, { userId, channelId: chanId, guildId: 'guild-1' });
  check('slip persisted tied to channelId + userId',
    saved.channelId === chanId && saved.userId === userId && saved.legs.length === 2);
  check('slip is discoverable by fixture for the live worker',
    getSavedParlaysForFixture(fixtureId).some((p) => p.id === saved.id));
  check('slip is discoverable by channel for broadcast',
    getSavedParlaysByChannel(chanId).some((p) => p.id === saved.id));

  const savedFile = resolve(repoRoot, 'data', 'saved_parlays.json');
  let persistedOk = false;
  try {
    const parsed = JSON.parse(fs.readFileSync(savedFile, 'utf8')) as any[];
    persistedOk = Array.isArray(parsed) && parsed.some((p) => p.id === saved.id && p.channelId === chanId && p.userId === userId);
  } catch { persistedOk = false; }
  check('data/saved_parlays.json holds the slip keyed by channel + user', persistedOk);

  const goalLeg = saved.legs[0];
  const cornerLeg = saved.legs[1];
  const base = { homeTeam: 'Chelsea', awayTeam: 'Opposition', status: 'LIVE' as const, statistics: null };

  check('Over 0.5 Goals stays PENDING at 0-0',
    evaluateSavedLeg(goalLeg, { ...base, homeScore: 0, awayScore: 0 }).status === 'PENDING');

  const goalHit = evaluateSavedLeg(goalLeg, { ...base, homeScore: 1, awayScore: 0 },
    { minute: "34'", team: 'Chelsea', player: 'J. Player' });
  check('Over 0.5 Goals HITS as soon as a goal lands', goalHit.status === 'HIT');
  check("leg-hit note names the scoring team and minute", goalHit.note.includes("Chelsea scored at 34'"));

  markSavedLegSettled(saved.id, goalLeg, 'HIT');
  check('settled legs are de-duplicated', isSavedLegSettled(saved.id, goalLeg));
  const settledCount = countSettledLegs(saved);
  check('settled-leg counter increments', settledCount === 1, String(settledCount));

  const embed = buildParlayUpdateEmbed({
    saved, leg: goalLeg, progress: goalHit, settledCount, totalLegs: saved.legs.length,
  }).toJSON();
  const desc = embed.description ?? '';
  check('leg-hit card is a green PARLAY UPDATE', desc.includes('🟢') && desc.includes('PARLAY UPDATE'));
  check('leg-hit card shows market, hit mark, note and settled count',
    desc.includes('Leg Hit') && desc.includes('Over 0.5 Goals') &&
    desc.includes("Chelsea scored at 34'") && desc.includes('[1/2 Legs Settled]'),
    desc);
  check('leg-hit card colour is the brand positive tone', embed.color === 0x16A34A);

  check('Over 8.5 Corners stays PENDING at 6 corners',
    evaluateSavedLeg(cornerLeg, { ...base, homeScore: 0, awayScore: 0, statistics: stats({ cornersHome: 3, cornersAway: 3 }) }).status === 'PENDING');
  const cornerHit = evaluateSavedLeg(cornerLeg, { ...base, homeScore: 0, awayScore: 0, statistics: stats({ cornersHome: 5, cornersAway: 4 }) });
  check('Over 8.5 Corners HITS at 9 corners', cornerHit.status === 'HIT' && cornerHit.note.includes('9 corners taken'));

  const miss = evaluateSavedLeg(
    { fixtureId, description: 'Chelsea v Opposition', league: 'EPL', market: 'UNDER_2_5' as MarketType, selection: 'Under 2.5 Goals', probability: 0.5, marketOdds: null },
    { ...base, status: 'FINISHED', homeScore: 2, awayScore: 1, statistics: stats({}) },
  );
  check('Under 2.5 settles MISS at 2-1 full time', miss.status === 'MISS');

  check("market labels resolve for the builder dropdown", marketLabel('OVER_0_5') === 'Over 0.5 Goals');

  // Cleanup so repeated runs start clean.
  clearSavedParlays();
  unsubscribeLive(userId, fixtureId);
}

console.log(`\n${checks - failures}/${checks} checks passed.`);
if (failures > 0) {
  console.error(`${failures} check(s) FAILED.`);
  process.exit(1);
}
console.log('All parlay state-retention and live-tracking checks passed.');
