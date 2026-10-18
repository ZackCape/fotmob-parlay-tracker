import fs from 'node:fs';
import nodePath from 'node:path';
import { EmbedBuilder } from 'discord.js';
import { Fixture, FixtureStatistics, FixtureStatus, MarketType } from '../types/football.js';
import { evaluateActualOutcome } from '../engine/market-calculator.js';
import { BRAND } from './brand.js';
import type { CustomParlay, ParlayLeg } from './parlayBuilder.js';

/* ------------------------------------------------------------------ *
 * Saved-parlay store + live leg-hit evaluation
 *
 * A slip built with /customparlay is persisted here on "Save & Share",
 * tied to the Discord channel and user that built it. The live-event
 * worker then checks each saved leg against live match stats and
 * broadcasts a PARLAY UPDATE embed to the originating channel every
 * time a leg settles.
 *
 * Nothing here invents data: a leg only settles when the live score,
 * corner or card counts actually satisfy the market. Everything else
 * stays PENDING.
 * ------------------------------------------------------------------ */

const DATA_DIR = nodePath.resolve(process.cwd(), 'data');
const SAVED_FILE = nodePath.join(DATA_DIR, 'saved_parlays.json');

export interface SavedParlayLeg {
  fixtureId: string;
  /** "Chelsea vs Opposition" — human readable match label. */
  description: string;
  league: string;
  market: MarketType;
  selection: string;
  probability: number;
  marketOdds?: number | null;
}

export interface SavedParlay {
  id: string;
  userId: string;
  channelId: string;
  guildId: string | null;
  legs: SavedParlayLeg[];
  stake: number;
  /** Combined bookmaker odds when every leg carried a price, else null. */
  combinedOdds: number | null;
  combinedProbability: number;
  savedAt: number;
  /**
   * Set on `[ 💾 Save & Share ]` so `/track` finds the slip immediately and
   * renders its leg status. A newer slip for the same user + channel retires
   * the previous one so `/track` always shows the live slip.
   */
  activeTracking: boolean;
  /** legKey -> settledResult, so a leg is announced exactly once. */
  settled: Record<string, 'HIT' | 'MISS'>;
}

const savedParlays = new Map<string, SavedParlay>();
let persisting = false;
let idCounter = 0;

function ensureDataDir(): void {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  } catch { /* data dir may already exist or be unwritable */ }
}

function load(): void {
  ensureDataDir();
  try {
    const raw = fs.readFileSync(SAVED_FILE, 'utf8');
    const arr: unknown = JSON.parse(raw);
    if (!Array.isArray(arr)) return;
    for (const item of arr as SavedParlay[]) {
      if (!item?.id || !item?.channelId || !item?.userId || !Array.isArray(item.legs)) continue;
      savedParlays.set(item.id, {
        ...item,
        // Records written before tracking existed were saved to be tracked.
        activeTracking: item.activeTracking ?? true,
        settled: item.settled ?? {},
      });
    }
  } catch { /* no file yet - start empty */ }
}

function persist(): void {
  if (persisting) return;
  persisting = true;
  ensureDataDir();
  try {
    const arr = [...savedParlays.values()];
    fs.writeFileSync(SAVED_FILE, JSON.stringify(arr, null, 2));
  } catch (e: any) {
    console.warn('[SavedParlays] persist failed:', e.message);
  } finally {
    persisting = false;
  }
}

// Hydrate from disk on module load.
load();

/** Stable identity for a leg, used to remember what has already settled. */
export function legKey(leg: { fixtureId: string; market: MarketType; selection: string }): string {
  return `${leg.fixtureId}:${leg.market}:${leg.selection}`;
}

function toSavedLeg(leg: ParlayLeg): SavedParlayLeg {
  return {
    fixtureId: leg.fixtureId,
    description: leg.description,
    league: leg.league,
    market: leg.market,
    selection: leg.selection,
    probability: leg.probability,
    marketOdds: leg.marketOdds ?? null,
  };
}

/** Product of every leg's bookmaker price, or null when one is missing. */
function combinedMarketOdds(legs: SavedParlayLeg[]): number | null {
  if (!legs.length) return null;
  let product = 1;
  for (const l of legs) {
    const o = l.marketOdds;
    if (typeof o !== 'number' || !Number.isFinite(o) || o <= 1) return null;
    product *= o;
  }
  return Number(product.toFixed(3));
}

/**
 * Persist a built slip to `data/saved_parlays.json`, tied to the channel
 * and user it was saved from.
 */
