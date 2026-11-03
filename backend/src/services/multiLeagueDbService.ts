/**
 * Cape Predictor — Multi-League Historical Database & Cross-Competition Linker
 *
 * Maintains a persistent, verified database of completed match results across
 * all supported domestic (EPL, Championship, La Liga, Serie A, Bundesliga,
 * Ligue 1, Eredivisie, Primeira Liga) and UEFA continental competitions (UCL,
 * UEL, UECL).
 *
 * Guarantees 100% data honesty: eliminates synthetic form strings and provides
 * verified cross-competition form timelines for all clubs.
 */

import fs from 'node:fs';
import path from 'node:path';
import axios from 'axios';
import { League } from '../types/football.js';

// ---------------------------------------------------------------------------
// Paths & Constants
// ---------------------------------------------------------------------------
const DATA_DIR = path.resolve(process.cwd(), 'data');
const DEFAULT_DB_FILE = path.join(DATA_DIR, 'multi_league_history.json');

/** Competitions tracked in the multi-league database */
export const TRACKED_COMPETITIONS: Record<string, { code: string; label: string; domestic: boolean }> = {
  // England
  'EPL': { code: 'eng.1', label: 'Premier League', domestic: true },
  'CHAMPIONSHIP': { code: 'eng.2', label: 'Championship', domestic: true },
  'FA_CUP': { code: 'eng.fa', label: 'FA Cup', domestic: true },
  'EFL_CUP': { code: 'eng.league_cup', label: 'EFL Cup', domestic: true },
  // Europe Domestic
  'LALIGA': { code: 'esp.1', label: 'La Liga', domestic: true },
  'SERIE_A': { code: 'ita.1', label: 'Serie A', domestic: true },
  'BUNDESLIGA': { code: 'ger.1', label: 'Bundesliga', domestic: true },
  'LIGUE1': { code: 'fra.1', label: 'Ligue 1', domestic: true },
  'EREDIVISIE': { code: 'ned.1', label: 'Eredivisie', domestic: true },
  'PRIMEIRA_LIGA': { code: 'por.1', label: 'Primeira Liga', domestic: true },
  // UEFA Continental
  'CHAMPIONS_LEAGUE': { code: 'uefa.champions', label: 'UEFA Champions League', domestic: false },
  'EUROPA_LEAGUE': { code: 'uefa.europa', label: 'UEFA Europa League', domestic: false },
  'CONFERENCE_LEAGUE': { code: 'uefa.europa.conf', label: 'UEFA Conference League', domestic: false },
};

// ---------------------------------------------------------------------------
// Types & Interfaces
// ---------------------------------------------------------------------------

export interface MultiLeagueMatch {
  id: string; // `${date}_${homeCanonical}_${awayCanonical}`
  date: string; // YYYY-MM-DD
  competition: string; // 'EPL', 'SERIE_A', 'CHAMPIONS_LEAGUE', etc.
  homeTeam: string;
  awayTeam: string;
  homeCanonical: string;
  awayCanonical: string;
  homeScore: number;
  awayScore: number;
  status: 'FT' | 'FINISHED';
  source: string;
  updatedAt: number;
}

export interface MultiLeagueDatabase {
  version: number;
  lastSync: number;
  totalMatches: number;
  matches: MultiLeagueMatch[];
}

export interface VerifiedMatchRecord {
  opponent: string;
  opponentCanonical: string;
  homeAway: 'H' | 'A';
  goalsFor: number;
  goalsAgainst: number;
  score: string;
  result: 'W' | 'D' | 'L';
  competition: string;
  date: string;
}

export interface TeamVerifiedForm {
  teamName: string;
  canonicalKey: string;
  hasData: boolean;
  totalMatches: number;
  results: Array<'W' | 'D' | 'L'>;
  recordSummary: string; // e.g. "3W 1D 1L"
  formGlyphs: string; // e.g. "🟢🟢🟡🟢🔴"
  formattedSummary: string; // e.g. "🟢🟢🟡🟢🔴  3W 1D 1L" or honest unavailable text
  recentMatches: VerifiedMatchRecord[];
  breakdownText: string;
}

