import { IFootballDataProvider, ProviderHealth } from './provider-interface.js';
import { ApiFootballAdapter } from './api-football-adapter.js';
import { FootballDataOrgAdapter } from './football-data-adapter.js';
import { FotmobAdapter } from './fotmob-adapter.js';
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
  private fotmobProvider: IFootballDataProvider;
  private fallbackProvider: IFootballDataProvider;
  private adaptiveLearning: AdaptiveLearningEngine;
  private cache = new Map<string, CacheEntry<any>>();
  private defaultTtlMs: number;

  constructor(config: AppConfig, learningEngine?: AdaptiveLearningEngine) {
    this.adaptiveLearning = learningEngine || new AdaptiveLearningEngine();
    this.fallbackProvider = new VerifiedArchiveAdapter(this.adaptiveLearning);
    this.fotmobProvider = new FotmobAdapter(this.adaptiveLearning);
    this.defaultTtlMs = config.cacheTtlMinutes * 60 * 1000;

    // Invalidate match details cache when engine learns from a finished match!
    this.adaptiveLearning.subscribe(() => {
      this.cache.clear();
    });

    if (config.dataProvider === 'api-football' && config.apiFootballKey) {
      this.primaryProvider = new ApiFootballAdapter(config.apiFootballKey);
    } else if (config.dataProvider === 'football-data' && config.footballDataOrgKey) {
      this.primaryProvider = new FootballDataOrgAdapter(config.footballDataOrgKey);
    } else if (config.dataProvider === 'fotmob') {
      this.primaryProvider = this.fotmobProvider;
    } else if (config.dataProvider === 'auto') {
      if (config.apiFootballKey) {
        this.primaryProvider = new ApiFootballAdapter(config.apiFootballKey);
      } else {
        // In auto mode without paid API key, use FotMob live adapter with verified fallback!
        this.primaryProvider = this.fotmobProvider;
      }
    } else {
      this.primaryProvider = this.fallbackProvider;
    }
  }

  public getLearningEngine(): AdaptiveLearningEngine {
    return this.adaptiveLearning;
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
    const cached = this.getCached<Fixture[]>(cacheKey);
    if (cached) return cached;

    let fixtures: Fixture[] = [];
    try {
      if (this.primaryProvider !== this.fallbackProvider) {
        fixtures = await this.primaryProvider.getFixturesByDate(date, league);
      }
    } catch (e: any) {
      console.warn(`[DataProviderFactory] Primary provider failed: ${e.message}`);
    }

    // Fall back to verified archive if primary returned empty
    if (fixtures.length === 0) {
      fixtures = await this.fallbackProvider.getFixturesByDate(date, league);
    }

    this.setCache(cacheKey, fixtures);
    return fixtures;
  }

  async getMatchDetails(fixtureId: string): Promise<MatchAnalysis | null> {
    const cacheKey = `match:${fixtureId}`;
    const cached = this.getCached<MatchAnalysis>(cacheKey);
    if (cached) return cached;

    let details: MatchAnalysis | null = null;
    try {
      if (this.primaryProvider !== this.fallbackProvider) {
        details = await this.primaryProvider.getMatchDetails(fixtureId);
      }
    } catch (e: any) {
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

  async getHealth(): Promise<{ primary: ProviderHealth; fotmob: ProviderHealth; fallback: ProviderHealth; cacheSize: number }> {
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
