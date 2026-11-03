/**
 * quotaGovernorService.ts — Dynamic API Quota Budget Governor
 *
 * Manages TheOdds API quota consumption across three operating modes:
 *   OPTIMAL       (> 150 remaining)  — standard polling, no restrictions
 *   CONSERVATION  (50–150 remaining) — extended cache TTL, time-gated fetches
 *   PRESERVATION  (< 50 remaining)   — block all external calls, rely on cache
 *
 * Reads / writes the same `data/theodds_usage.json` file that TheOddsAdapter
 * uses, so both systems share a single source of truth for monthly usage.
 */

import fs from 'node:fs';
import nodePath from 'node:path';

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const DATA_DIR = nodePath.resolve(process.cwd(), 'data');
const USAGE_FILE = nodePath.join(DATA_DIR, 'theodds_usage.json');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Total monthly request budget for TheOdds API. */
const TOTAL_BUDGET = 500;

/** Cache TTLs per mode (milliseconds). */
const TTL_OPTIMAL = 1_800_000;       // 30 min
const TTL_CONSERVATION = 1_800_000;  // 30 min
const TTL_PRESERVATION = 3_600_000;  // 60 min

/** Remaining-quota thresholds that separate the three modes. */
const THRESHOLD_CONSERVATION = 150;
const THRESHOLD_PRESERVATION = 50;

/** Maximum lookahead (ms) for fixture kickoff in CONSERVATION mode. */
const CONSERVATION_WINDOW_MS = 3 * 60 * 60 * 1000; // 3 hours

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Governor operating mode. */
export type GovernorMode = 'OPTIMAL' | 'CONSERVATION' | 'PRESERVATION';

/** Full governor status snapshot. */
export interface GovernorStatus {
  mode: GovernorMode;
  remainingQuota: number;
  totalBudget: number;
  usedThisMonth: number;
  monthKey: string;
  cacheTtlMs: number;
  restrictions: string[];
}