// ---------------------------------------------------------------------------
// In-Memory State
// ---------------------------------------------------------------------------
let dbFilePath = DEFAULT_DB_FILE;
let databaseCache: MultiLeagueDatabase | null = null;
let syncTimer: any = null;

// ---------------------------------------------------------------------------
// Canonical Team Entity Linker
// ---------------------------------------------------------------------------

const CANONICAL_ALIASES: Record<string, string> = {
  // England
  'manchester united': 'manchester_united',
  'manchester united fc': 'manchester_united',
  'man united': 'manchester_united',
  'man utd': 'manchester_united',
  'manchester city': 'manchester_city',
  'manchester city fc': 'manchester_city',
  'man city': 'manchester_city',
  'arsenal': 'arsenal',
  'arsenal fc': 'arsenal',
  'chelsea': 'chelsea',
  'chelsea fc': 'chelsea',
  'liverpool': 'liverpool',
  'liverpool fc': 'liverpool',
  'tottenham hotspur': 'tottenham',
  'tottenham': 'tottenham',
  'spurs': 'tottenham',
  'aston villa': 'aston_villa',
  'newcastle united': 'newcastle',
  'newcastle': 'newcastle',
  'brighton & hove albion': 'brighton',
  'brighton': 'brighton',
  'west ham united': 'west_ham',
  'west ham': 'west_ham',

  // Italy
  'as roma': 'as_roma',
  'roma': 'as_roma',
  'a.s. roma': 'as_roma',
  'ss lazio': 'lazio',
  'lazio': 'lazio',
  'juventus': 'juventus',
  'juventus fc': 'juventus',
  'juve': 'juventus',
  'inter milan': 'inter_milan',
  'fc internazionale milano': 'inter_milan',
  'internazionale': 'inter_milan',
  'inter': 'inter_milan',
  'ac milan': 'ac_milan',
  'milan': 'ac_milan',
  'napoli': 'napoli',
  'ssc napoli': 'napoli',
  'atalanta': 'atalanta',
  'atalanta bc': 'atalanta',
  'fiorentina': 'fiorentina',
  'acf fiorentina': 'fiorentina',
  'bologna': 'bologna',
  'torino': 'torino',

  // Spain
  'real madrid': 'real_madrid',
  'real madrid cf': 'real_madrid',
  'fc barcelona': 'barcelona',
  'barcelona': 'barcelona',
  'barca': 'barcelona',
  'atletico madrid': 'atletico_madrid',
  'atlético madrid': 'atletico_madrid',
  'atletico': 'atletico_madrid',
  'athletic club': 'athletic_bilbao',
  'athletic bilbao': 'athletic_bilbao',
  'real sociedad': 'real_sociedad',
  'real betis': 'real_betis',
  'betis': 'real_betis',
  'villarreal': 'villarreal',
  'villarreal cf': 'villarreal',
  'sevilla': 'sevilla',
  'sevilla fc': 'sevilla',
  'girona': 'girona',
  'girona fc': 'girona',

  // Germany
  'bayern munich': 'bayern_munich',
  'fc bayern münchen': 'bayern_munich',
  'bayern münchen': 'bayern_munich',
  'bayern': 'bayern_munich',
  'borussia dortmund': 'borussia_dortmund',
  'dortmund': 'borussia_dortmund',
  'bvb': 'borussia_dortmund',
  'bayer 04 leverkusen': 'bayer_leverkusen',
  'bayer leverkusen': 'bayer_leverkusen',
  'leverkusen': 'bayer_leverkusen',
  'rb leipzig': 'rb_leipzig',
  'leipzig': 'rb_leipzig',
  'eintracht frankfurt': 'eintracht_frankfurt',
  'vfb stuttgart': 'vfb_stuttgart',

  // France
  'paris saint-germain': 'paris_saint_germain',
  'paris saint germain': 'paris_saint_germain',
  'paris sg': 'paris_saint_germain',
  'psg': 'paris_saint_germain',
  'as monaco': 'as_monaco',
  'monaco': 'as_monaco',
  'olympique de marseille': 'marseille',
  'marseille': 'marseille',
  'om': 'marseille',
  'olympique lyonnais': 'lyon',
  'lyon': 'lyon',
  'ol': 'lyon',
  'lille osc': 'lille',
  'lille': 'lille',
  'losc': 'lille',

  // Portugal & Netherlands & Others
  'sporting cp': 'sporting_cp',
  'sporting lisbon': 'sporting_cp',
  'sporting': 'sporting_cp',
  'sl benfica': 'benfica',
  'benfica': 'benfica',
  'fc porto': 'porto',
  'porto': 'porto',
  'afc ajax': 'ajax',
  'ajax': 'ajax',
  'psv eindhoven': 'psv',
  'psv': 'psv',
  'feyenoord': 'feyenoord',
  'celtic': 'celtic',
  'celtic fc': 'celtic',
  'rangers': 'rangers',
  'rangers fc': 'rangers',
};

