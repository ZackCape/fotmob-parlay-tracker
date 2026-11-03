/**
 * Reproduction script for /generateparlay Discord interaction crash
 */
import { DiscordBotService } from '../src/discord/bot.js';
import { DataProviderFactory } from '../src/providers/provider-factory.js';
import { config } from '../src/config/env.js';

async function runRepro() {
  console.log('\n--- STARTING /generateparlay REPRODUCTION TEST ---');

  const factory = new DataProviderFactory(config);
  const bot = new DiscordBotService({ botToken: '' } as any, factory);

  const testCases = [
    { name: 'Default (ALL, anti_correlated, 5 legs)', league: 'ALL', mode: 'anti_correlated', legs: 5 },
    { name: 'EPL only', league: 'EPL', mode: 'anti_correlated', legs: 5 },
    { name: 'Same Game Parlay', league: 'ALL', mode: 'same_game', legs: 5 },
    { name: 'High Min Probability', league: 'ALL', mode: 'anti_correlated', legs: 5, min_probability: 85 },
    { name: 'Championship only (sparse)', league: 'CHAMPIONSHIP', mode: 'anti_correlated', legs: 5 },
  ];

  for (const tc of testCases) {
    console.log(`\n--- Running Test Case: ${tc.name} ---`);
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
        console.log('[MockInteraction] deferReply() executed successfully');
      },
      editReply: async (payload: any) => {
        mockInteraction.replied = true;
        replyPayload = payload;
        console.log('[MockInteraction] editReply() executed successfully');
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

    try {
      await (bot as any).handleGenerateParlay(mockInteraction);
      console.log(`Test Case "${tc.name}": SUCCESS`);
    } catch (err: any) {
      console.error(`Test Case "${tc.name}": FAILED`);
      console.error('Exception Name:', err.name);
      console.error('Exception Message:', err.message);
      console.error('Stack Trace:', err.stack);
    }
  }
}

runRepro();
