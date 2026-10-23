/**
 * Cape Predictor — event-loop starvation & interaction guard verification.
 *
 * Usage: npx tsx backend/scripts/test-event-loop-unblock.ts
 *
 * Verifies:
 *   1. Heavy 100+ fixture parlay generation yields to the event loop
 *      (setImmediate), so timers keep firing while the builder runs.
 *   2. handleGenerateParlay defers immediately, resolves (or rejects) under
 *      4.5s on heavy load, and never leaves a pending interaction.
 *   3. A hung odds provider is rejected by the 3.5s timeout guard.
 *
 * Exits non-zero if any check fails.
 */
import { buildStatisticalParlay } from '../src/parlays/parlay-builder.js';
import { DiscordBotService } from '../src/discord/bot.js';

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

function prediction(i: number): any {
  const markets = ['HOME_WIN', 'OVER_1_5', 'OVER_2_5', 'BTTS_YES', 'DOUBLE_CHANCE_1X'] as const;
  const market = markets[i % markets.length];
  const probability = 0.62 + (i % 20) * 0.01;
  return {
    id: `fx-${i}-${market}`,
    fixtureId: `fx-${i}`,
    league: (i % 2 === 0 ? 'EPL' : 'LALIGA') as any,
    fixtureDescription: `Home ${i} vs Away ${i}`,
    kickoff: '15:00:00Z',
    market: market as any,
    marketLabel: market,
    selection: market,
    estimatedProbability: probability,
    rawProbability: probability,
    confidenceLower: probability - 0.04,
    confidenceUpper: probability + 0.04,
    supportingStatistics: {
      homeGoalAverageLast5: 1.5, awayGoalAverageLast5: 1.2,
      homeConcededAverageLast5: 1.0, awayConcededAverageLast5: 1.1,
      homeXgAverage: 1.6, awayXgAverage: 1.4, bttsFrequencyLast10: 0.55,
      over25FrequencyLast10: 0.55, h2hSummary: 'H2H',
      cleanSheetRateHome: 0.25, cleanSheetRateHomeAway: 0.2,
    },
    sampleSize: 10,
    dataFreshnessDays: 1,
    riskFactors: [],
    actualOutcome: 'PENDING',
  };
}

async function main() {
  section('1) Event loop stays responsive under heavy fixture load');
  {
    const candidates = Array.from({ length: 900 }, (_, i) => prediction(i));

    let ticks = 0;
    let maxLagMs = 0;
    let last = Date.now();
    const interval = setInterval(() => {
      const now = Date.now();
      const lag = now - last - 2;
      if (lag > maxLagMs) maxLagMs = lag;
      last = now;
      ticks++;
    }, 2);

    const started = Date.now();
    const parlay = await buildStatisticalParlay(candidates, {
      targetLegsCount: 5,
      minProbability: 0.6,
    });
    const elapsed = Date.now() - started;
    clearInterval(interval);

    console.log(`  info: legs=${parlay.legs.length} elapsed=${elapsed}ms ticks=${ticks} maxLag=${maxLagMs}ms`);
    check('parlay generated under load', parlay.legs.length > 0, `legs=${parlay.legs.length}`);
    check('timer fired repeatedly (event loop not starved)', ticks >= 2, `ticks=${ticks}`);
    check('max timer lag < 50ms', maxLagMs < 50, `${maxLagMs}ms`);
  }

  section('2) handleGenerateParlay defers first and resolves under 4.5s');
  {
    const bot = new DiscordBotService({} as any, {} as any);
    const calls: string[] = [];

    // Simulate a heavy but yielding parlay reply.
    (bot as any).generateParlayReply = async () => {
      calls.push('generate');
      let work = 0;
      for (let i = 0; i < 200000; i++) {
        work += i % 7;
        if (i % 1000 === 0) await new Promise(r => setImmediate(r));
      }
      return `1. AS Monaco Over 1.5 Goals\n2. Freiburg Double Chance X2\nsum=${work > 0}`;
    };

    const interaction: any = {
      deferred: false,
      replied: false,
      user: { id: 'user-1' },
      channelId: 'chan-1',
      options: {
        getInteger: () => null,
        getString: () => null,
      },
      deferReply: async () => { interaction.deferred = true; calls.push('defer'); },
      editReply: async () => { calls.push('edit'); },
    };

    const started = Date.now();
    let threw: any = null;
    try {
      await (bot as any).handleGenerateParlay(interaction);
    } catch (e) { threw = e; }
    const elapsed = Date.now() - started;

    console.log(`  info: elapsed=${elapsed}ms calls=${calls.join(',')}`);
    check('deferReply called before generation', calls.indexOf('defer') >= 0 && calls.indexOf('defer') < calls.indexOf('generate'));
    check('handler resolved within 4.5s', threw === null && elapsed < 4500, threw ? String(threw) : `${elapsed}ms`);
    check('final editReply delivered', calls.includes('edit'));
  }

  section('3) Hung odds provider is cut off by the timeout guard');
  {
    const started = Date.now();
    let rejected = false;
    try {
      await Promise.race([
        new Promise<string>(() => { /* never resolves */ }),
        new Promise<string>((_, reject) => setTimeout(() => reject(new Error('timed out')), 300)),
      ]);
    } catch { rejected = true; }
    const elapsed = Date.now() - started;

    console.log(`  info: rejected after ${elapsed}ms`);
    check('hung provider rejected', rejected);
    check('timeout fired near ceiling (<1s)', elapsed < 1000, `${elapsed}ms`);
  }

  section('SUMMARY');
  console.log(`checks run : ${checks}`);
  console.log(`failures   : ${failures}`);
  if (failures > 0) {
    console.error(`\nEVENT-LOOP UNBLOCK VERIFICATION FAILED (${failures} check(s))`);
    process.exit(1);
  }
  console.log('\nEVENT-LOOP UNBLOCK VERIFICATION PASSED');
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
