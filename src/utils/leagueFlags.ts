import type { League } from '../types';

/**
 * Cape Predictor league catalogue — the single source of truth for the web UI.
 *
 * Two problems this module solves:
 *
 *  1. **Flags.** The dashboard renders crisp raster flags from flagcdn.com
 *     rather than emoji. Emoji flags are drawn inconsistently across platforms
 *     (Windows in particular renders the England subdivision flag as bare
 *     letters "GB ENG"), which is exactly the raw-text label we want to avoid.
 *  2. **Drift.** The sidebar, the league accordions and the match cards all
 *     need the same id → name/country/flag mapping. Keeping one table here
 *     stops the three of them disagreeing about which competitions exist.
 *
 * `gb-eng` / `gb-sct` are flagcdn's England and Scotland subdivision codes;
 * `eu` is the European Union flag used for the continental competitions
 * (Champions League, Europa League, Conference League), which have no single
 * host nation.
 *
 * Provider ids (`espn`, `apiFootball`, `oddsApi`) mirror the registries the
 * backend adapters fetch from, so a league added here can be traced to its
 * upstream feed. Competitions whose upstream id is not asserted by the task
 * brief or already present in the backend registry stay `null` rather than
 * being guessed.
 */

const FLAG_CDN_BASE = 'https://flagcdn.com';

/** Canonical league id, plus the pseudo-league `ALL` used by the selectors. */
export type LeagueId = League | 'ALL';

export interface LeagueMeta {
  /** Cape Predictor league id (UPPER_SNAKE, canonical across the pipeline). */
  id: LeagueId;
  /** Human display name. */
  name: string;
  /** Country or region label shown under the name. */
  country: string;
  /** flagcdn.com country code, or null when the competition has no country. */
  code: string | null;
  /** Emoji fallback shown if the flag image cannot be loaded. */
  emoji: string;
  /** ESPN public scoreboard slug (`.../soccer/{espn}/scoreboard`). */
  espn: string | null;
  /** API-Football (api-sports.io) league id. */
  apiFootball: number | null;
  /** The Odds API sport key (`/sports/{key}/odds`). */
  oddsApi: string | null;
}

/**
 * Every league the pipeline supports, in sidebar order (ALL first).
 *
 * `id` is typed as `LeagueId`, so adding a member to the `League` union without
 * adding it here is a compile error rather than a silently missing row.
 */
export const LEAGUE_META: LeagueMeta[] = [
  { id: 'ALL', name: 'All Matches', country: 'Global', code: null, emoji: '🌍', espn: null, apiFootball: null, oddsApi: null },

  // --- pre-existing coverage ---
  { id: 'EPL', name: 'Premier League', country: 'England', code: 'gb-eng', emoji: '🏴󠁧󠁢󠁥󠁮󠁧󠁿', espn: 'eng.1', apiFootball: 39, oddsApi: 'soccer_epl' },
  { id: 'CHAMPIONSHIP', name: 'EFL Championship', country: 'England', code: 'gb-eng', emoji: '🏴󠁧󠁢󠁥󠁮󠁧󠁿', espn: 'eng.2', apiFootball: 40, oddsApi: 'soccer_efl_champ' },
  { id: 'CHAMPIONS_LEAGUE', name: 'Champions League', country: 'Europe', code: 'eu', emoji: '⭐️', espn: 'uefa.champions', apiFootball: null, oddsApi: null },
  { id: 'LALIGA', name: 'LaLiga', country: 'Spain', code: 'es', emoji: '🇪🇸', espn: 'esp.1', apiFootball: null, oddsApi: null },
  { id: 'LIGUE1', name: 'Ligue 1', country: 'France', code: 'fr', emoji: '🇫🇷', espn: 'fra.1', apiFootball: null, oddsApi: null },
  { id: 'SERIE_A', name: 'Serie A', country: 'Italy', code: 'it', emoji: '🇮🇹', espn: 'ita.1', apiFootball: null, oddsApi: null },
  { id: 'BUNDESLIGA', name: 'Bundesliga', country: 'Germany', code: 'de', emoji: '🇩🇪', espn: 'ger.1', apiFootball: null, oddsApi: null },
  { id: 'BUNDESLIGA2', name: 'Bundesliga 2', country: 'Germany', code: 'de', emoji: '🇩🇪', espn: 'ger.2', apiFootball: null, oddsApi: null },
  { id: 'EUROPA_LEAGUE', name: 'Europa League', country: 'Europe', code: 'eu', emoji: '🏆', espn: 'uefa.europa', apiFootball: null, oddsApi: null },
  { id: 'CONFERENCE_LEAGUE', name: 'Conference League', country: 'Europe', code: 'eu', emoji: '🛡️', espn: 'uefa.europa.conf', apiFootball: null, oddsApi: null },

  // --- expanded coverage ---
  { id: 'EREDIVISIE', name: 'Eredivisie', country: 'Netherlands', code: 'nl', emoji: '🇳🇱', espn: 'ned.1', apiFootball: 88, oddsApi: 'soccer_netherlands_eredivisie' },
  // ESPN carries no Polish top flight (verified against its 220-league
  // directory; `pol.1` answers HTTP 400), so no ESPN code is claimed here.
  { id: 'EKSTRAKLASA', name: 'Ekstraklasa', country: 'Poland', code: 'pl', emoji: '🇵🇱', espn: null, apiFootball: 106, oddsApi: 'soccer_poland_ekstraklasa' },
  { id: 'PRIMEIRA_LIGA', name: 'Primeira Liga', country: 'Portugal', code: 'pt', emoji: '🇵🇹', espn: 'por.1', apiFootball: 94, oddsApi: 'soccer_portugal_primeira_liga' },
  { id: 'PRO_LEAGUE', name: 'Pro League', country: 'Belgium', code: 'be', emoji: '🇧🇪', espn: 'bel.1', apiFootball: 144, oddsApi: 'soccer_belgium_first_div' },
  { id: 'SCOTTISH_PREM', name: 'Scottish Premiership', country: 'Scotland', code: 'gb-sct', emoji: '🏴󠁧󠁢󠁳󠁣󠁴󠁿', espn: 'sco.1', apiFootball: 179, oddsApi: 'soccer_spl' },
  { id: 'SUPER_LIG', name: 'Süper Lig', country: 'Turkey', code: 'tr', emoji: '🇹🇷', espn: 'tur.1', apiFootball: 203, oddsApi: 'soccer_turkey_super_league' },
  // The Odds API spells this one without the `super`/`league` separator.
  { id: 'SWISS_SUPER', name: 'Swiss Super League', country: 'Switzerland', code: 'ch', emoji: '🇨🇭', espn: 'sui.1', apiFootball: 207, oddsApi: 'soccer_switzerland_superleague' },
  { id: 'AUSTRIAN_BUNDESLIGA', name: 'Austrian Bundesliga', country: 'Austria', code: 'at', emoji: '🇦🇹', espn: 'aut.1', apiFootball: 218, oddsApi: 'soccer_austria_bundesliga' },
  { id: 'DANISH_SUPERLIGA', name: 'Danish Superliga', country: 'Denmark', code: 'dk', emoji: '🇩🇰', espn: 'den.1', apiFootball: 119, oddsApi: 'soccer_denmark_superliga' },
];

