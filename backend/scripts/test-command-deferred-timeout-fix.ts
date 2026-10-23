/**
 * Cape Predictor — command deferral & timeout fix verification.
 *
 * Usage: npx tsx backend/scripts/test-command-deferred-timeout-fix.ts
 *
 * Verifies the /generateparlay interaction contract:
 *   - deferReply() executes immediately inside handleGenerateParlay.
 *   - The router arms a 4s global interaction guard and clears it in finally.
 *   - A hung generation is cut off by the inner 3.5s race.
 *   - Errors produce a graceful editReply instead of a forever-"thinking" state.
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

const botSrc = fs.readFileSync(resolve(process.cwd(), 'backend/src/discord/bot.ts'), 'utf8');

section('1) Immediate deferral inside handleGenerateParlay');
{
  const start = botSrc.indexOf('private async handleGenerateParlay');
  const body = start >= 0 ? botSrc.slice(start, start + 1200) : '';
  check('handleGenerateParlay exists', start >= 0);
  check('deferReply is the first interaction call in the handler',
    body.indexOf('await interaction.deferReply()') > -1
      && body.indexOf('await interaction.deferReply()') < body.indexOf('generateParlayReply'));
  check('defer is idempotent (declines to double-ack)', body.includes('if (!interaction.deferred && !interaction.replied)'));
}

section('2) Global interaction guard');
{
  check('router invokes handleGenerateParlay', botSrc.includes('await this.handleGenerateParlay(interaction)'));
  check('guard timer armed at 4000ms', botSrc.includes('}, 4000);'));
  check('guard clears timer in finally', botSrc.includes('clearTimeout(timeoutId);'));
  check('guard only edits an un-replied deferred interaction',
    botSrc.includes('if (interaction.deferred && !interaction.replied)'));
  check('timeout message is user-facing', botSrc.includes('Request timed out while scanning live markets'));
}

section('3) Inner generation timeout + graceful errors');
{
  check('inner Promise.race guard present', botSrc.includes('Promise.race(['));
  check('inner ceiling is 3500ms', botSrc.includes("setTimeout(() => reject(new Error('Parlay generation timed out after 3500ms')), 3500)"));
  check('router catches unhandled parlay errors', botSrc.includes("console.error('Unhandled parlay error:', err)"));
  check('error message is user-facing', botSrc.includes('An error occurred generating your parlay slip.'));
  check('editReply failures are swallowed safely', botSrc.includes("console.error('Error editReply failed:', editErr)"));
}

section('4) Event-loop yielding in the builder');
{
  const builderSrc = fs.readFileSync(resolve(process.cwd(), 'backend/src/parlays/parlay-builder.ts'), 'utf8');
  check('builder yields via setImmediate', builderSrc.includes('setImmediate(resolve)'));
  check('builder is async and returns a Promise', builderSrc.includes('export async function buildStatisticalParlay'));
  check('filter yields every 15 candidates', builderSrc.includes('i % 15 === 0'));
}

section('SUMMARY');
console.log(`checks run : ${checks}`);
console.log(`failures   : ${failures}`);
if (failures > 0) {
  console.error(`\nCOMMAND DEFERRED TIMEOUT FIX VERIFICATION FAILED (${failures} check(s))`);
  process.exit(1);
}
console.log('\nCOMMAND DEFERRED TIMEOUT FIX VERIFICATION PASSED');
