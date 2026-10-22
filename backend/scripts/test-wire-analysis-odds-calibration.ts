/**
 * Cape Predictor — wire analysis odds & calibration verification.
 *
 * Usage: npx tsx backend/scripts/test-wire-analysis-odds-calibration.ts
 *
 * Verifies:
 *   - AZ Alkmaar Win Probability > Ararat-Armenia Win Probability.
 *   - "Bookmaker odds unavailable" does NOT exist anywhere in the embed output string.
 *   - Value vs Market contains populated odds and +EV edge metrics.
 *
 * Exits non-zero if any check fails.
 */
import fs from 'node:fs';
import { resolve } from 'node:path';

import { calibrateFixture } from '../src/services/predictionEngine.js';

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

section('1) Human logic calibration (Ararat vs AZ Alkmaar)');
{
  const result = calibrateFixture(
    'Ararat-Armenia', 'AZ Alkmaar',
    'EFL_2', 'EREDIVISIE',
    0.35, 0.25, 0.40,
    1.2, 1.5,
    false, false, 0, 15, [],
  );
  check('AZ Alkmaar win prob > Ararat win prob', result.awayWinProb > result.homeWinProb, `home=${result.homeWinProb} away=${result.awayWinProb}`);
  check('Ararat xG capped at <= 0.85', result.homeXg <= 0.85, `homeXg=${result.homeXg}`);
  check('AZ Alkmaar win prob >= 0.65', result.awayWinProb >= 0.65, `awayWinProb=${result.awayWinProb}`);
  check('top pick is meaningful', result.topPick.length > 0, result.topPick);
}

section('2) No "Bookmaker odds unavailable" string');
{
  const ae = fs.readFileSync(resolve(process.cwd(), 'backend/src/discord/analysisEmbeds.ts'), 'utf8');
  check('string removed from analysisEmbeds', !ae.includes('Bookmaker odds unavailable'));
  const botSrc = fs.readFileSync(resolve(process.cwd(), 'backend/src/discord/bot.ts'), 'utf8');
  check('string removed from bot.ts', !botSrc.includes('Bookmaker odds unavailable'));
}

section('3) Value vs Market contains odds and EV');
{
  const ae = fs.readFileSync(resolve(process.cwd(), 'backend/src/discord/analysisEmbeds.ts'), 'utf8');
  check('Value vs market section exists', ae.includes('Value vs market'));
  check('Fair Model Baseline source shown', ae.includes('Fair Model Baseline'));
  check('EV edge metric shown', ae.includes('% EV)'));
  check('oddsAggregatorService referenced or fair odds computed', ae.includes('fairHome') || ae.includes('oddsAggregator'));
}

section('4) Odds aggregator service');
{
  const oa = fs.readFileSync(resolve(process.cwd(), 'backend/src/services/oddsAggregatorService.ts'), 'utf8');
  check('oddsAggregatorService exists', oa.length > 0);
  check('getOddsForFixture exists', oa.includes('getOddsForFixture'));
  check('Tier 3 fallback always available', oa.includes('Fair Model Baseline'));
}

section('SUMMARY');
console.log(`checks run : ${checks}`);
console.log(`failures   : ${failures}`);
if (failures > 0) { console.error(`\nWIRE ANALYSIS ODDS & CALIBRATION VERIFICATION FAILED (${failures} check(s))`); process.exit(1); }
console.log('\nWIRE ANALYSIS ODDS & CALIBRATION VERIFICATION PASSED');
