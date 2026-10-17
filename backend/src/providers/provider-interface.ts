import { Fixture, League, MatchAnalysis } from '../types/football.js';

export interface ProviderHealth {
  providerName: string;
  isAvailable: boolean;
  rateLimitRemaining?: number;
  rateLimitReset?: string;
  lastSync?: string;
  details: string;
}

export interface IFootballDataProvider {
  readonly name: string;
  
  /**
   * Retrieves all available fixtures for a given calendar date in YYYY-MM-DD format.
   * Filterable by competition (ALL, EPL, CHAMPIONSHIP).
   */
  getFixturesByDate(date: string, league?: string): Promise<Fixture[]>;

  /**
   * Retrieves comprehensive match analysis bundle for a fixture:
   * Recent form, H2H, xG, shots, corners, disciplinary records, injuries and lineups.
   */
  getMatchDetails(fixtureId: string): Promise<MatchAnalysis | null>;

  /**
   * Health check and rate limit status
   */
  getHealth(): Promise<ProviderHealth>;

  /**
   * Whether the provider's daily quota is exhausted.
   */
  isQuotaExhausted?(): boolean;

  /**
   * Whether the provider is in a temporary cooldown (e.g. after HTTP 429).
   */
  isInCooldown?(): boolean;
}
