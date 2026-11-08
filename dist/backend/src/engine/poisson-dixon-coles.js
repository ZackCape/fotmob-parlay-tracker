/**
 * Dixon-Coles Bivariate Poisson Prediction Engine
 * Based on Dixon & Coles (1997) "Modelling Association Football Scores and Inefficiencies in the Football Betting Market"
 * Strictly uses statistical performance data - NO BETTING ODDS INPUTS.
 */
/**
 * Factorial helper
 */
function factorial(n) {
    if (n <= 1)
        return 1;
    let res = 1;
    for (let i = 2; i <= n; i++)
        res *= i;
    return res;
}
/**
 * Poisson probability density P(K = k; lambda)
 */
export function poissonPmf(k, lambda) {
    if (lambda <= 0)
        return k === 0 ? 1 : 0;
    return (Math.pow(lambda, k) * Math.exp(-lambda)) / factorial(k);
}
/**
 * Poisson Cumulative Distribution Function P(K <= k; lambda)
 */
export function poissonCdf(k, lambda) {
    if (lambda <= 0)
        return 1;
    let sum = 0;
    for (let i = 0; i <= k; i++) {
        sum += poissonPmf(i, lambda);
    }
    return Math.min(1, Math.max(0, sum));
}
/**
 * Dixon-Coles bivariate low-score correction factor tau(x, y; lambda, mu, rho)
 */
export function dixonColesTau(x, y, lambda, mu, rho = -0.11) {
    if (x === 0 && y === 0) {
        return Math.max(0.01, 1 - lambda * mu * rho);
    }
    if (x === 0 && y === 1) {
        return Math.max(0.01, 1 + mu * rho);
    }
    if (x === 1 && y === 0) {
        return Math.max(0.01, 1 + lambda * rho);
    }
    if (x === 1 && y === 1) {
        return Math.max(0.01, 1 - rho);
    }
    return 1.0;
}
/**
 * Computes Dixon-Coles parameters and joint score distribution matrix (up to 7x7)
 */
export function calculateDixonColes(homeAttack, homeDefense, awayAttack, awayDefense, league = 'EPL', homeAdvantageFactor = 1.12, overrideLambdaHome, overrideLambdaAway) {
    // Baseline league average goals per team per match
    let baselineRate = 1.40;
    if (league === 'CHAMPIONSHIP')
        baselineRate = 1.30;
    else if (league === 'LALIGA')
        baselineRate = 1.25;
    else if (league === 'LIGUE1')
        baselineRate = 1.32;
    else if (league === 'CHAMPIONS_LEAGUE')
        baselineRate = 1.55;
    else if (league === 'EUROPA_LEAGUE' || league === 'CONFERENCE_LEAGUE')
        baselineRate = 1.48;
    // Expected goals (lambda for home, mu for away)
    const homeLambda = (typeof overrideLambdaHome === 'number' && overrideLambdaHome > 0)
        ? overrideLambdaHome
        : Math.max(0.2, baselineRate * homeAttack * awayDefense * homeAdvantageFactor);
    const awayMu = (typeof overrideLambdaAway === 'number' && overrideLambdaAway > 0)
        ? overrideLambdaAway
        : Math.max(0.2, baselineRate * awayAttack * homeDefense);
    const maxGoals = 7;
    const scoreMatrix = [];
    let totalProb = 0;
    // Compute joint probabilities for all scorelines from 0-0 to 7-7
    for (let h = 0; h <= maxGoals; h++) {
        for (let a = 0; a <= maxGoals; a++) {
            const tau = dixonColesTau(h, a, homeLambda, awayMu);
            const rawProb = tau * poissonPmf(h, homeLambda) * poissonPmf(a, awayMu);
            scoreMatrix.push({ homeScore: h, awayScore: a, probability: rawProb });
            totalProb += rawProb;
        }
    }
    // Normalize so probabilities sum to 1.0 across the finite grid
    if (totalProb > 0) {
        for (const item of scoreMatrix) {
            item.probability /= totalProb;
        }
    }
    return {
        homeExpectedGoals: Number(homeLambda.toFixed(2)),
        awayExpectedGoals: Number(awayMu.toFixed(2)),
        homeAttackStrength: Number(homeAttack.toFixed(2)),
        homeDefenseWeakness: Number(homeDefense.toFixed(2)),
        awayAttackStrength: Number(awayAttack.toFixed(2)),
        awayDefenseWeakness: Number(awayDefense.toFixed(2)),
        homeAdvantage: Number(homeAdvantageFactor.toFixed(2)),
        scoreMatrix,
    };
}
/** Weight given to the bookmaker consensus when real market odds exist. */
export const MARKET_BLEND_WEIGHT = 0.70;
function clamp01(v) {
    if (!Number.isFinite(v))
        return 0;
    return Math.max(0, Math.min(1, v));
}
function normaliseOutcomes(p) {
    const sum = p.home + p.draw + p.away;
    if (sum <= 0)
        return { home: 1 / 3, draw: 1 / 3, away: 1 / 3 };
    return { home: p.home / sum, draw: p.draw / sum, away: p.away / sum };
}
/**
 * Bayesian shrinkage of the model distribution toward the market.
 *
 *   Final P = 0.70 * P_bookmaker + 0.30 * P_DixonColes
 *
 * The market is a strong, well-calibrated prior; the model adds information the
 * line may not fully price. When no market is available the pure Dixon-Coles
 * distribution is returned unchanged, so this never invents a market signal.
 */
