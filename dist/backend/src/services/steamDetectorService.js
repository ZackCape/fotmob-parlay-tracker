/**
 * Steam Detector Service – Line Movement & Sharp Steam Detector
 *
 * Tracks odds snapshots over time for each fixture/market combination,
 * detects significant line movements ("steam moves") that indicate
 * sharp money, and deduplicates alerts via claimEventIds.
 */
import fs from 'node:fs';
import nodePath from 'node:path';
import { EmbedBuilder } from 'discord.js';
import { claimEventIds } from './instantStreamService.js';
import { BRAND } from '../discord/brand.js';
import { getFairModelBaselineOdds } from '../parlays/parlay-builder.js';
const DATA_DIR = nodePath.resolve(process.cwd(), 'data');
const SNAPSHOT_FILE = nodePath.join(DATA_DIR, 'odds_snapshots.json');
const PURGE_AGE_MS = 24 * 60 * 60 * 1000; // 24h
/** Lookback window for steam detection (120 minutes) */
const STEAM_WINDOW_MS = 120 * 60 * 1000;
/** Minimum decimal price drop percentage to flag a steam move */
const DECIMAL_DROP_THRESHOLD = 10; // %
/** Minimum implied-probability surge (percentage points) to flag a steam move */
const IMPLIED_PROB_SHIFT_THRESHOLD = 6.5;
/** Implied-probability shift threshold for high-conviction flag */
const HIGH_CONVICTION_THRESHOLD = 8; // percentage points
/** Playable odds range boundaries */
const MIN_PLAYABLE_ODDS = 1.15;
const MAX_PLAYABLE_ODDS = 2.50;
// ─── In-memory state ─────────────────────────────────────────────────
/** fixtureId → FixtureOddsSnapshot */
let snapshots = new Map();
// ─── Persistence helpers ─────────────────────────────────────────────
/**
 * Load snapshots from disk into memory. Safe to call multiple times;
 * silently initialises an empty map when the file is absent or corrupt.
 */
function loadFromDisk() {
    try {
        if (fs.existsSync(SNAPSHOT_FILE)) {
            const raw = fs.readFileSync(SNAPSHOT_FILE, 'utf-8');
            const parsed = JSON.parse(raw);
            snapshots = new Map(Object.entries(parsed));
        }
    }
    catch {
        // Corrupt file – start fresh
        snapshots = new Map();
    }
}
/**
 * Persist the current in-memory snapshot map to disk as JSON.
 */
function saveToDisk() {
    try {
        fs.mkdirSync(DATA_DIR, { recursive: true });
        const obj = Object.fromEntries(snapshots);
        fs.writeFileSync(SNAPSHOT_FILE, JSON.stringify(obj, null, 2), 'utf-8');
    }
    catch (err) {
        console.error('[SteamDetector] Failed to persist snapshots:', err);
    }
}
// ─── Initialise on module load ───────────────────────────────────────
fs.mkdirSync(DATA_DIR, { recursive: true });
loadFromDisk();
// ─── Public API ──────────────────────────────────────────────────────
/**
 * Record an odds data-point for a given fixture and market.
 *
 * Automatically purges stale snapshots (>24 h) before writing and
 * persists the updated state to disk.
 *
 * @param fixtureId  Unique fixture identifier
 * @param homeTeam   Home team name
 * @param awayTeam   Away team name
 * @param kickoffTime  ISO-8601 kickoff timestamp
 * @param market     Market key, e.g. "h2h_home", "h2h_draw", "h2h_away"
 * @param decimal    Decimal odds value (e.g. 1.85)
 */
export function recordOddsSnapshot(fixtureId, homeTeam, awayTeam, kickoffTime, market, decimal, timestamp = Date.now()) {
    // Purge stale entries first
    purgeOldSnapshots();
    const now = Date.now();
    const point = {
        decimal,
        impliedProb: 1 / decimal,
        timestamp,
    };
    let snapshot = snapshots.get(fixtureId);
    if (!snapshot) {
        snapshot = {
            fixtureId,
            homeTeam,
            awayTeam,
            kickoffTime,
            markets: {},
            createdAt: now,
        };
        snapshots.set(fixtureId, snapshot);
    }
    // Update team names / kickoff in case they changed
    snapshot.homeTeam = homeTeam;
    snapshot.awayTeam = awayTeam;
    snapshot.kickoffTime = kickoffTime;
    if (!snapshot.markets[market]) {
        snapshot.markets[market] = [];
    }
    snapshot.markets[market].push(point);
    saveToDisk();
}
/**
 * Scan all recorded odds histories and detect steam moves.
 *
 * A steam move is flagged when, within the last 120 minutes:
 *  - The market's current odds are in the playable range [1.15 – 2.50]
 *  - The decimal price has dropped by ≥ 10 % **OR** the implied probability
 *    has surged by ≥ 6.5 percentage points
 *
 * Uses `claimEventIds` for deduplication – only newly-claimed moves are
 * returned. Previously alerted moves are silently filtered out.
 *
 * @returns Array of newly-detected, deduplicated steam moves
 */
export function detectSteamMoves() {
    const now = Date.now();
    const windowStart = now - STEAM_WINDOW_MS;
    const allMoves = computeSteamMoves(windowStart, now);
    // Deduplicate via claimEventIds – only return newly claimed
    const newMoves = [];
    for (const move of allMoves) {
        const eventId = `STEAM_${move.fixtureId}_${move.market}_${move.direction}`;
        if (claimEventIds([eventId])) {
            newMoves.push(move);
        }
    }
    return newMoves;
}
/**
 * Return all currently active steam moves for display purposes.
 *
 * This is a **read-only** view – it does NOT call `claimEventIds` and
 * therefore does not consume any deduplication tokens. Suitable for
 * the `/steam` command or dashboard display.
 *
 * @returns Array of all currently active steam moves
 */
