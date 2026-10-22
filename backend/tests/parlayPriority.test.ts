import { describe, it, expect } from 'vitest';
import { buildStatisticalParlay } from '../src/parlays/parlay-builder.js';
import { filterNonCorrelatedPredictions } from '../src/parlays/correlation-detector.js';
import { MarketPrediction, ParlayLegCount } from '../src/types/football.js';

/**
 * The generators rank Premier League and UEFA Champions League candidates ahead
 * of the secondary domestic leagues. These pin the two halves of that promise:
 * priority reorders *eligible* legs, and it never overrides the minimum
 * probability gate that keeps a parlay to a quality floor.
 */

function prediction(fixtureId: string, league: string, market: string, prob: number): MarketPrediction {
  return {
    id: `${fixtureId}-${market}`,
    fixtureId,
    league: league as any,
    fixtureDescription: `Fixture ${fixtureId}`,
    kickoff: '15:00:00Z',
    market: market as any,
    marketLabel: 'Market',
    selection: `Selection ${market}`,
    estimatedProbability: prob,
    rawProbability: prob,
    confidenceLower: prob - 0.05,
    confidenceUpper: prob + 0.05,
    supportingStatistics: {
      homeGoalAverageLast5: 1.5,
      awayGoalAverageLast5: 1.2,
      homeConcededAverageLast5: 1.0,
      awayConcededAverageLast5: 1.1,
      homeXgAverage: 1.4,
      awayXgAverage: 1.1,
      bttsFrequencyLast10: 0.5,
      over25FrequencyLast10: 0.5,
      h2hSummary: 'H2H',
      cleanSheetRateHome: 0.3,
      cleanSheetRateAway: 0.2,
    },
    sampleSize: 10,
    dataFreshnessDays: 1,
    riskFactors: [],
    actualOutcome: 'PENDING',
  };
}

/** `count` legs for `league`, each its own fixture, all sharing one probability. */
function pool(league: string, count: number, prob: number, prefix = league.toLowerCase()): MarketPrediction[] {
  return Array.from({ length: count }, (_, i) =>
    prediction(`${prefix}-${i + 1}`, league, 'HOME_WIN', prob));
}

