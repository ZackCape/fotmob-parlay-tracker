import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { OddsSnapshot, BookmakerOdds, OddsMarket, OddsOutcome } from '../types/odds.js';
import { Fixture } from '../types/football.js';

const SPORT_KEYS: Record<string, string> = {
  EPL: 'soccer_epl',
  CHAMPIONSHIP: 'soccer_efl_champ',
};

const DEFAULT_REGIONS = 'uk';
const DEFAULT_MARKETS = 'h2h';
const CACHE_TTL_MS = 30 * 60 * 1000;

interface CacheEntry<T> { data: T; cachedAt: number; ttlMs: number; }

export class TheOddsAdapter {
  readonly name = 'The Odds API';
  private apiKey: string;
  private baseUrl = 'https://api.the-odds-api.com/v4';
  private regions: string;
  private monthlyLimit: number;
  private safetyReserve: number;
  private usageFile: string;
  private cache = new Map<string, CacheEntry<any>>();
  private inFlight = new Map<string, Promise<any>>();

  constructor(apiKey: string, regions: string = 'uk', monthlyLimit: number = 500, safetyReserve: number = 50) {
    this.apiKey = apiKey;
    this.regions = regions;
    this.monthlyLimit = monthlyLimit;
    this.safetyReserve = safetyReserve;
    this.usageFile = path.resolve(process.cwd(), 'data', 'theodds_usage.json');
  }

  isConfigured(): boolean { return Boolean(this.apiKey); }

  private monthKey(): string { return new Date().toISOString().slice(0, 7); }

  private readUsage(): { month: string; used: number } {
    try {
      const raw = JSON.parse(fs.readFileSync(this.usageFile, 'utf8'));
      if (raw.month === this.monthKey()) return raw;
    } catch {}
    return { month: this.monthKey(), used: 0 };
  }

  private writeUsage(u: { month: string; used: number }) {
    try {
      fs.mkdirSync(path.dirname(this.usageFile), { recursive: true });
      fs.writeFileSync(this.usageFile, JSON.stringify(u));
    } catch {}
  }

  private canSpend(n: number = 1): boolean {
    const u = this.readUsage();
    if (u.month !== this.monthKey()) return true;
    return u.used + n <= this.monthlyLimit - this.safetyReserve;
  }

  private recordUsage(n: number = 1) {
    const u = this.readUsage();
    const cur = u.month === this.monthKey() ? u : { month: this.monthKey(), used: 0 };
    cur.used += n;
    this.writeUsage(cur);
  }

  private normalizeTeamName(name: string): string {
    return (name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  }

  private getCached<T>(key: string): T | null {
    const e = this.cache.get(key);
    if (!e) return null;
    if (Date.now() - e.cachedAt > e.ttlMs) { this.cache.delete(key); return null; }
    return e.data as T;
  }

  private setCache<T>(key: string, data: T, ttlMs: number = CACHE_TTL_MS) {
    this.cache.set(key, { data, cachedAt: Date.now(), ttlMs });
  }

  async fetchOddsForSport(sportKey: string, markets: string = DEFAULT_MARKETS): Promise<OddsSnapshot[]> {
    const cacheKey = `odds:${sportKey}:${this.regions}:${markets}`;
    const cached = this.getCached<OddsSnapshot[]>(cacheKey);
    if (cached) return cached;

    const inflight = this.inFlight.get(cacheKey);
    if (inflight) return inflight;

    const promise = (async () => {
      if (!this.isConfigured()) return [];
      if (!this.canSpend(1)) {
        console.warn('[TheOddsAdapter] Monthly budget exhausted; returning cached/empty.');
        return [];
      }
      try {
        const url = `${this.baseUrl}/sports/${sportKey}/odds/`;
        const res = await axios.get(url, {
          params: {
            apiKey: this.apiKey,
            regions: this.regions,
            markets,
            oddsFormat: 'decimal',
          },
          timeout: 10000,
        });
        this.recordUsage(1);
        const snapshots: OddsSnapshot[] = (res.data || []).map((ev: any) => ({
          id: ev.id,
          sportKey: ev.sport_key,
          homeTeam: ev.home_team,
          awayTeam: ev.away_team,
          commenceTime: ev.commence_time,
          bookmakers: (ev.bookmakers || []).map((b: any) => ({
            key: b.key,
            title: b.title,
            lastUpdate: b.last_update,
            markets: (b.markets || []).map((m: any) => ({
              key: m.key,
              lastUpdate: m.last_update,
              outcomes: (m.outcomes || []).map((o: any) => ({ name: o.name, price: o.price })),
            })),
          })),
          retrievedAt: new Date().toISOString(),
          preMatch: new Date(ev.commence_time).getTime() > Date.now(),
          provider: 'The Odds API',
        }));
        this.setCache(cacheKey, snapshots);
        return snapshots;
      } catch (err: any) {
        const status = err?.response?.status;
        if (status === 429) {
          console.warn('[TheOddsAdapter] Rate limited (429).');
        } else if (status === 401 || status === 403) {
          console.warn('[TheOddsAdapter] Auth failed.');
        } else {
          console.warn('[TheOddsAdapter] Fetch error:', err.message);
        }
        return [];
      }
    })();

    this.inFlight.set(cacheKey, promise);
    promise.finally(() => this.inFlight.delete(cacheKey));
    return promise;
  }

  async getOddsForFixture(fixture: Fixture): Promise<OddsSnapshot | null> {
    const sportKey = SPORT_KEYS[fixture.league];
    if (!sportKey) return null;
    const snapshots = await this.fetchOddsForSport(sportKey);
    if (!snapshots.length) return null;

    const homeNorm = this.normalizeTeamName(fixture.homeTeam.name);
    const awayNorm = this.normalizeTeamName(fixture.awayTeam.name);
    const kickoff = new Date(fixture.kickoffTime).getTime();
    if (!isFinite(kickoff)) {
      console.warn('[TheOddsAdapter] Invalid kickoff for fixture', fixture.id);
      return null;
    }

    const TOLERANCE_MS = 10 * 60 * 1000; // 10 minutes
    const candidates: OddsSnapshot[] = [];
    for (const snap of snapshots) {
      const snapHome = this.normalizeTeamName(snap.homeTeam);
      const snapAway = this.normalizeTeamName(snap.awayTeam);
      if (snapHome !== homeNorm || snapAway !== awayNorm) continue;
      const snapKickoff = new Date(snap.commenceTime).getTime();
      if (!isFinite(snapKickoff)) continue;
      const timeDiff = Math.abs(snapKickoff - kickoff);
      if (timeDiff > TOLERANCE_MS) {
        console.warn(`[TheOddsAdapter] Rejected candidate ${snap.id}: kickoff diff ${timeDiff}ms > ${TOLERANCE_MS}ms`);
        continue;
      }
      candidates.push(snap);
    }

    console.info(`[TheOddsAdapter] fixture=${fixture.id} homeNorm=${homeNorm} awayNorm=${awayNorm} kickoff=${new Date(kickoff).toISOString()} candidates=${candidates.length}`);

    // If more than one plausible candidate, reject (ambiguous)
    if (candidates.length !== 1) {
      if (candidates.length > 1) console.warn('[TheOddsAdapter] Ambiguous match; rejecting.');
      return null;
    }
    return candidates[0];
  }

  getUsage(): { month: string; used: number; limit: number; reserve: number } {
    const u = this.readUsage();
    return { month: u.month, used: u.used, limit: this.monthlyLimit, reserve: this.safetyReserve };
  }
}