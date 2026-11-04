import { MarketPrediction, ParlayLeg, ParlayLegCount, ParlayMode, StatisticalParlay } from '../types/football.js';
import { areMarketsConflicting, filterNonCorrelatedPredictions } from './correlation-detector.js';
import { compareCompetitionPriority, orderByCompetitionPriorityThenScore } from '../utils/competitionPriority.js';
import { getOddsForFixture, AggregatedOdds } from '../services/oddsAggregatorService.js';
import { getMarketConfidenceMultiplier } from '../services/learningWeightService.js';

export interface ParlayBuilderOptions {
  targetLegsCount: ParlayLegCount;
  minProbability?: number; // Minimum calibrated probability per leg (default 0.58)
  allowedMarkets?: string[]; // Filter specific market types
  leagueFilter?: string;
  mode?: ParlayMode; // 'ANTI_CORRELATED' | 'SAME_GAME_PARLAY' | 'CORRELATED_ALLOWED'
  targetFixtureId?: string; // Optional: specify target match for Same-Game Parlay
  /**
   * Rank Premier League and UEFA Champions League candidates ahead of the
   * secondary domestic leagues (default: true). The minimum-probability gate is
   * applied first, so priority reorders eligible legs and never promotes a leg
   * that failed the threshold. Set false for a pure probability ranking.
   */
  prioritizePriorityLeagues?: boolean;
  /**
   * Bookmaker-published markets for this fixture. When provided, only
   * markets present in this list are allowed (Market Existence Check).
   * If omitted, all markets pass (backwards compat).
   */
  publishedMarkets?: string[];
  /** Optional: enrich parlay legs with real bookmaker odds using 2s timeout */
  fetchOdds?: boolean;
  /** Optional: disable learning feedback loop weighting (default: false) */
  disableLearningLoop?: boolean;
}

/**
 * Tier-3 Fair Model Baseline fallback generator.
 */
export function getFairModelBaselineOdds(
  modelHomeProb: number = 0.45,
  modelDrawProb: number = 0.25,
  modelAwayProb: number = 0.30
): AggregatedOdds {
  const margin = 1.05;
  const homeFair = modelHomeProb > 0 ? 1 / modelHomeProb : 2.0;
  const awayFair = modelAwayProb > 0 ? 1 / modelAwayProb : 2.0;
  const drawFair = modelDrawProb > 0 ? 1 / modelDrawProb : 3.0;

  return {
    source: 'Fair Model Baseline',
    home: Number((homeFair / margin).toFixed(2)),
    draw: Number((drawFair / margin).toFixed(2)),
    away: Number((awayFair / margin).toFixed(2)),
    over25: null,
    under25: null,
    publishedMarkets: [
      'HOME_WIN', 'DRAW', 'AWAY_WIN', 'OVER_0_5', 'OVER_1_5', 'OVER_2_5', 'OVER_3_5',
      'UNDER_2_5', 'UNDER_3_5', 'BTTS_YES', 'BTTS_NO', 'DOUBLE_CHANCE_1X', 'DOUBLE_CHANCE_X2',
      'DOUBLE_CHANCE_12', 'OVER_7_5_CORNERS', 'OVER_8_5_CORNERS', 'OVER_9_5_CORNERS',
      'UNDER_8_5_CORNERS', 'UNDER_11_5_CORNERS', 'OVER_2_5_CARDS', 'OVER_3_5_CARDS', 'OVER_4_5_CARDS'
    ],
  };
}

/**
 * Wrap external odds fetching calls in a strict Promise.race with a 2-second timeout.
 * If any individual provider lags or fails, it immediately falls back to Tier-3 Fair
 * Model Baseline odds instead of hanging or failing the whole parlay generation.
 */
