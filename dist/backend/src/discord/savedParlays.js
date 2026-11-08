import fs from 'node:fs';
import nodePath from 'node:path';
import { EmbedBuilder } from 'discord.js';
import { evaluateActualOutcome } from '../engine/market-calculator.js';
import { BRAND } from './brand.js';
import { isChannelBlocked, BLOCKED_CHANNEL_IDS } from './blockedChannels.js';
import { safeToFixed } from '../utils/formatters.js';
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
const savedParlays = new Map();
let persisting = false;
let idCounter = 0;
function ensureDataDir() {
    try {
        fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    catch { /* data dir may already exist or be unwritable */ }
}
function load() {
    ensureDataDir();
    try {
        const raw = fs.readFileSync(SAVED_FILE, 'utf8');
        const arr = JSON.parse(raw);
        if (!Array.isArray(arr))
            return;
        for (const item of arr) {
            if (!item?.id || !item?.channelId || !item?.userId || !Array.isArray(item.legs))
                continue;
            savedParlays.set(item.id, {
                ...item,
                // Records written before tracking existed were saved to be tracked.
                activeTracking: item.activeTracking ?? true,
                settled: item.settled ?? {},
            });
        }
    }
    catch { /* no file yet - start empty */ }
}
function persist() {
    if (persisting)
        return;
    persisting = true;
    ensureDataDir();
    try {
        const arr = [...savedParlays.values()];
        fs.writeFileSync(SAVED_FILE, JSON.stringify(arr, null, 2));
    }
    catch (e) {
        console.warn('[SavedParlays] persist failed:', e.message);
    }
    finally {
        persisting = false;
    }
}
// Hydrate from disk on module load.
initSavedParlays();
/**
 * Hydrate the saved-slip store from `data/saved_parlays.json`.
 *
 * Called on boot by `DiscordBotService.start()` so a restart (a Render
 * redeploy, a crash restart, a scale-to-zero wake) never drops a slip the user
 * saved: each slip's legs, its ACTIVE_TRACKING flag and every settled leg come
 * back exactly as written, and the live worker resumes settling them on its
 * next tick.
 *
 * Intended to run once during boot. A later call replaces the in-memory store
 * with the file's contents, so anything held only in memory is discarded.
 */
export function purgeBlockedSavedParlays(blockedChannelIds = BLOCKED_CHANNEL_IDS) {
    const set = blockedChannelIds instanceof Set ? blockedChannelIds : new Set(blockedChannelIds);
    let removed = 0;
    for (const [id, parlay] of savedParlays.entries()) {
        if (set.has(parlay.channelId)) {
            savedParlays.delete(id);
            removed++;
        }
    }
    if (removed > 0) {
        persist();
        console.log(`[SavedParlays] Purged ${removed} parlay(s) for blocked channels.`);
    }
    return removed;
}
export function deactivateSavedParlaysForUserChannel(userId, channelId) {
    let count = 0;
    for (const p of savedParlays.values()) {
        if (p.userId === userId && p.channelId === channelId && p.activeTracking) {
            p.activeTracking = false;
            count++;
        }
    }
    if (count > 0)
        persist();
    return count;
}
export function initSavedParlays() {
    savedParlays.clear();
    load();
    purgeBlockedSavedParlays();
    const slips = [...savedParlays.values()];
    const active = slips.filter((p) => p.activeTracking).length;
    if (slips.length) {
        console.log(`[SavedParlays] Restored ${slips.length} saved slip(s) from disk (${active} actively tracking).`);
    }
    return { total: slips.length, active };
}
/** Stable identity for a leg, used to remember what has already settled. */
export function legKey(leg) {
    return `${leg.fixtureId}:${leg.market}:${leg.selection}`;
}
function toSavedLeg(leg) {
    const prob = typeof leg?.probability === 'number' && Number.isFinite(leg.probability)
        ? leg.probability
        : typeof leg?.estimatedProbability === 'number' && Number.isFinite(leg.estimatedProbability)
            ? leg.estimatedProbability
            : 0.5;
    return {
        fixtureId: leg?.fixtureId || 'unknown',
        description: leg?.description || leg?.fixtureDescription || 'Match',
        league: leg?.league || 'ALL',
        market: leg?.market || 'HOME_WIN',
        selection: leg?.selection || 'Selection',
        probability: prob,
        marketOdds: typeof leg?.marketOdds === 'number' && Number.isFinite(leg.marketOdds) ? leg.marketOdds : null,
    };
}
/** Product of every leg's bookmaker price, or null when one is missing. */
function combinedMarketOdds(legs) {
    if (!legs || !legs.length)
        return null;
    let product = 1;
    let hasValidOdds = false;
    for (const l of legs) {
        const o = l?.marketOdds;
        if (typeof o !== 'number' || !Number.isFinite(o) || o <= 1)
            return null;
        product *= o;
        hasValidOdds = true;
    }
    return hasValidOdds ? Number(product.toFixed(3)) : null;
}
/**
 * Persist a built slip to `data/saved_parlays.json`, tied to the channel
 * and user it was saved from.
 */
export function saveParlayToDisk(parlay, meta) {
    if (isChannelBlocked(meta.channelId)) {
        console.warn(`[SavedParlays] Refusing to link saved parlay to blocked channel ${meta.channelId}`);
        meta.channelId = '';
    }
    const legs = (parlay?.legs || []).map(toSavedLeg);
    const combinedProbability = Number(legs.reduce((acc, l) => acc * Math.max(0.0001, l.probability || 0.5), 1).toFixed(6));
    // Retire any earlier slip for this user + channel so /track shows the slip
    // the user just saved rather than a stale one.
    for (const other of getSavedParlaysForUserChannel(meta.userId, meta.channelId)) {
        setSavedParlayActiveTracking(other.id, false);
    }
    const saved = {
        id: `sp-${Date.now()}-${++idCounter}`,
        userId: meta.userId,
        channelId: meta.channelId,
        guildId: meta.guildId ?? null,
        legs,
        stake: typeof parlay?.stake === 'number' && Number.isFinite(parlay.stake) ? parlay.stake : 10,
        combinedOdds: combinedMarketOdds(legs),
        combinedProbability: Number.isFinite(combinedProbability) ? combinedProbability : 0.05,
        savedAt: Date.now(),
        activeTracking: true,
        settled: {},
    };
    savedParlays.set(saved.id, saved);
    persist();
    return saved;
}
export function getSavedParlay(id) {
    return savedParlays.get(id);
}
export function getSavedParlays() {
    return [...savedParlays.values()];
}
export function getSavedParlaysByChannel(channelId) {
    return [...savedParlays.values()].filter((p) => p.channelId === channelId);
}
export function getSavedParlaysByUser(userId) {
    return [...savedParlays.values()].filter((p) => p.userId === userId);
}
/** Every saved slip that has at least one leg on this fixture. */
export function getSavedParlaysForFixture(fixtureId) {
    return [...savedParlays.values()].filter((p) => p.legs.some((l) => l.fixtureId === fixtureId));
}
/** Test/cleanup helper — wipes the in-memory store and the backing file. */
export function clearSavedParlays() {
    savedParlays.clear();
    persist();
}
export function isSavedLegSettled(savedId, leg) {
    return Boolean(savedParlays.get(savedId)?.settled[legKey(leg)]);
}
export function markSavedLegSettled(savedId, leg, status) {
    const saved = savedParlays.get(savedId);
    if (!saved)
        return;
    saved.settled[legKey(leg)] = status;
    persist();
}
export function countSettledLegs(saved) {
    return Object.keys(saved.settled).length;
}
/* ------------------------------------------------------------------ *
 * /track lookup — a saved slip is owned by a (userId, channelId) pair
 * ------------------------------------------------------------------ */
/** Saved slips belonging to a user in a specific channel. */
export function getSavedParlaysForUserChannel(userId, channelId) {
    return [...savedParlays.values()].filter((p) => p.userId === userId && p.channelId === channelId);
}
/** Saved slips still listed by `/track`, newest first. */
export function getActiveSavedParlaysForUserChannel(userId, channelId) {
    return getSavedParlaysForUserChannel(userId, channelId)
        .filter((p) => p.activeTracking)
        .sort((a, b) => b.savedAt - a.savedAt);
}
/** Flip the ACTIVE_TRACKING flag on a saved slip. */
export function setSavedParlayActiveTracking(savedId, active) {
    const saved = savedParlays.get(savedId);
    if (!saved || saved.activeTracking === active)
        return;
    saved.activeTracking = active;
    persist();
}
/** PENDING / HIT / MISS for one leg, from the live worker's settlement map. */
export function savedLegStatus(saved, leg) {
    return saved.settled[legKey(leg)] ?? 'PENDING';
}
const LEG_STATUS_ICON = {
    HIT: '🟢 HIT',
    MISS: '🔴 MISSED',
    PENDING: '⏳ PENDING',
};
/**
 * The `/track` card for a saved slip: every leg with its settlement status so
 * the user can see at a glance what has landed and what is still open.
 */
export function buildSavedSlipTrackerEmbed(saved) {
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
    embed.setDescription((lines.join('\n') || 'No legs on this slip.').slice(0, 4096));
    embed.addFields({
        name: 'Tracking',
        value: `${saved.activeTracking ? '**ACTIVE_TRACKING**' : 'Closed'} • ${settledCount}/${saved.legs.length} legs settled`,
        inline: true,
    }, {
        name: 'Status',
        value: `🟢 ${hits} Hit • 🔴 ${misses} Missed • ⏳ ${pending} Pending`,
        inline: true,
    }, {
        name: 'Slip',
        value: `Stake $${safeToFixed(saved.stake, 2, '0.00')}${saved.combinedOdds ? ` • combined ${safeToFixed(saved.combinedOdds, 2, 'n/a')}x` : ''}`,
        inline: true,
    });
    embed.setFooter({ text: `${BRAND.footer} • Leg status from live match data` });
    return embed;
}
function numOrNull(value) {
    if (value === null || value === undefined || value === '')
        return null;
    const num = Number(value);
    return Number.isFinite(num) ? num : null;
}
function normalizeMinute(minute) {
    if (!minute)
        return null;
    const stripped = String(minute).replace(/'/g, '').trim();
    return stripped ? `${stripped}'` : null;
}
function totalFrom(stats, key) {
    if (!stats)
        return null;
    if (key === 'corners') {
        const h = numOrNull(stats.cornersHome);
        const a = numOrNull(stats.cornersAway);
        return h !== null && a !== null ? h + a : null;
    }
    const yh = numOrNull(stats.yellowCardsHome);
    const ya = numOrNull(stats.yellowCardsAway);
    if (yh === null || ya === null)
        return null;
    return yh + ya + (numOrNull(stats.redCardsHome) ?? 0) + (numOrNull(stats.redCardsAway) ?? 0);
}
/**
 * Evaluate one saved leg against live match data.
 *
 * Accumulating markets (Over goals / corners / cards, BTTS) can settle
 * mid-match the moment the threshold is reached. Every other market only
 * settles at full time, so we never announce an early win we cannot know.
 */
export function evaluateSavedLeg(leg, ctx, latestGoal) {
    const h = ctx.homeScore;
    const a = ctx.awayScore;
    if (h === null || a === null)
        return { status: 'PENDING', note: 'Scoreline not published yet' };
    const total = h + a;
    const corners = totalFrom(ctx.statistics, 'corners');
    const cards = totalFrom(ctx.statistics, 'cards');
    const goalNote = () => {
        if (latestGoal) {
            const minute = normalizeMinute(latestGoal.minute);
            if (minute)
                return `${latestGoal.team ?? 'A team'} scored at ${minute}`;
            if (latestGoal.player)
                return `${latestGoal.player} scored`;
            if (latestGoal.team)
                return `${latestGoal.team} scored`;
        }
        return `${total} goal${total === 1 ? '' : 's'} scored`;
    };
    // --- Mid-match early settlement for accumulating markets ---
    let earlyHit = null;
    switch (leg.market) {
        case 'OVER_0_5':
            if (total >= 1)
                earlyHit = { note: goalNote() };
            break;
        case 'OVER_1_5':
            if (total >= 2)
                earlyHit = { note: goalNote() };
            break;
        case 'OVER_2_5':
            if (total >= 3)
                earlyHit = { note: goalNote() };
            break;
        case 'HOME_OVER_0_5':
            if (h >= 1)
                earlyHit = { note: `${ctx.homeTeam} scored` };
            break;
        case 'AWAY_OVER_0_5':
            if (a >= 1)
                earlyHit = { note: `${ctx.awayTeam} scored` };
            break;
        case 'BTTS_YES':
            if (h > 0 && a > 0)
                earlyHit = { note: 'both teams scored' };
            break;
        case 'OVER_5_5_CORNERS':
            if (corners !== null && corners >= 6)
                earlyHit = { note: `${corners} corners taken` };
            break;
        case 'OVER_7_5_CORNERS':
            if (corners !== null && corners >= 8)
                earlyHit = { note: `${corners} corners taken` };
            break;
        case 'OVER_8_5_CORNERS':
            if (corners !== null && corners >= 9)
                earlyHit = { note: `${corners} corners taken` };
            break;
        case 'OVER_9_5_CORNERS':
            if (corners !== null && corners >= 10)
                earlyHit = { note: `${corners} corners taken` };
            break;
        case 'OVER_2_5_CARDS':
            if (cards !== null && cards >= 3)
                earlyHit = { note: `${cards} cards shown` };
            break;
        case 'OVER_3_5_CARDS':
            if (cards !== null && cards >= 4)
                earlyHit = { note: `${cards} cards shown` };
            break;
        case 'OVER_4_5_CARDS':
            if (cards !== null && cards >= 5)
                earlyHit = { note: `${cards} cards shown` };
            break;
        default:
            break;
    }
    if (earlyHit)
        return { status: 'HIT', note: earlyHit.note };
    // --- Full-time settlement for everything else ---
    if (ctx.status === 'FINISHED') {
        const synthetic = {
            homeScore: h,
            awayScore: a,
            htHomeScore: null,
            htAwayScore: null,
            statistics: ctx.statistics ?? null,
        };
        const outcome = evaluateActualOutcome(leg.market, synthetic);
        const note = `full time ${h}-${a}`;
        if (outcome === 'HIT')
            return { status: 'HIT', note };
        if (outcome === 'MISS')
            return { status: 'MISS', note };
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
export function buildParlayUpdateEmbed(opts) {
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
    e.setDescription(`${emoji} **PARLAY UPDATE:** \`[${leg.description}]\` — **${verb}:** \`${leg.selection}\` ${mark} *(${progress.note})* [${settledCount}/${totalLegs} Legs Settled]`);
    e.addFields({ name: 'Match', value: leg.description, inline: true }, { name: 'Market', value: leg.selection, inline: true }, { name: 'Slip', value: `${settledCount}/${totalLegs} legs settled • stake $${safeToFixed(saved.stake, 2, '0.00')}`, inline: true });
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
    initSavedParlays,
    legKey,
    savedLegStatus,
    isSavedLegSettled,
    markSavedLegSettled,
    countSettledLegs,
    evaluateSavedLeg,
    buildParlayUpdateEmbed,
    buildSavedSlipTrackerEmbed,
};
