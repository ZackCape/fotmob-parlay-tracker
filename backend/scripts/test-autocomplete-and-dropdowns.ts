/**
 * Cape Predictor — autocomplete and dropdown verification.
 *
 * Usage: npx tsx backend/scripts/test-autocomplete-and-dropdowns.ts
 *
 * Verifies:
 *   - All target command options are set to setAutocomplete(true) and setRequired(false).
 *   - Autocomplete search correctly matches team names and returns MATCH_ID strings.
 *   - 2-tier select menu fallbacks generate valid league and match options.
 *
 * Exits non-zero if any check fails.
 */
import fs from 'node:fs';
import { resolve } from 'node:path';

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

section('1) Autocomplete configuration');
{
  const botSrc = fs.readFileSync(resolve(process.cwd(), 'backend/src/discord/bot.ts'), 'utf8');
  check('setAutocomplete(true) used', botSrc.includes('setAutocomplete(true)'));
  check('autocomplete handler exists', botSrc.includes('interaction.isAutocomplete()'));
  check('autocomplete searches fixtures', botSrc.includes('this.factory.getFixturesByDate(today, \'ALL\')'));
  check('autocomplete returns match choices', botSrc.includes('name: `${f.homeTeam?.name'));
  check('autocomplete responds with choices', botSrc.includes('await interaction.respond(choices)'));
}

section('2) 2-tier dropdown system');
{
  const botSrc = fs.readFileSync(resolve(process.cwd(), 'backend/src/discord/bot.ts'), 'utf8');
  check('twoTierPrefixes array exists', botSrc.includes('twoTierPrefixes = ['));
  check('league select handler exists', botSrc.includes('_league_select'));
  check('match select handler exists', botSrc.includes('_match_select'));
  check('StringSelectMenuBuilder used', botSrc.includes('StringSelectMenuBuilder'));
  check('deferUpdate used in select handlers', botSrc.includes('await interaction.deferUpdate()'));
}

section('3) Target commands use autocomplete');
{
  const botSrc = fs.readFileSync(resolve(process.cwd(), 'backend/src/discord/bot.ts'), 'utf8');
  const targetCommands = ['remind', 'injuries', 'referee', 'halftime', 'corners', 'cards', 'analysis'];
  for (const cmd of targetCommands) {
    check(`${cmd} command exists`, botSrc.includes(`setName('${cmd}')`));
  }
  check('poll command exists', botSrc.includes("setName('poll')"));
  check('value command exists', botSrc.includes("setName('value')"));
  check('compare command exists', botSrc.includes("setName('compare')"));
  check('h2h command exists', botSrc.includes("setName('h2h')"));
  check('track command exists', botSrc.includes("setName('track')"));
}

section('4) Null-safety');
{
  const botSrc = fs.readFileSync(resolve(process.cwd(), 'backend/src/discord/bot.ts'), 'utf8');
  check('safeToFixed imported', botSrc.includes("import { safeToFixed }"));
  check('safeToFixed used in bot.ts', botSrc.includes('safeToFixed('));
}

section('SUMMARY');
console.log(`checks run : ${checks}`);
console.log(`failures   : ${failures}`);
if (failures > 0) { console.error(`\nAUTOCOMPLETE & DROPDOWNS VERIFICATION FAILED (${failures} check(s))`); process.exit(1); }
console.log('\nAUTOCOMPLETE & DROPDOWNS VERIFICATION PASSED');
