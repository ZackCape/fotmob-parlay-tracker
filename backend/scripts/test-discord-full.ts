/**
 * Full Discord interaction simulation.
 * Usage: npx tsx backend/scripts/test-discord-full.ts [date]
 *
 * Exercises the real shared DataProviderFactory + the real embed builders
 * used by the bot, for: /fixtures (league selector), /customparlay,
 * /livetracking and /help navigation.
 */
import { DataProviderFactory } from '../src/providers/provider-factory.js';
import { config } from '../src/config/env.js';
import * as CP from '../src/discord/interactions.js';

const DATE = process.argv[2] || '2026-10-17';

function embedText(e: any): string {
  return e.toJSON ? JSON.stringify(e.toJSON()) : JSON.stringify(e);
}

async function main() {
  const factory = new DataProviderFactory(config);

  console.log(`\n############ /fixtures  (${DATE}) ############`);
  const picker = CP.leaguePickerEmbed();
  console.log('League picker embed:', picker.data.title);
  const row = CP.buildLeagueSelectRow();
  const json = row.toJSON();
  const menu: any = json.components[0];
  console.log(`Selector customId: ${menu.custom_id}`);
  console.log('Options:');
  menu.options.forEach((o: any) => console.log(`   - ${o.label} (${o.value})`));

  for (const lg of ['ALL', 'EPL', 'BUNDESLIGA', 'SERIE_A']) {
    const fixtures = await CP.fetchVerifiedFixtures(factory, DATE, lg);
    const preds = new Map<string, any[]>();
    for (const fx of fixtures.slice(0, 3)) {
      try {
        const d = await factory.getMatchDetails(fx.id);
        if (d?.marketPredictions) preds.set(fx.id, d.marketPredictions);
      } catch { /* analysis unavailable */ }
    }
    const label = CP.LEAGUE_OPTIONS.find((l) => l.id === lg)?.label ?? lg;
    const e = CP.buildFixturesEmbed(fixtures, preds, label);
    console.log(`\n--- ${label} (${fixtures.length} fixtures) ---`);
    console.log(embedText(e).slice(0, 600));
    const actions = CP.buildFixtureActionRows(fixtures);
    console.log('Buttons:', actions[0]?.toJSON()?.components?.map((c: any) => `${c.label}[${c.custom_id}]`).join(', '));
  }

  console.log(`\n\n############ /customparlay ############`);
  const allFx = await CP.fetchVerifiedFixtures(factory, DATE, 'ALL');
  const mRow = CP.buildMatchSelectRow(allFx).toJSON();
  const kRow = CP.buildMarketSelectRow().toJSON();
  console.log(`Match selector: ${mRow.components[0].custom_id} (${mRow.components[0].options.length} options)`);
  console.log('Markets:', kRow.components[0].options.map((o: any) => o.value).join(', '));
  console.log('Buttons:', CP.buildParlayActionRows(false)[0].toJSON().components.map((c: any) => c.label).join(', '));

  // simulate a user building a slip
  const parlay = CP.getParlay('sim-channel');
  const fx0: any = allFx[0];
  const detail = await factory.getMatchDetails(fx0.id);
  const pHome = detail?.marketPredictions?.find((p: any) => p.market === 'HOME_WIN');
  const r1 = CP.addLeg(parlay, {
    fixtureId: fx0.id,
    description: `${fx0.homeTeam.name} v ${fx0.awayTeam.name}`,
    market: 'HOME_WIN',
    selection: 'Home Win',
    probability: pHome?.estimatedProbability ?? 1 / 3,
  });
  console.log('\nadd leg 1:', r1.ok ? 'ok' : r1.reason);
  const dup = CP.addLeg(parlay, {
    fixtureId: fx0.id, description: 'dup', market: 'HOME_WIN', selection: 'Home Win', probability: 0.4,
  });
  console.log('duplicate leg blocked:', !dup.ok, `- ${dup.reason}`);
  if (allFx[1]) {
    const r2 = CP.addLeg(parlay, {
      fixtureId: allFx[1].id,
      description: `${allFx[1].homeTeam.name} v ${allFx[1].awayTeam.name}`,
      market: 'OVER_2_5', selection: 'Over 2.5 Goals', probability: 0.55,
    });
    console.log('add leg 2:', r2.ok ? 'ok' : r2.reason);
  }
  parlay.saved = true;
  console.log('combined probability:', (CP.parlayCombinedProbability(parlay) * 100).toFixed(2) + '%');
  console.log('implied fair odds:', CP.parlayImpliedOdds(parlay)?.toFixed(2) + 'x');
  console.log(embedText(CP.buildParlayEmbed(parlay, 'Parlay saved for live tracking.')).slice(0, 700));

  console.log(`\n\n############ /livetracking ############`);
  const trackable = allFx.filter((f: any) => f.status === 'LIVE' || f.status === 'TIMED');
  console.log('trackable matches:', trackable.length);
  const lRow = CP.buildLiveSelectRow(trackable).toJSON();
  console.log(`Selector: ${lRow.components[0].custom_id}`);
  lRow.components[0].options.slice(0, 5).forEach((o: any) => console.log(`   - ${o.label} (${o.value})`));
  if (trackable[0]) {
    const sub = CP.subscribeLive('sim-channel', trackable[0].id, `${trackable[0].homeTeam.name} v ${trackable[0].awayTeam.name}`);
    console.log('subscribed:', sub.fixtureId, '->', sub.description);
  }
  console.log('No manual match IDs required:', CP.buildLiveSelectRow(trackable).toJSON().components[0].options.length > 0);

  console.log(`\n\n############ /help ############`);
  const help = CP.buildHelpEmbed();
  console.log('Title:', help.data.title, '| Author:', help.data.author?.name);
  console.log('Buttons:', CP.buildHelpRow().toJSON().components.map((c: any) => `${c.label}[${c.custom_id}]`).join(', '));

  console.log(`\n\n############ Interval recalibration ############`);
  console.log('live present      ->', CP.recalibrateInterval([{ status: 'LIVE' }], '1h'));
  console.log('upcoming only     ->', CP.recalibrateInterval([{ status: 'TIMED' }], '1h'));
  console.log('nothing scheduled ->', CP.recalibrateInterval([{ status: 'FINISHED' }], '30m'));
  for (const iv of ['5m', '15m', '30m', '45m', '1h'] as CP.Interval[]) {
    console.log(`  ${iv} -> "${CP.cronForInterval(iv)}"`);
  }

  console.log('\nDone.');
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
