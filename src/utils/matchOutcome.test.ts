import { describe, it, expect } from 'vitest';
import { computeOutcomeProbabilities } from './matchOutcome';

describe('computeOutcomeProbabilities', () => {
  it('home win highest', () => {
    const r = computeOutcomeProbabilities(0.5, 0.25, 0.25);
    expect(r).not.toBeNull();
    expect(r!.mostLikely).toBe('home');
    expect(r!.tied).toBe(false);
  });
  it('draw highest', () => {
    const r = computeOutcomeProbabilities(0.2, 0.5, 0.3);
    expect(r!.mostLikely).toBe('draw');
  });
  it('away win highest', () => {
    const r = computeOutcomeProbabilities(0.2, 0.3, 0.5);
    expect(r!.mostLikely).toBe('away');
  });
  it('tie', () => {
    const r = computeOutcomeProbabilities(0.333, 0.333, 0.334);
    // not exact tie; use exact
    const r2 = computeOutcomeProbabilities(1, 1, 1);
    expect(r2!.tied).toBe(true);
    expect(r2!.mostLikely).toBe('tie');
  });
  it('invalid/missing', () => {
    expect(computeOutcomeProbabilities(null, 0.3, 0.3)).toBeNull();
    expect(computeOutcomeProbabilities(0.4, 0.3, -0.1)).toBeNull();
    expect(computeOutcomeProbabilities(0, 0, 0)).toBeNull();
  });
  it('probabilities sum to ~1', () => {
    const r = computeOutcomeProbabilities(0.42, 0.31, 0.27);
    expect(r!.home + r!.draw + r!.away).toBeCloseTo(1, 9);
  });
});