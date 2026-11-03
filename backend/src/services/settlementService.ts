/**
 * Automated Settlement, PnL & CLV Engine
 *
 * Sweeps saved parlays, detects fully-settled slips, records outcomes in a
 * persistent ledger, and exposes aggregate stats (hit-rate, ROI, CLV).
 */
import fs from 'node:fs';
import nodePath from 'node:path';
import { EmbedBuilder } from 'discord.js';
import { getSavedParlays, countSettledLegs, savedLegStatus, legKey } from '../discord/savedParlays.js';
import type { SavedParlay, SavedParlayLeg } from '../discord/savedParlays.js';
import { BRAND } from '../discord/brand.js';
import { safeToFixed } from '../utils/formatters.js';

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------
const DATA_DIR = nodePath.resolve(process.cwd(), 'data');
const LEDGER_FILE = nodePath.join(DATA_DIR, 'settlement_ledger.json');

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Outcome record for a single settled parlay slip. */
export interface SettledSlip {
  id: string;
  userId: string;
  legs: number;
  result: 'WON' | 'LOST' | 'VOID';
  /** 1-unit flat stake; net +odds-1 if WON, -1 if LOST, 0 if VOID */
  netUnits: number;
  /** Combined odds at slip creation (takenOdds). */
  takenOdds: number | null;
  /** Last pre-kickoff odds snapshot (closingOdds). */
  closingOdds: number | null;
  /** ((takenOdds / closingOdds) - 1) * 100 */
  clvPercent: number | null;
  settledAt: number;
  /** Per-leg outcomes */
  legOutcomes: Array<{
    key: string;
    fixtureId?: string;
    market?: string;
    league?: string;
    selection?: string;
    result: 'HIT' | 'MISS' | 'VOID' | string;
  }>;
}

/** Aggregated settlement ledger with all settled slips and stats. */
export interface SettlementLedger {
  totalSlips: number;
  wonSlips: number;
  lostSlips: number;
  voidSlips: number;
  hitRatePercent: number;
  netUnitsPnL: number;
  roiPercent: number;
  avgClvPercent: number;
  slips: SettledSlip[];
}

// ---------------------------------------------------------------------------
// In-memory cache
// ---------------------------------------------------------------------------
let ledgerCache: SettlementLedger | null = null;
let lastSweepTime = 0;

// ---------------------------------------------------------------------------
// Persistence helpers
// ---------------------------------------------------------------------------

/** Ensure `data/` exists and return a fresh empty ledger. */
export function emptyLedger(): SettlementLedger {
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
export function loadLedger(): SettlementLedger {
  if (ledgerCache) return ledgerCache;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (fs.existsSync(LEDGER_FILE)) {
    try {
      const raw = fs.readFileSync(LEDGER_FILE, 'utf-8');
      ledgerCache = JSON.parse(raw);
      return ledgerCache!;
    } catch {
      ledgerCache = emptyLedger();
      return ledgerCache;
    }
  }
  ledgerCache = emptyLedger();
  return ledgerCache;
}

/** Persist the current ledger cache to disk. */
export function saveLedger(): void {
  if (!ledgerCache) return;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(LEDGER_FILE, JSON.stringify(ledgerCache, null, 2), 'utf-8');
}

/** Record a settled slip into the persistent ledger. */
export function recordSettledSlip(slip: SettledSlip): SettlementLedger {
  const ledger = loadLedger();
  const existingIdx = ledger.slips.findIndex(s => s.id === slip.id);
  if (existingIdx >= 0) {
    ledger.slips[existingIdx] = slip;
  } else {
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
    ? Number((slipsWithClv.reduce((acc, s) => acc + s.clvPercent!, 0) / slipsWithClv.length).toFixed(2))
    : 0;

  saveLedger();
  return ledger;
}
