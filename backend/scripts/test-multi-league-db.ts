/**
 * Comprehensive verification suite for the Multi-League Historical Database
 * and Cross-Competition Form Linker.
 */

import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import {
  resolveCanonicalTeamKey,
  getTeamVerifiedForm,
  recordVerifiedMatch,
  getTeamRecentStats,
  setStoragePath,
  resetStoragePath,
  clearDatabase,
} from '../src/services/multiLeagueDbService.js';

let passed = 0;
let failed = 0;

function assert(condition: boolean, msg: string) {
  if (condition) {
    console.log(`  ✓ ${msg}`);
    passed++;
  } else {
    console.error(`  ✗ FAIL: ${msg}`);
    failed++;
  }
}

async function runTests() {
  console.log('\n=== Multi-League Historical DB & Cross-Competition Form Tests ===\n');

  // Use a temporary test database file to isolate tests
  const testDbFile = path.join(os.tmpdir(), `test_multi_league_${Date.now()}.json`);
  setStoragePath(testDbFile);
  clearDatabase();

  try {
    // -------------------------------------------------------------------------
    // Test 1: Canonical Entity Linker
    // -------------------------------------------------------------------------
    console.log('1. Canonical Team Entity Linker');
    assert(
      resolveCanonicalTeamKey('AS Roma') === 'as_roma',
      'Resolves "AS Roma" -> "as_roma"'
    );
    assert(
      resolveCanonicalTeamKey('Roma') === 'as_roma',
      'Resolves "Roma" -> "as_roma"'
    );
    assert(
      resolveCanonicalTeamKey('Manchester United FC') === 'manchester_united',
      'Resolves "Manchester United FC" -> "manchester_united"'
    );
    assert(
      resolveCanonicalTeamKey('Man Utd') === 'manchester_united',
      'Resolves "Man Utd" -> "manchester_united"'
    );
    assert(
      resolveCanonicalTeamKey('Real Madrid CF') === 'real_madrid',
      'Resolves "Real Madrid CF" -> "real_madrid"'
    );
    assert(
      resolveCanonicalTeamKey('FC Barcelona') === 'barcelona',
      'Resolves "FC Barcelona" -> "barcelona"'
    );
    assert(
      resolveCanonicalTeamKey('Unknown FC 1234') === 'unknown_1234',
      'Slugs arbitrary club without collisions (stripping common suffixes like FC)'
    );

    // -------------------------------------------------------------------------
    // Test 2: Zero Synthetic Fallbacks (Strict Data Honesty)
    // -------------------------------------------------------------------------
    console.log('\n2. Zero Synthetic Fallback on Missing Data');
    const unknownForm = getTeamVerifiedForm('Fictional Wanderers FC');
    assert(unknownForm.hasData === false, 'hasData is false when no matches recorded');
    assert(unknownForm.results.length === 0, 'results array is strictly empty');
    assert(unknownForm.formGlyphs === '', 'formGlyphs is strictly empty string (0 fake circles)');
    assert(
      unknownForm.formattedSummary === 'Form data unavailable (no recent verified matches in feed)',
      'Returns honest unavailable text'
    );

    // -------------------------------------------------------------------------
    // Test 3: Cross-Competition Ingestion & Chronological Form Sequence
    // -------------------------------------------------------------------------
    console.log('\n3. Cross-Competition Linker (Domestic Serie A + European UEL)');
    // Match 1: AS Roma in Serie A (2025-02-10) - Win 2-1 vs Lazio
    recordVerifiedMatch({
      competition: 'SERIE_A',
      date: '2025-02-10T19:45:00Z',
      homeTeam: 'AS Roma',
      awayTeam: 'SS Lazio',
      homeScore: 2,
      awayScore: 1,
      status: 'FT',
      source: 'test-feed',
    });

    // Match 2: AS Roma in Europa League (2025-02-14) - Draw 1-1 vs Porto
    recordVerifiedMatch({
      competition: 'EUROPA_LEAGUE',
      date: '2025-02-14T20:00:00Z',
      homeTeam: 'Porto',
      awayTeam: 'Roma',
      homeScore: 1,
      awayScore: 1,
      status: 'FT',
      source: 'test-feed',
    });

    // Match 3: AS Roma in Serie A (2025-02-18) - Win 3-0 at Monza
    recordVerifiedMatch({
      competition: 'SERIE_A',
      date: '2025-02-18T14:00:00Z',
      homeTeam: 'AC Monza',
      awayTeam: 'AS Roma',
      homeScore: 0,
      awayScore: 3,
      status: 'FT',
      source: 'test-feed',
    });

    // Match 4: AS Roma in Europa League (2025-02-22) - Loss 0-2 at Real Sociedad
    recordVerifiedMatch({
      competition: 'EUROPA_LEAGUE',
      date: '2025-02-22T20:00:00Z',
      homeTeam: 'Real Sociedad',
      awayTeam: 'AS Roma',
      homeScore: 2,
      awayScore: 0,
      status: 'FT',
      source: 'test-feed',
    });

    // Match 5: AS Roma in Serie A (2025-02-26) - Win 1-0 vs Juventus
    recordVerifiedMatch({
      competition: 'SERIE_A',
      date: '2025-02-26T19:45:00Z',
      homeTeam: 'Roma',
      awayTeam: 'Juventus FC',
      homeScore: 1,
      awayScore: 0,
      status: 'FT',
      source: 'test-feed',
    });

    const romaForm = getTeamVerifiedForm('AS Roma', 5);
    assert(romaForm.hasData === true, 'Roma hasData is true');
    assert(romaForm.totalMatches === 5, 'Recorded 5 matches total');
    
    // Chronological order descending: Feb 26 (W), Feb 22 (L), Feb 18 (W), Feb 14 (D), Feb 10 (W)
    assert(
      JSON.stringify(romaForm.results) === JSON.stringify(['W', 'L', 'W', 'D', 'W']),
      `Correct chronological form sequence: ${romaForm.results.join('-')} === W-L-W-D-W`
    );
    assert(
      romaForm.formGlyphs === '🟢🔴🟢🟡🟢',
      `Correct form glyphs: ${romaForm.formGlyphs}`
    );
    assert(
      romaForm.recordSummary === '3W 1D 1L',
      `Correct record summary: ${romaForm.recordSummary}`
    );

    // Check individual match attribution
    assert(
      romaForm.recentMatches[0].opponent === 'Juventus FC' && romaForm.recentMatches[0].result === 'W',
      'Most recent match correctly identified against Juventus'
    );
    assert(
      romaForm.recentMatches[1].competition === 'EUROPA_LEAGUE' && romaForm.recentMatches[1].result === 'L',
      'European UEL loss correctly merged in sequence'
    );

    // -------------------------------------------------------------------------
    // Test 4: Goal Stats Calculation (Attacking & Defensive multi-league metrics)
    // -------------------------------------------------------------------------
    console.log('\n4. Multi-League Aggregated Scoring & Defense');
    // Roma scored: 1 + 0 + 3 + 1 + 2 = 7 goals across 5 matches
    // Roma conceded: 0 + 2 + 0 + 1 + 1 = 4 goals across 5 matches
    const stats = getTeamRecentStats('Roma');
    assert(stats !== null, 'Stats retrieved for Roma');
    assert(stats?.goalsScored === 7, `Goals scored is 7 (got ${stats?.goalsScored})`);
    assert(stats?.goalsConceded === 4, `Goals conceded is 4 (got ${stats?.goalsConceded})`);
    assert(stats?.avgGoalsScored === 1.4, `Avg goals scored is 1.4 (got ${stats?.avgGoalsScored})`);
    assert(stats?.avgGoalsConceded === 0.8, `Avg goals conceded is 0.8 (got ${stats?.avgGoalsConceded})`);

    // -------------------------------------------------------------------------
    // Test 5: Partial Samples (e.g. only 2 matches recorded)
    // -------------------------------------------------------------------------
    console.log('\n5. Partial Samples Never Padded With Synthetic Data');
    recordVerifiedMatch({
      competition: 'EPL',
      date: '2025-02-15T15:00:00Z',
      homeTeam: 'Brentford',
      awayTeam: 'Everton',
      homeScore: 1,
      awayScore: 0,
      status: 'FT',
      source: 'test-feed',
    });
    recordVerifiedMatch({
      competition: 'EPL',
      date: '2025-02-22T15:00:00Z',
      homeTeam: 'Everton',
      awayTeam: 'Crystal Palace',
      homeScore: 2,
      awayScore: 2,
      status: 'FT',
      source: 'test-feed',
    });

    const evertonForm = getTeamVerifiedForm('Everton', 5);
    assert(evertonForm.hasData === true, 'Everton hasData is true');
    assert(evertonForm.totalMatches === 2, 'Total matches is exactly 2');
    assert(evertonForm.results.length === 2, 'Results array has length 2 (never padded to 5)');
    assert(evertonForm.formGlyphs === '🟡🔴', 'Everton form glyphs show exactly 2 circles (🟡🔴)');
    assert(evertonForm.recordSummary === '0W 1D 1L', 'Record summary shows 0W 1D 1L');

    // -------------------------------------------------------------------------
    // Test 6: Deduplication Check
    // -------------------------------------------------------------------------
    console.log('\n6. Duplicate Match Deduplication');
    recordVerifiedMatch({
      competition: 'EPL',
      date: '2025-02-22T15:00:00Z',
      homeTeam: 'Everton',
      awayTeam: 'Crystal Palace',
      homeScore: 2,
      awayScore: 2,
      status: 'FT',
      source: 'second-ingestion-pass',
    });
    const dedupedForm = getTeamVerifiedForm('Everton', 5);
    assert(dedupedForm.totalMatches === 2, 'Duplicate match was cleanly ignored');

  } finally {
    // Cleanup temporary test DB
    resetStoragePath();
    if (fs.existsSync(testDbFile)) {
      try {
        fs.unlinkSync(testDbFile);
      } catch {}
    }
  }

  console.log(`\n--------------------------------------------------`);
  console.log(`Results: ${passed} passed, ${failed} failed`);
  console.log(`--------------------------------------------------\n`);

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('Unhandled test error:', err);
  process.exit(1);
});
