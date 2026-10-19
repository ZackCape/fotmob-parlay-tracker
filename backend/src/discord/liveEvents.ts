import fs from 'node:fs';
import nodePath from 'node:path';
import { EmbedBuilder } from 'discord.js';
import { EspnMatchStats } from '../providers/espn-adapter.js';
import { Fixture, MatchAnalysis } from '../types/football.js';
import { BRAND } from './brand.js';

/* ------------------------------------------------------------------ *
 * Live-event alerting & halftime reporting
 *
 * Maintains per-user/per-channel live-tracking subscriptions and a
 * de-duplicated record of already-announced match events, so every goal,
 * own goal, red card and halftime whistle is announced exactly once.
 * ------------------------------------------------------------------ */

const DATA_DIR = nodePath.resolve(process.cwd(), 'data');
const SUBS_FILE = nodePath.join(DATA_DIR, 'user_live_subscriptions.json');
const SEEN_FILE = nodePath.join(DATA_DIR, 'seen_live_events.json');

export interface LiveSubscription {
  userId: string;
  channelId: string;
  fixtureId: string;
  subscribedAt: number;
}

const subscriptions = new Map<string, LiveSubscription[]>(); // key: fixtureId -> []
const userSubKey = (userId: string, fixtureId: string) => `${userId}:${fixtureId}`;
const seenEvents = new Set<string>();
let persisting = false;

function ensureDataDir(): void {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  } catch { /* data dir may already exist or be unwritable */ }
}

function loadSubscriptions(): void {
  ensureDataDir();
  try {
    const raw = fs.readFileSync(SUBS_FILE, 'utf8');
    const arr: LiveSubscription[] = JSON.parse(raw);
    if (!Array.isArray(arr)) return;
    for (const s of arr) {
      if (!s?.userId || !s?.channelId || !s?.fixtureId) continue;
      const list = subscriptions.get(s.fixtureId) || [];
      list.push(s);
      subscriptions.set(s.fixtureId, list);
    }
  } catch { /* no file yet - start empty */ }
}

function saveSubscriptions(): void {
  if (persisting) return;
  persisting = true;
  ensureDataDir();
  try {
    const arr = [...subscriptions.values()].flat();
    fs.writeFileSync(SUBS_FILE, JSON.stringify(arr, null, 2));
  } catch (e: any) {
    console.warn('[LiveEvents] saveSubscriptions failed:', e.message);
  } finally {
    persisting = false;
  }
}

function loadSeenEvents(): void {
  ensureDataDir();
  try {
    const raw = fs.readFileSync(SEEN_FILE, 'utf8');
    const arr: unknown = JSON.parse(raw);
    if (Array.isArray(arr)) {
      for (const id of arr) if (typeof id === 'string') seenEvents.add(id);
    }
  } catch { /* no file yet - start empty */ }
}

function saveSeenEvents(): void {
  if (persisting) return;
  persisting = true;
  ensureDataDir();
  try {
    fs.writeFileSync(SEEN_FILE, JSON.stringify([...seenEvents], null, 2));
  } catch (e: any) {
    console.warn('[LiveEvents] saveSeenEvents failed:', e.message);
  } finally {
    persisting = false;
  }
}

// Hydrate from disk on module load.
initLiveSubscriptions();

// Persist to disk every minute (best-effort, never blocks the event loop).
setInterval(saveSubscriptions, 60_000).unref?.();
setInterval(saveSeenEvents, 60_000).unref?.();

/**
 * Boot report for the live-subscription store.
 */
export interface LiveSubscriptionBootReport {
  /** Subscriptions restored from disk. */
  total: number;
  /** Distinct fixtures that still have at least one subscriber. */
  fixtureIds: string[];
}

/**
 * Hydrate the live-subscription store (and the seen-event de-duplication set)
 * from `data/user_live_subscriptions.json` / `data/seen_live_events.json`.
 *
 * Called on boot by `DiscordBotService.start()`, which then hands the returned
 * fixture ids to the 60-second live worker so every match a user was tracking
 * before the restart is polled again on the worker's first tick instead of
 * waiting for the match to reappear in a fixture sweep.
 *
 * Intended to run once during boot; a later call replaces the in-memory store
 * with the file's contents.
 */
export function initLiveSubscriptions(): LiveSubscriptionBootReport {
  subscriptions.clear();
  seenEvents.clear();
  loadSubscriptions();
  loadSeenEvents();
  const total = [...subscriptions.values()].reduce((n, list) => n + list.length, 0);
  const fixtureIds = [...subscriptions.entries()]
    .filter(([, list]) => list.length > 0)
    .map(([fixtureId]) => fixtureId);
  if (total) {
    console.log(`[LiveEvents] Restored ${total} live subscription(s) across ${fixtureIds.length} fixture(s).`);
  }
  return { total, fixtureIds };
}