/**
 * Normalizes raw team names and aliases from any provider into a stable
 * canonical team key.
 *
 * Example:
 * - "Manchester United FC" -> "manchester_united"
 * - "AS Roma" -> "as_roma"
 * - "FC Barcelona" -> "barcelona"
 */
export function resolveCanonicalTeamKey(rawName: string): string {
  if (!rawName) return 'unknown_team';

  // 1. Clean diacritics and trim
  const normalized = rawName
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();

  // 2. Check exact known alias
  if (CANONICAL_ALIASES[normalized]) {
    return CANONICAL_ALIASES[normalized];
  }

  // 3. Remove punctuation and common prefixes/suffixes
  const stripped = normalized
    .replace(/\b(fc|cf|afc|sc|as|bsc|acf|ssc|vfb|rb)\b/g, '')
    .replace(/[^a-z0-9\s]/g, '')
    .trim()
    .replace(/\s+/g, ' ');

  if (CANONICAL_ALIASES[stripped]) {
    return CANONICAL_ALIASES[stripped];
  }

  // 4. Default algorithmic slug
  return stripped.replace(/\s+/g, '_') || 'unknown_team';
}

// ---------------------------------------------------------------------------
// Database Persistence Helpers
// ---------------------------------------------------------------------------

function emptyDatabase(): MultiLeagueDatabase {
  return {
    version: 1,
    lastSync: 0,
    totalMatches: 0,
    matches: [],
  };
}

/** Load database from persistent disk storage */
export function loadDatabase(): MultiLeagueDatabase {
  if (databaseCache) return databaseCache;

  fs.mkdirSync(DATA_DIR, { recursive: true });

  if (fs.existsSync(dbFilePath)) {
    try {
      const raw = fs.readFileSync(dbFilePath, 'utf8');
      const parsed = JSON.parse(raw);
      if (parsed && Array.isArray(parsed.matches)) {
        databaseCache = parsed;
        return databaseCache!;
      }
    } catch {
      // file corrupted or unreadable, re-initialize
    }
  }

  // Strictly empty initialization: zero synthetic or test seed data
  const initial = emptyDatabase();
  databaseCache = initial;
  saveDatabase();
  return databaseCache;
}

/** Persist in-memory database to disk */
export function saveDatabase(): void {
  if (!databaseCache) return;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(dbFilePath, JSON.stringify(databaseCache, null, 2), 'utf8');
}

// ---------------------------------------------------------------------------
// Match Insertion & Deduplication
// ---------------------------------------------------------------------------

/**
 * Record a verified match result into the database.
 * Deduplicates by canonical match id.
 */
