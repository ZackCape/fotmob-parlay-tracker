import { DataProviderFactory } from '../providers/provider-factory.js';
import {
  Fixture,
  LiveTrackedLeg,
  LiveTrackedParlay,
  MarketPrediction,
  ParlayLeg,
  StatisticalParlay,
} from '../types/football.js';
import { evaluateActualOutcome } from '../engine/market-calculator.js';

export class LiveParlayTrackerService {
  private trackedParlays: Map<string, LiveTrackedParlay> = new Map();
  private factory: DataProviderFactory;
  private simulationTicks: Map<string, number> = new Map(); // tracks simulated elapsed minutes per parlay

  constructor(factory: DataProviderFactory) {
    this.factory = factory;
  }

  /**
   * Registers a parlay for real-time live tracking
   */
  public async trackParlay(parlay: StatisticalParlay): Promise<LiveTrackedParlay> {
    const liveLegs: LiveTrackedLeg[] = parlay.legs.map((leg, index) => {
      return {
        ...leg,
        liveStatus: 'PENDING',
        currentMatchMinute: null,
        matchStatus: 'TIMED',
        liveScore: '0 - 0',
        liveStatValue: 'Match not started',
        targetMetric: this.formatTargetMetric(leg),
        progressPercent: 0,
        note: `Scheduled for ${leg.kickoff || 'today'}`,
      };
    });

    const tracked: LiveTrackedParlay = {
      parlayId: parlay.id,
      parlay,
      overallStatus: 'PENDING',
      legsHitCount: 0,
      legsPendingCount: liveLegs.length,
      legsLiveCount: 0,
      legsMissedCount: 0,
      totalLegs: liveLegs.length,
      liveLegs,
      cashoutProbabilityIndex: parlay.combinedProbability,
      lastUpdated: new Date().toISOString(),
    };

    this.trackedParlays.set(parlay.id, tracked);
    this.simulationTicks.set(parlay.id, 0);

    // Initial evaluation
    return await this.evaluateParlayProgress(parlay.id);
  }

