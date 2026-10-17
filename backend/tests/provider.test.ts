import { describe, it, expect } from 'vitest';
import { DataProviderFactory } from '../src/providers/provider-factory.js';
import { config } from '../src/config/env.js';

describe('Data Provider & Fixture Integrity', () => {
  const factory = new DataProviderFactory({
    ...config,
    dataProvider: 'verified-archive', // Test verified archive adapter
  });

  it('retrieves fixtures for a given date and honors league filters', async () => {
    // 2026-10-17 is a Saturday
    const allFixtures = await factory.getFixturesByDate('2026-10-17', 'ALL');
    expect(allFixtures.length).toBeGreaterThan(0);

    const eplOnly = await factory.getFixturesByDate('2026-10-17', 'EPL');
    expect(eplOnly.every(f => f.league === 'EPL')).toBe(true);

    const chOnly = await factory.getFixturesByDate('2026-10-17', 'CHAMPIONSHIP');
    expect(chOnly.every(f => f.league === 'CHAMPIONSHIP')).toBe(true);
  });

  it('strictly preserves null values for unplayed match statistics instead of 0', async () => {
    const fixtures = await factory.getFixturesByDate('2026-10-24', 'EPL');
    const futureMatch = fixtures.find(f => f.status === 'TIMED');
    if (futureMatch) {
      // Must not fabricate statistics: statistics must be null
      expect(futureMatch.statistics).toBeNull();
      expect(futureMatch.homeScore).toBeNull();
      expect(futureMatch.awayScore).toBeNull();
    }
  });

  it('returns comprehensive match analysis bundle with Dixon-Coles and predictions', async () => {
    const fixtures = await factory.getFixturesByDate('2026-10-17', 'ALL');
    expect(fixtures.length).toBeGreaterThan(0);

    const first = fixtures[0];
    const details = await factory.getMatchDetails(first.id);

    expect(details).not.toBeNull();
    expect(details?.dixonColesParameters.homeExpectedGoals).toBeGreaterThan(0);
    expect(details?.dixonColesParameters.awayExpectedGoals).toBeGreaterThan(0);
    expect(details?.scoreMatrix.length).toBeGreaterThan(10);
    expect(details?.marketPredictions.length).toBeGreaterThan(5);
  });
});