export function recordVerifiedMatch(match: Omit<MultiLeagueMatch, 'id' | 'homeCanonical' | 'awayCanonical' | 'updatedAt'>): MultiLeagueMatch {
  const db = loadDatabase();
  const homeCanonical = resolveCanonicalTeamKey(match.homeTeam);
  const awayCanonical = resolveCanonicalTeamKey(match.awayTeam);
  const id = `${match.date}_${homeCanonical}_${awayCanonical}`;
  const now = Date.now();

  const record: MultiLeagueMatch = {
    ...match,
    id,
    homeCanonical,
    awayCanonical,
    updatedAt: now,
  };

  const existingIdx = db.matches.findIndex((m) => m.id === id);
  if (existingIdx >= 0) {
    db.matches[existingIdx] = record;
  } else {
    db.matches.push(record);
  }

  db.totalMatches = db.matches.length;
  saveDatabase();
  return record;
}

// ---------------------------------------------------------------------------
// Automated Multi-League Ingestion
// ---------------------------------------------------------------------------

/**
 * Sync recent completed fixtures across all supported competitions via
 * ESPN public scoreboard endpoints (free, zero paid quota consumption).
 * Queries rolling 30-day date ranges for real completed matches only.
 */
export async function syncMultiLeagueHistory(): Promise<number> {
  const db = loadDatabase();
  let newMatchesCount = 0;
  const now = Date.now();

  const today = new Date();
  const past30 = new Date(today.getTime() - 30 * 86400000);
  const startYYYYMMDD = past30.toISOString().slice(0, 10).replace(/-/g, '');
  const endYYYYMMDD = today.toISOString().slice(0, 10).replace(/-/g, '');

  for (const [compName, compInfo] of Object.entries(TRACKED_COMPETITIONS)) {
    try {
      // 1. Attempt bulk date range query (?dates=${startYYYYMMDD}-${endYYYYMMDD}&limit=100)
      const rangeUrl = `https://site.api.espn.com/apis/site/v2/sports/soccer/${compInfo.code}/scoreboard?dates=${startYYYYMMDD}-${endYYYYMMDD}&limit=100`;
      let events: any[] = [];

      try {
        const res = await axios.get(rangeUrl, {
          timeout: 4000,
          headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
          validateStatus: (s) => s === 200,
        });
        if (Array.isArray(res.data?.events) && res.data.events.length > 0) {
          events = res.data.events;
        }
      } catch {
        events = [];
      }

      // 2. Fallback: If range query is unsupported by specific ESPN endpoint (e.g. 400),
      // sample recent dates individually
      if (events.length === 0) {
        const datesToCheck: string[] = [];
        for (let d = 0; d < 30; d += 2) {
          const day = new Date(today.getTime() - d * 86400000);
          datesToCheck.push(day.toISOString().slice(0, 10).replace(/-/g, ''));
        }
        for (const dStr of datesToCheck.slice(0, 6)) {
          try {
            const dayUrl = `https://site.api.espn.com/apis/site/v2/sports/soccer/${compInfo.code}/scoreboard?dates=${dStr}`;
            const dayRes = await axios.get(dayUrl, {
              timeout: 3500,
              headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
              validateStatus: (s) => s === 200,
            });
            if (Array.isArray(dayRes.data?.events)) {
              events.push(...dayRes.data.events);
            }
          } catch {}
        }
      }

      for (const ev of events) {
        const comp = ev.competitions?.[0];
        if (!comp) continue;

        // Only record genuinely completed matches
        const isCompleted = comp.status?.type?.completed === true || comp.status?.type?.state === 'post';
        if (!isCompleted) continue;

        const competitors = comp.competitors;
        if (!Array.isArray(competitors) || competitors.length < 2) continue;

        const homeComp = competitors.find((c: any) => c.homeAway === 'home');
        const awayComp = competitors.find((c: any) => c.homeAway === 'away');
        if (!homeComp || !awayComp) continue;

        const rawHomeScore = typeof homeComp.score === 'object' ? homeComp.score?.value ?? homeComp.score?.displayValue : homeComp.score;
        const rawAwayScore = typeof awayComp.score === 'object' ? awayComp.score?.value ?? awayComp.score?.displayValue : awayComp.score;
        const homeScore = parseInt(String(rawHomeScore), 10);
        const awayScore = parseInt(String(rawAwayScore), 10);

        if (Number.isNaN(homeScore) || Number.isNaN(awayScore)) continue;

        const date = ev.date ? ev.date.slice(0, 10) : new Date().toISOString().slice(0, 10);
        const homeTeam = homeComp.team?.displayName || homeComp.team?.name || 'Home';
        const awayTeam = awayComp.team?.displayName || awayComp.team?.name || 'Away';

        recordVerifiedMatch({
          date,
          competition: compName,
          homeTeam,
          awayTeam,
          homeScore,
          awayScore,
          status: 'FT',
          source: 'espn_public',
        });
        newMatchesCount++;
      }
    } catch {
      // Soft-fail individual endpoints to keep sync resilient
    }
  }

  db.lastSync = now;
  saveDatabase();
  return newMatchesCount;
}

