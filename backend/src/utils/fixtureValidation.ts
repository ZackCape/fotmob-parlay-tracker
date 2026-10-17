/**
 * Trusted validation for football fixtures.
 * A fixture is "verified" only if its dataSource was assigned by a real
 * provider adapter (API-Football or Football-Data.org). Synthetic/archive
 * fixtures are never treated as verified live/current fixtures.
 */
export function isVerifiedFixture(fixture: any): boolean {
  if (!fixture || typeof fixture !== 'object') return false;
  const source = String(fixture.dataSource || '');
  if (!source) return false;
  // Trusted providers only
  if (!/api-football|football-data/i.test(source)) return false;
  // Required identity fields
  if (!fixture.id || !fixture.homeTeam?.name || !fixture.awayTeam?.name) return false;
  if (!fixture.kickoffTime || !fixture.league) return false;
  const kickoff = new Date(fixture.kickoffTime).getTime();
  if (!isFinite(kickoff)) return false;
  // Reject obvious synthetic/archive id patterns
  if (/calendar|archive|historical|offline/i.test(fixture.id)) return false;
  return true;
}

export function isVerifiedDataSource(source: any): boolean {
  const s = String(source || '');
  return /api-football|football-data/i.test(s);
}