  /**
   * Evaluates and updates real-time leg progress across live APIs and match state
   */
  public async evaluateParlayProgress(parlayId: string): Promise<LiveTrackedParlay> {
    const tracked = this.trackedParlays.get(parlayId);
    if (!tracked) throw new Error(`Tracked parlay ${parlayId} not found.`);

    const simTick = this.simulationTicks.get(parlayId) || 0;

    let hitCount = 0;
    let pendingCount = 0;
    let liveCount = 0;
    let missedCount = 0;

    const updatedLegs: LiveTrackedLeg[] = [];

    for (let i = 0; i < tracked.parlay.legs.length; i++) {
      const leg = tracked.parlay.legs[i];
      let fixture: Fixture | null = null;

      try {
        const details = await this.factory.getMatchDetails(leg.fixtureId);
        fixture = details?.fixture || null;
      } catch (e) {
        // Fallback
      }

      // Check if match is real live or finished or timed
      let matchStatus = fixture?.status || 'TIMED';
      let homeScore = fixture?.homeScore ?? 0;
      let awayScore = fixture?.awayScore ?? 0;
      let minute: number | null = null;
      let corners = (fixture?.statistics?.cornersHome ?? 3) + (fixture?.statistics?.cornersAway ?? 3);
      let cards = (fixture?.statistics?.yellowCardsHome ?? 1) + (fixture?.statistics?.yellowCardsAway ?? 1);

      // If simulated tick is active (user testing live movement)
      if (simTick > 0) {
        minute = Math.min(90, simTick + i * 4);
        matchStatus = minute >= 90 ? 'FINISHED' : 'LIVE';

        // Simulated progressive values based on minute
        const matchProgressRatio = minute / 90;
        homeScore = Math.floor(matchProgressRatio * 1.8 + (i % 2 === 0 ? 1 : 0));
        awayScore = Math.floor(matchProgressRatio * 1.2);
        corners = Math.floor(matchProgressRatio * 10);
        cards = Math.floor(matchProgressRatio * 4);
      }

      const totalGoals = homeScore + awayScore;
      let liveStatus: LiveTrackedLeg['liveStatus'] = 'PENDING';
      let progressPercent = 0;
      let note = 'Kickoff pending';
      let statValue = `${totalGoals} goals`;

      if (matchStatus === 'FINISHED') {
        const outcome = evaluateActualOutcome(leg.market, {
          ...(fixture || ({} as any)),
          homeScore,
          awayScore,
          status: 'FINISHED',
          statistics: {
            shotsHome: null,
            shotsAway: null,
            shotsOnTargetHome: null,
            shotsOnTargetAway: null,
            xgHome: null,
            xgAway: null,
            cornersHome: Math.ceil(corners / 2),
            cornersAway: Math.floor(corners / 2),
            foulsHome: null,
            foulsAway: null,
            yellowCardsHome: Math.ceil(cards / 2),
            yellowCardsAway: Math.floor(cards / 2),
            redCardsHome: 0,
            redCardsAway: 0,
            possessionHome: null,
            possessionAway: null,
          },
        });

        if (outcome === 'HIT') {
          liveStatus = 'HIT';
          progressPercent = 100;
          note = `Full-Time (${homeScore}-${awayScore}) — Leg WON 🟢`;
          hitCount++;
        } else if (outcome === 'MISS') {
          liveStatus = 'MISS';
          progressPercent = 100;
          note = `Full-Time (${homeScore}-${awayScore}) — Leg LOST 🔴`;
          missedCount++;
        } else {
          liveStatus = 'VOID';
          progressPercent = 100;
          note = `Match voided / statistics unavailable`;
        }
      } else if (matchStatus === 'LIVE') {
        liveCount++;

        switch (leg.market) {
          case 'OVER_0_5':
            statValue = `${totalGoals} / 1 Goal`;
            if (totalGoals >= 1) {
              liveStatus = 'HIT';
              progressPercent = 100;
              note = `Goal scored! Leg locked in WON 🟢 (${minute}')`;
              hitCount++;
              liveCount--;
            } else {
              liveStatus = 'LIVE_IN_PROGRESS';
              progressPercent = Math.min(90, Math.floor((minute || 0) * 0.9));
              note = `Goalless so far (${minute}'). Awaiting opening goal.`;
            }
            break;

          case 'OVER_1_5':
            statValue = `${totalGoals} / 2 Goals`;
            if (totalGoals >= 2) {
              liveStatus = 'HIT';
              progressPercent = 100;
              note = `2+ goals scored! Leg locked in WON 🟢 (${minute}')`;
              hitCount++;
              liveCount--;
            } else if (totalGoals === 1) {
              liveStatus = 'LIVE_WINNING';
              progressPercent = 70;
              note = `1 goal scored (${minute}'). 1 more needed!`;
            } else {
              liveStatus = 'LIVE_IN_PROGRESS';
              progressPercent = Math.floor((minute || 0) * 0.4);
              note = `Searching for opening goal (${minute}').`;
            }
            break;

          case 'OVER_2_5':
            statValue = `${totalGoals} / 3 Goals`;
            if (totalGoals >= 3) {
              liveStatus = 'HIT';
              progressPercent = 100;
              note = `Goal threshold achieved! WON 🟢 (${minute}')`;
              hitCount++;
              liveCount--;
            } else {
              liveStatus = totalGoals === 2 ? 'LIVE_WINNING' : 'LIVE_IN_PROGRESS';
              progressPercent = Math.min(95, Math.floor((totalGoals / 3) * 100));
              note = `${totalGoals}/3 goals on the board (${minute}').`;
            }
            break;

          case 'OVER_5_5_CORNERS':
            statValue = `${corners} / 6 Corners`;
            if (corners >= 6) {
              liveStatus = 'HIT';
              progressPercent = 100;
              note = `Corner threshold hit (${corners} corners)! WON 🟢`;
              hitCount++;
              liveCount--;
            } else {
              liveStatus = 'LIVE_IN_PROGRESS';
              progressPercent = Math.floor((corners / 6) * 100);
              note = `${corners}/6 corners taken (${minute}').`;
            }
            break;

          case 'OVER_7_5_CORNERS':
            statValue = `${corners} / 8 Corners`;
            if (corners >= 8) {
              liveStatus = 'HIT';
              progressPercent = 100;
              note = `8 corners reached! WON 🟢`;
              hitCount++;
              liveCount--;
            } else {
              liveStatus = 'LIVE_IN_PROGRESS';
              progressPercent = Math.floor((corners / 8) * 100);
              note = `${corners}/8 corners taken (${minute}').`;
            }
            break;

          case 'OVER_2_5_CARDS':
            statValue = `${cards} / 3 Cards`;
            if (cards >= 3) {
              liveStatus = 'HIT';
              progressPercent = 100;
              note = `3+ disciplinary bookings issued! WON 🟢`;
              hitCount++;
              liveCount--;
            } else {
              liveStatus = 'LIVE_IN_PROGRESS';
              progressPercent = Math.floor((cards / 3) * 100);
              note = `${cards}/3 cards issued by referee (${minute}').`;
            }
            break;

          case 'DOUBLE_CHANCE_1X':
            statValue = `Score: ${homeScore}-${awayScore}`;
            if (homeScore >= awayScore) {
              liveStatus = 'LIVE_WINNING';
              progressPercent = Math.min(95, 60 + Math.floor((minute || 0) * 0.35));
              note = `Currently in winning position (${homeScore}-${awayScore} at ${minute}') 🟡`;
            } else {
              liveStatus = 'LIVE_IN_PROGRESS';
              progressPercent = 35;
              note = `Currently trailing (${homeScore}-${awayScore} at ${minute}'). Needs equalizer.`;
            }
            break;

          case 'DOUBLE_CHANCE_X2':
            statValue = `Score: ${homeScore}-${awayScore}`;
            if (awayScore >= homeScore) {
              liveStatus = 'LIVE_WINNING';
              progressPercent = Math.min(95, 60 + Math.floor((minute || 0) * 0.35));
              note = `Currently in winning position (${homeScore}-${awayScore} at ${minute}') 🟡`;
            } else {
              liveStatus = 'LIVE_IN_PROGRESS';
              progressPercent = 35;
              note = `Currently trailing (${homeScore}-${awayScore} at ${minute}').`;
            }
            break;

          case 'HOME_WIN':
            statValue = `Score: ${homeScore}-${awayScore}`;
            if (homeScore > awayScore) {
              liveStatus = 'LIVE_WINNING';
              progressPercent = Math.min(95, 50 + Math.floor((minute || 0) * 0.45));
              note = `Home team leading (${homeScore}-${awayScore} at ${minute}') 🟢`;
            } else {
              liveStatus = 'LIVE_IN_PROGRESS';
              progressPercent = 30;
              note = `Home team level or behind (${homeScore}-${awayScore} at ${minute}').`;
            }
            break;

          default:
            liveStatus = 'LIVE_IN_PROGRESS';
            progressPercent = Math.floor((minute || 0) * 0.8);
            note = `Match in progress (${minute}').`;
            break;
        }
      } else {
        pendingCount++;
        liveStatus = 'PENDING';
        progressPercent = 0;
        note = `Kickoff scheduled for ${leg.kickoff || 'today'}`;
      }

      updatedLegs.push({
        ...leg,
        liveStatus,
        currentMatchMinute: minute,
        matchStatus,
        liveScore: `${homeScore} - ${awayScore}`,
        liveStatValue: statValue,
        targetMetric: this.formatTargetMetric(leg),
        progressPercent: Math.min(100, Math.max(0, progressPercent)),
        note,
      });
    }

    // Determine overall parlay status
    let overallStatus: LiveTrackedParlay['overallStatus'] = 'PENDING';
    if (missedCount > 0) {
      overallStatus = 'BUSTED';
    } else if (hitCount === tracked.totalLegs) {
      overallStatus = 'WON';
    } else if (liveCount > 0 || hitCount > 0) {
      overallStatus = 'ACTIVE_LIVE';
    }

    // Dynamic cashout equity estimation
    let remainingEquity = 1.0;
    for (const l of updatedLegs) {
      if (l.liveStatus === 'HIT') {
        remainingEquity *= 1.0;
      } else if (l.liveStatus === 'MISS') {
        remainingEquity = 0;
        break;
      } else if (l.liveStatus === 'LIVE_WINNING') {
        remainingEquity *= Math.min(0.98, l.estimatedProbability * 1.15);
      } else {
        remainingEquity *= l.estimatedProbability;
      }
    }

    const updatedTracked: LiveTrackedParlay = {
      ...tracked,
      overallStatus,
      legsHitCount: hitCount,
      legsPendingCount: pendingCount,
      legsLiveCount: liveCount,
      legsMissedCount: missedCount,
      liveLegs: updatedLegs,
      cashoutProbabilityIndex: Number(remainingEquity.toFixed(4)),
      lastUpdated: new Date().toISOString(),
    };

    this.trackedParlays.set(parlayId, updatedTracked);
    return updatedTracked;
  }

