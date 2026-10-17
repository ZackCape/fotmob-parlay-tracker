import { IFootballDataProvider, ProviderHealth } from './provider-interface.js';
import { ApiFootballAdapter } from './api-football-adapter.js';
import { FootballDataOrgAdapter } from './football-data-adapter.js';
import { FotmobAdapter } from './fotmob-adapter.js';
import { FootballDatabaseAdapter, FootballNewsArticle } from './footballdatabase-adapter.js';
import { OpenFootballAdapter } from './openfootball-adapter.js';
import { VerifiedArchiveAdapter } from './verified-archive-adapter.js';
import { AppConfig } from '../config/env.js';
import { Fixture, MatchAnalysis } from '../types/football.js';

import { AdaptiveLearningEngine } from '../engine/adaptive-learning.js';

interface CacheEntry<T> {
  data: T;
  cachedAt: number;
  ttlMs: number;
}

export class DataProviderFactory {
  private primaryProvider: IFootballDataProvider;
  private backupProvider: IFootballDataProvider | null;
  private fotmobProvider: IFootballDataProvider;
  private footballdatabaseProvider: FootballDatabaseAdapter;
  private openfootballProvider: OpenFootballAdapter;
  private config: AppConfig;
  private fallbackProvider: IFootballDataProvider;
  private adaptiveLearning: AdaptiveLearningEngine;
  private cache = new Map<string, CacheEntry<any>>();
  private inFlight = new Map<string, Promise<any>>();
  private defaultTtlMs: number;

  constructor(config: AppConfig, learningEngine?: AdaptiveLearningEngine) {
    this.config = config;
    this.adaptiveLearning = learningEngine || new AdaptiveLearningEngine();
    this.fallbackProvider = new VerifiedArchiveAdapter(this.adaptiveLearning);
    this.fotmobProvider = new FotmobAdapter(this.adaptiveLearning);
    this.footballdatabaseProvider = new FootballDatabaseAdapter(this.adaptiveLearning);
    this.openfootballProvider = new OpenFootballAdapter(config.openfootballDataDir);
    this.backupProvider = config.footballDataOrgKey ? new FootballDataOrgAdapter(config.footballDataOrgKey) : null;
    this.defaultTtlMs = config.cacheTtlMinutes * 60 * 1000;

    // Invalidate match details cache when engine learns from a finished match!
    this.adaptiveLearning.subscribe(() => {
      this.cache.clear();
    });

    if (config.dataProvider === 'api-football' && config.apiFootballKey) {
      this.primaryProvider = new ApiFootballAdapter(config.apiFootballKey, false, config.apiFootballDailyLimit, config.apiFootballSafetyMargin);
    } else if (config.dataProvider === 'football-data' && config.footballDataOrgKey) {
      this.primaryProvider = new FootballDataOrgAdapter(config.footballDataOrgKey);
    } else if (config.dataProvider === 'footballdatabase') {
      this.primaryProvider = this.footballdatabaseProvider;
    } else if (config.dataProvider === 'openfootball') {
      this.primaryProvider = this.openfootballProvider;
    } else if (config.dataProvider === 'fotmob') {
      // FotMob uses undocumented endpoints; not a required production dependency.
      // Fall back to offline verified archive instead.
      this.primaryProvider = this.fallbackProvider;
    } else if (config.dataProvider === 'auto') {
      if (config.apiFootballKey) {
        this.primaryProvider = new ApiFootballAdapter(config.apiFootballKey, false, config.apiFootballDailyLimit, config.apiFootballSafetyMargin);
      } else if (config.footballDataOrgKey) {
        this.primaryProvider = new FootballDataOrgAdapter(config.footballDataOrgKey);
      } else {
        // No official API key: use offline verified archive (no scraping/unofficial deps)
        this.primaryProvider = this.fallbackProvider;
      }
    } else {
      this.primaryProvider = this.fallbackProvider;
    }
  }

  public getLearningEngine(): AdaptiveLearningEngine {
    return this.adaptiveLearning;
  }

  public async getLatestNews(): Promise<FootballNewsArticle[]> {
    return this.footballdatabaseProvider.getLatestNews();
  }

  private getCached<T>(key: string): T | null {
    const entry = this.cache.get(key);
    if (!entry) return null;
    if (Date.now() - entry.cachedAt > entry.ttlMs) {
      this.cache.delete(key);
      return null;
    }
    return entry.data as T;
  }

  private setCache<T>(key: string, data: T, ttlMs: number = this.defaultTtlMs): void {
    this.cache.set(key, {
      data,
      cachedAt: Date.now(),
      ttlMs,
    });
  }

