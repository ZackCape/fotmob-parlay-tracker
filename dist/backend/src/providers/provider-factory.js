import { ApiFootballAdapter } from './api-football-adapter.js';
import { FootballDataOrgAdapter } from './football-data-adapter.js';
import { FotmobAdapter } from './fotmob-adapter.js';
import { VerifiedArchiveAdapter } from './verified-archive-adapter.js';
export class DataProviderFactory {
    primaryProvider;
    fotmobProvider;
    fallbackProvider;
    cache = new Map();
    defaultTtlMs;
    constructor(config) {
        this.fallbackProvider = new VerifiedArchiveAdapter();
        this.fotmobProvider = new FotmobAdapter();
        this.defaultTtlMs = config.cacheTtlMinutes * 60 * 1000;
        if (config.dataProvider === 'api-football' && config.apiFootballKey) {
            this.primaryProvider = new ApiFootballAdapter(config.apiFootballKey);
        }
        else if (config.dataProvider === 'football-data' && config.footballDataOrgKey) {
            this.primaryProvider = new FootballDataOrgAdapter(config.footballDataOrgKey);
        }
        else if (config.dataProvider === 'fotmob') {
            this.primaryProvider = this.fotmobProvider;
        }
        else if (config.dataProvider === 'auto') {
            if (config.apiFootballKey) {
                this.primaryProvider = new ApiFootballAdapter(config.apiFootballKey);
            }
            else {
                // In auto mode without paid API key, use FotMob live adapter with verified fallback!
                this.primaryProvider = this.fotmobProvider;
            }
        }
        else {
            this.primaryProvider = this.fallbackProvider;
        }
    }
    getCached(key) {
        const entry = this.cache.get(key);
        if (!entry)
            return null;
        if (Date.now() - entry.cachedAt > entry.ttlMs) {
            this.cache.delete(key);
            return null;
        }
        return entry.data;
    }
    setCache(key, data, ttlMs = this.defaultTtlMs) {
        this.cache.set(key, {
            data,
            cachedAt: Date.now(),
            ttlMs,
        });
    }
    async getFixturesByDate(date, league = 'ALL') {
        const cacheKey = `fixtures:${date}:${league}`;
        const cached = this.getCached(cacheKey);
        if (cached)
            return cached;
        let fixtures = [];
        try {
            if (this.primaryProvider !== this.fallbackProvider) {
                fixtures = await this.primaryProvider.getFixturesByDate(date, league);
            }
        }
        catch (e) {
            console.warn(`[DataProviderFactory] Primary provider failed: ${e.message}`);
        }
        // Fall back to verified archive if primary returned empty
        if (fixtures.length === 0) {
            fixtures = await this.fallbackProvider.getFixturesByDate(date, league);
        }
        this.setCache(cacheKey, fixtures);
        return fixtures;
    }
    async getMatchDetails(fixtureId) {
        const cacheKey = `match:${fixtureId}`;
        const cached = this.getCached(cacheKey);
        if (cached)
            return cached;
        let details = null;
        try {
            if (this.primaryProvider !== this.fallbackProvider) {
                details = await this.primaryProvider.getMatchDetails(fixtureId);
            }
        }
        catch (e) {
            console.warn(`[DataProviderFactory] Primary details failed: ${e.message}`);
        }
        if (!details) {
            details = await this.fallbackProvider.getMatchDetails(fixtureId);
        }
        if (details) {
            this.setCache(cacheKey, details);
        }
        return details;
    }
    async getHealth() {
        const primaryHealth = await this.primaryProvider.getHealth();
        const fotmobHealth = await this.fotmobProvider.getHealth();
        const fallbackHealth = await this.fallbackProvider.getHealth();
        return {
            primary: primaryHealth,
            fotmob: fotmobHealth,
            fallback: fallbackHealth,
            cacheSize: this.cache.size,
        };
    }
}