describe('parlay builder — competition priority', () => {
  it('prefers weaker EPL/UCL legs over stronger secondary-league legs', () => {
    const candidates = [...pool('LALIGA', 20, 0.9), ...pool('EPL', 5, 0.62)];

    const parlay = buildStatisticalParlay(candidates, { targetLegsCount: 5, minProbability: 0.6 });

    expect(parlay.legs).toHaveLength(5);
    expect(new Set(parlay.legs.map((l) => l.league))).toEqual(new Set(['EPL']));
  });

  it('returns the strongest pool when prioritisation is switched off', () => {
    const candidates = [...pool('LALIGA', 20, 0.65), ...pool('EPL', 5, 0.55)];

    const parlay = buildStatisticalParlay(candidates, {
      targetLegsCount: 5,
      minProbability: 0.5,
      prioritizePriorityLeagues: false,
    });

    expect(parlay.legs).toHaveLength(5);
    expect(new Set(parlay.legs.map((l) => l.league))).toEqual(new Set(['LALIGA']));
  });

  it('never promotes a priority leg that fails the probability gate', () => {
    const candidates = [...pool('EPL', 5, 0.5), ...pool('LALIGA', 5, 0.75)];

    const parlay = buildStatisticalParlay(candidates, { targetLegsCount: 5, minProbability: 0.6 });

    expect(parlay.legs).toHaveLength(5);
    expect(new Set(parlay.legs.map((l) => l.league))).toEqual(new Set(['LALIGA']));
  });

  it('fills the remainder from the secondary leagues when the priority pool is short', () => {
    const candidates = [...pool('EPL', 2, 0.7), ...pool('CHAMPIONS_LEAGUE', 1, 0.68), ...pool('SERIE_A', 10, 0.8)];

    const parlay = buildStatisticalParlay(candidates, { targetLegsCount: 5, minProbability: 0.6 });

    expect(parlay.legs).toHaveLength(5);
    expect(parlay.legs.slice(0, 3).map((l) => l.league))
      .toEqual(['EPL', 'EPL', 'CHAMPIONS_LEAGUE']);
    // The two remaining legs come from the strongest secondary league.
    expect(parlay.legs.slice(3).map((l) => l.league)).toEqual(['SERIE_A', 'SERIE_A']);
  });

  it('keeps probability ordering inside a priority tier', () => {
    const candidates = [
      prediction('epl-low', 'EPL', 'HOME_WIN', 0.62),
      prediction('ucl-high', 'CHAMPIONS_LEAGUE', 'HOME_WIN', 0.8),
      prediction('epl-high', 'EPL', 'HOME_WIN', 0.79),
    ];

    const parlay = buildStatisticalParlay(candidates, { targetLegsCount: 3 as ParlayLegCount, minProbability: 0.6 });

    // EPL tier first (0.79 then 0.62), then the UCL leg.
    expect(parlay.legs.map((l) => l.fixtureId)).toEqual(['epl-high', 'epl-low', 'ucl-high']);
  });

  it('leaves a single-league pool in pure probability order', () => {
    const candidates = pool('EPL', 6, 0).map((p, i) => ({ ...p, estimatedProbability: 0.6 + i * 0.01 }));

    const parlay = buildStatisticalParlay(candidates, { targetLegsCount: 3 as ParlayLegCount, minProbability: 0.5 });

    expect(parlay.legs.map((l) => l.estimatedProbability)).toEqual([0.65, 0.64, 0.63]);
  });

  it('still refuses to take two legs from one fixture', () => {
    const candidates = [
      prediction('epl-1', 'EPL', 'HOME_WIN', 0.8),
      prediction('epl-1', 'EPL', 'OVER_1_5', 0.7),
      prediction('laliga-1', 'LALIGA', 'HOME_WIN', 0.65),
    ];

    const parlay = buildStatisticalParlay(candidates, { targetLegsCount: 5, minProbability: 0.5 });

    expect(parlay.legs.map((l) => l.fixtureId)).toEqual(['epl-1', 'laliga-1']);
  });

  it('breaks a same-game tie towards the priority competition', () => {
    // Two fixtures with an identical number of qualifying markets: the EPL one wins.
    const candidates = [
      prediction('laliga-1', 'LALIGA', 'HOME_WIN', 0.8),
      prediction('laliga-1', 'LALIGA', 'OVER_1_5', 0.75),
      prediction('epl-1', 'EPL', 'HOME_WIN', 0.7),
      prediction('epl-1', 'EPL', 'OVER_1_5', 0.69),
    ];

    const parlay = buildStatisticalParlay(candidates, {
      targetLegsCount: 5,
      minProbability: 0.5,
      mode: 'SAME_GAME_PARLAY',
    });

    expect(parlay.legs.every((l) => l.fixtureId === 'epl-1')).toBe(true);
  });

  it('honours an explicit SGP fixture target regardless of priority', () => {
    const candidates = [
      prediction('laliga-1', 'LALIGA', 'HOME_WIN', 0.8),
      prediction('laliga-1', 'LALIGA', 'OVER_1_5', 0.75),
      prediction('epl-1', 'EPL', 'HOME_WIN', 0.7),
    ];

    const parlay = buildStatisticalParlay(candidates, {
      targetLegsCount: 5,
      minProbability: 0.5,
      mode: 'SAME_GAME_PARLAY',
      targetFixtureId: 'laliga-1',
    });

    expect(parlay.legs.every((l) => l.fixtureId === 'laliga-1')).toBe(true);
  });

  it('ranks priority leagues first in correlated-allowed mode too', () => {
    const candidates = [...pool('LALIGA', 6, 0.65), ...pool('EPL', 2, 0.55)];

    const parlay = buildStatisticalParlay(candidates, {
      targetLegsCount: 4 as ParlayLegCount,
      minProbability: 0.5,
      mode: 'CORRELATED_ALLOWED',
    });

    expect(parlay.legs.slice(0, 2).every((l) => l.league === 'EPL')).toBe(true);
    expect(parlay.legs).toHaveLength(4);
  });
});

describe('filterNonCorrelatedPredictions — order policy', () => {
  it('sorts by probability by default (unchanged behaviour)', () => {
    const preds = [
      prediction('m-1', 'EPL', 'HOME_WIN', 0.6),
      prediction('m-1', 'EPL', 'OVER_1_5', 0.85),
      prediction('m-2', 'EPL', 'HOME_WIN', 0.7),
    ];

    expect(filterNonCorrelatedPredictions(preds).map((p) => `${p.fixtureId}:${p.market}`))
      .toEqual(['m-1:OVER_1_5', 'm-2:HOME_WIN']);
  });

  it('preserves a deliberate ordering when asked', () => {
    const preds = [
      prediction('m-2', 'EPL', 'HOME_WIN', 0.7),
      prediction('m-1', 'EPL', 'OVER_1_5', 0.85),
      prediction('m-1', 'EPL', 'HOME_WIN', 0.6),
    ];

    expect(
      filterNonCorrelatedPredictions(preds, { respectGivenOrder: true }).map((p) => `${p.fixtureId}:${p.market}`),
    ).toEqual(['m-2:HOME_WIN', 'm-1:OVER_1_5']);
  });
});
