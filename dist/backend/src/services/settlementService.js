/**
 * Automated Settlement, PnL & CLV Engine
 *
 * Sweeps saved parlays, detects fully-settled slips, records outcomes in a
 * persistent ledger, and exposes aggregate stats (hit-rate, ROI, CLV).
 */
import fs from 'node:fs';
import nodePath from 'node:path';
import { EmbedBuilder } from 'discord.js';
import { getSavedParlays, savedLegStatus, legKey } from '../discord/savedParlays.js';
import { BRAND } from '../discord/brand.js';
// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------
const DATA_DIR = nodePath.resolve(process.cwd(), 'data');
const LEDGER_FILE = nodePath.join(DATA_DIR, 'settlement_ledger.json');
// ---------------------------------------------------------------------------
// In-memory cache
// ---------------------------------------------------------------------------
let ledgerCache = null;
let lastSweepTime = 0;
// ---------------------------------------------------------------------------
// Persistence helpers
// ---------------------------------------------------------------------------
/** Ensure `data/` exists and return a fresh empty ledger. */
export function emptyLedger() {
    return {
        totalSlips: 0,
        wonSlips: 0,
        lostSlips: 0,
        voidSlips: 0,
        hitRatePercent: 0,
        netUnitsPnL: 0,
        roiPercent: 0,
        avgClvPercent: 0,
        slips: [],
    };
}
/** Load the ledger from disk (or initialise a blank one). */
export function loadLedger() {
    if (ledgerCache)
        return ledgerCache;
    fs.mkdirSync(DATA_DIR, { recursive: true });
    if (fs.existsSync(LEDGER_FILE)) {
        try {
            const raw = fs.readFileSync(LEDGER_FILE, 'utf-8');
            ledgerCache = JSON.parse(raw);
            return ledgerCache;
        }
        catch {
            ledgerCache = emptyLedger();
            return ledgerCache;
        }
    }
    ledgerCache = emptyLedger();
    return ledgerCache;
}
/** Persist the current ledger cache to disk. */
export function saveLedger() {
    if (!ledgerCache)
        return;
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(LEDGER_FILE, JSON.stringify(ledgerCache, null, 2), 'utf-8');
}
/** Record a settled slip into the persistent ledger. */
export function recordSettledSlip(slip) {
    const ledger = loadLedger();
    const existingIdx = ledger.slips.findIndex(s => s.id === slip.id);
    if (existingIdx >= 0) {
        ledger.slips[existingIdx] = slip;
    }
    else {
        ledger.slips.push(slip);
    }
    // Recalculate metrics
    ledger.totalSlips = ledger.slips.length;
    ledger.wonSlips = ledger.slips.filter(s => s.result === 'WON').length;
    ledger.lostSlips = ledger.slips.filter(s => s.result === 'LOST').length;
    ledger.voidSlips = ledger.slips.filter(s => s.result === 'VOID').length;
    const graded = ledger.wonSlips + ledger.lostSlips;
    ledger.hitRatePercent = graded > 0 ? Number(((ledger.wonSlips / graded) * 100).toFixed(2)) : 0;
    ledger.netUnitsPnL = Number(ledger.slips.reduce((acc, s) => acc + (s.netUnits || 0), 0).toFixed(2));
    ledger.roiPercent = ledger.totalSlips > 0 ? Number(((ledger.netUnitsPnL / ledger.totalSlips) * 100).toFixed(2)) : 0;
    const slipsWithClv = ledger.slips.filter(s => typeof s.clvPercent === 'number' && Number.isFinite(s.clvPercent));
    ledger.avgClvPercent = slipsWithClv.length > 0
        ? Number((slipsWithClv.reduce((acc, s) => acc + s.clvPercent, 0) / slipsWithClv.length).toFixed(2))
        : 0;
    saveLedger();
    return ledger;
}
/**
 * Builds the performance record embed for the `/record` slash command.
 * Strictly adheres to UI contract: 0x2563EB brand color, BRAND.footer, honest calculations.
 */
