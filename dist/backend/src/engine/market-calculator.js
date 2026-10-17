import { calculateDixonColes, poissonCdf } from './poisson-dixon-coles.js';
import { calibrateProbability } from './calibrator.js';
// Empirical league prior frequencies for calibration shrinkage
const LEAGUE_PRIORS = {
    HOME_WIN: 0.44,
    DRAW: 0.25,
    AWAY_WIN: 0.31,
    OVER_0_5: 0.92,
    OVER_1_5: 0.78,
    OVER_2_5: 0.52,
    UNDER_2_5: 0.48,
    OVER_3_5: 0.31,
    UNDER_3_5: 0.69,
    BTTS_YES: 0.51,
    BTTS_NO: 0.49,
    DOUBLE_CHANCE_1X: 0.69,
    DOUBLE_CHANCE_X2: 0.56,
    DOUBLE_CHANCE_12: 0.75,
    HOME_OVER_0_5: 0.79,
    AWAY_OVER_0_5: 0.68,
    HT_OVER_0_5: 0.70,
    HT_DRAW: 0.42,
    OVER_5_5_CORNERS: 0.88,
    OVER_7_5_CORNERS: 0.75,
    OVER_8_5_CORNERS: 0.63,
    UNDER_11_5_CORNERS: 0.71,
    OVER_2_5_CARDS: 0.80,
    OVER_3_5_CARDS: 0.62,
    UNDER_5_5_CARDS: 0.82,
};
export function deriveMarketPredictions(fixture, homeAttack, homeDefense, awayAttack, awayDefense, supportingStats, sampleSize, dataFreshnessDays, riskFactors) {
    const dcResult = calculateDixonColes(homeAttack, homeDefense, awayAttack, awayDefense, fixture.league);
    const matrix = dcResult.scoreMatrix;
    let probHomeWin = 0;
    let probDraw = 0;
    let probAwayWin = 0;
    let probOver05 = 0;
    let probOver15 = 0;
    let probOver25 = 0;
    let probOver35 = 0;
    let probBttsYes = 0;
    let probHomeOver05 = 0;
    let probAwayOver05 = 0;
    for (const cell of matrix) {
        const { homeScore, awayScore, probability } = cell;
        const totalGoals = homeScore + awayScore;
        if (homeScore > awayScore)
            probHomeWin += probability;
        else if (homeScore === awayScore)
            probDraw += probability;
        else
            probAwayWin += probability;
        if (totalGoals >= 1)
            probOver05 += probability;
        if (totalGoals >= 2)
            probOver15 += probability;
        if (totalGoals >= 3)
            probOver25 += probability;
        if (totalGoals >= 4)
            probOver35 += probability;
        if (homeScore > 0 && awayScore > 0)
            probBttsYes += probability;
        if (homeScore > 0)
            probHomeOver05 += probability;
        if (awayScore > 0)
            probAwayOver05 += probability;
    }
    const probUnder25 = 1 - probOver25;
    const probUnder35 = 1 - probOver35;
    const probBttsNo = 1 - probBttsYes;
    const prob1X = probHomeWin + probDraw;
    const probX2 = probDraw + probAwayWin;
    const prob12 = probHomeWin + probAwayWin;
    // Approximate first half projections based on empirical half-time distributions
    const probHtOver05 = 1 - Math.exp(-0.45 * (dcResult.homeExpectedGoals + dcResult.awayExpectedGoals));
    const probHtDraw = 0.40 * (1 - Math.abs(dcResult.homeExpectedGoals - dcResult.awayExpectedGoals) * 0.12);
    // Poisson estimation for Match Corners based on attacking momentum
    const homeCornersEst = (homeAttack * 5.4 + 4.6) / 2;
    const awayCornersEst = (awayAttack * 4.8 + 4.4) / 2;
    const lambdaCorners = Math.max(7.5, homeCornersEst + awayCornersEst);
    const probOver55Corners = 1 - poissonCdf(5, lambdaCorners);
    const probOver75Corners = 1 - poissonCdf(7, lambdaCorners);
    const probOver85Corners = 1 - poissonCdf(8, lambdaCorners);
    const probUnder115Corners = poissonCdf(11, lambdaCorners);
    // Poisson estimation for Match Disciplinary Cards
    let lambdaCards = 3.9;
    if (fixture.league === 'LALIGA')
        lambdaCards = 4.8;
    else if (fixture.league === 'CHAMPIONSHIP')
        lambdaCards = 4.3;
    else if (fixture.league === 'LIGUE1')
        lambdaCards = 4.1;
    const probOver25Cards = 1 - poissonCdf(2, lambdaCards);
    const probOver35Cards = 1 - poissonCdf(3, lambdaCards);
    const probUnder55Cards = poissonCdf(5, lambdaCards);
    const rawMarkets = [
        {
            market: 'HOME_WIN',
            label: 'Full-Time Result',
            selection: `${fixture.homeTeam.shortName} to Win`,
            rawProb: probHomeWin,
            prior: LEAGUE_PRIORS.HOME_WIN,
            extraRisks: probAwayWin > 0.35 ? ['Close match rating: high away upset potential'] : [],
        },
        {
            market: 'DRAW',
            label: 'Full-Time Result',
            selection: 'Draw',
            rawProb: probDraw,
            prior: LEAGUE_PRIORS.DRAW,
            extraRisks: ['Draws exhibit high inherent variance in football'],
        },
        {
            market: 'AWAY_WIN',
            label: 'Full-Time Result',
            selection: `${fixture.awayTeam.shortName} to Win`,
            rawProb: probAwayWin,
            prior: LEAGUE_PRIORS.AWAY_WIN,
            extraRisks: ['Away side playing without home ground advantage'],
        },
        {
            market: 'DOUBLE_CHANCE_1X',
            label: 'Double Chance',
            selection: `${fixture.homeTeam.shortName} or Draw (1X)`,
            rawProb: prob1X,
            prior: LEAGUE_PRIORS.DOUBLE_CHANCE_1X,
            extraRisks: [],
        },
        {
            market: 'DOUBLE_CHANCE_X2',
            label: 'Double Chance',
            selection: `Draw or ${fixture.awayTeam.shortName} (X2)`,
            rawProb: probX2,
            prior: LEAGUE_PRIORS.DOUBLE_CHANCE_X2,
            extraRisks: [],
        },
        {
            market: 'DOUBLE_CHANCE_12',
            label: 'Double Chance',
            selection: `${fixture.homeTeam.shortName} or ${fixture.awayTeam.shortName} (12)`,
            rawProb: prob12,
            prior: LEAGUE_PRIORS.DOUBLE_CHANCE_12,
            extraRisks: ['Fails if match ends in a draw'],
        },
        {
            market: 'OVER_1_5',
            label: 'Total Goals',
            selection: 'Over 1.5 Goals',
            rawProb: probOver15,
            prior: LEAGUE_PRIORS.OVER_1_5,
            extraRisks: [],
        },
        {
            market: 'OVER_2_5',
            label: 'Total Goals',
            selection: 'Over 2.5 Goals',
            rawProb: probOver25,
            prior: LEAGUE_PRIORS.OVER_2_5,
            extraRisks: dcResult.homeExpectedGoals + dcResult.awayExpectedGoals < 2.5 ? ['Low combined expected goals'] : [],
        },
        {
            market: 'UNDER_2_5',
            label: 'Total Goals',
            selection: 'Under 2.5 Goals',
            rawProb: probUnder25,
            prior: LEAGUE_PRIORS.UNDER_2_5,
            extraRisks: dcResult.homeExpectedGoals + dcResult.awayExpectedGoals > 2.8 ? ['High offensive output teams'] : [],
        },
        {
            market: 'OVER_3_5',
            label: 'Total Goals',
            selection: 'Over 3.5 Goals',
            rawProb: probOver35,
            prior: LEAGUE_PRIORS.OVER_3_5,
            extraRisks: ['Requires 4+ goals; high tail risk'],
        },
        {
            market: 'UNDER_3_5',
            label: 'Total Goals',
            selection: 'Under 3.5 Goals',
            rawProb: probUnder35,
            prior: LEAGUE_PRIORS.UNDER_3_5,
            extraRisks: [],
        },
        {
            market: 'BTTS_YES',
            label: 'Both Teams to Score',
            selection: 'Both Teams to Score - Yes',
            rawProb: probBttsYes,
            prior: LEAGUE_PRIORS.BTTS_YES,
            extraRisks: supportingStats.cleanSheetRateHome > 0.40 ? ['Home team has strong clean sheet record'] : [],
        },
        {
            market: 'BTTS_NO',
            label: 'Both Teams to Score',
            selection: 'Both Teams to Score - No',
            rawProb: probBttsNo,
            prior: LEAGUE_PRIORS.BTTS_NO,
            extraRisks: [],
        },
        {
            market: 'HOME_OVER_0_5',
            label: 'Team Total Goals',
            selection: `${fixture.homeTeam.shortName} Over 0.5 Goals`,
            rawProb: probHomeOver05,
            prior: LEAGUE_PRIORS.HOME_OVER_0_5,
            extraRisks: [],
        },
        {
            market: 'AWAY_OVER_0_5',
            label: 'Team Total Goals',
            selection: `${fixture.awayTeam.shortName} Over 0.5 Goals`,
            rawProb: probAwayOver05,
            prior: LEAGUE_PRIORS.AWAY_OVER_0_5,
            extraRisks: [],
        },
        {
            market: 'HT_OVER_0_5',
            label: 'First Half Goals',
            selection: 'First Half Over 0.5 Goals',
            rawProb: probHtOver05,
            prior: LEAGUE_PRIORS.HT_OVER_0_5,
            extraRisks: ['Matches can have cagey opening 45 minutes'],
        },
        {
            market: 'HT_DRAW',
            label: 'First Half Result',
            selection: 'First Half Draw',
            rawProb: probHtDraw,
            prior: LEAGUE_PRIORS.HT_DRAW,
            extraRisks: ['Early goal disrupts selection immediately'],
        },
        {
            market: 'OVER_0_5',
            label: 'Total Goals',
            selection: 'Over 0.5 Goals',
            rawProb: probOver05,
            prior: LEAGUE_PRIORS.OVER_0_5,
            extraRisks: ['Extremely rare 0-0 goalless draw would void selection'],
        },
        {
            market: 'OVER_5_5_CORNERS',
            label: 'Match Corners',
            selection: 'Over 5.5 Corners',
            rawProb: probOver55Corners,
            prior: LEAGUE_PRIORS.OVER_5_5_CORNERS,
            extraRisks: [],
        },
        {
            market: 'OVER_7_5_CORNERS',
            label: 'Match Corners',
            selection: 'Over 7.5 Corners',
            rawProb: probOver75Corners,
            prior: LEAGUE_PRIORS.OVER_7_5_CORNERS,
            extraRisks: [],
        },
        {
            market: 'OVER_8_5_CORNERS',
            label: 'Match Corners',
            selection: 'Over 8.5 Corners',
            rawProb: probOver85Corners,
            prior: LEAGUE_PRIORS.OVER_8_5_CORNERS,
            extraRisks: [],
        },
        {
            market: 'UNDER_11_5_CORNERS',
            label: 'Match Corners',
            selection: 'Under 11.5 Corners',
            rawProb: probUnder115Corners,
            prior: LEAGUE_PRIORS.UNDER_11_5_CORNERS,
            extraRisks: [],
        },
        {
            market: 'OVER_2_5_CARDS',
            label: 'Match Cards',
            selection: 'Over 2.5 Total Cards',
            rawProb: probOver25Cards,
            prior: LEAGUE_PRIORS.OVER_2_5_CARDS,
            extraRisks: [],
        },
        {
            market: 'OVER_3_5_CARDS',
            label: 'Match Cards',
            selection: 'Over 3.5 Total Cards',
            rawProb: probOver35Cards,
            prior: LEAGUE_PRIORS.OVER_3_5_CARDS,
            extraRisks: ['Requires high match intensity or strict referee'],
        },
        {
            market: 'UNDER_5_5_CARDS',
            label: 'Match Cards',
            selection: 'Under 5.5 Total Cards',
            rawProb: probUnder55Cards,
            prior: LEAGUE_PRIORS.UNDER_5_5_CARDS,
            extraRisks: [],
        },
    ];
    return rawMarkets.map((item, index) => {
        const calibrated = calibrateProbability(item.rawProb, item.prior, sampleSize);
        const combinedRisks = [...riskFactors, ...item.extraRisks];
        return {
            id: `${fixture.id}-${item.market}`,
            fixtureId: fixture.id,
            league: fixture.league,
            fixtureDescription: `${fixture.homeTeam.name} vs ${fixture.awayTeam.name}`,
            kickoff: fixture.kickoffTime,
            market: item.market,
            marketLabel: item.label,
            selection: item.selection,
            estimatedProbability: calibrated.calibrated,
            rawProbability: calibrated.raw,
            confidenceLower: calibrated.lowerBound,
            confidenceUpper: calibrated.upperBound,
            supportingStatistics: supportingStats,
            sampleSize,
            dataFreshnessDays,
            riskFactors: combinedRisks,
            actualOutcome: fixture.status === 'FINISHED' ? evaluateActualOutcome(item.market, fixture) : 'PENDING',
        };
    });
}
/**
 * Checks if a market prediction was a hit or miss based on final finished fixture score and stats
 */
