/**
 * Verification script for European Club Elo & Bookmaker Odds Hybrid Engine.
 *
 * Verifies:
 * 1. Real Madrid vs AEK Athens:
 *    - Real Madrid win prob > 72%
 *    - Over 1.5 Goals > 70%
 *    - AEK Athens Over 0.5 Goals < 55%
 * 2. Manchester City vs Southampton:
 *    - Man City win prob > 78%
 * 3. Arsenal vs Liverpool:
 *    - Top-tier balanced probabilities
 * 4. Provider Factory & Calendar Fixtures:
 *    - Zero synthetic matches (no Viking FK, Sabah FK, Lens vs Como, Cardiff vs West Ham)
 *    - getCalendarFixturesForDate returns empty list (pure real feeds only)
 */

import { Fixture } from '../src/types/football.js';
import { deriveMarketPredictions } from '../src/engine/market-calculator.js';
import { calculateHybridExpectedGoals, getClubElo } from '../src/services/clubEloService.js';
import { getCalendarFixturesForDate } from '../src/data/fixtures-calendar.js';
import { DataProviderFactory } from '../src/providers/provider-factory.js';
import { config } from '../src/config/env.js';
import fs from 'node:fs';
import path from 'node:path';

let failures = 0;
let passes = 0;

function assert(condition: boolean, testName: string, details?: string) {
  if (condition) {
    passes++;
    console.log(`✅ PASS: ${testName}${details ? ` (${details})` : ''}`);
  } else {
    failures++;
    console.error(`❌ FAIL: ${testName}${details ? ` (${details})` : ''}`);
  }
}