export function buildRecordEmbed(filter = 'all') {
    const ledger = loadLedger();
    const now = Date.now();
    let cutoff = 0;
    let filterLabel = 'All-Time';
    if (filter === '7d') {
        cutoff = now - 7 * 86_400_000;
        filterLabel = 'Last 7 Days';
    }
    else if (filter === '30d') {
        cutoff = now - 30 * 86_400_000;
        filterLabel = 'Last 30 Days';
    }
    const slips = cutoff > 0 ? ledger.slips.filter((s) => s.settledAt >= cutoff) : [...ledger.slips];
    const total = slips.length;
    const won = slips.filter((s) => s.result === 'WON').length;
    const lost = slips.filter((s) => s.result === 'LOST').length;
    const voidCount = slips.filter((s) => s.result === 'VOID').length;
    const graded = won + lost;
    const strikeRate = graded > 0 ? Number(((won / graded) * 100).toFixed(1)) : 0;
    const netUnits = Number(slips.reduce((acc, s) => acc + (s.netUnits || 0), 0).toFixed(2));
    const roi = total > 0 ? Number(((netUnits / total) * 100).toFixed(1)) : 0;
    const slipsWithClv = slips.filter((s) => typeof s.clvPercent === 'number' && Number.isFinite(s.clvPercent));
    const avgClv = slipsWithClv.length > 0
        ? Number((slipsWithClv.reduce((acc, s) => acc + s.clvPercent, 0) / slipsWithClv.length).toFixed(1))
        : 0;
    const embed = new EmbedBuilder()
        .setColor(BRAND.accent)
        .setAuthor({ name: BRAND.author })
        .setTitle(`📈 Performance Record • ${filterLabel}`)
        .setTimestamp(new Date());
    if (total === 0) {
        embed.setDescription('No settled parlay slips found in this time window.');
    }
    else {
        const pnlSign = netUnits >= 0 ? '+' : '';
        const roiSign = roi >= 0 ? '+' : '';
        const clvSign = avgClv >= 0 ? '+' : '';
        embed.addFields({ name: 'Total Slips', value: `${total} (${won}W - ${lost}L${voidCount > 0 ? ` - ${voidCount}V` : ''})`, inline: true }, { name: 'Strike Rate', value: `${strikeRate}%`, inline: true }, { name: 'Net Units (1u flat)', value: `**${pnlSign}${netUnits}u**`, inline: true }, { name: 'ROI', value: `${roiSign}${roi}%`, inline: true }, { name: 'Avg Closing Edge (CLV)', value: `${clvSign}${avgClv}%`, inline: true }, { name: 'Sample Window', value: filterLabel, inline: true });
        // Last 5 slips breakdown
        const recentSlips = [...slips].sort((a, b) => b.settledAt - a.settledAt).slice(0, 5);
        const slipLines = recentSlips.map((s, idx) => {
            const outcomeGlyphs = (s.legOutcomes || []).map((l) => l.result === 'HIT' ? '✅' : l.result === 'MISS' ? '❌' : l.result === 'VOID' ? '➖' : '⏳').join('');
            const pnlStr = s.netUnits >= 0 ? `+${s.netUnits.toFixed(2)}u` : `${s.netUnits.toFixed(2)}u`;
            const dateStr = new Date(s.settledAt).toISOString().slice(5, 10);
            const resGlyph = s.result === 'WON' ? '🟢' : s.result === 'LOST' ? '🔴' : '⚪';
            return `\`#${idx + 1}\` ${resGlyph} **${s.result}** (${pnlStr}) [${outcomeGlyphs || '—'}] • ${dateStr}`;
        });
        embed.addFields({
            name: 'Recent Slips (Last 5)',
            value: slipLines.join('\n') || 'None recorded',
            inline: false,
        });
    }
    embed.setFooter({ text: BRAND.footer });
    return embed;
}
/**
 * Sweeps saved parlays and records completed slips without blocking the event loop.
 */
export async function runSettlementSweep(factory) {
    const now = Date.now();
    // Throttle sweeps to at most once every 5 seconds
    if (now - lastSweepTime < 5000)
        return 0;
    lastSweepTime = now;
    let settledCount = 0;
    try {
        const saved = getSavedParlays();
        if (!saved || !saved.length)
            return 0;
        for (const p of saved) {
            if (!p.legs || !p.legs.length)
                continue;
            let allSettled = true;
            let hasLoss = false;
            const legOutcomes = [];
            for (const leg of p.legs) {
                const status = savedLegStatus(p, leg);
                if (status === 'PENDING') {
                    allSettled = false;
                    break;
                }
                if (status === 'MISS')
                    hasLoss = true;
                legOutcomes.push({
                    key: legKey(leg),
                    result: status,
                });
            }
            if (allSettled && legOutcomes.length === p.legs.length) {
                const ledger = loadLedger();
                if (ledger.slips.some((s) => s.id === p.id))
                    continue;
                const result = hasLoss ? 'LOST' : 'WON';
                const takenOdds = p.combinedOdds || 2.0;
                const netUnits = result === 'WON' ? Number((takenOdds - 1).toFixed(2)) : -1.0;
                recordSettledSlip({
                    id: p.id,
                    userId: p.userId || 'system',
                    legs: p.legs.length,
                    result,
                    netUnits,
                    takenOdds,
                    closingOdds: takenOdds,
                    clvPercent: 0,
                    settledAt: Date.now(),
                    legOutcomes,
                });
                settledCount++;
            }
        }
    }
    catch (err) {
        console.warn('[SettlementService] Sweep non-fatal warning:', err.message);
    }
    return settledCount;
}
