/**
 * Cape Predictor — parlay match filtering + /track linking verification.
 *
 * Usage: npx tsx backend/scripts/test-parlay-filter-and-track.ts
 *
 * Exercises the REAL modules (no mocks, no network) and verifies:
 *
 *   1. Match filtering — the /customparlay match dropdown excludes finished
 *      (FT / AET / PEN) and live (LIVE / IN_PLAY) fixtures and only offers
 *      upcoming (SCHEDULED / pre-kickoff) matches.
 *
 *   2. Save -> /track linking — `[ 💾 Save & Share ]` registers the slip as
 *      ACTIVE_TRACKING so `/track` retrieves it straight away for the same
 *      (userId, channelId) pair and renders each leg as
 *      ⏳ PENDING / 🟢 HIT / 🔴 MISSED.
 *
 * `data/saved_parlays.json` is snapshotted before the run and restored
 * afterwards, so real saved slips are never clobbered by the test.
 *
 * Exits non-zero if any check fails.
 */
import fs from 'node:fs';
import { resolve } from 'node:path';

import {
  getParlay, clearParlay, addLeg, saveParlay,
  buildParlayMatchRow, buildParlayPayload,
} from '../src/discord/parlayBuilder.js';
import { isUpcomingFixture, filterUpcomingFixtures, isPreKickoffFixture, filterPreKickoffFixtures } from '../src/discord/fixtureStatus.js';
import {
  saveParlayToDisk, clearSavedParlays,
  getSavedParlaysForUserChannel, getActiveSavedParlaysForUserChannel,
  setSavedParlayActiveTracking, savedLegStatus, buildSavedSlipTrackerEmbed,
  markSavedLegSettled, countSettledLegs,
} from '../src/discord/savedParlays.js';

const repoRoot = process.cwd();
const savedFile = resolve(repoRoot, 'data', 'saved_parlays.json');
const botSrc = fs.readFileSync(resolve(repoRoot, 'backend', 'src', 'discord', 'bot.ts'), 'utf-8');
const savedSrc = fs.readFileSync(resolve(repoRoot, 'backend', 'src', 'discord', 'savedParlays.ts'), 'utf-8');

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
  console.log(`\n${title}`);
}

/** A fixture shaped like the provider output the builder consumes. */
function fixture(id: string, status: string, extra: Record<string, unknown> = {}): any {
  return {
    id,
    league: 'EPL',
    status,
    kickoffTime: '2026-10-18T15:00:00Z',
    homeTeam: { name: `Home ${id}` },
    awayTeam: { name: `Away ${id}` },
    ...extra,
  };
}

/** Option values currently rendered by a match-select row. */
function matchRowValues(row: any): string[] {
  const menu = row.toJSON().components[0] as { options?: Array<{ value: string }> };
  return (menu.options ?? []).map((o) => o.value);
}

/* ================================================================== *
 * 1) /customparlay match dropdown excludes finished & live matches
 * ================================================================== */