/**
 * Alternate ids accepted from callers.
 *
 * The brief lists the English second tier as `efl_championship`, but the
 * pipeline already carries it as `CHAMPIONSHIP` (ESPN `eng.2`, API-Football 40,
 * The Odds API `soccer_efl_champ`). Aliasing keeps one id per competition so the
 * same fixture can never appear twice.
 */
export const LEAGUE_ALIASES: Record<string, string> = {
  EFL_CHAMPIONSHIP: 'CHAMPIONSHIP',
};

/** Real competitions only (excludes the `ALL` selector). */
export const SUPPORTED_LEAGUES: League[] = LEAGUE_META
  .filter((m) => m.id !== 'ALL')
  .map((m) => m.id as League);

/** Number of real competitions in the catalogue — used in UI copy. */
export const SUPPORTED_LEAGUE_COUNT = SUPPORTED_LEAGUES.length;

/** Display order for the grouped league accordions. */
export const LEAGUE_DISPLAY_ORDER: League[] = [
  'SERIE_A',
  'BUNDESLIGA',
  'BUNDESLIGA2',
  'EPL',
  'CHAMPIONS_LEAGUE',
  'LALIGA',
  'LIGUE1',
  'EUROPA_LEAGUE',
  'CONFERENCE_LEAGUE',
  'CHAMPIONSHIP',
  'EREDIVISIE',
  'EKSTRAKLASA',
  'PRIMEIRA_LIGA',
  'PRO_LEAGUE',
  'SCOTTISH_PREM',
  'SUPER_LIG',
  'SWISS_SUPER',
  'AUSTRIAN_BUNDESLIGA',
  'DANISH_SUPERLIGA',
];

function normalize(league?: string | null): string {
  return league ? String(league).trim().toUpperCase().replace(/[\s-]+/g, '_') : '';
}

/** Resolve aliases and casing to the canonical league id. */
export function canonicalLeagueId(league?: string | null): string {
  const id = normalize(league);
  return LEAGUE_ALIASES[id] ?? id;
}

/** Flag code per canonical league id (competitions without a country omitted). */
export const LEAGUE_FLAG_CODES: Record<string, string> = Object.fromEntries(
  LEAGUE_META.filter((m) => m.code).map((m) => [m.id, m.code as string]),
);

/** Emoji fallback per canonical league id. */
export const LEAGUE_FLAG_EMOJI: Record<string, string> = Object.fromEntries(
  LEAGUE_META.map((m) => [m.id, m.emoji]),
);

/** Country/region label per canonical league id. */
export const LEAGUE_COUNTRY_LABELS: Record<string, string> = Object.fromEntries(
  LEAGUE_META.map((m) => [m.id, m.country]),
);

/** Full metadata for a league, or null when it is unknown. */
export function leagueMeta(league?: string | null): LeagueMeta | null {
  const id = canonicalLeagueId(league);
  if (!id) return null;
  return LEAGUE_META.find((m) => m.id === id) ?? null;
}

/** Resolve the flagcdn country code for a league, or null when it has none. */
export function leagueFlagCode(league?: string | null): string | null {
  return LEAGUE_FLAG_CODES[canonicalLeagueId(league)] ?? null;
}

/**
 * Crisp flag URL, e.g. `https://flagcdn.com/w40/es.png`.
 * Returns null for competitions without a country (e.g. `ALL`).
 */
export function leagueFlagUrl(league?: string | null, width: 20 | 24 | 40 | 80 = 40): string | null {
  const code = leagueFlagCode(league);
  return code ? `${FLAG_CDN_BASE}/w${width}/${code}.png` : null;
}

/** Emoji fallback for a league, used when the flag image cannot be rendered. */
export function leagueFlagEmoji(league?: string | null): string {
  return LEAGUE_FLAG_EMOJI[canonicalLeagueId(league)] ?? '⚽';
}

/** Readable country/region label for a league. */
export function leagueCountryLabel(league?: string | null): string {
  return LEAGUE_COUNTRY_LABELS[canonicalLeagueId(league)] ?? 'Europe';
}

/** Display name for a league, falling back to the raw id when unknown. */
export function leagueDisplayName(league?: string | null): string {
  return leagueMeta(league)?.name ?? (league ? String(league) : 'Unknown');
}
