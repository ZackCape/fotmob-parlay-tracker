/**
 * Full Discord interaction simulation.
 * Usage: npx tsx backend/scripts/test-discord-full.ts [date]
 *
 * Exercises the real DataProviderFactory + the real embed builders used by the
 * bot for: /fixtures, /customparlay, /livetracking, /help and /dashboard.
 *
 * NOTE: for the deeper parity checks (analysis tabs, parlay maths, live embed
 * formatting) see backend/scripts/test-discord-parity.ts.
 */
import { DataProviderFactory } from '../src/providers/provider-factory.js';
import { config } from '../src/config/env.js';
import * as CP from '../src/discord/interactions.js';

const DATE = process.argv[2] || new Date().toISOString().slice(0, 10);

function embedText(e: any): string {
  return e.toJSON ? JSON.stringify(e.toJSON()) : JSON.stringify(e);
}

function optionsOf(row: any): any[] {
  return row.toJSON().components[0].options || [];
}

async function main() {
  const factory = new DataProviderFactory(config);

  console.log(`\n############ /fixtures  (${DATE}) ############`);
  console.log('League picker embed:', CP.leaguePickerEmbed().data.title);
  const menu: any = optionsOf(CP.buildLeagueSelectRow())[0];
  console.log(`Selector customId: ${menu.custom_id}`);
  optionsOf(CP.buildLeagueSelectRow()).forEach((o: any) => console.log(`   - ${o.label} (${o.value})`));

  for (const lg of ['ALL', 'EPL', 'BUNDESLIGA']) {
    const fixtures = await CP.fetchVerifiedFixtures(factory, DATE, lg);
    const preds = new Map<string, any[]>();
    for (const fx of fixtures.slice(0, 3)) {
      try {
        const d = await factory.getMatchDetails(fx.id);
        if (d?.marketPredictions) preds.set(fx.id, d.marketPredictions);
      } catch { /* analysis unavailable */ }
    }
    const e = CP.buildFixturesEmbed(fixtures, preds, lg);
    console.log(`\n--- ${CP.leagueLabel(lg)} (${fixtures.length} fixtures) ---`);
    console.log(embedText(e).slice(0, 500));
    const rows = CP.buildFixtureActionRows(fixtures);
    console.log('Action rows:', rows.length, '| first row buttons:',
      rows[0]?.toJSON()?.components?.map((c: any) => `${c.label}[${c.custom_id}]`).join(', '));
  }

  console.log(`\n\n############ /customparlay ############`);
  const allFx = await CP.fetchVerifiedFixtures(factory, DATE, 'ALL');
  const parlay = CP.getParlay('sim-user');
  CP.setParlayLeague('sim-user', 'ALL');
  const payload = CP.buildParlayPayload(parlay, allFx, { league: 'ALL', notice: 'simulated' });
  console.log('League options :', optionsOf(payload.components[0]).map((o: any) => o.value).join(', '));
  console.log('Match options  :', optionsOf(payload.components[1]).length);
  console.log('Market options :', optionsOf(payload.components[2]).map((o: any) => o.value).join(', '));
  console.log('Buttons        :', payload.components[3].toJSON().components.map((c: any) => c.label).join(', '));

  console.log(`\n\n############ /livetracking ############`);
  const trackable = allFx.filter((f: any) => f.status === 'LIVE' || f.status === 'TIMED');
  console.log('trackable:', trackable.length);
  console.log('picker embed:', CP.buildLivePickerEmbed(trackable.length).data.title);
  console.log('selector options:', optionsOf(CP.buildLiveSelectRow(trackable)).length);
  console.log('No manual IDs required:', optionsOf(CP.buildLiveSelectRow(trackable)).length > 0);

  console.log(`\n\n############ /help ############`);
  console.log('Title:', CP.buildHelpEmbed().data.title);
  console.log('Buttons:', CP.buildHelpRow().toJSON().components.map((c: any) => `${c.label}[${c.custom_id}]`).join(', '));

  console.log(`\n\n############ /dashboard ############`);
  const dash = CP.buildDashboardPayload();
  console.log('Embed title:', dash.embeds[0].data.title);
  dash.components[0].toJSON().components.forEach((c: any) => console.log(`  link -> ${c.url}`));
  dash.components[1].toJSON().components.forEach((c: any) =>
    console.log(`  ${c.label} -> ${c.style === 5 ? c.url : c.custom_id}`));

  console.log(`\n\n############ Interval recalibration ############`);
  console.log('live present      ->', CP.recalibrateInterval([{ status: 'LIVE' }], '1h'));
  console.log('upcoming only     ->', CP.recalibrateInterval([{ status: 'TIMED' }], '1h'));
  console.log('nothing scheduled ->', CP.recalibrateInterval([{ status: 'FINISHED' }], '30m'));

  console.log('\nDone.');
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });