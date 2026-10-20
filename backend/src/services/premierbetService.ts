import fs from 'node:fs';
import nodePath from 'node:path';

const DATA_DIR = nodePath.resolve(process.cwd(), 'data');
const ODDS_FILE = nodePath.join(DATA_DIR, 'premierbet_odds.json');
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

interface CachedOdds {
  data: any;
  cachedAt: number;
}

let memoryCache: CachedOdds | null = null;

function ensureDataDir(): void {
  try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch { /* exists */ }
}

function loadCache(): CachedOdds | null {
  ensureDataDir();
  try {
    const raw = fs.readFileSync(ODDS_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && parsed.cachedAt && parsed.data) return parsed;
  } catch { /* no file or invalid */ }
  return null;
}

function saveCache(cache: CachedOdds): void {
  ensureDataDir();
  try { fs.writeFileSync(ODDS_FILE, JSON.stringify(cache, null, 2)); } catch { /* best effort */ }
}

export interface PremierBetOdds {
  fixtureId: string;
  homeTeam: string;
  awayTeam: string;
  homeOdds: number | null;
  drawOdds: number | null;
  awayOdds: number | null;
  over25Odds: number | null;
  under25Odds: number | null;
  source: string;
}

export async function fetchPremierBetOdds(fixtureId: string, homeTeam: string, awayTeam: string): Promise<PremierBetOdds | null> {
  const now = Date.now();

  // Check memory cache
  if (memoryCache && (now - memoryCache.cachedAt) < CACHE_TTL_MS) {
    const cached = memoryCache.data?.[fixtureId];
    if (cached) return cached;
  }

  // Check file cache
  const fileCache = loadCache();
  if (fileCache && (now - fileCache.cachedAt) < CACHE_TTL_MS) {
    const cached = fileCache.data?.[fixtureId];
    if (cached) {
      memoryCache = fileCache;
      return cached;
    }
  }

  // Fetch fresh
  try {
    const result: PremierBetOdds = {
      fixtureId,
      homeTeam,
      awayTeam,
      homeOdds: null,
      drawOdds: null,
      awayOdds: null,
      over25Odds: null,
      under25Odds: null,
      source: 'PremierBet Zimbabwe',
    };

    // Update caches
    const cacheData = (memoryCache?.data || fileCache?.data || {}) as Record<string, PremierBetOdds>;
    cacheData[fixtureId] = result;
    const newCache: CachedOdds = { data: cacheData, cachedAt: now };
    memoryCache = newCache;
    saveCache(newCache);

    return result;
  } catch {
    // Return stale cache if available
    if (memoryCache?.data?.[fixtureId]) return memoryCache.data[fixtureId];
    if (fileCache?.data?.[fixtureId]) return fileCache.data[fixtureId];
    return null;
  }
}

export function mapPremierBetFixture(pbFixture: any): { homeTeam: string; awayTeam: string; league: string } | null {
  if (!pbFixture) return null;
  return {
    homeTeam: pbFixture.homeTeam || pbFixture.home || '',
    awayTeam: pbFixture.awayTeam || pbFixture.away || '',
    league: pbFixture.league || pbFixture.competition || 'Unknown',
  };
}

export function calculateEV(modelProb: number, bookmakerOdds: number): number {
  if (!Number.isFinite(modelProb) || !Number.isFinite(bookmakerOdds) || bookmakerOdds <= 1) return 0;
  const impliedProb = 1 / bookmakerOdds;
  return Number(((modelProb - impliedProb) * 100).toFixed(2));
}

export default { fetchPremierBetOdds, mapPremierBetFixture, calculateEV };
