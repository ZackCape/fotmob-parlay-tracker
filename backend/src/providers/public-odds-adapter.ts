/**
 * Tier 2 of the hybrid odds engine — zero-quota public odds cache.
 *
 * When Tier 1 (The Odds API) is unconfigured, over budget or rate-limited
 * (HTTP 429) we serve the last consensus lines we successfully persisted to
 * `data/odds_cache.json`. This costs no quota and keeps the dashboard and
 * Discord embeds populated instead of showing "odds_provider_not_configured".
 *
 * The cache is written by `saveFromSnapshots` whenever Tier 1 returns live
 * odds, so it self-populates during periods when the API is reachable. It never
 * synthesises prices: if the file is missing or a fixture is absent, the caller
 * falls through to Tier 3 (calibrated fair odds).
 *
 * This tier is deliberately **league-agnostic**: it matches on normalised team
 * names plus a kick-off tolerance, not on a sport key, so every competition the
 * pipeline supports is cached automatically as soon as Tier 1 publishes odds
 * for it. Adding a league to `ODDS_SPORT_KEYS` (see `theodds-adapter.ts`) is
 * therefore all that is needed for its odds to start flowing into this cache —
 * there is no per-league allowlist here to keep in step.
 */

import fs from 'node:fs';
import nodePath from 'node:path';
import { Fixture } from '../types/football.js';

export interface CachedOddsLine {
  home: number | null;
  draw: number | null;
  away: number | null;
  homeTeam?: string;
  awayTeam?: string;
  commenceTime?: string;
  bookmaker?: string;
  updatedAt?: string;
}

interface OddsCacheFile {
  updatedAt: string | null;
  events: CachedOddsLine[];
}

const DEFAULT_FILE = nodePath.resolve(process.cwd(), 'data', 'odds_cache.json');
/** Cache lives for 12 hours; stale lines are not served as live prices. */
const MAX_AGE_MS = 12 * 60 * 60 * 1000;
const KICKOFF_TOLERANCE_MS = 30 * 60 * 1000;

function normalise(name: string | null | undefined): string {
  return (name || '').toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]/g, '');
}

export class PublicOddsAdapter {
  readonly name = 'Public Odds Cache (Tier 2)';
  private file: string;

  constructor(file: string = DEFAULT_FILE) {
    this.file = file;
  }

  /** Read the cache file, ignoring freshness. */
  private readRaw(): OddsCacheFile | null {
    try {
      if (!fs.existsSync(this.file)) return null;
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      const events: CachedOddsLine[] = Array.isArray(raw?.events) ? raw.events : [];
      const updatedAt: string | null = typeof raw?.updatedAt === 'string' ? raw.updatedAt : null;
      return { updatedAt, events };
    } catch {
      return null;
    }
  }

  /** Read the cache file. Returns null when absent, malformed or stale. */
  read(): OddsCacheFile | null {
    const raw = this.readRaw();
    if (!raw) return null;
    if (raw.updatedAt && Date.now() - new Date(raw.updatedAt).getTime() > MAX_AGE_MS) return null;
    return raw;
  }

  isAvailable(): boolean {
    const cache = this.read();
    return !!cache && cache.events.length > 0;
  }

  /** Resolve a cached line for a fixture, or null when nothing matches. */
  getOddsForFixture(fixture: Fixture): CachedOddsLine | null {
    const cache = this.read();
    if (!cache) return null;

    const home = normalise(fixture.homeTeam?.name);
    const away = normalise(fixture.awayTeam?.name);
    const kickoff = fixture.kickoffTime ? new Date(fixture.kickoffTime).getTime() : null;

    const candidates = cache.events.filter(
      (e) => normalise(e.homeTeam) === home && normalise(e.awayTeam) === away,
    );
    if (!candidates.length) return null;

    if (kickoff !== null && isFinite(kickoff)) {
      const timeMatched = candidates.find((e) => {
        if (!e.commenceTime) return false;
        const t = new Date(e.commenceTime).getTime();
        return isFinite(t) && Math.abs(t - kickoff) <= KICKOFF_TOLERANCE_MS;
      });
      if (timeMatched) return timeMatched;
    }
    // Fall back to the first name match when kickoff metadata is unavailable.
    return candidates[0] ?? null;
  }

  /**
   * Persist Tier-1 snapshots as consensus lines, merging with whatever is
   * already cached so a single-fixture refresh never wipes the other events.
   */
  saveFromSnapshots(snapshots: any[]): void {
    if (!Array.isArray(snapshots) || !snapshots.length) return;
    const existing = this.readRaw();
    const keyOf = (h?: string, a?: string) => `${normalise(h)}|${normalise(a)}`;
    const map = new Map<string, CachedOddsLine>();
    for (const e of existing?.events || []) map.set(keyOf(e.homeTeam, e.awayTeam), e);

    for (const snap of snapshots) {
      const prices = consensusH2h(snap);
      if (prices.home === null && prices.draw === null && prices.away === null) continue;
      map.set(keyOf(snap.homeTeam, snap.awayTeam), {
        home: prices.home,
        draw: prices.draw,
        away: prices.away,
        homeTeam: snap.homeTeam,
        awayTeam: snap.awayTeam,
        commenceTime: snap.commenceTime,
        bookmaker: 'consensus',
        updatedAt: new Date().toISOString(),
      });
    }
    if (!map.size) return;
    try {
      fs.mkdirSync(nodePath.dirname(this.file), { recursive: true });
      fs.writeFileSync(
        this.file,
        JSON.stringify({ updatedAt: new Date().toISOString(), events: [...map.values()] }, null, 2),
      );
    } catch {
      /* cache write is best-effort */
    }
  }
}

/**
 * Average the h2h prices across every bookmaker in a snapshot and re-express
 * them as a fair (overround-free) decimal line. Returns nulls when no bookmaker
 * supplied an h2h market.
 */
function consensusH2h(snap: any): { home: number | null; draw: number | null; away: number | null } {
  const homePrices: number[] = [];
  const drawPrices: number[] = [];
  const awayPrices: number[] = [];
  for (const b of snap?.bookmakers || []) {
    const market = (b.markets || []).find((m: any) => m.key === 'h2h');
    if (!market) continue;
    for (const o of market.outcomes || []) {
      const price = Number(o.price);
      if (!Number.isFinite(price) || price <= 0) continue;
      if (o.name === snap.homeTeam) homePrices.push(price);
      else if (o.name === snap.awayTeam) awayPrices.push(price);
      else if (/draw/i.test(o.name)) drawPrices.push(price);
    }
  }
  const avg = (arr: number[]): number | null =>
    arr.length ? Number((arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(3)) : null;
  const homeImplied = avg(homePrices);
  const drawImplied = avg(drawPrices);
  const awayImplied = avg(awayPrices);
  if (homeImplied === null || drawImplied === null || awayImplied === null) {
    return { home: homeImplied, draw: drawImplied, away: awayImplied };
  }
  // Remove the bookmaker margin before persisting so cached lines are fair.
  const overround = 1 / homeImplied + 1 / drawImplied + 1 / awayImplied;
  return {
    home: Number((homeImplied * overround).toFixed(3)),
    draw: Number((drawImplied * overround).toFixed(3)),
    away: Number((awayImplied * overround).toFixed(3)),
  };
}

export default PublicOddsAdapter;
