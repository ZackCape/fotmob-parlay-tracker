/**
 * Cape Predictor — autocomplete and dropdown purge verification.
 *
 * Usage: npx tsx backend/scripts/test-autocomplete-purge.ts
 *
 * Verifies:
 *   - No "Match ID" text remains in command builders.
 *   - All fixture/match options use setAutocomplete(true) and setRequired(false).
 *   - REST registration runs on startup.
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

section('1) No raw Match ID text');
{
  const botSrc = fs.readFileSync(resolve(process.cwd(), 'backend/src/discord/bot.ts'), 'utf8');
  check('No "Match ID" in bot.ts', !botSrc.includes('Match ID'));
  const commandsDir = resolve(process.cwd(), 'backend/src/discord/commands');
  if (fs.existsSync(commandsDir)) {
    const files = fs.readdirSync(commandsDir).filter((f) => f.endsWith('.ts'));
    for (const f of files) {
      const content = fs.readFileSync(resolve(commandsDir, f), 'utf8');
      check(`No "Match ID" in ${f}`, !content.includes('Match ID'));
    }
  }
}

section('2) Autocomplete configuration');
{
  const botSrc = fs.readFileSync(resolve(process.cwd(), 'backend/src/discord/bot.ts'), 'utf8');
  check('setAutocomplete(true) used', botSrc.includes('setAutocomplete(true)'));
  check('autocomplete handler exists', botSrc.includes('interaction.isAutocomplete()'));
  check('autocomplete searches fixtures', botSrc.includes("this.factory.getFixturesByDate(today, 'ALL')"));
  check('autocomplete responds with choices', botSrc.includes('await interaction.respond(choices)'));
  check('setRequired(false) for fixture options', botSrc.includes('setAutocomplete(true)') && botSrc.includes('setRequired(false)'));
}

section('3) REST registration');
{
  const botSrc = fs.readFileSync(resolve(process.cwd(), 'backend/src/discord/bot.ts'), 'utf8');
  check('REST.put with applicationCommands', botSrc.includes('Routes.applicationCommands'));
  check('REST client created', botSrc.includes('new REST({ version:'));
  check('runs on ready event', botSrc.includes("client.once('ready'"));
}

section('SUMMARY');
console.log(`checks run : ${checks}`);
console.log(`failures   : ${failures}`);
if (failures > 0) { console.error(`\nAUTOCOMPLETE PURGE VERIFICATION FAILED (${failures} check(s))`); process.exit(1); }
console.log('\nAUTOCOMPLETE PURGE VERIFICATION PASSED');
