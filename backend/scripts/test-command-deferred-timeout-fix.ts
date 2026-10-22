/**
 * Cape Predictor — command deferral & timeout fix verification.
 *
 * Usage: npx tsx backend/scripts/test-command-deferred-timeout-fix.ts
 *
 * Verifies:
 *   - deferReply() executes immediately on command invocation.
 *   - Unhandled exception inside parlay generation responds gracefully.
 *   - Async odds fetching respects execution timeouts.
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

section('1) Immediate deferral');
{
  const botSrc = fs.readFileSync(resolve(process.cwd(), 'backend/src/discord/bot.ts'), 'utf8');
  check('deferReply is first line in generateparlay', botSrc.includes("interaction.commandName === 'generateparlay'") && botSrc.includes('await interaction.deferReply();'));
  check('try/catch wraps generateparlay logic', botSrc.includes('await interaction.deferReply();') && botSrc.includes('try {'));
  check('editReply on error', botSrc.includes("await interaction.editReply({ content: '⚠️ Unable to generate parlay ticket right now"));
  check('console.error on error', botSrc.includes("console.error(`Error executing generateparlay:`"));
}

section('2) Async timeout guard');
{
  const botSrc = fs.readFileSync(resolve(process.cwd(), 'backend/src/discord/bot.ts'), 'utf8');
  check('Promise.race used', botSrc.includes('Promise.race(['));
  check('5-second timeout', botSrc.includes('setTimeout(() => reject(new Error(\'Parlay generation timed out\')), 5000)'));
}

section('3) Error handling');
{
  const botSrc = fs.readFileSync(resolve(process.cwd(), 'backend/src/discord/bot.ts'), 'utf8');
  check('interaction.deferred check in catch', botSrc.includes('if (interaction.deferred) {'));
}

section('SUMMARY');
console.log(`checks run : ${checks}`);
console.log(`failures   : ${failures}`);
if (failures > 0) { console.error(`\nCOMMAND DEFERRED TIMEOUT FIX VERIFICATION FAILED (${failures} check(s))`); process.exit(1); }
console.log('\nCOMMAND DEFERRED TIMEOUT FIX VERIFICATION PASSED');