export function evaluateActualOutcome(market, fixture) {
    if (fixture.homeScore === null || fixture.awayScore === null)
        return 'PENDING';
    const h = fixture.homeScore;
    const a = fixture.awayScore;
    const total = h + a;
    const stats = fixture.statistics;
    const totalCorners = (stats?.cornersHome ?? null) !== null && (stats?.cornersAway ?? null) !== null
        ? (stats.cornersHome + stats.cornersAway)
        : null;
    const totalCards = (stats?.yellowCardsHome ?? null) !== null && (stats?.yellowCardsAway ?? null) !== null
        ? (stats.yellowCardsHome + stats.yellowCardsAway + (stats.redCardsHome ?? 0) + (stats.redCardsAway ?? 0))
        : null;
    switch (market) {
        case 'HOME_WIN': return h > a ? 'HIT' : 'MISS';
        case 'DRAW': return h === a ? 'HIT' : 'MISS';
        case 'AWAY_WIN': return a > h ? 'HIT' : 'MISS';
        case 'DOUBLE_CHANCE_1X': return h >= a ? 'HIT' : 'MISS';
        case 'DOUBLE_CHANCE_X2': return a >= h ? 'HIT' : 'MISS';
        case 'DOUBLE_CHANCE_12': return h !== a ? 'HIT' : 'MISS';
        case 'OVER_0_5': return total >= 1 ? 'HIT' : 'MISS';
        case 'OVER_1_5': return total >= 2 ? 'HIT' : 'MISS';
        case 'OVER_2_5': return total >= 3 ? 'HIT' : 'MISS';
        case 'UNDER_2_5': return total <= 2 ? 'HIT' : 'MISS';
        case 'OVER_3_5': return total >= 4 ? 'HIT' : 'MISS';
        case 'UNDER_3_5': return total <= 3 ? 'HIT' : 'MISS';
        case 'BTTS_YES': return h > 0 && a > 0 ? 'HIT' : 'MISS';
        case 'BTTS_NO': return h === 0 || a === 0 ? 'HIT' : 'MISS';
        case 'HOME_OVER_0_5': return h >= 1 ? 'HIT' : 'MISS';
        case 'AWAY_OVER_0_5': return a >= 1 ? 'HIT' : 'MISS';
        case 'OVER_5_5_CORNERS': return totalCorners !== null ? (totalCorners >= 6 ? 'HIT' : 'MISS') : 'VOID';
        case 'OVER_7_5_CORNERS': return totalCorners !== null ? (totalCorners >= 8 ? 'HIT' : 'MISS') : 'VOID';
        case 'OVER_8_5_CORNERS': return totalCorners !== null ? (totalCorners >= 9 ? 'HIT' : 'MISS') : 'VOID';
        case 'UNDER_11_5_CORNERS': return totalCorners !== null ? (totalCorners <= 11 ? 'HIT' : 'MISS') : 'VOID';
        case 'OVER_2_5_CARDS': return totalCards !== null ? (totalCards >= 3 ? 'HIT' : 'MISS') : 'VOID';
        case 'OVER_3_5_CARDS': return totalCards !== null ? (totalCards >= 4 ? 'HIT' : 'MISS') : 'VOID';
        case 'UNDER_5_5_CARDS': return totalCards !== null ? (totalCards <= 5 ? 'HIT' : 'MISS') : 'VOID';
        case 'HT_OVER_0_5':
            if (fixture.htHomeScore === null || fixture.htAwayScore === null)
                return 'VOID';
            return (fixture.htHomeScore + fixture.htAwayScore) >= 1 ? 'HIT' : 'MISS';
        case 'HT_DRAW':
            if (fixture.htHomeScore === null || fixture.htAwayScore === null)
                return 'VOID';
            return fixture.htHomeScore === fixture.htAwayScore ? 'HIT' : 'MISS';
        default:
            return 'VOID';
    }
}
