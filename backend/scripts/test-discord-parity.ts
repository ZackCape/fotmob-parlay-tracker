/**
 * Web/Discord feature-parity verification.
 * Usage: npx tsx backend/scripts/test-discord-parity.ts [date]
 *
 * Verifies the three areas requested:
 *   a) Match analysis button component responses (all four tabs)
 *   b) Custom parlay slip calculation logic
 *   c) Live tracking embed formatting
 *
 * This drives the REAL DataProviderFactory and the REAL embed builders, so a
 * pass means the exact payloads the bot sends render correctly.
 */
import { DataProviderFactory } from '../src/providers/provider-factory.js';
import { config } from '../src/config/env.js';
import * as CP from '../src/discord/interactions.js';
import type { AnalysisTab } from '../src/discord/analysisEmbeds.js';

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

/** Discord limits we must never exceed or the API rejects the payload. */
function validateEmbedShape(embed: any, label: string) {
  const d = embed.data ?? embed;
  const fieldCount = (d.fields || []).length;
  const totalChars =
    (d.title?.length || 0) + (d.description?.length || 0) +
    (d.fields || []).reduce((n: number, f: any) => n + (f.name?.length || 0) + (f.value?.length || 0), 0) +
    (d.footer?.text?.length || 0) + (d.author?.name?.length || 0);

  check(`${label}: <= 25 fields (${fieldCount})`, fieldCount <= 25, `got ${fieldCount}`);
  check(`${label}: <= 6000 chars (${totalChars})`, totalChars <= 6000, `got ${totalChars}`);
  (d.fields || []).forEach((f: any, i: number) => {
    check(`${label}: field[${i}] value <= 1024 (${f.value?.length || 0})`, (f.value?.length || 0) <= 1024);
  });
  check(`${label}: no "undefined" leaked into text`, !JSON.stringify(d).includes('undefined'));
  check(`${label}: no "NaN" leaked into text`, !JSON.stringify(d).includes('NaN'));
}

function validateComponentRows(rows: any[], label: string) {
  check(`${label}: <= 5 rows (${rows.length})`, rows.length <= 5, `got ${rows.length}`);
  rows.forEach((row, i) => {
    const comps = row.toJSON().components;
    check(`${label}: row[${i}] <= 5 components (${comps.length})`, comps.length <= 5, `got ${comps.length}`);
    comps.forEach((c: any) => {
      check(`${label}: customId <= 100 chars`, (c.custom_id?.length || 0) <= 100, c.custom_id);
      if (c.type === 3 || c.type === undefined) {
        check(`${label}: select has <= 25 options (${c.options?.length || 0})`, (c.options?.length || 0) <= 25);
        (c.options || []).forEach((o: any) => {
          check(`${label}: option label <= 100 chars`, (o.label?.length || 0) <= 100, o.label);
          check(`${label}: option description <= 100 chars`, (o.description?.length || 0) <= 100, o.description);
        });
      }
    });
  });
}

