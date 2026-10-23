/**
 * Cape Predictor — atomic live-alert dedup verification.
 *
 * Usage: npx tsx backend/scripts/test-atomic-dedup-locks.ts
 *
 * Reproduces the "1 goal = 3 alerts" bug conditions:
 *   - 5 concurrent sub-second micro-ticks for the SAME goal payload
 *   - webhook + bot-channel dispatch racing for the same event
 *
 * Asserts:
 *   1. claimLiveEvent() is a synchronous check-and-set: 5 calls -> 1 winner.
 *   2. Five simultaneous ticks emit EXACTLY 1 alert (webhook path).
 *   3. Webhook and channel transports are mutually exclusive per event.
 *   4. Five simultaneous dispatch calls emit EXACTLY 1 webhook POST.
 *   5. The channel-only path emits EXACTLY 1 channel message.
 *
 * Exits non-zero if any check fails.
 */
import fs from 'node:fs';
import http from 'node:http';
import { DiscordBotService } from '../src/discord/bot.js';
import * as CP from '../src/discord/interactions.js';

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

const GOAL_TEAM = 'AS Monaco';

function makeFixture(id: string) {
  return {
    id,
    league: 'LIGUE1',
    status: 'LIVE',
    homeTeam: { name: GOAL_TEAM },
    awayTeam: { name: 'SC Freiburg' },
    homeScore: 1,
    awayScore: 0,
    liveClock: `62'`,
  } as any;
}

function makeStats(goalId: string | null) {
  return {
    eventId: 'stub',
    homeScore: goalId ? 1 : 0,
    awayScore: 0,
    statistics: null,
    lineups: { home: null, away: null },
    form: { home: [], away: [] },
    recentGoals: { home: [], away: [] },
    events: goalId
      ? [{
          id: goalId,
          type: 'goal',
          scoring: true,
          minute: 62,
          team: GOAL_TEAM,
          player: 'Wissam Ben Yedder',
          assist: null,
          text: 'Goal',
        }]
      : [],
  } as any;
}

function makeBot(webhookUrl?: string) {
  const sends: any[] = [];
  const bot = new DiscordBotService(
    { botToken: 'test', channelId: 'chan-1', guildId: 'guild-1', updateInterval: '1h', webhookUrl } as any,
    {} as any,
  );
  (bot as any).client = {
    isReady: () => true,
    channels: {
      fetch: async () => ({
        isTextBased: () => true,
        send: async (payload: any) => { sends.push(payload); return {}; },
        setTopic: async () => {},
      }),
    },
    users: { fetch: async () => ({ send: async () => {} }) },
  };
  return { bot, sends };
}

/** Factory that returns a fixture + mutable stats so a goal can appear. */
function makeFactory(fixture: any, getStats: () => any) {
  return {
    getFixturesByDate: async () => [fixture],
    getEspnMatchStats: async () => getStats(),
    getMatchDetails: async () => null,
  } as any;
}