section('1) /customparlay match dropdown — upcoming fixtures only');
{
  const upcoming = fixture('f-timed', 'TIMED');
  const upcoming2 = fixture('f-timed2', 'TIMED');
  const scheduledRaw = fixture('f-sched', '', { statusShort: 'SCHEDULED' });
  const live = fixture('f-live', 'LIVE');
  const finished = fixture('f-ft', 'FINISHED');
  const postponed = fixture('f-pp', 'POSTPONED');
  const aetRaw = fixture('f-aet', '', { statusShort: 'AET' });
  const penRaw = fixture('f-pen', '', { statusShort: 'PEN' });
  const ftRaw = fixture('f-ftraw', '', { statusShort: 'FT' });
  const inPlayRaw = fixture('f-inplay', '', { statusShort: 'IN_PLAY' });

  const slate = [
    upcoming, live, finished, postponed, aetRaw, penRaw, ftRaw, inPlayRaw, upcoming2, scheduledRaw,
  ];

  check('TIMED (pre-kickoff) fixture is upcoming', isUpcomingFixture(upcoming) === true);
  check('un-normalised SCHEDULED fixture is upcoming', isUpcomingFixture(scheduledRaw) === true);
  check('LIVE fixture is excluded', isUpcomingFixture(live) === false);
  check('FINISHED (FT) fixture is excluded', isUpcomingFixture(finished) === false);
  check('POSTPONED fixture is excluded', isUpcomingFixture(postponed) === false);
  check('AET fixture is excluded', isUpcomingFixture(aetRaw) === false);
  check('PEN fixture is excluded', isUpcomingFixture(penRaw) === false);
  check('raw FT fixture is excluded', isUpcomingFixture(ftRaw) === false);
  check('IN_PLAY fixture is excluded', isUpcomingFixture(inPlayRaw) === false);

  const filtered = filterUpcomingFixtures(slate).map((f) => f.id);
  check('filter keeps only upcoming matches',
    JSON.stringify(filtered) === JSON.stringify(['f-timed', 'f-timed2', 'f-sched']),
    JSON.stringify(filtered));

  const row = buildParlayMatchRow(slate);
  const values = matchRowValues(row);
  check('match dropdown offers only upcoming fixture ids',
    !values.includes('f-live') && !values.includes('f-ft') && !values.includes('f-aet') &&
    !values.includes('f-pen') && !values.includes('f-inplay') && !values.includes('f-pp'),
    JSON.stringify(values));
  check('match dropdown still offers every upcoming match',
    values.includes('f-timed') && values.includes('f-timed2') && values.includes('f-sched'),
    JSON.stringify(values));
  check('match dropdown is selectable while upcoming matches exist',
    (row.components[0].data as { disabled?: boolean }).disabled === false);

  // Everything has kicked off -> disabled menu, explicit empty state.
  const deadRow = buildParlayMatchRow([live, finished, aetRaw]);
  const deadMenu = deadRow.components[0].data as { disabled?: boolean; placeholder?: string };
  check('dropdown disables itself when no upcoming matches remain', deadMenu.disabled === true);
  check('empty dropdown says no upcoming matches',
    (deadMenu.placeholder ?? '').toLowerCase().includes('no upcoming'), deadMenu.placeholder);
  check('empty dropdown exposes a "none" sentinel', matchRowValues(deadRow).includes('none'));

  // The full /customparlay payload must carry the filtered match row too.
  const u = 'user-filter-payload';
  clearParlay(u);
  const payload = buildParlayPayload(getParlay(u), slate, { league: 'EPL' });
  const payloadValues = matchRowValues(payload.components[1]);
  check('full parlay payload match row is filtered too',
    payloadValues.includes('f-timed') && !payloadValues.includes('f-live') && !payloadValues.includes('f-ft'),
    JSON.stringify(payloadValues));

  // Wiring: the live fixture slate feeding /customparlay is filtered.
  check('bot filters the /customparlay fixture slate before rendering',
    botSrc.includes('CP.filterPreKickoffFixtures(fixtures)'));
  check('interactions re-exports the fixture-status helpers',
    fs.readFileSync(resolve(repoRoot, 'backend', 'src', 'discord', 'interactions.ts'), 'utf-8')
      .includes("from './fixtureStatus.js'"));
  clearParlay(u);
}

/* ================================================================== *
 * 1b) Pre-kickoff wall-clock guard (web + Discord generators)
 * ================================================================== */
