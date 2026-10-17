/**
 * Lightweight provider diagnostic script.
 * Usage: npx tsx backend/scripts/debug-providers.ts
 * Tests raw provider output for a target date without mutating application state.
 */
import { EspnAdapter } from '../src/providers/espn-adapter.js';
import { FootballDataOrgAdapter } from '../src/providers/football-data-adapter.js';
import { TheSportsDBAdapter } from '../src/providers/thesportsdb-adapter.js';
import { OpenLigaDBAdapter } from '../src/providers/openligadb-adapter.js';
import { FootballDataUkAdapter } from '../src/providers/football-data-uk-adapter.js';
import { OpenFootballGitHubAdapter } from '../src/providers/openfootball-github-adapter.js';
import { config } from '../src/config/env.js';

const DATE = process.argv[2] || '2026-10-17';

function line(t: string) { console.log('\n=== ' + t + ' ==='); }

async function main() {
  console.log('Cape Predictor provider diagnostics for', DATE);
  console.log('Football-Data.org key configured:', Boolean(config.footballDataOrgKey));


  // 0) ESPN (primary)
  line('EspnAdapter (primary, all leagues)');
  try {
    const a = new EspnAdapter();
    const fixtures = await a.getFixturesByDate(DATE, 'ALL');
    console.log('TOTAL ESPN fixtures:', fixtures.length);
    const byLeague: Record<string, number> = {};
    fixtures.forEach(f => { byLeague[f.league] = (byLeague[f.league] || 0) + 1; });
    console.log('by league:', JSON.stringify(byLeague));
    ['EPL', 'LALIGA', 'SERIE_A', 'LIGUE1', 'BUNDESLIGA', 'BUNDESLIGA2', 'CHAMPIONSHIP', 'CHAMPIONS_LEAGUE']
      .forEach(lg => console.log(`  ${lg}: ${byLeague[lg] || 0}`));
    fixtures.slice(0, 8).forEach(f =>
      console.log('  ', f.homeTeam.name, '-', f.awayTeam.name, f.homeScore, f.awayScore, `[${f.league}]`, f.status));
  } catch (e: any) {
    console.log('ERROR:', e.message);
  }

  // 1) Football-Data.org
  line('FootballDataOrgAdapter');
  try {
    const a = new FootballDataOrgAdapter(config.footballDataOrgKey);
    const fixtures = await a.getFixturesByDate(DATE, 'ALL');
    console.log('fixtures:', fixtures.length);
    fixtures.slice(0, 5).forEach(f =>
      console.log('  ', f.homeTeam.name, '-', f.awayTeam.name, f.homeScore, f.awayScore, `[${f.league}]`, `[${f.dataSource}]`));
    if (fixtures.length === 0) console.log('  (empty: free plan coverage/date restriction)');
  } catch (e: any) {
    console.log('ERROR:', e.message);
  }

  // 2) TheSportsDB
  line('TheSportsDBAdapter');
  try {
    const a = new TheSportsDBAdapter();
    const fixtures = await a.getFixturesByDate(DATE, 'ALL');
    console.log('raw events mapped:', fixtures.length);
    console.log('leagues seen:', [...new Set(fixtures.map(f => f.league))].join(', ') || '(none)');
    fixtures.slice(0, 5).forEach(f =>
      console.log('  ', f.homeTeam.name, '-', f.awayTeam.name, `[${f.league}]`, `[${f.dataSource}]`));
    if (fixtures.length === 0) console.log('  (empty: provider may be blocked/unavailable)');
  } catch (e: any) {
    console.log('ERROR:', e.message);
  }

  // 3) OpenLigaDB
  line('OpenLigaDBAdapter (bl1 / bl2)');
  try {
    const a = new OpenLigaDBAdapter();
    const fixtures = await a.getFixturesByDate(DATE, 'ALL');
    console.log('fixtures:', fixtures.length);
    console.log('leagues seen:', [...new Set(fixtures.map(f => f.league))].join(', ') || '(none)');
    fixtures.slice(0, 5).forEach(f =>
      console.log('  ', f.homeTeam.name, '-', f.awayTeam.name, `[${f.league}]`, `[${f.dataSource}]`));
  } catch (e: any) {
    console.log('ERROR:', e.message);
  }

  // 4) Football-Data.co.uk
  line('FootballDataUkAdapter');
  try {
    const a = new FootballDataUkAdapter();
    const fixtures = await a.getFixturesByDate(DATE, 'ALL');
    console.log('fixtures:', fixtures.length);
    fixtures.slice(0, 5).forEach(f =>
      console.log('  ', f.homeTeam.name, '-', f.awayTeam.name, `[${f.league}]`, `[${f.dataSource}]`));
    if (fixtures.length === 0) console.log('  (empty: season feed may not cover this date)');
  } catch (e: any) {
    console.log('ERROR:', e.message);
  }

  // 5) OpenFootball
  line('OpenFootballAdapter');
  try {
    const a = new OpenFootballGitHubAdapter();
    const fixtures = await a.getFixturesByDate(DATE, 'ALL');
    console.log('fixtures:', fixtures.length);
    fixtures.slice(0, 3).forEach(f =>
      console.log('  ', f.homeTeam.name, '-', f.awayTeam.name, f.homeScore, f.awayScore, `[${f.dataSource}]`));
  } catch (e: any) {
    console.log('ERROR:', e.message);
  }

  console.log('\nDone.');
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
