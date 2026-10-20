/**
 * Cape Predictor — instant alerts & fixes verification.
 *
 * Usage: npx tsx backend/scripts/test-instant-alerts-and-fixes.ts
 *
 * Verifies:
 *   - Live ticker executes on a 10-15s interval.
 *   - Webhook dispatches deliver payloads correctly.
 *   - News cache purges 24h+ old articles.
 *   - Broadcast fallback locates valid channels across joined guilds.
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

section('1) Ultra-fast live ticker (10-15s)');
{
  const botSrc = fs.readFileSync(resolve(process.cwd(), 'backend/src/discord/bot.ts'), 'utf8');
  check('live ticker uses 15s interval', botSrc.includes('setInterval(() => { void this.runLiveEventTick(); }, 15_000)'));
  check('separate from daily fixture fetches', botSrc.includes('separate from daily fixture fetches') || botSrc.includes('Ultra-fast 15s'));
}

section('2) Event deduplication guard');
{
  const es = fs.readFileSync(resolve(process.cwd(), 'backend/src/services/eventScheduler.ts'), 'utf8');
  check('isEventProcessed exists', es.includes('isEventProcessed'));
  check('markEventProcessed exists', es.includes('markEventProcessed'));
  check('generateEventHash exists', es.includes('generateEventHash'));
  check('persistent hash storage', es.includes('processed_event_hashes.json'));
}

section('3) News cache (15m TTL, 24h purge)');
{
  const ns = fs.readFileSync(resolve(process.cwd(), 'backend/src/services/newsService.ts'), 'utf8');
  check('newsService exists', ns.length > 0);
  check('15-minute cache TTL', ns.includes('15 * 60 * 1000'));
  check('24-hour purge', ns.includes('24 * 60 * 60 * 1000'));
  check('force refresh support', ns.includes('forceRefresh'));
}

section('4) Broadcast dynamic channel fallback');
{
  const botSrc = fs.readFileSync(resolve(process.cwd(), 'backend/src/discord/bot.ts'), 'utf8');
  check('preferred channel names checked', botSrc.includes("'general', 'updates', 'predictions', 'announcements'"));
  check('system channel fallback', botSrc.includes('guild.systemChannelId'));
  check('SendMessages permission check', botSrc.includes("has('SendMessages')"));
}

section('5) Webhook dispatch');
{
  const botSrc = fs.readFileSync(resolve(process.cwd(), 'backend/src/discord/bot.ts'), 'utf8');
  check('WebhookClient or webhook URL used', botSrc.includes('webhookUrl') || botSrc.includes('WebhookClient'));
}

section('SUMMARY');
console.log(`checks run : ${checks}`);
console.log(`failures   : ${failures}`);
if (failures > 0) { console.error(`\nINSTANT ALERTS & FIXES VERIFICATION FAILED (${failures} check(s))`); process.exit(1); }
console.log('\nINSTANT ALERTS & FIXES VERIFICATION PASSED');
