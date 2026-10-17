import { describe, it, expect } from 'vitest';
import { computeOddsComparison } from './oddsMath';

describe('computeOddsComparison (frontend)', () => {
  it('basic', () => {
    const r = computeOddsComparison(2.0, 3.0, 4.0, 0.4, 0.3, 0.3);
    expect(r.overround).toBeGreaterThan(1);
    expect(r.normalizedHome).not.toBeNull();
  });
  it('invalid', () => {
    const r = computeOddsComparison(-1, 3.0, 4.0, 0.4, 0.3, 0.3);
    expect(r.homeOdds).toBeNull();
  });
});