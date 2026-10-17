import { describe, it, expect } from 'vitest';
import {
  estimateTeamStrengths,
  sampleFromResults,
  leagueBaselineRate,
} from '../src/utils/teamStrength.js';
import { calculateDixonColes } from '../src/engine/poisson-dixon-coles.js';

describe('leagueBaselineRate', () => {
  it('returns a positive baseline for every league', () => {
    const leagues = ['EPL', 'CHAMPIONSHIP', 'LALIGA', 'LIGUE1', 'SERIE_A',
      'BUNDESLIGA', 'CHAMPIONS_LEAGUE', 'EUROPA_LEAGUE', 'CONFERENCE_LEAGUE', 'UNKNOWN_LEAGUE'];
    for (const lg of leagues) {
      const rate = leagueBaselineRate(lg);
      expect(rate).toBeGreaterThan(0.5);
      expect(rate).toBeLessThan(2.5);
    }
  });
});

describe('sampleFromResults', () => {
  it('returns null when there is no real data (never fabricates)', () => {
    expect(sampleFromResults(null)).toBeNull();
    expect(sampleFromResults(undefined)).toBeNull();
    expect(sampleFromResults([])).toBeNull();
    expect(sampleFromResults([{ goalsFor: NaN, goalsAgainst: 1 }])).toBeNull();
  });

  it('averages observed goals per match', () => {
    const s = sampleFromResults([
      { goalsFor: 2, goalsAgainst: 1 },
      { goalsFor: 0, goalsAgainst: 0 },
      { goalsFor: 3, goalsAgainst: 2 },
    ]);
    expect(s).not.toBeNull();
    expect(s!.matches).toBe(3);
    expect(s!.goalsForPerMatch).toBeCloseTo(5 / 3, 2);
    expect(s!.goalsConcededPerMatch).toBeCloseTo(3 / 3, 2);
  });

  it('winsorizes outlier routs so one 6-3 cannot dominate the window', () => {
    const withOutlier = sampleFromResults([
      { goalsFor: 6, goalsAgainst: 3 },
      { goalsFor: 1, goalsAgainst: 0 },
      { goalsFor: 1, goalsAgainst: 1 },
      { goalsFor: 1, goalsAgainst: 0 },
      { goalsFor: 1, goalsAgainst: 1 },
    ]);
    // 6 is capped at 4 -> (4 + 1 + 1 + 1 + 1) / 5 = 1.6, not 2.0
    expect(withOutlier!.goalsForPerMatch).toBeCloseTo(1.6, 2);
    expect(withOutlier!.goalsForPerMatch).toBeLessThan(2.0);
  });

  it('ignores negative or non-finite goal counts', () => {
    const s = sampleFromResults([
      { goalsFor: 2, goalsAgainst: 1 },
      { goalsFor: -3, goalsAgainst: 1 },
      { goalsFor: Infinity, goalsAgainst: 0 },
    ]);
    expect(s!.matches).toBe(1);
  });
});