async function main() {
  section('1) claimLiveEvent is an atomic synchronous check-and-set');
  {
    const fx = makeFixture('espn-dedup-atomic');
    const { bot } = makeBot();
    const ev = { id: 'atomic-goal-1', type: 'goal', scoring: true, minute: 62, team: GOAL_TEAM };

    // Five "simultaneous" calls in the same synchronous turn.
    const results = Array.from({ length: 5 }, () =>
      (bot as any).claimLiveEvent(fx.id, ev, 1, 0),
    );
    const winners = results.filter((r) => r !== null);

    console.log(`  info: winners=${JSON.stringify(winners)}`);
    check('exactly one caller wins the event', winners.length === 1, String(winners.length));
    check('winner id uses the GOAL canonical format', winners[0] === 'ESPNDEDUPATOMIC_GOAL_ASMONACO_62', String(winners[0]));
  }

  section('2) Five simultaneous micro-ticks -> exactly 1 webhook alert');
  {
    let webhookHits = 0;
    const server = http.createServer((_req, res) => {
      webhookHits++;
      res.statusCode = 204;
      res.end();
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const port = (server.address() as any).port;
    const webhookUrl = `http://127.0.0.1:${port}/hook`;

    const fx = makeFixture('espn-dedup-ticks');
    let goalId: string | null = null;
    const { bot, sends } = makeBot(webhookUrl);
    (bot as any).factory = makeFactory(fx, () => makeStats(goalId));
    // Register one subscriber for this fixture.
    CP.subscribeLive('user-1', 'chan-1', fx.id);

    // Prime the first poll (history is seeded, not alerted).
    await (bot as any).runLiveEventTick();
    check('priming tick sends nothing', webhookHits === 0 && sends.length === 0, `webhook=${webhookHits} channel=${sends.length}`);

    // Now the same goal appears. Fire 5 concurrent ticks.
    goalId = `evt-${Date.now()}-dedup`;
    await Promise.all(Array.from({ length: 5 }, () => (bot as any).runLiveEventTick()));

    console.log(`  info: webhookHits=${webhookHits} channelSends=${sends.length}`);
    check('EXACTLY one alert delivered', webhookHits === 1, String(webhookHits));
    check('channel transport did not also fire', sends.length === 0, String(sends.length));

    // A later tick for the same event must stay silent (60s lock).
    await (bot as any).runLiveEventTick();
    check('repeat tick is silent', webhookHits === 1, String(webhookHits));

    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  section('3) Webhook and channel transports are mutually exclusive');
  {
    const botSource = await import('node:fs').then((fs) =>
      fs.readFileSync('backend/src/discord/bot.ts', 'utf8'),
    );
    const start = botSource.indexOf('private async dispatchLiveAlert(');
    const body = start >= 0 ? botSource.slice(start, start + 2200) : '';
    check('dispatch claims a lock before I/O', body.indexOf('claimLiveDispatch') > -1);
    check('webhook path returns without channel send', /axios\.post\([\s\S]*?return;/.test(body));
    check('no Promise.all(webhook + channel) double-send remains',
      !botSource.includes('sendTasks.push('));
  }

  section('4) Five simultaneous dispatch calls -> exactly 1 webhook POST');
  {
    let webhookHits = 0;
    const server = http.createServer((_req, res) => {
      webhookHits++;
      res.statusCode = 204;
      res.end();
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const port = (server.address() as any).port;
    const { bot, sends } = makeBot(`http://127.0.0.1:${port}/hook`);

    const subs = [{ userId: 'user-1', channelId: 'chan-1' }];
    const embed = { title: 'GOAL!' };
    const eventId = `DISPATCH_TEST_${Date.now()}`;

    await Promise.all(Array.from({ length: 5 }, () =>
      (bot as any).dispatchLiveAlert(eventId, subs, embed, '<@user-1>'),
    ));

    check('EXACTLY one webhook POST', webhookHits === 1, String(webhookHits));
    check('no channel fallback on webhook success', sends.length === 0, String(sends.length));

    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  section('5) Channel-only path -> exactly 1 message (no webhook)');
  {
    const fx = makeFixture('espn-dedup-channel');
    let goalId: string | null = null;
    const { bot, sends } = makeBot(undefined);
    (bot as any).factory = makeFactory(fx, () => makeStats(goalId));
    CP.subscribeLive('user-2', 'chan-2', fx.id);

    await (bot as any).runLiveEventTick();
    goalId = `evt-${Date.now()}-channel`;
    await Promise.all(Array.from({ length: 5 }, () => (bot as any).runLiveEventTick()));

    console.log(`  info: channelSends=${sends.length}`);
    check('EXACTLY one channel alert', sends.length === 1, String(sends.length));
    check('channel alert pings the subscriber', String(sends[0]?.content ?? '').includes('<@user-2>'));
  }

  section('SUMMARY');
  console.log(`checks run : ${checks}`);
  console.log(`failures   : ${failures}`);
  if (failures > 0) {
    console.error(`\nATOMIC DEDUP LOCK VERIFICATION FAILED (${failures} check(s))`);
    process.exitCode = 1;
    return;
  }
  console.log('\nATOMIC DEDUP LOCK VERIFICATION PASSED');
}

function cleanupSubscriptions() {
  // subscribeLive() persists to data/user_live_subscriptions.json; remove the
  // synthetic test fixtures so a verification run never pollutes real tracking.
  for (const [userId, fixtureId] of [
    ['user-1', 'espn-dedup-ticks'],
    ['user-2', 'espn-dedup-channel'],
  ] as const) {
    try { CP.unsubscribeLive(userId, fixtureId); } catch { /* best effort */ }
  }

  // markEventSeen() persists to data/seen_live_events.json; strip only the
  // synthetic ids this script generated.
  try {
    const path = 'data/seen_live_events.json';
    if (fs.existsSync(path)) {
      const ids: string[] = JSON.parse(fs.readFileSync(path, 'utf8'));
      const synthetic = ids.filter((id) => /^evt-\d+-(dedup|channel)$/.test(id));
      for (const id of synthetic) CP.unmarkEventSeen(id);
      if (synthetic.length) {
        const kept = ids.filter((id) => !synthetic.includes(id));
        fs.writeFileSync(path, JSON.stringify(kept, null, 2));
      }
    }
  } catch { /* best effort */ }

  // Exit explicitly: module-level 60s persistence intervals would otherwise
  // keep the process alive and rewrite the seen-event file after cleanup.
  process.exit(process.exitCode || 0);
}

main()
  .catch((err) => {
    console.error('Fatal:', err);
    process.exitCode = 1;
  })
  .finally(cleanupSubscriptions);
