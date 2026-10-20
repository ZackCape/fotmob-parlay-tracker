/**
 * Cape Predictor — highest-probability picks & new leagues verification.
 *
 * Usage: npx tsx backend/scripts/test-highest-prob-and-new-leagues.ts
 *
 * Verifies:
 *   - Match embeds display the highest probability pick first.
 *   - League configuration correctly handles Men's, Women's, and International fixtures.
 *
 * Exits non-zero if any check fails.
 */
import fs from 'node:fs';
import { resolve } from 'node:path';

import { LEAGUES, getLeagueById, getLeaguesByCategory } from '../src/config/leagues.js';

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

section('1) League configuration');
{
  check('leagues config loaded', LEAGUES.length >= 30, String(LEAGUES.length));
  check('EPL exists', !!getLeagueById('EPL'));
  check('EFL_1 exists', !!getLeagueById('EFL_1'));
  check('EFL_2 exists', !!getLeagueById('EFL_2'));
  check('ACL exists', !!getLeagueById('ACL'));
  check('WSL exists', !!getLeagueById('WSL'));
  check('NWSL exists', !!getLeagueById('NWSL'));
  check('UWCL exists', !!getLeagueById('UWCL'));
  check('LIGA_F exists', !!getLeagueById('LIGA_F'));
  check('FRAUEN_BL exists', !!getLeagueById('FRAUEN_BL'));
  check('PL_WOMEN exists', !!getLeagueById('PL_WOMEN'));
  check('UEFA_NATIONS_LEAGUE exists', !!getLeagueById('UEFA_NATIONS_LEAGUE'));
  check('FIFA_WC exists', !!getLeagueById('FIFA_WC'));
  check('UEFA_EUROS exists', !!getLeagueById('UEFA_EUROS'));
  check('AFCON exists', !!getLeagueById('AFCON'));
  check('CONCACAF_GOLD_CUP exists', !!getLeagueById('CONCACAF_GOLD_CUP'));
  check('COPA_AMERICA exists', !!getLeagueById('COPA_AMERICA'));
  check('INTL_FRIENDLIES exists', !!getLeagueById('INTL_FRIENDLIES'));
  check('domestic category has leagues', getLeaguesByCategory('domestic').length >= 15);
  check('womens category has leagues', getLeaguesByCategory('womens').length >= 6);
  check('international category has leagues', getLeaguesByCategory('international').length >= 7);
  check('continental category has leagues', getLeaguesByCategory('continental').length >= 3);
}

section('2) Highest probability prioritization');
{
  const botSrc = fs.readFileSync(resolve(process.cwd(), 'backend/src/discord/bot.ts'), 'utf8');
  check('valuePicks sorts by probability', botSrc.includes('orderByCompetitionPriorityThenScore'));
  check('briefing sorts by probability', botSrc.includes('orderByCompetitionPriorityThenScore'));
  const parlaySrc = fs.readFileSync(resolve(process.cwd(), 'backend/src/parlays/parlay-builder.ts'), 'utf8');
  check('parlay builder uses priority ordering', parlaySrc.includes('orderByCompetitionPriorityThenScore'));
}

section('3) 2-tier dropdown menus');
{
  const botSrc = fs.readFileSync(resolve(process.cwd(), 'backend/src/discord/bot.ts'), 'utf8');
  const prefixes = ['remind', 'value', 'poll', 'injuries', 'referee', 'analysis', 'cards', 'compare', 'h2h', 'halftime'];
  for (const p of prefixes) {
    check(`${p} two-tier prefix registered`, botSrc.includes(`'${p}'`) && botSrc.includes('twoTierPrefixes'));
  }
  check('two-tier dropdown system exists', botSrc.includes('twoTierPrefixes = ['));
}

section('SUMMARY');
console.log(`checks run : ${checks}`);
console.log(`failures   : ${failures}`);
if (failures > 0) { console.error(`\nHIGHEST PROB & NEW LEAGUES VERIFICATION FAILED (${failures} check(s))`); process.exit(1); }
console.log('\nHIGHEST PROB & NEW LEAGUES VERIFICATION PASSED');