/** Shape of the persisted usage file (shared with TheOddsAdapter). */
interface UsageRecord {
  month: string;
  used: number;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Return the current month key in `YYYY-MM` format.
 */
function currentMonthKey(): string {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  return `${yyyy}-${mm}`;
}

/**
 * Read the usage record from disk.
 * Returns a fresh zero-usage record when the file is missing, corrupt, or
 * belongs to a previous month.
 */
function readUsage(): UsageRecord {
  const month = currentMonthKey();
  try {
    if (!fs.existsSync(USAGE_FILE)) {
      return { month, used: 0 };
    }
    const raw = fs.readFileSync(USAGE_FILE, 'utf-8');
    const parsed: unknown = JSON.parse(raw);

    if (
      parsed !== null &&
      typeof parsed === 'object' &&
      'month' in parsed &&
      'used' in parsed &&
      typeof (parsed as UsageRecord).month === 'string' &&
      typeof (parsed as UsageRecord).used === 'number'
    ) {
      const record = parsed as UsageRecord;
      // Reset if the stored record belongs to a different month.
      if (record.month !== month) {
        return { month, used: 0 };
      }
      return record;
    }

    return { month, used: 0 };
  } catch {
    // File is missing, unreadable, or contains invalid JSON — start fresh.
    return { month, used: 0 };
  }
}

/**
 * Persist the usage record to disk (creating the data directory if needed).
 */
function writeUsage(record: UsageRecord): void {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(USAGE_FILE, JSON.stringify(record, null, 2), 'utf-8');
}

/**
 * Compute the remaining quota for the current month.
 */
function remaining(): number {
  const { used } = readUsage();
  return Math.max(0, TOTAL_BUDGET - used);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Determine the current governor operating mode based on remaining quota.
 *
 * | Mode          | Remaining          |
 * |---------------|--------------------|
 * | OPTIMAL       | > 150              |
 * | CONSERVATION  | 50 – 150           |
 * | PRESERVATION  | < 50 (or exhaused) |
 */
export function getMode(): GovernorMode {
  const rem = remaining();
  if (rem > THRESHOLD_CONSERVATION) return 'OPTIMAL';
  if (rem >= THRESHOLD_PRESERVATION) return 'CONSERVATION';
  return 'PRESERVATION';
}

/**
 * Return a full status snapshot describing the governor's current state.
 */
export function getStatus(): GovernorStatus {
  const usage = readUsage();
  const rem = Math.max(0, TOTAL_BUDGET - usage.used);
  const mode = getMode();

  const restrictions: string[] = [];
  if (mode === 'CONSERVATION') {
    restrictions.push('Live odds fetches restricted to fixtures within 3 hours of kickoff');
    restrictions.push('Extended odds cache TTL (30 min)');
  } else if (mode === 'PRESERVATION') {
    restrictions.push('All external quota-consuming calls blocked');
    restrictions.push('Routing to cached snapshots and Tier-2/Tier-3 fallbacks');
    restrictions.push('Maximum cache TTL (60 min)');
  }

  return {
    mode,
    remainingQuota: rem,
    totalBudget: TOTAL_BUDGET,
    usedThisMonth: usage.used,
    monthKey: usage.month,
    cacheTtlMs: getCacheTtlMs(),
    restrictions,
  };
}

/**
 * Check whether an external (quota-consuming) API call is currently allowed.
 *
 * @param fixtureKickoffIso  Optional ISO-8601 kickoff time of the fixture the
 *                           call relates to. In CONSERVATION mode the call is
 *                           only permitted when the fixture starts within
 *                           3 hours.
 * @returns `true` if the call may proceed.
 */
export function canMakeExternalCall(fixtureKickoffIso?: string): boolean {
  const mode = getMode();

  if (mode === 'OPTIMAL') return true;
  if (mode === 'PRESERVATION') return false;

  // CONSERVATION — allow if no kickoff supplied, or kickoff is within 3 hours.
  if (!fixtureKickoffIso) return true;

  try {
    const kickoff = new Date(fixtureKickoffIso).getTime();
    const now = Date.now();
    return kickoff - now <= CONSERVATION_WINDOW_MS && kickoff - now >= 0;
  } catch {
    // Unparseable date — err on the side of caution and allow the call so we
    // don't silently block legitimate requests.
    return true;
  }
}

/**
 * Return the recommended odds-cache TTL for the current governor mode.
 *
 * | Mode         | TTL        |
 * |--------------|------------|
 * | OPTIMAL      | 30 min     |
 * | CONSERVATION | 30 min     |
 * | PRESERVATION | 60 min     |
 */
export function getCacheTtlMs(): number {
  const mode = getMode();
  if (mode === 'PRESERVATION') return TTL_PRESERVATION;
  if (mode === 'CONSERVATION') return TTL_CONSERVATION;
  return TTL_OPTIMAL;
}

/**
 * Record that one or more external API requests were consumed.
 *
 * @param count  Number of requests to add (defaults to `1`).
 */
export function recordExternalUsage(count: number = 1): void {
  const usage = readUsage();
  usage.used += count;
  writeUsage(usage);
}

/**
 * Update the local usage record based on response headers from TheOdds API.
 *
 * If the `x-requests-remaining` header is present the stored usage is
 * recalculated as `totalBudget - remainingFromHeader`, keeping our local
 * counter in sync with the upstream API.
 *
 * @param headers  A plain object of HTTP response headers (keys lowercased).
 */
export function updateFromResponseHeaders(
  headers: Record<string, string>,
): void {
  const raw = headers['x-requests-remaining'];
  if (raw === undefined) return;

  const remainingFromHeader = parseInt(raw, 10);
  if (Number.isNaN(remainingFromHeader)) return;

  const usage = readUsage();
  usage.used = TOTAL_BUDGET - remainingFromHeader;
  writeUsage(usage);
}

// ---------------------------------------------------------------------------
// Default export
// ---------------------------------------------------------------------------

export default {
  getMode,
  getStatus,
  canMakeExternalCall,
  getCacheTtlMs,
  recordExternalUsage,
  updateFromResponseHeaders,
};