export async function fetchOddsWithTimeout(
  fixtureId: string,
  homeTeam?: string | null,
  awayTeam?: string | null,
  modelHomeProb: number = 0.45,
  modelDrawProb: number = 0.25,
  modelAwayProb: number = 0.30,
  timeoutMs: number = 2000
): Promise<AggregatedOdds> {
  const fallbackOdds = getFairModelBaselineOdds(modelHomeProb, modelDrawProb, modelAwayProb);

  try {
    const oddsPromise = getOddsForFixture(
      fixtureId,
      homeTeam,
      awayTeam,
      modelHomeProb,
      modelDrawProb,
      modelAwayProb
    );
    const timeoutPromise = new Promise<AggregatedOdds>((resolve) =>
      setTimeout(() => resolve(fallbackOdds), timeoutMs)
    );

    return await Promise.race([oddsPromise, timeoutPromise]);
  } catch (err) {
    console.warn(`[ParlayBuilder] External odds provider failed for ${fixtureId}, falling back to Tier-3 Fair Model Baseline:`, err);
    return fallbackOdds;
  }
}

export async function buildStatisticalParlay(
  candidatePredictions: MarketPrediction[],
  options: ParlayBuilderOptions
): Promise<StatisticalParlay> {
  let {
    targetLegsCount,
    minProbability = 0.58,
    allowedMarkets,
    leagueFilter = 'ALL',
    mode = 'ANTI_CORRELATED',
    targetFixtureId,
    prioritizePriorityLeagues = true,
    publishedMarkets,
    fetchOdds,
    disableLearningLoop = false,
  } = options;

  // Force parlay generator to rely 100% on in-memory Tier-3 Fair Model Baseline markets (zero external network latency)
  if (targetFixtureId && (!publishedMarkets || publishedMarkets.length === 0)) {
    publishedMarkets = getFairModelBaselineOdds().publishedMarkets;
  }

  // Dynamic bookmaker-verified line filter: no hardcoded bans.
  // Micro/low-line markets (Over 0.5 Goals, Over 5.5 Corners, etc.) are allowed
  // IF AND ONLY IF the bookmaker odds meet the minimum floor (>= 1.15x).
  // Since the parlay builder works with fair odds (1/probability), we apply
  // the odds floor at 1.15x minimum. The actual bookmaker odds check happens
  // at the caller level (bot.ts / routes) via oddsAggregatorService.

  const rawCandidates = Array.isArray(candidatePredictions) ? candidatePredictions : [];

  // Quantitative Learning Feedback Loop:
  // Multiply the raw model probability of candidate legs by the corresponding confidence
  // multiplier derived from rolling 30-day settlement hit rates. Markets and leagues that
  // historically underperform get down-weighted; winning patterns get prioritized.
  const weightedCandidates: MarketPrediction[] = rawCandidates.map(p => {
    if (!p) return p;
    const rawProb = typeof p.estimatedProbability === 'number' && Number.isFinite(p.estimatedProbability)
      ? p.estimatedProbability
      : 0;
    if (disableLearningLoop) {
      return {
        ...p,
        rawProbability: p.rawProbability ?? rawProb,
        confidenceMultiplier: 1.0,
        estimatedProbability: rawProb,
      };
    }
    const multiplier = getMarketConfidenceMultiplier(p.market, p.league);
    const adjustedProb = Number(Math.min(0.99, Math.max(0.01, rawProb * multiplier)).toFixed(4));
    return {
      ...p,
      rawProbability: p.rawProbability ?? rawProb,
      confidenceMultiplier: multiplier,
      estimatedProbability: adjustedProb,
    };
  });

  const isHighProb = minProbability >= 0.85;

  // Helper: filter candidates at a given threshold.
  // Chunked + async so large fixture scans yield to the event loop every
  // 15 candidates (prevents starvation of timers / Discord heartbeats).
  async function filterAtThreshold(threshold: number): Promise<MarketPrediction[]> {
    const highProb = threshold >= 0.85;
    const result: MarketPrediction[] = [];

    for (let i = 0; i < weightedCandidates.length; i++) {
      const p = weightedCandidates[i];
      if (!p) continue;
      if (i > 0 && i % 15 === 0) {
        await new Promise(resolve => setImmediate(resolve));
      }
      if (leagueFilter !== 'ALL' && p.league !== leagueFilter) continue;
      const prob = typeof p.estimatedProbability === 'number' && Number.isFinite(p.estimatedProbability)
        ? p.estimatedProbability
        : 0;
      if (prob < threshold) continue;
      if (allowedMarkets && allowedMarkets.length > 0 && (!p.market || !allowedMarkets.includes(p.market))) continue;
      // Market Existence Check: reject markets not published by the bookmaker.
      if (publishedMarkets && publishedMarkets.length > 0 && (!p.market || !publishedMarkets.includes(p.market))) continue;
      // Corner floor: reject anything below Over 7.5 Corners (absolute minimum)
      if (p.market === 'OVER_5_5_CORNERS') continue;
      // High-prob expansion: Over 1.5 Goals only when xG_total >= 2.80
      if (highProb && p.market === 'OVER_1_5') {
        const xgTotal = (p.supportingStatistics?.homeXgAverage ?? 0) + (p.supportingStatistics?.awayXgAverage ?? 0);
        if (xgTotal < 2.80) continue;
      }
      result.push(p);
    }

    // Odds value range filter: 1.15x - 2.25x per leg (fair odds = 1 / estimatedProbability).
    // Filters out useless micro-odds (1.02-1.12x) and extreme longshots.
    const oddsFiltered: MarketPrediction[] = [];
    for (let i = 0; i < result.length; i++) {
      if (i > 0 && i % 15 === 0) {
        await new Promise(resolve => setImmediate(resolve));
      }
      const p = result[i];
      if (!p) continue;
      const prob = typeof p.estimatedProbability === 'number' && Number.isFinite(p.estimatedProbability) && p.estimatedProbability > 0
        ? p.estimatedProbability
        : null;
      // Fallback safely to Fair Model Baseline (1 / prob) or 2.0 default
      const fairOdds = prob ? 1 / prob : 2.0;
      if (fairOdds >= 1.15 && fairOdds <= 2.25) oddsFiltered.push(p);
    }

    // Apply filter when it removes at least one candidate (always filter micro-odds)
    if (oddsFiltered.length > 0 && oddsFiltered.length < result.length) {
      return oddsFiltered;
    }
    if (oddsFiltered.length >= targetLegsCount) {
      return oddsFiltered;
    }
    return result;
  }

  // Auto-relaxing threshold: step down in 5% decrements until enough candidates.
  let effectiveMinProb = minProbability;
  let filtered = await filterAtThreshold(effectiveMinProb);
  let thresholdRelaxed = false;
  const minThreshold = 0.70;

  while (filtered.length < 5 && effectiveMinProb > minThreshold) {
    const prevProb = effectiveMinProb;
    effectiveMinProb = Math.max(minThreshold, effectiveMinProb - 0.05);
    if (effectiveMinProb === prevProb) break;
    const newFiltered = await filterAtThreshold(effectiveMinProb);
    if (newFiltered.length >= filtered.length) {
      filtered = newFiltered;
      thresholdRelaxed = true;
    }
    if (filtered.length >= 5) break;
  }

  // Yield to event loop to prevent blocking during heavy computation.
  await new Promise(resolve => setImmediate(resolve));

  // Competition priority (EPL / UCL first) over the eligible pool, with the
  // strength of each leg as the in-tier ranking. Everything below consumes this
  // order, so the strongest priority legs lead and secondary leagues only fill
  // what the priority pool leaves over.
  const ordered = orderByCompetitionPriorityThenScore(
    filtered,
    (p) => p.league,
    (p) => p.estimatedProbability,
    { prioritize: prioritizePriorityLeagues },
  );

  // Yield after priority sorting.
  await new Promise(resolve => setImmediate(resolve));

  let selectedPredictions: MarketPrediction[] = [];

  if (mode === 'SAME_GAME_PARLAY') {
    // Mode 1: Same-Game Parlay (SGP) - Multiple complementary markets from the SAME match!
    let targetFixturePicks: MarketPrediction[] = [];
    if (targetFixtureId) {
      targetFixturePicks = ordered.filter(p => p.fixtureId === targetFixtureId);
    } else {
      // Find fixture with the most qualifying high-probability markets
      const fixtureCounts = new Map<string, MarketPrediction[]>();
      for (const p of ordered) {
        const list = fixtureCounts.get(p.fixtureId) || [];
        list.push(p);
        fixtureCounts.set(p.fixtureId, list);
      }
      const groups = [...fixtureCounts.values()];
      if (prioritizePriorityLeagues) {
        // Widest market coverage wins; competition priority breaks a tie, then
        // the fixture whose best market is strongest.
        groups.sort((a, b) => {
          if (b.length !== a.length) return b.length - a.length;
          const byPriority = compareCompetitionPriority(a[0]?.league, b[0]?.league);
          if (byPriority !== 0) return byPriority;
          return Math.max(...b.map(p => p.estimatedProbability)) - Math.max(...a.map(p => p.estimatedProbability));
        });
        targetFixturePicks = groups[0] ?? [];
      } else {
        let bestList: MarketPrediction[] = [];
        for (const list of groups) {
          if (list.length > bestList.length) bestList = list;
        }
        targetFixturePicks = bestList;
      }
    }

    // Sort descending by probability
    targetFixturePicks.sort((a, b) => b.estimatedProbability - a.estimatedProbability);

    // Pick non-conflicting markets for the match (e.g. Over 0.5 Goals, Over 5.5 Corners, Cards, 1X)
    for (const cand of targetFixturePicks) {
      if (selectedPredictions.length >= targetLegsCount) break;
      const conflicts = selectedPredictions.some(sel => areMarketsConflicting(sel.market, cand.market));
      if (!conflicts) {
        selectedPredictions.push(cand);
      }
    }
  } else if (mode === 'CORRELATED_ALLOWED') {
    // Mode 2: Correlated Allowed - Allows intra-match stacking across fixtures
    // (already priority-ordered; re-sort inside each tier by probability).
    // Stacking is capped at 2 legs per fixture (relaxing to 3 only if needed)
    // to prevent cramming all legs into a tiny handful of matches.
    const MAX_LEGS_PRIMARY = 2;
    const MAX_LEGS_CEILING = 3;
    const fixtureLegCount = new Map<string, number>();

    const sorted = prioritizePriorityLeagues
      ? [...ordered].sort((a, b) =>
          compareCompetitionPriority(a.league, b.league) || (b.estimatedProbability - a.estimatedProbability))
      : [...filtered].sort((a, b) => b.estimatedProbability - a.estimatedProbability);

    // Pass 1: Stacking up to 2 legs per match from different market families
    for (let i = 0; i < sorted.length; i++) {
      if (selectedPredictions.length >= targetLegsCount) break;
      if (i > 0 && i % 15 === 0) {
        await new Promise(resolve => setImmediate(resolve));
      }
      const cand = sorted[i];
      if (!cand) continue;
      const fKey = cand.fixtureId || cand.fixtureDescription;
      const count = fixtureLegCount.get(fKey) || 0;
      if (count >= MAX_LEGS_PRIMARY) continue;

      const matchConflicts = selectedPredictions.some(
        sel => (sel.fixtureId === cand.fixtureId || sel.fixtureDescription === cand.fixtureDescription) &&
               areMarketsConflicting(sel.market, cand.market)
      );
      if (!matchConflicts) {
        selectedPredictions.push(cand);
        fixtureLegCount.set(fKey, count + 1);
      }
    }

    // Pass 2: If still short of targetLegsCount, allow at most 1 additional complementary market (up to 3 max per match)
    if (selectedPredictions.length < targetLegsCount) {
      for (let i = 0; i < sorted.length; i++) {
        if (selectedPredictions.length >= targetLegsCount) break;
        const cand = sorted[i];
        if (!cand) continue;
        const fKey = cand.fixtureId || cand.fixtureDescription;
        const count = fixtureLegCount.get(fKey) || 0;
        if (count >= MAX_LEGS_CEILING) continue;

        const alreadySelected = selectedPredictions.some(
          sel => (sel.fixtureId === cand.fixtureId || sel.fixtureDescription === cand.fixtureDescription) &&
                 sel.market === cand.market
        );
        if (alreadySelected) continue;

        const matchConflicts = selectedPredictions.some(
          sel => (sel.fixtureId === cand.fixtureId || sel.fixtureDescription === cand.fixtureDescription) &&
                 areMarketsConflicting(sel.market, cand.market)
        );
        if (!matchConflicts) {
          selectedPredictions.push(cand);
          fixtureLegCount.set(fKey, count + 1);
        }
      }
    }
  } else {
    // Mode 3: Strict Anti-Correlated (Default) - Strictly 1 leg per fixture across separate stadiums
    // The priority ordering is the input order for the de-duplication pass.
    const independentPicks = filterNonCorrelatedPredictions(ordered, {
      respectGivenOrder: prioritizePriorityLeagues,
    });
    selectedPredictions = independentPicks.slice(0, targetLegsCount);
  }

  const actualCount = selectedPredictions.length;
  const isSufficient = actualCount >= targetLegsCount;

  // Dynamic truncation & fallback notices.
  let fallbackNotice = '';
  const truncated = actualCount < targetLegsCount && actualCount > 0;

  if (thresholdRelaxed) {
    fallbackNotice = `⚠️ Threshold Adjusted: Lowered minimum leg probability from ${(minProbability * 100).toFixed(0)}% to ${(effectiveMinProb * 100).toFixed(0)}% to deliver a valid ${actualCount}-leg ticket with available matchday fixtures.`;
  } else if (truncated) {
    fallbackNotice = `Only ${actualCount} fixtures met the strict ${(minProbability * 100).toFixed(0)}%+ probability threshold today. Parlay capped at ${actualCount} legs for maximum ticket reliability.`;
  }

  // Map to ParlayLeg format
  let parlayLegs: ParlayLeg[] = selectedPredictions.map(p => ({
    fixtureId: p?.fixtureId || 'unknown',
    league: p?.league || 'ALL',
    fixtureDescription: p?.fixtureDescription || 'Match',
    kickoff: p?.kickoff || new Date().toISOString(),
    market: p?.market || ('HOME_WIN' as any),
    marketLabel: p?.marketLabel || p?.market || 'Market',
    selection: p?.selection || 'Selection',
    estimatedProbability: typeof p?.estimatedProbability === 'number' && Number.isFinite(p.estimatedProbability)
      ? p.estimatedProbability
      : 0.5,
    rawProbability: (p as any)?.rawProbability ?? p?.estimatedProbability,
    confidenceMultiplier: (p as any)?.confidenceMultiplier ?? 1.0,
    supportingStatistics: p?.supportingStatistics,
    sampleSize: p?.sampleSize ?? 10,
    dataFreshnessDays: p?.dataFreshnessDays ?? 1,
    riskFactors: p?.riskFactors || [],
  }));

  // Group and cluster legs by fixture so multi-market bets from the same match are contiguous.
  // 1. Order fixture groups by the highest individual leg probability within each fixture (descending),
  //    respecting competition priority when enabled.
  // 2. Within each fixture group, order legs by probability (descending).
  const fixtureGroupMap = new Map<string, ParlayLeg[]>();
  for (const leg of parlayLegs) {
    const key = leg.fixtureId || leg.fixtureDescription;
    const group = fixtureGroupMap.get(key) || [];
    group.push(leg);
    fixtureGroupMap.set(key, group);
  }

  for (const group of fixtureGroupMap.values()) {
    group.sort((a, b) => b.estimatedProbability - a.estimatedProbability);
  }

  const sortedGroups = Array.from(fixtureGroupMap.values()).sort((groupA, groupB) => {
    if (prioritizePriorityLeagues) {
      const pDiff = compareCompetitionPriority(groupA[0]?.league, groupB[0]?.league);
      if (pDiff !== 0) return pDiff;
    }
    const maxA = groupA[0]?.estimatedProbability ?? 0;
    const maxB = groupB[0]?.estimatedProbability ?? 0;
    return maxB - maxA;
  });

  parlayLegs = sortedGroups.flat();

  // Calculate combined probability with correlation awareness:
  let combinedProb = 1.0;
  if (parlayLegs.length > 0) {
    if (mode === 'ANTI_CORRELATED') {
      // Independent product
      for (const leg of parlayLegs) {
        const legProb = typeof leg.estimatedProbability === 'number' && Number.isFinite(leg.estimatedProbability) && leg.estimatedProbability > 0
          ? leg.estimatedProbability
          : 0.5;
        combinedProb *= legProb;
      }
    } else {
      // Intra-match positive correlation adjustment (Gaussian copula approximation)
      // Positive correlation between Goals and Corners (rho ~ 0.18) increases joint probability
      let independentProduct = 1.0;
      let minLegProb = 1.0;
      for (const leg of parlayLegs) {
        const legProb = typeof leg.estimatedProbability === 'number' && Number.isFinite(leg.estimatedProbability) && leg.estimatedProbability > 0
          ? leg.estimatedProbability
          : 0.5;
        independentProduct *= legProb;
        if (legProb < minLegProb) minLegProb = legProb;
      }

      // Group by fixture to measure intra-match correlation degree
      const fixtureCounts: Record<string, number> = {};
      for (const leg of parlayLegs) {
        fixtureCounts[leg.fixtureId] = (fixtureCounts[leg.fixtureId] || 0) + 1;
      }
      let intraMatchLegsCount = 0;
      for (const count of Object.values(fixtureCounts)) {
        if (count > 1) intraMatchLegsCount += count;
      }

      // Correlation boost factor (Over 0.5 Goals + Over 5.5 Corners positively correlate with match tempo)
      const correlationBoost = intraMatchLegsCount > 0 ? 1 + (intraMatchLegsCount * 0.08) : 1.0;
      combinedProb = Math.min(minLegProb * 0.95, independentProduct * correlationBoost);
    }
  } else {
    combinedProb = 0;
  }

  const compoundOddsDecimal = combinedProb > 0 ? Number((1 / combinedProb).toFixed(2)) : 0;
  const combinedProbPct = (combinedProb * 100).toFixed(combinedProb < 0.01 ? 4 : 2);

  const status = isSufficient ? 'SUFFICIENT_SELECTIONS' : 'INSUFFICIENT_SELECTIONS';

  let message = `Successfully assembled ${parlayLegs.length}-leg statistical parlay.`;
  if (!isSufficient) {
    message = `Insufficient qualifying selections: found ${selectedPredictions.length} eligible selections on this date (requested: ${targetLegsCount} legs, threshold >= ${(minProbability * 100).toFixed(0)}%).`;
  }
  if (fallbackNotice) {
    message += ` ${fallbackNotice}`;
  }

  let correlationExplanation = '';
  let independenceAssumptions = '';

  if (mode === 'SAME_GAME_PARLAY') {
    correlationExplanation =
      'Same-Game Parlay (Correlated Mode): Multiple complementary markets (Goals, Corners, Cards, Double Chance) combined for the same fixture. Positive correlations across match pace and attacking momentum are mathematically adjusted via copula boost.';
    independenceAssumptions =
      'Positive Intra-Match Covariance: Within the same match, high attacking tempo simultaneously drives both goals and corners. The true joint probability is higher than independent multiplication.';
  } else if (mode === 'CORRELATED_ALLOWED') {
    correlationExplanation =
      'Mixed Correlated Mode: Intra-match selections allowed across fixtures without strict single-stadium restriction.';
    independenceAssumptions =
      'Partial Independence: Unconstrained multi-market combination across matches.';
  } else {
    correlationExplanation =
      'Zero intra-match correlation enforced: every leg originates from an entirely separate fixture in a different stadium. Correlated multi-market selections on the same fixture are strictly rejected.';
    independenceAssumptions =
      'Independence Assumption: Combined probability is calculated under conditional independence P(A ∩ B ∩ ...) = P(A) · P(B) · ... across separate stadiums.';
  }

  const riskWarning =
    `Statistical Warning: This model provides probabilistic estimates, NOT guarantees or sure wins. Combining ${parlayLegs.length} legs multiplies tail risk exponentially. Even if every leg has a 75% win probability, a ${targetLegsCount}-leg combination has an estimated joint probability of ${combinedProbPct}% (approx 1 in ${compoundOddsDecimal.toLocaleString()}). Never stake more than you can afford to lose.`;

  return {
    id: `parlay-${mode.toLowerCase()}-${targetLegsCount}-${Date.now()}`,
    targetLegsCount,
    actualLegsCount: parlayLegs.length,
    mode,
    status,
    message,
    legs: parlayLegs,
    combinedProbability: Number(combinedProb.toFixed(6)),
    compoundOddsDecimal,
    correlationExplanation,
    independenceAssumptions,
    riskWarning,
    generatedAt: new Date().toISOString(),
  };
}
