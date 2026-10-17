/**
 * Discord /fixtures command diagnostic.
 * Usage: npx tsx backend/scripts/test-discord-fixtures.ts [date]
 *
 * Logs exactly what embed data the bot would generate for today,
 * using the same shared DataProviderFactory the bot uses.
 */
import { DataProviderFactory } from '../src/providers/provider-factory.js';
import { config } from '../src/config/env.js';
import { isVerifiedFixture } from '../src/utils/fixtureValidation.js';

const DATE = process.argv[2] || new Date().toISOString().slice(0, 10);

function pct(n: number) { return `${(n * 100).toFixed(1)}%`; }

async function main() {
  const factory = new DataProviderFactory(config);
  const all = await factory.getFixturesByDate(DATE, 'ALL');
  const verified = all.filter(isVerifiedFixture);
  const rejected = all.filter((f: any) => !isVerifiedFixture(f));

  console.log(`=== /fixtures for ${DATE} ===`);
  console.log(`total returned : ${all.length}`);
  console.log(`verified       : ${verified.length}`);
  console.log(`rejected       : ${rejected.length}`);

  if (rejected.length) {
    console.log('\nRejected (not shown to users):');
    rejected.slice(0, 5).forEach((f: any) =>
      console.log(`  - ${f.homeTeam?.name} vs ${f.awayTeam?.name} [${f.dataSource}]`));
  }

  const bySource: Record<string, number> = {};
  verified.forEach((f: any) => { bySource[f.dataSource] = (bySource[f.dataSource] || 0) + 1; });
  console.log('\nSources:', JSON.stringify(bySource, null, 2));

  const byLeague: Record<string, number> = {};
  verified.forEach((f: any) => { byLeague[f.league] = (byLeague[f.league] || 0) + 1; });
  console.log('Leagues:', JSON.stringify(byLeague));

  console.log('\n=== Embed fields (Top calibrated picks) ===');
  const candidates: any[] = [];
  for (const fx of verified.slice(0, 12)) {
    try {
      const details = await factory.getMatchDetails(fx.id);
      if (details?.marketPredictions) candidates.push(...details.marketPredictions);
    } catch (e: any) {
      console.warn(`  details failed for ${fx.id}: ${e.message}`);
    }
  }
  const topPicks = candidates.sort((a, b) => b.estimatedProbability - a.estimatedProbability).slice(0, 5);
  if (topPicks.length === 0) {
    console.log('  (no predictions produced)');
  } else {
    topPicks.forEach((p) =>
      console.log(`  ${p.fixtureDescription} (${p.league}): ${p.selection} -> ${pct(p.estimatedProbability)}`));
  }

  console.log('\n=== Sample fixture rows ===');
  verified.slice(0, 10).forEach((f: any) => {
    const ko = f.kickoffTime ? new Date(f.kickoffTime).toISOString() : 'n/a';
    console.log(`  [${f.league}] ${f.homeTeam.name} vs ${f.awayTeam.name} | ${f.status} | kickoff ${ko} | ${f.dataSource}`);
  });

  console.log('\nFooter: Cape Predictor Engine \u2022 Powered by Dixon-Coles Probability Engine');
  console.log('Accent colour: 0x2563EB');
  console.log('Author/Title: Cape Predictor');
  console.log('Tagline: Football Intelligence. Smarter Predictions.');
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