section('1b) pre-kickoff guard — already-started matches are rejected');
{
  const now = Date.now();
  const FUTURE = new Date(now + 3 * 3600_000).toISOString();
  const PAST = new Date(now - 5 * 60_000).toISOString();

  const future = fixture('f-future', 'TIMED', { kickoffTime: FUTURE });
  const staleTimed = fixture('f-stale', 'TIMED', { kickoffTime: PAST });
  const noKickoff = fixture('f-nokick', 'TIMED', { kickoffTime: '' });
  const live = fixture('f-live2', 'LIVE', { kickoffTime: PAST });
  const finished = fixture('f-ft2', 'FINISHED', { kickoffTime: PAST });

  check('future TIMED fixture passes the pre-kickoff guard', isPreKickoffFixture(future, now) === true);
  check('stale TIMED fixture whose kick-off has passed is rejected', isPreKickoffFixture(staleTimed, now) === false);
  check('fixture without a kick-off time is rejected (fail-closed)', isPreKickoffFixture(noKickoff, now) === false);
  check('in-play fixture is rejected', isPreKickoffFixture(live, now) === false);
  check('finished fixture is rejected', isPreKickoffFixture(finished, now) === false);

  const kept = filterPreKickoffFixtures([future, staleTimed, noKickoff, live, finished], now).map((f) => f.id);
  check('filter keeps only the not-yet-started match',
    JSON.stringify(kept) === JSON.stringify(['f-future']), JSON.stringify(kept));

  // The web generator rejects every "already started / over" status code.
  const statuses = ['FT', 'AET', 'PEN', 'FINISHED', 'LIVE', 'IN_PLAY', 'HT', 'PAUSED', 'POSTPONED'];
  const allRejected = statuses.every((code) => {
    const normalised = ['FINISHED', 'LIVE', 'POSTPONED', 'TIMED'].includes(code) ? code : '';
    const f = fixture(`f-${code}`, normalised, { statusShort: code, kickoffTime: FUTURE });
    return isPreKickoffFixture(f, now) === false;
  });
  check('FT/AET/PEN/FINISHED/LIVE/IN_PLAY/HT/PAUSED/POSTPONED all rejected', allRejected);

  // Wiring: both generators apply the guard.
  const routeSrc = fs.readFileSync(resolve(repoRoot, 'backend', 'src', 'routes', 'parlays.ts'), 'utf-8');
  check('web /api/parlays/generate filters fixtures with filterPreKickoffFixtures',
    routeSrc.includes("import { filterPreKickoffFixtures } from '../discord/fixtureStatus.js'") &&
    routeSrc.includes('filterPreKickoffFixtures(allFixtures)'));
  check('web generator skips persisting an empty parlay', routeSrc.includes('if (parlay.legs.length > 0)'));
  check('Discord /generateparlay applies the pre-kickoff guard',
    botSrc.includes('CP.filterPreKickoffFixtures(allFixtures.filter(fx => isVerifiedFixture(fx)))'));
}

/* ================================================================== *
 * 2) Save & Share -> /track retrieval
 * ================================================================== */
section('2) Save & Share registers the slip for /track');
const hadFile = fs.existsSync(savedFile);
const backup: Buffer | null = hadFile ? fs.readFileSync(savedFile) : null;