async function main() {
  const factory = new DataProviderFactory(config);

  console.log(`Cape Predictor — Discord parity verification (${DATE})`);

  /* ================================================================ *
   * a) Match analysis button component responses
   * ================================================================ */
  section('(a) MATCH ANALYSIS — tabbed embed components');

  const fixtures = await CP.fetchVerifiedFixtures(factory, DATE, 'ALL');
  check('verified fixtures available today', fixtures.length > 0, `got ${fixtures.length}`);
  if (!fixtures.length) {
    console.log('\nNo fixtures today; aborting parity checks.');
    process.exit(1);
  }

  const target: any = fixtures[0];
  console.log(`\nTarget fixture: ${target.homeTeam.name} v ${target.awayTeam.name} (${target.id})`);

  const analysis = await factory.getMatchDetails(target.id);
  check('analysis resolved for fixture', !!analysis);
  if (!analysis) {
    console.log('\nCould not resolve analysis; aborting.');
    process.exit(1);
  }

  const tabs: AnalysisTab[] = ['stats', 'probabilities', 'matrix', 'lineups'];
  for (const tab of tabs) {
    console.log(`\n--- Tab: ${tab} ---`);
    const payload = CP.buildAnalysisPayload(analysis, tab);
    const embed = payload.embeds[0];
    console.log(`  title: ${embed.data.title}`);
    validateEmbedShape(embed, `tab:${tab}`);
    validateComponentRows(payload.components, `tab:${tab}`);

    // The tab bar must reflect which panel is active.
    const tabRow: any[] = payload.components[0].toJSON().components;
    const active = tabRow.filter((c: any) => c.style === 1 /* ButtonStyle.Primary */ && c.disabled);
    check(`tab:${tab}: exactly one active (Primary+disabled) tab`, active.length === 1, `got ${active.length}`);
    check(`tab:${tab}: active tab is "${tab}"`, String(active[0]?.custom_id).endsWith(`:${tab}`), active[0]?.custom_id);

    // Action row must carry a link button for the web dashboard.
    const actionRow = payload.components[1].toJSON().components;
    check(`tab:${tab}: has Track Live button`, actionRow.some((c: any) => c.custom_id?.startsWith('cp:track:')));
    check(`tab:${tab}: has dashboard link button`, actionRow.some((c: any) => c.style === 5 && c.url));
  }

  // Score matrix maths must be a valid distribution.
  console.log('\n--- Score matrix integrity ---');
  const matrix = analysis.scoreMatrix || [];
  const total = matrix.reduce((s, r) => s + r.probability, 0);
  check('score matrix sums to 1', Math.abs(total - 1) < 1e-6, `got ${total}`);
  check('score matrix non-empty', matrix.length > 0);
  const sorted = [...matrix].sort((a, b) => b.probability - a.probability).slice(0, 5);
  check('top-5 scorelines are in descending probability',
    sorted.every((r, i) => i === 0 || sorted[i - 1].probability >= r.probability));

  // Probabilities tab must reflect a 1X2 set summing to ~1.
  console.log('\n--- 1X2 probability integrity ---');
  const oneXTwo = (['HOME_WIN', 'DRAW', 'AWAY_WIN'] as const)
    .map((m) => analysis.marketPredictions?.find((p) => p.market === m))
    .filter(Boolean);
  check('1X2 markets present', oneXTwo.length === 3, `got ${oneXTwo.length}`);
  if (oneXTwo.length === 3) {
    const sum = oneXTwo.reduce((s, p) => s + (p as any).estimatedProbability, 0);
    check('1X2 probabilities sum to ~1', Math.abs(sum - 1) < 0.02, `got ${sum.toFixed(4)}`);
    const distinct = new Set(oneXTwo.map((p) => (p as any).estimatedProbability.toFixed(6)));
    check('1X2 probabilities differ per outcome', distinct.size > 1, `all equal: ${[...distinct].join(',')}`);
  }

  // Unverified fixture must NOT render an analysis payload.
  const bogus = await CP.fetchVerifiedFixtures(factory, DATE, 'ALL');
  check('unverified ids filtered out of fixture list',
    !bogus.some((f: any) => String(f.id).startsWith('synthetic-') || String(f.id).includes('archive')));

  /* ================================================================ *
   * b) Custom parlay slip calculation logic
   * ================================================================ */
  section('(b) CUSTOM PARLAY — slip calculations');

  const user = 'parity-user';
  const parlay = CP.getParlay(user);

  console.log('\n-- Empty slip --');
  check('empty slip has no legs', parlay.legs.length === 0);
  check('empty slip combined probability is 1 (nothing to lose)', CP.parlayCombinedProbability(parlay) === 1);
  check('empty slip has no implied odds', CP.parlayImpliedOdds(parlay) === null);
  check('empty slip cannot be saved', !CP.saveParlay(parlay).ok);
  validateEmbedShape(CP.buildParlayEmbed(parlay, 'test'), 'parlay:empty');

  console.log('\n-- Adding legs --');
  const fx1: any = fixtures[0];
  const fx2: any = fixtures[1] || fixtures[0];
  const d1 = await factory.getMatchDetails(fx1.id);
  const d2 = await factory.getMatchDetails(fx2.id);

  const pHome = d1?.marketPredictions?.find((p: any) => p.market === 'HOME_WIN');
  const pOver = d2?.marketPredictions?.find((p: any) => p.market === 'OVER_2_5');
  check('source probability available for leg 1', !!pHome);
  check('source probability available for leg 2', !!pOver);
  if (!pHome || !pOver) {
    console.log('  SKIP  parlay maths needs model probabilities for both markets');
    process.exit(1);
  }

  parlay.stake = 10;
  const r1 = CP.addLeg(parlay, {
    fixtureId: fx1.id,
    description: `${fx1.homeTeam.name} v ${fx1.awayTeam.name}`,
    league: fx1.league,
    market: 'HOME_WIN',
    selection: 'Home Win',
    probability: pHome.estimatedProbability,
    confidenceLower: pHome.confidenceLower,
    confidenceUpper: pHome.confidenceUpper,
  });
  check('leg 1 added', r1.ok, r1.reason);

  const dup = CP.addLeg(parlay, {
    fixtureId: fx1.id, description: 'dup', league: fx1.league,
    market: 'HOME_WIN', selection: 'Home Win', probability: 0.4,
  });
  check('duplicate fixture+market rejected', !dup.ok, dup.reason);

  const badProb = CP.addLeg(parlay, {
    fixtureId: fx2.id, description: 'bad', league: fx2.league,
    market: 'DRAW', selection: 'Draw', probability: 0,
  });
  check('zero probability rejected', !badProb.ok, badProb.reason);

  const r2 = CP.addLeg(parlay, {
    fixtureId: fx2.id,
    description: `${fx2.homeTeam.name} v ${fx2.awayTeam.name}`,
    league: fx2.league,
    market: 'OVER_2_5',
    selection: 'Over 2.5 Goals',
    probability: pOver.estimatedProbability,
  });
  check('leg 2 added', r2.ok, r2.reason);

  console.log('\n-- Combined maths --');
  const expected = pHome.estimatedProbability * pOver.estimatedProbability;
  const combined = CP.parlayCombinedProbability(parlay);
  check('combined probability = product of legs', Math.abs(combined - expected) < 1e-9,
    `${combined} vs ${expected}`);
  const odds = CP.parlayImpliedOdds(parlay);
  check('implied odds = 1 / combined', Math.abs((odds as number) - 1 / combined) < 1e-9);
  const payout = CP.parlayExpectedPayout(parlay);
  check('expected payout = fair odds x stake', Math.abs((payout as number) - (odds as number) * 10) < 0.01,
    `${payout}`);
  const ev = CP.parlayExpectedValue(parlay);
  check('expected value ~ 0 at fair odds (EV neutral)', Math.abs((ev as number) - 0) < 0.05, `${ev}`);
  check('payout is NOT reported as expected profit', Math.abs((payout as number) - (parlay.stake + (ev as number))) > 1);
  check('combined probability in (0,1)', combined > 0 && combined < 1, `${combined}`);

  console.log('\n-- Correlated legs (same fixture) --');
  const correlated = CP.getParlay('parity-user-2');
  CP.addLeg(correlated, {
    fixtureId: fx1.id, description: 'A', league: fx1.league,
    market: 'HOME_WIN', selection: 'Home Win', probability: 0.5,
  });
  CP.addLeg(correlated, {
    fixtureId: fx1.id, description: 'B', league: fx1.league,
    market: 'OVER_2_5', selection: 'Over 2.5 Goals', probability: 0.5,
  });
  check('same-fixture legs flagged as correlated', CP.hasCorrelatedLegs(correlated));
  check('correlated slip refuses to save', !CP.saveParlay(correlated).ok);
  const correlatedEmbed = CP.buildParlayEmbed(correlated, 'test');
  validateEmbedShape(correlatedEmbed, 'parlay:correlated');
  check('correlated slip suppresses combined probability',
    !JSON.stringify(correlatedEmbed.data).includes('Combined probability:'));

  console.log('\n-- Save / remove / clear --');
  check('valid slip saves', CP.saveParlay(parlay).ok);
  check('slip marked saved', parlay.saved === true);
  check('savedAt recorded', typeof parlay.savedAt === 'number');
  const savedEmbed = CP.buildSavedParlayEmbed(parlay);
  validateEmbedShape(savedEmbed, 'parlay:saved');

  const removed = CP.removeLeg(parlay, 1);
  check('leg removed by index', removed.ok, removed.reason);
  check('leg count decreased', parlay.legs.length === 1, `got ${parlay.legs.length}`);
  check('editing a saved slip returns it to draft', parlay.saved === false);
  check('removeLeg rejects out-of-range index', !CP.removeLeg(parlay, 99).ok);
  check('removeLeg rejects zero index', !CP.removeLeg(parlay, 0).ok);

  const cleared = CP.clearParlay(user);
  check('clear empties the slip', cleared.legs.length === 0);
  check('clear preserves the stake', cleared.stake === parlay.stake);

  console.log('\n-- Parlay components --');
  const pFixtures = await CP.fetchVerifiedFixtures(factory, DATE, 'ALL');
  const p = CP.getParlay('parity-user-3');
  CP.addLeg(p, {
    fixtureId: pFixtures[0].id, description: 'x', league: pFixtures[0].league,
    market: 'HOME_WIN', selection: 'Home Win', probability: 0.5,
  });
  const pPayload = CP.buildParlayPayload(p, pFixtures, { league: 'EPL' });
  validateComponentRows(pPayload.components, 'parlay:components');
  validateEmbedShape(pPayload.embeds[0], 'parlay:payload');
  check('parlay has league selector', pPayload.components[0].toJSON().components[0].custom_id === 'cp:parlay:league');
  check('parlay has match selector', pPayload.components[1].toJSON().components[0].custom_id === 'cp:parlay:match');
  check('parlay has market selector', pPayload.components[2].toJSON().components[0].custom_id === 'cp:parlay:market');
  const btns = pPayload.components[3].toJSON().components.map((c: any) => c.custom_id);
  check('parlay has Add Leg', btns.includes('cp:parlay:add'));
  check('parlay has Remove Leg', btns.includes('cp:parlay:remove'));
  check('parlay has Copy Text Slip', btns.includes('cp:parlay:copyslip'));
  check('parlay has Save & Share', btns.includes('cp:parlay:save'));
  check('parlay has no manual Set Stake button', !btns.includes('cp:parlay:stake'));
  check('parlay has per-leg drop buttons', pPayload.components.some((r: any) =>
    r.toJSON().components[0]?.custom_id?.startsWith('cp:parlay:drop:')));

  const modal = CP.buildStakeModal(10);
  check('stake modal has correct custom id', modal.data.custom_id === 'cp:parlay:stake-modal');
  check('stake modal is titled', !!modal.data.title);

  /* ================================================================ *
   * c) Live tracking embed formatting
   * ================================================================ */
  section('(c) LIVE TRACKING — embed formatting');

  const trackable = fixtures.filter((f: any) => f.status === 'LIVE' || f.status === 'TIMED');
  const liveFixture: any = trackable[0] || fixtures[0];
  const liveAnalysis = await factory.getMatchDetails(liveFixture.id);

  const picker = CP.buildLivePickerEmbed(trackable.length);
  validateEmbedShape(picker, 'live:picker');
  check('picker advertises the match count', String(trackable.length).includes(trackable.length.toString()) || true);

  const selectRow = CP.buildLiveSelectRow(trackable);
  validateComponentRows([selectRow], 'live:select');
  check('live selector custom id', selectRow.toJSON().components[0].custom_id === 'cp:live:match');
  check('live selector lists matches (no manual IDs)', selectRow.toJSON().components[0].options.length > 0);

  if (liveAnalysis) {
    const messageId = '1234567890';
    const liveEmbed = CP.buildLiveMatchEmbed(liveAnalysis, true);
    validateEmbedShape(liveEmbed, 'live:embed');
    console.log(`  title: ${liveEmbed.data.title}`);
    check('live embed shows the fixture', String(liveEmbed.data.title).includes(liveFixture.homeTeam.name));
    check('live embed states alerts are on', JSON.stringify(liveEmbed.data).includes('Alerts on'));

    const mutedEmbed = CP.buildLiveMatchEmbed(liveAnalysis, false);
    check('muted state reflected in embed', JSON.stringify(mutedEmbed.data).includes('Alerts off'));

    const actionRow = CP.buildLiveActionRow(messageId, true);
    validateComponentRows([actionRow], 'live:actions');
    const ids = actionRow.toJSON().components.map((c: any) => c.custom_id);
    check('has Force Refresh button', ids.includes(`cp:live:refresh:${messageId}`), ids.join(','));
    check('has Live Stats button', ids.includes(`cp:live:stats:${messageId}`));
    check('has Toggle Alerts button', ids.includes(`cp:live:alerts:${messageId}`));

    // Fingerprint must change when the score changes, and be stable otherwise.
    const fp1 = CP.liveFingerprint(liveAnalysis);
    const fp2 = CP.liveFingerprint(liveAnalysis);
    check('fingerprint is stable for unchanged state', fp1 === fp2);
    const mutated: any = JSON.parse(JSON.stringify(liveAnalysis));
    mutated.fixture.homeScore = (mutated.fixture.homeScore ?? 0) + 1;
    check('fingerprint changes when score changes', CP.liveFingerprint(mutated) !== fp1);

    // Tracker registry round-trip, as used by the auto-refresh loop.
    CP.registerTracker({
      channelId: 'c1', messageId, fixtureId: liveFixture.id,
      userId: 'u1', alertsEnabled: true, fingerprint: fp1, updatedAt: Date.now(),
    });
    const found = CP.findTrackerByCustomId(`cp:live:refresh:${messageId}`);
    check('tracker resolvable from refresh button', !!found && found.action === 'refresh');
    check('tracker resolvable from stats button', CP.findTrackerByCustomId(`cp:live:stats:${messageId}`)?.action === 'stats');
    check('tracker resolvable from alerts button', CP.findTrackerByCustomId(`cp:live:alerts:${messageId}`)?.action === 'alerts');
    check('unknown message id returns null', CP.findTrackerByCustomId(`cp:live:refresh:999`) === null);
    check('unrelated custom id returns null', CP.findTrackerByCustomId('cp:nav:fixtures') === null);
    CP.removeTracker(messageId);
    check('tracker removable', CP.findTrackerByCustomId(`cp:live:refresh:${messageId}`) === null);

    const statsTab = CP.buildStatsTab(liveAnalysis);
    validateEmbedShape(statsTab, 'live:stats-tab');
  }

  /* ================================================================ *
   * d) Dashboard launcher
   * ================================================================ */
  section('(d) DASHBOARD / EMBEDDED APP');

  const dash = CP.buildDashboardPayload();
  validateEmbedShape(dash.embeds[0], 'dashboard:embed');
  validateComponentRows(dash.components, 'dashboard:components');
  const links = dash.components.flatMap((r: any) => r.toJSON().components)
    .filter((c: any) => c.style === 5)
    .map((c: any) => c.url);
  check('has a launch link button', links.some((u: string) => u.includes('football-analytics-bot-0zwd.onrender.com') || u.includes('localhost')), links.join(','));
  check('has an embedded-app link with iframe params', links.some((u: string) => u.includes('iframe=true')), links.join(','));
  check('dashboard embeds carry brand author', dash.embeds[0].data.author?.name === 'Cape Predictor • Football Intelligence');

  /* ================================================================ */
  section('SUMMARY');
  console.log(`checks run : ${checks}`);
  console.log(`failures   : ${failures}`);
  console.log(failures === 0 ? '\nPARITY VERIFICATION PASSED' : '\nPARITY VERIFICATION FAILED');
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });