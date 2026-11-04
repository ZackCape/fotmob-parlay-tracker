import { evaluateActualOutcome } from '../engine/market-calculator.js';
export class SettlementService {
    factory;
    settled = new Set(); // idempotency keys
    constructor(factory) {
        this.factory = factory;
    }
    async settleParlay(parlay) {
        const results = [];
        for (let i = 0; i < parlay.parlay.legs.length; i++) {
            const leg = parlay.parlay.legs[i];
            const key = `${parlay.parlayId}:${i}:${leg.fixtureId}:${leg.market}`;
            if (this.settled.has(key)) {
                // already processed; skip
                continue;
            }
            let fixture = null;
            let source = 'unavailable';
            try {
                const details = await this.factory.getMatchDetails(leg.fixtureId);
                fixture = details?.fixture || null;
                source = details?.fixture?.dataSource || source;
            }
            catch {
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
            const outcome = evaluateActualOutcome(leg.market, fixture);
            this.settled.add(key);
            results.push({ parlayId: parlay.parlayId, legIndex: i, fixtureId: leg.fixtureId, market: leg.market, outcome: outcome, source, settledAt: new Date().toISOString() });
        }
        return results;
    }
}