export function getActiveSteamMoves() {
    const now = Date.now();
    const windowStart = now - STEAM_WINDOW_MS;
    return computeSteamMoves(windowStart, now);
}
/**
 * Remove fixture snapshot entries whose `createdAt` is older than 24 hours.
 */
export function purgeOldSnapshots() {
    const cutoff = Date.now() - PURGE_AGE_MS;
    let changed = false;
    for (const [fixtureId, snapshot] of snapshots) {
        if (snapshot.createdAt < cutoff) {
            snapshots.delete(fixtureId);
            changed = true;
        }
    }
    if (changed) {
        saveToDisk();
    }
}
/**
 * Return the total number of fixture snapshots currently held in memory.
 *
 * @returns Count of tracked fixtures
 */
export function getSnapshotCount() {
    return snapshots.size;
}
// ─── Internal helpers ────────────────────────────────────────────────
/**
 * Core detection logic shared by `detectSteamMoves` and `getActiveSteamMoves`.
 *
 * Compares the earliest odds point within `[windowStart, now]` against
 * the latest point for each fixture / market combination.
 */
function computeSteamMoves(windowStart, now) {
    const moves = [];
    for (const snapshot of snapshots.values()) {
        for (const [market, points] of Object.entries(snapshot.markets)) {
            // Filter to points inside the lookback window
            const windowPoints = points.filter((p) => p.timestamp >= windowStart && p.timestamp <= now);
            if (windowPoints.length < 2) {
                continue;
            }
            // Sort ascending by timestamp
            windowPoints.sort((a, b) => a.timestamp - b.timestamp);
            const opening = windowPoints[0];
            const current = windowPoints[windowPoints.length - 1];
            // Check playable odds range on BOTH opening and current
            if (current.decimal < MIN_PLAYABLE_ODDS ||
                current.decimal > MAX_PLAYABLE_ODDS ||
                opening.decimal < MIN_PLAYABLE_ODDS ||
                opening.decimal > MAX_PLAYABLE_ODDS) {
                continue;
            }
            // Calculate movements
            const decimalDropPercent = ((opening.decimal - current.decimal) / opening.decimal) * 100;
            // Implied probability shift in percentage points (positive = surging)
            const impliedProbShift = (current.impliedProb - opening.impliedProb) * 100;
            // Check thresholds: decimal drop ≥ 10 % OR implied prob surge ≥ 6.5 pp
            const significantDrop = decimalDropPercent >= DECIMAL_DROP_THRESHOLD;
            const significantSurge = impliedProbShift >= IMPLIED_PROB_SHIFT_THRESHOLD;
            if (!significantDrop && !significantSurge) {
                continue;
            }
            const direction = current.decimal < opening.decimal ? 'SHORTENING' : 'DRIFTING';
            const highConviction = Math.abs(impliedProbShift) >= HIGH_CONVICTION_THRESHOLD;
            moves.push({
                fixtureId: snapshot.fixtureId,
                homeTeam: snapshot.homeTeam,
                awayTeam: snapshot.awayTeam,
                market,
                direction,
                openingOdds: opening.decimal,
                currentOdds: current.decimal,
                impliedProbShift: Math.round(impliedProbShift * 100) / 100,
                decimalDropPercent: Math.round(decimalDropPercent * 100) / 100,
                detectedAt: now,
                highConviction,
            });
        }
    }
    return moves;
}
/**
 * Builds the `/steam` command embed displaying active sharp money movements.
 * Strictly adheres to UI contract: 0x2563EB brand color, BRAND.footer, honest calculations.
 */
export function buildSteamEmbed() {
    const moves = getActiveSteamMoves();
    const embed = new EmbedBuilder()
        .setColor(BRAND.accent)
        .setAuthor({ name: BRAND.author })
        .setTitle('⚡ Sharp Steam & Line Movement Alerts')
        .setTimestamp(new Date());
    if (moves.length === 0) {
        embed.setDescription('No significant sharp line movements detected in the current window.');
    }
    else {
        const lines = moves.slice(0, 8).map((m) => {
            const dropStr = `${m.decimalDropPercent}% drop`;
            const probStr = `${m.impliedProbShift >= 0 ? '+' : ''}${m.impliedProbShift}% implied prob`;
            const conviction = m.highConviction ? ' 🔥 **[HIGH CONVICTION]**' : '';
            const fairBaseline = getFairModelBaselineOdds();
            return (`• **${m.homeTeam} vs ${m.awayTeam}** • \`${m.market}\`${conviction}\n` +
                `  Movement: \`${m.openingOdds.toFixed(2)}x\` ➔ \`**${m.currentOdds.toFixed(2)}x**\` (${dropStr}, ${probStr})\n` +
                `  Fair Model Baseline: \`${fairBaseline.home}x / ${fairBaseline.draw}x / ${fairBaseline.away}x\``);
        });
        embed.setDescription(`Detected **${moves.length}** sharp line movements in the last 120 minutes (threshold: ≥10% price drop or ≥6.5% prob shift):\n\n` +
            lines.join('\n\n'));
    }
    embed.setFooter({ text: BRAND.footer });
    return embed;
}
/** Testing helper to reset in-memory snapshots */
export function resetSnapshots() {
    snapshots.clear();
}
// ─── Default export ──────────────────────────────────────────────────
export default {
    recordOddsSnapshot,
    detectSteamMoves,
    getActiveSteamMoves,
    purgeOldSnapshots,
    getSnapshotCount,
    buildSteamEmbed,
    resetSnapshots,
};
