import { describe, it, expect } from 'vitest';
import { isVerifiedFixture, isVerifiedDataSource } from '../src/utils/fixtureValidation.js';

describe('isVerifiedFixture', () => {
  const real = { id: 'apifx-1', homeTeam: { name: 'Everton' }, awayTeam: { name: 'Chelsea' }, kickoffTime: '2026-10-17T11:30:00Z', league: 'EPL', dataSource: 'API-Football (Live)' };
  const synthetic = { id: 'epl-2026-10-17-che-cry', homeTeam: { name: 'Chelsea' }, awayTeam: { name: 'Crystal Palace' }, kickoffTime: '2026-10-17T12:30:00Z', league: 'EPL', dataSource: 'European Calendar Engine' };

  it('accepts real fixture', () => expect(isVerifiedFixture(real)).toBe(true));
  it('rejects synthetic', () => expect(isVerifiedFixture(synthetic)).toBe(false));
  it('rejects missing dataSource', () => expect(isVerifiedFixture({ ...real, dataSource: '' })).toBe(false));
  it('rejects unknown dataSource', () => expect(isVerifiedFixture({ ...real, dataSource: 'Foo' })).toBe(false));
  it('rejects missing fields', () => expect(isVerifiedFixture({ id: 'x', dataSource: 'API-Football (Live)' })).toBe(false));
  it('rejects invalid kickoff', () => expect(isVerifiedFixture({ ...real, kickoffTime: 'not-a-date' })).toBe(false));
  it('rejects archive id pattern', () => expect(isVerifiedFixture({ ...real, id: 'archive-1', dataSource: 'API-Football (Live)' })).toBe(false));
  it('rejects null/undefined', () => { expect(isVerifiedFixture(null)).toBe(false); expect(isVerifiedFixture(undefined)).toBe(false); });
});

describe('isVerifiedDataSource', () => {
  it('accepts api-football', () => expect(isVerifiedDataSource('API-Football (Live)')).toBe(true));
  it('accepts football-data', () => expect(isVerifiedDataSource('Football-Data.org')).toBe(true));
  it('rejects others', () => expect(isVerifiedDataSource('European Calendar Engine')).toBe(false));
  it('rejects empty', () => expect(isVerifiedDataSource('')).toBe(false));
});