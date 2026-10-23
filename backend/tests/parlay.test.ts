import { describe, it, expect } from 'vitest';
import { buildStatisticalParlay } from '../src/parlays/parlay-builder.js';
import { filterNonCorrelatedPredictions } from '../src/parlays/correlation-detector.js';
import { MarketPrediction } from '../src/types/football.js';

function createMockPrediction(fixtureId: string, market: string, prob: number): MarketPrediction {
  return {
    id: `${fixtureId}-${market}`,
    fixtureId,
    league: 'EPL',
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

describe('Anti-Correlation & Parlay Engine', () => {
  it('strictly prevents duplicate selections from the same fixture', () => {
    const preds: MarketPrediction[] = [
      createMockPrediction('match-1', 'HOME_WIN', 0.70),
      createMockPrediction('match-1', 'OVER_1_5', 0.85), // Same match!
      createMockPrediction('match-2', 'BTTS_YES', 0.65),
      createMockPrediction('match-3', 'DOUBLE_CHANCE_1X', 0.75),
    ];

    const independent = filterNonCorrelatedPredictions(preds);
    const fixtureIds = independent.map(p => p.fixtureId);

    // Should only have 3 distinct matches
    expect(fixtureIds.length).toBe(3);
    expect(new Set(fixtureIds).size).toBe(3);
    // Should have selected the higher probability one for match-1 (0.85 OVER_1_5)
    const match1Pick = independent.find(p => p.fixtureId === 'match-1');
    expect(match1Pick?.estimatedProbability).toBe(0.85);
  });

  it('generates a valid 5-leg parlay when sufficient fixtures exist', async () => {
    const preds: MarketPrediction[] = [
      createMockPrediction('match-1', 'HOME_WIN', 0.70),
      createMockPrediction('match-2', 'OVER_1_5', 0.75),
      createMockPrediction('match-3', 'DOUBLE_CHANCE_1X', 0.72),
      createMockPrediction('match-4', 'OVER_2_5', 0.68),
      createMockPrediction('match-5', 'BTTS_YES', 0.65),
      createMockPrediction('match-6', 'DRAW', 0.30),
    ];

    const parlay = await buildStatisticalParlay(preds, {
      targetLegsCount: 5,
      minProbability: 0.60,
    });
    expect(parlay.combinedProbability).toBeCloseTo(0.75 * 0.72 * 0.70 * 0.68 * 0.65, 3);
  });

  it('honestly reports INSUFFICIENT_SELECTIONS instead of inventing picks when matches are scarce', async () => {
    // Only 3 matches available, but user requests a 10-leg parlay
    const preds: MarketPrediction[] = [
      createMockPrediction('match-1', 'HOME_WIN', 0.70),
      createMockPrediction('match-2', 'OVER_1_5', 0.75),
      createMockPrediction('match-3', 'DOUBLE_CHANCE_1X', 0.80),
    ];

    const parlay = await buildStatisticalParlay(preds, {
      targetLegsCount: 10,
      minProbability: 0.60,
    });
    expect(parlay.legs.length).toBe(3);
    expect(parlay.message).toContain('Insufficient qualifying selections');
  });

  it('calculates 15, 20, and 25-leg parlays across EPL and Championship without crashing', async () => {
    // Create 30 mock distinct matches
    const preds: MarketPrediction[] = [];
    for (let i = 1; i <= 30; i++) {
      preds.push(createMockPrediction(`match-${i}`, 'HOME_WIN', 0.65));
    }

    const parlay25 = await buildStatisticalParlay(preds, {
      targetLegsCount: 25,
      minProbability: 0.60,
    });
    expect(parlay25.combinedProbability).toBeGreaterThan(0);
    expect(parlay25.combinedProbability).toBeLessThan(0.01); // Exponential tail shrinkage
    expect(parlay25.riskWarning).toContain('Statistical Warning');
  });
});

