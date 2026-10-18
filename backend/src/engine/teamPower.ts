/**
 * Team power ratings (ELO-style).
 *
 * The Dixon-Coles engine needs *relative* multipliers around 1.00:
 *
 *   homeLambda = leagueBaseline * homeAttack * awayDefense * homeAdvantage
 *   awayMu     = leagueBaseline * awayAttack * homeDefense
 *
 * Historically `estimateTeamStrengths` only had real evidence when a provider
 * supplied recent form or fixture xG. On a cold fixture it fell back to a
 * neutral 1.00 / 1.00 prior, which meant "Arsenal away at Nottingham Forest"
 * looked exactly like "Everton away at Manchester City".
 *
 * This module supplies a calibrated power prior (alpha = attack, beta =
 * defence) for the major European clubs so the engine always has a defensible
 * starting point. Observed form/xG then shrinks the team toward that prior.
 *
 * Ratings are indicative ELO numbers kept alongside the multipliers so the
 * surface can show a comparable "power" figure and so cross-league fixtures
 * (Champions League) still resolve sensibly.
 */

export interface TeamPowerRating {
  /** Attack multiplier around 1.00 fed to Dixon-Coles (alpha). */
  attack: number;
  /** Defensive weakness multiplier around 1.00 (beta); lower = better defence. */
  defense: number;
  /** Indicative ELO rating for display / cross-league comparison. */
  elo: number;
}

const R = (attack: number, defense: number, elo: number): TeamPowerRating => ({ attack, defense, elo });

/** Normalise a team name to a stable lookup key. */
export function normalizeTeamName(name: string | null | undefined): string {
  return (name || '')
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/\bfc\b/g, '')
    .replace(/\bafc\b/g, '')
    .replace(/[^a-z0-9]/g, '');
}

/**
 * Calibrated power ratings, keyed by normalised team name.
 * Values mirror the adaptive-learning seed priors so the two subsystems agree.
 */
