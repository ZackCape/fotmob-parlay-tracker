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
