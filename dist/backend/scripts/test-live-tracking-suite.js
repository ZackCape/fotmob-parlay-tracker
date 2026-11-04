/**
 * Cape Predictor — Live Momentum, Pressure Squeeze & SSE Verification Suite
 *
 * Usage: npx tsx backend/scripts/test-live-tracking-suite.ts
 *
 * Verifies:
 * 1) Momentum score calculation, components, and strict boundary clamping [-100, 100]
 * 2) Pressure Squeeze detection criteria in the 75'+ window and cooldown deduplication
 * 3) In-Play Closing Line Value (iCLV) calculations
 * 4) Incident timeline recording, sorting, and in-memory live match state management
 * 5) SSE payload serialization for timeline events, momentum, and pressure alerts
 */
import { calculateMomentumScore, evaluatePressureSqueeze, calculateInPlayClv, updateLiveMatch, recordMatchIncident, getLiveMatch, getAllLiveMatches, clearLiveMatches, } from '../src/services/liveTrackingService.js';
import { emitLiveEvent, onLiveEvent, offLiveEvent, } from '../src/services/instantStreamService.js';
let totalChecks = 0;
let failures = 0;
function check(label, condition, detail) {
    totalChecks++;
    if (condition) {
        console.log(`  PASS  ${label}`);
    }
    else {
        failures++;
        console.log(`  FAIL  ${label}${detail ? ` -> ${detail}` : ''}`);
    }
}
function section(title) {
    console.log(`\n${'='.repeat(70)}\n${title}\n${'='.repeat(70)}`);
}
async function runLiveTrackingSuite() {
    console.log('Starting Live Tracking, Momentum & Pressure Squeeze Verification Suite...\n');
    clearLiveMatches();
    // -------------------------------------------------------------------------
    // 1. Momentum Score Calculation & Boundary Clamping
    // -------------------------------------------------------------------------
    section('1) Momentum Score Math & Strict Clamping [-100, 100]');
    const neutralStats = {
        homeScore: 0,
        awayScore: 0,
        homeShotsOnTarget: 0,
        awayShotsOnTarget: 0,
        homeCorners: 0,
        awayCorners: 0,
    };
    const neutralScore = calculateMomentumScore(neutralStats);
    check('neutral match stats yield 0 momentum', neutralScore === 0, `actual: ${neutralScore}`);
    const homeDominantStats = {
        homeScore: 1,
        awayScore: 0,
        homeShotsOnTarget: 4,
        awayShotsOnTarget: 1,
        homeCorners: 5,
        awayCorners: 1,
        homePossession: 62,
        awayPossession: 38,
    };
    const homeScore = calculateMomentumScore(homeDominantStats);
    check('home dominance yields strong positive momentum (> 30)', homeScore > 30, `actual: ${homeScore}`);
    const awayDominantStats = {
        homeScore: 0,
        awayScore: 2,
        homeShotsOnTarget: 1,
        awayShotsOnTarget: 6,
        homeCorners: 2,
        awayCorners: 7,
        homeRedCards: 1,
        awayRedCards: 0,
    };
    const awayScore = calculateMomentumScore(awayDominantStats);
    check('away dominance with home red card yields strong negative momentum (< -40)', awayScore < -40, `actual: ${awayScore}`);
    // Test Boundary Clamping
    const extremeHome = {
        homeScore: 10,
        awayScore: 0,
        homeShotsOnTarget: 25,
        awayShotsOnTarget: 0,
        homeCorners: 18,
        awayCorners: 0,
        awayRedCards: 2,
    };
    const clampedMax = calculateMomentumScore(extremeHome);
    check('extreme home siege clamps strictly at +100', clampedMax === 100, `actual: ${clampedMax}`);
    const extremeAway = {
        homeScore: 0,
        awayScore: 10,
        homeShotsOnTarget: 0,
        awayShotsOnTarget: 25,
        homeCorners: 0,
        awayCorners: 18,
        homeRedCards: 2,
    };
    const clampedMin = calculateMomentumScore(extremeAway);
    check('extreme away siege clamps strictly at -100', clampedMin === -100, `actual: ${clampedMin}`);
    // Recent goal boost
    const recentEvents = [
        { type: 'GOAL', team: 'home', minute: 72 },
    ];
    const boostedScore = calculateMomentumScore(neutralStats, recentEvents, 75);
    check('recent goal (within 10 min) adds +25 momentum boost', boostedScore === 25, `actual: ${boostedScore}`);
    // -------------------------------------------------------------------------
    // 2. "The Pressure Squeeze" Detection (75'+ Window)
    // -------------------------------------------------------------------------
    section('2) "The Pressure Squeeze" Radar in the 75\'+ Window');
    const pre75Match = {
        fixtureId: 'fx-pre75',
        homeTeam: 'Arsenal',
        awayTeam: 'Chelsea',
        minute: 68, // Before 75'
        status: 'LIVE',
        stats: { homeScore: 1, awayScore: 1, homeCorners: 8, awayCorners: 2 },
        momentum: 65, // High momentum, but early
        momentumHistory: [],
        pressureSqueezeActive: false,
        timeline: [],
        lastUpdated: Date.now(),
    };
    const pre75Alert = evaluatePressureSqueeze(pre75Match);
    check('pressure squeeze returns null before 75th minute', pre75Alert === null);
    const late78Match = {
        fixtureId: 'fx-late78',
        homeTeam: 'Arsenal',
        awayTeam: 'Chelsea',
        minute: 78, // Inside 75'+ window
        status: 'LIVE',
        stats: { homeScore: 1, awayScore: 1, homeCorners: 7, awayCorners: 2 },
        momentum: 55, // Dominant siege
        momentumHistory: [],
        pressureSqueezeActive: false,
        timeline: [],
        lastUpdated: Date.now(),
    };
    const lateAlert = evaluatePressureSqueeze(late78Match);
    check('pressure squeeze triggers at 78\' in a close match with heavy momentum', lateAlert !== null);
    if (lateAlert) {
        check('identifies home as dominant team', lateAlert.dominantTeam === 'home');
        check('recommends late goal & corner markets', lateAlert.recommendedMarkets.some(m => m.includes('GOAL') || m.includes('CORNER')));
        check('includes human-readable intelligence reason', lateAlert.reason.includes('Arsenal') && lateAlert.reason.includes('78\''));
    }
    // Cooldown deduplication
    const immediateDuplicate = evaluatePressureSqueeze(late78Match);
    check('immediate re-evaluation triggers cooldown deduplication (returns null)', immediateDuplicate === null);
    // -------------------------------------------------------------------------
    // 3. In-Play Closing Line Value (iCLV) Math
    // -------------------------------------------------------------------------
    section('3) In-Play Closing Line Value (iCLV) Math');
    // Taken 2.40 -> Live 1.60: ((2.40 / 1.60) - 1) * 100 = +50.0%
    const gainClv = calculateInPlayClv(2.40, 1.60);
    check('taken 2.40 vs live 1.60 yields +50.0% iCLV', gainClv === 50.0, `actual: ${gainClv}`);
    // Taken 1.80 -> Live 2.40: ((1.80 / 2.40) - 1) * 100 = -25.0%
    const dropClv = calculateInPlayClv(1.80, 2.40);
    check('taken 1.80 vs live 2.40 yields -25.0% iCLV', dropClv === -25.0, `actual: ${dropClv}`);
    const zeroClv = calculateInPlayClv(0, 2.0);
    check('zero taken odds gracefully yields 0 iCLV', zeroClv === 0);
    // -------------------------------------------------------------------------
    // 4. In-Memory Live Match State & Chronological Timeline
    // -------------------------------------------------------------------------
    section('4) In-Memory Live Match State & Incident Timeline');
    const snapshot = updateLiveMatch({
        fixtureId: 'fx-liverpool-city',
        homeTeam: 'Liverpool',
        awayTeam: 'Man City',
        minute: 34,
        status: 'LIVE',
        stats: {
            homeScore: 1,
            awayScore: 0,
            homeShotsOnTarget: 3,
            awayShotsOnTarget: 2,
            homeCorners: 4,
            awayCorners: 2,
        },
        inPlayOdds: {
            market: 'Match Winner (Liverpool)',
            selection: 'Liverpool',
            takenOdds: 2.50,
            liveOdds: 1.80,
        },
    });
    check('updateLiveMatch registers fixture in memory', snapshot.fixtureId === 'fx-liverpool-city');
    check('computes valid momentum score in range', snapshot.momentum >= -100 && snapshot.momentum <= 100);
    check('appends to momentum history', snapshot.momentumHistory.length === 1);
    check('calculates in-play CLV (+38.89%)', snapshot.inPlayOdds?.iClvPercent === 38.89);
    // Record incidents
    recordMatchIncident('fx-liverpool-city', {
        fixtureId: 'fx-liverpool-city',
        type: 'GOAL',
        minute: 22,
        team: 'home',
        detail: 'Liverpool Goal (M. Salah)',
    });
    recordMatchIncident('fx-liverpool-city', {
        fixtureId: 'fx-liverpool-city',
        type: 'YELLOW_CARD',
        minute: 29,
        team: 'away',
        detail: 'Yellow card for tactical foul',
    });
    const retrieved = getLiveMatch('fx-liverpool-city');
    check('getLiveMatch returns active match snapshot', !!retrieved);
    check('timeline stores 2 incidents', retrieved?.timeline.length === 2);
    check('timeline orders events chronologically (22\' before 29\')', retrieved?.timeline[0].minute === 22 && retrieved?.timeline[1].minute === 29);
    const allMatches = getAllLiveMatches();
    check('getAllLiveMatches returns non-empty list of active matches', allMatches.length >= 1);
    // -------------------------------------------------------------------------
    // 5. SSE Payload Serialization & Event Bus
    // -------------------------------------------------------------------------
    section('5) SSE Payload Serialization & Event Bus Delivery');
    let receivedSSEPayload = null;
    const testListener = (payload) => {
        receivedSSEPayload = payload;
    };
    onLiveEvent(testListener);
    const mockSSEPayload = {
        type: 'GOAL',
        fixtureId: 'fx-liverpool-city',
        homeTeam: 'Liverpool',
        awayTeam: 'Man City',
        homeScore: 2,
        awayScore: 0,
        minute: '41',
        detail: 'Liverpool Goal (D. Nunez)',
        timestamp: Date.now(),
        momentum: 62,
        inPlayOdds: {
            market: 'Match Winner (Liverpool)',
            takenOdds: 2.50,
            liveOdds: 1.30,
            iClvPercent: 92.31,
        },
    };
    emitLiveEvent(mockSSEPayload);
    offLiveEvent(testListener);
    check('SSE event bus dispatches payload to active listeners', receivedSSEPayload !== null);
    if (receivedSSEPayload) {
        const sseEventName = receivedSSEPayload.type.toLowerCase();
        const sseDataString = JSON.stringify(receivedSSEPayload);
        const sseFrame = `event: ${sseEventName}\ndata: ${sseDataString}\n\n`;
        check('SSE frame formats valid event header', sseFrame.startsWith('event: goal\n'));
        check('SSE frame serializes JSON data correctly', sseFrame.includes('"fixtureId":"fx-liverpool-city"'));
        check('SSE frame includes momentum and inPlayOdds', sseFrame.includes('"momentum":62') && sseFrame.includes('"iClvPercent":92.31'));
    }
    // -------------------------------------------------------------------------
    // SUMMARY
    // -------------------------------------------------------------------------
    section('SUMMARY');
    console.log(`checks run : ${totalChecks}`);
    console.log(`failures   : ${failures}`);
    if (failures > 0) {
        console.error('\n❌ LIVE TRACKING SUITE VERIFICATION FAILED');
        process.exit(1);
    }
    else {
        console.log('\n✅ ALL LIVE TRACKING SUITE VERIFICATION CHECKS PASSED');
        process.exit(0);
    }
}
runLiveTrackingSuite().catch((err) => {
    console.error('Fatal test error:', err);
    process.exit(1);
});
