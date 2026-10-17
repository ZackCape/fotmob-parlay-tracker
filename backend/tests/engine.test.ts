import { describe, it, expect } from 'vitest';
import { calculateDixonColes, poissonPmf, dixonColesTau } from '../src/engine/poisson-dixon-coles.js';
import { calibrateProbability } from '../src/engine/calibrator.js';
import { computeModelPerformance } from '../src/engine/evaluator.js';

describe('Poisson & Dixon-Coles Statistical Engine', () => {
  it('calculates Poisson PMF correctly', () => {
    // Poisson with lambda = 1.5: P(0) = e^(-1.5) approx 0.2231
    const p0 = poissonPmf(0, 1.5);
    expect(p0).toBeCloseTo(0.2231, 3);

    // P(1) = 1.5 * e^(-1.5) approx 0.3347
    const p1 = poissonPmf(1, 1.5);
    expect(p1).toBeCloseTo(0.3347, 3);
  });

  it('adjusts low scorelines with Dixon-Coles tau parameter', () => {
    const tau00 = dixonColesTau(0, 0, 1.4, 1.1, -0.11);
    // 1 - 1.4 * 1.1 * (-0.11) = 1 + 0.1694 = 1.1694 > 1 (boosts 0-0 probability)
    expect(tau00).toBeGreaterThan(1.0);

    const tau22 = dixonColesTau(2, 2, 1.4, 1.1, -0.11);
    expect(tau22).toBe(1.0); // No adjustment for higher scores
  });

  it('generates a normalized joint score matrix where sum is ~ 1.0', () => {
    const res = calculateDixonColes(1.2, 0.9, 1.0, 1.1, 'EPL', 1.28);
    expect(res.homeExpectedGoals).toBeGreaterThan(0.5);
    expect(res.awayExpectedGoals).toBeGreaterThan(0.5);

    const sumProb = res.scoreMatrix.reduce((acc, cell) => acc + cell.probability, 0);
    expect(sumProb).toBeCloseTo(1.0, 4);
  });
});

describe('Probability Calibrator & Bayesian Shrinkage', () => {
  it('shrinks extreme small-sample probabilities towards league prior', () => {
    const raw = 0.95;
    const prior = 0.50;
    const sampleSize = 5;
    const calibrated = calibrateProbability(raw, prior, sampleSize, 5);

    // Should shrink from 0.95 towards 0.50
    expect(calibrated.calibrated).toBeLessThan(raw);
    expect(calibrated.calibrated).toBeGreaterThan(prior);
    expect(calibrated.lowerBound).toBeLessThan(calibrated.calibrated);
    expect(calibrated.upperBound).toBeGreaterThan(calibrated.calibrated);
  });
});

describe('Model Evaluator (Brier Score & Log Loss)', () => {
  it('evaluates Brier score correctly on binary outcomes', () => {
    const mockPredictions: any[] = [
      { id: '1', league: 'EPL', market: 'HOME_WIN', estimatedProbability: 0.8, actualOutcome: 'HIT' },
      { id: '2', league: 'EPL', market: 'HOME_WIN', estimatedProbability: 0.8, actualOutcome: 'MISS' },
    ];

    // Pred 1: (0.8 - 1)^2 = 0.04
    // Pred 2: (0.8 - 0)^2 = 0.64
    // Mean Brier = (0.04 + 0.64) / 2 = 0.34
    const report = computeModelPerformance(mockPredictions);
    expect(report.overallBrierScore).toBeCloseTo(0.34, 2);
    expect(report.overallHitRate).toBe(0.5);
  });
});