/* ------------------------------------------------------------------ *
 * Subscription store
 * ------------------------------------------------------------------ */

/** Register a user/channel pair for live alerts on a fixture. */
export function subscribeLive(userId: string, channelId: string, fixtureId: string): boolean {
  const list = subscriptions.get(fixtureId) || [];
  // De-duplicate per channel too, so a match tracked from two different
  // channels still alerts in both of them.
  if (list.some((s) => s.userId === userId && s.channelId === channelId && s.fixtureId === fixtureId)) return false;
  list.push({ userId, channelId, fixtureId, subscribedAt: Date.now() });
  subscriptions.set(fixtureId, list);
  saveSubscriptions();
  return true;
}

/** Remove a user's subscription to a fixture. */
export function unsubscribeLive(userId: string, fixtureId: string): boolean {
  const list = subscriptions.get(fixtureId);
  if (!list) return false;
  const before = list.length;
  const filtered = list.filter((s) => !(s.userId === userId && s.fixtureId === fixtureId));
  if (filtered.length === before) return false;
  subscriptions.set(fixtureId, filtered);
  saveSubscriptions();
  return true;
}

/** True when the user is subscribed to live alerts for this fixture. */
export function isSubscribed(userId: string, fixtureId: string): boolean {
  const list = subscriptions.get(fixtureId);
  return list?.some((s) => s.userId === userId) ?? false;
}

/** All subscriptions for a fixture (used when broadcasting an alert). */
export function getSubscriptionsForFixture(fixtureId: string): LiveSubscription[] {
  return [...(subscriptions.get(fixtureId) || [])];
}

/** Every active subscription (used by tests). */
export function allSubscriptions(): LiveSubscription[] {
  return [...subscriptions.values()].flat();
}

/**
 * Distinct fixture ids this user is tracking inside this channel. `/track`
 * uses it to render the "Tracked Matches" scorecard embed.
 */
export function getSubscribedFixtureIdsForUserChannel(userId: string, channelId: string): string[] {
  const ids = new Set<string>();
  for (const [fixtureId, list] of subscriptions.entries()) {
    if (list.some((s) => s.userId === userId && s.channelId === channelId)) ids.add(fixtureId);
  }
  return [...ids];
}

/* ------------------------------------------------------------------ *
 * Seen-event de-duplication
 * ------------------------------------------------------------------ */

export function isSeenEvent(eventId: string): boolean {
  return seenEvents.has(eventId);
}

export function markEventSeen(eventId: string): void {
  seenEvents.add(eventId);
}

/* ------------------------------------------------------------------ *
 * Event detection
 *
 * Compares the previous poll's ESPN events against the current poll and
 * returns only newly-published goals, own goals and red cards. ESPN's
 * `keyEvents` feed is the source of truth; each event carries a stable id.
 * ------------------------------------------------------------------ */

export interface DetectedEvent {
  id: string;
  type: 'goal' | 'own-goal' | 'red-card' | 'halftime';
  minute: string | null;
  team: string | null;
  player: string | null;
  assist: string | null;
  text: string | null;
}

/**
 * Return ESPN key events that have not been seen before, normalised into
 * alert-worthy categories. Non-alert events (substitutions, kickoff, etc.)
 * are deliberately dropped.
 */
export function detectNewEvents(
  previous: EspnMatchStats | null,
  current: EspnMatchStats | null,
): DetectedEvent[] {
  const previousIds = new Set((previous?.events ?? []).map((e) => e.id));
  const events = current?.events ?? [];
  const detected: DetectedEvent[] = [];

  for (const e of events) {
    if (!e.id || previousIds.has(e.id)) continue;
    const rawType = String(e.type ?? '').toLowerCase();
    const text = String(e.text ?? '').toLowerCase();
    const isOwnGoal = text.includes('own goal') || rawType === 'own-goal';

    let type: DetectedEvent['type'] | null = null;
    if (e.scoring || rawType === 'goal' || rawType === 'own-goal') {
      type = isOwnGoal ? 'own-goal' : 'goal';
    } else if (rawType === 'red-card' || rawType === 'redcard') {
      type = 'red-card';
    } else if (rawType === 'halftime') {
      type = 'halftime';
    } else {
      continue; // substitutions, delays, etc. are not alerted
    }

    detected.push({
      id: e.id,
      type,
      minute: e.minute ?? null,
      team: e.team ?? null,
      player: e.player ?? null,
      assist: e.assist ?? null,
      text: e.text ?? null,
    });
  }

  return detected;
}

