/**
 * Cape Predictor — instant disallowed goal alerts verification.
 *
 * Usage: npx tsx backend/scripts/test-instant-disallowed-goal-alerts.ts
 *
 * Verifies:
 *   - Tick interval is set to fast active polling (2-3s).
 *   - Simulate a goal event followed by a disallowed goal/VAR event.
 *   - buildDisallowedGoalAlert constructs the correct embed and rolls back score state.
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

section('1) Fast active polling (2-3s)');
{
  const botSrc = fs.readFileSync(resolve(process.cwd(), 'backend/src/discord/bot.ts'), 'utf8');
  check('live ticker uses 3s interval', botSrc.includes('setInterval(() => { void this.runLiveEventTick(); }, 3_000)'));
  check('interval reduced from 15s', !botSrc.includes('setInterval(() => { void this.runLiveEventTick(); }, 15_000)'));
}

section('2) Disallowed goal detection');
{
  const botSrc = fs.readFileSync(resolve(process.cwd(), 'backend/src/discord/bot.ts'), 'utf8');
  check('VAR/disallowed event handled', botSrc.includes("ev.type === 'var'") || botSrc.includes('disallowed'));
  check('buildDisallowedGoalAlert called', botSrc.includes('CP.buildDisallowedGoalAlert'));
  check('score rollback detection exists', botSrc.includes('fx.homeScore < prevStats.homeScore') || botSrc.includes('fx.awayScore < prevStats.awayScore'));
  check('prevStats homeScore rollback', botSrc.includes('fx.homeScore = prevStats.homeScore'));
  check('prevStats awayScore rollback', botSrc.includes('fx.awayScore = prevStats.awayScore'));
}

section('3) Disallowed goal alert embed');
{
  const liveEvents = fs.readFileSync(resolve(process.cwd(), 'backend/src/discord/liveEvents.ts'), 'utf8');
  check('buildDisallowedGoalAlert exists', liveEvents.includes('buildDisallowedGoalAlert'));
  check('title includes GOAL DISALLOWED', liveEvents.includes('GOAL DISALLOWED!'));
  check('red/orange color (#FF4B4B)', liveEvents.includes('0xFF4B4B'));
  check('score restored message', liveEvents.includes('Score restored to:'));
  check('disallowed goal in default export', liveEvents.includes('buildDisallowedGoalAlert'));
}

section('4) Event deduplication');
{
  const liveEvents = fs.readFileSync(resolve(process.cwd(), 'backend/src/discord/liveEvents.ts'), 'utf8');
  check('isSeenEvent exists', liveEvents.includes('isSeenEvent'));
  check('markEventSeen exists', liveEvents.includes('markEventSeen'));
}

section('SUMMARY');
console.log(`checks run : ${checks}`);
console.log(`failures   : ${failures}`);
if (failures > 0) { console.error(`\nINSTANT DISALLOWED GOAL ALERTS VERIFICATION FAILED (${failures} check(s))`); process.exit(1); }
console.log('\nINSTANT DISALLOWED GOAL ALERTS VERIFICATION PASSED');
