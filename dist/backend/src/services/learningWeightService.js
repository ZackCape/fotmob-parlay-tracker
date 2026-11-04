/**
 * Cape Predictor — Learning Weight Service
 *
 * Implements a quantitative feedback loop that reads settled bets from
 * `data/settlement_ledger.json` over a rolling 30-day window, evaluates
 * historical hit-rates per market type and league, and scales model
 * selection probabilities via confidence multipliers [0.85 .. 1.15].
 */
import fs from 'node:fs';
import path from 'node:path';
// ---------------------------------------------------------------------------
// Constants & Configuration
// ---------------------------------------------------------------------------
const DEFAULT_DATA_DIR = path.resolve(process.cwd(), 'data');
const DEFAULT_LEDGER_PATH = path.join(DEFAULT_DATA_DIR, 'settlement_ledger.json');
export const ROLLING_WINDOW_DAYS = 30;
export const ROLLING_WINDOW_MS = ROLLING_WINDOW_DAYS * 24 * 60 * 60 * 1000;
export const MIN_CONFIDENCE_MULTIPLIER = 0.85;
export const MAX_CONFIDENCE_MULTIPLIER = 1.15;
export const NEUTRAL_CONFIDENCE_MULTIPLIER = 1.00;
/** Baseline expected benchmark hit-rate for qualified model candidates (65%). */
const BENCHMARK_HIT_RATE = 0.65;
/** Bayesian prior sample weight for smoothing low-sample noise. */
const BAYESIAN_PRIOR_WEIGHT = 2.0;
/** Sensitivity scale translating delta-from-benchmark into multiplier deviation. */
const MULTIPLIER_SENSITIVITY = 0.65;
// ---------------------------------------------------------------------------
// State & Cache
// ---------------------------------------------------------------------------
let ledgerFilePath = DEFAULT_LEDGER_PATH;
let mockLedgerData = null;
let cachedMtime = -1;
let cachedSummary = null;
// ---------------------------------------------------------------------------
// Market Normalisation Helpers
// ---------------------------------------------------------------------------
/**
 * Normalise raw market strings into high-level market categories:
 * - '1X2'
 * - 'BTTS'
 * - 'OVER_UNDER_GOALS'
 * - 'CORNERS'
 * - 'CARDS'
 * - 'DOUBLE_CHANCE'
 * - 'TEAM_TOTAL'
 * - 'HT_MARKETS'
 */
export function normalizeMarketType(market) {
    if (!market)
        return 'UNKNOWN';
    const m = market.toUpperCase().trim();
    // 1X2 / Match Winner
    if (m === '1X2' ||
        m === 'HOME_WIN' ||
        m === 'DRAW' ||
        m === 'AWAY_WIN' ||
        m === 'MATCH_WINNER' ||
        m === 'FULL_TIME_RESULT') {
        return '1X2';
    }
    // BTTS
    if (m.startsWith('BTTS') || m.includes('BOTH_TEAMS_TO_SCORE')) {
        return 'BTTS';
    }
    // Double Chance
    if (m.startsWith('DOUBLE_CHANCE')) {
        return 'DOUBLE_CHANCE';
    }
    // Corners
    if (m.includes('CORNER')) {
        return 'CORNERS';
    }
    // Cards
    if (m.includes('CARD')) {
        return 'CARDS';
    }
    // Team Totals
    if (m.startsWith('HOME_OVER_') || m.startsWith('AWAY_OVER_') || m.startsWith('TEAM_TOTAL')) {
        return 'TEAM_TOTAL';
    }
    // Halftime
    if (m.startsWith('HT_') || m.includes('HALF_TIME')) {
        return 'HT_MARKETS';
    }
    // Over / Under Goals
    if (m.startsWith('OVER_') ||
        m.startsWith('UNDER_') ||
        m.includes('GOALS') ||
        m === 'OVER_UNDER' ||
        m === 'TOTAL_GOALS') {
        return 'OVER_UNDER_GOALS';
    }
    return m;
}
// ---------------------------------------------------------------------------
// Ledger Parsing & Rolling Aggregation
// ---------------------------------------------------------------------------
function emptyBucket() {
    return {
        hits: 0,
        misses: 0,
        voids: 0,
        total: 0,
        hitRate: BENCHMARK_HIT_RATE,
    };
}
function updateBucket(bucket, result) {
    if (result === 'HIT') {
        bucket.hits++;
        bucket.total++;
    }
    else if (result === 'MISS') {
        bucket.misses++;
        bucket.total++;
    }
    else if (result === 'VOID') {
        bucket.voids++;
    }
    bucket.hitRate = bucket.total > 0 ? bucket.hits / bucket.total : BENCHMARK_HIT_RATE;
}
/**
 * Read the ledger content from either in-memory mock or disk.
 */
