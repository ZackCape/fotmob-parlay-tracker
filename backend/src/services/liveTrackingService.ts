/**
 * Cape Predictor — Live Momentum & Pressure Squeeze Engine
 *
 * Tracks in-play match momentum (-100 to +100), detects late-game
 * "Pressure Squeeze" states (75'+), monitors in-play CLV (iCLV), and
 * powers real-time match incident timelines.
 */

import { emitLiveEvent, LiveEventPayload } from './instantStreamService.js';

// ---------------------------------------------------------------------------
// Types & Interfaces
// ---------------------------------------------------------------------------

export type TimelineIncidentType =
  | 'GOAL'
  | 'DISALLOWED_GOAL'
  | 'VAR_ROLLBACK'
  | 'RED_CARD'
  | 'YELLOW_CARD'
  | 'CORNER_SURGE'
  | 'PRESSURE_SQUEEZE'
  | 'HT'
  | 'FT';

export interface IncidentTimelineEntry {
  id: string;
  fixtureId: string;
  type: TimelineIncidentType;
  minute: number | string;
  team?: 'home' | 'away' | string;
  player?: string;
  detail: string;
  timestamp: number;
}

export interface LiveMatchStats {
  homeScore: number;
  awayScore: number;
  homeShotsOnTarget?: number;
  awayShotsOnTarget?: number;
  homeCorners?: number;
  awayCorners?: number;
  homeRedCards?: number;
  awayRedCards?: number;
  homeYellowCards?: number;
  awayYellowCards?: number;
  homeDangerousAttacks?: number;
  awayDangerousAttacks?: number;
  homePossession?: number; // 0..100
  awayPossession?: number; // 0..100
}

export interface PressureSqueezeAlert {
  fixtureId: string;
  homeTeam: string;
  awayTeam: string;
  minute: number;
  score: string;
  dominantTeam: 'home' | 'away';
  trailingTeam?: 'home' | 'away';
  momentumScore: number;
  recommendedMarkets: string[];
  urgency: 'HIGH' | 'EXTREME';
  reason: string;
  timestamp: number;
}

export interface InPlayOddsState {
  market: string;
  selection: string;
  takenOdds: number;
  liveOdds: number;
  iClvPercent: number;
  lastUpdated: number;
}

export interface LiveMatchSnapshot {
  fixtureId: string;
  homeTeam: string;
  awayTeam: string;
  league?: string;
  minute: number;
  status: 'LIVE' | 'HT' | 'FT' | string;
  stats: LiveMatchStats;
  momentum: number; // -100 to +100
  momentumHistory: Array<{ minute: number; score: number; timestamp: number }>;
  pressureSqueezeActive: boolean;
  activePressureAlert?: PressureSqueezeAlert;
  lastPressureSqueezeAt?: number;
  inPlayOdds?: InPlayOddsState;
  timeline: IncidentTimelineEntry[];
  lastUpdated: number;
}

// ---------------------------------------------------------------------------
// In-Memory State
// ---------------------------------------------------------------------------
const liveMatches = new Map<string, LiveMatchSnapshot>();
const pressureSqueezeCooldown = new Map<string, number>();
const PRESSURE_COOLDOWN_MS = 8 * 60 * 1000; // 8 minutes between consecutive pressure alerts

// ---------------------------------------------------------------------------
// Quantitative Momentum Math
// ---------------------------------------------------------------------------

/**
 * Calculates a rolling momentum score bounded between -100 (Away dominance)
 * and +100 (Home dominance).
 *
 * Weightings:
 * - Current Goal Differential: +/- 15 pts per goal
 * - Recent Goals (within last 10 min): +/- 25 pts
 * - Shots on Target: +/- 7 pts per shot on target differential
 * - Corner Surges: +/- 4 pts per corner differential
 * - Red Card Penalties: -25 pts for the penalized team
 * - Yellow Card Penalties: -4 pts for the penalized team
 * - Dangerous Attacks / Possession: +/- 0.5 to 0.8 per differential unit
 */
