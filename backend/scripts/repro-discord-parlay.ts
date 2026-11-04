/**
 * Verification script for /generateparlay Discord interaction performance and correctness
 */
import { DiscordBotService } from '../src/discord/bot.js';
import { DataProviderFactory } from '../src/providers/provider-factory.js';
import { config } from '../src/config/env.js';

async function runRepro() {
  console.log('\n--- STARTING /generateparlay SPEED & CORRECTNESS TEST ---');

  const factory = new DataProviderFactory(config);
  const bot = new DiscordBotService({ botToken: '' } as any, factory);

  const testCases = [
    { name: 'Cold Start Default (ALL, anti_correlated, 5 legs)', league: 'ALL', mode: 'anti_correlated', legs: 5, clearCache: true },
    { name: 'Warm Cache Default (ALL, anti_correlated, 5 legs)', league: 'ALL', mode: 'anti_correlated', legs: 5, clearCache: false },
    { name: 'EPL only', league: 'EPL', mode: 'anti_correlated', legs: 5, clearCache: false },
    { name: 'Same Game Parlay', league: 'ALL', mode: 'same_game', legs: 5, clearCache: false },
    { name: 'High Min Probability', league: 'ALL', mode: 'anti_correlated', legs: 5, min_probability: 85, clearCache: false },
    { name: 'Championship only (sparse)', league: 'CHAMPIONSHIP', mode: 'anti_correlated', legs: 5, clearCache: false },
  ];

  let hasFailure = false;

  for (const tc of testCases) {
    console.log(`\n--- Running Test Case: ${tc.name} ---`);
    if (tc.clearCache) {
      factory.clearCache();
      console.log('[Test Setup] In-memory cache cleared to simulate cold start.');
    }

    let replyPayload: any = null;

    const mockInteraction: any = {
      user: { id: 'test-user-999', username: 'Tester' },
      channelId: 'test-channel-999',
      commandName: 'generateparlay',
      deferred: false,
      replied: false,
      options: {
        getInteger: (name: string) => {
          if (name === 'legs') return tc.legs;
          if (name === 'min_probability') return tc.min_probability || null;
          return null;
        },
        getString: (name: string) => {
          if (name === 'league') return tc.league;
          if (name === 'mode') return tc.mode;
          return null;
        },
      },
      deferReply: async () => {
        mockInteraction.deferred = true;
      },
      editReply: async (payload: any) => {
        mockInteraction.replied = true;
        replyPayload = payload;
        if (payload.content) {
          console.log('[MockInteraction] Content payload:', payload.content);
        }
        if (payload.embeds && payload.embeds.length > 0) {
          const emb = payload.embeds[0].data || payload.embeds[0];
          console.log('[MockInteraction] Embed Title:', emb.title);
          console.log('[MockInteraction] Embed Description preview:\n', emb.description?.slice(0, 300));
          console.log('[MockInteraction] Embed Footer:', emb.footer?.text);
        }
        return payload;
      },
      reply: async (payload: any) => {
        mockInteraction.replied = true;
        replyPayload = payload;
        return payload;
      },
    };

    const start = Date.now();
    try {
      await (bot as any).handleGenerateParlay(mockInteraction);
      const elapsedMs = Date.now() - start;
      console.log(`[Test Result] Completed in ${elapsedMs}ms`);
      if (tc.clearCache && elapsedMs > 2500) {
        console.warn(`[PERF WARNING] Cold start took ${elapsedMs}ms (> 2500ms ceiling)`);
      } else if (!tc.clearCache && elapsedMs > 500) {
        console.warn(`[PERF WARNING] Warm cache took ${elapsedMs}ms (> 500ms ceiling)`);
      }
      console.log(`Test Case "${tc.name}": SUCCESS`);
    } catch (err: any) {
      hasFailure = true;
      console.error(`Test Case "${tc.name}": FAILED`);
      console.error('Exception Name:', err.name);
      console.error('Exception Message:', err.message);
      console.error('Stack Trace:', err.stack);
    }
  }

  if (hasFailure) {
    process.exit(1);
  }
}

runRepro();
