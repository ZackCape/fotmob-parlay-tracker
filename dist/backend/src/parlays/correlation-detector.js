export function getMarketFamily(market) {
    switch (market) {
        case 'HOME_WIN':
        case 'DRAW':
        case 'AWAY_WIN':
        case 'DOUBLE_CHANCE_1X':
        case 'DOUBLE_CHANCE_X2':
        case 'DOUBLE_CHANCE_12':
            return 'MATCH_OUTCOME';
        case 'OVER_0_5':
        case 'OVER_1_5':
        case 'OVER_2_5':
        case 'OVER_3_5':
        case 'UNDER_1_5':
        case 'UNDER_2_5':
        case 'UNDER_3_5':
            return 'TOTAL_GOALS';
        case 'OVER_2_5_CARDS':
        case 'OVER_3_5_CARDS':
        case 'OVER_4_5_CARDS':
        case 'UNDER_4_5_CARDS':
        case 'UNDER_5_5_CARDS':
            return 'CARDS';
        case 'OVER_5_5_CORNERS':
        case 'OVER_7_5_CORNERS':
        case 'OVER_8_5_CORNERS':
        case 'UNDER_8_5_CORNERS':
        case 'OVER_9_5_CORNERS':
        case 'UNDER_11_5_CORNERS':
            return 'CORNERS';
        case 'BTTS_YES':
        case 'BTTS_NO':
            return 'BTTS';
        case 'HOME_OVER_0_5':
        case 'HOME_OVER_1_5':
            return 'TEAM_GOALS_HOME';
        case 'AWAY_OVER_0_5':
        case 'AWAY_OVER_1_5':
            return 'TEAM_GOALS_AWAY';
        case 'HT_OVER_0_5':
        case 'HT_DRAW':
            return 'HALF_TIME';
        default:
            return 'OTHER';
    }
}
// Cross-family conflicting or mutually contradictory pairs within the same event
const CROSS_CONFLICTS = {
    UNDER_1_5: ['BTTS_YES'],
    BTTS_YES: ['UNDER_1_5'],
};
export function areMarketsConflicting(mA, mB) {
    if (mA === mB)
        return true; // duplicate market
    const famA = getMarketFamily(mA);
    const famB = getMarketFamily(mB);
    // Intra-match rule: never stack multiple markets from the same family on the same game
    // (e.g. both Double Chance 1X and 12, or both Over 2.5 Cards and Under 5.5 Cards,
    // or both Over 0.5 Goals and Over 1.5 Goals).
    if (famA !== 'OTHER' && famA === famB) {
        return true;
    }
    // Check cross-family conflict rules
    if (CROSS_CONFLICTS[mA]?.includes(mB) || CROSS_CONFLICTS[mB]?.includes(mA)) {
        return true;
    }
    return false;
}
export function areLegsCorrelated(legA, legB) {
    // Rule 1: STRICT - Never allow two selections from the SAME fixture in independent mode!
    if (legA.fixtureId === legB.fixtureId) {
        return true;
    }
    return false;
}
/**
 * One selection per fixture, keeping the strongest candidate for each match.
 *
 * By default the pool is ranked by calibrated probability first, which is the
 * plain "most reliable selection per match" rule. `respectGivenOrder` is set by
 * the parlay builder when it has already applied a deliberate ordering (for
 * example competition priority with probability as the in-tier tie-break): the
 * caller's order then survives the de-duplication untouched.
 */
export function filterNonCorrelatedPredictions(predictions, options = {}) {
    const seenFixtures = new Set();
    const filtered = [];
    // Sort by highest calibrated probability first to take the most reliable selection per match
    const sorted = options.respectGivenOrder
        ? [...predictions]
        : [...predictions].sort((a, b) => b.estimatedProbability - a.estimatedProbability);
    for (const pred of sorted) {
        if (!seenFixtures.has(pred.fixtureId)) {
            seenFixtures.add(pred.fixtureId);
            filtered.push(pred);
        }
    }
    return filtered;
}
