/**
 * Verification script for Profitable Yield-Boosted High-Probability Parlay Optimizer.
 *
 * Verifies:
 * 1. 5-leg parlay (minProbability: 0.60) achieves compound bookmaker odds >= 3.20x.
 * 2. 10-leg parlay (minProbability: 0.60) achieves compound bookmaker odds >= 10.0x.
 * 3. Under 5.5 Cards makes up no more than 20% of legs (no card unders spam).
 * 4. Higher-yield sweet-spot markets (1.25x - 1.55x) are prioritized over micro-odds (1.02x - 1.12x).
 */
import { DataProviderFactory } from '../src/providers/provider-factory.js';
import { config } from '../src/config/env.js';
import { buildStatisticalParlay, computeLegYieldScore } from '../src/parlays/parlay-builder.js';
import { buildGenericAnalysis } from '../src/utils/genericAnalysis.js';
import { MarketPrediction } from '../src/types/football.js';

let passes = 0;
let failures = 0;

function assert(condition: boolean, label: string, detail?: string) {
  if (condition) {
    passes++;
    console.log(`✅ PASS: ${label}${detail ? ` (${detail})` : ''}`);
  } else {
    failures++;
    console.error(`❌ FAIL: ${label}${detail ? ` (${detail})` : ''}`);
  }
}

