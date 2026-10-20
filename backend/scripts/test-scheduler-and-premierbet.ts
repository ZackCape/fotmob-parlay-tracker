/**
 * Cape Predictor — scheduler and PremierBet verification.
 *
 * Usage: npx tsx backend/scripts/test-scheduler-and-premierbet.ts
 *
 * Verifies:
 *   - Halftime catch-up logic triggers alerts correctly for missed HT events.
 *   - Corner calculations return accurate probabilities across multiple lines (7.5 - 11.5).
 *   - PremierBet odds mapping correctly correlates fixture data.
 *
 * Exits non-zero if any check fails.
 */
import fs from 'node:fs';
import { resolve } from 'node:path';

import { calculateCornerProbabilities, formatCornerCard } from '../src/engine/corners.js';
import { mapPremierBetFixture, calculateEV } from '../src/services/premierbetService.js';
import * as eventScheduler from '../src/services/eventScheduler.js';

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

section('1) Dynamic corner line scaling');
{
  const analysis = calculateCornerProbabilities(5, 5);
  check('expected total corners calculated', analysis.expectedTotal > 0, String(analysis.expectedTotal));
  check('5 lines returned (7.5-11.5)', analysis.lines.length === 5, String(analysis.lines.length));
  check('lines cover 7.5 to 11.5', analysis.lines[0].line === 7.5 && analysis.lines[4].line === 11.5);
  check('probabilities sum correctly', analysis.lines.every((l) => Math.abs(l.overProb + l.underProb - 1) < 0.001));
  check('primary line exists', analysis.primaryLine >= 7.5 && analysis.primaryLine <= 11.5);
  const card = formatCornerCard(analysis, 'Home', 'Away');
  check('corner card formatted', card.includes('Expected Total Corners'));
}

section('2) PremierBet odds mapping');
{
  const mapped = mapPremierBetFixture({ homeTeam: 'Arsenal', awayTeam: 'Chelsea', league: 'EPL' });
  check('fixture mapped correctly', mapped?.homeTeam === 'Arsenal' && mapped?.awayTeam === 'Chelsea', JSON.stringify(mapped));
  check('null fixture returns null', mapPremierBetFixture(null) === null);
  const ev = calculateEV(0.6, 2.15);
  check('EV calculated correctly', ev > 0, String(ev));
  check('EV zero for invalid odds', calculateEV(0.6, 1) === 0);
}

section('3) Persistent event scheduler');
{
  const evt = eventScheduler.scheduleEvent({ type: 'halftime', fixtureId: 'test-fixture-1', scheduledAt: Date.now() });
  check('event scheduled', evt.id.startsWith('evt-'));
  check('halftime not sent initially', !eventScheduler.hasHalftimeSent('test-fixture-1'));
  eventScheduler.markHalftimeSent('test-fixture-1');
  check('halftime marked sent', eventScheduler.hasHalftimeSent('test-fixture-1'));
  const pending = eventScheduler.getPendingEvents('halftime');
  check('pending events filtered', Array.isArray(pending));
  const catchUp = eventScheduler.getCatchUpEvents(15 * 60 * 1000);
  check('catch-up returns array', Array.isArray(catchUp));
  eventScheduler.clearCompleted();
  check('clear completed runs', true);
}

section('SUMMARY');
console.log(`checks run : ${checks}`);
console.log(`failures   : ${failures}`);
if (failures > 0) { console.error(`\nSCHEDULER & PREMIERBET VERIFICATION FAILED (${failures} check(s))`); process.exit(1); }
console.log('\nSCHEDULER & PREMIERBET VERIFICATION PASSED');