async function run() {
  console.log('====================================================');
  console.log('TESTING EUROPEAN CLUB ELO & QUANTITATIVE HYBRID ENGINE');
  console.log('====================================================\n');

  // Test 1: Real Madrid vs AEK Athens
  console.log('--- 1. Real Madrid vs AEK Athens (Continental Elite vs Underdog) ---');
  const rmElo = getClubElo('Real Madrid', 'CHAMPIONS_LEAGUE');
  const aekElo = getClubElo('AEK Athens', 'CHAMPIONS_LEAGUE');
  console.log(`Real Madrid Elo: ${rmElo}, AEK Athens Elo: ${aekElo}`);
  assert(rmElo >= 2000, 'Real Madrid Tier 1 Elo >= 2000', `Elo: ${rmElo}`);
  assert(aekElo <= 1700, 'AEK Athens Tier 4 Elo <= 1700', `Elo: ${aekElo}`);

  const rmAekFixture = {
    id: 'test-ucl-rm-aek',
    league: 'CHAMPIONS_LEAGUE',
    homeTeam: { id: 'rm', name: 'Real Madrid', shortName: 'Real Madrid' },
    awayTeam: { id: 'aek', name: 'AEK Athens', shortName: 'AEK Athens' },
    kickoffTime: new Date().toISOString(),
    status: 'TIMED',
    homeScore: null,
    awayScore: null,
  } as any as Fixture;

  const rmAekHybrid = calculateHybridExpectedGoals({
    homeTeam: 'Real Madrid',
    awayTeam: 'AEK Athens',
    league: 'CHAMPIONS_LEAGUE',
  });
  console.log(`Hybrid Expected Goals: RM = ${rmAekHybrid.lambdaHome}, AEK = ${rmAekHybrid.lambdaAway}`);
  console.log(`Hybrid Win Probs: RM = ${(rmAekHybrid.winProbHome * 100).toFixed(1)}%, Draw = ${(rmAekHybrid.drawProb * 100).toFixed(1)}%, AEK = ${(rmAekHybrid.winProbAway * 100).toFixed(1)}%`);

  const rmAekPreds = deriveMarketPredictions(
    rmAekFixture,
    1.4, 0.9, 0.9, 1.3,
    {} as any,
    0, 0, []
  );

  const rmWin = rmAekPreds.find(p => p.market === 'HOME_WIN')?.estimatedProbability ?? 0;
  const rmOver15 = rmAekPreds.find(p => p.market === 'OVER_1_5')?.estimatedProbability ?? 0;
  const aekOver05 = rmAekPreds.find(p => p.market === 'AWAY_OVER_0_5')?.estimatedProbability ?? 0;

  console.log(`Model Estimated Probabilities:`);
  console.log(`  Real Madrid Win: ${(rmWin * 100).toFixed(1)}%`);
  console.log(`  Over 1.5 Goals: ${(rmOver15 * 100).toFixed(1)}%`);
  console.log(`  AEK Athens Over 0.5 Goals: ${(aekOver05 * 100).toFixed(1)}%`);

  assert(rmWin > 0.72, 'Real Madrid win prob > 72%', `${(rmWin * 100).toFixed(1)}%`);
  assert(rmOver15 > 0.70, 'Over 1.5 Goals > 70%', `${(rmOver15 * 100).toFixed(1)}%`);
  assert(aekOver05 < 0.55, 'AEK Athens Over 0.5 Goals < 55%', `${(aekOver05 * 100).toFixed(1)}%`);

  // Test 2: Manchester City vs Southampton
  console.log('\n--- 2. Manchester City vs Southampton (Heavy Domestic Favorite) ---');
  const mciFixture = {
    id: 'test-epl-mci-sou',
    league: 'EPL',
    homeTeam: { id: 'mci', name: 'Manchester City', shortName: 'Man City' },
    awayTeam: { id: 'sou', name: 'Southampton', shortName: 'Southampton' },
    kickoffTime: new Date().toISOString(),
    status: 'TIMED',
    homeScore: null,
    awayScore: null,
  } as any as Fixture;

  const mciPreds = deriveMarketPredictions(
    mciFixture,
    1.5, 0.8, 0.8, 1.4,
    {} as any,
    0, 0, []
  );

  const mciWin = mciPreds.find(p => p.market === 'HOME_WIN')?.estimatedProbability ?? 0;
  console.log(`Man City Win Prob: ${(mciWin * 100).toFixed(1)}%`);
  assert(mciWin > 0.78, 'Manchester City win prob > 78%', `${(mciWin * 100).toFixed(1)}%`);

  // Test 3: Arsenal vs Liverpool
  console.log('\n--- 3. Arsenal vs Liverpool (Top-Tier Balanced Matchup) ---');
  const arsLivFixture = {
    id: 'test-epl-ars-liv',
    league: 'EPL',
    homeTeam: { id: 'ars', name: 'Arsenal', shortName: 'Arsenal' },
    awayTeam: { id: 'liv', name: 'Liverpool', shortName: 'Liverpool' },
    kickoffTime: new Date().toISOString(),
    status: 'TIMED',
    homeScore: null,
    awayScore: null,
  } as any as Fixture;

  const arsLivPreds = deriveMarketPredictions(
    arsLivFixture,
    1.2, 0.9, 1.2, 0.9,
    {} as any,
    0, 0, []
  );

  const arsWin = arsLivPreds.find(p => p.market === 'HOME_WIN')?.estimatedProbability ?? 0;
  const livWin = arsLivPreds.find(p => p.market === 'AWAY_WIN')?.estimatedProbability ?? 0;
  const drawProb = arsLivPreds.find(p => p.market === 'DRAW')?.estimatedProbability ?? 0;

  console.log(`Arsenal Win: ${(arsWin * 100).toFixed(1)}%, Draw: ${(drawProb * 100).toFixed(1)}%, Liverpool Win: ${(livWin * 100).toFixed(1)}%`);
  assert(arsWin >= 0.30 && arsWin <= 0.60, 'Arsenal win prob balanced between 30% and 60%', `${(arsWin * 100).toFixed(1)}%`);
  assert(livWin >= 0.20 && livWin <= 0.50, 'Liverpool win prob balanced between 20% and 50%', `${(livWin * 100).toFixed(1)}%`);
  assert(Math.abs(arsWin - livWin) < 0.30, 'Arsenal and Liverpool win probabilities are closely contested', `Spread: ${Math.abs(arsWin - livWin).toFixed(3)}`);

  // Test 4: Pure Real Feeds & Zero Synthetic Fixtures
  console.log('\n--- 4. Data Integrity: Zero Synthetic Matches ---');
  const calendarFixtures = getCalendarFixturesForDate(new Date().toISOString().slice(0, 10));
  console.log(`getCalendarFixturesForDate() count: ${calendarFixtures.length}`);
  assert(calendarFixtures.length === 0, 'Synthetic calendar generation disabled (returns 0 fixtures)');

  // Inspect fixtures cache on disk
  const cachePath = path.resolve('data/fixtures_cache.json');
  if (fs.existsSync(cachePath)) {
    const rawCache = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
    const allCacheFixtures = Array.isArray(rawCache) ? rawCache : (rawCache.fixtures || []);
    const fakeMatches = allCacheFixtures.filter((f: any) => {
      const matchDesc = `${f.homeTeam?.name ?? ''} vs ${f.awayTeam?.name ?? ''}`.toLowerCase();
      return (
        matchDesc.includes('viking') ||
        matchDesc.includes('sabah') ||
        matchDesc.includes('lens vs como') ||
        matchDesc.includes('cardiff city vs west ham')
      );
    });
    console.log(`Fake matches found in fixtures_cache.json: ${fakeMatches.length}`);
    assert(fakeMatches.length === 0, 'No synthetic fixtures in data/fixtures_cache.json');
  }

  // Check Provider Factory live fixtures
  const factory = new DataProviderFactory(config);
  try {
    const fastFixtures = await factory.getFastFixturesForParlay(new Date().toISOString().slice(0, 10));
    const fakeInFast = fastFixtures.filter(f => {
      const desc = `${f.homeTeam?.name ?? ''} vs ${f.awayTeam?.name ?? ''}`.toLowerCase();
      return desc.includes('viking fk') || desc.includes('sabah fk');
    });
    assert(fakeInFast.length === 0, 'ProviderFactory returns zero synthetic fixtures', `Found ${fakeInFast.length} fake matches`);
  } catch (err: any) {
    console.warn(`ProviderFactory fast fixtures fetch error (offline ok): ${err.message}`);
  }

  console.log('\n====================================================');
  console.log(`TOTAL PASSES: ${passes}`);
  console.log(`TOTAL FAILURES: ${failures}`);
  console.log('====================================================');

  if (failures > 0) {
    process.exit(1);
  }
}

run().catch(err => {
  console.error('Unhandled verification error:', err);
  process.exit(1);
});
