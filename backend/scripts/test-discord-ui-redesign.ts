/**
 * Discord UI/UX redesign verification script.
 *
 * Usage: npx tsx backend/scripts/test-discord-ui-redesign.ts
 *
 * Verifies that all Discord embeds use clean, high-end sports analytics
 * dashboard styling:
 *  - /fixtures match rows: emoji-free, 3-line structured cards, explicit labels
 *  - /live matches: LIVE badge, score lines, recent events, stats lines
 *  - Action buttons: Track Match (Primary), Live Match Stats (Secondary), Refresh (Secondary)
 *  - League picker: clean header, all competition options
 *  - Pagination: Previous Page | Page X / Y | Next Page
 *
 * Drives the REAL embed builders from backend/src/discord/.
 */
import { describe, it, expect } from 'vitest';

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
  console.log(`\nCape Predictor — Discord UI/UX redesign verification`);

  /* ================================================================ *
   * Sample fixtures & predictions
   * ================================================================ */
  const fixtures = [
    {
      id: 'espn-1',
      league: 'EPL',
      kickoffTime: '2026-10-18T15:00:00Z',
      status: 'TIMED',
      homeTeam: { name: 'AFC Bournemouth', shortName: 'BOU' },
      awayTeam: { name: 'Sunderland', shortName: 'SUN' },
      homeScore: null,
      awayScore: null,
      statistics: {
        possessionHome: 54.0, possessionAway: 46.0,
        shotsOnTargetHome: 6, shotsOnTargetAway: 3,
        cornersHome: 5, cornersAway: 7,
        yellowCardsHome: 1, yellowCardsAway: 2,
      },
    },
    {
      id: 'espn-2',
      league: 'LALIGA',
      kickoffTime: '2026-10-18T17:00:00Z',
      status: 'LIVE',
      homeTeam: { name: 'Arsenal', shortName: 'ARS' },
      awayTeam: { name: 'Chelsea', shortName: 'CHE' },
      homeScore: 2,
      awayScore: 1,
      statistics: {
        possessionHome: 58.0, possessionAway: 42.0,
        shotsOnTargetHome: 8, shotsOnTargetAway: 4,
        cornersHome: 6, cornersAway: 4,
        yellowCardsHome: 2, yellowCardsAway: 1,
      },
    },
    // Additional fixtures to force pagination (> 10 total)
    { id: 'espn-3', league: 'SERIE_A', kickoffTime: '2026-10-18T19:00:00Z', status: 'TIMED', homeTeam: { name: 'Inter', shortName: 'INT' }, awayTeam: { name: 'Milan', shortName: 'MIL' }, homeScore: null, awayScore: null, statistics: {} },
    { id: 'espn-4', league: 'BUNDESLIGA', kickoffTime: '2026-10-18T20:30:00Z', status: 'TIMED', homeTeam: { name: 'Bayern', shortName: 'BAY' }, awayTeam: { name: 'Dortmund', shortName: 'DOR' }, homeScore: null, awayScore: null, statistics: {} },
    { id: 'espn-5', league: 'LIGUE1', kickoffTime: '2026-10-19T15:00:00Z', status: 'TIMED', homeTeam: { name: 'PSG', shortName: 'PSG' }, awayTeam: { name: 'Marseille', shortName: 'OM' }, homeScore: null, awayScore: null, statistics: {} },
    { id: 'espn-6', league: 'CHAMPIONS_LEAGUE', kickoffTime: '2026-10-20T18:00:00Z', status: 'TIMED', homeTeam: { name: 'Real Madrid', shortName: 'RMA' }, awayTeam: { name: 'Man City', shortName: 'MCI' }, homeScore: null, awayScore: null, statistics: {} },
    { id: 'espn-7', league: 'EPL', kickoffTime: '2026-10-18T15:00:00Z', status: 'TIMED', homeTeam: { name: 'Liverpool', shortName: 'LIV' }, awayTeam: { name: 'Everton', shortName: 'EVE' }, homeScore: null, awayScore: null, statistics: {} },
    { id: 'espn-8', league: 'SERIE_A', kickoffTime: '2026-10-18T15:00:00Z', status: 'TIMED', homeTeam: { name: 'Napoli', shortName: 'NAP' }, awayTeam: { name: 'Roma', shortName: 'ROM' }, homeScore: null, awayScore: null, statistics: {} },
    { id: 'espn-9', league: 'BUNDESLIGA', kickoffTime: '2026-10-18T15:00:00Z', status: 'TIMED', homeTeam: { name: 'Leipzig', shortName: 'RBL' }, awayTeam: { name: 'Leverkusen', shortName: 'B04' }, homeScore: null, awayScore: null, statistics: {} },
    { id: 'espn-10', league: 'LIGUE1', kickoffTime: '2026-10-18T15:00:00Z', status: 'TIMED', homeTeam: { name: 'Lyon', shortName: 'OL' }, awayTeam: { name: 'Nice', shortName: 'NIC' }, homeScore: null, awayScore: null, statistics: {} },
    { id: 'espn-11', league: 'EPL', kickoffTime: '2026-10-18T15:00:00Z', status: 'TIMED', homeTeam: { name: 'Spurs', shortName: 'TOT' }, awayTeam: { name: 'Chelsea', shortName: 'CHE' }, homeScore: null, awayScore: null, statistics: {} },
  ];

  const predictionsByFixture = new Map([
    [
      'espn-1',
      [
        { market: 'HOME_WIN', estimatedProbability: 0.46, marketLabel: 'Home Win', selection: 'Home Win' } as any,
        { market: 'DRAW', estimatedProbability: 0.25, marketLabel: 'Draw', selection: 'Draw' } as any,
        { market: 'AWAY_WIN', estimatedProbability: 0.29, marketLabel: 'Away Win', selection: 'Away Win' } as any,
        { market: 'OVER_1_5', estimatedProbability: 0.82, marketLabel: 'Over 1.5 Goals', selection: 'Over 1.5 Goals' } as any,
        { market: 'OVER_2_5', estimatedProbability: 0.58, marketLabel: 'Over 2.5 Goals', selection: 'Over 2.5 Goals' } as any,
        { market: 'OVER_8_5_CORNERS', estimatedProbability: 0.71, marketLabel: 'Over 8.5 Corners', selection: 'Over 8.5 Corners' } as any,
        { market: 'OVER_3_5_CARDS', estimatedProbability: 0.58, marketLabel: 'Over 3.5 Cards', selection: 'Over 3.5 Cards' } as any,
      ],
    ],
    [
      'espn-2',
      [
        { market: 'HOME_WIN', estimatedProbability: 0.62, marketLabel: 'Home Win', selection: 'Home Win' } as any,
        { market: 'DRAW', estimatedProbability: 0.21, marketLabel: 'Draw', selection: 'Draw' } as any,
        { market: 'AWAY_WIN', estimatedProbability: 0.17, marketLabel: 'Away Win', selection: 'Away Win' } as any,
        { market: 'OVER_1_5', estimatedProbability: 0.88, marketLabel: 'Over 1.5 Goals', selection: 'Over 1.5 Goals' } as any,
        { market: 'OVER_2_5', estimatedProbability: 0.63, marketLabel: 'Over 2.5 Goals', selection: 'Over 2.5 Goals' } as any,
        { market: 'OVER_8_5_CORNERS', estimatedProbability: 0.69, marketLabel: 'Over 8.5 Corners', selection: 'Over 8.5 Corners' } as any,
        { market: 'OVER_3_5_CARDS', estimatedProbability: 0.44, marketLabel: 'Over 3.5 Cards', selection: 'Over 3.5 Cards' } as any,
      ],
    ],
  ]);

  /* ================================================================ *
   * Import builders
   * ================================================================ */
  const { buildFixturesEmbed, buildFixturesPayload, buildFixtureLeagueSelectRow, buildFixturePaginationRow,
    buildFixtureTrackRows } = await import('../src/discord/interactions.js');
  const { buildLiveMatchesEmbed, buildLiveActionRows } = await import('../src/discord/liveTracker.js');

  /* ================================================================ *
   * /fixtures match rows
   * ================================================================ */
  section('/FIXTURES MATCH ROWS — clean structured cards');
  const payload = buildFixturesPayload(fixtures, predictionsByFixture, 'ALL', 1);
  const embedText = JSON.stringify(payload.embeds[0].toJSON());

  // Rebranded header
  check('embed title is Cape Predictor — Today\'s Full Match Schedule',
    payload.embeds[0].data.title === "Cape Predictor — Today's Full Match Schedule",
    payload.embeds[0].data.title);

  // No emoji clutter in match rows: 🏠, 🤝, ✈️, 🟨, 🟥, ⏳ should not appear
  const emojiClutter = /[🏠🤝✈️🟨🟥⏳]/;
  check('no emoji clutter in fixture rows', !emojiClutter.test(embedText),
    `found emoji in: ${embedText.match(emojiClutter)}`);

  // Explicit label + probability + implied fair odds, e.g. `Home 46% (2.17x)`
  check('Home win probability + odds label', embedText.includes('`Home 46% (2.17x)`'));
  check('Draw probability + odds label', embedText.includes('`Draw 25% (4.00x)`'));
  check('Away probability + odds label', embedText.includes('`Away 29% (3.45x)`'));

  // Goal markets
  check('Over 1.5 Goals label', embedText.includes('`Over 1.5 Goals (82%)`'));
  check('Over 2.5 Goals label', embedText.includes('`Over 2.5 Goals (58%)`'));

  // Stats markets
  check('Over 8.5 Corners label', embedText.includes('`Over 8.5 Corners (71%)`'));
  check('Over 3.5 Cards label', embedText.includes('`Over 3.5 Cards (58%)`'));

  // 3-line card structure: match line, Win Odds line, Goals line, Stats line
  check('match line uses code block and bold headers',
    embedText.includes('**AFC Bournemouth vs Sunderland**'));
  check('Win Odds section present', embedText.includes('> **Win Odds:**'));
  check('Goals section present', embedText.includes('> **Goals:**'));
  check('Stats section present', embedText.includes('> **Stats:**'));

  // All fixtures appear (not truncated to 5 lines)
  check('all fixtures listed', embedText.includes('Arsenal') && embedText.includes('Chelsea'));

  // Kickoff time in 12-hour format
  check('kickoff time formatted', embedText.includes('3:00 PM') || embedText.includes('5:00 PM'));

  /* ================================================================ *
   * League picker
   * ================================================================ */
  section('/FIXTURES LEAGUE PICKER');
  const leagueRow: any = payload.components[0].toJSON();
  const menu: any = leagueRow.components[0];
  check('league select customId', menu.custom_id === 'cp:fixtures:league');
  check('league select has all competition options',
    menu.options.length >= 7, `got ${menu.options.length}`);
  const leagueValues = menu.options.map((o: any) => o.value);
  for (const v of ['ALL', 'EPL', 'LALIGA', 'SERIE_A', 'BUNDESLIGA', 'LIGUE1', 'CHAMPIONS_LEAGUE']) {
    check(`league option ${v}`, leagueValues.includes(v));
  }

  /* ================================================================ *
   * Pagination
   * ================================================================ */
  section('/FIXTURES PAGINATION');
  check('pagination row present', payload.components.length > 1);
  const pagRow: any = payload.components[payload.components.length - 1].toJSON();
  const pagIds = pagRow.components.map((c: any) => c.custom_id);
  check('Previous Page button', pagIds.includes('cp:fixtures:prev'));
  check('Page X / Y button', pagIds.includes('cp:fixtures:page'));
  check('Next Page button', pagIds.includes('cp:fixtures:next'));
  const pageLabel = pagRow.components.find((c: any) => c.custom_id === 'cp:fixtures:page')?.label;
  check('page label shows Page X / Y', String(pageLabel).startsWith('Page 1 /'));

  /* ================================================================ *
   * /live matches display
   * ================================================================ */
  section('/LIVE MATCHES DISPLAY');
  const liveEmbed = buildLiveMatchesEmbed([fixtures[1]]);
  const liveText = JSON.stringify(liveEmbed.toJSON());

  check('live embed titled', liveEmbed.data.title === '🔴 Cape Predictor — Live Matches');
  check('LIVE badge present', liveText.includes('🔴 **LIVE**'));
  check('match score displayed', liveText.includes('**Arsenal 2 — 1 Chelsea**'));
  check('league displayed', liveText.includes('[LALIGA]'));
  check('recent event line', liveText.includes('**Recent Event:**'));
  check('stats line', liveText.includes('**Stats:**'));
  check('possession stats', liveText.includes('`Possession 58% - 42%`'));
  check('shots on target stats', liveText.includes('`On Target 8 - 4`'));
  check('xG / corners / cards line', liveText.includes('**xG:**') && liveText.includes('**Corners:** `6 - 4`') && liveText.includes('**Cards:** `2 - 1`'));

  // The provider clock is rendered verbatim in the header: 68'
  const clockedEmbed = buildLiveMatchesEmbed([{ ...fixtures[1], liveClock: "68'" }]);
  const clockedText = JSON.stringify(clockedEmbed.toJSON());
  check("live clock formatted as 68'", clockedText.includes("🔴 **68'** • **Arsenal 2 — 1 Chelsea** [LALIGA]"));

  // Half-time is labelled HT rather than a fabricated minute
  const htEmbed = buildLiveMatchesEmbed([{ ...fixtures[1], liveClock: null, providerStatus: 'STATUS_HALFTIME' }]);
  check('half-time labelled HT', JSON.stringify(htEmbed.toJSON()).includes('🔴 **HT**'));

  // Finished / upcoming fixtures are never rendered as live
  const mixedEmbed = buildLiveMatchesEmbed([fixtures[0], fixtures[1], fixtures[2]]);
  const mixedText = JSON.stringify(mixedEmbed.toJSON());
  check('only live fixtures rendered', mixedText.includes('Arsenal') && !mixedText.includes('Bournemouth') && !mixedText.includes('Inter'));

  const emptyLive = buildLiveMatchesEmbed([fixtures[0], fixtures[2]]);
  check(
    'empty live state message',
    JSON.stringify(emptyLive.toJSON()).includes('No live matches currently in play. Use `/fixtures` to see upcoming games.'),
  );

  /* ================================================================ *
   * Live action buttons
   * ================================================================ */
  section('/LIVE ACTION BUTTONS');
  const actionRows = buildLiveActionRows([fixtures[1]]);
  const allButtons = actionRows.flatMap((r: any) => r.toJSON().components);
  const buttonIds = allButtons.map((c: any) => c.custom_id);
  const buttonLabels = allButtons.map((c: any) => c.label);
  const buttonStyles = allButtons.map((c: any) => c.style);

  check('Track Match button present', buttonIds.includes('cp:live:track:espn-2'));
  check('Track Match button is Primary (blue)', buttonStyles[buttonIds.indexOf('cp:live:track:espn-2')] === 1);
  check('Track Match label', buttonLabels.includes('Track Arsenal v Chelsea'));

  check('Live Match Stats button present', buttonIds.includes('cp:live:lstats:espn-2'));
  check('Live Match Stats button is Secondary', buttonStyles[buttonIds.indexOf('cp:live:lstats:espn-2')] === 2);

  check('Refresh button present', buttonIds.includes('cp:live:lrefresh:espn-2'));
  check('Refresh button is Secondary', buttonStyles[buttonIds.indexOf('cp:live:lrefresh:espn-2')] === 2);

  // Max 5 components per row (Discord limit)
  actionRows.forEach((row, i) => {
    check(`action row ${i} has <= 5 components`, row.toJSON().components.length <= 5);
  });

  // Max 5 action rows (Discord limit)
  check('total action rows <= 5', actionRows.length <= 5);

  // One action row per live match, so [ ⚡ Track Match ] sits under its fixture
  const secondLive = { ...fixtures[1], id: 'espn-90', homeTeam: { name: 'Roma' }, awayTeam: { name: 'Lazio' } };
  const perMatchRows = buildLiveActionRows([fixtures[1], secondLive, fixtures[0]]);
  check('one action row per live match', perMatchRows.length === 2);
  check(
    'second match gets its own track button',
    perMatchRows[1].toJSON().components.some((c: any) => c.custom_id === 'cp:live:track:espn-90'),
  );

  /* ================================================================ *
   * Summary
   * ================================================================ */
  section('SUMMARY');
  console.log(`checks run : ${checks}`);
  console.log(`failures   : ${failures}`);
  console.log(failures === 0 ? '\nUI/UX REDESIGN VERIFICATION PASSED' : '\nUI/UX REDESIGN VERIFICATION FAILED');
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error('Fatal:', e.message); process.exit(1); });