export function saveParlayToDisk(
  parlay: CustomParlay,
  meta: { userId: string; channelId: string; guildId?: string | null },
): SavedParlay {
  const legs: SavedParlayLeg[] = parlay.legs.map(toSavedLeg);
  const combinedProbability = Number(
    legs.reduce((acc, l) => acc * Math.max(0.0001, l.probability), 1).toFixed(6),
  );
  // Retire any earlier slip for this user + channel so /track shows the slip
  // the user just saved rather than a stale one.
  for (const other of getSavedParlaysForUserChannel(meta.userId, meta.channelId)) {
    setSavedParlayActiveTracking(other.id, false);
  }
  const saved: SavedParlay = {
    id: `sp-${Date.now()}-${++idCounter}`,
    userId: meta.userId,
    channelId: meta.channelId,
    guildId: meta.guildId ?? null,
    legs,
    stake: parlay.stake,
    combinedOdds: combinedMarketOdds(legs),
    combinedProbability,
    savedAt: Date.now(),
    activeTracking: true,
    settled: {},
  };
  savedParlays.set(saved.id, saved);
  persist();
  return saved;
}

export function getSavedParlay(id: string): SavedParlay | undefined {
  return savedParlays.get(id);
}

export function getSavedParlays(): SavedParlay[] {
  return [...savedParlays.values()];
}

export function getSavedParlaysByChannel(channelId: string): SavedParlay[] {
  return [...savedParlays.values()].filter((p) => p.channelId === channelId);
}

export function getSavedParlaysByUser(userId: string): SavedParlay[] {
  return [...savedParlays.values()].filter((p) => p.userId === userId);
}

/** Every saved slip that has at least one leg on this fixture. */
export function getSavedParlaysForFixture(fixtureId: string): SavedParlay[] {
  return [...savedParlays.values()].filter((p) => p.legs.some((l) => l.fixtureId === fixtureId));
}

/** Test/cleanup helper — wipes the in-memory store and the backing file. */
export function clearSavedParlays(): void {
  savedParlays.clear();
  persist();
}

export function isSavedLegSettled(savedId: string, leg: { fixtureId: string; market: MarketType; selection: string }): boolean {
  return Boolean(savedParlays.get(savedId)?.settled[legKey(leg)]);
}

export function markSavedLegSettled(
  savedId: string,
  leg: { fixtureId: string; market: MarketType; selection: string },
  status: 'HIT' | 'MISS',
): void {
  const saved = savedParlays.get(savedId);
  if (!saved) return;
  saved.settled[legKey(leg)] = status;
  persist();
}

export function countSettledLegs(saved: SavedParlay): number {
  return Object.keys(saved.settled).length;
}

/* ------------------------------------------------------------------ *
 * /track lookup — a saved slip is owned by a (userId, channelId) pair
 * ------------------------------------------------------------------ */

/** Saved slips belonging to a user in a specific channel. */
export function getSavedParlaysForUserChannel(userId: string, channelId: string): SavedParlay[] {
  return [...savedParlays.values()].filter(
    (p) => p.userId === userId && p.channelId === channelId,
  );
}

/** Saved slips still listed by `/track`, newest first. */
export function getActiveSavedParlaysForUserChannel(userId: string, channelId: string): SavedParlay[] {
  return getSavedParlaysForUserChannel(userId, channelId)
    .filter((p) => p.activeTracking)
    .sort((a, b) => b.savedAt - a.savedAt);
}

/** Flip the ACTIVE_TRACKING flag on a saved slip. */
export function setSavedParlayActiveTracking(savedId: string, active: boolean): void {
  const saved = savedParlays.get(savedId);
  if (!saved || saved.activeTracking === active) return;
  saved.activeTracking = active;
  persist();
}

/** PENDING / HIT / MISS for one leg, from the live worker's settlement map. */
export function savedLegStatus(saved: SavedParlay, leg: SavedParlayLeg): 'HIT' | 'MISS' | 'PENDING' {
  return saved.settled[legKey(leg)] ?? 'PENDING';
}

const LEG_STATUS_ICON: Record<'HIT' | 'MISS' | 'PENDING', string> = {
  HIT: '🟢 HIT',
  MISS: '🔴 MISSED',
  PENDING: '⏳ PENDING',
};

/**
 * The `/track` card for a saved slip: every leg with its settlement status so
 * the user can see at a glance what has landed and what is still open.
 */