export function calculateMomentumScore(
  stats: LiveMatchStats,
  recentEvents: IncidentTimelineEntry[] = [],
  currentMinute: number = 45
): number {
  let score = 0;

  // 1. Goal Differential
  const scoreDiff = (stats.homeScore ?? 0) - (stats.awayScore ?? 0);
  score += scoreDiff * 15;

  // 2. Recent Goal Momentum Boost (goals scored within the last 10 minutes)
  for (const ev of recentEvents) {
    if (ev.type === 'GOAL') {
      const evMin = typeof ev.minute === 'number' ? ev.minute : parseInt(String(ev.minute), 10);
      if (!Number.isNaN(evMin) && currentMinute - evMin <= 10 && currentMinute >= evMin) {
        if (ev.team === 'home') score += 25;
        else if (ev.team === 'away') score -= 25;
      }
    }
  }

  // 3. Shots on Target Differential
  const shotsDiff = (stats.homeShotsOnTarget ?? 0) - (stats.awayShotsOnTarget ?? 0);
  score += shotsDiff * 7;

  // 4. Corner Surges Differential
  const cornersDiff = (stats.homeCorners ?? 0) - (stats.awayCorners ?? 0);
  score += cornersDiff * 4;

  // 5. Disciplinary Penalties (Red/Yellow Cards)
  const redDiff = (stats.awayRedCards ?? 0) - (stats.homeRedCards ?? 0); // home red hurts home (+away)
  score += redDiff * 25;

  const yellowDiff = (stats.awayYellowCards ?? 0) - (stats.homeYellowCards ?? 0);
  score += yellowDiff * 4;

  // 6. Dangerous Attacks Differential (if provided)
  if (stats.homeDangerousAttacks !== undefined && stats.awayDangerousAttacks !== undefined) {
    const attackDiff = stats.homeDangerousAttacks - stats.awayDangerousAttacks;
    score += attackDiff * 0.8;
  }

  // 7. Possession Differential
  if (stats.homePossession !== undefined && stats.awayPossession !== undefined) {
    const possDiff = stats.homePossession - stats.awayPossession;
    score += possDiff * 0.5;
  }

  // Strictly clamp between -100 and +100
  return Math.max(-100, Math.min(100, Math.round(score)));
}

// ---------------------------------------------------------------------------
// "The Pressure Squeeze" Detector
// ---------------------------------------------------------------------------

/**
 * Detects late-game siege states (75'–90'+) where a team is applying
 * sustained attacking pressure, and triggers market recommendations.
 */
