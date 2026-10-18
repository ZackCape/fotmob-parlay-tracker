export type League = 'EPL' | 'CHAMPIONSHIP' | 'LALIGA' | 'SERIE_A' | 'LIGUE1' | 'CHAMPIONS_LEAGUE' | 'EUROPA_LEAGUE' | 'CONFERENCE_LEAGUE' | 'BUNDESLIGA' | 'BUNDESLIGA2';

export interface Team {
  id: string;
  name: string;
  shortName: string;
  code: string;
  league: League;
  stadium: string;
  city: string;
  logo: string;
}

export type FixtureStatus = 'TIMED' | 'LIVE' | 'FINISHED' | 'POSTPONED';

export interface FixtureStatistics {
  // Stats are explicitly nullable to strictly distinguish unavailable data from zero values!
  shotsHome: number | null;
  shotsAway: number | null;
  shotsOnTargetHome: number | null;
  shotsOnTargetAway: number | null;
  xgHome: number | null;
  xgAway: number | null;
  cornersHome: number | null;
  cornersAway: number | null;
  foulsHome: number | null;
  foulsAway: number | null;
  yellowCardsHome: number | null;
  yellowCardsAway: number | null;
  redCardsHome: number | null;
  redCardsAway: number | null;
  possessionHome: number | null;
  possessionAway: number | null;
}

export interface Injury {
  player: string;
  teamId: string;
  teamName: string;
  status: 'OUT' | 'DOUBTFUL' | 'SUSPENDED';
  reason: string;
  reportedDate: string;
}

export interface LineupPlayer {
  id: string;
  name: string;
  number: number;
  position: 'G' | 'D' | 'M' | 'F';
}

export interface Lineup {
  teamId: string;
  formation: string | null;
  isConfirmed: boolean;
  startingXI: LineupPlayer[] | null;
  substitutes: LineupPlayer[] | null;
  coach: string | null;
}

export interface Fixture {
  id: string;
  externalId: string;
  league: League;
  season: string;
  round: string;
  date: string; // YYYY-MM-DD
  kickoffTime: string; // ISO 8601 or HH:MM
  status: FixtureStatus;
  homeTeam: Team;
  awayTeam: Team;
  homeScore: number | null;
  awayScore: number | null;
  htHomeScore: number | null;
  htAwayScore: number | null;
  venue: string;
  statistics?: FixtureStatistics | null;
  injuries?: Injury[] | null;
  homeLineup?: Lineup | null;
  awayLineup?: Lineup | null;
  dataSource: string; // e.g., 'API-Football (Live)', 'Football-Data.org', 'Verified Archive'
  retrievedAt?: string;
  fallbackReason?: string;
}

export type MarketType =
  | 'HOME_WIN'
  | 'DRAW'
  | 'AWAY_WIN'
  | 'OVER_0_5'
  | 'OVER_1_5'
  | 'OVER_2_5'
  | 'UNDER_2_5'
  | 'OVER_3_5'
  | 'UNDER_3_5'
  | 'BTTS_YES'
  | 'BTTS_NO'
  | 'DOUBLE_CHANCE_1X'
  | 'DOUBLE_CHANCE_X2'
  | 'DOUBLE_CHANCE_12'
  | 'HOME_OVER_0_5'
  | 'AWAY_OVER_0_5'
  | 'HT_OVER_0_5'
  | 'HT_DRAW'
  | 'OVER_5_5_CORNERS'
  | 'OVER_7_5_CORNERS'
  | 'OVER_8_5_CORNERS'
  | 'UNDER_8_5_CORNERS'
  | 'OVER_9_5_CORNERS'
  | 'UNDER_11_5_CORNERS'
  | 'OVER_2_5_CARDS'
  | 'OVER_3_5_CARDS'
  | 'OVER_4_5_CARDS'
  | 'UNDER_4_5_CARDS'
  | 'UNDER_5_5_CARDS';

export interface MarketPrediction {
  id: string;
  fixtureId: string;
  league: League;
  fixtureDescription: string;
  kickoff: string;
  market: MarketType;
  marketLabel: string;
  selection: string;
  estimatedProbability: number; // Calibrated probability between 0 and 1
  rawProbability: number;
  confidenceLower: number;
  confidenceUpper: number;
  supportingStatistics: {
    homeGoalAverageLast5: number;
    awayGoalAverageLast5: number;
    homeConcededAverageLast5: number;
    awayConcededAverageLast5: number;
    homeXgAverage: number | null;
    awayXgAverage: number | null;
    bttsFrequencyLast10: number;
    over25FrequencyLast10: number;
    h2hSummary: string;
    cleanSheetRateHome: number;
    cleanSheetRateAway: number;
  };
  sampleSize: number;
  dataFreshnessDays: number;
  riskFactors: string[];
  actualOutcome?: 'PENDING' | 'HIT' | 'MISS' | 'VOID';
}