export function buildSavedSlipTrackerEmbed(saved: SavedParlay): EmbedBuilder {
  const settledCount = countSettledLegs(saved);
  const hits = Object.values(saved.settled).filter((s) => s === 'HIT').length;
  const misses = Object.values(saved.settled).filter((s) => s === 'MISS').length;
  const pending = Math.max(0, saved.legs.length - settledCount);
  const complete = saved.legs.length > 0 && pending === 0;

  const embed = new EmbedBuilder()
    .setColor(complete ? (misses === 0 ? BRAND.positive : BRAND.negative) : BRAND.accent)
    .setAuthor({ name: BRAND.author })
    .setTitle(`🎯 Tracked Parlay — ${saved.legs.length} Leg${saved.legs.length === 1 ? '' : 's'}`)
    .setTimestamp(new Date());

  const lines = saved.legs.map((leg, i) => {
    const status = LEG_STATUS_ICON[savedLegStatus(saved, leg)];
    return `\`${i + 1}\` ${status} — **${leg.description}**\n     ${leg.selection}`;
  });
  embed.setDescription(
    (lines.join('\n') || 'No legs on this slip.').slice(0, 4096),
  );

  embed.addFields(
    {
      name: 'Tracking',
      value: `${saved.activeTracking ? '**ACTIVE_TRACKING**' : 'Closed'} • ${settledCount}/${saved.legs.length} legs settled`,
      inline: true,
    },
    {
      name: 'Status',
      value: `🟢 ${hits} Hit • 🔴 ${misses} Missed • ⏳ ${pending} Pending`,
      inline: true,
    },
    {
      name: 'Slip',
      value: `Stake $${saved.stake.toFixed(2)}${saved.combinedOdds ? ` • combined ${saved.combinedOdds.toFixed(2)}x` : ''}`,
      inline: true,
    },
  );

  embed.setFooter({ text: `${BRAND.footer} • Leg status from live match data` });
  return embed;
}

/* ------------------------------------------------------------------ *
 * Live leg evaluation
 * ------------------------------------------------------------------ */

export interface LiveLegContext {
  homeTeam: string;
  awayTeam: string;
  homeScore: number | null;
  awayScore: number | null;
  status: FixtureStatus;
  statistics?: FixtureStatistics | null;
}

/** Minimal event info used to enrich a goal note (never fabricated). */
export interface LegHitEvent {
  minute: string | null;
  team: string | null;
  player: string | null;
}

export interface LegProgress {
  status: 'HIT' | 'PENDING' | 'MISS';
  /** Short factual parenthetical, e.g. "Chelsea scored at 34'". */
  note: string;
}

function numOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function normalizeMinute(minute: string | null): string | null {
  if (!minute) return null;
  const stripped = String(minute).replace(/'/g, '').trim();
  return stripped ? `${stripped}'` : null;
}

function totalFrom(stats: FixtureStatistics | null | undefined, key: 'corners' | 'cards'): number | null {
  if (!stats) return null;
  if (key === 'corners') {
    const h = numOrNull(stats.cornersHome);
    const a = numOrNull(stats.cornersAway);
    return h !== null && a !== null ? h + a : null;
  }
  const yh = numOrNull(stats.yellowCardsHome);
  const ya = numOrNull(stats.yellowCardsAway);
  if (yh === null || ya === null) return null;
  return yh + ya + (numOrNull(stats.redCardsHome) ?? 0) + (numOrNull(stats.redCardsAway) ?? 0);
}

/**
 * Evaluate one saved leg against live match data.
 *
 * Accumulating markets (Over goals / corners / cards, BTTS) can settle
 * mid-match the moment the threshold is reached. Every other market only
 * settles at full time, so we never announce an early win we cannot know.
 */
export function evaluateSavedLeg(leg: SavedParlayLeg, ctx: LiveLegContext, latestGoal?: LegHitEvent | null): LegProgress {
  const h = ctx.homeScore;
  const a = ctx.awayScore;
  if (h === null || a === null) return { status: 'PENDING', note: 'Scoreline not published yet' };

  const total = h + a;
  const corners = totalFrom(ctx.statistics, 'corners');
  const cards = totalFrom(ctx.statistics, 'cards');

  const goalNote = (): string => {
    if (latestGoal) {
      const minute = normalizeMinute(latestGoal.minute);
      if (minute) return `${latestGoal.team ?? 'A team'} scored at ${minute}`;
      if (latestGoal.player) return `${latestGoal.player} scored`;
      if (latestGoal.team) return `${latestGoal.team} scored`;
    }
    return `${total} goal${total === 1 ? '' : 's'} scored`;
  };

  // --- Mid-match early settlement for accumulating markets ---
  let earlyHit: { note: string } | null = null;
  switch (leg.market) {
    case 'OVER_0_5':
      if (total >= 1) earlyHit = { note: goalNote() };
      break;
    case 'OVER_1_5':
      if (total >= 2) earlyHit = { note: goalNote() };
      break;
    case 'OVER_2_5':
      if (total >= 3) earlyHit = { note: goalNote() };
      break;
    case 'HOME_OVER_0_5':
      if (h >= 1) earlyHit = { note: `${ctx.homeTeam} scored` };
      break;
    case 'AWAY_OVER_0_5':
      if (a >= 1) earlyHit = { note: `${ctx.awayTeam} scored` };
      break;
    case 'BTTS_YES':
      if (h > 0 && a > 0) earlyHit = { note: 'both teams scored' };
      break;
    case 'OVER_5_5_CORNERS':
      if (corners !== null && corners >= 6) earlyHit = { note: `${corners} corners taken` };
      break;
    case 'OVER_7_5_CORNERS':
      if (corners !== null && corners >= 8) earlyHit = { note: `${corners} corners taken` };
      break;
    case 'OVER_8_5_CORNERS':
      if (corners !== null && corners >= 9) earlyHit = { note: `${corners} corners taken` };
      break;
    case 'OVER_9_5_CORNERS':
      if (corners !== null && corners >= 10) earlyHit = { note: `${corners} corners taken` };
      break;
    case 'OVER_2_5_CARDS':
      if (cards !== null && cards >= 3) earlyHit = { note: `${cards} cards shown` };
      break;
    case 'OVER_3_5_CARDS':
      if (cards !== null && cards >= 4) earlyHit = { note: `${cards} cards shown` };
      break;
    case 'OVER_4_5_CARDS':
      if (cards !== null && cards >= 5) earlyHit = { note: `${cards} cards shown` };
      break;
    default:
      break;
  }

  if (earlyHit) return { status: 'HIT', note: earlyHit.note };

  // --- Full-time settlement for everything else ---
  if (ctx.status === 'FINISHED') {
    const synthetic = {
      homeScore: h,
      awayScore: a,
      htHomeScore: null,
      htAwayScore: null,
      statistics: ctx.statistics ?? null,
    } as unknown as Fixture;
    const outcome = evaluateActualOutcome(leg.market, synthetic);
    const note = `full time ${h}-${a}`;
    if (outcome === 'HIT') return { status: 'HIT', note };
    if (outcome === 'MISS') return { status: 'MISS', note };
    return { status: 'PENDING', note: 'awaiting full-time statistics' };
  }

  return { status: 'PENDING', note: 'in play' };
}

/**
 * Broadcast embed for a settled leg, matching the requested format:
 *
 *   🟢 **PARLAY UPDATE:** `[Chelsea vs Opposition]` — **Leg Hit:**
 *   `Over 0.5 Goals` ✅ *(Chelsea scored at 34')* [1/5 Legs Settled]
 */
export function buildParlayUpdateEmbed(opts: {
  saved: SavedParlay;
  leg: SavedParlayLeg;
  progress: LegProgress;
  settledCount: number;
  totalLegs: number;
}): EmbedBuilder {
  const { saved, leg, progress, settledCount, totalLegs } = opts;
  const isHit = progress.status === 'HIT';
  const emoji = isHit ? '🟢' : '🔴';
  const verb = isHit ? 'Leg Hit' : 'Leg Missed';
  const mark = isHit ? '✅' : '❌';

  const e = new EmbedBuilder()
    .setColor(isHit ? BRAND.positive : BRAND.negative)
    .setAuthor({ name: BRAND.author })
    .setTitle(`${emoji} Parlay Update`)
    .setTimestamp(new Date());

  e.setDescription(
    `${emoji} **PARLAY UPDATE:** \`[${leg.description}]\` — **${verb}:** \`${leg.selection}\` ${mark} *(${progress.note})* [${settledCount}/${totalLegs} Legs Settled]`,
  );

  e.addFields(
    { name: 'Match', value: leg.description, inline: true },
    { name: 'Market', value: leg.selection, inline: true },
    { name: 'Slip', value: `${settledCount}/${totalLegs} legs settled • stake $${saved.stake.toFixed(2)}`, inline: true },
  );

  e.setFooter({ text: `${BRAND.footer} • Live parlay tracking` });
  return e;
}

export default {
  saveParlayToDisk,
  getSavedParlay,
  getSavedParlays,
  getSavedParlaysByChannel,
  getSavedParlaysByUser,
  getSavedParlaysForUserChannel,
  getActiveSavedParlaysForUserChannel,
  setSavedParlayActiveTracking,
  getSavedParlaysForFixture,
  clearSavedParlays,
  legKey,
  savedLegStatus,
  isSavedLegSettled,
  markSavedLegSettled,
  countSettledLegs,
  evaluateSavedLeg,
  buildParlayUpdateEmbed,
  buildSavedSlipTrackerEmbed,
};