/* ------------------------------------------------------------------ *
 * Alert embeds
 * ------------------------------------------------------------------ */

function scoreLine(f: Fixture): string {
  return `${f.homeScore ?? '-'} - ${f.awayScore ?? '-'}`;
}

export function buildGoalAlert(event: DetectedEvent, fixture: Fixture): EmbedBuilder {
  const isOwn = event.type === 'own-goal';
  const e = new EmbedBuilder()
    .setColor(isOwn ? BRAND.negative : BRAND.positive)
    .setAuthor({ name: BRAND.author })
    .setTitle(`${isOwn ? '🫣 OWN GOAL' : '⚽ GOAL ALERT'}`)
    .setDescription(
      `**${event.player ?? 'Unknown scorer'}**${isOwn ? ' (own goal)' : ''}` +
      ` scored for **${event.team ?? 'Unknown team'}** at **${event.minute ?? '?'}**'\n` +
      `Updated score: **${fixture.homeTeam.name} ${scoreLine(fixture)} ${fixture.awayTeam.name}**` +
      (event.assist ? `\n**Assist:** ${event.assist}` : '') +
      `\n• ${fixture.league}`,
    )
    .setFooter({ text: BRAND.footer })
    .setTimestamp(new Date());
  return e;
}

export function buildRedCardAlert(event: DetectedEvent, fixture: Fixture): EmbedBuilder {
  const e = new EmbedBuilder()
    .setColor(BRAND.negative)
    .setAuthor({ name: BRAND.author })
    .setTitle('🟥 RED CARD ALERT')
    .setDescription(
      `**${event.player ?? 'Unknown player'}** sent off for **${event.team ?? 'Unknown team'}**` +
      ` at **${event.minute ?? '?'}**'\n` +
      `Score at the time: **${fixture.homeTeam.name} ${scoreLine(fixture)} ${fixture.awayTeam.name}**\n` +
      `• ${fixture.league}`,
    )
    .setFooter({ text: BRAND.footer })
    .setTimestamp(new Date());
  return e;
}

/* ------------------------------------------------------------------ *
 * Halftime statistical analysis report
 * ------------------------------------------------------------------ */

function n(value: unknown): string {
  if (value === null || value === undefined || value === '') return 'N/A';
  const num = Number(value);
  return Number.isFinite(num) ? String(Math.round(num)) : 'N/A';
}

function bar(ratio: number, width = 10): string {
  const filled = Math.max(0, Math.min(width, Math.round(ratio * width)));
  return '█'.repeat(filled) + '░'.repeat(width - filled);
}

/**
 * Build the automated halftime analysis embed posted to every subscriber
 * of a fixture when the match reaches halftime.
 */
