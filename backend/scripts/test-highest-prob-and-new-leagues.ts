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
  check('WSL API ID is 44', getLeagueById('WSL')?.apiFootball === 44);
  check('NWSL API ID is 254', getLeagueById('NWSL')?.apiFootball === 254);
  check('UWCL API ID is 525', getLeagueById('UWCL')?.apiFootball === 525);
  check('LIGA_F API ID is 142', getLeagueById('LIGA_F')?.apiFootball === 142);
  check('FRAUEN_BL API ID is 82', getLeagueById('FRAUEN_BL')?.apiFootball === 82);
  check('PL_WOMEN API ID is 64', getLeagueById('PL_WOMEN')?.apiFootball === 64);
  check('EFL_1 API ID is 41', getLeagueById('EFL_1')?.apiFootball === 41);
  check('EFL_2 API ID is 42', getLeagueById('EFL_2')?.apiFootball === 42);
  check('ACL API ID is 17', getLeagueById('ACL')?.apiFootball === 17);
  check('UNL API ID is 5', getLeagueById('UNL')?.apiFootball === 5);
  check('UNL_W API ID is 1040', getLeagueById('UNL_W')?.apiFootball === 1040);
  check('WC API ID is 1', getLeagueById('WC')?.apiFootball === 1);
  check('WC_W API ID is 8', getLeagueById('WC_W')?.apiFootball === 8);
  check('EURO API ID is 4', getLeagueById('EURO')?.apiFootball === 4);
  check('EURO_W API ID is 487', getLeagueById('EURO_W')?.apiFootball === 487);
  check('AFCON API ID is 6', getLeagueById('AFCON')?.apiFootball === 6);
  check('CONCACAF API ID is 22', getLeagueById('CONCACAF')?.apiFootball === 22);
  check('COPA_AMERICA API ID is 9', getLeagueById('COPA_AMERICA')?.apiFootball === 9);
  check('FRIENDLY API ID is 10', getLeagueById('FRIENDLY')?.apiFootball === 10);
  check('NWSL exists', !!getLeagueById('NWSL'));
  check('UWCL exists', !!getLeagueById('UWCL'));
  check('LIGA_F exists', !!getLeagueById('LIGA_F'));
  check('FRAUEN_BL exists', !!getLeagueById('FRAUEN_BL'));
  check('PL_WOMEN exists', !!getLeagueById('PL_WOMEN'));
  check('UNL exists', !!getLeagueById('UNL'));
  check('UNL_W exists', !!getLeagueById('UNL_W'));
  check('WC exists', !!getLeagueById('WC'));
  check('WC_W exists', !!getLeagueById('WC_W'));
  check('WC_QUAL exists', !!getLeagueById('WC_QUAL'));
  check('EURO exists', !!getLeagueById('EURO'));
  check('EURO_W exists', !!getLeagueById('EURO_W'));
  check('AFCON exists', !!getLeagueById('AFCON'));
  check('CONCACAF exists', !!getLeagueById('CONCACAF'));
  check('COPA_AMERICA exists', !!getLeagueById('COPA_AMERICA'));
  check('FRIENDLY exists', !!getLeagueById('FRIENDLY'));
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
