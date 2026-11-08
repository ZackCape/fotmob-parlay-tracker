/**
 * European Football Club Elo & Quantitative Rating Engine
 *
 * Provides instant, zero-latency Elo ratings for 140+ European clubs across top tiers,
 * converts Elo delta and bookmaker odds into calibrated Expected Goals (lambdaHome, lambdaAway),
 * and prevents flat default probabilities (1.35 goals) on elite vs lower-tier matchups.
 */

export interface HybridGoalsResult {
  lambdaHome: number;
  lambdaAway: number;
  eloHome: number;
  eloAway: number;
  winProbHome: number;
  drawProb: number;
  winProbAway: number;
  marketDevigged?: {
    home: number;
    draw: number;
    away: number;
  } | null;
}

/**
 * Benchmark Club Elo Ratings (2025/2026 calibrated scale).
 * Scaled from 1500 (lower second-tier / minor league) up to 2020 (top European elite).
 */
export const CLUB_ELO_RATINGS: Record<string, number> = {
  // ==========================================
  // Tier 1: Continental Elite (1920–2020)
  // ==========================================
  'manchester city': 2015,
  'man city': 2015,
  'real madrid': 2005,
  'arsenal': 1975,
  'liverpool': 1965,
  'inter milan': 1960,
  'internazionale': 1960,
  'inter': 1960,
  'bayern munich': 1955,
  'bayern münchen': 1955,
  'bayern': 1955,
  'barcelona': 1945,
  'fc barcelona': 1945,
  'paris saint-germain': 1935,
  'paris saint germain': 1935,
  'psg': 1935,
  'bayer leverkusen': 1925,
  'leverkusen': 1925,

  // ==========================================
  // Tier 2: European Contenders / Big 5 Challengers (1800–1915)
  // ==========================================
  'atletico madrid': 1910,
  'atlético madrid': 1910,
  'atlético de madrid': 1910,
  'atalanta': 1890,
  'borussia dortmund': 1885,
  'dortmund': 1885,
  'bvb': 1885,
  'rb leipzig': 1875,
  'leipzig': 1875,
  'aston villa': 1865,
  'chelsea': 1860,
  'newcastle united': 1855,
  'newcastle': 1855,
  'tottenham hotspur': 1850,
  'tottenham': 1850,
  'spurs': 1850,
  'sporting cp': 1845,
  'sporting lisbon': 1845,
  'sporting': 1845,
  'benfica': 1840,
  'sl benfica': 1840,
  'juventus': 1835,
  'ac milan': 1830,
  'milan': 1830,
  'napoli': 1830,
  'as monaco': 1815,
  'monaco': 1815,
  'lille': 1805,
  'losc lille': 1805,

  // ==========================================
  // Tier 3: Upper-Mid Table Big 5 / Dominant Domestic Clubs (1700–1795)
  // ==========================================
  'manchester united': 1795,
  'man united': 1795,
  'man utd': 1795,
  'brighton & hove albion': 1785,
  'brighton': 1785,
  'west ham united': 1775,
  'west ham': 1775,
  'crystal palace': 1765,
  'bournemouth': 1760,
  'afc bournemouth': 1760,
  'fulham': 1760,
  'brentford': 1755,
  'nottingham forest': 1750,
  'real sociedad': 1775,
  'athletic club': 1770,
  'athletic bilbao': 1770,
  'villarreal': 1765,
  'real betis': 1755,
  'betis': 1755,
  'sevilla': 1740,
  'girona': 1755,
  'celta vigo': 1715,
  'osasuna': 1710,
  'getafe': 1700,
  'mallorca': 1705,
  'rayo vallecano': 1700,
  'lazio': 1770,
  'as roma': 1765,
  'roma': 1765,
  'fiorentina': 1760,
  'bologna': 1755,
  'torino': 1730,
  'udinese': 1715,
  'monza': 1710,
  'eintracht frankfurt': 1770,
  'frankfurt': 1770,
  'vfb stuttgart': 1770,
  'stuttgart': 1770,
  'wolfsburg': 1740,
  'vfl wolfsburg': 1740,
  'sc freiburg': 1740,
  'freiburg': 1740,
  'borussia monchengladbach': 1725,
  'borussia mönchengladbach': 1725,
  'hoffenheim': 1730,
  'werder bremen': 1720,
  'marseille': 1770,
  'olympique de marseille': 1770,
  'lyon': 1755,
  'olympique lyonnais': 1755,
  'lens': 1745,
  'rc lens': 1745,
  'nice': 1745,
  'ogc nice': 1745,
  'rennes': 1735,
  'stade rennais': 1735,
  'reims': 1720,
  'strasbourg': 1715,
  'toulouse': 1710,
  'psv eindhoven': 1785,
  'psv': 1785,
  'feyenoord': 1775,
  'ajax': 1765,
  'az alkmaar': 1730,
  'az': 1730,
  'twente': 1725,
  'fc twente': 1725,
  'fc porto': 1780,
  'porto': 1780,
  'braga': 1745,
  'sc braga': 1745,
  'club brugge': 1755,
  'celtic': 1745,
  'galatasaray': 1760,
  'fenerbahce': 1755,
  'fenerbahçe': 1755,

  // ==========================================
  // Tier 4: Lower Big 5, Promoted, Top Championship & European Mid-Tier (1580–1695)
  // ==========================================
  'everton': 1695,
  'wolverhampton wanderers': 1690,
  'wolverhampton': 1690,
  'wolves': 1690,
  'leicester city': 1680,
  'leicester': 1680,
  'ipswich town': 1650,
  'ipswich': 1650,
  'southampton': 1655,
  'leeds united': 1675,
  'leeds': 1675,
  'burnley': 1655,
  'sheffield united': 1640,
  'sunderland': 1645,
  'middlesbrough': 1625,
  'west bromwich albion': 1630,
  'west brom': 1630,
  'norwich city': 1625,
  'norwich': 1625,
  'coventry city': 1615,
  'coventry': 1615,
  'watford': 1610,
  'bristol city': 1595,
  'millwall': 1590,
  'blackburn rovers': 1595,
  'swansea city': 1590,
  'stoke city': 1585,
  'queens park rangers': 1580,
  'qpr': 1580,
  'luton town': 1620,
  'luton': 1620,
  'cardiff city': 1580,
  'cardiff': 1580,
  'hull city': 1590,
  'preston north end': 1580,
  'sheffield wednesday': 1570,
  'plymouth argyle': 1540,
  'portsmouth': 1560,
  'derby county': 1565,
  'oxford united': 1545,
  'wrexham': 1530,
  'rangers': 1685,
  'heart of midlothian': 1560,
  'hearts': 1560,
  'aberdeen': 1555,
  'hibernian': 1540,
  'anderlecht': 1670,
  'union saint-gilloise': 1680,
  'union sg': 1680,
  'gent': 1645,
  'kaa gent': 1645,
  'genk': 1650,
  'royal antwerp': 1650,
  'antwerp': 1650,
  'besiktas': 1680,
  'beşiktaş': 1680,
  'trabzonspor': 1640,
  'basaksehir': 1625,
  'olympiacos': 1685,
  'olympiakos': 1685,
  'paok': 1675,
  'paok thessaloniki': 1675,
  'panathinaikos': 1665,
  'aek athens': 1660,
  'aek': 1660,
  'slavia prague': 1690,
  'sparta prague': 1680,
  'viktoria plzen': 1650,
  'red bull salzburg': 1685,
  'rb salzburg': 1685,
  'salzburg': 1685,
  'sturm graz': 1660,
  'rapid wien': 1620,
  'young boys': 1655,
  'bsc young boys': 1655,
  'basel': 1630,
  'fc basel': 1630,
  'servette': 1615,
  'zurich': 1610,
  'fc copenhagen': 1675,
  'copenhagen': 1675,
  'midtjylland': 1665,
  'brondby': 1635,
  'bodø/glimt': 1670,
  'bodo/glimt': 1670,
  'bodo glimt': 1670,
  'molde': 1630,
  'rosenborg': 1600,
  'malmo ff': 1620,
  'malmö ff': 1620,
  'dinamo zagreb': 1675,
  'hajduk split': 1610,
  'crvena zvezda': 1665,
  'red star belgrade': 1665,
  'partizan': 1620,
  'shakhtar donetsk': 1680,
  'shakhtar': 1680,
  'dynamo kyiv': 1655,
  'dynamo kiev': 1655,
  'legia warsaw': 1610,
  'lech poznan': 1600,
  'ferencvaros': 1625,
  'maccabi tel aviv': 1620,
  'qarabag': 1635,
  'qarabag fk': 1635,
};

