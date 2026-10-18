import { describe, it, expect } from 'vitest';
import {
  ACTIVE_FIXTURE_TTL_MS,
  isActiveFixtureDate,
  fixtureCacheTtlMs,
} from '../src/providers/provider-factory.js';

/**
 * Fixture lists for a date that can still change are cached for 30 seconds.
 *
 * The point of the policy is that a burst of button clicks inside a live match
 * window collapses into one upstream request, while a settled date in the past
 * (or a distant date in the future) keeps the long analysis TTL. These pin the
 * boundary, including the timezone case where a fixture date is one day either
 * side of UTC midnight.
 */

const NOW = Date.UTC(2026, 9, 18, 18, 0, 0); // 2026-10-18T18:00:00Z
const DEFAULT_TTL = 15 * 60 * 1000;

function iso(offsetDays: number): string {
  return new Date(NOW + offsetDays * 86_400_000).toISOString().slice(0, 10);
}

describe('isActiveFixtureDate', () => {
  it('treats today as active', () => {
    expect(isActiveFixtureDate('2026-10-18', NOW)).toBe(true);
  });

  it('treats the neighbouring days as active (timezone-safe)', () => {
    expect(isActiveFixtureDate(iso(-1), NOW)).toBe(true);
    expect(isActiveFixtureDate(iso(1), NOW)).toBe(true);
  });

  it('treats settled and distant dates as inactive', () => {
    expect(isActiveFixtureDate('2026-10-15', NOW)).toBe(false);
    expect(isActiveFixtureDate('2026-10-25', NOW)).toBe(false);
  });

  it('fails open on an unparseable date', () => {
    expect(isActiveFixtureDate('not-a-date', NOW)).toBe(true);
    expect(isActiveFixtureDate('', NOW)).toBe(true);
  });

  it('uses a 30-second window', () => {
    expect(ACTIVE_FIXTURE_TTL_MS).toBe(30_000);
  });
});

describe('fixtureCacheTtlMs', () => {
  it('applies the short TTL to an active date', () => {
    expect(fixtureCacheTtlMs('2026-10-18', DEFAULT_TTL, ACTIVE_FIXTURE_TTL_MS, NOW)).toBe(30_000);
    expect(fixtureCacheTtlMs(iso(-1), DEFAULT_TTL, ACTIVE_FIXTURE_TTL_MS, NOW)).toBe(30_000);
  });

  it('applies the configured analysis TTL to an inactive date', () => {
    expect(fixtureCacheTtlMs('2026-09-01', DEFAULT_TTL, ACTIVE_FIXTURE_TTL_MS, NOW)).toBe(DEFAULT_TTL);
    expect(fixtureCacheTtlMs('2026-12-26', DEFAULT_TTL, ACTIVE_FIXTURE_TTL_MS, NOW)).toBe(DEFAULT_TTL);
  });

  it('is much shorter than the default analysis TTL', () => {
    expect(ACTIVE_FIXTURE_TTL_MS).toBeLessThan(DEFAULT_TTL / 10);
  });
});