describe('estimateTeamStrengths', () => {
  it('falls back to a neutral prior and says so when no data exists', () => {
    const s = estimateTeamStrengths({ league: 'EPL' });
    expect(s.priorOnly).toBe(true);
    expect(s.homeAttack).toBe(1);
    expect(s.homeDefense).toBe(1);
    expect(s.awayAttack).toBe(1);
    expect(s.awayDefense).toBe(1);
    expect(s.basis).toMatch(/prior/i);
  });

  it('produces a stronger attack multiplier for a genuinely prolific team', () => {
    const scoring = sampleFromResults([
      { goalsFor: 3, goalsAgainst: 1 },
      { goalsFor: 2, goalsAgainst: 0 },
      { goalsFor: 3, goalsAgainst: 1 },
      { goalsFor: 2, goalsAgainst: 2 },
      { goalsFor: 3, goalsAgainst: 0 },
    ])!;
    const s = estimateTeamStrengths({ league: 'EPL', homeRecent: scoring });
    expect(s.priorOnly).toBe(false);
    expect(s.homeAttack).toBeGreaterThan(1);
    expect(s.homeAttack).toBeLessThanOrEqual(1.8);
  });

  it('gives the better defence a LOWER defensive multiplier', () => {
    const tight = sampleFromResults([
      { goalsFor: 1, goalsAgainst: 0 },
      { goalsFor: 2, goalsAgainst: 1 },
      { goalsFor: 1, goalsAgainst: 0 },
      { goalsFor: 0, goalsAgainst: 0 },
      { goalsFor: 2, goalsAgainst: 1 },
    ])!;
    const leaky = sampleFromResults([
      { goalsFor: 1, goalsAgainst: 3 },
      { goalsFor: 0, goalsAgainst: 2 },
      { goalsFor: 2, goalsAgainst: 3 },
      { goalsFor: 1, goalsAgainst: 2 },
      { goalsFor: 0, goalsAgainst: 3 },
    ])!;
    const s = estimateTeamStrengths({ league: 'EPL', homeRecent: tight, awayRecent: leaky });
    expect(s.homeDefense).toBeLessThan(s.awayDefense);
  });

  it('shrinks thin samples so a freak run cannot create a superhuman team', () => {
    // A single 9-0 must not produce a maximum-strength multiplier.
    const freak = sampleFromResults([{ goalsFor: 9, goalsAgainst: 0 }])!;
    const s = estimateTeamStrengths({ league: 'EPL', homeRecent: freak });
    expect(s.homeAttack).toBeLessThanOrEqual(1.8);
    expect(Number.isFinite(s.homeAttack)).toBe(true);
  });

  it('always returns strictly positive finite multipliers', () => {
    const inputs = [
      { league: 'EPL' },
      { league: 'LALIGA', homeRecent: sampleFromResults([{ goalsFor: 0, goalsAgainst: 0 }]) },
      { league: 'BUNDESLIGA', homeXg: 0, awayXg: -2 },
      { league: 'SERIE_A', homeRecent: sampleFromResults([{ goalsFor: 12, goalsAgainst: 14 }]) },
    ];
    for (const input of inputs) {
      const s = estimateTeamStrengths(input);
      for (const v of [s.homeAttack, s.homeDefense, s.awayAttack, s.awayDefense]) {
        expect(Number.isFinite(v)).toBe(true);
        expect(v).toBeGreaterThan(0);
      }
    }
  });

  it('yields DIFFERENT probabilities for DIFFERENT matches', () => {
    // Regression guard: the adapter previously hardcoded 1.25/0.95/1.10/1.10
    // for every fixture, so every match reported identical H/D/A.
    const strong = estimateTeamStrengths({
      league: 'EPL',
      homeRecent: sampleFromResults([
        { goalsFor: 3, goalsAgainst: 0 }, { goalsFor: 2, goalsAgainst: 1 },
        { goalsFor: 3, goalsAgainst: 0 }, { goalsFor: 2, goalsAgainst: 1 },
        { goalsFor: 2, goalsAgainst: 0 },
      ]),
    });
    const weak = estimateTeamStrengths({
      league: 'EPL',
      homeRecent: sampleFromResults([
        { goalsFor: 0, goalsAgainst: 3 }, { goalsFor: 1, goalsAgainst: 2 },
        { goalsFor: 0, goalsAgainst: 2 }, { goalsFor: 1, goalsAgainst: 3 },
        { goalsFor: 0, goalsAgainst: 2 },
      ]),
    });

    const pA = calculateDixonColes(strong.homeAttack, strong.homeDefense, 1, 1, 'EPL');
    const pB = calculateDixonColes(weak.homeAttack, weak.homeDefense, 1, 1, 'EPL');
    expect(pA.homeExpectedGoals).not.toBe(pB.homeExpectedGoals);
    expect(pA.homeAttackStrength).toBeGreaterThan(pB.homeAttackStrength);
  });

  it('feeds Dixon-Coles cleanly so the score matrix is a valid distribution', () => {
    const s = estimateTeamStrengths({
      league: 'EPL',
      homeRecent: sampleFromResults([{ goalsFor: 2, goalsAgainst: 1 }]),
      awayRecent: sampleFromResults([{ goalsFor: 1, goalsAgainst: 2 }]),
    });
    const dc = calculateDixonColes(s.homeAttack, s.homeDefense, s.awayAttack, s.awayDefense, 'EPL');

    const total = dc.scoreMatrix.reduce((sum, row) => sum + row.probability, 0);
    expect(total).toBeCloseTo(1, 5);
    expect(dc.homeExpectedGoals).toBeGreaterThan(0);
    expect(dc.awayExpectedGoals).toBeGreaterThan(0);
    expect(dc.scoreMatrix.every((r) => Number.isFinite(r.probability) && r.probability >= 0)).toBe(true);
  });
});