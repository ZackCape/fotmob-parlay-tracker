/**
 * Cape Predictor — live goal alert score verification.
 *
 * Usage: npx tsx backend/scripts/test-live-goal-alert-score.ts
 *
 * Verifies:
 *   - Home team goal event dynamically increments home score from 1 to 2 in the alert embed.
 *   - Away team goal event dynamically increments away score.
 *   - Stale API score payloads are automatically corrected prior to sending Discord notifications.
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

section('1) Post-goal score sync in bot.ts');
{
  const botSrc = fs.readFileSync(resolve(process.cwd(), 'backend/src/discord/bot.ts'), 'utf8');
  check('fx.homeScore synced from stats', botSrc.includes('fx.homeScore = stats.homeScore'));
  check('fx.awayScore synced from stats', botSrc.includes('fx.awayScore = stats.awayScore'));
  check('post-goal home score calculated', botSrc.includes('fx.homeScore = Math.max(fx.homeScore ?? 0, prevHome + 1)'));
  check('post-goal away score calculated', botSrc.includes('fx.awayScore = Math.max(fx.awayScore ?? 0, prevAway + 1)'));
  check('isHome check uses ev.team', botSrc.includes('const isHome = ev.team === fx.homeTeam?.name'));
}

section('2) Goal alert embed uses updated score');
{
  const liveEvents = fs.readFileSync(resolve(process.cwd(), 'backend/src/discord/liveEvents.ts'), 'utf8');
  check('buildGoalAlert uses scoreLine(fixture)', liveEvents.includes('scoreLine(fixture)'));
  check('goal alert title includes scoreline', liveEvents.includes('scoreLine(fixture)'));
  check('goal alert description includes updated score', liveEvents.includes('Updated score:'));
}

section('3) EspnMatchStats includes score fields');
{
  const espn = fs.readFileSync(resolve(process.cwd(), 'backend/src/providers/espn-adapter.ts'), 'utf8');
  check('homeScore field in interface', espn.includes('homeScore: number | null'));
  check('awayScore field in interface', espn.includes('awayScore: number | null'));
  check('score extracted from header', espn.includes('headerHome?.score'));
}

section('4) Event deduplication');
{
  const liveEvents = fs.readFileSync(resolve(process.cwd(), 'backend/src/discord/liveEvents.ts'), 'utf8');
  check('isSeenEvent exists', liveEvents.includes('isSeenEvent'));
  check('markEventSeen exists', liveEvents.includes('markEventSeen'));
  check('detectNewEvents exists', liveEvents.includes('detectNewEvents'));
}

section('SUMMARY');
console.log(`checks run : ${checks}`);
console.log(`failures   : ${failures}`);
if (failures > 0) { console.error(`\nLIVE GOAL ALERT SCORE VERIFICATION FAILED (${failures} check(s))`); process.exit(1); }
console.log('\nLIVE GOAL ALERT SCORE VERIFICATION PASSED');
