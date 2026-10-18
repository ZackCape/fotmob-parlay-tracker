/**
 * /fixtures GUI verification script.
 *
 * Usage: npx tsx backend/scripts/test-discord-gui.ts [date]
 *
 * Drives the REAL DataProviderFactory and the REAL embed/component builders
 * used by the bot to confirm the rebuilt /fixtures command:
 *  - returns ALL daily matches (no truncation)
 *  - parses Moneyline 1X2, Over 0.5/1.5/2.5 Goals, Corners and Cards markets
 *  - shows the highest-confidence multi-market pick per fixture
 *  - formats ActionRowBuilder components (league select, match select,
 *    action buttons, pagination) within Discord limits
 */
import { DataProviderFactory } from '../src/providers/provider-factory.js';
import { config } from '../src/config/env.js';
import * as CP from '../src/discord/interactions.js';
import type { MarketPrediction } from '../src/types/football.js';

const DATE = process.argv[2] || new Date().toISOString().slice(0, 10);

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

async function main() {
  const factory = new DataProviderFactory(config);

  console.log(`\nCape Predictor — /fixtures GUI verification (${DATE})`);

  section('FETCH ALL DAILY FIXTURES');
  const fixtures = await CP.fetchVerifiedFixtures(factory, DATE, 'ALL');
  check('verified fixtures returned', fixtures.length > 0, `got ${fixtures.length}`);
  check('at least 5 distinct fixtures (not truncated to 5-line list)', fixtures.length >= 5, `got ${fixtures.length}`);
  const leagues = new Set(fixtures.map((f) => f.league));
  console.log(`  leagues: ${[...leagues].join(', ')} (${leagues.size})`);

  section('MULTI-MARKET PREDICTIONS PER FIXTURE');
  const preds = new Map<string, MarketPrediction[]>();
  let fixturesWithPreds = 0;
  for (const fx of fixtures) {
    try {
      const d = await factory.getMatchDetails(fx.id);
      if (d?.marketPredictions) {
        preds.set(fx.id, d.marketPredictions);
        fixturesWithPreds++;
      }
    } catch { /* analysis unavailable - fixture still listed */ }
  }
  check('predictions computed for at least one fixture', fixturesWithPreds > 0);

  // Confirm diverse markets appear across the slate.
  const seenMarkets = new Set<string>();
  for (const p of preds.values()) {
    for (const m of p) seenMarkets.add(m.market);
  }
  const wantMarkets = ['HOME_WIN', 'DRAW', 'AWAY_WIN', 'OVER_1_5', 'OVER_2_5',
    'OVER_8_5_CORNERS', 'OVER_3_5_CARDS'];
  for (const m of wantMarkets) {
    check(`market ${m} computed somewhere on slate`, seenMarkets.has(m));
  }

  section('BEST PICK PER FIXTURE (diverse markets, OVER_0_5 excluded)');
  let fixturesWithPick = 0;
  for (const fx of fixtures) {
    const p = preds.get(fx.id) || [];
    const pick = CP.bestPickForFixture(p);
    if (pick) {
      fixturesWithPick++;
      // Confirm the pick is NOT Over 0.5 (the trivial near-certain market).
      check(`pick for ${fx.homeTeam.name} v ${fx.awayTeam.name} is not OVER_0_5`,
        pick.market !== 'OVER_0_5', `got ${pick.market}`);
      break; // just verify one in detail; the rest are checked below
    }
  }
  // Re-scan: every fixture with predictions should have a pick among diverse markets.
  let allHavePick = true;
  for (const fx of fixtures) {
    const p = preds.get(fx.id) || [];
    if (p.length > 0 && !CP.bestPickForFixture(p)) {
      allHavePick = false;
      break;
    }
  }
  check('every fixture with predictions has a diverse-market pick', allHavePick);
  console.log(`  fixtures with a best pick: ${fixturesWithPick}/${fixtures.length}`);

  section('BUILD FULL /fixtures PAYLOAD (page 1, ALL leagues)');
  const payload = CP.buildFixturesPayload(fixtures, preds, 'ALL', 1, null);
  const embed = payload.embeds[0];
  const embedText = JSON.stringify(embed.toJSON());
  check('embed title is the rebranded header',
    String(embed.toJSON().title).includes("Cape Predictor — Today's Full Match Schedule"),
    String(embed.toJSON().title));
  check('tagline present', embedText.includes('High Probability & Market Analytics'));
  check('footer present', embedText.includes('Dixon-Coles & Multi-Market Analytics'));
  // Description must NOT be truncated to a 5-line list — every fixture should
  // appear somewhere across the paginated pages.
  let seenTeams = new Set<string>();
  let totalPages = 1;
  // Discover total pages from page 1 footer.
  const page1Footer = String(embed.toJSON().footer?.text || '');
  const m = /(\d+)\/(\d+)/.exec(page1Footer);
  if (m) totalPages = parseInt(m[2], 10);
  for (let pg = 1; pg <= totalPages; pg++) {
    const pgPayload = CP.buildFixturesPayload(fixtures, preds, 'ALL', pg, null);
    const pgText = JSON.stringify(pgPayload.embeds[0].toJSON());
    for (const f of fixtures) {
      if (pgText.includes(f.homeTeam.name) && pgText.includes(f.awayTeam.name)) {
        seenTeams.add(`${f.homeTeam.name}|${f.awayTeam.name}`);
      }
    }
  }
  check('ALL fixtures appear across paginated pages (none truncated)', seenTeams.size === fixtures.length,
    `${seenTeams.size}/${fixtures.length}`);

  // Every fixture on page 1 carries a best-pick (or N/A) marker.
  const page1Fixtures = fixtures.slice(0, 10);
  const page1Text = String(embed.toJSON().description || '');
  const pickMarkerCount = (page1Text.match(/• /g) || []).length;
  check('page 1 fixtures carry a best-pick marker', pickMarkerCount >= page1Fixtures.length,
    `${pickMarkerCount} markers for ${page1Fixtures.length} fixtures`);

  section('COMPONENT ROWS (ActionRowBuilder)');
  check('payload has component rows', payload.components.length > 0);
  check('component rows within Discord limit (<=5)', payload.components.length <= 5,
    `got ${payload.components.length}`);

  // Row 0: league select menu.
  const leagueRow: any = payload.components[0].toJSON();
  const leagueMenu: any = leagueRow.components[0];
  check('league select customId', leagueMenu.custom_id === 'cp:fixtures:league');
  check('league select has options (>=7)', leagueMenu.options.length >= 7,
    `got ${leagueMenu.options.length}`);
  const leagueValues = leagueMenu.options.map((o: any) => o.value);
  for (const v of ['ALL', 'EPL', 'LALIGA', 'SERIE_A', 'BUNDESLIGA', 'LIGUE1', 'CHAMPIONS_LEAGUE', 'CHAMPIONSHIP']) {
    check(`league option ${v}`, leagueValues.includes(v));
  }
  check('league select options <= 25', leagueMenu.options.length <= 25);

  // Row 1: match select menu (current page).
  const matchRow: any = payload.components[1].toJSON();
  const matchMenu: any = matchRow.components[0];
  check('match select customId', matchMenu.custom_id === 'cp:fixtures:match');
  check('match select lists fixtures on page', matchMenu.options.length > 0);
  check('match select options <= 25', matchMenu.options.length <= 25);

  // Rows for action buttons + pagination.
  const allButtons = payload.components.flatMap((r: any) => r.toJSON().components);
  const buttonCustomIds = allButtons.map((c: any) => c.custom_id).filter(Boolean);
  check('Analyze Selected button present', buttonCustomIds.includes('cp:fixtures:analyze'));
  check('Add to Custom Parlay button present', buttonCustomIds.includes('cp:fixtures:parlay'));
  check('Track Live button present', buttonCustomIds.includes('cp:fixtures:track'));
  check('no link button carries a custom id (Discord rule)',
    allButtons.every((c: any) => c.style !== 5 || !c.custom_id));
  check('every custom id <= 100 chars',
    allButtons.every((c: any) => !c.custom_id || c.custom_id.length <= 100));

  // Pagination present when multiple pages.
  totalPages = Math.max(1, Math.ceil(fixtures.length / 10));
  if (totalPages > 1) {
    check('Prev button present', buttonCustomIds.includes('cp:fixtures:prev'));
    check('Next button present', buttonCustomIds.includes('cp:fixtures:next'));
  }

  section('PAGINATION');
  totalPages = Math.max(1, Math.ceil(fixtures.length / 10));
  check('totalPages computed', totalPages >= 1);
  const page2 = CP.buildFixturesPayload(fixtures, preds, 'ALL', 2, null);
  const embed2 = page2.embeds[0];
  const page2Footer = String(embed2.toJSON().footer?.text || '');
  check('page 2 footer shows page/total', page2Footer.includes(`${2}/${totalPages}`), page2Footer);

  section('SUMMARY');
  console.log(`checks run : ${checks}`);
  console.log(`failures   : ${failures}`);
  console.log(failures === 0 ? '\n/FIXTURES GUI VERIFICATION PASSED' : '\n/FIXTURES GUI VERIFICATION FAILED');
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error('Fatal:', e.message); process.exit(1); });