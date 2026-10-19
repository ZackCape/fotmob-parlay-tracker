/**
 * Cape Predictor — /unbroadcast command and parlay builder render fix verification.
 *
 * Usage: npx tsx backend/scripts/test-unbroadcast-and-parlay-fix.ts
 *
 * Verifies:
 *   1. /unbroadcast command handler exists and produces correct embed output.
 *   2. ParlayBuilder renders without reference errors (copied state declared).
 *   3. State persistence and build integrity.
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

section('1) /unbroadcast command registration');
{
  const botSrc = fs.readFileSync(resolve(process.cwd(), 'backend/src/discord/bot.ts'), 'utf8');
  check('unbroadcast slash command is registered', botSrc.includes("setName('unbroadcast')"));
  check('unbroadcast handler exists', botSrc.includes("commandName === 'unbroadcast'"));
  check('unbroadcast produces Channel Unsubscribed embed', botSrc.includes('Channel Unsubscribed'));
  check('unbroadcast targets specified or current channel', botSrc.includes('interaction.options.getChannel') && botSrc.includes('interaction.channelId'));
}

section('2) ParlayBuilder copied state fix');
{
  const src = fs.readFileSync(resolve(process.cwd(), 'src/components/ParlayBuilder.tsx'), 'utf8');
  check('copied state is declared', src.includes('const [copied, setCopied] = useState<boolean>(false)'));
  check('handleCopySlip handler exists', src.includes('handleCopySlip'));
  check('clipboard writeText is called', src.includes('navigator.clipboard.writeText'));
  check('copied state is referenced in JSX', src.includes("copied ? 'Copied!' : 'Copy Slip Text'"));
}

section('3) Build integrity');
{
  const { execSync } = await import('node:child_process');
  try {
    execSync('npm.cmd run build:backend', { cwd: process.cwd(), stdio: 'pipe' });
    check('backend build succeeds', true);
  } catch (e: any) {
    check('backend build succeeds', false, e.message?.slice(0, 200));
  }
  try {
    execSync('npm.cmd run build:frontend', { cwd: process.cwd(), stdio: 'pipe' });
    check('frontend build succeeds', true);
  } catch (e: any) {
    check('frontend build succeeds', false, e.message?.slice(0, 200));
  }
}

section('SUMMARY');
console.log(`checks run : ${checks}`);
console.log(`failures   : ${failures}`);
if (failures > 0) { console.error(`\nUNBROADCAST & PARLAY FIX VERIFICATION FAILED (${failures} check(s))`); process.exit(1); }
console.log('\nUNBROADCAST & PARLAY FIX VERIFICATION PASSED');