function readLedgerContent() {
    if (mockLedgerData) {
        return { content: mockLedgerData, mtime: 9999999999 };
    }
    try {
        if (!fs.existsSync(ledgerFilePath)) {
            return { content: null, mtime: 0 };
        }
        const stat = fs.statSync(ledgerFilePath);
        if (stat.mtimeMs === cachedMtime && cachedSummary) {
            return { content: null, mtime: stat.mtimeMs }; // Cache still valid
        }
        const raw = fs.readFileSync(ledgerFilePath, 'utf8');
        const parsed = JSON.parse(raw);
        const content = Array.isArray(parsed) ? { slips: parsed } : parsed;
        return { content, mtime: stat.mtimeMs };
    }
    catch (err) {
        console.warn('[LearningWeightService] Error reading settlement ledger:', err);
        return { content: null, mtime: 0 };
    }
}
/**
 * Calculate rolling market accuracy across all market types and leagues
 * for the configured rolling window (default 30 days).
 */
export function calculateRollingMarketAccuracy(options) {
    const windowDays = options?.days ?? ROLLING_WINDOW_DAYS;
    const now = options?.referenceTime ?? Date.now();
    const cutoff = now - windowDays * 24 * 60 * 60 * 1000;
    const { content, mtime } = readLedgerContent();
    if (!content && cachedSummary && mtime === cachedMtime && !options?.days && !options?.referenceTime) {
        return cachedSummary;
    }
    const summary = {
        windowDays,
        cutoffTimestamp: cutoff,
        totalSettledLegs: 0,
        marketTypes: {},
        exactMarkets: {},
        leagues: {},
        combos: {},
    };
    const slips = Array.isArray(content?.slips) ? content.slips : [];
    for (const slip of slips) {
        if (!slip)
            continue;
        // Check settlement timestamp
        let settledTime = 0;
        if (typeof slip.settledAt === 'number') {
            settledTime = slip.settledAt < 1e11 ? slip.settledAt * 1000 : slip.settledAt;
        }
        else if (typeof slip.settledAt === 'string') {
            const parsed = Date.parse(slip.settledAt);
            settledTime = Number.isNaN(parsed) ? now : parsed;
        }
        else {
            settledTime = now;
        }
        if (settledTime < cutoff) {
            continue; // Outside rolling 30-day window
        }
        // Extract constituent legs
        const legs = [];
        if (Array.isArray(slip.legs)) {
            for (const leg of slip.legs) {
                if (!leg)
                    continue;
                const resStr = (leg.result || '').toUpperCase();
                const outcome = resStr === 'HIT' || resStr === 'WON'
                    ? 'HIT'
                    : resStr === 'MISS' || resStr === 'LOST'
                        ? 'MISS'
                        : 'VOID';
                const market = leg.market || (leg.key ? leg.key.split(':')[1] : '');
                const league = leg.league || slip.league;
                if (market)
                    legs.push({ market, league, result: outcome });
            }
        }
        if (Array.isArray(slip.legOutcomes)) {
            for (const out of slip.legOutcomes) {
                if (!out)
                    continue;
                const resStr = (out.result || '').toUpperCase();
                const outcome = resStr === 'HIT' || resStr === 'WON'
                    ? 'HIT'
                    : resStr === 'MISS' || resStr === 'LOST'
                        ? 'MISS'
                        : 'VOID';
                const market = out.market || (out.key ? out.key.split(':')[1] : '');
                const league = out.league || slip.league;
                if (market)
                    legs.push({ market, league, result: outcome });
            }
        }
        // Accumulate each leg's outcome into category, exact, league, and combo buckets
        for (const leg of legs) {
            const exactM = (leg.market || '').toUpperCase().trim();
            if (!exactM)
                continue;
            const normType = normalizeMarketType(exactM);
            const leagueKey = (leg.league || 'ALL').toUpperCase().trim();
            const comboKey = `${normType}:${leagueKey}`;
            if (!summary.exactMarkets[exactM])
                summary.exactMarkets[exactM] = emptyBucket();
            if (!summary.marketTypes[normType])
                summary.marketTypes[normType] = emptyBucket();
            if (!summary.leagues[leagueKey])
                summary.leagues[leagueKey] = emptyBucket();
            if (!summary.combos[comboKey])
                summary.combos[comboKey] = emptyBucket();
            updateBucket(summary.exactMarkets[exactM], leg.result);
            updateBucket(summary.marketTypes[normType], leg.result);
            updateBucket(summary.leagues[leagueKey], leg.result);
            updateBucket(summary.combos[comboKey], leg.result);
            if (leg.result !== 'VOID') {
                summary.totalSettledLegs++;
            }
        }
    }
    // Update in-memory cache if standard window
    if (!options?.days && !options?.referenceTime) {
        cachedSummary = summary;
        cachedMtime = mtime;
    }
    return summary;
}
// ---------------------------------------------------------------------------
// Multiplier Calculation
// ---------------------------------------------------------------------------
/**
 * Quantitative multiplier calculation using Bayesian shrinkage:
 *
 * p_hat = (hits + M * p_0) / (total + M)
 * delta = p_hat - p_0
 * multiplier = 1.0 + delta * SENSITIVITY
 *
 * When total == 0 -> multiplier = 1.00 (neutral)
 * When hit-rate > benchmark -> multiplier > 1.00 (up to 1.15)
 * When hit-rate < benchmark -> multiplier < 1.00 (down to 0.85)
 */
