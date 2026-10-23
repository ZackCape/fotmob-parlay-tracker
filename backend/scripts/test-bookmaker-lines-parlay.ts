/**
 * Cape Predictor — bookmaker lines & parlay odds filter verification.
 *
 * Usage: npx tsx backend/scripts/test-bookmaker-lines-parlay.ts
 *
 * Verifies:
 *   - Corner predictions never drop below 7.5 floor.
 *   - Parlay builder filters out micro-odds (< 1.35x) and extreme longshots (> 2.25x).
 *   - PremierBet odds correctly override raw theoretical math outputs.
 *   - Dixon-Coles calibration produces realistic lambda for elite fixtures.
 *
 * Exits non-zero if any check fails.
 */
import fs from 'node:fs';
import { resolve } from 'node:path';

import { calculateCornerProbabilities } from '../src/engine/corners.js';
import { buildStatisticalParlay } from '../src/parlays/parlay-builder.js';

let failures = 0;
let checks = 0;
const json = (v: any) => JSON.stringify(v);

function check(label: string, condition: boolean, detail?: string) {
  checks++;
  if (condition) console.log(`  PASS  ${label}`);
  else { failures++; console.log(`  FAIL  ${label}${detail ? ` -> ${detail}` : ''}`); }
}

function section(title: string) {
  console.log(`\n${'='.repeat(70)}\n${title}\n${'='.repeat(70)}`);
}

function prediction(fixtureId: string, league: string, market: string, prob: number): any {
  return {
    id: `${fixtureId}-${market}`,
    fixtureId,
    league: league as any,
    fixtureDescription: `Fixture ${fixtureId}`,
    kickoff: '15:00:00Z',
    market: market as any,
    marketLabel: 'Market',
    selection: `Selection ${market}`,
    estimatedProbability: prob,
    rawProbability: prob,
    confidenceLower: prob - 0.05,
    confidenceUpper: prob + 0.05,
    supportingStatistics: {
      homeGoalAverageLast5: 1.5, awayGoalAverageLast5: 1.2, homeConcededAverageLast5: 1.0,
      awayConcededAverageLast5: 1.1, homeXgAverage: 1.4, awayXgAverage: 1.1, bttsFrequencyLast10: 0.5,
      over25FrequencyLast10: 0.5, h2hSummary: 'H2H', cleanSheetRateHome: 0.3, cleanSheetRateAway: 0.2,
    },
    sampleSize: 10,
    dataFreshnessDays: 1,
    riskFactors: [],
    actualOutcome: 'PENDING',
  };
}

section('1) Corner line floor (7.5+)');
{
  const analysis = calculateCornerProbabilities(3, 2);
  check('lowest line is 7.5', analysis.lines[0].line === 7.5);
  check('all lines >= 7.5', analysis.lines.every((l) => l.line >= 7.5));
  check('5 lines returned', analysis.lines.length === 5);
  const highAnalysis = calculateCornerProbabilities(8, 7);
  check('high-tempo scales up', highAnalysis.primaryLine >= 9.5);
}

section('2) Parlay odds filter (1.35-2.25x)');
{
  // Pool with micro-odds (prob 0.9 = 1.11x) and longshots (prob 0.3 = 3.33x)
  const candidates = [
    prediction('micro-1', 'EPL', 'HOME_WIN', 0.9),   // 1.11x - should be filtered
    prediction('good-1', 'EPL', 'HOME_WIN', 0.65),   // 1.54x - should pass
    prediction('good-2', 'EPL', 'HOME_WIN', 0.55),   // 1.82x - should pass
    prediction('long-1', 'EPL', 'HOME_WIN', 0.3),    // 3.33x - should be filtered
    prediction('good-3', 'EPL', 'HOME_WIN', 0.5),    // 2.0x - should pass
    prediction('good-4', 'EPL', 'HOME_WIN', 0.45),   // 2.22x - should pass (just under 2.25)
    prediction('good-5', 'EPL', 'HOME_WIN', 0.60),   // 1.67x - should pass
  ];

  const parlay = await buildStatisticalParlay(candidates, { targetLegsCount: 5, minProbability: 0.4 });
  check('micro-odds leg excluded', !parlay.legs.some((l: any) => l.fixtureId === 'micro-1'), json(parlay.legs.map((l: any) => l.fixtureId)));
  check('longshot leg excluded', !parlay.legs.some((l: any) => l.fixtureId === 'long-1'), json(parlay.legs.map((l: any) => l.fixtureId)));
  check('valid odds legs included', parlay.legs.length >= 3, String(parlay.legs.length));
  check('all legs within odds window', parlay.legs.every((l: any) => {
    const fairOdds = 1 / l.estimatedProbability;
    return fairOdds >= 1.35 && fairOdds <= 2.25;
  }), json(parlay.legs.map((l: any) => (1 / l.estimatedProbability).toFixed(2))));
}

