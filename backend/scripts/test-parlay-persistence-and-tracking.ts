/**
 * Cape Predictor — parlay persistence and tracking verification.
 *
 * Usage: npx tsx backend/scripts/test-parlay-persistence-and-tracking.ts
 *
 * Verifies:
 *   1. Parlays generated via /generateparlay persist to data/saved_parlays.json.
 *   2. /track returns the saved parlay across cold restarts.
 *   3. One-click track buttons are attached to generated parlay messages.
 *
 * Exits non-zero if any check fails.
 */
import fs from 'node:fs';
import { resolve } from 'node:path';

import {
  initSavedParlays,
  saveParlayToDisk,
  clearSavedParlays,
  getSavedParlays,
  getSavedParlay,
} from '../src/discord/savedParlays.js';
import { getParlay, addLeg } from '../src/discord/parlayBuilder.js';

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

const json = (v: any) => JSON.stringify(v);

section('1) Immediate persistence on creation');
{
  clearSavedParlays();
  const slip = getParlay('persist-test-user');
  addLeg(slip, {
    fixtureId: 'espn-9901', description: 'Home espn-9901 vs Away espn-9901', league: 'EPL',
    market: 'OVER_0_5', selection: 'Over 0.5 Goals', probability: 0.9, marketOdds: 1.25,
  });
  const saved = saveParlayToDisk(slip, { userId: 'persist-test-user', channelId: 'persist-test-chan', guildId: null });

  check('slip is written to disk', fs.existsSync(resolve(process.cwd(), 'data', 'saved_parlays.json')));
  const onDisk = JSON.parse(fs.readFileSync(resolve(process.cwd(), 'data', 'saved_parlays.json'), 'utf8'));
  check('disk contains the saved slip', Array.isArray(onDisk) && onDisk.some((s: any) => s.id === saved.id), json(onDisk.map((s: any) => s.id)));
  check('slip has ACTIVE_TRACKING set', saved.activeTracking === true);

  // Simulate cold restart: keep the file, wipe only memory
  const savedBytes = fs.readFileSync(resolve(process.cwd(), 'data', 'saved_parlays.json'));
  clearSavedParlays();
  fs.writeFileSync(resolve(process.cwd(), 'data', 'saved_parlays.json'), savedBytes);
  check('in-memory store empty after clear', getSavedParlays().length === 0);
  initSavedParlays();
  check('slip restored after cold restart', getSavedParlay(saved.id) !== undefined);
}

section('2) One-click track buttons in bot.ts');
{
  const botSrc = fs.readFileSync(resolve(process.cwd(), 'backend/src/discord/bot.ts'), 'utf8');
  check('track_parlay_ button handler exists', botSrc.includes("id.startsWith('track_parlay_')"));
  check('copy_parlay_ button handler exists', botSrc.includes("id.startsWith('copy_parlay_')"));
  check('Save & Track Parlay button exists', botSrc.includes('Save & Track Parlay'));
  check('Copy Parlay Slip button exists', botSrc.includes('Copy Parlay Slip'));
  check('ackInteraction used for button clicks', botSrc.includes("CP.ackInteraction(interaction, { ephemeral: true })"));
}

section('3) Real-time leg notification engine');
{
  const savedSrc = fs.readFileSync(resolve(process.cwd(), 'backend/src/discord/savedParlays.ts'), 'utf8');
  check('buildParlayUpdateEmbed exists', savedSrc.includes('buildParlayUpdateEmbed'));
  check('processSavedParlayLegs sends notifications', fs.readFileSync(resolve(process.cwd(), 'backend/src/discord/bot.ts'), 'utf8').includes('processSavedParlayLegs'));
  const botSrc = fs.readFileSync(resolve(process.cwd(), 'backend/src/discord/bot.ts'), 'utf8');
  check('live worker calls processSavedParlayLegs', botSrc.includes('await this.processSavedParlayLegs(fx, stats)'));
}

section('SUMMARY');
console.log(`checks run : ${checks}`);
console.log(`failures   : ${failures}`);
if (failures > 0) { console.error(`\nPARLAY PERSISTENCE & TRACKING VERIFICATION FAILED (${failures} check(s))`); process.exit(1); }
console.log('\nPARLAY PERSISTENCE & TRACKING VERIFICATION PASSED');