  /**
   * Advances the simulated live match ticker for interactive UI motion demonstration
   */
  public async advanceSimulationTick(parlayId: string): Promise<LiveTrackedParlay> {
    const current = this.simulationTicks.get(parlayId) || 0;
    const nextTick = current >= 90 ? 15 : current + 15;
    this.simulationTicks.set(parlayId, nextTick);
    return await this.evaluateParlayProgress(parlayId);
  }

  public getTrackedParlays(): LiveTrackedParlay[] {
    return Array.from(this.trackedParlays.values()).reverse();
  }

  public getTrackedParlay(id: string): LiveTrackedParlay | undefined {
    return this.trackedParlays.get(id);
  }

  private formatTargetMetric(leg: ParlayLeg): string {
    switch (leg.market) {
      case 'OVER_0_5': return 'Needs ≥ 1 Match Goal';
      case 'OVER_1_5': return 'Needs ≥ 2 Match Goals';
      case 'OVER_2_5': return 'Needs ≥ 3 Match Goals';
      case 'UNDER_2_5': return 'Needs ≤ 2 Match Goals';
      case 'OVER_5_5_CORNERS': return 'Needs ≥ 6 Corners';
      case 'OVER_7_5_CORNERS': return 'Needs ≥ 8 Corners';
      case 'OVER_8_5_CORNERS': return 'Needs ≥ 9 Corners';
      case 'UNDER_11_5_CORNERS': return 'Needs ≤ 11 Corners';
      case 'OVER_2_5_CARDS': return 'Needs ≥ 3 Cards';
      case 'OVER_3_5_CARDS': return 'Needs ≥ 4 Cards';
      case 'UNDER_5_5_CARDS': return 'Needs ≤ 5 Cards';
      case 'DOUBLE_CHANCE_1X': return 'Needs Home Win or Draw';
      case 'DOUBLE_CHANCE_X2': return 'Needs Away Win or Draw';
      case 'HOME_WIN': return 'Needs Home Team Win';
      case 'AWAY_WIN': return 'Needs Away Team Win';
      case 'BTTS_YES': return 'Needs Both Teams to Score';
      default: return leg.marketLabel || leg.selection;
    }
  }
}