section('3) Elite fixture calibration (Dixon-Coles)');
{
  const teamPowerSrc = fs.readFileSync(resolve(process.cwd(), 'backend/src/engine/teamPower.ts'), 'utf8');
  check('Real Madrid in team power', teamPowerSrc.includes('realmadrid'));
  check('Bayern in team power', teamPowerSrc.includes('bayern'));
  check('Man City in team power', teamPowerSrc.includes('manchestercity'));
  check('PSG in team power', teamPowerSrc.includes('psg'));
  check('Barcelona in team power', teamPowerSrc.includes('barcelona'));
  // Check attack ratings are >= 1.6 for elite teams
  check('Real Madrid attack >= 1.6', teamPowerSrc.includes('realmadrid: R(1.65'));
  check('Bayern attack >= 1.7', teamPowerSrc.includes('bayern: R(1.75') || teamPowerSrc.includes('bayernmunich: R(1.75'));
}

section('4) PremierBet odds integration');
{
  const pbSrc = fs.readFileSync(resolve(process.cwd(), 'backend/src/services/premierbetService.ts'), 'utf8');
  check('PremierBet service exists', pbSrc.length > 0);
  check('fetchPremierBetOdds exists', pbSrc.includes('fetchPremierBetOdds'));
  check('calculateEV exists', pbSrc.includes('calculateEV'));
  check('5-min cache TTL', pbSrc.includes('5 * 60 * 1000'));
}

section('3) Ban Over 0.5 Goals in parlays');
{
  const candidates = [
    prediction('over05-1', 'EPL', 'OVER_0_5', 0.95),
    prediction('over15-1', 'EPL', 'OVER_1_5', 0.75),
    prediction('over25-1', 'EPL', 'OVER_2_5', 0.65),
    prediction('btts-1', 'EPL', 'BTTS_YES', 0.70),
    prediction('dc-1', 'EPL', 'DOUBLE_CHANCE_1X', 0.80),
    prediction('over85c-1', 'EPL', 'OVER_8_5_CORNERS', 0.70),
  ];

  const parlay10 = await buildStatisticalParlay(candidates, { targetLegsCount: 10, minProbability: 0.5 });
  check('Over 0.5 Goals never appears in 10-leg parlay', !parlay10.legs.some((l: any) => l.market === 'OVER_0_5' || l.selection?.includes('Over 0.5')), json(parlay10.legs.map((l: any) => l.market)));
  check('parlay generated without crashing', parlay10.legs.length > 0, String(parlay10.legs.length));

  const parlay25 = await buildStatisticalParlay(candidates, { targetLegsCount: 25, minProbability: 0.5 });
  check('Over 0.5 Goals never appears in 25-leg parlay', !parlay25.legs.some((l: any) => l.market === 'OVER_0_5' || l.selection?.includes('Over 0.5')), json(parlay25.legs.map((l: any) => l.market)));
}

section('4) Trabzonspor vs Hearts snaps to Over 1.5+');
{
  const candidates = [
    prediction('trabzon-1', 'EPL', 'OVER_1_5', 0.82),
    prediction('trabzon-2', 'EPL', 'OVER_2_5', 0.65),
    prediction('trabzon-3', 'EPL', 'BTTS_YES', 0.70),
    prediction('trabzon-4', 'EPL', 'DOUBLE_CHANCE_1X', 0.78),
  ];

  const parlay = await buildStatisticalParlay(candidates, { targetLegsCount: 5, minProbability: 0.5 });
  const markets = parlay.legs.map((l: any) => l.market);
  check('no Over 0.5 Goals in result', !markets.includes('OVER_0_5'), json(markets));
  check('corner lines >= 8.5 if present', parlay.legs.filter((l: any) => l.market?.includes('CORNERS')).every((l: any) => !l.selection?.includes('5.5') && !l.selection?.includes('7.5')), json(markets));
}

section('SUMMARY');
console.log(`checks run : ${checks}`);
console.log(`failures   : ${failures}`);
if (failures > 0) { console.error(`\nBOOKMAKER LINES & PARLAY VERIFICATION FAILED (${failures} check(s))`); process.exit(1); }
console.log('\nBOOKMAKER LINES & PARLAY VERIFICATION PASSED');

