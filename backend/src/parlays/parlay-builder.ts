import { MarketPrediction, ParlayLeg, ParlayLegCount, ParlayMode, StatisticalParlay } from '../types/football.js';
import { areMarketsConflicting, filterNonCorrelatedPredictions } from './correlation-detector.js';
import {
  compareCompetitionPriority,
  orderByCompetitionPriorityThenScore,
} from '../utils/competitionPriority.js';

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
}

export function buildStatisticalParlay(
  candidatePredictions: MarketPrediction[],
  options: ParlayBuilderOptions
): StatisticalParlay {
  const {
    targetLegsCount,
    minProbability = 0.58,
    allowedMarkets,
    leagueFilter = 'ALL',
    mode = 'ANTI_CORRELATED',
    targetFixtureId,
    prioritizePriorityLeagues = true,
  } = options;

  // Filter candidates by league, probability threshold, and market filters
  let filtered = candidatePredictions.filter(p => {
    if (leagueFilter !== 'ALL' && p.league !== leagueFilter) return false;
    if (p.estimatedProbability < minProbability) return false;
    if (allowedMarkets && allowedMarkets.length > 0 && !allowedMarkets.includes(p.market)) return false;
    return true;
  });

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
    const sorted = prioritizePriorityLeagues
      ? [...ordered].sort((a, b) =>
          compareCompetitionPriority(a.league, b.league) || (b.estimatedProbability - a.estimatedProbability))
      : [...filtered].sort((a, b) => b.estimatedProbability - a.estimatedProbability);
    for (const cand of sorted) {
      if (selectedPredictions.length >= targetLegsCount) break;
      const matchConflicts = selectedPredictions.some(
        sel => sel.fixtureId === cand.fixtureId && areMarketsConflicting(sel.market, cand.market)
      );
      if (!matchConflicts) {
        selectedPredictions.push(cand);
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

  const isSufficient = selectedPredictions.length >= targetLegsCount;

  // Map to ParlayLeg format
  const parlayLegs: ParlayLeg[] = selectedPredictions.map(p => ({
    fixtureId: p.fixtureId,
    league: p.league,
    fixtureDescription: p.fixtureDescription,
    kickoff: p.kickoff,
    market: p.market,
    marketLabel: p.marketLabel,
    selection: p.selection,
    estimatedProbability: p.estimatedProbability,
    supportingStatistics: p.supportingStatistics,
    sampleSize: p.sampleSize,
    dataFreshnessDays: p.dataFreshnessDays,
    riskFactors: p.riskFactors,
  }));

  // Calculate combined probability with correlation awareness:
  let combinedProb = 1.0;
  if (parlayLegs.length > 0) {
    if (mode === 'ANTI_CORRELATED') {
      // Independent product
      for (const leg of parlayLegs) {
        combinedProb *= leg.estimatedProbability;
      }
    } else {
      // Intra-match positive correlation adjustment (Gaussian copula approximation)
      // Positive correlation between Goals and Corners (rho ~ 0.18) increases joint probability
      let independentProduct = 1.0;
      let minLegProb = 1.0;
      for (const leg of parlayLegs) {
        independentProduct *= leg.estimatedProbability;
        if (leg.estimatedProbability < minLegProb) minLegProb = leg.estimatedProbability;
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
