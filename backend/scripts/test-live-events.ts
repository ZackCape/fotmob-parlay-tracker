/**
 * Live events verification script.
 *
 * Usage: npx tsx backend/scripts/test-live-events.ts
 *
 * Simulates live event parsing for a sample match event payload (Goal with
 * scorer/assist, Red card) and verifies the /livematches embed formatting and
 * live-event alerting structures, driving the REAL builders from
 * backend/src/discord/.
 */
import { describe, it, expect } from 'vitest';

// We drive the builders directly (unit-style) inside a vitest run so the
// script can be executed both with `npx tsx` and `npm test`.
import {
  subscribeLive, unsubscribeLive, isSubscribed, getSubscriptionsForFixture,
  isSeenEvent, markEventSeen, detectNewEvents,
  buildGoalAlert, buildRedCardAlert, buildHalftimeReport,
} from '../src/discord/liveEvents.js';
import {
  buildLiveMatchesEmbed, buildLiveTrackRows,
} from '../src/discord/liveTracker.js';
import { BRAND } from '../src/discord/brand.js';
import { Fixture, MatchAnalysis, MarketPrediction } from '../src/types/football.js';

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

/* ------------------------------------------------------------------ *
 * Sample fixtures
 * ------------------------------------------------------------------ */
const makeFixture = (overrides: Partial<Fixture> = {}): Fixture => ({
  id: 'espn-401878771',
  externalId: '401878771',
  league: 'EPL',
  season: '2026',
  round: 'Matchday 7',
  date: '2026-10-18',
  kickoffTime: '2026-10-18T15:00:00Z',
  status: 'LIVE',
  homeTeam: { id: '368', name: 'Everton', shortName: 'EVE', code: 'EVE', league: 'EPL', stadium: '', city: '', logo: '' } as any,
  awayTeam: { id: '363', name: 'Chelsea', shortName: 'CHE', code: 'CHE', league: 'EPL', stadium: '', city: '', logo: '' } as any,
  homeScore: 1,
  awayScore: 2,
  htHomeScore: null,
  htAwayScore: null,
  venue: 'Goodison Park',
  statistics: {
    shotsHome: 9, shotsAway: 14, shotsOnTargetHome: 3, shotsOnTargetAway: 6,
    xgHome: 0.95, xgAway: 1.72, cornersHome: 4, cornersAway: 7,
    foulsHome: 11, foulsAway: 9, yellowCardsHome: 2, yellowCardsAway: 3,
    redCardsHome: 0, redCardsAway: 1, possessionHome: 44.0, possessionAway: 56.0,
  },
  dataSource: 'ESPN Public Scoreboard (Free)',
  ...overrides,
} as Fixture);

const makeAnalysis = (overrides: Partial<MatchAnalysis> = {}): MatchAnalysis => {
  const prediction = (market: string, probability: number): MarketPrediction => ({
    id: `${market}-1`, fixtureId: 'espn-1', league: 'EPL',
    fixtureDescription: 'Everton v Chelsea', kickoff: '2026-10-18T15:00:00Z',
    market: market as any, marketLabel: market, selection: market,
    estimatedProbability: probability, rawProbability: probability,
    confidenceLower: probability * 0.85, confidenceUpper: Math.min(1, probability * 1.15),
    supportingStatistics: {} as any,
  } as MarketPrediction);
  return {
    fixture: makeFixture(),
    homeForm: { last5Results: ['W', 'D', 'W', 'L', 'W'] } as any,
    awayForm: { last5Results: ['L', 'W', 'D', 'D', 'L'] } as any,
    headToHead: {} as any,
    dixonColesParameters: {
      homeExpectedGoals: 0.95, awayExpectedGoals: 1.72,
      homeAttackStrength: 1.1, homeDefenseWeakness: 0.9,
      awayAttackStrength: 1.3, awayDefenseWeakness: 0.8,
      homeAdvantage: 1.28,
    },
    scoreMatrix: [
      { homeScore: 1, awayScore: 2, probability: 0.14 },
      { homeScore: 1, awayScore: 1, probability: 0.12 },
      { homeScore: 0, awayScore: 2, probability: 0.11 },
    ],
    marketPredictions: [
      prediction('HOME_WIN', 0.28),
      prediction('DRAW', 0.24),
      prediction('AWAY_WIN', 0.48),
      prediction('OVER_2_5', 0.61),
    ],
    injuries: null,
    lineups: { home: null, away: null },
    dataQualityNotes: [],
    ...overrides,
  } as MatchAnalysis;
};

/* ------------------------------------------------------------------ *
 * Sample ESPN key-event payloads
 * ------------------------------------------------------------------ */
