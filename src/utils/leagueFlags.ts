/**
 * Cape Predictor — league → national flag mapping.
 *
 * The dashboard renders crisp raster flags from flagcdn.com rather than relying
 * on emoji. Emoji flags are drawn inconsistently across platforms (Windows in
 * particular renders the England subdivision flag as bare letters "GB ENG"),
 * which is exactly the raw-text label we want to avoid.
 *
 * `gb-eng` is flagcdn's England subdivision code; `eu` is the European Union
 * flag used for the continental competitions (Champions League, Europa League
 * and Conference League), which have no single host nation.
 */

const FLAG_CDN_BASE = 'https://flagcdn.com';

/** ISO 3166-1 / flagcdn country code per league id. */
export const LEAGUE_FLAG_CODES: Record<string, string> = {
  EPL: 'gb-eng',
  CHAMPIONSHIP: 'gb-eng',
  LALIGA: 'es',
  LIGUE1: 'fr',
  SERIE_A: 'it',
  BUNDESLIGA: 'de',
  BUNDESLIGA2: 'de',
  CHAMPIONS_LEAGUE: 'eu',
  EUROPA_LEAGUE: 'eu',
  CONFERENCE_LEAGUE: 'eu',
};

/** Readable country label per league id, mirroring the sidebar copy. */
export const LEAGUE_COUNTRY_LABELS: Record<string, string> = {
  ALL: 'Global',
  EPL: 'England',
  CHAMPIONSHIP: 'England',
  LALIGA: 'Spain',
  LIGUE1: 'France',
  SERIE_A: 'Italy',
  BUNDESLIGA: 'Germany',
  BUNDESLIGA2: 'Germany',
  CHAMPIONS_LEAGUE: 'Europe',
  EUROPA_LEAGUE: 'Europe',
  CONFERENCE_LEAGUE: 'Europe',
};

/**
 * Emoji fallback shown behind the flag image. If flagcdn is unreachable the
 * component hides the broken image and this glyph remains visible.
 */
export const LEAGUE_FLAG_EMOJI: Record<string, string> = {
  ALL: '🌍',
  EPL: '🏴󠁧󠁢󠁥󠁮󠁧󠁿',
  CHAMPIONSHIP: '🏴󠁧󠁢󠁥󠁮󠁧󠁿',
  LALIGA: '🇪🇸',
  LIGUE1: '🇫🇷',
  SERIE_A: '🇮🇹',
  BUNDESLIGA: '🇩🇪',
  BUNDESLIGA2: '🇩🇪',
  CHAMPIONS_LEAGUE: '⭐️',
  EUROPA_LEAGUE: '🏆',
  CONFERENCE_LEAGUE: '🛡️',
};

function normalize(league?: string | null): string {
  return league ? String(league).trim().toUpperCase() : '';
}

/** Resolve the flagcdn country code for a league, or null when it has none. */
export function leagueFlagCode(league?: string | null): string | null {
  const id = normalize(league);
  if (!id) return null;
  return LEAGUE_FLAG_CODES[id] ?? null;
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
  const id = normalize(league);
  return LEAGUE_FLAG_EMOJI[id] ?? '⚽';
}

/** Readable country/region label for a league. */
export function leagueCountryLabel(league?: string | null): string {
  const id = normalize(league);
  return LEAGUE_COUNTRY_LABELS[id] ?? 'Europe';
}
