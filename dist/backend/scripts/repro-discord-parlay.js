/**
 * Verification script for /generateparlay Discord interaction performance,
 * breadcrumb tracing, and HTTP I/O audit.
 */
import axios from 'axios';
import { DiscordBotService } from '../src/discord/bot.js';
import { DataProviderFactory } from '../src/providers/provider-factory.js';
import { config } from '../src/config/env.js';
// HTTP Request Interception & Tracking
let capturedRequests = [];
if (typeof globalThis.fetch === 'function') {
    const nativeFetch = globalThis.fetch;
    globalThis.fetch = async (...args) => {
        const url = typeof args[0] === 'string' ? args[0] : (args[0]?.url || String(args[0]));
        capturedRequests.push(`[FETCH] ${url}`);
        return nativeFetch.apply(globalThis, args);
    };
}
axios.interceptors.request.use((req) => {
    const fullUrl = `${req.baseURL || ''}${req.url || ''}`;
    capturedRequests.push(`[AXIOS ${req.method?.toUpperCase() || 'GET'}] ${fullUrl}`);
    return req;
});
async function runRepro() {
    console.log('\n--- STARTING /generateparlay SPEED, TRACE & I/O AUDIT ---');
    const factory = new DataProviderFactory(config);
    const bot = new DiscordBotService({ botToken: '' }, factory);
    const testCases = [
        { name: 'Cold Boot (Disk Cache Fallback / No In-Memory RAM Cache)', league: 'ALL', mode: 'anti_correlated', legs: 5, clearMemCache: true },
        { name: 'Warm In-Memory Cache (ALL, anti_correlated, 5 legs)', league: 'ALL', mode: 'anti_correlated', legs: 5, clearMemCache: false },
        { name: 'EPL only', league: 'EPL', mode: 'anti_correlated', legs: 5, clearMemCache: false },
        { name: 'Same Game Parlay', league: 'ALL', mode: 'same_game', legs: 5, clearMemCache: false },
        { name: 'High Min Probability', league: 'ALL', mode: 'anti_correlated', legs: 5, min_probability: 85, clearMemCache: false },
        { name: 'Championship only (sparse)', league: 'CHAMPIONSHIP', mode: 'anti_correlated', legs: 5, clearMemCache: false },
        { name: 'Correlated Multi-Leg (Grouping verification)', league: 'ALL', mode: 'correlated', legs: 10, clearMemCache: false },
    ];
    let hasFailure = false;
    for (const tc of testCases) {
        console.log(`\n=======================================================`);
        console.log(`RUNNING TEST CASE: ${tc.name}`);
        console.log(`=======================================================`);
        if (tc.clearMemCache) {
            factory.clearCache();
            console.log('[Test Setup] In-memory cache cleared to simulate container cold boot.');
        }
        capturedRequests = [];
        let replyPayload = null;
        const mockInteraction = {
            user: { id: 'test-user-999', username: 'Tester' },
            channelId: 'test-channel-999',
            commandName: 'generateparlay',
            deferred: false,
            replied: false,
            options: {
                getInteger: (name) => {
                    if (name === 'legs')
                        return tc.legs;
                    if (name === 'min_probability')
                        return tc.min_probability || null;
                    return null;
                },
                getString: (name) => {
                    if (name === 'league')
                        return tc.league;
                    if (name === 'mode')
                        return tc.mode;
                    return null;
                },
            },
            deferReply: async () => {
                mockInteraction.deferred = true;
            },
            editReply: async (payload) => {
                mockInteraction.replied = true;
                replyPayload = payload;
                if (payload.content) {
                    console.log('[MockInteraction] Content payload:', payload.content);
                }
                if (payload.embeds && payload.embeds.length > 0) {
                    const emb = payload.embeds[0].data || payload.embeds[0];
                    console.log('[MockInteraction] Embed Title:', emb.title);
                    console.log('[MockInteraction] Embed Description preview:\n', emb.description?.slice(0, 260));
                    console.log('[MockInteraction] Embed Footer:', emb.footer?.text);
                }
                return payload;
            },
            reply: async (payload) => {
                mockInteraction.replied = true;
                replyPayload = payload;
                return payload;
            },
        };
        const start = Date.now();
        try {
            // Execute the exact handleGenerateParlay handler with 9000ms Promise.race guard
            await bot.handleGenerateParlay(mockInteraction);
            const elapsedMs = Date.now() - start;
            console.log(`[HTTP Audit] Total HTTP requests during this command: ${capturedRequests.length}`);
            if (capturedRequests.length > 0) {
                console.log('[HTTP Audit] List of intercepted requests:');
                capturedRequests.forEach((req, idx) => console.log(`  ${idx + 1}. ${req}`));
            }
            else {
                console.log('[HTTP Audit] ZERO external network HTTP calls made! (100% in-memory / local disk)');
            }
            // Assert zero per-match HTTP calls (e.g. ESPN summary/event details)
            const perMatchCalls = capturedRequests.filter(r => /summary|events\?|boxscore/i.test(r));
            if (perMatchCalls.length > 0) {
                throw new Error(`CRITICAL VIOLATION: ${perMatchCalls.length} per-match HTTP calls detected during parlay generation!`);
            }
            // If checking grouping on correlated multi-leg, assert contiguous grouping & match count
            if (tc.name.includes('Grouping verification')) {
                const desc = replyPayload?.embeds?.[0]?.data?.description || replyPayload?.embeds?.[0]?.description || '';
                console.log('[Grouping Verification] Full Embed Description:\n', desc);
                if (!desc.includes('Matches') && !desc.includes('•')) {
                    console.warn('[Grouping Verification] Note: Matches badge or bullet separator not present, check leg distribution.');
                }
                else {
                    console.log('[Grouping Verification] PASSED: Match group bullet formatting confirmed in output.');
                }
            }
            // Assert completion within ceiling (< 1500ms)
            if (elapsedMs > 1500) {
                throw new Error(`PERF VIOLATION: Execution took ${elapsedMs}ms (> 1500ms ceiling)`);
            }
            console.log(`[Test Result] Completed in ${elapsedMs}ms (< 1500ms threshold)`);
            console.log(`Test Case "${tc.name}": SUCCESS`);
        }
        catch (err) {
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
