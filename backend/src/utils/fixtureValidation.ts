/**
 * Trusted validation for football fixtures.
 *
 * A fixture is "verified" only if its dataSource was assigned by a real
 * provider adapter. Synthetic/archive fixtures are never treated as verified
 * live/current fixtures.
 *
 * TRUSTED (real provider data):
 *   API-Football, Football-Data.org, ESPN, OpenLigaDB,
 *   Football-Data.co.uk, TheSportsDB, OpenFootball static datasets
 *
 * UNTRUSTED (synthetic / offline archive - never served as live):
 *   European Calendar Engine, Verified League Archive, Historical archive,
 *   FootballDatabase scraper
 */

/** dataSource fragments that indicate genuine provider data. */
const TRUSTED_SOURCES = [
  'api-football',
  'football-data.org',
  'football-data.co.uk',
  'espn',
  'openligadb',
  'thesportsdb',
  'the sports db',
  'openfootball (static',
];

/** dataSource fragments that indicate synthetic / offline archive data. */
const UNTRUSTED_SOURCES = [
  'european calendar',
  'verified league archive',
  'historical',
  'offline',
  'synthetic',
  'footballdatabase',
  'uefa live sync (synthetic)',
];

export function isVerifiedDataSource(source: any): boolean {
  const s = String(source || '').toLowerCase();
  if (!s) return false;
  if (UNTRUSTED_SOURCES.some((bad) => s.includes(bad))) return false;
  return TRUSTED_SOURCES.some((good) => s.includes(good));
}

export function isVerifiedFixture(fixture: any): boolean {
  if (!fixture || typeof fixture !== 'object') return false;
  // Required identity fields
  if (!fixture.id || !fixture.homeTeam?.name || !fixture.awayTeam?.name) return false;
  if (!fixture.kickoffTime || !fixture.league) return false;
  const kickoff = new Date(fixture.kickoffTime).getTime();
  if (!isFinite(kickoff)) return false;
  // Trusted provider data only
  if (!isVerifiedDataSource(fixture.dataSource)) return false;
  // Reject obvious synthetic/archive id patterns
  if (/calendar|archive|historical|offline/i.test(fixture.id)) return false;
  return true;
}
