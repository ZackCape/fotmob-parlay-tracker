/**
 * League catalogue shared by the fixtures selector and the parlay builder.
 */
export interface LeagueOption {
  id: string;
  label: string;
  description: string;
}

export const LEAGUE_OPTIONS: LeagueOption[] = [
  { id: 'ALL', label: "All Today's Matches", description: 'Every verified match today' },
  { id: 'EPL', label: 'Premier League', description: 'English top flight' },
  { id: 'CHAMPIONSHIP', label: 'EFL Championship', description: 'English second tier' },
  { id: 'EFL_1', label: 'EFL League One', description: 'English third tier' },
  { id: 'EFL_2', label: 'EFL League Two', description: 'English fourth tier' },
  { id: 'LALIGA', label: 'La Liga', description: 'Spanish top flight' },
  { id: 'SERIE_A', label: 'Serie A', description: 'Italian top flight' },
  { id: 'BUNDESLIGA', label: 'Bundesliga', description: 'German top flight' },
  { id: 'LIGUE1', label: 'Ligue 1', description: 'French top flight' },
  { id: 'EREDIVISIE', label: 'Eredivisie', description: 'Dutch top flight' },
  { id: 'PRIMEIRA_LIGA', label: 'Primeira Liga', description: 'Portuguese top flight' },
  { id: 'PRO_LEAGUE', label: 'Pro League', description: 'Belgian top flight' },
  { id: 'SCOTTISH_PREM', label: 'Scottish Premiership', description: 'Scottish top flight' },
  { id: 'SUPER_LIG', label: 'Süper Lig', description: 'Turkish top flight' },
  { id: 'SWISS_SUPER', label: 'Swiss Super League', description: 'Swiss top flight' },
  { id: 'AUSTRIAN_BUNDESLIGA', label: 'Austrian Bundesliga', description: 'Austrian top flight' },
  { id: 'DANISH_SUPERLIGA', label: 'Danish Superliga', description: 'Danish top flight' },
  { id: 'EKSTRAKLASA', label: 'Ekstraklasa', description: 'Polish top flight' },
  { id: 'CHAMPIONS_LEAGUE', label: 'Champions League', description: 'European club competition' },
  { id: 'ACL', label: 'AFC Champions League', description: 'Asian club competition' },
  { id: 'WSL', label: "Women's Super League", description: 'English women top flight' },
  { id: 'NWSL', label: 'NWSL', description: 'US women top flight' },
  { id: 'UWCL', label: "Women's Champions League", description: 'European women club competition' },
  { id: 'UNL', label: 'UEFA Nations League', description: 'International competition' },
  { id: 'FRIENDLY', label: 'International Friendlies', description: 'International friendly matches' },
];

export function leagueLabel(id: string): string {
  return LEAGUE_OPTIONS.find((l) => l.id === id)?.label ?? id;
}

export function leaguesWithFixtures(): string[] {
  return LEAGUE_OPTIONS.map((l) => l.id);
}