export function evaluatePressureSqueeze(snapshot: LiveMatchSnapshot): PressureSqueezeAlert | null {
  const { minute, stats, momentum, fixtureId } = snapshot;

  // Only active in final 15 minutes of regular time or stoppage (75'+)
  if (minute < 75) {
    return null;
  }

  // Check cooldown to avoid alert spamming
  const now = Date.now();
  const lastAlert = pressureSqueezeCooldown.get(fixtureId);
  if (lastAlert && now - lastAlert < PRESSURE_COOLDOWN_MS) {
    return null;
  }

  const scoreDiff = stats.homeScore - stats.awayScore;
  const isCloseGame = Math.abs(scoreDiff) <= 1; // tied or 1 goal difference

  // Home Pressure Squeeze Criteria:
  // - Close match, momentum heavily favoring home (>= 40), or
  // - Home is trailing (scoreDiff < 0) and applying intense attack (momentum >= 30, shot/corner edge)
  const homePressing =
    (isCloseGame && momentum >= 40) ||
    (scoreDiff < 0 && momentum >= 28 && (stats.homeCorners ?? 0) >= (stats.awayCorners ?? 0));

  // Away Pressure Squeeze Criteria:
  // - Close match, momentum heavily favoring away (<= -40), or
  // - Away is trailing (scoreDiff > 0) and applying intense attack (momentum <= -30)
  const awayPressing =
    (isCloseGame && momentum <= -40) ||
    (scoreDiff > 0 && momentum <= -28 && (stats.awayCorners ?? 0) >= (stats.homeCorners ?? 0));

  if (!homePressing && !awayPressing) {
    return null;
  }

  const dominantTeam: 'home' | 'away' = homePressing ? 'home' : 'away';
  const dominantName = dominantTeam === 'home' ? snapshot.homeTeam : snapshot.awayTeam;
  const trailingTeam: 'home' | 'away' | undefined =
    scoreDiff < 0 ? 'home' : scoreDiff > 0 ? 'away' : undefined;

  const currentTotalGoals = stats.homeScore + stats.awayScore;
  const nextOverLine = currentTotalGoals + 0.5;

  const recommendedMarkets = [
    `OVER_${String(nextOverLine).replace('.', '_')}_GOALS`,
    `NEXT_GOAL_${dominantTeam.toUpperCase()}`,
    `NEXT_CORNER_${dominantTeam.toUpperCase()}`,
  ];

  const urgency: 'HIGH' | 'EXTREME' = minute >= 84 || Math.abs(momentum) >= 65 ? 'EXTREME' : 'HIGH';

  const alert: PressureSqueezeAlert = {
    fixtureId,
    homeTeam: snapshot.homeTeam,
    awayTeam: snapshot.awayTeam,
    minute,
    score: `${stats.homeScore} - ${stats.awayScore}`,
    dominantTeam,
    trailingTeam,
    momentumScore: momentum,
    recommendedMarkets,
    urgency,
    reason: `${dominantName} applying late-game siege (+${Math.abs(momentum)} momentum) at ${minute}'. Attack intensity suggests high late goal/corner probability.`,
    timestamp: now,
  };

  pressureSqueezeCooldown.set(fixtureId, now);
  return alert;
}

// ---------------------------------------------------------------------------
// In-Play CLV (iCLV) Math
// ---------------------------------------------------------------------------

/**
 * Calculates in-play Closing Line Value (iCLV) percentage:
 *
 * iClvPercent = ((takenOdds / liveOdds) - 1) * 100
 *
 * Example:
 * - Taken odds = 2.40, current live odds drop to 1.60 -> iCLV = +50.0%
 * - Taken odds = 1.80, current live odds drift to 2.20 -> iCLV = -18.18%
 */
export function calculateInPlayClv(takenOdds: number, liveOdds: number): number {
  if (!takenOdds || !liveOdds || liveOdds <= 0) return 0;
  const clv = ((takenOdds / liveOdds) - 1) * 100;
  return Number(clv.toFixed(2));
}

// ---------------------------------------------------------------------------
// State Management & Update Engine
// ---------------------------------------------------------------------------

/**
 * Updates or registers an in-play fixture with new live stats, computes
 * updated momentum, appends to the waveform history, checks for pressure
 * squeeze conditions, and broadcasts SSE updates.
 */