  async getFixturesByDate(date: string, league: string = 'ALL'): Promise<Fixture[]> {
    const cacheKey = `fixtures:${date}:${league}`;
    const inflightKey = `inflight:${cacheKey}`;
    if (this.inFlight.has(inflightKey)) {
      return this.inFlight.get(inflightKey) as Promise<Fixture[]>;
    }

    const promise = (async () => {
      const cached = this.getCached<Fixture[]>(cacheKey);
      if (cached) return cached;
      let fixtures: Fixture[] = [];
      let source = 'none';
      let fallbackReason: string | null = null;

      const primaryAvailable = !(this.primaryProvider.isQuotaExhausted?.() ?? false) && !(this.primaryProvider.isInCooldown?.() ?? false);
      if (primaryAvailable) {
        try {
          fixtures = await this.primaryProvider.getFixturesByDate(date, league);
          if (fixtures.length > 0) source = this.primaryProvider.name;
        } catch (e: any) {
          console.warn(`[DataProviderFactory] Primary provider failed: ${e.message}`);
          fallbackReason = 'primary_error';
        }
      } else {
        fallbackReason = 'primary_quota_or_cooldown';
      }

      if (fixtures.length === 0 && this.backupProvider && !(this.backupProvider.isQuotaExhausted?.() ?? false) && !(this.backupProvider.isInCooldown?.() ?? false)) {
        try {
          const backupFixtures = await this.backupProvider.getFixturesByDate(date, league);
          if (backupFixtures.length > 0) {
            fixtures = backupFixtures;
            source = this.backupProvider.name;
            fallbackReason = fallbackReason || 'primary_empty';
          }
        } catch (e: any) {
          console.warn(`[DataProviderFactory] Backup provider failed: ${e.message}`);
        }
      }

      if (fixtures.length === 0 && this.config.openfootballEnabled) {
        const today = new Date().toISOString().slice(0, 10);
        if (date < today) {
          const ofFixtures = await this.openfootballProvider.getFixturesByDate(date, league);
          if (ofFixtures.length > 0) {
            fixtures = ofFixtures;
            source = this.openfootballProvider.name;
            fallbackReason = fallbackReason || 'historical_fallback';
          }
        }
      }

      if (fixtures.length === 0) {
        fixtures = await this.fallbackProvider.getFixturesByDate(date, league);
        if (fixtures.length > 0) {
          source = this.fallbackProvider.name;
          fallbackReason = fallbackReason || 'offline_fallback';
        }
      }

      const retrievedAt = new Date().toISOString();
      fixtures = fixtures.map((f) => ({
        ...f,
        dataSource: f.dataSource || source,
        retrievedAt,
        fallbackReason: fallbackReason || undefined,
      })) as any;

      if (fixtures.length > 0) this.setCache(cacheKey, fixtures);
      return fixtures;
    })();

    this.inFlight.set(inflightKey, promise);
    promise.finally(() => this.inFlight.delete(inflightKey));
    return promise;
  }

  async getMatchDetails(fixtureId: string): Promise<MatchAnalysis | null> {
    const cacheKey = `match:${fixtureId}`;
    const cached = this.getCached<MatchAnalysis>(cacheKey);
    if (cached) return cached;

    const inflightKey = `inflight:${cacheKey}`;
    if (this.inFlight.has(inflightKey)) {
      return this.inFlight.get(inflightKey) as Promise<MatchAnalysis | null>;
    }

    const promise = (async () => {
      const cached = this.getCached<MatchAnalysis>(cacheKey);
      if (cached) return cached;

      let details: MatchAnalysis | null = null;
      const primaryAvailable = !(this.primaryProvider.isQuotaExhausted?.() ?? false) && !(this.primaryProvider.isInCooldown?.() ?? false);
      if (primaryAvailable) {
        try {
          details = await this.primaryProvider.getMatchDetails(fixtureId);
        } catch (e: any) {
          console.warn(`[DataProviderFactory] Primary details failed: ${e.message}`);
        }
      }
      if (!details && this.backupProvider && !(this.backupProvider.isQuotaExhausted?.() ?? false) && !(this.backupProvider.isInCooldown?.() ?? false)) {
        try {
          details = await this.backupProvider.getMatchDetails(fixtureId);
        } catch (e: any) {
          console.warn(`[DataProviderFactory] Backup details failed: ${e.message}`);
        }
      }
      if (!details) {
        details = await this.fallbackProvider.getMatchDetails(fixtureId);
      }
      if (details) {
        this.setCache(cacheKey, details);
      }
      return details;
    })();

    this.inFlight.set(inflightKey, promise);
    promise.finally(() => this.inFlight.delete(inflightKey));
    return promise;
  }

  async getHealth(): Promise<{ primary: ProviderHealth; fotmob: ProviderHealth; footballdatabase: ProviderHealth; fallback: ProviderHealth; cacheSize: number }> {
    const primaryHealth = await this.primaryProvider.getHealth();
    const fotmobHealth = await this.fotmobProvider.getHealth();
    const footballdatabaseHealth = await this.footballdatabaseProvider.getHealth();
    const fallbackHealth = await this.fallbackProvider.getHealth();
    return {
      primary: primaryHealth,
      fotmob: fotmobHealth,
      footballdatabase: footballdatabaseHealth,
      fallback: fallbackHealth,
      cacheSize: this.cache.size,
    };
  }
}
