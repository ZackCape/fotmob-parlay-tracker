export interface OddsOutcome {
  name: string;
  price: number; // decimal odds
}

export interface OddsMarket {
  key: string; // h2h, totals, ...
  lastUpdate: string;
  outcomes: OddsOutcome[];
}

export interface BookmakerOdds {
  key: string;
  title: string;
  lastUpdate: string;
  markets: OddsMarket[];
}

export interface OddsSnapshot {
  id: string;
  sportKey: string;
  homeTeam: string;
  awayTeam: string;
  commenceTime: string;
  bookmakers: BookmakerOdds[];
  retrievedAt: string;
  preMatch: boolean;
  provider: string;
}

export interface NormalizedMarketProbabilities {
  home: number | null;
  draw: number | null;
  away: number | null;
  overround: number | null;
  normalizedHome: number | null;
  normalizedDraw: number | null;
  normalizedAway: number | null;
}

export interface ModelMarketComparison {
  modelHome: number | null;
  modelDraw: number | null;
  modelAway: number | null;
  marketHome: number | null;
  marketDraw: number | null;
  marketAway: number | null;
  differenceHome: number | null; // percentage points
  differenceDraw: number | null;
  differenceAway: number | null;
  fairOddsHome: number | null;
  fairOddsDraw: number | null;
  fairOddsAway: number | null;
}