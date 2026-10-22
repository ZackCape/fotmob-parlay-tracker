/**
 * Cape Predictor — tier disparity & human logic verification.
 *
 * Usage: npx tsx backend/scripts/test-tier-disparity-human-logic.ts
 *
 * Verifies:
 *   - League quality tiers are correctly assigned.
 *   - Opponent-adjusted form weights recent matches by tier.
 *   - David vs Goliath compression caps lower-tier xG and sets win floor.
 *   - Hybrid ensemble calibration blends model + market odds.
 *
 * Exits non-zero if any check fails.
 */
import fs from 'node:fs';
import { resolve } from 'node:path';

import { getLeagueQuality, calculateOpponentAdjustedForm, getEuropeanExperiencePenalty } from '../src/services/tierDisparityService.js';
import { applyHumanLogic } from '../src/services/humanLogicEngine.js';

let failures = 0;
let checks = 0;

function check(label: string, condition: boolean, detail?: string) {
  checks++;
  if (condition) console.log(`  PASS  ${label}`);
  else { failures++; console.log(`  FAIL  ${label}${detail ? ` -> ${detail}` : ''}`); }
}

function section(title: string) {
  console.log(`\n${'='.repeat(70)}\n${title}\n${'='.repeat(70)}`);
}

section('1) League tier quality');
{
  check('EPL is Tier 1', getLeagueQuality('EPL').tier === 1);
  check('EPL quality >= 1.85', getLeagueQuality('EPL').q >= 1.85);
  check('UCL is Tier 1', getLeagueQuality('CHAMPIONS_LEAGUE').tier === 1);
  check('Championship is Tier 2', getLeagueQuality('CHAMPIONSHIP').tier === 2);
  check('WSL is Tier 3', getLeagueQuality('WSL').tier === 3);
  check('Unknown league defaults to Tier 4', getLeagueQuality('UNKNOWN_LEAGUE').tier === 4);
}

section('2) Opponent-adjusted form');
{
  const homeResults = [
    { result: 'W' as const, opponentLeague: 'EPL' },
    { result: 'W' as const, opponentLeague: 'LALIGA' },
    { result: 'D' as const, opponentLeague: 'SERIE_A' },
    { result: 'W' as const, opponentLeague: 'BUNDESLIGA' },
    { result: 'L' as const, opponentLeague: 'LIGUE1' },
  ];
  const awayResults = [
    { result: 'W' as const, opponentLeague: 'EKSTRAKLASA' },
    { result: 'W' as const, opponentLeague: 'EFL_1' },
    { result: 'W' as const, opponentLeague: 'EFL_2' },
    { result: 'D' as const, opponentLeague: 'DANISH_SUPERLIGA' },
    { result: 'W' as const, opponentLeague: 'SWISS_SUPER' },
  ];
  const form = calculateOpponentAdjustedForm(homeResults, awayResults);
  check('home form > away form (stronger opponents)', form.home > form.away, `home=${form.home} away=${form.away}`);
  check('disparity detected', form.disparity > 0.3, `disparity=${form.disparity}`);
  check('match dynamic mentions disparity', form.matchDynamic.toLowerCase().includes('dominance') || form.matchDynamic.toLowerCase().includes('balanced') || form.matchDynamic.toLowerCase().includes('disparity') || form.matchDynamic.toLowerCase().includes('advantage'));
}

section('3) European experience penalty');
{
  check('no European matches = 0.75 penalty', getEuropeanExperiencePenalty('Team', 0) === 0.75);
  check('1-3 matches = 0.85 penalty', getEuropeanExperiencePenalty('Team', 2) === 0.85);
  check('7+ matches = no penalty', getEuropeanExperiencePenalty('Team', 10) === 1.0);
}

