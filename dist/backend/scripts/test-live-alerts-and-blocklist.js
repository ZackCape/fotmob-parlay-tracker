import assert from 'node:assert';
import { isChannelBlocked, BLOCKED_CHANNEL_IDS } from '../src/discord/blockedChannels.js';
import * as CP from '../src/discord/interactions.js';
import { DataProviderFactory } from '../src/providers/provider-factory.js';
import { config } from '../src/config/env.js';
async function runTests() {
    console.log('🧪 Starting Live Alerts & Channel Blocklist Verification Suite...');
    // ---------------------------------------------------------
    // 1. Channel Blocklist Verification
    // ---------------------------------------------------------
    console.log('▶ Test 1: Channel Blocklist Guard');
    assert.strictEqual(isChannelBlocked('1526530756870934570'), true, 'Trapped channel must be blocked');
    assert.strictEqual(isChannelBlocked(' 1526530756870934570 '), true, 'Trapped channel with whitespace must be blocked');
    assert.strictEqual(isChannelBlocked('123456789012345678'), false, 'Normal channel must not be blocked');
    assert.strictEqual(isChannelBlocked(undefined), false, 'Undefined channel must not be blocked');
    assert.strictEqual(isChannelBlocked(null), false, 'Null channel must not be blocked');
    assert.ok(BLOCKED_CHANNEL_IDS.has('1526530756870934570'), 'BLOCKED_CHANNEL_IDS set must contain the trapped channel');
    console.log('✅ Test 1 Passed: Channel blocklist behaves correctly.');
    // ---------------------------------------------------------
    // 2. Live Subscriptions & Purge Verification
    // ---------------------------------------------------------
    console.log('▶ Test 2: Live Subscriptions Store');
    const blockedChannelId = '1526530756870934570';
    const validChannelId = '999888777666555444';
    // Ensure clean state before testing
    CP.unsubscribeAllForUserChannel('user_test_1', validChannelId);
    CP.unsubscribeAllForUserChannel('user_test_1', blockedChannelId);
    // Subscribing to blocked channel must fail
    const blockedSub = CP.subscribeLive('user_test_1', blockedChannelId, 'fixture_test_1');
    assert.strictEqual(blockedSub, false, 'subscribeLive must reject blocked channel ID');
    // Subscribing to valid channel must succeed
    const validSub = CP.subscribeLive('user_test_1', validChannelId, 'fixture_test_1');
    assert.strictEqual(validSub, true, 'subscribeLive must accept valid channel ID');
    assert.strictEqual(CP.isSubscribed('user_test_1', 'fixture_test_1'), true, 'User should be subscribed');
    // Purge test
    const purged = CP.purgeBlockedChannels(BLOCKED_CHANNEL_IDS);
    const subsForFx = CP.getSubscriptionsForFixture('fixture_test_1');
    assert.ok(subsForFx.every(s => !isChannelBlocked(s.channelId)), 'No subscriptions in blocked channels should remain');
    // Clean up user subscription
    const unsubs = CP.unsubscribeAllForUserChannel('user_test_1', validChannelId);
    assert.ok(unsubs >= 1, 'unsubscribeAllForUserChannel should remove test subscription');
    console.log('✅ Test 2 Passed: Live subscriptions reject blocked channel and purge reliably.');
    // ---------------------------------------------------------
    // 3. Saved Parlay Channel Scrubbing
    // ---------------------------------------------------------
    console.log('▶ Test 3: Saved Parlay Channel Scrubbing');
    const sampleParlay = {
        legs: [
            {
                fixtureId: 'fx_test_parlay',
                description: 'Arsenal vs Chelsea',
                league: 'PREMIER_LEAGUE',
                market: 'HOME_WIN',
                selection: 'Arsenal',
                probability: 0.65,
            },
        ],
        stake: 10,
    };
    const savedBlocked = CP.saveParlayToDisk(sampleParlay, {
        userId: 'user_parlay_1',
        channelId: blockedChannelId,
    });
    assert.strictEqual(isChannelBlocked(savedBlocked.channelId), false, 'Saved parlay channelId must be stripped for blocked channel');
    const savedValid = CP.saveParlayToDisk(sampleParlay, {
        userId: 'user_parlay_2',
        channelId: validChannelId,
    });
    assert.strictEqual(savedValid.channelId, validChannelId, 'Saved parlay channelId must be preserved for valid channel');
    const deactivated = CP.deactivateSavedParlaysForUserChannel('user_parlay_2', validChannelId);
    assert.ok(deactivated >= 1, 'deactivateSavedParlaysForUserChannel should deactivate active slip');
    console.log('✅ Test 3 Passed: Saved parlays sanitize blocked channels and support deactivation.');
    // ---------------------------------------------------------
    // 4. DataProviderFactory Live Scoreboard & Force Refresh
    // ---------------------------------------------------------
    console.log('▶ Test 4: DataProviderFactory Live Scoreboard & Refresh');
    const factory = new DataProviderFactory(config);
    assert.strictEqual(typeof factory.getLiveScoreboard, 'function', 'getLiveScoreboard must be defined');
    assert.strictEqual(typeof factory.getLiveFixtures, 'function', 'getLiveFixtures must be defined');
    const today = new Date().toISOString().slice(0, 10);
    const liveScoreboard = await factory.getLiveScoreboard(today);
    assert.ok(Array.isArray(liveScoreboard.live), 'liveScoreboard.live must be an array');
    assert.ok(Array.isArray(liveScoreboard.finished), 'liveScoreboard.finished must be an array');
    assert.ok(Array.isArray(liveScoreboard.all), 'liveScoreboard.all must be an array');
    const liveFixtures = await factory.getLiveFixtures(today);
    assert.ok(Array.isArray(liveFixtures), 'getLiveFixtures must return an array');
    console.log(`ℹ️ Live Scoreboard returned ${liveScoreboard.all.length} matches (${liveScoreboard.live.length} live, ${liveScoreboard.finished.length} finished).`);
    console.log('✅ Test 4 Passed: DataProviderFactory live scoreboard endpoints are operational.');
    // ---------------------------------------------------------
    // 5. Live Event Detection & Embeds
    // ---------------------------------------------------------
    console.log('▶ Test 5: Live Event Detection & Embed Formatting');
    const prevStats = {
        homeScore: 0,
        awayScore: 0,
        events: [],
    };
    const nextStats = {
        homeScore: 1,
        awayScore: 0,
        events: [
            {
                id: 'ev_goal_1',
                type: 'goal',
                scoring: true,
                minute: '34',
                team: 'Arsenal',
                player: 'Bukayo Saka',
                assist: 'Martin Odegaard',
                text: 'Goal! Arsenal 1, Chelsea 0. Bukayo Saka left footed shot.',
            },
            {
                id: 'ev_red_1',
                type: 'red-card',
                minute: '41',
                team: 'Chelsea',
                player: 'Marc Cucurella',
                text: 'Red Card! Marc Cucurella is shown the red card.',
            },
        ],
    };
    const detected = CP.detectNewEvents(prevStats, nextStats);
    assert.strictEqual(detected.length, 2, 'Should detect 2 new events');
    assert.strictEqual(detected[0].type, 'goal', 'First event should be goal');
    assert.strictEqual(detected[0].player, 'Bukayo Saka');
    assert.strictEqual(detected[1].type, 'red-card', 'Second event should be red-card');
    assert.strictEqual(detected[1].player, 'Marc Cucurella');
    const mockFixture = {
        id: 'espn-12345',
        homeTeam: { name: 'Arsenal' },
        awayTeam: { name: 'Chelsea' },
        homeScore: 1,
        awayScore: 0,
        league: 'PREMIER_LEAGUE',
        status: 'LIVE',
    };
    const goalEmbed = CP.buildGoalAlert(detected[0], mockFixture);
    assert.ok(goalEmbed.data.title?.includes('GOAL!'), 'Goal embed title should contain GOAL!');
    assert.ok(goalEmbed.data.description?.includes('Bukayo Saka'), 'Goal embed should mention scorer');
    const redEmbed = CP.buildRedCardAlert(detected[1], mockFixture);
    assert.ok(redEmbed.data.title?.includes('RED CARD'), 'Red card embed title should contain RED CARD');
    const disallowedEmbed = CP.buildDisallowedGoalAlert({ id: 'disallowed_1', type: 'goal', minute: '35', team: 'Arsenal', player: null, assist: null, text: 'VAR Offside' }, mockFixture);
    assert.ok(disallowedEmbed.data.title?.includes('DISALLOWED'), 'Disallowed embed title should mention DISALLOWED');
    console.log('✅ Test 5 Passed: Live event diffing and embed generation fully verified.');
    console.log('----------------------------------------------------');
    console.log('🎉 ALL 5 LIVE ALERTS & BLOCKLIST VERIFICATION TESTS PASSED!');
    console.log('----------------------------------------------------');
}
runTests().catch((err) => {
    console.error('❌ Verification Suite Failed:', err);
    process.exit(1);
});
