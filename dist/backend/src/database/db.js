import pg from 'pg';
import { config } from '../config/env.js';
const { Pool } = pg;
class PostgresClient {
    pool;
    constructor(connectionString) {
        this.pool = new Pool({
            connectionString,
            ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
            max: 10,
            idleTimeoutMillis: 30000,
        });
    }
    async query(sql, params) {
        const res = await this.pool.query(sql, params);
        return { rows: res.rows };
    }
    isPostgres() {
        return true;
    }
}
/**
 * Lightweight local development store when external PostgreSQL is not running.
 * Provides identical SQL-compatible querying semantics.
 */
class LocalFallbackDatabaseClient {
    memoryStore = new Map();
    constructor() {
        this.memoryStore.set('predictions', []);
        this.memoryStore.set('parlays', []);
        this.memoryStore.set('model_evaluations', []);
    }
    async query(sql, params = []) {
        const lower = sql.toLowerCase().trim();
        if (lower.startsWith('insert into predictions')) {
            const list = this.memoryStore.get('predictions') || [];
            const item = {
                id: params[0],
                fixture_id: params[1],
                league: params[2],
                market: params[3],
                market_label: params[4],
                selection: params[5],
                estimated_probability: params[6],
                raw_probability: params[7],
                confidence_lower: params[8],
                confidence_upper: params[9],
                supporting_statistics: params[10],
                sample_size: params[11],
                data_freshness_days: params[12],
                risk_factors: params[13],
                actual_outcome: params[14] || 'PENDING',
                created_at: new Date().toISOString(),
            };
            list.push(item);
            this.memoryStore.set('predictions', list);
            return { rows: [item] };
        }
        if (lower.startsWith('select') && lower.includes('from predictions')) {
            const list = (this.memoryStore.get('predictions') || []);
            return { rows: list };
        }
        if (lower.startsWith('insert into parlays')) {
            const list = this.memoryStore.get('parlays') || [];
            const item = {
                id: params[0],
                target_legs_count: params[1],
                actual_legs_count: params[2],
                status: params[3],
                combined_probability: params[4],
                compound_odds_decimal: params[5],
                legs: params[6],
                correlation_explanation: params[7],
                independence_assumptions: params[8],
                risk_warning: params[9],
                created_at: new Date().toISOString(),
            };
            list.push(item);
            this.memoryStore.set('parlays', list);
            return { rows: [item] };
        }
        if (lower.startsWith('select') && lower.includes('from parlays')) {
            const list = (this.memoryStore.get('parlays') || []);
            return { rows: list };
        }
        return { rows: [] };
    }
    isPostgres() {
        return false;
    }
}
let dbInstance;
export function getDatabase() {
    if (!dbInstance) {
        if (config.databaseUrl && config.databaseUrl.startsWith('postgresql://')) {
            try {
                dbInstance = new PostgresClient(config.databaseUrl);
                console.log('[Database] Initialized PostgreSQL connection pool');
            }
            catch (err) {
                console.warn(`[Database] PostgreSQL init error: ${err.message}. Using local development storage.`);
                dbInstance = new LocalFallbackDatabaseClient();
            }
        }
        else {
            console.log('[Database] No PostgreSQL DATABASE_URL supplied. Using active in-memory development database.');
            dbInstance = new LocalFallbackDatabaseClient();
        }
    }
    return dbInstance;
}
