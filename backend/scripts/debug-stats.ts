/**
 * ESPN match statistics diagnostic.
 * Usage: npx tsx backend/scripts/debug-stats.ts [date]
 */
import { EspnAdapter } from '../src/providers/espn-adapter.js';

const DATE = process.argv[2] || new Date().toISOString().slice(0, 10);

async function main() {
  const adapter = new EspnAdapter();
  const fixtures = await adapter.getFixturesByDate(DATE, 'ALL');
  console.log(`ESPN fixtures for ${DATE}: ${fixtures.length}`);
  if (!fixtures.length) { console.log('No ESPN fixtures found for this date.'); return; }

  const target = fixtures[0];
  console.log(`\nInspecting: ${target.homeTeam.name} vs ${target.awayTeam.name} (${target.id}, status=${target.status})`);

  const stats = await adapter.getMatchStats(target.externalId);
  if (!stats) { console.log('No stats returned.'); return; }

  console.log('\n--- Statistics ---');
  console.log(JSON.stringify(stats.statistics, null, 2));

  console.log('\n--- Events ---');
  stats.events.slice(0, 10).forEach(e =>
    console.log(`  ${e.minute || '-'}  ${e.team || '-'}  ${e.type}${e.label ? ' (' + e.label + ')' : ''}  ${e.player || ''}${e.assist ? `  assist: ${e.assist}` : ''}`));

  console.log('\n--- Lineups ---');
  console.log('  home XI:', stats.lineups.home?.startingXI?.length ?? 0, 'subs:', stats.lineups.home?.substitutes?.length ?? 0);
  console.log('  away XI:', stats.lineups.away?.startingXI?.length ?? 0, 'subs:', stats.lineups.away?.substitutes?.length ?? 0);

  console.log('\n--- Form (last five) ---');
  console.log('  home:', stats.form.home.join('') || '(none)');
  console.log('  away:', stats.form.away.join('') || '(none)');

  console.log('\n--- Full MatchAnalysis ---');
  const analysis = await adapter.getMatchDetails(target.id);
  if (!analysis) { console.log('  (analysis unavailable — identity could not be verified)'); return; }
  console.log('  fixture:', analysis.fixture.homeTeam.name, 'vs', analysis.fixture.awayTeam.name);
  console.log('  predictions:', analysis.marketPredictions.length);
  analysis.marketPredictions.slice(0, 5).forEach(p =>
    console.log('   -', p.marketLabel, (p.estimatedProbability * 100).toFixed(1) + '%'));
  console.log('  notes:', analysis.dataQualityNotes.join(' | '));
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