/**
 * Baseline fallback Elo when a team is not in the dictionary.
 */
export function getLeagueDefaultElo(league?: string): number {
  if (!league) return 1620;
  const l = league.toUpperCase();
  if (l.includes('CHAMPIONS_LEAGUE') || l.includes('UCL')) return 1760;
  if (l.includes('PREMIER_LEAGUE') || l === 'EPL') return 1730;
  if (l.includes('LA_LIGA') || l.includes('SERIE_A') || l.includes('BUNDESLIGA') || l.includes('LIGUE_1')) return 1710;
  if (l.includes('EUROPA_LEAGUE') || l.includes('UEL')) return 1680;
  if (l.includes('CONFERENCE') || l.includes('UECL')) return 1640;
  if (l.includes('CHAMPIONSHIP')) return 1560;
  return 1620;
}

/**
 * Normalize club names for dictionary matching (removes accents, punctuation, FC/AFC prefixes/suffixes).
 */
export function normalizeClubName(name: string): string {
  if (!name) return '';
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // remove diacritics
    .replace(/\b(fc|afc|cf|sc|rc|vfl|vfb|bsc|ogc|losc|fk)\b/g, '')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Lookup club Elo with exact, normalized and smart substring/alias fallback.
 */
export function getClubElo(teamName: string, league?: string): number {
  if (!teamName) return getLeagueDefaultElo(league);

  const rawLower = teamName.toLowerCase().trim();
  if (CLUB_ELO_RATINGS[rawLower]) return CLUB_ELO_RATINGS[rawLower];

  const norm = normalizeClubName(teamName);
  if (CLUB_ELO_RATINGS[norm]) return CLUB_ELO_RATINGS[norm];

  // Alias / Substring search
  for (const [key, rating] of Object.entries(CLUB_ELO_RATINGS)) {
    if (key.length >= 4 && (norm === key || norm.includes(key) || key.includes(norm))) {
      return rating;
    }
  }

  return getLeagueDefaultElo(league);
}

/**
 * Convert Elo delta into analytical 1X2 win probabilities using standard logistic curve.
 */
export function eloToWinProbabilities(eloDiffWithHomeAdvantage: number): { winProbHome: number; drawProb: number; winProbAway: number } {
  // Standard logistic expectation for home
  const winExp = 1 / (1 + Math.pow(10, -eloDiffWithHomeAdvantage / 400));
  // Empirical draw probability curve (draws peak around 26-28% when teams are equal)
  const drawProb = Math.max(0.12, 0.275 - 0.12 * Math.abs(winExp - 0.5));
  const remaining = 1 - drawProb;
  const winProbHome = Math.max(0.04, Math.min(0.92, remaining * winExp));
  const winProbAway = Math.max(0.04, Math.min(0.92, remaining * (1 - winExp)));
  const sum = winProbHome + drawProb + winProbAway;

  return {
    winProbHome: winProbHome / sum,
    drawProb: drawProb / sum,
    winProbAway: winProbAway / sum,
  };
}

/**
 * Quantitative Hybrid Expected Goals Engine
 *
 * Blends Elo power rating differentials with available bookmaker consensus odds,
 * protecting against flat 1.35-goal defaults for heavy favorites and underdogs.
 */
export function calculateHybridExpectedGoals(params: {
  homeTeam: string;
  awayTeam: string;
  league?: string;
  baseLambdaHome?: number;
  baseLambdaAway?: number;
  bookmakerOdds?: {
    home?: number;
    draw?: number;
    away?: number;
    over25?: number;
    under25?: number;
  } | null;
}): HybridGoalsResult {
  const { homeTeam, awayTeam, league, baseLambdaHome, baseLambdaAway, bookmakerOdds } = params;

  const eloHome = getClubElo(homeTeam, league);
  const eloAway = getClubElo(awayTeam, league);

  // +65 Elo home advantage represents standard ~0.35 goal home advantage across European leagues
  const eloDiff = (eloHome + 65) - eloAway;

  const { winProbHome, drawProb, winProbAway } = eloToWinProbabilities(eloDiff);

  // Elo-implied expected goals
  const totalGoalsBase = 2.72;
  const homeShare = 1 / (1 + Math.pow(10, -eloDiff / 400));
  let eloLambdaHome = Math.max(0.45, Math.min(3.40, totalGoalsBase * homeShare * 1.04));
  let eloLambdaAway = Math.max(0.35, Math.min(3.10, totalGoalsBase * (1 - homeShare) * 0.96));

  let finalLambdaHome = eloLambdaHome;
  let finalLambdaAway = eloLambdaAway;
  let deviggedOdds: { home: number; draw: number; away: number } | null = null;

  // If valid bookmaker odds exist, devig them multiplicatively and blend
  if (
    bookmakerOdds &&
    typeof bookmakerOdds.home === 'number' && bookmakerOdds.home > 1.01 &&
    typeof bookmakerOdds.draw === 'number' && bookmakerOdds.draw > 1.01 &&
    typeof bookmakerOdds.away === 'number' && bookmakerOdds.away > 1.01
  ) {
    const rawH = 1 / bookmakerOdds.home;
    const rawD = 1 / bookmakerOdds.draw;
    const rawA = 1 / bookmakerOdds.away;
    const overround = rawH + rawD + rawA;

    if (overround > 0.95 && overround < 1.30) {
      const pH = rawH / overround;
      const pD = rawD / overround;
      const pA = rawA / overround;
      deviggedOdds = { home: pH, draw: pD, away: pA };

      // Market-implied goal share (excluding draws)
      const mktHomeShare = pH / Math.max(0.001, (pH + pA));
      const mktTotalGoals = (typeof bookmakerOdds.over25 === 'number' && bookmakerOdds.over25 > 1.3 && bookmakerOdds.over25 < 3.0)
        ? (bookmakerOdds.over25 < 1.95 ? 2.95 : 2.50)
        : totalGoalsBase;

      const mktLambdaHome = Math.max(0.40, Math.min(3.50, mktTotalGoals * mktHomeShare * 1.03));
      const mktLambdaAway = Math.max(0.30, Math.min(3.20, mktTotalGoals * (1 - mktHomeShare) * 0.97));

      // 65% Market Consensus + 35% Pure Elo
      finalLambdaHome = mktLambdaHome * 0.65 + eloLambdaHome * 0.35;
      finalLambdaAway = mktLambdaAway * 0.65 + eloLambdaAway * 0.35;
    }
  }

  // If local Poisson/historical stats were provided, blend 70% Elo/Market with 30% local stats
  if (
    typeof baseLambdaHome === 'number' && Number.isFinite(baseLambdaHome) && baseLambdaHome > 0.3 &&
    typeof baseLambdaAway === 'number' && Number.isFinite(baseLambdaAway) && baseLambdaAway > 0.3
  ) {
    finalLambdaHome = finalLambdaHome * 0.70 + Math.max(0.40, Math.min(3.40, baseLambdaHome)) * 0.30;
    finalLambdaAway = finalLambdaAway * 0.70 + Math.max(0.30, Math.min(3.20, baseLambdaAway)) * 0.30;
  }

  return {
    lambdaHome: Number(finalLambdaHome.toFixed(3)),
    lambdaAway: Number(finalLambdaAway.toFixed(3)),
    eloHome,
    eloAway,
    winProbHome: Number(winProbHome.toFixed(4)),
    drawProb: Number(drawProb.toFixed(4)),
    winProbAway: Number(winProbAway.toFixed(4)),
    marketDevigged: deviggedOdds,
  };
}

export default {
  CLUB_ELO_RATINGS,
  getClubElo,
  getLeagueDefaultElo,
  normalizeClubName,
  eloToWinProbabilities,
  calculateHybridExpectedGoals,
};