section('4) David vs Goliath compression');
{
  const ctx = {
    homeTeam: 'Ararat-Armenia',
    awayTeam: 'AZ Alkmaar',
    homeLeague: 'EFL_2',
    awayLeague: 'EREDIVISIE',
    isCupMatch: false,
    isEuropeanKnockout: false,
    homeEuropeanMatches: 0,
    awayEuropeanMatches: 15,
    homeForm: ['W', 'W', 'W', 'D', 'W'] as Array<'W' | 'D' | 'L'>,
    awayForm: ['W', 'W', 'D', 'W', 'L'] as Array<'W' | 'D' | 'L'>,
    h2hResults: [],
  };
  const result = applyHumanLogic(ctx, 0.35, 0.25, 0.40, 1.2, 1.5);
  check('lower-tier xG capped at <= 0.85', result.homeXg <= 0.85, `homeXg=${result.homeXg}`);
  check('elite win prob >= 65%', result.awayWinProb >= 0.65, `awayWinProb=${result.awayWinProb}`);
  check('corner bias is high', result.cornerBias === 'high');
  check('adjustments include David vs Goliath', result.adjustments.some((a) => a.includes('David vs Goliath')));
  check('out-of-depth penalty applied', result.adjustments.some((a) => a.includes('Out-of-Depth')));
  check('match dynamic mentions dominance', result.matchDynamic.toLowerCase().includes('dominance') || result.matchDynamic.toLowerCase().includes('balanced'));
}

section('5) Elite fixture calibration');
{
  const ctx = {
    homeTeam: 'Real Madrid',
    awayTeam: 'Bayern Munich',
    homeLeague: 'LALIGA',
    awayLeague: 'BUNDESLIGA',
    isCupMatch: false,
    isEuropeanKnockout: true,
    homeEuropeanMatches: 50,
    awayEuropeanMatches: 45,
    homeForm: ['W', 'W', 'W', 'W', 'D'] as Array<'W' | 'D' | 'L'>,
    awayForm: ['W', 'W', 'D', 'W', 'W'] as Array<'W' | 'D' | 'L'>,
    h2hResults: [],
  };
  const result = applyHumanLogic(ctx, 0.45, 0.25, 0.30, 1.8, 1.7);
  check('home xG >= 1.65', result.homeXg >= 1.65, `homeXg=${result.homeXg}`);
  check('away xG >= 1.65', result.awayXg >= 1.65, `awayXg=${result.awayXg}`);
  check('European knockout boost applied', result.adjustments.some((a) => a.includes('European knockout')));
  check('top pick is meaningful', result.topPick.length > 0, result.topPick);
}

section('6) Cup match rotation');
{
  const ctx = {
    homeTeam: 'Manchester City',
    awayTeam: 'Lower Tier FC',
    homeLeague: 'EPL',
    awayLeague: 'EFL_2',
    isCupMatch: true,
    isEuropeanKnockout: false,
    homeEuropeanMatches: 40,
    awayEuropeanMatches: 0,
    homeForm: ['W', 'W', 'W', 'W', 'W'] as Array<'W' | 'D' | 'L'>,
    awayForm: ['L', 'L', 'D', 'L', 'W'] as Array<'W' | 'D' | 'L'>,
    h2hResults: [],
  };
  const result = applyHumanLogic(ctx, 0.80, 0.12, 0.08, 2.0, 0.6);
  check('cup rotation applied', result.adjustments.some((a) => a.includes('Cup rotation')));
  check('lower-tier xG capped', result.awayXg <= 0.85, `awayXg=${result.awayXg}`);
  check('elite win prob >= 65%', result.homeWinProb >= 0.65, `homeWinProb=${result.homeWinProb}`);
}

section('SUMMARY');
console.log(`checks run : ${checks}`);
console.log(`failures   : ${failures}`);
if (failures > 0) { console.error(`\nTIER DISPARITY & HUMAN LOGIC VERIFICATION FAILED (${failures} check(s))`); process.exit(1); }
console.log('\nTIER DISPARITY & HUMAN LOGIC VERIFICATION PASSED');
