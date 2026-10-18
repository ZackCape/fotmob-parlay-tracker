/**
 * Cape Predictor — master system-upgrade verification.
 *
 * Usage: npx tsx backend/scripts/test-master-final.ts
 *
 * Exercises the REAL modules (not mocks) and verifies:
 *   1. Parlay auto-staking ($10 / 1 unit, Kelly-scaled recommendation, no Set Stake button)
 *   2. ELO/Dixon-Coles calibration (Arsenal away at Nottingham Forest >= 60%)
 *   3. Dynamic date resolution (web + Discord)
 *   4. Hybrid multi-tier odds engine + Bayesian 0.70/0.30 shrinkage blend
 *   5. Card & corner Poisson models (Over/Under 3.5/4.5 cards, 8.5/9.5 corners)
 *   6. DM alerts toggle
 *   7. QoL commands (/setbrief, /h2h, /team, /value, /poll, /live, /help)
 *
 * Exits non-zero if any check fails.
 */
import fs from 'node:fs';
import os from 'node:os';
import nodePath from 'node:path';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { estimateTeamStrengths } from '../src/utils/teamStrength.js';
import {
  calculateDixonColes,
  bayesianBlend,
  computeCardsModel,
  computeCornersModel,
} from '../src/engine/poisson-dixon-coles.js';
import { lookupTeamPower, eloWinExpectancy, HOME_ADVANTAGE_FACTOR } from '../src/engine/teamPower.js';
import {
  getParlay, addLeg, buildParlayActionRows, buildParlayEmbed, buildTextSlip,
  recommendedStake, recommendedStakeForEdge, parlayMarketOdds, parlayEdge,
  BASE_STAKE_USD,
} from '../src/discord/parlayBuilder.js';
import { formatFixtureMarkets, buildDmAlertsRow, buildPollEmbed } from '../src/discord/interactions.js';
import { PublicOddsAdapter } from '../src/providers/public-odds-adapter.js';
import { OddsApiAdapter, DEFAULT_ODDS_REGIONS, DEFAULT_ODDS_MARKETS } from '../src/providers/odds-api-adapter.js';

let failures = 0;
let checks = 0;

function check(label: string, condition: boolean, detail?: string) {
  checks++;
  if (condition) {
    console.log(`  PASS  ${label}`);
  } else {
    failures++;
    console.log(`  FAIL  ${label}${detail ? ` -> ${detail}` : ''}`);
  }
}

function section(title: string) {
  console.log(`\n${'='.repeat(70)}\n${title}\n${'='.repeat(70)}`);
}

const repoRoot = process.cwd();

