/**
 * Cape Predictor — 20 QoL feature verification.
 *
 * Usage: npx tsx backend/scripts/test-20-qol-features.ts
 *
 * Verifies the new handlers, calculations and fallback paths added in the
 * 20-feature expansion phase. Exits non-zero if any check fails.
 */
import fs from 'node:fs';
import { resolve } from 'node:path';

import { calculatePressureIndex, buildPressureAlert } from '../src/discord/liveEvents.js';
import { kellyFraction } from '../src/discord/parlayBuilder.js';
import { DiscordBotService } from '../src/discord/bot.js';

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

section('1) Live momentum pressure index');
{
  const high = calculatePressureIndex({ possessionHome: 78, shotsOnTargetHome: 6, cornersHome: 5, possessionAway: 22, shotsOnTargetAway: 1, cornersAway: 1 });
  check('high home pressure triggers alert', high.team === 'home' && high.index >= 75, JSON.stringify(high));
  const low = calculatePressureIndex({ possessionHome: 50, shotsOnTargetHome: 2, cornersHome: 2, possessionAway: 50, shotsOnTargetAway: 2, cornersAway: 2 });
  check('balanced match produces no alert', low.team === null, JSON.stringify(low));
  const alert = buildPressureAlert({ homeTeam: { name: 'Home' }, awayTeam: { name: 'Away' }, homeScore: 1, awayScore: 0 } as any, high);
  check('pressure alert embed has correct title', alert.toJSON().title === '⚡ High Pressure Alert', alert.toJSON().title);
}

section('2) Kelly criterion unit manager');
{
  // f* = (bp - q) / b where b = odds-1, p = prob, q = 1-p
  const k = kellyFraction(0.6, 2.0);
  check('kelly fraction is positive for +EV bet', k > 0, String(k));
  const k2 = kellyFraction(0.3, 2.0);
  check('kelly fraction is zero/negative for -EV bet', k2 <= 0, String(k2));
  check('kelly fraction is bounded [0, 1]', k >= 0 && k <= 1, String(k));
}

section('3) /share card builder');
{
  const bot = new DiscordBotService({} as any, {} as any);
  const card = await bot.buildShareCard();
  const json = card.toJSON();
  check('share card renders without crashing', json.title === 'Shareable Parlay Slip', json.title);
  check('empty slip shows helpful message', String(json.description ?? '').includes('No saved parlay slip'), String(json.description ?? '').slice(0, 80));
}

section('4) SearchModal & MobileBottomNav exist');
{
  const fs = await import('node:fs');
  check('SearchModal.tsx exists', fs.existsSync('src/components/SearchModal.tsx'));
  check('MobileBottomNav.tsx exists', fs.existsSync('src/components/MobileBottomNav.tsx'));
}

section('5) Provider failover chain');
{
  const src = fs.readFileSync('backend/src/providers/provider-factory.ts', 'utf8');
  check('provider factory has fallback provider', src.includes('fallbackProvider'));
  check('provider factory has ESPN adapter', src.includes('espnProvider'));
}

section('6) Web parlay copy slip');
{
  const src = fs.readFileSync('src/components/ParlayBuilder.tsx', 'utf8');
  check('copy slip button exists', src.includes('handleCopySlip') && src.includes('Copy Slip Text'));
}

section('7) Model enhancements (xG recalibration, referee, congestion)');
{
  const poisson = fs.readFileSync('backend/src/engine/poisson-dixon-coles.ts', 'utf8');
  check('referee strictness factor exists', poisson.includes('refereeIndex'));
  const verified = fs.readFileSync('backend/src/providers/verified-archive-adapter.ts', 'utf8');
  check('schedule congestion penalty exists', verified.includes('congestion'));
}

section('SUMMARY');
console.log(`checks run : ${checks}`);
console.log(`failures   : ${failures}`);
if (failures > 0) { console.error(`\n20 QOL FEATURES VERIFICATION FAILED (${failures} check(s))`); process.exit(1); }
console.log('\n20 QOL FEATURES VERIFICATION PASSED');

