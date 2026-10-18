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
import { OddsApiAdapter, DEFAULT_ODDS_REGIONS } from './odds-api-adapter.js';
import { PublicOddsAdapter } from './public-odds-adapter.js';
import { TheSportsDBAdapter } from './thesportsdb-adapter.js';
import { OpenLigaDBAdapter } from './openligadb-adapter.js';
import { FootballDataUkAdapter } from './football-data-uk-adapter.js';
import { OpenFootballAdapter } from './openfootball-adapter.js';
import { VerifiedArchiveAdapter } from './verified-archive-adapter.js';
import { AppConfig } from '../config/env.js';
import { Fixture, MatchAnalysis } from '../types/football.js';

import { AdaptiveLearningEngine } from '../engine/adaptive-learning.js';
import { isVerifiedFixture } from '../utils/fixtureValidation.js';
import { buildGenericAnalysis } from '../utils/genericAnalysis.js';

interface CacheEntry<T> {
  data: T;
  cachedAt: number;
  ttlMs: number;
}

/**
 * Short cache window for fixtures that are still moving.
 *
 * A fixture list for today carries live scores, live clocks and kick-off times
 * that can change minute by minute, and the Discord buttons re-request it on
 * every click. Caching it for the full analysis TTL (15 minutes by default)
 * would both serve stale scores and re-hit the providers on each cold click;
 * 30 seconds collapses a burst of clicks into a single upstream request while
 * still refreshing fast enough for a live scorecard.
 */
export const ACTIVE_FIXTURE_TTL_MS = 30_000;

/** How far either side of UTC midnight a date still counts as "today". */
const ACTIVE_DATE_WINDOW_MS = 36 * 60 * 60 * 1000;

/**
 * True when a fixture date can still change — i.e. it is today (within a
 * timezone-safe day either side) rather than a settled date in the past or a
 * distant date in the future.
 *
 * `date` is a provider `YYYY-MM-DD` string; anchors at midday UTC so a
 * timezone-shifted kick-off on the neighbouring day is still treated as active.
 * An unparseable date is treated as active, because caching volatile data for
 * longer than intended is the harmful failure mode.
 */
export function isActiveFixtureDate(date: string, now: number = Date.now()): boolean {
  const target = Date.parse(`${date}T12:00:00Z`);
  if (!Number.isFinite(target)) return true;
  return Math.abs(target - now) <= ACTIVE_DATE_WINDOW_MS;
}

/** Cache TTL for a fixture date: the short window when active, else the default. */
export function fixtureCacheTtlMs(
  date: string,
  defaultTtlMs: number,
  activeTtlMs: number = ACTIVE_FIXTURE_TTL_MS,
  now: number = Date.now(),
): number {
  return isActiveFixtureDate(date, now) ? activeTtlMs : defaultTtlMs;
}

/**
 * Extract h2h (moneyline) decimal prices from a The Odds API snapshot.
 * Returns nulls for any outcome the snapshot did not price.
 */
