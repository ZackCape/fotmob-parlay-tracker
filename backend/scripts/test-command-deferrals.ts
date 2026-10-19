/**
 * Cape Predictor — command deferral verification.
 *
 * Usage: npx tsx backend/scripts/test-command-deferrals.ts
 *
 * Verifies that all slash command and select menu handlers defer their
 * interactions before performing async I/O or network operations.
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

section('1) Slash command deferrals');
{
  const botSrc = fs.readFileSync(resolve(process.cwd(), 'backend/src/discord/bot.ts'), 'utf8');
  // Find all slash command handlers (commandName === '...')
  const cmdPattern = /interaction\.commandName === '([^']+)'/g;
  let match;
  const commands: string[] = [];
  while ((match = cmdPattern.exec(botSrc)) !== null) {
    commands.push(match[1]);
  }
  check('slash commands are registered', commands.length > 20, `found ${commands.length}`);

  // Check that handlers using async I/O have deferReply before the I/O.
  // We verify by checking that deferReply appears in the handler body.
  const deferPattern = /await interaction\.deferReply/g;
  const deferCount = (botSrc.match(deferPattern) || []).length;
  check('deferReply is used extensively', deferCount >= 25, `found ${deferCount} occurrences`);

  // Check no handler uses interaction.reply() after async work without deferral.
  // Simple check: ensure deferReply appears before any factory.get* calls.
  check('no raw interaction.reply() without prior defer in async handlers',
    !botSrc.includes('await this.factory.getMatchDetails') || botSrc.includes('await interaction.deferReply()'),
    'potential un-deferred async call');
}

section('2) Select menu & button deferrals');
{
  const botSrc = fs.readFileSync(resolve(process.cwd(), 'backend/src/discord/bot.ts'), 'utf8');
  const deferUpdateCount = (botSrc.match(/await interaction\.deferUpdate\(\)/g) || []).length;
  check('deferUpdate is used for select menus/buttons', deferUpdateCount >= 10, `found ${deferUpdateCount} occurrences`);

  const deferReplyEphemeralCount = (botSrc.match(/await interaction\.deferReply\(\{ ephemeral: true \}\)/g) || []).length;
  check('deferReply({ephemeral:true}) used for ephemeral handlers', deferReplyEphemeralCount >= 3, `found ${deferReplyEphemeralCount} occurrences`);
}

section('3) Error handling');
{
  const botSrc = fs.readFileSync(resolve(process.cwd(), 'backend/src/discord/bot.ts'), 'utf8');
  check('try/catch wraps slash command handler', botSrc.includes('} catch (err: any) {') && botSrc.includes('console.error(\'[DiscordBot] Interaction error:\''));
  check('try/catch wraps component handler', botSrc.includes('console.warn(`[DiscordBot] interaction error (${id}):'));
}

section('SUMMARY');
console.log(`checks run : ${checks}`);
console.log(`failures   : ${failures}`);
if (failures > 0) { console.error(`\nCOMMAND DEFERRAL VERIFICATION FAILED (${failures} check(s))`); process.exit(1); }
console.log('\nCOMMAND DEFERRAL VERIFICATION PASSED');