/**
 * Initializes background sync scheduler (refreshes every 6 hours).
 */
export function initializeMultiLeagueSync(): void {
  // Initial background sync (non-blocking)
  setTimeout(() => {
    syncMultiLeagueHistory().catch(() => {});
  }, 2000);

  // Periodic 6-hour refresh
  syncTimer = setInterval(() => {
    syncMultiLeagueHistory().catch(() => {});
  }, 6 * 60 * 60 * 1000);

  syncTimer.unref?.();
}

// ---------------------------------------------------------------------------
// Verified Form Query Engine
// ---------------------------------------------------------------------------

/**
 * Queries the verified multi-league database for a team's last N completed
 * matches across all linked competitions (domestic + European).
 *
 * Guarantees zero synthetic form strings:
 * - If 0 matches exist -> returns hasData = false with honest unavailable notice.
 * - If 1-4 matches exist -> returns only verified matches. Never padded with fake data.
 */
export function getTeamVerifiedForm(teamName: string, limit = 5): TeamVerifiedForm {
  const db = loadDatabase();
  const canonical = resolveCanonicalTeamKey(teamName);

  if (!teamName || canonical === 'unknown_team') {
    return {
      teamName: teamName || 'Unknown',
      canonicalKey: canonical,
      hasData: false,
      totalMatches: 0,
      results: [],
      recordSummary: '',
      formGlyphs: '',
      formattedSummary: 'Form data unavailable (no recent verified matches in feed)',
      recentMatches: [],
      breakdownText: 'No verified recent matches found.',
    };
  }

  // Filter matches involving this team (either home or away)
  const teamMatches = db.matches.filter(
    (m) =>
      (m.homeCanonical === canonical || m.awayCanonical === canonical) &&
      (m.status === 'FT' || m.status === 'FINISHED') &&
      typeof m.homeScore === 'number' &&
      typeof m.awayScore === 'number'
  );

  if (teamMatches.length === 0) {
    return {
      teamName,
      canonicalKey: canonical,
      hasData: false,
      totalMatches: 0,
      results: [],
      recordSummary: '',
      formGlyphs: '',
      formattedSummary: 'Form data unavailable (no recent verified matches in feed)',
      recentMatches: [],
      breakdownText: 'No verified recent matches found.',
    };
  }

  // Sort descending by date (most recent first)
  teamMatches.sort((a, b) => (b.date > a.date ? 1 : b.date < a.date ? -1 : 0));

  const recent = teamMatches.slice(0, limit);
  const records: VerifiedMatchRecord[] = [];
  const results: Array<'W' | 'D' | 'L'> = [];

  for (const m of recent) {
    const isHome = m.homeCanonical === canonical;
    const gf = isHome ? m.homeScore : m.awayScore;
    const ga = isHome ? m.awayScore : m.homeScore;
    const opponent = isHome ? m.awayTeam : m.homeTeam;
    const opponentCanonical = isHome ? m.awayCanonical : m.homeCanonical;

    let res: 'W' | 'D' | 'L';
    if (gf > ga) res = 'W';
    else if (gf === ga) res = 'D';
    else res = 'L';

    results.push(res);
    records.push({
      opponent,
      opponentCanonical,
      homeAway: isHome ? 'H' : 'A',
      goalsFor: gf,
      goalsAgainst: ga,
      score: `${gf}-${ga}`,
      result: res,
      competition: m.competition,
      date: m.date,
    });
  }

  const wins = results.filter((r) => r === 'W').length;
  const draws = results.filter((r) => r === 'D').length;
  const losses = results.filter((r) => r === 'L').length;

  const glyphs = results.map((r) => (r === 'W' ? '🟢' : r === 'D' ? '🟡' : '🔴')).join('');
  const recordSummary = `${wins}W ${draws}D ${losses}L`;
  const formattedSummary = `${glyphs}  ${recordSummary} (Latest ➔ Oldest)`;

  // Match breakdown with badges, scores, opponent, competition and date
  // e.g. "🟢 W 2-0 vs Chelsea (EPL • Nov 7)"
  const breakdownLines = records.map((r) => {
    const badge = r.result === 'W' ? '🟢' : r.result === 'D' ? '🟡' : '🔴';
    const venue = r.homeAway === 'H' ? 'vs' : 'at';
    let dateLabel = r.date;
    try {
      const parsed = new Date(r.date.includes('T') ? r.date : `${r.date}T12:00:00Z`);
      if (!Number.isNaN(parsed.getTime())) {
        dateLabel = parsed.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
      }
    } catch {}
    return `${badge} ${r.result} ${r.goalsFor}-${r.goalsAgainst} ${venue} ${r.opponent} (${r.competition} • ${dateLabel})`;
  });

  return {
    teamName,
    canonicalKey: canonical,
    hasData: true,
    totalMatches: records.length,
    results,
    recordSummary,
    formGlyphs: glyphs,
    formattedSummary,
    recentMatches: records,
    breakdownText: breakdownLines.join('\n'),
  };
}

