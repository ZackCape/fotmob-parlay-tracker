import axios from 'axios';
import fs from 'fs';
import path from 'path';
/**
 * The Odds API sport keys per Cape Predictor league.
 *
 * Keys must be exact — the endpoint is `/sports/{key}/odds/` and an unknown key
 * returns HTTP 404, which would silently look like "no odds published".
 * Competitions absent from this map yield no Tier-1 odds and fall through to
 * Tier 2 (public cache) and Tier 3 (calibrated fair odds) instead.
 */
export const ODDS_SPORT_KEYS = {
    EPL: 'soccer_epl',
    CHAMPIONSHIP: 'soccer_efl_champ',
    EREDIVISIE: 'soccer_netherlands_eredivisie',
    EKSTRAKLASA: 'soccer_poland_ekstraklasa',
    PRIMEIRA_LIGA: 'soccer_portugal_primeira_liga',
    PRO_LEAGUE: 'soccer_belgium_first_div',
    SCOTTISH_PREM: 'soccer_spl',
    SUPER_LIG: 'soccer_turkey_super_league',
    SWISS_SUPER: 'soccer_switzerland_superleague',
    AUSTRIAN_BUNDESLIGA: 'soccer_austria_bundesliga',
    DANISH_SUPERLIGA: 'soccer_denmark_superliga',
};
/** Leagues with a Tier-1 bookmaker feed wired up. */
export function oddsLeagues() {
    return Object.keys(ODDS_SPORT_KEYS);
}
/** The Odds API sport key for a Cape Predictor league, or null when unmapped. */
export function sportKeyForLeague(league) {
    return ODDS_SPORT_KEYS[String(league || '').toUpperCase()] ?? null;
}
const DEFAULT_REGIONS = 'uk';
const DEFAULT_MARKETS = 'h2h';
const CACHE_TTL_MS = 30 * 60 * 1000;
export class TheOddsAdapter {
    name = 'The Odds API';
    apiKey;
    baseUrl = 'https://api.the-odds-api.com/v4';
    regions;
    monthlyLimit;
    safetyReserve;
    usageFile;
    cache = new Map();
    inFlight = new Map();
    constructor(apiKey, regions = 'uk', monthlyLimit = 500, safetyReserve = 50) {
        this.apiKey = apiKey;
        this.regions = regions;
        this.monthlyLimit = monthlyLimit;
        this.safetyReserve = safetyReserve;
        this.usageFile = path.resolve(process.cwd(), 'data', 'theodds_usage.json');
    }
    isConfigured() { return Boolean(this.apiKey); }
    monthKey() { return new Date().toISOString().slice(0, 7); }
    readUsage() {
        try {
            const raw = JSON.parse(fs.readFileSync(this.usageFile, 'utf8'));
            if (raw.month === this.monthKey())
                return raw;
        }
        catch { }
        return { month: this.monthKey(), used: 0 };
    }
    writeUsage(u) {
        try {
            fs.mkdirSync(path.dirname(this.usageFile), { recursive: true });
            fs.writeFileSync(this.usageFile, JSON.stringify(u));
        }
        catch { }
    }
    canSpend(n = 1) {
        const u = this.readUsage();
        if (u.month !== this.monthKey())
            return true;
        return u.used + n <= this.monthlyLimit - this.safetyReserve;
    }
    recordUsage(n = 1) {
        const u = this.readUsage();
        const cur = u.month === this.monthKey() ? u : { month: this.monthKey(), used: 0 };
        cur.used += n;
        this.writeUsage(cur);
    }
    normalizeTeamName(name) {
        return (name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    }
    getCached(key) {
        const e = this.cache.get(key);
        if (!e)
            return null;
        if (Date.now() - e.cachedAt > e.ttlMs) {
            this.cache.delete(key);
            return null;
        }
        return e.data;
    }
    setCache(key, data, ttlMs = CACHE_TTL_MS) {
        this.cache.set(key, { data, cachedAt: Date.now(), ttlMs });
    }
    async fetchOddsForSport(sportKey, markets = DEFAULT_MARKETS) {
        const cacheKey = `odds:${sportKey}:${this.regions}:${markets}`;
        const cached = this.getCached(cacheKey);
        if (cached)
            return cached;
        const inflight = this.inFlight.get(cacheKey);
        if (inflight)
            return inflight;
        const promise = (async () => {
            if (!this.isConfigured())
                return [];
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
                const snapshots = (res.data || []).map((ev) => ({
                    id: ev.id,
                    sportKey: ev.sport_key,
                    homeTeam: ev.home_team,
                    awayTeam: ev.away_team,
                    commenceTime: ev.commence_time,
                    bookmakers: (ev.bookmakers || []).map((b) => ({
                        key: b.key,
                        title: b.title,
                        lastUpdate: b.last_update,
                        markets: (b.markets || []).map((m) => ({
                            key: m.key,
                            lastUpdate: m.last_update,
                            outcomes: (m.outcomes || []).map((o) => ({ name: o.name, price: o.price })),
                        })),
                    })),
                    retrievedAt: new Date().toISOString(),
                    preMatch: new Date(ev.commence_time).getTime() > Date.now(),
                    provider: 'The Odds API',
                }));
                this.setCache(cacheKey, snapshots);
                return snapshots;
            }
            catch (err) {
                const status = err?.response?.status;
                if (status === 429) {
                    console.warn('[TheOddsAdapter] Rate limited (429).');
                }
                else if (status === 401 || status === 403) {
                    console.warn('[TheOddsAdapter] Auth failed.');
                }
                else {
                    console.warn('[TheOddsAdapter] Fetch error:', err.message);
                }
                return [];
            }
        })();
        this.inFlight.set(cacheKey, promise);
        promise.finally(() => this.inFlight.delete(cacheKey));
        return promise;
    }
    async getOddsForFixture(fixture) {
        const sportKey = sportKeyForLeague(fixture.league);
        if (!sportKey)
            return null;
        const snapshots = await this.fetchOddsForSport(sportKey);
        if (!snapshots.length)
            return null;
        const homeNorm = this.normalizeTeamName(fixture.homeTeam.name);
        const awayNorm = this.normalizeTeamName(fixture.awayTeam.name);
        const kickoff = new Date(fixture.kickoffTime).getTime();
        if (!isFinite(kickoff)) {
            console.warn('[TheOddsAdapter] Invalid kickoff for fixture', fixture.id);
            return null;
        }
        const TOLERANCE_MS = 10 * 60 * 1000; // 10 minutes
        const candidates = [];
        for (const snap of snapshots) {
            const snapHome = this.normalizeTeamName(snap.homeTeam);
            const snapAway = this.normalizeTeamName(snap.awayTeam);
            if (snapHome !== homeNorm || snapAway !== awayNorm)
                continue;
            const snapKickoff = new Date(snap.commenceTime).getTime();
            if (!isFinite(snapKickoff))
                continue;
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
            if (candidates.length > 1)
                console.warn('[TheOddsAdapter] Ambiguous match; rejecting.');
            return null;
        }
        return candidates[0];
    }
    getUsage() {
        const u = this.readUsage();
        return { month: u.month, used: u.used, limit: this.monthlyLimit, reserve: this.safetyReserve };
    }
}
