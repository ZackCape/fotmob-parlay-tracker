import { DataProviderFactory } from '../providers/provider-factory.js';
import { evaluateActualOutcome } from '../engine/market-calculator.js';
import { LiveTrackedParlay, MarketPrediction } from '../types/football.js';

export interface SettlementResult {
  parlayId: string;
  legIndex: number;
  fixtureId: string;
  market: string;
  outcome: 'HIT' | 'MISS' | 'VOID' | 'PENDING';
  source: string;
  settledAt: string;
}

export class SettlementService {
  private factory: DataProviderFactory;
  private settled = new Set<string>(); // idempotency keys

  constructor(factory: DataProviderFactory) {
    this.factory = factory;
  }

  async settleParlay(parlay: LiveTrackedParlay): Promise<SettlementResult[]> {
    const results: SettlementResult[] = [];
    for (let i = 0; i < parlay.parlay.legs.length; i++) {
      const leg = parlay.parlay.legs[i];
      const key = `${parlay.parlayId}:${i}:${leg.fixtureId}:${leg.market}`;
      if (this.settled.has(key)) {
        // already processed; skip
        continue;
      }
      let fixture: any = null;
      let source = 'unavailable';
      try {
        const details = await this.factory.getMatchDetails(leg.fixtureId);
        fixture = details?.fixture || null;
        source = details?.fixture?.dataSource || source;
      } catch {
        fixture = null;
      }

      // Never settle from synthetic/archive fixtures
      if (fixture && /archive|calendar|historical|offline/i.test(fixture.dataSource || '')) {
        results.push({ parlayId: parlay.parlayId, legIndex: i, fixtureId: leg.fixtureId, market: leg.market, outcome: 'PENDING', source: 'archive_rejected', settledAt: new Date().toISOString() });
        continue;
      }

      if (!fixture || fixture.homeScore === null || fixture.awayScore === null) {
        // postponed/cancelled?
        if (fixture?.status === 'POSTPONED' || fixture?.status === 'CANCELLED') {
          const outcome = 'VOID';
          this.settled.add(key);
          results.push({ parlayId: parlay.parlayId, legIndex: i, fixtureId: leg.fixtureId, market: leg.market, outcome, source, settledAt: new Date().toISOString() });
          continue;
        }
        results.push({ parlayId: parlay.parlayId, legIndex: i, fixtureId: leg.fixtureId, market: leg.market, outcome: 'PENDING', source, settledAt: new Date().toISOString() });
        continue;
      }

      const outcome = evaluateActualOutcome(leg.market as any, fixture);
      this.settled.add(key);
      results.push({ parlayId: parlay.parlayId, legIndex: i, fixtureId: leg.fixtureId, market: leg.market, outcome: outcome as any, source, settledAt: new Date().toISOString() });
    }
    return results;
  }
}