export interface MatchAnalysis {
  fixture: Fixture;
  homeForm: {
    matchesPlayed: number;
    wins: number;
    draws: number;
    losses: number;
    goalsScored: number;
    goalsConceded: number;
    cleanSheets: number;
    failedToScore: number;
    avgShots: number | null;
    avgShotsOnTarget: number | null;
    avgCorners: number | null;
    avgYellowCards: number | null;
    avgXg: number | null;
    last5Results: Array<'W' | 'D' | 'L'>;
    recentFixtures: Array<{ opponent: string; score: string; result: 'W' | 'D' | 'L'; date: string }>;
  };
  awayForm: {
    matchesPlayed: number;
    wins: number;
    draws: number;
    losses: number;
    goalsScored: number;
    goalsConceded: number;
    cleanSheets: number;
    failedToScore: number;
    avgShots: number | null;
    avgShotsOnTarget: number | null;
    avgCorners: number | null;
    avgYellowCards: number | null;
    avgXg: number | null;
    last5Results: Array<'W' | 'D' | 'L'>;
    recentFixtures: Array<{ opponent: string; score: string; result: 'W' | 'D' | 'L'; date: string }>;
  };
  headToHead: {
    totalMeetings: number;
    homeWins: number;
    draws: number;
    awayWins: number;
    avgGoals: number;
    recentMeetings: Array<{
      date: string;
      homeTeam: string;
      awayTeam: string;
      score: string;
      competition: string;
    }>;
  };
  dixonColesParameters: {
    homeExpectedGoals: number;
    awayExpectedGoals: number;
    homeAttackStrength: number;
    homeDefenseWeakness: number;
    awayAttackStrength: number;
    awayDefenseWeakness: number;
    homeAdvantage: number;
  };
  scoreMatrix: Array<{ homeScore: number; awayScore: number; probability: number }>;
  marketPredictions: MarketPrediction[];
  injuries: Injury[] | null;
  lineups: {
    home: Lineup | null;
    away: Lineup | null;
  };
  dataQualityNotes: string[];
}

export type ParlayLegCount = 5 | 10 | 15 | 20 | 25;

export interface ParlayLeg {
  fixtureId: string;
  league: League;
  fixtureDescription: string;
  kickoff: string;
  market: MarketType;
  marketLabel: string;
  selection: string;
  estimatedProbability: number;
  supportingStatistics: MarketPrediction['supportingStatistics'];
  sampleSize: number;
  dataFreshnessDays: number;
  riskFactors: string[];
}

export type ParlayMode = 'ANTI_CORRELATED' | 'SAME_GAME_PARLAY' | 'CORRELATED_ALLOWED';

export interface StatisticalParlay {
  id: string;
  targetLegsCount: ParlayLegCount;
  actualLegsCount: number;
  mode?: ParlayMode;
  status: 'SUFFICIENT_SELECTIONS' | 'INSUFFICIENT_SELECTIONS';
  message: string;
  legs: ParlayLeg[];
  combinedProbability: number;
  compoundOddsDecimal: number;
  correlationExplanation: string;
  independenceAssumptions: string;
  riskWarning: string;
  generatedAt: string;
}

export type LegLiveStatus = 'PENDING' | 'LIVE_IN_PROGRESS' | 'LIVE_WINNING' | 'HIT' | 'MISS' | 'VOID';

export interface LiveTrackedLeg extends ParlayLeg {
  liveStatus: LegLiveStatus;
  currentMatchMinute: number | null;
  matchStatus: 'TIMED' | 'LIVE' | 'FINISHED' | 'POSTPONED';
  liveScore: string;
  liveStatValue?: string;
  targetMetric: string;
  progressPercent: number;
  note: string;
}

export interface LiveTrackedParlay {
  parlayId: string;
  parlay: StatisticalParlay;
  overallStatus: 'PENDING' | 'ACTIVE_LIVE' | 'WON' | 'BUSTED';
  legsHitCount: number;
  legsPendingCount: number;
  legsLiveCount: number;
  legsMissedCount: number;
  totalLegs: number;
  liveLegs: LiveTrackedLeg[];
  cashoutProbabilityIndex: number;
  lastUpdated: string;
}

export interface ModelPerformanceReport {
  overallBrierScore: number;
  overallLogLoss: number;
  overallHitRate: number;
  totalEvaluatedPredictions: number;
  leagueBreakdown: {
    EPL: { brierScore: number; hitRate: number; sampleCount: number };
    CHAMPIONSHIP: { brierScore: number; hitRate: number; sampleCount: number };
  };
  marketBreakdown: Record<string, { hitRate: number; sampleCount: number; brierScore: number }>;
  calibrationBuckets: Array<{
    bucketLabel: string; // e.g. "50-60%", "60-70%"
    minProb: number;
    maxProb: number;
    predictedMean: number;
    observedFrequency: number;
    sampleCount: number;
  }>;
}