/**
 * Diagnostic & probability lookup: Computes real attacking & defensive form
 * metrics across all competitions for a team (useful for cross-league / UEFA fixtures).
 */
export function getTeamRecentStats(
  teamName: string,
  limit = 10
): {
  teamName: string;
  canonicalKey: string;
  matchesCount: number;
  goalsScored: number;
  goalsConceded: number;
  avgGoalsScored: number;
  avgGoalsConceded: number;
} | null {
  const form = getTeamVerifiedForm(teamName, limit);
  if (!form.hasData || form.recentMatches.length === 0) return null;

  const totalScored = form.recentMatches.reduce((acc, m) => acc + m.goalsFor, 0);
  const totalConceded = form.recentMatches.reduce((acc, m) => acc + m.goalsAgainst, 0);
  const count = form.recentMatches.length;

  return {
    teamName,
    canonicalKey: form.canonicalKey,
    matchesCount: count,
    goalsScored: totalScored,
    goalsConceded: totalConceded,
    avgGoalsScored: Number((totalScored / count).toFixed(2)),
    avgGoalsConceded: Number((totalConceded / count).toFixed(2)),
  };
}

// ---------------------------------------------------------------------------
// Testing & Maintenance Utilities
// ---------------------------------------------------------------------------

/** Clear in-memory database and cache */
export function clearDatabase(): void {
  databaseCache = emptyDatabase();
  saveDatabase();
}

/** Set custom file path (for unit test isolation) */
export function setStoragePath(customPath: string): void {
  dbFilePath = customPath;
  databaseCache = null;
}

/** Reset to default storage path */
export function resetStoragePath(): void {
  dbFilePath = DEFAULT_DB_FILE;
  databaseCache = null;
}
