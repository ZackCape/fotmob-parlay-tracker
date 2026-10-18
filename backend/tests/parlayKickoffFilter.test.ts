import { describe, it, expect } from 'vitest';
import {
  isPreKickoffFixture,
  filterPreKickoffFixtures,
  isUpcomingFixture,
} from '../src/discord/fixtureStatus.js';

/**
 * The parlay generators must never build a leg on a match that has already
 * kicked off, is in play, is halted or is over. These cover the wall-clock guard
 * on top of the provider status codes.
 */
function fixture(overrides: Record<string, unknown> = {}): any {
  return {
    id: 'fx-1',
    league: 'EPL',
    status: 'TIMED',
    kickoffTime: new Date(Date.now() + 3 * 3600_000).toISOString(),
    homeTeam: { name: 'Home FC' },
    awayTeam: { name: 'Away FC' },
    ...overrides,
  };
}

const NOW = Date.UTC(2026, 9, 18, 15, 0, 0); // 2026-10-18T15:00:00Z
const FUTURE = new Date(NOW + 2 * 3600_000).toISOString();
const PAST = new Date(NOW - 60_000).toISOString();

describe('isPreKickoffFixture', () => {
  it('accepts a scheduled match whose kick-off is in the future', () => {
    expect(isPreKickoffFixture(fixture({ kickoffTime: FUTURE }), NOW)).toBe(true);
  });

  it('rejects a TIMED match whose kick-off has already passed', () => {
    expect(isPreKickoffFixture(fixture({ kickoffTime: PAST }), NOW)).toBe(false);
  });

  it('rejects a match with no kick-off time (fail-closed)', () => {
    expect(isPreKickoffFixture(fixture({ kickoffTime: '' }), NOW)).toBe(false);
    expect(isPreKickoffFixture(fixture({ kickoffTime: undefined, date: undefined }), NOW)).toBe(false);
  });

  it('rejects an unparseable kick-off time', () => {
    expect(isPreKickoffFixture(fixture({ kickoffTime: 'not-a-date' }), NOW)).toBe(false);
  });

  it.each([
    'FINISHED',
    'LIVE',
    'POSTPONED',
  ])('rejects the normalised %s status even with a future kick-off', (status) => {
    expect(isPreKickoffFixture(fixture({ status, kickoffTime: FUTURE }), NOW)).toBe(false);
  });

  it.each(['FT', 'AET', 'PEN', 'FINISHED', 'LIVE', 'IN_PLAY', 'HT', 'PAUSED', 'POSTPONED'])(
    'rejects the raw %s provider code',
    (code) => {
      // Un-normalised providers carry the code on statusShort/rawStatus.
      expect(isPreKickoffFixture(fixture({ status: '', statusShort: code, kickoffTime: FUTURE }), NOW)).toBe(false);
    },
  );

  it('always agrees with isUpcomingFixture as a precondition', () => {
    const live = fixture({ status: 'LIVE', kickoffTime: FUTURE });
    expect(isUpcomingFixture(live)).toBe(false);
    expect(isPreKickoffFixture(live, NOW)).toBe(false);
  });
});

describe('filterPreKickoffFixtures', () => {
  it('keeps only fixtures that are upcoming and not yet started', () => {
    const slate = [
      fixture({ id: 'keep', kickoffTime: FUTURE }),
      fixture({ id: 'started', kickoffTime: PAST }),
      fixture({ id: 'live', status: 'LIVE', kickoffTime: FUTURE }),
      fixture({ id: 'finished', status: 'FINISHED', kickoffTime: PAST }),
      fixture({ id: 'postponed', status: 'POSTPONED', kickoffTime: FUTURE }),
      fixture({ id: 'raw-ht', status: '', statusShort: 'HT', kickoffTime: FUTURE }),
    ];

    expect(filterPreKickoffFixtures(slate, NOW).map((f) => f.id)).toEqual(['keep']);
  });

  it('handles null/undefined input safely', () => {
    expect(filterPreKickoffFixtures(null)).toEqual([]);
    expect(filterPreKickoffFixtures(undefined)).toEqual([]);
  });

  it('defaults to the current wall clock', () => {
    const soon = fixture({ kickoffTime: new Date(Date.now() + 3600_000).toISOString() });
    expect(filterPreKickoffFixtures([soon]).map((f) => f.id)).toEqual(['fx-1']);
  });
});
