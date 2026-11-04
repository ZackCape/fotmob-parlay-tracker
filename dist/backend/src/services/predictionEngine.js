/**
 * Prediction Engine — applies human logic and tier disparity calibration
 * before generating match probabilities.
 *
 * Wraps the raw Dixon-Coles output with tier disparity adjustments,
 * David vs Goliath compression, and hybrid ensemble calibration.
 */
import { applyHumanLogic } from './humanLogicEngine.js';
export function calibrateFixture(homeTeam, awayTeam, homeLeague, awayLeague, baseHomeProb, baseDrawProb, baseAwayProb, baseHomeXg, baseAwayXg, isCupMatch = false, isEuropeanKnockout = false, homeEuropeanMatches = 0, awayEuropeanMatches = 0, h2hResults = []) {
    const result = applyHumanLogic({
        homeTeam,
        awayTeam,
        homeLeague,
        awayLeague,
        isCupMatch,
        isEuropeanKnockout,
        homeEuropeanMatches,
        awayEuropeanMatches,
        homeForm: [],
        awayForm: [],
        h2hResults,
    }, baseHomeProb, baseDrawProb, baseAwayProb, baseHomeXg, baseAwayXg);
    // Hybrid ensemble: blend with market odds if available
    // P_final = 0.75 * P_market + 0.25 * P_model
    // (Market odds integration happens at the embed level via oddsAggregatorService)
    return {
        homeWinProb: result.homeWinProb,
        drawProb: result.drawProb,
        awayWinProb: result.awayWinProb,
        homeXg: result.homeXg,
        awayXg: result.awayXg,
        topPick: result.topPick,
        adjustments: result.adjustments,
        matchDynamic: result.matchDynamic,
        cornerBias: result.cornerBias,
    };
}
export default { calibrateFixture };
