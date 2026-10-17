import fs from 'node:fs';
import nodePath from 'node:path';
import { IFootballDataProvider, ProviderHealth } from './provider-interface.js';
import { ApiFootballAdapter } from './api-football-adapter.js';
import { FootballDataOrgAdapter } from './football-data-adapter.js';
import { FotmobAdapter } from './fotmob-adapter.js';
import { FootballDatabaseAdapter, FootballNewsArticle } from './footballdatabase-adapter.js';
import { OpenFootballGitHubAdapter } from './openfootball-github-adapter.js';
import { EspnAdapter } from './espn-adapter.js';
import { TheOddsAdapter } from './theodds-adapter.js';
import { TheSportsDBAdapter } from './thesportsdb-adapter.js';
import { OpenLigaDBAdapter } from './openligadb-adapter.js';
import { FootballDataUkAdapter } from './football-data-uk-adapter.js';
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
  private thesportsdbProvider: TheSportsDBAdapter;
  private openligadbProvider: OpenLigaDBAdapter;
  private footballDataUkProvider: FootballDataUkAdapter;
  private openfootballGitHubProvider: OpenFootballGitHubAdapter;
  private espnProvider: EspnAdapter;
  private oddsAdapter: TheOddsAdapter | null;
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
    this.thesportsdbProvider = new TheSportsDBAdapter();
    this.openligadbProvider = new OpenLigaDBAdapter();
    this.footballDataUkProvider = new FootballDataUkAdapter();
    this.openfootballGitHubProvider = new OpenFootballGitHubAdapter();
    this.espnProvider = new EspnAdapter();
    this.oddsAdapter = config.theOddsApiKey ? new TheOddsAdapter(config.theOddsApiKey, config.theOddsApiRegions, config.theOddsApiMonthlyLimit, config.theOddsApiSafetyReserve) : null;
    this.backupProvider = config.footballDataOrgKey ? new FootballDataOrgAdapter(config.footballDataOrgKey) : null;
    this.defaultTtlMs = config.cacheTtlMinutes * 60 * 1000;

    // Invalidate match details cache when engine learns from a finished match!
    this.adaptiveLearning.subscribe(() => {
      this.cache.clear();
    });

    if (config.dataProvider === 'api-football' && config.apiFootballKey) {
      this.primaryProvider = new ApiFootballAdapter(config.apiFootballKeys && config.apiFootballKeys.length ? config.apiFootballKeys : config.apiFootballKey, false, config.apiFootballDailyLimit, config.apiFootballSafetyMargin);
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
        this.primaryProvider = new ApiFootballAdapter(config.apiFootballKeys && config.apiFootballKeys.length ? config.apiFootballKeys : config.apiFootballKey, false, config.apiFootballDailyLimit, config.apiFootballSafetyMargin);
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

  public async getOddsForFixture(fixture: Fixture): Promise<any> {
    if (!this.oddsAdapter) return null;
    return this.oddsAdapter.getOddsForFixture(fixture);
  }

  public getOddsUsage() {
    if (!this.oddsAdapter) return null;
    return this.oddsAdapter.getUsage();
  }

  public isOddsConfigured(): boolean {
    return Boolean(this.oddsAdapter);
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

  private readonly FILE_CACHE = nodePath.resolve(process.cwd(), 'data', 'fixtures_cache.json');
  private readJsonCache(): { data: any; cachedAt: number } | null {
    if (process.env.NODE_ENV !== 'production') return null;
    try {
      if (!fs.existsSync(this.FILE_CACHE)) return null;
      const raw = JSON.parse(fs.readFileSync(this.FILE_CACHE, 'utf8'));
      if (!raw || !raw.cachedAt || !raw.data) return null;
      if (Date.now() - raw.cachedAt > 30 * 60 * 1000) return null;
      return raw;
    } catch { return null; }
  }
  private writeJsonCache(data: any) {
    if (process.env.NODE_ENV !== 'production') return;
    try {
      fs.mkdirSync(nodePath.dirname(this.FILE_CACHE), { recursive: true });
      fs.writeFileSync(this.FILE_CACHE, JSON.stringify({ cachedAt: Date.now(), data }));
    } catch {}
  }

  async getFixturesByDate(date: string, league: string = 'ALL'): Promise<Fixture[]> {
    const cacheKey = `fixtures:${date}:${league}`;
    const inflightKey = `inflight:${cacheKey}`;
    if (this.inFlight.has(inflightKey)) {
      return this.inFlight.get(inflightKey) as Promise<Fixture[]>;
    }

    const promise = (async () => {
      if (this.config.dataProvider === 'verified-archive') {
        const fx = await this.fallbackProvider.getFixturesByDate(date, league);
        if (fx.length > 0) this.setCache(cacheKey, fx);
        return fx;
      }
      if (this.config.dataProvider === 'openfootball') {
        const fx = await this.openfootballProvider.getFixturesByDate(date, league);
        if (fx.length > 0) this.setCache(cacheKey, fx);
        return fx;
      }
      // a) File cache (30-min TTL)
      const fc = this.readJsonCache();
      if (fc && Array.isArray(fc.data)) {
        // Purge synthetic archive entries from cache immediately
        const cleaned = fc.data.filter((f: any) => !/archive|calendar|historical|offline/i.test(f.dataSource || ''));
        if (cleaned.length !== fc.data.length) {
          console.warn(`[Factory] purged ${fc.data.length - cleaned.length} synthetic fixtures from file cache`);
          this.writeJsonCache(cleaned);
        }
        const filtered = cleaned.filter((f: any) => (league === 'ALL' || f.league === league) && f.date === date);
        if (filtered.length > 0) {
          console.info(`[Factory] file cache HIT ${date} ${league}`);
          return filtered;
        }
      }
      // memory cache
      const cached = this.getCached<Fixture[]>(cacheKey);
      if (cached) { console.info(`[Factory] mem cache HIT fixtures ${date} ${league}`); return cached; }
      console.info(`[Factory] cache MISS fixtures ${date} ${league}`);

      let fixtures: Fixture[] = [];
      const wantGerman = league === 'ALL' || league === 'BUNDESLIGA' || league === 'BUNDESLIGA2';

      // b) ESPN public scoreboard - all major global leagues, live scores, no API key
      try {
        const espn = await this.espnProvider.getFixturesByDate(date, league);
        if (espn.length > 0) fixtures.push(...espn);
        console.info(`[Factory] ESPN returned ${espn.length} fixtures for ${date}`);
      } catch (e: any) { console.warn('[Factory] ESPN failed:', e.message); }

      // c) Football-Data.org for main leagues
      if (fixtures.length === 0 && this.backupProvider && !(this.backupProvider.isQuotaExhausted?.() ?? false) && !(this.backupProvider.isInCooldown?.() ?? false)) {
        try {
          const fd = await this.backupProvider.getFixturesByDate(date, league);
          if (fd.length > 0) fixtures.push(...fd);
        } catch (e: any) { console.warn('[Factory] Football-Data failed:', e.message); }
      }

      // d) OpenLigaDB (German specialist)
      if (fixtures.length === 0 && wantGerman) {
        try {
          const g = await this.openligadbProvider.getFixturesByDate(date, league);
          if (g.length > 0) fixtures.push(...g);
        } catch (e: any) { console.warn('[Factory] OpenLigaDB failed:', e.message); }
      }

      // e) TheSportsDB fallback if too few
      if (fixtures.length < 3) {
        try {
          const ts = await this.thesportsdbProvider.getFixturesByDate(date, league);
          const seen = new Set(fixtures.map(f => `${f.homeTeam.name}|${f.awayTeam.name}`));
          for (const t of ts) {
            if (!seen.has(`${t.homeTeam.name}|${t.awayTeam.name}`)) {
              fixtures.push(t);
              seen.add(`${t.homeTeam.name}|${t.awayTeam.name}`);
            }
          }
        } catch (e: any) { console.warn('[Factory] TheSportsDB failed:', e.message); }
      }

      // f) Football-Data.co.uk free CSV fallback
      if (fixtures.length === 0) {
        try {
          const fduk = await this.footballDataUkProvider.getFixturesByDate(date, league);
          if (fduk.length > 0) fixtures.push(...fduk);
        } catch (e: any) { console.warn('[Factory] FootballDataUk failed:', e.message); }
      }

      // g) OpenFootball static dataset fallback
      if (fixtures.length === 0) {
        try {
          const of = await this.openfootballGitHubProvider.getFixturesByDate(date, league);
          if (of.length > 0) fixtures.push(...of);
        } catch (e: any) { console.warn('[Factory] OpenFootball failed:', e.message); }
      }

      // Guardrail: never serve synthetic archive
      fixtures = fixtures.filter(f => !/archive|calendar|historical|offline/i.test(f.dataSource || ''));

      const retrievedAt = new Date().toISOString();
      fixtures = fixtures.map((f) => ({ ...f, retrievedAt })) as any;

      if (fixtures.length > 0) {
        this.setCache(cacheKey, fixtures);
        this.writeJsonCache(fixtures);
      }
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

      // ESPN fixtures: route directly to ESPN adapter (no API-Football quota consumed)
      if (fixtureId.startsWith('espn-')) {
        try {
          details = await this.espnProvider.getMatchDetails(fixtureId);
        } catch (e: any) {
          console.warn(`[Factory] ESPN details failed for ${fixtureId}:`, e.message);
        }
        if (details) {
          this.setCache(cacheKey, details);
        }
        return details;
      }

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