const goalEvent = {
  id: 'evt-goal-1',
  type: 'goal',
  label: 'Goal',
  minute: '46\'',
  minuteValue: 2743,
  team: 'Chelsea',
  player: 'Pedro Neto',
  assist: 'Emiliano Martínez',
  scoring: true,
  text: 'Pedro Neto (Chelsea) scores!',
} as any;

const ownGoalEvent = {
  id: 'evt-og-1',
  type: 'goal',
  label: 'Goal',
  minute: '52\'',
  minuteValue: 3100,
  team: 'Everton',
  player: 'James Tarkowski',
  assist: null,
  scoring: true,
  text: 'James Tarkowski (Everton) scores an own goal.',
} as any;

const redCardEvent = {
  id: 'evt-rc-1',
  type: 'red-card',
  label: 'Red Card',
  minute: '65\'',
  minuteValue: 3866,
  team: 'Everton',
  player: 'Harrison Armstrong',
  assist: null,
  scoring: false,
  text: 'Harrison Armstrong (Everton) is shown the red card.',
} as any;

const substitutionEvent = {
  id: 'evt-sub-1',
  type: 'substitution',
  label: 'Substitution',
  minute: '55\'',
  minuteValue: 3267,
  team: 'Everton',
  player: 'Player A',
  assist: null,
  scoring: false,
  text: 'Substitution.',
} as any;

/* ------------------------------------------------------------------ *
 * Main
 * ------------------------------------------------------------------ */