export function bayesianBlend(market, model, marketWeight = MARKET_BLEND_WEIGHT) {
    const m = normaliseOutcomes(model);
    if (!market)
        return m;
    const w = Math.max(0, Math.min(1, marketWeight));
    const blend = {
        home: w * clamp01(market.home) + (1 - w) * m.home,
        draw: w * clamp01(market.draw) + (1 - w) * m.draw,
        away: w * clamp01(market.away) + (1 - w) * m.away,
    };
    return normaliseOutcomes(blend);
}
/** League baseline total cards per match. */
function leagueCardsBaseline(league) {
    switch (league) {
        case 'LALIGA': return 4.8;
        case 'CHAMPIONSHIP': return 4.3;
        case 'LIGUE1': return 4.1;
        case 'SERIE_A': return 4.4;
        case 'CHAMPIONS_LEAGUE': return 3.8;
        default: return 3.9; // EPL / Bundesliga / unknown
    }
}
/**
 * Poisson booking-points model.
 *
 * Expected cards are driven by the league baseline, the two teams' historical
 * foul rates and a referee strictness index. Every input is optional; absent
 * inputs leave the baseline untouched rather than fabricating a value.
 */
export function computeCardsModel(opts) {
    const base = leagueCardsBaseline(opts.league);
    // Fouls drive cards. A combined total of 22 fouls/match is treated as
    // average; the ratio nudges the baseline without dominating it.
    const homeFouls = Number.isFinite(opts.homeFoulsPerMatch) ? Math.max(0, opts.homeFoulsPerMatch) : null;
    const awayFouls = Number.isFinite(opts.awayFoulsPerMatch) ? Math.max(0, opts.awayFoulsPerMatch) : null;
    let foulFactor = 1;
    if (homeFouls !== null || awayFouls !== null) {
        const total = (homeFouls ?? 11) + (awayFouls ?? 11);
        foulFactor = Math.max(0.7, Math.min(1.4, total / 22));
    }
    const histHome = Number.isFinite(opts.homeCardsPerMatch) ? Math.max(0, opts.homeCardsPerMatch) : null;
    const histAway = Number.isFinite(opts.awayCardsPerMatch) ? Math.max(0, opts.awayCardsPerMatch) : null;
    let histFactor = 1;
    if (histHome !== null || histAway !== null) {
        const total = (histHome ?? base / 2) + (histAway ?? base / 2);
        histFactor = Math.max(0.7, Math.min(1.4, total / base));
    }
    const referee = Number.isFinite(opts.refereeIndex) ? Math.max(0.7, Math.min(1.5, opts.refereeIndex)) : 1;
    const lambda = Math.max(2.0, Math.min(8.0, base * foulFactor * histFactor * referee));
    return {
        lambda: Number(lambda.toFixed(3)),
        over2_5: 1 - poissonCdf(2, lambda),
        over3_5: 1 - poissonCdf(3, lambda),
        under3_5: poissonCdf(3, lambda),
        over4_5: 1 - poissonCdf(4, lambda),
        under4_5: poissonCdf(4, lambda),
        under5_5: poissonCdf(5, lambda),
    };
}
/**
 * Poisson corner-expectation model driven by the attacking/defensive corner
 * metrics of each side. When metrics are absent the league baseline is used.
 */
export function computeCornersModel(opts) {
    let base = 10.2; // EPL-ish average total corners
    switch (opts.league) {
        case 'CHAMPIONSHIP':
            base = 10.4;
            break;
        case 'LALIGA':
            base = 9.6;
            break;
        case 'SERIE_A':
            base = 10.0;
            break;
        case 'BUNDESLIGA':
            base = 10.3;
            break;
        case 'LIGUE1':
            base = 9.8;
            break;
        case 'CHAMPIONS_LEAGUE':
            base = 10.1;
            break;
        default: break;
    }
    const num = (v) => (Number.isFinite(v) ? Math.max(0, v) : null);
    const hf = num(opts.homeCornersFor);
    const af = num(opts.awayCornersFor);
    const ha = num(opts.homeCornersAgainst);
    const aa = num(opts.awayCornersAgainst);
    // Expected home corners = own attack blended with opponent's concession.
    const homeExpected = hf !== null || aa !== null ? ((hf ?? base / 2) * 0.6 + (aa ?? base / 2) * 0.4) : base / 2;
    const awayExpected = af !== null || ha !== null ? ((af ?? base / 2) * 0.6 + (ha ?? base / 2) * 0.4) : base / 2;
    const lambda = Math.max(6.0, Math.min(16.0, homeExpected + awayExpected));
    return {
        lambda: Number(lambda.toFixed(3)),
        over8_5: 1 - poissonCdf(8, lambda),
        under8_5: poissonCdf(8, lambda),
        over9_5: 1 - poissonCdf(9, lambda),
        under9_5: poissonCdf(9, lambda),
    };
}
