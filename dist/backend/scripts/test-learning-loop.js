/**
 * Cape Predictor — Quantitative Learning Feedback Loop Verification
 *
 * Usage: npx tsx backend/scripts/test-learning-loop.ts
 *
 * Verifies that:
 * 1) getMarketConfidenceMultiplier defaults to neutral 1.0 on empty ledger
 * 2) Rolling 30-day settlement accuracy computes hit-rates per market and league
 * 3) Past losses dynamically down-weight market selection probability down to 0.85
 * 4) Past wins dynamically up-weight market selection probability up to 1.15
 * 5) Hard bounds [0.85 .. 1.15] are strictly enforced
 * 6) Historical events older than 30 days are excluded from the rolling window
 * 7) buildStatisticalParlay integrates learning weights to down-weight underperforming
 *    markets and prioritize winning patterns
 * 8) minProbability threshold filtering rejects down-weighted failing markets
 * 9) disableLearningLoop option cleanly bypasses adjustments
 */
import { getMarketConfidenceMultiplier, calculateRollingMarketAccuracy, getMarketStats, normalizeMarketType, setMockSettlementLedger, clearLearningWeightCache, MIN_CONFIDENCE_MULTIPLIER, MAX_CONFIDENCE_MULTIPLIER, NEUTRAL_CONFIDENCE_MULTIPLIER, ROLLING_WINDOW_MS, } from '../src/services/learningWeightService.js';
import { buildStatisticalParlay } from '../src/parlays/parlay-builder.js';
let failures = 0;
let totalChecks = 0;
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
function createMockPrediction(fixtureId, market, prob, league = 'PL') {
    return {
        id: `${fixtureId}-${market}`,
        fixtureId,
        league: league,
        fixtureDescription: `Fixture ${fixtureId}`,
        kickoff: new Date().toISOString(),
        market: market,
        marketLabel: market,
        selection: `Selection ${market}`,
        estimatedProbability: prob,
        rawProbability: prob,
        confidenceLower: prob - 0.05,
        confidenceUpper: prob + 0.05,
        supportingStatistics: {
            homeGoalAverageLast5: 1.8,
            awayGoalAverageLast5: 1.4,
            homeConcededAverageLast5: 1.1,
            awayConcededAverageLast5: 1.2,
            homeXgAverage: 1.5,
            awayXgAverage: 1.2,
            bttsFrequencyLast10: 0.6,
            over25FrequencyLast10: 0.6,
            h2hSummary: 'H2H',
            cleanSheetRateHome: 0.2,
            cleanSheetRateAway: 0.2,
        },
        sampleSize: 10,
        dataFreshnessDays: 1,
        riskFactors: [],
        actualOutcome: 'PENDING',
    };
}
async function runVerification() {
    console.log('Starting Cape Predictor Quantitative Learning Feedback Loop Verification...\n');
    // -------------------------------------------------------------------------
    // 1. Cold Start & Neutral Default
    // -------------------------------------------------------------------------
    section('1) Cold-Start & Neutral Defaults');
    setMockSettlementLedger(null);
    clearLearningWeightCache();
    const neutralBTTS = getMarketConfidenceMultiplier('BTTS_YES', 'PL');
    const neutral1X2 = getMarketConfidenceMultiplier('HOME_WIN', 'CL');
    const neutralOver = getMarketConfidenceMultiplier('OVER_2_5', 'CHAM');
    check('empty ledger returns neutral multiplier 1.0 for BTTS', neutralBTTS === NEUTRAL_CONFIDENCE_MULTIPLIER);
    check('empty ledger returns neutral multiplier 1.0 for 1X2', neutral1X2 === NEUTRAL_CONFIDENCE_MULTIPLIER);
    check('empty ledger returns neutral multiplier 1.0 for Over/Under', neutralOver === NEUTRAL_CONFIDENCE_MULTIPLIER);
    const initialSummary = calculateRollingMarketAccuracy();
    check('total settled legs is 0 when ledger is blank', initialSummary.totalSettledLegs === 0);
    // -------------------------------------------------------------------------
    // 2. Normalisation of Market Categories
    // -------------------------------------------------------------------------
    section('2) Market Category Normalisation');
    check('HOME_WIN maps to 1X2', normalizeMarketType('HOME_WIN') === '1X2');
    check('DRAW maps to 1X2', normalizeMarketType('DRAW') === '1X2');
    check('AWAY_WIN maps to 1X2', normalizeMarketType('AWAY_WIN') === '1X2');
    check('BTTS_YES maps to BTTS', normalizeMarketType('BTTS_YES') === 'BTTS');
    check('BTTS_NO maps to BTTS', normalizeMarketType('BTTS_NO') === 'BTTS');
    check('OVER_2_5 maps to OVER_UNDER_GOALS', normalizeMarketType('OVER_2_5') === 'OVER_UNDER_GOALS');
    check('UNDER_3_5 maps to OVER_UNDER_GOALS', normalizeMarketType('UNDER_3_5') === 'OVER_UNDER_GOALS');
    check('OVER_8_5_CORNERS maps to CORNERS', normalizeMarketType('OVER_8_5_CORNERS') === 'CORNERS');
    check('OVER_3_5_CARDS maps to CARDS', normalizeMarketType('OVER_3_5_CARDS') === 'CARDS');
    check('DOUBLE_CHANCE_1X maps to DOUBLE_CHANCE', normalizeMarketType('DOUBLE_CHANCE_1X') === 'DOUBLE_CHANCE');
    // -------------------------------------------------------------------------
    // 3. Dynamic Down-weighting on Losses & Up-weighting on Wins
    // -------------------------------------------------------------------------
    section('3) Dynamic Down-weighting on Losses & Up-weighting on Wins');
    const now = Date.now();
    const mockLedger = {
        slips: [
            // 5 consecutive losses on BTTS in PL
            ...Array.from({ length: 5 }, (_, i) => ({
                id: `slip-loss-${i}`,
                settledAt: now - 1000 * 60 * 60 * (i + 1), // Past few hours
                result: 'LOST',
                league: 'PL',
                legs: [
                    {
                        fixtureId: `fx-btts-${i}`,
                        market: 'BTTS_YES',
                        league: 'PL',
                        result: 'MISS',
                    },
                ],
            })),
            // 6 consecutive wins on OVER_2_5 in PL
            ...Array.from({ length: 6 }, (_, i) => ({
                id: `slip-win-${i}`,
                settledAt: now - 1000 * 60 * 60 * (i + 1),
                result: 'WON',
                league: 'PL',
                legs: [
                    {
                        fixtureId: `fx-over-${i}`,
                        market: 'OVER_2_5',
                        league: 'PL',
                        result: 'HIT',
                    },
                ],
            })),
        ],
    };
    setMockSettlementLedger(mockLedger);
    clearLearningWeightCache();
    const bttsMult = getMarketConfidenceMultiplier('BTTS_YES', 'PL');
    const overMult = getMarketConfidenceMultiplier('OVER_2_5', 'PL');
    check('BTTS with 5 consecutive misses is down-weighted (< 1.0)', bttsMult < 1.0, `actual: ${bttsMult}`);
    check('BTTS multiplier satisfies lower boundary (>= 0.85)', bttsMult >= MIN_CONFIDENCE_MULTIPLIER, `actual: ${bttsMult}`);
    check('OVER_2_5 with 6 consecutive hits is boosted (> 1.0)', overMult > 1.0, `actual: ${overMult}`);
    check('OVER_2_5 multiplier satisfies upper boundary (<= 1.15)', overMult <= MAX_CONFIDENCE_MULTIPLIER, `actual: ${overMult}`);
    const bttsStats = getMarketStats('BTTS_YES', 'PL');
    check('bttsStats correctly reflects 0% hit rate', bttsStats.hitRate === 0 && bttsStats.misses === 5);
    const overStats = getMarketStats('OVER_2_5', 'PL');
    check('overStats correctly reflects 100% hit rate', overStats.hitRate === 100 && overStats.hits === 6);
    // -------------------------------------------------------------------------
    // 4. Strict Clamp Bounds [0.85 .. 1.15]
    // -------------------------------------------------------------------------
    section('4) Strict Clamp Bounds [0.85 .. 1.15]');
    const extremeLossLedger = {
        slips: Array.from({ length: 50 }, (_, i) => ({
            id: `extreme-loss-${i}`,
            settledAt: now - 10000 * (i + 1),
            result: 'LOST',
            legs: [{ market: 'DRAW', league: 'PL', result: 'MISS' }],
        })),
    };
    setMockSettlementLedger(extremeLossLedger);
    clearLearningWeightCache();
    const extremeLossMult = getMarketConfidenceMultiplier('DRAW', 'PL');
    check('extreme losses clamp strictly at 0.85 floor', extremeLossMult === MIN_CONFIDENCE_MULTIPLIER, `actual: ${extremeLossMult}`);
    const extremeWinLedger = {
        slips: Array.from({ length: 50 }, (_, i) => ({
            id: `extreme-win-${i}`,
            settledAt: now - 10000 * (i + 1),
            result: 'WON',
            legs: [{ market: 'HOME_WIN', league: 'PL', result: 'HIT' }],
        })),
    };
    setMockSettlementLedger(extremeWinLedger);
    clearLearningWeightCache();
    const extremeWinMult = getMarketConfidenceMultiplier('HOME_WIN', 'PL');
    check('extreme wins clamp strictly at 1.15 ceiling', extremeWinMult === MAX_CONFIDENCE_MULTIPLIER, `actual: ${extremeWinMult}`);
    // -------------------------------------------------------------------------
    // 5. 30-Day Rolling Window Exclusion
    // -------------------------------------------------------------------------
    section('5) Rolling 30-Day Window Exclusion');
    const thirtyFiveDaysAgo = now - (ROLLING_WINDOW_MS + 5 * 24 * 60 * 60 * 1000);
    const oldLossLedger = {
        slips: [
            {
                id: 'old-slip-1',
                settledAt: thirtyFiveDaysAgo, // 35 days ago - outside 30-day window!
                result: 'LOST',
                legs: [{ market: 'OVER_3_5', league: 'PL', result: 'MISS' }],
            },
        ],
    };
    setMockSettlementLedger(oldLossLedger);
    clearLearningWeightCache();
    const expiredMult = getMarketConfidenceMultiplier('OVER_3_5', 'PL');
    check('losses older than 30 days are excluded and return neutral 1.0', expiredMult === NEUTRAL_CONFIDENCE_MULTIPLIER, `actual: ${expiredMult}`);
    // -------------------------------------------------------------------------
    // 6. Integration into Parlay Builder (Probability Scaling & Thresholds)
    // -------------------------------------------------------------------------
    section('6) Parlay Builder Integration & Selection Re-ranking');
    // Set up ledger where:
    // - BTTS_YES in PL has suffered losses (multiplier ~0.85)
    // - OVER_2_5 in PL has high hit rate (multiplier ~1.15)
    setMockSettlementLedger(mockLedger);
    clearLearningWeightCache();
    const bttsMultiplier = getMarketConfidenceMultiplier('BTTS_YES', 'PL');
    const overMultiplier = getMarketConfidenceMultiplier('OVER_2_5', 'PL');
    // Candidate A (BTTS_YES): raw probability = 0.70
    // Candidate B (OVER_2_5): raw probability = 0.68
    // Without learning, Candidate A (0.70) ranks higher than Candidate B (0.68).
    // With learning:
    // Candidate A: 0.70 * bttsMultiplier (~0.85) = ~0.595 (down-weighted)
    // Candidate B: 0.68 * overMultiplier (~1.15) = ~0.782 (boosted)
    const candidateA = createMockPrediction('match-A', 'BTTS_YES', 0.70, 'PL');
    const candidateB = createMockPrediction('match-B', 'OVER_2_5', 0.68, 'PL');
    // Test with learning enabled
    const parlayLearned = await buildStatisticalParlay([candidateA, candidateB], {
        targetLegsCount: 5,
        minProbability: 0.55,
        leagueFilter: 'ALL',
    });
    const selectedLearnedA = parlayLearned.legs.find(l => l.fixtureId === 'match-A');
    const selectedLearnedB = parlayLearned.legs.find(l => l.fixtureId === 'match-B');
    check('candidate A (BTTS) is present in parlay', !!selectedLearnedA);
    check('candidate B (OVER_2_5) is present in parlay', !!selectedLearnedB);
    if (selectedLearnedA && selectedLearnedB) {
        check('candidate A learned probability reflects down-weighting', selectedLearnedA.estimatedProbability < 0.70, `prob: ${selectedLearnedA.estimatedProbability}`);
        check('candidate B learned probability reflects upward boost', selectedLearnedB.estimatedProbability > 0.68, `prob: ${selectedLearnedB.estimatedProbability}`);
        check('winning market (candidate B) is prioritized above failing market (candidate A)', selectedLearnedB.estimatedProbability > selectedLearnedA.estimatedProbability, `B: ${selectedLearnedB.estimatedProbability} vs A: ${selectedLearnedA.estimatedProbability}`);
    }
    // -------------------------------------------------------------------------
    // 7. Threshold Gating with Learning
    // -------------------------------------------------------------------------
    section('7) Threshold Gating with Learning');
    // If threshold is 0.65:
    // Candidate A raw was 0.70, but learned is ~0.595 -> SHOULD BE EXCLUDED
    // Candidate B raw was 0.68, learned is ~0.782 -> SHOULD BE INCLUDED
    const parlayGated = await buildStatisticalParlay([candidateA, candidateB], {
        targetLegsCount: 5,
        minProbability: 0.65,
        leagueFilter: 'ALL',
    });
    const gatedA = parlayGated.legs.find(l => l.fixtureId === 'match-A');
    const gatedB = parlayGated.legs.find(l => l.fixtureId === 'match-B');
    check('failing market candidate A is dropped by 0.65 threshold gate', !gatedA);
    check('winning market candidate B passes 0.65 threshold gate', !!gatedB);
    // -------------------------------------------------------------------------
    // 8. Bypassing Learning via disableLearningLoop
    // -------------------------------------------------------------------------
    section('8) Explicit Bypass via disableLearningLoop');
    const parlayBypassed = await buildStatisticalParlay([candidateA, candidateB], {
        targetLegsCount: 5,
        minProbability: 0.55,
        leagueFilter: 'ALL',
        disableLearningLoop: true,
    });
    const bypassedA = parlayBypassed.legs.find(l => l.fixtureId === 'match-A');
    const bypassedB = parlayBypassed.legs.find(l => l.fixtureId === 'match-B');
    if (bypassedA && bypassedB) {
        check('candidate A retains raw probability 0.70 when learning bypassed', bypassedA.estimatedProbability === 0.70);
        check('candidate B retains raw probability 0.68 when learning bypassed', bypassedB.estimatedProbability === 0.68);
        check('candidate A ranks ahead of candidate B under raw probabilities', bypassedA.estimatedProbability > bypassedB.estimatedProbability);
    }
    // Clean-up
    setMockSettlementLedger(null);
    clearLearningWeightCache();
    // -------------------------------------------------------------------------
    // SUMMARY
    // -------------------------------------------------------------------------
    section('SUMMARY');
    console.log(`checks run : ${totalChecks}`);
    console.log(`failures   : ${failures}`);
    if (failures > 0) {
        console.error('\n❌ QUANTITATIVE LEARNING LOOP VERIFICATION FAILED');
        process.exit(1);
    }
    else {
        console.log('\n✅ ALL QUANTITATIVE LEARNING LOOP VERIFICATION CHECKS PASSED');
        process.exit(0);
    }
}
runVerification().catch(err => {
    console.error('Fatal test error:', err);
    process.exit(1);
});