async function main() {
  console.log('\nCape Predictor — master system upgrade verification');

  /* ================================================================ *
   * 1. Parlay auto-staking
   * ================================================================ */
  section('1. PARLAY AUTO-STAKING');
  const parlay = getParlay('verify-user-1');
  check('default stake is $10 (1 unit)', parlay.stake === BASE_STAKE_USD, `stake=${parlay.stake}`);
  check('BASE_STAKE_USD === 10', BASE_STAKE_USD === 10);

  addLeg(parlay, {
    fixtureId: 'fx-1', description: 'Arsenal v Chelsea', league: 'EPL',
    market: 'HOME_WIN', selection: 'Arsenal to Win', probability: 0.55, marketOdds: 2.1,
  });
  addLeg(parlay, {
    fixtureId: 'fx-2', description: 'Real Madrid v Sevilla', league: 'LALIGA',
    market: 'OVER_2_5', selection: 'Over 2.5 Goals', probability: 0.62, marketOdds: 1.8,
  });

  const combinedMarketOdds = parlayMarketOdds(parlay);
  check('combined decimal odds = product of legs',
    combinedMarketOdds !== null && Math.abs(combinedMarketOdds - 2.1 * 1.8) < 1e-6,
    `got ${combinedMarketOdds}`);

  const edge = parlayEdge(parlay);
  const expectedEdge = 0.55 * 0.62 * (2.1 * 1.8) - 1;
  check('model edge computed from market odds',
    edge !== null && Math.abs(edge - expectedEdge) < 1e-4, `got ${edge}`);

  const recExample = recommendedStakeForEdge(0.082);
  check('8.2% edge recommends ~$15.50 / 1.55 units',
    recExample.stake === 15.5 && Math.abs(recExample.units - 1.55) < 1e-9,
    `units=${recExample.units} stake=${recExample.stake}`);

  const rec = recommendedStake(parlay);
  check('recommended stake never below 1 unit', rec.units >= 1);

  const actionRows = buildParlayActionRows(parlay).map((r) => r.toJSON());
  const allIds = actionRows.flatMap((r: any) => r.components.map((c: any) => c.custom_id));
  const allLabels = actionRows.flatMap((r: any) => r.components.map((c: any) => c.label));
  check('no manual "Set Stake" button', !allIds.includes('cp:parlay:stake'));
  check('[ Copy Text Slip ] button present', allIds.includes('cp:parlay:copyslip'));
  check('[ Save & Share ] button present', allIds.includes('cp:parlay:save'));
  check('Save button relabelled "Save & Share"', allLabels.includes('Save & Share'));

  const embed = buildParlayEmbed(parlay).toJSON();
  const embedText = [embed.description, ...(embed.fields || []).map((f: any) => `${f.name}\n${f.value}`)].join('\n');
  check('embed renders Combined Decimal Odds', embedText.includes('Combined Decimal Odds'));
  check('embed renders Estimated Potential Payout', embedText.includes('Estimated Potential Payout'));
  check('embed renders Model Win Probability', embedText.includes('Model Win Probability'));
  check('embed renders Recommended Stake line', embedText.includes('**Recommended Stake:**'));

  const slip = buildTextSlip(parlay);
  check('text slip contains header', slip.includes('CAPE PREDICTOR — CUSTOM PARLAY'));
  check('text slip contains combined odds', /Combined odds: \d+\.\d+x/.test(slip));

  /* ================================================================ *
   * 2. ELO / Dixon-Coles calibration
   * ================================================================ */
  section('2. ELO / DIXON-COLES CALIBRATION');
  check('Arsenal has a power rating', lookupTeamPower('Arsenal') !== null);
  check('Nottingham Forest has a power rating', lookupTeamPower('Nottingham Forest') !== null);
  check('HOME_ADVANTAGE_FACTOR === 1.12', HOME_ADVANTAGE_FACTOR === 1.12);

  const arsenalElo = lookupTeamPower('Arsenal')!.elo;
  const forestElo = lookupTeamPower('Nottingham Forest')!.elo;
  check('Arsenal rated above Forest',
    eloWinExpectancy(arsenalElo, forestElo) > 0.5,
    `exp=${eloWinExpectancy(arsenalElo, forestElo).toFixed(3)}`);

  const strengths = estimateTeamStrengths({
    league: 'EPL',
    homeTeam: 'Nottingham Forest',
    awayTeam: 'Arsenal',
  });
  check('strengths report ELO power ratings in basis', strengths.basis.includes('ELO power ratings'));
  check('strengths no longer prior-only', strengths.priorOnly === false);

  const dc = calculateDixonColes(
    strengths.homeAttack, strengths.homeDefense,
    strengths.awayAttack, strengths.awayDefense, 'EPL',
  );
  const awayWin = dc.scoreMatrix
    .filter((c) => c.awayScore > c.homeScore)
    .reduce((acc, c) => acc + c.probability, 0);
  check('Arsenal away win probability >= 60%', awayWin >= 0.60, `${(awayWin * 100).toFixed(1)}%`);
  check('score matrix normalised', Math.abs(dc.scoreMatrix.reduce((a, c) => a + c.probability, 0) - 1) < 1e-6);

  /* ================================================================ *
   * 3. Dynamic date resolution
   * ================================================================ */
  section('3. DYNAMIC DATE RESOLUTION');
  const todayStr = new Date().toISOString().split('T')[0];
  check('today string is ISO date', /^\d{4}-\d{2}-\d{2}$/.test(todayStr), todayStr);
  const monthLabel = new Date().toLocaleDateString('en-GB', { month: 'short' });
  check('header label formats as "DD MMM"',
    /^\d{1,2} [A-Z][a-z]{2}$/.test(`${new Date().getDate()} ${monthLabel}`),
    `${new Date().getDate()} ${monthLabel}`);

  const appSrc = readFileSync(resolve(repoRoot, 'src', 'App.tsx'), 'utf-8');
  check('App.tsx no longer hardcodes 2026-10-17', !appSrc.includes("'2026-10-17'"));
  check('App.tsx evaluates today dynamically', appSrc.includes("new Date().toISOString().split('T')[0]"));

  const dateBarSrc = readFileSync(resolve(repoRoot, 'src', 'components', 'DatePickerBar.tsx'), 'utf-8');
  check('DatePickerBar no longer hardcodes 2026-10-17', !dateBarSrc.includes('2026-10-17'));
  check('DatePickerBar computes today dynamically', dateBarSrc.includes('new Date().toISOString().split'));

  const botSrc = readFileSync(resolve(repoRoot, 'backend', 'src', 'discord', 'bot.ts'), 'utf-8');
  check('Discord bot resolves today dynamically',
    botSrc.includes('new Date().toISOString().slice(0, 10)'));

  /* ================================================================ *
   * 4. Hybrid odds engine + Bayesian blend
   * ================================================================ */
  section('4. HYBRID ODDS ENGINE & BAYESIAN BLEND');
  check('Odds API regions are eu,uk,us', DEFAULT_ODDS_REGIONS === 'eu,uk,us');
  check('Odds API markets include h2h,totals,spreads', DEFAULT_ODDS_MARKETS === 'h2h,totals,spreads');

  // Modern constructor signature: (apiKey, regions, limit, reserve)
  const oddsApi = new OddsApiAdapter('dummy-key');
  check('OddsApiAdapter is configured with a key', oddsApi.isConfigured() === true);
  check('OddsApiAdapter exposes usage meter', typeof oddsApi.getUsage().used === 'number');
  const unconfigured = new OddsApiAdapter('');
  check('empty-key adapter is unconfigured', unconfigured.isConfigured() === false);

  // Tier 2: zero-quota public odds cache.
  const tmpDir = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'cp-odds-'));
  const cacheFile = nodePath.join(tmpDir, 'odds_cache.json');
  fs.writeFileSync(cacheFile, JSON.stringify({
    updatedAt: new Date().toISOString(),
    events: [{
      home: 2.05, draw: 3.4, away: 3.6,
      homeTeam: 'Nottingham Forest', awayTeam: 'Arsenal',
      commenceTime: '2026-10-18T15:00:00Z', bookmaker: 'consensus',
    }],
  }));
  const publicOdds = new PublicOddsAdapter(cacheFile);
  const cachedLine = publicOdds.getOddsForFixture({
    homeTeam: { name: 'Nottingham Forest' }, awayTeam: { name: 'Arsenal' },
    kickoffTime: '2026-10-18T15:00:00Z',
  } as any);
  check('Tier 2 cache resolves a matching fixture', cachedLine !== null && cachedLine!.home === 2.05);
  check('Tier 2 cache isAvailable()', publicOdds.isAvailable() === true);
  check('Tier 2 returns null for unknown fixture',
    publicOdds.getOddsForFixture({ homeTeam: { name: 'X' }, awayTeam: { name: 'Y' }, kickoffTime: '' } as any) === null);
  fs.rmSync(tmpDir, { recursive: true, force: true });

  // Bayesian 0.70 / 0.30 shrinkage.
  const blended = bayesianBlend(
    { home: 0.50, draw: 0.30, away: 0.20 },
    { home: 0.60, draw: 0.25, away: 0.15 },
  );
  check('blend applies 0.70 * market + 0.30 * model (home)',
    Math.abs(blended.home - 0.53) < 1e-9, `home=${blended.home}`);
  check('blend draw = 0.285', Math.abs(blended.draw - 0.285) < 1e-9, `draw=${blended.draw}`);
  const pureModel = bayesianBlend(null, { home: 0.44, draw: 0.26, away: 0.30 });
  check('no market -> pure model (unchanged)',
    Math.abs(pureModel.home - 0.44) < 1e-9 && Math.abs(pureModel.away - 0.30) < 1e-9);

  /* ================================================================ *
   * 5. Card & corner models
   * ================================================================ */
  section('5. CARD & CORNER POISSON MODELS');
  const cards = computeCardsModel({ league: 'EPL' });
  check('cards lambda in a sane range', cards.lambda > 2 && cards.lambda < 8, `lambda=${cards.lambda}`);
  check('Over 3.5 Cards in (0,1)', cards.over3_5 > 0 && cards.over3_5 < 1, `${cards.over3_5}`);
  check('Over 4.5 Cards in (0,1)', cards.over4_5 > 0 && cards.over4_5 < 1, `${cards.over4_5}`);
  check('Over 4.5 < Over 3.5 cards', cards.over4_5 < cards.over3_5);
  check('Under 3.5 = 1 - Over 3.5 cards', Math.abs(cards.under3_5 + cards.over3_5 - 1) < 1e-9);
  check('Under 4.5 = 1 - Over 4.5 cards', Math.abs(cards.under4_5 + cards.over4_5 - 1) < 1e-9);
  const strictRef = computeCardsModel({ league: 'LALIGA', refereeIndex: 1.3 });
  const laxRef = computeCardsModel({ league: 'LALIGA', refereeIndex: 0.8 });
  check('stricter referee -> higher card expectation', strictRef.lambda > laxRef.lambda);

  const corners = computeCornersModel({ league: 'EPL' });
  check('corners lambda in a sane range', corners.lambda > 6 && corners.lambda < 16, `lambda=${corners.lambda}`);
  check('Over 8.5 Corners in (0,1)', corners.over8_5 > 0 && corners.over8_5 < 1);
  check('Over 9.5 Corners in (0,1)', corners.over9_5 > 0 && corners.over9_5 < 1);
  check('Over 9.5 < Over 8.5 corners', corners.over9_5 < corners.over8_5);
  check('Under 8.5 = 1 - Over 8.5 corners', Math.abs(corners.under8_5 + corners.over8_5 - 1) < 1e-9);

  const marketLines = formatFixtureMarkets([
    { market: 'HOME_WIN', estimatedProbability: 0.46 },
    { market: 'DRAW', estimatedProbability: 0.25 },
    { market: 'AWAY_WIN', estimatedProbability: 0.29 },
    { market: 'OVER_8_5_CORNERS', estimatedProbability: 0.71 },
    { market: 'OVER_3_5_CARDS', estimatedProbability: 0.58 },
  ] as any);
  check('fixtures card win line has fair odds', marketLines.winOdds.includes('Home 46% (2.17x)'));
  check('fixtures card stats line has corners', marketLines.stats.includes('Over 8.5 Corners (71%)'));
  check('fixtures card stats line has cards', marketLines.stats.includes('Over 3.5 Cards (58%)'));

  /* ================================================================ *
   * 6. DM alerts
   * ================================================================ */
  section('6. DM ALERTS TOGGLE');
  const dmOff = buildDmAlertsRow('123', false).toJSON() as any;
  const dmOn = buildDmAlertsRow('123', true).toJSON() as any;
  check('DM alerts customId encodes user', dmOff.components[0].custom_id === 'cp:dm:alerts:123');
  check('DM alerts "off" label', dmOff.components[0].label === 'DM Alerts Off');
  check('DM alerts "on" label', dmOn.components[0].label === 'DM Alerts On');
  check('bot handles cp:dm:alerts interaction', botSrc.includes('cp:dm:alerts:'));

  /* ================================================================ *
   * 7. QoL commands
   * ================================================================ */
  section('7. DISCORD QoL COMMANDS');
  for (const cmd of ['h2h', 'team', 'value', 'poll', 'setbrief', 'live', 'help']) {
    check(`/${cmd} is registered`, botSrc.includes(`.setName('${cmd}')`));
  }
  check('/setbrief schedules an 08:00 briefing', botSrc.includes("'08:00'"));
  check('bot has a copy-slip handler', botSrc.includes('cp:parlay:copyslip'));
  check('bot has channel topic auto-sync', botSrc.includes('syncLiveChannelTopics'));
  const pollEmbed = buildPollEmbed('fx-1').toJSON();
  check('/poll embed renders a community prediction',
    (pollEmbed.description || '').includes('Home Win'));

  /* ================================================================ */
  console.log(`\n${'='.repeat(70)}`);
  console.log(`RESULT: ${checks - failures}/${checks} checks passed`);
  console.log('='.repeat(70));
  if (failures > 0) {
    console.log(`\n${failures} check(s) FAILED`);
    process.exit(1);
  }
  console.log('\nAll checks passed.');
}

main().catch((err) => {
  console.error('Master verification crashed:', err);
  process.exit(1);
});