export function buildHalftimeReport(analysis: MatchAnalysis): EmbedBuilder {
  const f = analysis.fixture;
  const s = f.statistics;
  const home = f.homeTeam.name;
  const away = f.awayTeam.name;
  const h = f.homeScore ?? 0;
  const a = f.awayScore ?? 0;

  const e = new EmbedBuilder()
    .setColor(0x6B7280)
    .setAuthor({ name: BRAND.author })
    .setTitle('🏁 Halftime Report')
    .setDescription(
      `**${home} ${h} - ${a} ${away}**\n` +
      `*${fixtureLeague(f)}* • Halftime statistical snapshot\n` +
      `Report generated at halftime — second-half model update follows at full time.`,
    );

  // Shot breakdown: on target vs total (per side).
  const homeShots = n(s?.shotsHome);
  const awayShots = n(s?.shotsAway);
  const homeSot = n(s?.shotsOnTargetHome);
  const awaySot = n(s?.shotsOnTargetAway);
  e.addFields({
    name: '📊 Shot Breakdown (HT)',
    value:
      `**${home}:** ${homeSot} on target / ${homeShots} total\n` +
      `**${away}:** ${awaySot} on target / ${awayShots} total`,
    inline: false,
  });

  // Expected goals & possession.
  const homeXg = Number.isFinite(Number(s?.xgHome)) ? Number(s?.xgHome).toFixed(2) : 'N/A';
  const awayXg = Number.isFinite(Number(s?.xgAway)) ? Number(s?.xgAway).toFixed(2) : 'N/A';
  const possHome = Number.isFinite(Number(s?.possessionHome)) ? n(s?.possessionHome) : 'N/A';
  const possAway = Number.isFinite(Number(s?.possessionAway)) ? n(s?.possessionAway) : 'N/A';
  const poss = `${possHome}% — ${possAway}%`;
  e.addFields({
    name: '🎯 xG & Possession (HT)',
    value:
      `xG: **${homeXg} — ${awayXg}**\n` +
      `Possession: **${poss}**`,
    inline: false,
  });

  // Corners & cards.
  e.addFields({
    name: '🟨 Corners & 🟥 Cards (HT)',
    value:
      `Corners: **${n(s?.cornersHome)} — ${n(s?.cornersAway)}**\n` +
      `Cards: **${n(s?.yellowCardsHome)} — ${n(s?.yellowCardsAway)}**` +
      (s?.redCardsHome || s?.redCardsAway ? ` • Red: **${n(s?.redCardsHome)} — ${n(s?.redCardsAway)}**` : ''),
    inline: false,
  });

  // Model view: pre-match 1X2 + expected goals.
  const dc = analysis.dixonColesParameters;
  if (dc) {
    const oneXTwo = ['HOME_WIN', 'DRAW', 'AWAY_WIN']
      .map((m) => {
        const p = analysis.marketPredictions?.find((x) => x.market === m);
        return p ? `${p.selection} ${(p.estimatedProbability * 100).toFixed(0)}%` : null;
      })
      .filter(Boolean)
      .join(' • ');
    e.addFields({
      name: '🔮 Model at Kick-off',
      value:
        `1X2: ${oneXTwo || 'N/A'}\n` +
        `Expected goals: **${Number(dc.homeExpectedGoals).toFixed(2)} — ${Number(dc.awayExpectedGoals).toFixed(2)}**`,
      inline: false,
    });
  }

  e.setFooter({ text: `${BRAND.footer} • Halftime statistical analysis` });
  e.setTimestamp(new Date());
  return e;
}

function fixtureLeague(f: Fixture): string {
  return f.league;
}

/**
 * Calculate a 5-minute pressure index from live match statistics.
 *
 * Returns a value 0-100 representing how much one side is dominating. A value
 * above 75 triggers a "High Pressure Alert" in tracked channels.
 */
export function calculatePressureIndex(stats: any): { index: number; team: 'home' | 'away' | null } {
  if (!stats) return { index: 0, team: null };
  const possHome = Number(stats.possessionHome ?? 50);
  const possAway = Number(stats.possessionAway ?? 50);
  const shotsHome = Number(stats.shotsOnTargetHome ?? 0);
  const shotsAway = Number(stats.shotsOnTargetAway ?? 0);
  const cornersHome = Number(stats.cornersHome ?? 0);
  const cornersAway = Number(stats.cornersAway ?? 0);

  // Home pressure
  const homePressure = Math.min(100, (possHome * 0.4) + (shotsHome * 8) + (cornersHome * 3));
  // Away pressure
  const awayPressure = Math.min(100, (possAway * 0.4) + (shotsAway * 8) + (cornersAway * 3));

  if (homePressure >= awayPressure && homePressure >= 75) return { index: Math.round(homePressure), team: 'home' };
  if (awayPressure > homePressure && awayPressure >= 75) return { index: Math.round(awayPressure), team: 'away' };
  return { index: Math.max(homePressure, awayPressure), team: null };
}

export function buildPressureAlert(fixture: Fixture, pressure: { index: number; team: 'home' | 'away' | null }): EmbedBuilder {
  const home = fixture.homeTeam.name;
  const away = fixture.awayTeam.name;
  const teamName = pressure.team === 'home' ? home : away;
  const e = new EmbedBuilder()
    .setColor(BRAND.negative)
    .setAuthor({ name: BRAND.author })
    .setTitle('⚡ High Pressure Alert')
    .setDescription(
      `**${home} ${fixture.homeScore ?? 0} - ${fixture.awayScore ?? 0} ${away}**\n` +
      `**${teamName}** is applying sustained pressure (${pressure.index}% pressure index).`
    )
    .setFooter({ text: `${BRAND.footer} - Live pressure alert` })
    .setTimestamp(new Date());
  return e;
}

export default {
  subscribeLive,
  unsubscribeLive,
  isSubscribed,
  getSubscriptionsForFixture,
  allSubscriptions,
  initLiveSubscriptions,
  isSeenEvent,
  markEventSeen,
  detectNewEvents,
  buildGoalAlert,
  buildRedCardAlert,
  buildHalftimeReport,
  calculatePressureIndex,
  buildPressureAlert,
};