function extractH2hPrices(snapshot: any): { home: number | null; draw: number | null; away: number | null } {
  if (!snapshot) return { home: null, draw: null, away: null };
  let market: any = null;
  for (const b of snapshot.bookmakers || []) {
    const m = (b.markets || []).find((mk: any) => mk.key === 'h2h');
    if (m) { market = m; break; }
  }
  if (!market) return { home: null, draw: null, away: null };
  const safe = (v: any) => (typeof v === 'number' && isFinite(v) && v > 0 ? v : null);
  return {
    home: safe(market.outcomes?.find((o: any) => o.name === snapshot.homeTeam)?.price),
    away: safe(market.outcomes?.find((o: any) => o.name === snapshot.awayTeam)?.price),
    draw: safe(market.outcomes?.find((o: any) => /draw/i.test(o.name))?.price),
  };
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
  private publicOddsAdapter: PublicOddsAdapter;
  private config: AppConfig;
  private fallbackProvider: IFootballDataProvider;
  private adaptiveLearning: AdaptiveLearningEngine;
  private cache = new Map<string, CacheEntry<any>>();
  private inFlight = new Map<string, Promise<any>>();
  private defaultTtlMs: number;
  /** Short TTL used for fixture data that is still live (see ACTIVE_FIXTURE_TTL_MS). */
  private activeTtlMs: number = ACTIVE_FIXTURE_TTL_MS;

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
    // Tier 1: The Odds API (multi-region eu,uk,us + markets h2h,totals,spreads).
    this.oddsAdapter = config.theOddsApiKey
      ? new OddsApiAdapter(
          config.theOddsApiKey,
          config.theOddsApiRegions && config.theOddsApiRegions !== 'uk' ? config.theOddsApiRegions : DEFAULT_ODDS_REGIONS,
          config.theOddsApiMonthlyLimit,
          config.theOddsApiSafetyReserve,
        )
      : null;
    // Tier 2: zero-quota public odds cache.
    this.publicOddsAdapter = new PublicOddsAdapter();
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

  /**
   * Fetch raw ESPN match statistics (incl. key events) for a live event by raw
   * ESPN event id (no `espn-` prefix). Used by the live-event alert worker so
   * it can poll goals/cards without running the full Dixon-Coles analysis.
   */
  public async getEspnMatchStats(eventId: string) {
    return this.espnProvider.getMatchStats(eventId);
  }

  public async getLatestNews(): Promise<FootballNewsArticle[]> {
    return this.footballdatabaseProvider.getLatestNews();
  }

  public async getOddsForFixture(fixture: Fixture): Promise<any> {
    if (!this.oddsAdapter) return null;
    const snap = await this.oddsAdapter.getOddsForFixture(fixture);
    // Self-populate the Tier-2 zero-quota cache whenever Tier 1 succeeds.
    if (snap) {
      try { this.publicOddsAdapter.saveFromSnapshots([snap]); } catch { /* best-effort */ }
    }
    return snap;
  }

  public getOddsUsage() {
    if (!this.oddsAdapter) return null;
    return this.oddsAdapter.getUsage();
  }

  public isOddsConfigured(): boolean {
    return Boolean(this.oddsAdapter);
  }

  public isPublicOddsAvailable(): boolean {
    return this.publicOddsAdapter.isAvailable();
  }

  /**
   * Hybrid multi-tier odds resolution.
   *
   *   Tier 1 — The Odds API live bookmaker consensus (if key present + budget).
   *   Tier 2 — Zero-quota public odds cache (`data/odds_cache.json`).
   *   Tier 3 — No bookmaker line; caller derives calibrated fair odds (1 / P).
   *
   * Always returns a tier so the surface can explain *why* a price is shown,
   * and never throws: an unavailable tier simply falls through.
   */
  public async resolveOdds(fixture: Fixture): Promise<{
    tier: 1 | 2 | 3;
    source: 'bookmaker' | 'public-cache' | 'model';
    odds: any | null;
    home: number | null;
    draw: number | null;
    away: number | null;
    reason: string;
  }> {
    // --- Tier 1 ---
    if (this.oddsAdapter) {
      try {
        const snap = await this.oddsAdapter.getOddsForFixture(fixture);
        const prices = extractH2hPrices(snap);
        if (snap && (prices.home !== null || prices.draw !== null || prices.away !== null)) {
          try { this.publicOddsAdapter.saveFromSnapshots([snap]); } catch { /* best-effort */ }
          return { tier: 1, source: 'bookmaker', odds: snap, ...prices, reason: 'ok' };
        }
        const usage = this.oddsAdapter.getUsage();
        if (usage && usage.used >= usage.limit - usage.reserve) {
          // fall through to Tier 2 / 3
          return this.finishOddsFallback(fixture, 'quota_exhausted');
        }
      } catch {
        return this.finishOddsFallback(fixture, 'odds_api_error');
      }
    }

    // --- Tier 2 ---
    const cached = this.publicOddsAdapter.getOddsForFixture(fixture);
    if (cached && (cached.home !== null || cached.draw !== null || cached.away !== null)) {
      return {
        tier: 2,
        source: 'public-cache',
        odds: null,
        home: cached.home,
        draw: cached.draw,
        away: cached.away,
        reason: 'bookmaker_unavailable_using_cache',
      };
    }

    // --- Tier 3 ---
    return {
      tier: 3,
      source: 'model',
      odds: null,
      home: null,
      draw: null,
      away: null,
      reason: this.oddsAdapter ? 'no_odds_found' : 'odds_provider_not_configured',
    };
  }

  private finishOddsFallback(fixture: Fixture, reason: string) {
    const cached = this.publicOddsAdapter.getOddsForFixture(fixture);
    if (cached && (cached.home !== null || cached.draw !== null || cached.away !== null)) {
      return {
        tier: 2 as const,
        source: 'public-cache' as const,
        odds: null,
        home: cached.home,
        draw: cached.draw,
        away: cached.away,
        reason,
      };
    }
    return {
      tier: 3 as const,
      source: 'model' as const,
      odds: null,
      home: null,
      draw: null,
      away: null,
      reason,
    };
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

  /** Cache TTL for a fixture date: 30s while the date's fixtures can still change. */
  private ttlForFixtureDate(date: string): number {
    return fixtureCacheTtlMs(date, this.defaultTtlMs, this.activeTtlMs);
  }

  /**
   * Look a fixture up in the in-memory fixture lists only (no network, no file
   * reads). Used to decide whether a match analysis should be cached for the
   * short active window because the match is in play.
   */
  private cachedFixtureById(fixtureId: string): Fixture | null {
    for (const [key, entry] of this.cache.entries()) {
      if (!key.startsWith('fixtures:')) continue;
      const list = entry.data as Fixture[];
      if (!Array.isArray(list)) continue;
      const hit = list.find(f => f && f.id === fixtureId);
      if (hit) return hit;
    }
    return null;
  }

  /**
   * Cache TTL for a match analysis. A live match is re-analysed on the short
   * active window so its scorecard, clock and statistics keep moving; anything
   * else keeps the configured analysis TTL.
   */
  private matchTtlMs(fixtureId: string): number {
    const fixture = this.cachedFixtureById(fixtureId);
    return fixture?.status === 'LIVE' ? this.activeTtlMs : this.defaultTtlMs;
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
      const ttlMs = this.ttlForFixtureDate(date);

      if (this.config.dataProvider === 'verified-archive') {
        const fx = await this.fallbackProvider.getFixturesByDate(date, league);
        if (fx.length > 0) this.setCache(cacheKey, fx, ttlMs);
        return fx;
      }
      if (this.config.dataProvider === 'openfootball') {
        const fx = await this.openfootballProvider.getFixturesByDate(date, league);
        if (fx.length > 0) this.setCache(cacheKey, fx, ttlMs);
        return fx;
      }
      // a) In-memory cache. Checked before the file cache so a burst of button
      //    clicks is served from RAM and never re-reads the multi-megabyte file.
      const cached = this.getCached<Fixture[]>(cacheKey);
      if (cached) { console.info(`[Factory] mem cache HIT fixtures ${date} ${league}`); return cached; }
      console.info(`[Factory] cache MISS fixtures ${date} ${league}`);

      // b) File cache (production warm start / provider outage, 30-min TTL).
      //    Promoted into the memory cache so the following clicks are cheap.
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
          this.setCache(cacheKey, filtered, ttlMs);
          return filtered;
        }
      }

      let fixtures: Fixture[] = [];
      const wantGerman = league === 'ALL' || league === 'BUNDESLIGA' || league === 'BUNDESLIGA2';

      // c) ESPN public scoreboard - all major global leagues, live scores, no API key
      try {
        const espn = await this.espnProvider.getFixturesByDate(date, league);
        if (espn.length > 0) fixtures.push(...espn);
        console.info(`[Factory] ESPN returned ${espn.length} fixtures for ${date}`);
      } catch (e: any) { console.warn('[Factory] ESPN failed:', e.message); }

      // d) Football-Data.org for main leagues
      if (fixtures.length === 0 && this.backupProvider && !(this.backupProvider.isQuotaExhausted?.() ?? false) && !(this.backupProvider.isInCooldown?.() ?? false)) {
        try {
          const fd = await this.backupProvider.getFixturesByDate(date, league);
          if (fd.length > 0) fixtures.push(...fd);
        } catch (e: any) { console.warn('[Factory] Football-Data failed:', e.message); }
      }

      // e) OpenLigaDB (German specialist)
      if (fixtures.length === 0 && wantGerman) {
        try {
          const g = await this.openligadbProvider.getFixturesByDate(date, league);
          if (g.length > 0) fixtures.push(...g);
        } catch (e: any) { console.warn('[Factory] OpenLigaDB failed:', e.message); }
      }

      // f) TheSportsDB fallback if too few
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

      // g) Football-Data.co.uk free CSV fallback
      if (fixtures.length === 0) {
        try {
          const fduk = await this.footballDataUkProvider.getFixturesByDate(date, league);
          if (fduk.length > 0) fixtures.push(...fduk);
        } catch (e: any) { console.warn('[Factory] FootballDataUk failed:', e.message); }
      }

      // h) OpenFootball static dataset fallback
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
        this.setCache(cacheKey, fixtures, ttlMs);
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

      // A match that is in play is re-analysed on the short active window so the
      // live scorecard keeps moving; settled and upcoming matches keep the
      // configured analysis TTL.
      const ttlMs = this.matchTtlMs(fixtureId);

      let details: MatchAnalysis | null = null;

      // ESPN fixtures: route directly to ESPN adapter (no API-Football quota consumed)
      if (fixtureId.startsWith('espn-')) {
        try {
          details = await this.espnProvider.getMatchDetails(fixtureId);
        } catch (e: any) {
          console.warn(`[Factory] ESPN details failed for ${fixtureId}:`, e.message);
        }
        if (details) {
          this.setCache(cacheKey, details, ttlMs);
          return details;
        }
        // ESPN identity could not be verified: fall through to a model-only bundle
        // built from the cached fixture list (never substitute another match).
        const fx = await this.findFixtureById(fixtureId);
        if (fx) {
          details = buildGenericAnalysis(fx);
          this.setCache(cacheKey, details, ttlMs);
        }
        return details;
      }

      // Other verified providers (OpenLigaDB / Football-Data.co.uk / TheSportsDB /
      // OpenFootball) do not implement rich match endpoints: build a model-only bundle
      // from the authoritative cached fixture record instead of returning 404.
      if (/^(oldb|fduk|tsdb|openfoot)-/.test(fixtureId)) {
        const fx = await this.findFixtureById(fixtureId);
        if (fx && isVerifiedFixture(fx)) {
          details = buildGenericAnalysis(fx);
          this.setCache(cacheKey, details, ttlMs);
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
        this.setCache(cacheKey, details, ttlMs);
      }
      return details;
    })();

    this.inFlight.set(inflightKey, promise);
    promise.finally(() => this.inFlight.delete(inflightKey));
    return promise;
  }

  /** Locate a fixture across a small window of recent dates using the cached list. */
  private async findFixtureById(fixtureId: string): Promise<Fixture | null> {
    for (const d of [0, -1, 1, -2, 2]) {
      const date = new Date(Date.now() + d * 86400000).toISOString().slice(0, 10);
      const cached = this.getCached<Fixture[]>(`fixtures:${date}:ALL`);
      if (cached) {
        const hit = cached.find(f => f.id === fixtureId);
        if (hit) return hit;
      }
    }
    return null;
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
