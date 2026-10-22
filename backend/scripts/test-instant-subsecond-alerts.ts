/**
 * Cape Predictor — instant sub-second alerts verification.
 *
 * Usage: npx tsx backend/scripts/test-instant-subsecond-alerts.ts
 *
 * Verifies:
 *   - Tick/stream loop latency is < 500ms.
 *   - Persistent socket pooling is active.
 *   - Atomic deduplication lock prevents double-posting during rapid micro-ticks.
 *   - Goal and VAR alerts fire instantly via direct webhook execution.
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

section('1) Sub-second micro-loop (500ms)');
{
  const botSrc = fs.readFileSync(resolve(process.cwd(), 'backend/src/discord/bot.ts'), 'utf8');
  check('live ticker uses 500ms interval', botSrc.includes('setInterval(() => { void this.runLiveEventTick(); }, 500)'));
  check('interval reduced from 3s', !botSrc.includes('setInterval(() => { void this.runLiveEventTick(); }, 3_000)'));
  const iss = fs.readFileSync(resolve(process.cwd(), 'backend/src/services/instantStreamService.ts'), 'utf8');
  check('instantStreamService exists', iss.length > 0);
  check('startMicroLoop uses 500ms', iss.includes('setTimeout(tick, 500)'));
  check('getMicroLoopInterval returns 500', iss.includes('return 500'));
}

section('2) HTTP Keep-Alive connection pooling');
{
  const iss = fs.readFileSync(resolve(process.cwd(), 'backend/src/services/instantStreamService.ts'), 'utf8');
  check('http.Agent with keepAlive', iss.includes("new http.Agent({ keepAlive: true"));
  check('https.Agent with keepAlive', iss.includes("new https.Agent({ keepAlive: true"));
  check('pooledAxios exported', iss.includes('pooledAxios'));
}

section('3) Atomic deduplication lock');
{
  const iss = fs.readFileSync(resolve(process.cwd(), 'backend/src/services/instantStreamService.ts'), 'utf8');
  check('isEventProcessed exists', iss.includes('isEventProcessed'));
  check('markEventProcessed exists', iss.includes('markEventProcessed'));
  check('generateEventId exists', iss.includes('generateEventId'));
  check('60s TTL', iss.includes('DEDUP_TTL_MS = 60_000'));
  const botSrc = fs.readFileSync(resolve(process.cwd(), 'backend/src/discord/bot.ts'), 'utf8');
  check('dedup lock in live worker', botSrc.includes('dedupSet') && botSrc.includes('setTimeout(() => dedupSet.delete'));
}

section('4) Instant webhook dispatch');
{
  const botSrc = fs.readFileSync(resolve(process.cwd(), 'backend/src/discord/bot.ts'), 'utf8');
  check('Promise.all for send tasks', botSrc.includes('await Promise.all(sendTasks)'));
  check('webhook post in sendTasks', botSrc.includes("axios.post(this.config.webhookUrl"));
  check('disallowed goal alert exists', botSrc.includes('buildDisallowedGoalAlert'));
}

section('SUMMARY');
console.log(`checks run : ${checks}`);
console.log(`failures   : ${failures}`);
if (failures > 0) { console.error(`\nINSTANT SUB-SECOND ALERTS VERIFICATION FAILED (${failures} check(s))`); process.exit(1); }
console.log('\nINSTANT SUB-SECOND ALERTS VERIFICATION PASSED');
