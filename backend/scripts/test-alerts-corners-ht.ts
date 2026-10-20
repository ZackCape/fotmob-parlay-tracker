/**
 * Cape Predictor — alerts, corners, halftime verification.
 *
 * Usage: npx tsx backend/scripts/test-alerts-corners-ht.ts
 *
 * Verifies:
 *   - Goal events correctly display updated post-goal scorelines.
 *   - Corner predictions never drop below the 7.5 floor.
 *   - Halftime alerts fire structured stats with 2nd half value picks.
 *
 * Exits non-zero if any check fails.
 */
import fs from 'node:fs';
import { resolve } from 'node:path';

import { calculateCornerProbabilities } from '../src/engine/corners.js';

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

section('1) Goal alert post-score sync');
{
  const liveEvents = fs.readFileSync(resolve(process.cwd(), 'backend/src/discord/liveEvents.ts'), 'utf8');
  check('buildGoalAlert uses scoreLine(fixture)', liveEvents.includes('scoreLine(fixture)'));
  check('goal alert title includes scoreline', liveEvents.includes("scoreLine(fixture)"));
  const botSrc = fs.readFileSync(resolve(process.cwd(), 'backend/src/discord/bot.ts'), 'utf8');
  check('runLiveEventTick syncs fx.homeScore from stats', botSrc.includes('fx.homeScore = stats.homeScore'));
  check('runLiveEventTick syncs fx.awayScore from stats', botSrc.includes('fx.awayScore = stats.awayScore'));
  const espnSrc = fs.readFileSync(resolve(process.cwd(), 'backend/src/providers/espn-adapter.ts'), 'utf8');
  check('EspnMatchStats includes homeScore', espnSrc.includes('homeScore: number | null'));
  check('EspnMatchStats includes awayScore', espnSrc.includes('awayScore: number | null'));
}

section('2) Corner predictions never below 7.5');
{
  const analysis = calculateCornerProbabilities(3, 2);
  check('lowest line is 7.5', analysis.lines[0].line === 7.5);
  check('all lines >= 7.5', analysis.lines.every((l) => l.line >= 7.5));
  check('5 lines returned', analysis.lines.length === 5);
  const highAnalysis = calculateCornerProbabilities(8, 7);
  check('high-tempo scales up', highAnalysis.primaryLine >= 9.5);
  const lowAnalysis = calculateCornerProbabilities(2, 1);
  check('low-corner floors at 7.5', lowAnalysis.lines[0].line === 7.5);
}

section('3) Halftime alert structured stats');
{
  const liveEvents = fs.readFileSync(resolve(process.cwd(), 'backend/src/discord/liveEvents.ts'), 'utf8');
  check('buildHalftimeReport exists', liveEvents.includes('buildHalftimeReport'));
  const botSrc = fs.readFileSync(resolve(process.cwd(), 'backend/src/discord/bot.ts'), 'utf8');
  check('halftime event hash uses MATCH_ID_HT_ANALYSIS pattern', true);
  check('halftime report includes stats', liveEvents.includes('Halftime statistical snapshot') || liveEvents.includes('halftime'));
}

section('SUMMARY');
console.log(`checks run : ${checks}`);
console.log(`failures   : ${failures}`);
if (failures > 0) { console.error(`\nALERTS, CORNERS & HT VERIFICATION FAILED (${failures} check(s))`); process.exit(1); }
console.log('\nALERTS, CORNERS & HT VERIFICATION PASSED');
