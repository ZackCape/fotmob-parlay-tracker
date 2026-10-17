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
  { id: 'LALIGA', label: 'La Liga', description: 'Spanish top flight' },
  { id: 'SERIE_A', label: 'Serie A', description: 'Italian top flight' },
  { id: 'BUNDESLIGA', label: 'Bundesliga', description: 'German top flight' },
  { id: 'LIGUE1', label: 'Ligue 1', description: 'French top flight' },
  { id: 'CHAMPIONS_LEAGUE', label: 'Champions League', description: 'European club competition' },
  { id: 'CHAMPIONSHIP', label: 'Championship', description: 'English second tier' },
];

export function leagueLabel(id: string): string {
  return LEAGUE_OPTIONS.find((l) => l.id === id)?.label ?? id;
}

export function leaguesWithFixtures(): string[] {
  return LEAGUE_OPTIONS.map((l) => l.id);
}