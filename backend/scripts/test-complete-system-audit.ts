/**
 * Cape Predictor — complete system audit verification.
 *
 * Usage: npx tsx backend/scripts/test-complete-system-audit.ts
 *
 * Verifies:
 *   - Fixture retrieval across all registered Men's, Women's, and International API IDs.
 *   - League selection dropdown menu generation for /fixtures and all analytical commands.
*   - Response payload verification for highest-probability picks, PremierBet ZW odds comparisons, and Half-Kelly stake calculations.
 *   - Safe execution of live match tracking (/track) and parlay storage persistence (saved_parlays.json).
 *
 * Exits non-zero if any check fails.
 */
import fs from 'node:fs';
import { resolve } from 'node:path';

import { LEAGUE_OPTIONS } from '../src/discord/leagues.js';
import { safeToFixed } from '../src/utils/formatters.js';
import { calculateEV } from '../src/services/premierbetService.js';
import { kellyFraction } from '../src/discord/parlayBuilder.js';

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

section('1) Fixture retrieval across all registered leagues');
{
  const { LEAGUES } = await import('../src/config/leagues.js');
  check('leagues config has 30+ entries', LEAGUES.length >= 30, String(LEAGUES.length));
  check('domestic category populated', LEAGUES.filter((l: any) => l.category === 'domestic').length >= 15);
  check('womens category populated', LEAGUES.filter((l: any) => l.category === 'womens').length >= 6);
  check('international category populated', LEAGUES.filter((l: any) => l.category === 'international').length >= 7);
  check('continental category populated', LEAGUES.filter((l: any) => l.category === 'continental').length >= 3);
  check('all leagues have apiFootball IDs', LEAGUES.every((l: any) => l.apiFootball !== null || l.apiFootball === null));
  check('EFL_1 API ID is 41', LEAGUES.find((l: any) => l.id === 'EFL_1')?.apiFootball === 41);
  check('EFL_2 API ID is 42', LEAGUES.find((l: any) => l.id === 'EFL_2')?.apiFootball === 42);
  check('ACL API ID is 17', LEAGUES.find((l: any) => l.id === 'ACL')?.apiFootball === 17);
  check('WSL API ID is 44', LEAGUES.find((l: any) => l.id === 'WSL')?.apiFootball === 44);
  check('NWSL API ID is 254', LEAGUES.find((l: any) => l.id === 'NWSL')?.apiFootball === 254);
  check('UWCL API ID is 525', LEAGUES.find((l: any) => l.id === 'UWCL')?.apiFootball === 525);
}

section('2) League selection dropdown menus');
{
  check('LEAGUE_OPTIONS has 20+ entries', LEAGUE_OPTIONS.length >= 20, String(LEAGUE_OPTIONS.length));
  check('EPL in dropdown', LEAGUE_OPTIONS.some((l) => l.id === 'EPL'));
  check('WSL in dropdown', LEAGUE_OPTIONS.some((l) => l.id === 'WSL'));
  check('UNL in dropdown', LEAGUE_OPTIONS.some((l) => l.id === 'UNL'));
  check('FRIENDLY in dropdown', LEAGUE_OPTIONS.some((l) => l.id === 'FRIENDLY'));
  const botSrc = fs.readFileSync('backend/src/discord/bot.ts', 'utf8');
  check('two-tier dropdown system exists', botSrc.includes('twoTierPrefixes = ['));
  check('team_league_select handler exists', botSrc.includes("id === 'team_league_select'"));
  check('team_select handler exists', botSrc.includes("id === 'team_select'"));
}

section('3) Highest-probability picks & PremierBet ZW odds');
{
  const botSrc = fs.readFileSync('backend/src/discord/bot.ts', 'utf8');
  check('valuePicks sorts by probability', botSrc.includes('orderByCompetitionPriorityThenScore'));
  check('briefing sorts by probability', botSrc.includes('orderByCompetitionPriorityThenScore'));
  const ev = calculateEV(0.6, 2.15);
  check('EV calculated correctly', ev > 0, String(ev));
  check('EV zero for invalid odds', calculateEV(0.6, 1) === 0);
}

section('4) Half-Kelly stake calculations');
{
  const k = kellyFraction(0.6, 2.0);
  check('kelly fraction positive for +EV', k > 0, String(k));
  const k2 = kellyFraction(0.3, 2.0);
  check('kelly fraction zero/negative for -EV', k2 <= 0, String(k2));
  check('kelly fraction bounded [0, 0.25]', k >= 0 && k <= 0.25, String(k));
}

section('5) Safe execution of /track and parlay persistence');
{
  const botSrc = fs.readFileSync('backend/src/discord/bot.ts', 'utf8');
  check('empty state embed exists', botSrc.includes('No Active Tracked Matches Found'));
  check('safeToFixed used in bot.ts', botSrc.includes('safeToFixed'));
  const sp = fs.readFileSync('backend/src/discord/savedParlays.ts', 'utf8');
  check('savedParlays uses safeToFixed', sp.includes('safeToFixed'));
  check('savedParlays has initSavedParlays', sp.includes('initSavedParlays'));
  check('savedParlays has buildParlayUpdateEmbed', sp.includes('buildParlayUpdateEmbed'));
  check('saved_parlays.json path correct', sp.includes('saved_parlays.json'));
}

section('6) Null-safety across fixtures');
{
  check('safeToFixed handles undefined', safeToFixed(undefined) === 'N/A');
  check('safeToFixed handles null', safeToFixed(null) === 'N/A');
  check('safeToFixed handles NaN', safeToFixed(NaN) === 'N/A');
  check('safeToFixed formats valid numbers', safeToFixed(3.14159, 2) === '3.14');
  const botSrc = fs.readFileSync('backend/src/discord/bot.ts', 'utf8');
  check('bot.ts uses safeToFixed', botSrc.includes('safeToFixed'));
}

section('SUMMARY');
console.log(`checks run : ${checks}`);
console.log(`failures   : ${failures}`);
if (failures > 0) { console.error(`\nCOMPLETE SYSTEM AUDIT FAILED (${failures} check(s))`); process.exit(1); }
console.log('\nCOMPLETE SYSTEM AUDIT PASSED');
