/**
 * Tier 1 of the hybrid odds engine — The Odds API.
 *
 * This is the primary, quota-metered bookmaker feed. It extends the existing
 * `TheOddsAdapter` (which already handles usage budgeting, 429 handling and
 * strict team/kickoff matching) with the multi-region and multi-market defaults
 * used by Cape Predictor.
 *
 * Base URL: https://api.the-odds-api.com/v4/sports/{sport_key}/odds/
 * Regions:  eu,uk,us  (Bet365, Unibet, DraftKings, Bovada, Pinnacle, ...)
 * Markets:  h2h (moneyline), totals, spreads
 *
 * When the key is absent, or the monthly budget is exhausted, or the API
 * returns HTTP 429, the adapter yields no data and the pipeline falls through
 * to Tier 2 (public cache) and Tier 3 (calibrated fair odds).
 */

import { TheOddsAdapter } from './theodds-adapter.js';

export const ODDS_API_BASE_URL = 'https://api.the-odds-api.com/v4';
export const DEFAULT_ODDS_REGIONS = 'eu,uk,us';
export const DEFAULT_ODDS_MARKETS = 'h2h,totals,spreads';

export class OddsApiAdapter extends TheOddsAdapter {
  constructor(
    apiKey: string,
    regions: string = DEFAULT_ODDS_REGIONS,
    monthlyLimit: number = 500,
    safetyReserve: number = 50,
  ) {
    super(apiKey, regions, monthlyLimit, safetyReserve);
  }

  /** Fetch every configured market for a sport key. */
  async fetchAllMarkets(sportKey: string) {
    return this.fetchOddsForSport(sportKey, DEFAULT_ODDS_MARKETS);
  }
}

export default OddsApiAdapter;