async function main() {
  console.log(`\nCape Predictor — Live events verification`);

  /* ================================================================ *
   * Subscription store
   * ================================================================ */
  section('LIVE SUBSCRIPTIONS');
  const userId = 'user-1';
  const channelId = 'channel-1';
  const fixtureId = 'espn-401878771';

  check('not subscribed initially', !isSubscribed(userId, fixtureId));
  check('subscribe returns true', subscribeLive(userId, channelId, fixtureId) === true);
  check('isSubscribed after subscribe', isSubscribed(userId, fixtureId) === true);
  check('duplicate subscribe returns false', subscribeLive(userId, channelId, fixtureId) === false);
  const subs = getSubscriptionsForFixture(fixtureId);
  check('subscription recorded', subs.length === 1 && subs[0].userId === userId && subs[0].channelId === channelId);
  check('unsubscribe returns true', unsubscribeLive(userId, fixtureId) === true);
  check('not subscribed after unsubscribe', !isSubscribed(userId, fixtureId));
  check('unsubscribe missing returns false', unsubscribeLive(userId, fixtureId) === false);

  /* ================================================================ *
   * Seen-event de-duplication
   * ================================================================ */
  section('SEEN-EVENT DEDUPLICATION');
  check('unseen event not marked', !isSeenEvent('evt-new-1'));
  markEventSeen('evt-new-1');
  check('marked event is seen', isSeenEvent('evt-new-1') === true);

  /* ================================================================ *
   * Event detection
   * ================================================================ */
  section('EVENT DETECTION (detectNewEvents)');
  const prevStats = { events: [] } as any;
  const statsWithGoal = { events: [goalEvent] } as any;
  const statsWithGoalAndCard = { events: [goalEvent, redCardEvent] } as any;
  const statsWithSub = { events: [substitutionEvent] } as any;

  const detected1 = detectNewEvents(prevStats, statsWithGoal);
  check('detects a goal event', detected1.length === 1 && detected1[0].type === 'goal' && detected1[0].player === 'Pedro Neto');
  check('goal event has minute', detected1[0].minute === '46\'');
  check('goal event has assist', detected1[0].assist === 'Emiliano Martínez');

  // Own goal detection via text.
  const statsWithOwnGoal = { events: [ownGoalEvent] } as any;
  const detectedOg = detectNewEvents(prevStats, statsWithOwnGoal);
  check('detects own goal from text', detectedOg.length === 1 && detectedOg[0].type === 'own-goal');

  // Red card detection.
  const detected2 = detectNewEvents(statsWithGoal, statsWithGoalAndCard);
  check('detects only the new red card', detected2.length === 1 && detected2[0].type === 'red-card' && detected2[0].player === 'Harrison Armstrong');

  // Substitutions are ignored.
  const detected3 = detectNewEvents(statsWithGoalAndCard, statsWithSub);
  check('ignores substitutions', detected3.length === 0);

  // Re-polling same events yields nothing (dedup by id).
  const detected4 = detectNewEvents(statsWithGoalAndCard, statsWithGoalAndCard);
  check('no duplicates on re-poll', detected4.length === 0);

  /* ================================================================ *
   * Alert embeds
   * ================================================================ */
  section('ALERT EMBEDS');
  const fixture = makeFixture();
  const goalEmbed = buildGoalAlert(detected1[0], fixture);
  const goalText = JSON.stringify(goalEmbed.toJSON());
  check('goal alert mentions scorer', goalText.includes('Pedro Neto'));
  check('goal alert mentions team', goalText.includes('Chelsea'));
  check('goal alert mentions minute', goalText.includes('46\''));
  check('goal alert shows updated score', goalText.includes('1 - 2'));
  check('goal alert colour is positive', goalEmbed.data.color === BRAND.positive);

  const ownGoalEmbed = buildGoalAlert(detectedOg[0], fixture);
  const ogText = JSON.stringify(ownGoalEmbed.toJSON());
  check('own goal alert flagged', ogText.includes('OWN GOAL'));
  check('own goal alert mentions own goal', ogText.includes('own goal'));

  const cardEmbed = buildRedCardAlert(detected2[0], fixture);
  const cardText = JSON.stringify(cardEmbed.toJSON());
  check('red card alert mentions player', cardText.includes('Harrison Armstrong'));
  check('red card alert mentions team', cardText.includes('Everton'));
  check('red card alert mentions minute', cardText.includes('65\''));
  check('red card alert colour is negative', cardEmbed.data.color === BRAND.negative);

  /* ================================================================ *
   * Halftime report
   * ================================================================ */
  section('HALFTIME REPORT');
  const htFixture = makeFixture({ status: 'FINISHED' as any, homeScore: 1, awayScore: 1 });
  const htAnalysis = makeAnalysis({ fixture: htFixture });
  const htEmbed = buildHalftimeReport(htAnalysis);
  const htText = JSON.stringify(htEmbed.toJSON());
  check('halftime report titled', htEmbed.data.title === '🏁 Halftime Report');
  check('halftime report shows scoreline', htText.includes('1 - 1'));
  check('halftime report shot breakdown', htText.includes('Shot Breakdown'));
  check('halftime report xG', htText.includes('xG'));
  check('halftime report corners & cards', htText.includes('Corners') && htText.includes('Cards'));
  check('halftime report no undefined/NaN', !htText.includes('undefined') && !htText.includes('NaN'));

  /* ================================================================ *
   * /livematches embed formatting
   * ================================================================ */
  section('/LIVEMATCHES EMBED');
  const liveMatches = [
    makeFixture({ id: 'espn-1', homeTeam: { ...makeFixture().homeTeam, name: 'Everton' }, awayTeam: { ...makeFixture().awayTeam, name: 'Chelsea' }, homeScore: 1, awayScore: 2 }),
    makeFixture({ id: 'espn-2', homeTeam: { ...makeFixture().homeTeam, name: 'Real Madrid' }, awayTeam: { ...makeFixture().awayTeam, name: 'Sevilla' }, homeScore: 2, awayScore: 1, league: 'LALIGA' }),
  ];
  const liveEmbed = buildLiveMatchesEmbed(liveMatches);
  const liveText = JSON.stringify(liveEmbed.toJSON());
  check('livematches titled', liveEmbed.data.title === '🔴 Cape Predictor — Live Matches');
  check('livematches lists Everton v Chelsea', liveText.includes('Everton') && liveText.includes('Chelsea'));
  check('livematches lists Real Madrid v Sevilla', liveText.includes('Real Madrid') && liveText.includes('Sevilla'));
  check('livematches shows scores', liveText.includes('1 - 2') && liveText.includes('2 - 1'));
  check('livematches no undefined/NaN', !liveText.includes('undefined') && !liveText.includes('NaN'));

  const emptyLive = buildLiveMatchesEmbed([]);
  const emptyText = JSON.stringify(emptyLive.toJSON());
  check('empty livematches message', emptyText.includes('No matches are currently in progress'));

  /* ================================================================ *
   * Track buttons
   * ================================================================ */
  section('TRACK BUTTONS');
  const trackRows = buildLiveTrackRows(liveMatches);
  check('track rows within Discord limit', trackRows.length <= 5);
  trackRows.forEach((r, i) => {
    check(`track row ${i} has <= 5 buttons`, r.toJSON().components.length <= 5);
  });
  const allTrackButtons = trackRows.flatMap((r: any) => r.toJSON().components);
  const trackIds = allTrackButtons.map((c: any) => c.custom_id);
  check('track button for match 1', trackIds.includes('cp:live:track:espn-1'));
  check('track button for match 2', trackIds.includes('cp:live:track:espn-2'));
  check('track buttons are ⚡ Track actions', allTrackButtons.every((c: any) => c.emoji && c.emoji.name === '⚡'));

  /* ================================================================ *
   * Summary
   * ================================================================ */
  section('SUMMARY');
  console.log(`checks run : ${checks}`);
  console.log(`failures   : ${failures}`);
  console.log(failures === 0 ? '\nLIVE EVENTS VERIFICATION PASSED' : '\nLIVE EVENTS VERIFICATION FAILED');
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error('Fatal:', e.message); process.exit(1); });