function calculateBucketMultiplier(bucket) {
    if (!bucket || bucket.total === 0) {
        return NEUTRAL_CONFIDENCE_MULTIPLIER;
    }
    const smoothedP = (bucket.hits + BAYESIAN_PRIOR_WEIGHT * BENCHMARK_HIT_RATE) /
        (bucket.total + BAYESIAN_PRIOR_WEIGHT);
    const delta = smoothedP - BENCHMARK_HIT_RATE;
    const rawMult = NEUTRAL_CONFIDENCE_MULTIPLIER + delta * MULTIPLIER_SENSITIVITY;
    return Math.min(MAX_CONFIDENCE_MULTIPLIER, Math.max(MIN_CONFIDENCE_MULTIPLIER, Number(rawMult.toFixed(4))));
}
/**
 * Exported API: Returns a confidence multiplier [0.85 .. 1.15] for a given
 * market and optional leagueId based on rolling 30-day settlement accuracy.
 *
 * @param market - Market type (e.g. '1X2', 'BTTS_YES', 'OVER_2_5', 'CORNERS')
 * @param leagueId - Optional league identifier (e.g. 'PL', 'CHAM', 'CL', 'BL1')
 * @returns number between 0.85 and 1.15
 */
export function getMarketConfidenceMultiplier(market, leagueId) {
    if (!market)
        return NEUTRAL_CONFIDENCE_MULTIPLIER;
    const summary = calculateRollingMarketAccuracy();
    const exactM = market.toUpperCase().trim();
    const normType = normalizeMarketType(exactM);
    const leagueKey = (leagueId || 'ALL').toUpperCase().trim();
    const comboKey = `${normType}:${leagueKey}`;
    const exactBucket = summary.exactMarkets[exactM];
    const typeBucket = summary.marketTypes[normType];
    const leagueBucket = leagueId ? summary.leagues[leagueKey] : undefined;
    const comboBucket = leagueId ? summary.combos[comboKey] : undefined;
    // 1. Combo specific (Market + League) with sufficient data
    if (comboBucket && comboBucket.total >= 3) {
        return calculateBucketMultiplier(comboBucket);
    }
    // 2. Exact market if available
    const exactMult = exactBucket && exactBucket.total > 0
        ? calculateBucketMultiplier(exactBucket)
        : null;
    // 3. Market category multiplier
    const typeMult = typeBucket && typeBucket.total > 0
        ? calculateBucketMultiplier(typeBucket)
        : NEUTRAL_CONFIDENCE_MULTIPLIER;
    // Base market multiplier (exact preferred if available, else category)
    const marketMult = exactMult !== null ? exactMult : typeMult;
    // 4. If league has distinct performance, blend with 30% league weight
    if (leagueBucket && leagueBucket.total >= 3) {
        const leagueMult = calculateBucketMultiplier(leagueBucket);
        const blended = 0.70 * marketMult + 0.30 * leagueMult;
        return Math.min(MAX_CONFIDENCE_MULTIPLIER, Math.max(MIN_CONFIDENCE_MULTIPLIER, Number(blended.toFixed(4))));
    }
    return marketMult;
}
/**
 * Diagnostic helper: Returns detailed statistics for a market and league.
 */
export function getMarketStats(market, leagueId) {
    const summary = calculateRollingMarketAccuracy();
    const exactM = (market || '').toUpperCase().trim();
    const normType = normalizeMarketType(exactM);
    const typeBucket = summary.marketTypes[normType] || emptyBucket();
    const multiplier = getMarketConfidenceMultiplier(market, leagueId);
    return {
        market: exactM,
        normalizedType: normType,
        league: leagueId,
        total: typeBucket.total,
        hits: typeBucket.hits,
        misses: typeBucket.misses,
        hitRate: Number((typeBucket.hitRate * 100).toFixed(1)),
        multiplier,
    };
}
// ---------------------------------------------------------------------------
// Testing & Cache Invalidation Utilities
// ---------------------------------------------------------------------------
/** Reset in-memory cache forcing reload on next read. */
export function clearLearningWeightCache() {
    cachedSummary = null;
    cachedMtime = -1;
}
/** Reset mock data back to reading from disk. */
export function resetMockSettlementLedger() {
    mockLedgerData = null;
    cachedSummary = null;
    cachedMtime = -1;
}
/** Point the service to an alternative ledger file path (e.g. for testing). */
export function setSettlementLedgerPath(filePath) {
    ledgerFilePath = filePath;
    clearLearningWeightCache();
}
/** Restore default production ledger path. */
export function resetSettlementLedgerPath() {
    ledgerFilePath = DEFAULT_LEDGER_PATH;
    clearLearningWeightCache();
}
/** Inject mock ledger data directly into memory without disk I/O. */
export function setMockSettlementLedger(data) {
    mockLedgerData = data;
    cachedSummary = null;
    cachedMtime = -1;
}
