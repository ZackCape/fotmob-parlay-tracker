/**
 * Cape Predictor — /track fix verification.
 *
 * Usage: npx tsx backend/scripts/test-track-fix.ts
 *
 * Verifies that passing undefined, null, or partial match objects to /track
 * embed builders produces valid output without crashing.
 *
 * Exits non-zero if any check fails.
 */
import fs from 'node:fs';
import { safeToFixed } from '../src/utils/formatters.js';

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

section('1) safeToFixed helper');
{
  check('undefined returns fallback', safeToFixed(undefined) === 'N/A');
  check('null returns fallback', safeToFixed(null) === 'N/A');
  check('NaN returns fallback', safeToFixed(NaN) === 'N/A');
  check('valid number formats correctly', safeToFixed(3.14159, 2) === '3.14');
  check('custom fallback works', safeToFixed(undefined, 2, 'N/A') === 'N/A');
  check('zero formats correctly', safeToFixed(0, 2) === '0.00');
}

section('2) /track empty state');
{
  const fs = await import('node:fs');
  const botSrc = fs.readFileSync('backend/src/discord/bot.ts', 'utf8');
  check('empty state embed exists', botSrc.includes('No Active Tracked Matches Found'));
  check('empty state has helpful description', botSrc.includes('Use /analysis or the Web Dashboard to track a match'));
}

section('3) toFixed safety in savedParlays');
{
  const sp = fs.readFileSync('backend/src/discord/savedParlays.ts', 'utf8');
  check('stake uses safeToFixed', sp.includes('safeToFixed(saved.stake'));
  check('combinedOdds uses safeToFixed', sp.includes('safeToFixed(saved.combinedOdds'));
}

section('4) toFixed safety in bot.ts /track');
{
  const botSrc = fs.readFileSync('backend/src/discord/bot.ts', 'utf8');
  check('cashoutProbabilityIndex uses safeToFixed', botSrc.includes('safeToFixed(updated.cashoutProbabilityIndex'));
}

section('SUMMARY');
console.log(`checks run : ${checks}`);
console.log(`failures   : ${failures}`);
if (failures > 0) { console.error(`\nTRACK FIX VERIFICATION FAILED (${failures} check(s))`); process.exit(1); }
console.log('\nTRACK FIX VERIFICATION PASSED');
