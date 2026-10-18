/* ------------------------------------------------------------------ *
 * Fixture status helpers
 *
 * The provider layer normalises every source (ESPN, API-Football,
 * Football-Data.org) down to `FixtureStatus` = TIMED | LIVE | FINISHED |
 * POSTPONED. Some providers also expose a native status string
 * (FT / AET / PEN / IN_PLAY / SCHEDULED …), so both are inspected before
 * deciding whether a match is still ahead of kick-off.
 *
 * The parlay builder only offers matches that have NOT started: a leg on
 * a finished or in-play match cannot be placed, and would settle
 * instantly against a score the user never saw.
 * ------------------------------------------------------------------ */

/** Provider codes that mean the match is already over. */
const FINISHED_CODES = new Set([
  'FT', 'AET', 'PEN', 'FINISHED', 'AWD', 'WO', 'ABANDONED',
  'CANC', 'CANCELLED', 'SUSP', 'SUSPENDED',
]);

/** Provider codes that mean the match is under way. */
const LIVE_CODES = new Set([
  'LIVE', 'IN_PLAY', 'INPLAY', 'IN PROGRESS', 'PAUSED', 'HT', '1H', '2H',
  'ET', 'BT', 'P', 'PEN_LIVE', 'BREAK',
]);

/** Provider codes that explicitly mean the match is still to come. */
const UPCOMING_CODES = new Set([
  'TIMED', 'SCHEDULED', 'NS', 'TBD', 'NOT_STARTED', 'NOT STARTED',
  'PRE', 'PRE_KICKOFF',
]);

/** Collect any provider-native status strings carried on the fixture. */
function rawStatuses(fixture: any): string[] {
  return [
    fixture?.statusShort,
    fixture?.rawStatus,
    fixture?.providerStatus,
    fixture?.matchStatus,
    fixture?.espnState,
  ]
    .filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
    .map((v) => v.trim().toUpperCase());
}

/**
 * True only when the match is still ahead of kick-off, i.e. it can carry a
 * new parlay leg.
 *
 * Finished (`FT`, `AET`, `PEN`), in-play (`LIVE`, `IN_PLAY`) and postponed
 * fixtures are all rejected. A fixture with an unrecognised status is only
 * accepted when it carries an explicit upcoming provider code, so we never
 * surface a match we cannot place a bet on.
 */
export function isUpcomingFixture(fixture: any): boolean {
  if (!fixture) return false;

  const status = String(fixture.status ?? '').toUpperCase();

  // The normalised status is authoritative when present.
  if (status === 'FINISHED' || status === 'LIVE') return false;
  if (status === 'POSTPONED') return false;

  const raws = rawStatuses(fixture);
  for (const code of raws) {
    if (FINISHED_CODES.has(code) || LIVE_CODES.has(code)) return false;
  }

  if (status === 'TIMED') return true;

  // Unknown normalised status: accept only an explicit upcoming code.
  return raws.some((code) => UPCOMING_CODES.has(code));
}

/** Keep only the fixtures that are still ahead of kick-off. */
export function filterUpcomingFixtures<T = any>(fixtures: readonly T[] | null | undefined): T[] {
  return (fixtures ?? []).filter((f) => isUpcomingFixture(f as any));
}

/**
 * True when the fixture is still ahead of kick-off *and* its scheduled start
 * time is in the future.
 *
 * Providers occasionally leave a stale `TIMED` status on a match that has
 * already begun, so the wall clock is checked on top of the status codes. A
 * fixture without a parseable kick-off time is rejected: we cannot prove it has
 * not already started, and a leg on a match that is under way or over would
 * settle instantly against a score the user never saw.
 */
export function isPreKickoffFixture(fixture: any, now: number = Date.now()): boolean {
  if (!isUpcomingFixture(fixture)) return false;

  const raw = fixture?.kickoffTime ?? fixture?.date;
  if (!raw) return false;
  const kickoff = new Date(raw).getTime();
  if (!Number.isFinite(kickoff)) return false;

  return kickoff > now;
}

/**
 * Keep only fixtures that are upcoming and have not yet kicked off. Used by
 * every parlay generator (web API and Discord) so finished, in-play, halted and
 * already-started matches can never become a leg.
 */
export function filterPreKickoffFixtures<T = any>(
  fixtures: readonly T[] | null | undefined,
  now: number = Date.now(),
): T[] {
  return (fixtures ?? []).filter((f) => isPreKickoffFixture(f as any, now));
}

/**
 * True when the match is being played right now — in play, at half-time or
 * temporarily paused. Finished, upcoming and postponed fixtures are excluded.
 */
export function isActiveLiveFixture(fixture: any): boolean {
  if (!fixture) return false;

  const status = String(fixture.status ?? '').toUpperCase();
  if (status === 'LIVE') return true;
  if (status === 'FINISHED' || status === 'POSTPONED') return false;

  // Unknown/unmapped normalised status: trust an explicit live provider code
  // (IN_PLAY, PAUSED, HT, 1H, 2H, …).
  return rawStatuses(fixture).some((code) => LIVE_CODES.has(code));
}

/**
 * Human label for the live clock: the provider's own minute ("68'", "45'+2'"),
 * "HT" at half-time, or "LIVE" when the provider has not published a clock.
 * Never estimated from the wall clock.
 */
export function liveClockLabel(fixture: any): string {
  if (!fixture) return 'LIVE';

  const providerStatus = fixture.providerStatus ? String(fixture.providerStatus).toUpperCase() : '';
  if (providerStatus.includes('HALFTIME')) return 'HT';

  const clock = fixture.liveClock ? String(fixture.liveClock).trim() : '';
  if (!clock) return 'LIVE';
  return clock.endsWith("'") ? clock : `${clock}'`;
}