export const TEAM_POWER_RATINGS: Record<string, TeamPowerRating> = {
  // ---- Premier League ----
  manchestercity: R(1.62, 0.72, 2075),
  arsenal: R(1.54, 0.70, 2040),
  liverpool: R(1.58, 0.75, 2035),
  chelsea: R(1.35, 0.95, 1900),
  astonvilla: R(1.32, 0.98, 1870),
  tottenhamhotspur: R(1.40, 1.08, 1880),
  tottenham: R(1.40, 1.08, 1880),
  newcastleunited: R(1.30, 0.96, 1870),
  newcastle: R(1.30, 0.96, 1870),
  manchesterunited: R(1.25, 1.05, 1880),
  manutd: R(1.25, 1.05, 1880),
  brightonandhovealbion: R(1.22, 1.06, 1830),
  brighton: R(1.22, 1.06, 1830),
  westhamunited: R(1.15, 1.15, 1790),
  westham: R(1.15, 1.15, 1790),
  wolverhamptonwanderers: R(1.05, 1.22, 1740),
  wolves: R(1.05, 1.22, 1740),
  everton: R(1.00, 1.18, 1760),
  fulham: R(1.10, 1.12, 1790),
  brentford: R(1.18, 1.16, 1790),
  crystalpalace: R(1.08, 1.14, 1790),
  bournemouth: R(1.12, 1.20, 1760),
  afcbournemouth: R(1.12, 1.20, 1760),
  nottinghamforest: R(1.06, 1.16, 1760),
  leicestercity: R(1.02, 1.28, 1750),
  leicester: R(1.02, 1.28, 1750),
  ipswichtown: R(0.95, 1.35, 1700),
  ipswich: R(0.95, 1.35, 1700),
  southampton: R(0.90, 1.40, 1690),
  leedsunited: R(1.05, 1.15, 1730),
  leeds: R(1.05, 1.15, 1730),
  burnley: R(1.00, 1.20, 1720),
  sheffieldunited: R(0.95, 1.28, 1690),
  sunderland: R(1.10, 1.12, 1740),

  // ---- La Liga ----
  realmadrid: R(1.65, 0.70, 2040),
  barcelona: R(1.68, 0.78, 2010),
  atleticomadrid: R(1.38, 0.68, 1930),
  athleticclub: R(1.28, 0.88, 1850),
  realsociedad: R(1.20, 0.90, 1820),
  villarreal: R(1.32, 1.10, 1850),
  realbetis: R(1.18, 1.02, 1810),
  girona: R(1.30, 1.12, 1830),
  sevilla: R(1.15, 1.15, 1790),

  // ---- Serie A ----
  inter: R(1.55, 0.70, 1960),
  intermilan: R(1.55, 0.70, 1960),
  acmilan: R(1.38, 0.92, 1900),
  milan: R(1.38, 0.92, 1900),
  juventus: R(1.35, 0.85, 1890),
  napoli: R(1.42, 0.82, 1910),
  roma: R(1.32, 0.88, 1870),
  atalanta: R(1.40, 0.92, 1890),
  lazio: R(1.22, 1.00, 1830),
  fiorentina: R(1.22, 1.02, 1830),

  // ---- Bundesliga ----
  bayernmunich: R(1.75, 0.75, 2020),
  bayern: R(1.75, 0.75, 2020),
  bayerleverkusen: R(1.60, 0.80, 1940),
  leverkusen: R(1.60, 0.80, 1940),
  borussiadortmund: R(1.45, 0.95, 1880),
  dortmund: R(1.45, 0.95, 1880),
  rbleipzig: R(1.42, 0.90, 1870),
  leipzig: R(1.42, 0.90, 1870),
  stuttgart: R(1.30, 1.00, 1840),
  frankfurt: R(1.25, 1.02, 1820),

  // ---- Ligue 1 ----
  parissaintgermain: R(1.72, 0.74, 2000),
  paris: R(1.72, 0.74, 2000),
  psg: R(1.72, 0.74, 2000),
  monaco: R(1.42, 0.94, 1880),
  marseille: R(1.36, 0.98, 1860),
  lille: R(1.30, 0.88, 1850),
  lyon: R(1.28, 1.10, 1830),
  lens: R(1.22, 0.92, 1810),
  nice: R(1.18, 0.85, 1800),
  rennes: R(1.20, 1.08, 1790),

  // ---- Championship ----
  westbromwichalbion: R(1.20, 0.90, 1780),
  westbrom: R(1.20, 0.90, 1780),
  middlesbrough: R(1.22, 1.02, 1780),
  norwichcity: R(1.24, 1.08, 1780),
  norwich: R(1.24, 1.08, 1780),
  watford: R(1.18, 1.10, 1760),
  lutontown: R(1.16, 1.15, 1740),
  luton: R(1.16, 1.15, 1740),
};

/**
 * Resolve a team name to a power rating.
 *
 * Tries an exact normalised match first, then a containment match so that
 * provider variants ("Arsenal FC", "Bayern München"-style extras) still land
 * on the right row. Returns null when the club is unknown so callers can fall
 * back to a neutral prior rather than inventing a number.
 */
export function lookupTeamPower(name: string | null | undefined): TeamPowerRating | null {
  const key = normalizeTeamName(name);
  if (!key) return null;
  const exact = TEAM_POWER_RATINGS[key];
  if (exact) return exact;

  // Longest-known-name containment match to avoid "united" style collisions.
  let best: { key: string; rating: TeamPowerRating } | null = null;
  for (const [knownKey, rating] of Object.entries(TEAM_POWER_RATINGS)) {
    if (knownKey.length < 4) continue;
    if (key.includes(knownKey) || knownKey.includes(key)) {
      if (!best || knownKey.length > best.key.length) best = { key: knownKey, rating };
    }
  }
  return best ? best.rating : null;
}

/** Standard ELO win expectancy for side A against side B (draws excluded). */
export function eloWinExpectancy(eloA: number, eloB: number): number {
  return 1 / (1 + Math.pow(10, (eloB - eloA) / 400));
}

/** Dampened home-advantage factor applied to the home expected-goal rate. */
export const HOME_ADVANTAGE_FACTOR = 1.12;
