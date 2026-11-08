/**
 * Verification test for /track slash command schema and execution.
 *
 * Verifies:
 * 1. Calling handleTrack with no options renders active parlay & live matches tracker embed in < 500ms.
 * 2. Calling handleTrack with match: 'test' renders the Live Simulation Snapshot + Goal/Pressure Squeeze follow-up embeds.
 * 3. Verifies SLASH_COMMANDS schema for /track has valid Discord API types and no unhandled autocomplete traps.
 */
import { DiscordBotService, SLASH_COMMANDS } from '../src/discord/bot.js';
import { DataProviderFactory } from '../src/providers/provider-factory.js';
import { config } from '../src/config/env.js';
let passes = 0;
let failures = 0;
function assert(condition, label, detail) {
    if (condition) {
        passes++;
        console.log(`✅ PASS: ${label}${detail ? ` (${detail})` : ''}`);
    }
    else {
        failures++;
        console.error(`❌ FAIL: ${label}${detail ? ` (${detail})` : ''}`);
    }
}
function createMockInteraction(optionMap = {}, channelId = 'channel-test-101', userId = 'user-test-202') {
    let replyData = null;
    let editReplyData = null;
    let isDeferred = false;
    let isReplied = false;
    return {
        commandName: 'track',
        channelId,
        user: { id: userId, tag: 'TestUser#0001' },
        get deferred() { return isDeferred; },
        get replied() { return isReplied; },
        options: {
            getString: (name) => optionMap[name] ?? null,
            data: Object.entries(optionMap)
                .filter(([_, v]) => v !== null)
                .map(([name, value]) => ({ name, value })),
        },
        deferReply: async () => {
            isDeferred = true;
        },
        editReply: async (data) => {
            editReplyData = data;
            isReplied = true;
            return data;
        },
        reply: async (data) => {
            replyData = data;
            isReplied = true;
            return data;
        },
        getReplyData: () => editReplyData || replyData,
    };
}
async function run() {
    console.log('====================================================');
    console.log('TESTING /track COMMAND EXECUTION & SCHEMA SYNC');
    console.log('====================================================\n');
    const factory = new DataProviderFactory(config);
    const bot = new DiscordBotService({ botToken: '' }, factory);
    const sentChannelMessages = [];
    // Mock bot client for channel messaging simulation
    bot.client = {
        user: { id: 'bot-id-999', tag: 'CapePredictor#0001' },
        guilds: {
            cache: new Map([
                ['guild-1', {
                        id: 'guild-1',
                        commands: {
                            set: async (cmds) => cmds,
                        },
                    }],
            ]),
        },
        channels: {
            fetch: async (id) => ({
                id,
                isTextBased: () => true,
                send: async (payload) => {
                    sentChannelMessages.push(payload);
                    return payload;
                },
            }),
        },
    };
    // --- Test 1: Empty /track interaction (< 500ms) ---
    console.log('--- 1. Testing Empty /track (Active Parlay & Matches Tracker) ---');
    const emptyInteraction = createMockInteraction({});
    const t0 = Date.now();
    await bot.handleTrack(emptyInteraction);
    const elapsedEmpty = Date.now() - t0;
    const emptyReply = emptyInteraction.getReplyData();
    console.log(`Empty /track handled in ${elapsedEmpty}ms`);
    assert(emptyInteraction.deferred, 'Interaction was successfully deferred');
    assert(elapsedEmpty < 500, `Empty /track response latency < 500ms (actual: ${elapsedEmpty}ms)`);
    assert(!!emptyReply && (typeof emptyReply === 'string' || (Array.isArray(emptyReply.embeds) && emptyReply.embeds.length > 0)), 'Empty /track rendered valid tracker reply or embed');
    // --- Test 2: /track match: 'test' Simulation ---
    console.log('\n--- 2. Testing /track match: "test" (Live Simulation & Goal Alerts) ---');
    const testInteraction = createMockInteraction({ match: 'test' });
    await bot.handleTrack(testInteraction);
    const testReply = testInteraction.getReplyData();
    assert(typeof testReply?.content === 'string' && testReply.content.includes('Live Tracking Simulation Started'), 'Initial simulation response confirms telemetry stream started');
    assert(Array.isArray(testReply?.embeds) && testReply.embeds.length > 0, 'Simulation snapshot embed present in reply');
    const simEmbed = testReply?.embeds?.[0]?.data || testReply?.embeds?.[0];
    assert(simEmbed?.title?.includes('LIVE TEST SIMULATION') || simEmbed?.title?.includes('Arsenal 1 - 1 Bayern Munich'), 'Simulation snapshot embed title reflects active in-game score and momentum');
    // Wait for follow-up simulation goal alert (fired at 2500ms)
    console.log('Waiting for follow-up simulation goal event alert (~2600ms)...');
    await new Promise(resolve => setTimeout(resolve, 2800));
    assert(sentChannelMessages.length >= 1, `Follow-up goal alert was dispatched to channel (got ${sentChannelMessages.length})`);
    const followUpEmbed = sentChannelMessages[0]?.embeds?.[0]?.data || sentChannelMessages[0]?.embeds?.[0];
    assert(followUpEmbed?.title?.includes('GOAL ALERT') || followUpEmbed?.description?.includes('Bukayo Saka'), 'Follow-up alert contains live goal notification');
    // --- Test 3: SLASH_COMMANDS Schema Verification for /track ---
    console.log('\n--- 3. Verifies SLASH_COMMANDS Schema for /track ---');
    assert(Array.isArray(SLASH_COMMANDS) && SLASH_COMMANDS.length > 0, 'SLASH_COMMANDS array is exported and non-empty');
    const trackCmd = SLASH_COMMANDS.find((c) => {
        const json = typeof c.toJSON === 'function' ? c.toJSON() : c;
        return json.name === 'track';
    });
    assert(!!trackCmd, '/track slash command exists in SLASH_COMMANDS');
    const trackJson = typeof trackCmd?.toJSON === 'function' ? trackCmd.toJSON() : trackCmd;
    console.log('Track command JSON schema:', JSON.stringify(trackJson, null, 2));
    assert(trackJson?.name === 'track', 'Command name is "track"');
    assert(typeof trackJson?.description === 'string' && trackJson.description.length > 0, 'Command has valid description');
    const matchOption = trackJson?.options?.find((o) => o.name === 'match' || o.name === 'fixture');
    assert(!!matchOption, 'Command has optional match string option');
    assert(matchOption?.type === 3, 'Option type is STRING (type 3)');
    assert(matchOption?.required === false, 'Option is optional (required: false)');
    assert(matchOption?.autocomplete !== true, 'Option does NOT require unhandled autocomplete (immune to autocomplete timeouts)');
    console.log('\n====================================================');
    console.log(`TOTAL PASSES: ${passes}`);
    console.log(`TOTAL FAILURES: ${failures}`);
    console.log('====================================================');
    if (failures > 0) {
        process.exit(1);
    }
}
run().catch(err => {
    console.error('Fatal error in test-track-command:', err);
    process.exit(1);
});
