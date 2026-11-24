import { evaluateWalkForward } from '../src/engine/walk-forward.js';
import { FootballDataUkAdapter } from '../src/providers/football-data-uk-adapter.js';

const seasons = process.argv.slice(2).map(Number);
if (!seasons.length || seasons.some(year => !Number.isInteger(year) || year < 1993 || year > new Date().getUTCFullYear())) {
  throw new Error('Supply season starting years, e.g. tsx backend/scripts/benchmark-goals.ts 2024 2025');
}

const provider = new FootballDataUkAdapter();
const results = await Promise.all([...new Set(seasons)].map(season => provider.getCompletedSeasonFixtures(season)));
if (results.some(fixtures => !fixtures.length)) throw new Error('No completed fixtures for at least one requested season.');
const fixtures = results.flat();
const { comparison, report } = evaluateWalkForward(fixtures);
console.log(JSON.stringify({
  source: provider.name,
  fixtures: fixtures.length,
  leagues: Object.keys(report.leagueBreakdown),
  over25Comparison: comparison,
}, null, 2));
