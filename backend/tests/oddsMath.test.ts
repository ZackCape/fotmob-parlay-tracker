import { describe, it, expect } from 'vitest';
import { computeOddsComparison } from '../src/utils/oddsMath.js';

describe('computeOddsComparison', () => {
  it('computes implied probs and overround', () => {
    const r = computeOddsComparison(2.0, 3.5, 4.0, 0.45, 0.28, 0.27);
    expect(r.impliedHome).toBeCloseTo(0.5, 5);
    expect(r.impliedDraw).toBeCloseTo(1 / 3.5, 5);
    expect(r.overround).toBeGreaterThan(1);
    expect(r.normalizedHome).toBeLessThan(r.impliedHome!);
  });
  it('handles invalid odds', () => {
    const r = computeOddsComparison(0, 3.5, 4.0, 0.45, 0.28, 0.27);
    expect(r.homeOdds).toBeNull();
    expect(r.impliedHome).toBeNull();
    expect(r.overround).toBeNull();
  });
  it('fair odds', () => {
    const r = computeOddsComparison(2.0, 3.5, 4.0, 0.5, 0.25, 0.25);
    expect(r.fairOddsHome).toBeCloseTo(2.0, 5);
  });
  it('diffs', () => {
    const r = computeOddsComparison(2.0, 3.5, 4.0, 0.5, 0.25, 0.25);
    expect(r.diffHome).not.toBeNull();
  });
});