export function updateLiveMatch(data: {
  fixtureId: string;
  homeTeam: string;
  awayTeam: string;
  league?: string;
  minute: number;
  status: string;
  stats: LiveMatchStats;
  inPlayOdds?: {
    market: string;
    selection: string;
    takenOdds: number;
    liveOdds: number;
  };
}): LiveMatchSnapshot {
  const existing = liveMatches.get(data.fixtureId);
  const now = Date.now();

  const timeline = existing?.timeline || [];
  const currentMinute = data.minute;

  // Compute momentum score
  const rawMomentum = calculateMomentumScore(data.stats, timeline, currentMinute);

  // Smooth momentum using exponential moving average if prior snapshot exists
  const smoothedMomentum = existing
    ? Math.round(0.70 * rawMomentum + 0.30 * existing.momentum)
    : rawMomentum;

  const momentum = Math.max(-100, Math.min(100, smoothedMomentum));

  // Maintain rolling waveform history (last 25 points)
  const history = existing?.momentumHistory ? [...existing.momentumHistory] : [];
  history.push({ minute: currentMinute, score: momentum, timestamp: now });
  if (history.length > 25) history.shift();

  // In-Play CLV calculation
  let inPlayOdds: InPlayOddsState | undefined = existing?.inPlayOdds;
  if (data.inPlayOdds) {
    const clv = calculateInPlayClv(data.inPlayOdds.takenOdds, data.inPlayOdds.liveOdds);
    inPlayOdds = {
      ...data.inPlayOdds,
      iClvPercent: clv,
      lastUpdated: now,
    };
  }

  const snapshot: LiveMatchSnapshot = {
    fixtureId: data.fixtureId,
    homeTeam: data.homeTeam,
    awayTeam: data.awayTeam,
    league: data.league || existing?.league,
    minute: data.minute,
    status: data.status,
    stats: data.stats,
    momentum,
    momentumHistory: history,
    pressureSqueezeActive: false,
    activePressureAlert: existing?.activePressureAlert,
    lastPressureSqueezeAt: existing?.lastPressureSqueezeAt,
    inPlayOdds,
    timeline,
    lastUpdated: now,
  };

  // Evaluate Pressure Squeeze in 75'+ window
  const pressureAlert = evaluatePressureSqueeze(snapshot);
  if (pressureAlert) {
    snapshot.pressureSqueezeActive = true;
    snapshot.activePressureAlert = pressureAlert;
    snapshot.lastPressureSqueezeAt = now;

    // Record incident in timeline
    recordMatchIncident(data.fixtureId, {
      fixtureId: data.fixtureId,
      type: 'PRESSURE_SQUEEZE',
      minute: currentMinute,
      team: pressureAlert.dominantTeam,
      detail: pressureAlert.reason,
    });

    // Broadcast Pressure Squeeze via SSE event bus
    emitLiveEvent({
      type: 'PRESSURE_SQUEEZE',
      fixtureId: data.fixtureId,
      homeTeam: data.homeTeam,
      awayTeam: data.awayTeam,
      homeScore: data.stats.homeScore,
      awayScore: data.stats.awayScore,
      minute: String(currentMinute),
      detail: pressureAlert.reason,
      timestamp: now,
      momentum,
      pressureSqueeze: pressureAlert,
    });
  }

  liveMatches.set(data.fixtureId, snapshot);
  return snapshot;
}

/**
 * Append an incident to the chronological match timeline.
 */
export function recordMatchIncident(
  fixtureId: string,
  incident: Omit<IncidentTimelineEntry, 'id' | 'timestamp'>
): IncidentTimelineEntry {
  const match = liveMatches.get(fixtureId);
  const now = Date.now();
  const entry: IncidentTimelineEntry = {
    ...incident,
    id: `inc_${fixtureId}_${incident.type}_${incident.minute}_${now}`,
    timestamp: now,
  };

  if (match) {
    match.timeline.push(entry);
    // Sort timeline chronologically by minute
    match.timeline.sort((a, b) => {
      const minA = typeof a.minute === 'number' ? a.minute : parseInt(String(a.minute), 10) || 0;
      const minB = typeof b.minute === 'number' ? b.minute : parseInt(String(b.minute), 10) || 0;
      return minA - minB;
    });
  }

  return entry;
}

/** Get snapshot of an active live match. */
export function getLiveMatch(fixtureId: string): LiveMatchSnapshot | undefined {
  return liveMatches.get(fixtureId);
}

/** Get all currently tracked in-play matches. */
export function getAllLiveMatches(): LiveMatchSnapshot[] {
  return Array.from(liveMatches.values());
}

/** Purge in-memory live matches (useful for testing and daily reset). */
export function clearLiveMatches(): void {
  liveMatches.clear();
  pressureSqueezeCooldown.clear();
}