async function run() {
  console.log('====================================================');
  console.log('TESTING PROFITABLE YIELD-BOOSTED PARLAY OPTIMIZER');
  console.log('====================================================\n');

  const factory = new DataProviderFactory(config);
  const dateStr = new Date().toISOString().slice(0, 10);
  const fixtures = await factory.getFastFixturesForParlay(dateStr);

  console.log(`Loaded ${fixtures.length} real fixtures for ${dateStr}`);

  const candidatePredictions: MarketPrediction[] = [];
  for (const fx of fixtures) {
    try {
      const analysis = buildGenericAnalysis(fx);
      if (analysis?.marketPredictions?.length) {
        candidatePredictions.push(...analysis.marketPredictions);
      }
    } catch { /* skip */ }
  }

  console.log(`Generated ${candidatePredictions.length} candidate market predictions across slate\n`);

  // --- Test 1: 5-Leg Parlay ---
  console.log('--- 1. Testing 5-Leg Parlay (minProbability: 0.60) ---');
  const parlay5 = await buildStatisticalParlay(candidatePredictions, {
    targetLegsCount: 5,
    minProbability: 0.60,
    leagueFilter: 'ALL',
    mode: 'ANTI_CORRELATED',
    prioritizePriorityLeagues: true,
  });

  const odds5 = parlay5.totalBookieOdds ?? 0;
  const underCards5 = parlay5.legs.filter(l => l.market === 'UNDER_5_5_CARDS').length;
  console.log(`5-Leg Parlay Legs: ${parlay5.legs.length}`);
  console.log(`5-Leg Est. Bookmaker Odds: ${odds5.toFixed(2)}x (Fair: ${parlay5.compoundOddsDecimal}x)`);
  console.log(`5-Leg Selections:`);
  for (const l of parlay5.legs) {
    console.log(`  • ${l.fixtureDescription} (${l.league}): ${l.selection} (${l.bookieOdds?.toFixed(2)}x • ${(l.estimatedProbability * 100).toFixed(0)}%)`);
  }

  assert(parlay5.legs.length === 5, '5 legs assembled successfully', `got ${parlay5.legs.length}`);
  assert(odds5 >= 3.20, '5-leg parlay total bookmaker odds >= 3.20x', `actual: ${odds5.toFixed(2)}x`);
  assert(underCards5 <= 1, 'Under 5.5 Cards <= 20% of 5 legs (<= 1)', `actual: ${underCards5}`);

  // --- Test 2: 10-Leg Parlay ---
  console.log('\n--- 2. Testing 10-Leg Parlay (minProbability: 0.60) ---');
  const parlay10 = await buildStatisticalParlay(candidatePredictions, {
    targetLegsCount: 10,
    minProbability: 0.60,
    leagueFilter: 'ALL',
    mode: 'CORRELATED_ALLOWED',
    prioritizePriorityLeagues: true,
  });

  const odds10 = parlay10.totalBookieOdds ?? 0;
  const underCards10 = parlay10.legs.filter(l => l.market === 'UNDER_5_5_CARDS').length;
  console.log(`10-Leg Parlay Legs: ${parlay10.legs.length}`);
  console.log(`10-Leg Est. Bookmaker Odds: ${odds10.toFixed(2)}x (Fair: ${parlay10.compoundOddsDecimal}x)`);
  console.log(`10-Leg Selections:`);
  for (const l of parlay10.legs) {
    console.log(`  • ${l.fixtureDescription} (${l.league}): ${l.selection} (${l.bookieOdds?.toFixed(2)}x • ${(l.estimatedProbability * 100).toFixed(0)}%)`);
  }

  assert(parlay10.legs.length === 10, '10 legs assembled successfully', `got ${parlay10.legs.length}`);
  assert(odds10 >= 10.0, '10-leg parlay total bookmaker odds >= 10.0x', `actual: ${odds10.toFixed(2)}x`);
  assert(underCards10 <= 2, 'Under 5.5 Cards <= 20% of 10 legs (<= 2)', `actual: ${underCards10}`);

  // --- Test 3: Sweet-Spot Scoring Optimization ---
  console.log('\n--- 3. Testing Leg Yield Scoring Function ---');
  const sweetSpotPred: MarketPrediction = {
    id: 'test-sweet',
    fixtureId: 'fx-1',
    league: 'EPL',
    fixtureDescription: 'Team A vs Team B',
    kickoff: new Date().toISOString(),
    market: 'HOME_WIN',
    marketLabel: 'Match Result',
    selection: 'Team A to Win',
    estimatedProbability: 0.72,
    rawProbability: 0.72,
    bookieOdds: 1.33,
    fairOdds: 1.39,
    confidenceLower: 0.65,
    confidenceUpper: 0.78,
    supportingStatistics: {} as any,
    sampleSize: 10,
    dataFreshnessDays: 1,
    riskFactors: [],
  };

  const microOddsPred: MarketPrediction = {
    id: 'test-micro',
    fixtureId: 'fx-2',
    league: 'EPL',
    fixtureDescription: 'Team C vs Team D',
    kickoff: new Date().toISOString(),
    market: 'UNDER_5_5_CARDS',
    marketLabel: 'Total Cards',
    selection: 'Under 5.5 Total Cards',
    estimatedProbability: 0.88,
    rawProbability: 0.88,
    bookieOdds: 1.08,
    fairOdds: 1.14,
    confidenceLower: 0.82,
    confidenceUpper: 0.94,
    supportingStatistics: {} as any,
    sampleSize: 10,
    dataFreshnessDays: 1,
    riskFactors: [],
  };

  const sweetScore = computeLegYieldScore(sweetSpotPred, 5);
  const microScore = computeLegYieldScore(microOddsPred, 5);
  console.log(`Sweet-Spot Leg (1.33x, 72% HOME_WIN) Yield Score: ${sweetScore.toFixed(3)}`);
  console.log(`Micro-Odds Leg (1.08x, 88% UNDER_5_5_CARDS) Yield Score: ${microScore.toFixed(3)}`);
  assert(sweetScore > microScore, 'Sweet-spot line scores higher than micro-odds filler line', `diff: ${(sweetScore - microScore).toFixed(3)}`);

  console.log('\n====================================================');
  console.log(`TOTAL PASSES: ${passes}`);
  console.log(`TOTAL FAILURES: ${failures}`);
  console.log('====================================================');

  if (failures > 0) {
    process.exit(1);
  }
}

run().catch(err => {
  console.error('Unhandled error in test-profitable-parlay-odds:', err);
  process.exit(1);
});