try {
  clearSavedParlays();

  const userId = 'test-track-user';
  const channelId = 'test-track-chan';
  const otherChannel = 'test-track-other-chan';
  const otherUser = 'test-track-other-user';

  clearParlay(userId);
  const slip = getParlay(userId);
  addLeg(slip, {
    fixtureId: 'f-timed', description: 'Home f-timed v Away f-timed', league: 'EPL',
    market: 'OVER_0_5', selection: 'Over 0.5 Goals', probability: 0.9, marketOdds: 1.25,
  });
  addLeg(slip, {
    fixtureId: 'f-timed2', description: 'Home f-timed2 v Away f-timed2', league: 'EPL',
    market: 'OVER_8_5_CORNERS', selection: 'Over 8.5 Corners', probability: 0.62, marketOdds: 1.9,
  });

  const saveRes = saveParlay(slip);
  check('slip passes Save & Share validation', saveRes.ok === true, saveRes.reason);

  const saved = saveParlayToDisk(slip, { userId, channelId, guildId: 'guild-test' });

  check('Save & Share marks the slip ACTIVE_TRACKING: true', saved.activeTracking === true);
  check('persisted record stores the activeTracking flag', savedSrc.includes('activeTracking: true'));

  const forUserChannel = getSavedParlaysForUserChannel(userId, channelId);
  check('/track lookup finds the slip by userId AND channelId',
    forUserChannel.some((p) => p.id === saved.id));

  const active = getActiveSavedParlaysForUserChannel(userId, channelId);
  check('/track active lookup returns the freshly saved slip',
    active.length === 1 && active[0].id === saved.id, `active=${active.length}`);

  check('slip is NOT visible to a different channel',
    getSavedParlaysForUserChannel(userId, otherChannel).length === 0);
  check('slip is NOT visible to a different user',
    getSavedParlaysForUserChannel(otherUser, channelId).length === 0);

  // Leg status indicators.
  check('leg 1 starts PENDING', savedLegStatus(saved, saved.legs[0]) === 'PENDING');
  check('leg 2 starts PENDING', savedLegStatus(saved, saved.legs[1]) === 'PENDING');

  const pendingEmbed = buildSavedSlipTrackerEmbed(saved).toJSON();
  const pendingDesc = pendingEmbed.description ?? '';
  check('/track card shows ⏳ PENDING legs', pendingDesc.includes('⏳ PENDING'));
  check('/track card lists both leg selections',
    pendingDesc.includes('Over 0.5 Goals') && pendingDesc.includes('Over 8.5 Corners'));
  check('/track card title counts the legs', (pendingEmbed.title ?? '').includes('2 Legs'));
  check('/track card advertises ACTIVE_TRACKING',
    (pendingEmbed.fields ?? []).some((f) => f.value.includes('ACTIVE_TRACKING')));

  // Settle one leg HIT and one MISS, as the live worker would.
  markSavedLegSettled(saved.id, saved.legs[0], 'HIT');
  markSavedLegSettled(saved.id, saved.legs[1], 'MISS');
  check('settled counter reflects both legs', countSettledLegs(saved) === 2);
  check('leg 1 reads 🟢 HIT', savedLegStatus(saved, saved.legs[0]) === 'HIT');
  check('leg 2 reads 🔴 MISSED', savedLegStatus(saved, saved.legs[1]) === 'MISS');

  const settledEmbed = buildSavedSlipTrackerEmbed(saved).toJSON();
  const settledDesc = settledEmbed.description ?? '';
  check('/track card shows 🟢 HIT for the winning leg', settledDesc.includes('🟢 HIT'));
  check('/track card shows 🔴 MISSED for the losing leg', settledDesc.includes('🔴 MISSED'));
  check('/track card status field counts the mixed result',
    (settledEmbed.fields ?? []).some((f) => f.value.includes('1 Hit') && f.value.includes('1 Missed')));

  // On-disk persistence check.
  let persisted = false;
  try {
    const parsed = JSON.parse(fs.readFileSync(savedFile, 'utf8')) as any[];
    persisted = Array.isArray(parsed) &&
      parsed.some((p) => p.id === saved.id && p.userId === userId && p.channelId === channelId && p.activeTracking === true);
  } catch { persisted = false; }
  check('data/saved_parlays.json holds the slip keyed by channel + user', persisted);

  // A newer slip retires the previous one so /track shows the current slip.
  clearParlay(userId);
  const slip2 = getParlay(userId);
  addLeg(slip2, {
    fixtureId: 'f-timed', description: 'Home f-timed v Away f-timed', league: 'EPL',
    market: 'OVER_1_5', selection: 'Over 1.5 Goals', probability: 0.8, marketOdds: 1.5,
  });
  const saved2 = saveParlayToDisk(slip2, { userId, channelId, guildId: 'guild-test' });

  check('saving again retires the earlier slip',
    getSavedParlaysForUserChannel(userId, channelId).find((p) => p.id === saved.id)?.activeTracking === false);
  const activeAfter = getActiveSavedParlaysForUserChannel(userId, channelId);
  check('/track now reports exactly the newest slip',
    activeAfter.length === 1 && activeAfter[0].id === saved2.id, `active=${activeAfter.length}`);

  setSavedParlayActiveTracking(saved2.id, false);
  check('a slip can be closed and drops out of /track',
    getActiveSavedParlaysForUserChannel(userId, channelId).length === 0);

  // Wiring: the /track handler passes the user + channel through.
  const botSrcFlat = botSrc.replace(/\s+/g, ' ');
  check('/track handler passes userId + channelId from a slash command',
    botSrcFlat.includes('generateLiveTrackerReply({ userId: interaction.user.id, channelId: interaction.channelId, });'));
  check('/track handler passes userId + channelId from a chat command',
    botSrcFlat.includes('generateLiveTrackerReply({ userId: message.author.id, channelId: message.channel.id, });'));
} finally {
  // Restore the pre-run slip store so the test never clobbers real data.
  try {
    if (backup !== null) {
      fs.writeFileSync(savedFile, backup);
    } else if (fs.existsSync(savedFile)) {
      fs.rmSync(savedFile);
    }
  } catch { /* best effort restore */ }
}

console.log(`\n${checks - failures}/${checks} checks passed.`);
if (failures > 0) {
  console.error(`${failures} check(s) FAILED.`);
  process.exit(1);
}
console.log('All parlay match-filter and /track linking checks passed.');
