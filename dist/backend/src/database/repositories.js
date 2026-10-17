import { getDatabase } from './db.js';
export class PredictionRepository {
    db = getDatabase();
    async savePrediction(pred) {
        const sql = `
      INSERT INTO predictions (
        id, fixture_id, league, market, market_label, selection,
        estimated_probability, raw_probability, confidence_lower, confidence_upper,
        supporting_statistics, sample_size, data_freshness_days, risk_factors, actual_outcome
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
    `;
        await this.db.query(sql, [
            pred.id,
            pred.fixtureId,
            pred.league,
            pred.market,
            pred.marketLabel,
            pred.selection,
            pred.estimatedProbability,
            pred.rawProbability,
            pred.confidenceLower,
            pred.confidenceUpper,
            JSON.stringify(pred.supportingStatistics),
            pred.sampleSize,
            pred.dataFreshnessDays,
            pred.riskFactors,
            pred.actualOutcome || 'PENDING',
        ]);
    }
    async getAllPredictions() {
        const sql = `SELECT * FROM predictions ORDER BY created_at DESC`;
        const res = await this.db.query(sql);
        return res.rows.map(r => ({
            id: r.id,
            fixtureId: r.fixture_id,
            league: r.league,
            fixtureDescription: `${r.fixture_id}`,
            kickoff: '',
            market: r.market,
            marketLabel: r.market_label,
            selection: r.selection,
            estimatedProbability: parseFloat(r.estimated_probability),
            rawProbability: parseFloat(r.raw_probability),
            confidenceLower: parseFloat(r.confidence_lower),
            confidenceUpper: parseFloat(r.confidence_upper),
            supportingStatistics: typeof r.supporting_statistics === 'string' ? JSON.parse(r.supporting_statistics) : r.supporting_statistics,
            sampleSize: r.sample_size,
            dataFreshnessDays: r.data_freshness_days,
            riskFactors: r.risk_factors || [],
            actualOutcome: r.actual_outcome,
        }));
    }
}
export class ParlayRepository {
    db = getDatabase();
    async saveParlay(parlay) {
        const sql = `
      INSERT INTO parlays (
        id, target_legs_count, actual_legs_count, status, combined_probability,
        compound_odds_decimal, legs, correlation_explanation, independence_assumptions, risk_warning
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    `;
        await this.db.query(sql, [
            parlay.id,
            parlay.targetLegsCount,
            parlay.actualLegsCount,
            parlay.status,
            parlay.combinedProbability,
            parlay.compoundOddsDecimal,
            JSON.stringify(parlay.legs),
            parlay.correlationExplanation,
            parlay.independenceAssumptions,
            parlay.riskWarning,
        ]);
    }
    async getRecentParlays() {
        const sql = `SELECT * FROM parlays ORDER BY created_at DESC LIMIT 20`;
        const res = await this.db.query(sql);
        return res.rows.map(r => ({
            id: r.id,
            targetLegsCount: r.target_legs_count,
            actualLegsCount: r.actual_legs_count,
            status: r.status,
            message: `Saved ${r.target_legs_count}-leg parlay`,
            legs: typeof r.legs === 'string' ? JSON.parse(r.legs) : r.legs,
            combinedProbability: parseFloat(r.combined_probability),
            compoundOddsDecimal: parseFloat(r.compound_odds_decimal),
            correlationExplanation: r.correlation_explanation,
            independenceAssumptions: r.independence_assumptions,
            riskWarning: r.risk_warning,
            generatedAt: r.created_at,
        }));
    }
}
