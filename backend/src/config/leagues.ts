/**
 * Cape Predictor league catalogue — backend config.
 *
 * Single source of truth for all supported competitions across the backend.
 * Mirrors the frontend catalogue in src/utils/leagueFlags.ts.
 */

export interface LeagueConfig {
  id: string;
  name: string;
  country: string;
  flagCode: string | null;
  category: 'domestic' | 'continental' | 'womens' | 'international';
  priority: boolean;
  espn: string | null;
  apiFootball: number | null;
  oddsApi: string | null;
}

export const LEAGUES: LeagueConfig[] = [
  // === Men's Domestic ===
  { id: 'EPL', name: 'Premier League', country: 'England', flagCode: 'gb-eng', category: 'domestic', priority: true, espn: 'eng.1', apiFootball: 39, oddsApi: 'soccer_epl' },
  { id: 'CHAMPIONSHIP', name: 'EFL Championship', country: 'England', flagCode: 'gb-eng', category: 'domestic', priority: false, espn: 'eng.2', apiFootball: 40, oddsApi: 'soccer_efl_champ' },
  { id: 'EFL_1', name: 'EFL League One', country: 'England', flagCode: 'gb-eng', category: 'domestic', priority: false, espn: 'eng.3', apiFootball: 41, oddsApi: null },
  { id: 'EFL_2', name: 'EFL League Two', country: 'England', flagCode: 'gb-eng', category: 'domestic', priority: false, espn: 'eng.4', apiFootball: 42, oddsApi: null },
  { id: 'LALIGA', name: 'La Liga', country: 'Spain', flagCode: 'es', category: 'domestic', priority: false, espn: 'esp.1', apiFootball: 140, oddsApi: 'soccer_spain_la_liga' },
  { id: 'SERIE_A', name: 'Serie A', country: 'Italy', flagCode: 'it', category: 'domestic', priority: false, espn: 'ita.1', apiFootball: 135, oddsApi: 'soccer_italy_serie_a' },
  { id: 'BUNDESLIGA', name: 'Bundesliga', country: 'Germany', flagCode: 'de', category: 'domestic', priority: false, espn: 'ger.1', apiFootball: 78, oddsApi: 'soccer_germany_bundesliga' },
  { id: 'BUNDESLIGA2', name: 'Bundesliga 2', country: 'Germany', flagCode: 'de', category: 'domestic', priority: false, espn: 'ger.2', apiFootball: 79, oddsApi: null },
  { id: 'LIGUE1', name: 'Ligue 1', country: 'France', flagCode: 'fr', category: 'domestic', priority: false, espn: 'fra.1', apiFootball: 61, oddsApi: 'soccer_france_ligue_one' },
  { id: 'EREDIVISIE', name: 'Eredivisie', country: 'Netherlands', flagCode: 'nl', category: 'domestic', priority: false, espn: 'ned.1', apiFootball: 88, oddsApi: 'soccer_netherlands_eredivisie' },
  { id: 'PRIMEIRA_LIGA', name: 'Primeira Liga', country: 'Portugal', flagCode: 'pt', category: 'domestic', priority: false, espn: 'por.1', apiFootball: 94, oddsApi: 'soccer_portugal_primeira_liga' },
  { id: 'PRO_LEAGUE', name: 'Pro League', country: 'Belgium', flagCode: 'be', category: 'domestic', priority: false, espn: 'bel.1', apiFootball: 144, oddsApi: 'soccer_belgium_first_div' },
  { id: 'SCOTTISH_PREM', name: 'Scottish Premiership', country: 'Scotland', flagCode: 'gb-sct', category: 'domestic', priority: false, espn: 'sco.1', apiFootball: 179, oddsApi: 'soccer_scotland_premiership' },
  { id: 'SUPER_LIG', name: 'Süper Lig', country: 'Turkey', flagCode: 'tr', category: 'domestic', priority: false, espn: 'tur.1', apiFootball: 203, oddsApi: 'soccer_turkey_super_league' },
  { id: 'SWISS_SUPER', name: 'Swiss Super League', country: 'Switzerland', flagCode: 'ch', category: 'domestic', priority: false, espn: 'sui.1', apiFootball: 207, oddsApi: 'soccer_switzerland_superleague' },
  { id: 'AUSTRIAN_BUNDESLIGA', name: 'Austrian Bundesliga', country: 'Austria', flagCode: 'at', category: 'domestic', priority: false, espn: 'aut.1', apiFootball: 218, oddsApi: null },
  { id: 'DANISH_SUPERLIGA', name: 'Danish Superliga', country: 'Denmark', flagCode: 'dk', category: 'domestic', priority: false, espn: 'den.1', apiFootball: 119, oddsApi: null },
  { id: 'EKSTRAKLASA', name: 'Ekstraklasa', country: 'Poland', flagCode: 'pl', category: 'domestic', priority: false, espn: null, apiFootball: 106, oddsApi: null },

  // === Continental ===
  { id: 'CHAMPIONS_LEAGUE', name: 'UEFA Champions League', country: 'Europe', flagCode: 'eu', category: 'continental', priority: true, espn: 'uefa.champions', apiFootball: 2, oddsApi: 'soccer_uefa_champs_league' },
  { id: 'EUROPA_LEAGUE', name: 'UEFA Europa League', country: 'Europe', flagCode: 'eu', category: 'continental', priority: false, espn: 'uefa.europa', apiFootball: 3, oddsApi: 'soccer_uefa_europa_league' },
  { id: 'CONFERENCE_LEAGUE', name: 'UEFA Conference League', country: 'Europe', flagCode: 'eu', category: 'continental', priority: false, espn: 'uefa.europa.conf', apiFootball: 848, oddsApi: null },
  { id: 'ACL', name: 'AFC Champions League', country: 'Asia', flagCode: 'eu', category: 'continental', priority: false, espn: 'afc.champions', apiFootball: 17, oddsApi: null },

  // === Women's ===
  { id: 'WSL', name: "Women's Super League", country: 'England', flagCode: 'gb-eng', category: 'womens', priority: false, espn: 'eng.w.1', apiFootball: 1095, oddsApi: null },
  { id: 'NWSL', name: 'NWSL', country: 'USA', flagCode: 'us', category: 'womens', priority: false, espn: 'usa.nwsl', apiFootball: 254, oddsApi: null },
  { id: 'UWCL', name: "UEFA Women's Champions League", country: 'Europe', flagCode: 'eu', category: 'womens', priority: false, espn: 'uefa.w.champions', apiFootball: 2, oddsApi: null },
  { id: 'LIGA_F', name: 'Liga F (Women)', country: 'Spain', flagCode: 'es', category: 'womens', priority: false, espn: 'esp.w.1', apiFootball: 141, oddsApi: null },
  { id: 'FRAUEN_BL', name: "Frauen-Bundesliga", country: 'Germany', flagCode: 'de', category: 'womens', priority: false, espn: 'ger.w.1', apiFootball: 256, oddsApi: null },
  { id: 'PL_WOMEN', name: 'Premiere Ligue (Women)', country: 'France', flagCode: 'fr', category: 'womens', priority: false, espn: 'fra.w.1', apiFootball: 257, oddsApi: null },

  // === International (Men & Women) ===
  { id: 'UEFA_NATIONS_LEAGUE', name: 'UEFA Nations League', country: 'Europe', flagCode: 'eu', category: 'international', priority: false, espn: 'uefa.nations', apiFootball: 5, oddsApi: null },
  { id: 'FIFA_WC_QUAL', name: 'FIFA World Cup Qualifiers', country: 'International', flagCode: 'eu', category: 'international', priority: false, espn: 'fifa.worldq', apiFootball: 32, oddsApi: null },
  { id: 'FIFA_WC', name: 'FIFA World Cup', country: 'International', flagCode: 'eu', category: 'international', priority: false, espn: 'fifa.world', apiFootball: 1, oddsApi: null },
  { id: 'UEFA_EUROS', name: 'UEFA European Championship', country: 'Europe', flagCode: 'eu', category: 'international', priority: false, espn: 'uefa.euro', apiFootball: 4, oddsApi: null },
  { id: 'AFCON', name: 'Africa Cup of Nations', country: 'Africa', flagCode: 'eu', category: 'international', priority: false, espn: 'caf.nations', apiFootball: 6, oddsApi: null },
  { id: 'CONCACAF_GOLD_CUP', name: 'CONCACAF Gold Cup', country: 'North America', flagCode: 'eu', category: 'international', priority: false, espn: 'concacaf.gold', apiFootball: 22, oddsApi: null },
  { id: 'COPA_AMERICA', name: 'Copa América', country: 'South America', flagCode: 'eu', category: 'international', priority: false, espn: 'conmebol.america', apiFootball: 9, oddsApi: null },
  { id: 'INTL_FRIENDLIES', name: 'International Friendlies', country: 'International', flagCode: 'eu', category: 'international', priority: false, espn: 'fifa.friendly', apiFootball: 10, oddsApi: null },
];

export function getLeagueById(id: string): LeagueConfig | undefined {
  return LEAGUES.find((l) => l.id === id);
}

export function getLeaguesByCategory(category: string): LeagueConfig[] {
  return LEAGUES.filter((l) => l.category === category);
}

export function getPriorityLeagues(): LeagueConfig[] {
  return LEAGUES.filter((l) => l.priority);
}

export default { LEAGUES, getLeagueById, getLeaguesByCategory, getPriorityLeagues };
