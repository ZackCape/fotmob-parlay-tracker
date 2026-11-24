import fs from 'node:fs';
import path from 'node:path';
import type { DataProviderFactory } from '../providers/provider-factory.js';
import type { Fixture, MarketType } from '../types/football.js';
import type { OddsSnapshot } from '../types/odds.js';
import { getDatabase } from '../database/db.js';
import { isPreKickoffFixture } from '../discord/fixtureStatus.js';
import { evaluateActualOutcome } from '../engine/market-calculator.js';

type ResultMarket = Extract<MarketType, 'HOME_WIN' | 'DRAW' | 'AWAY_WIN'>;
type SettledOutcome = 'HIT' | 'MISS';

export interface PaperPick {
  id: string;
  modelVersion: string;
  fixtureId: string;
  date: string;
  kickoff: string;
  league: string;
  market: ResultMarket;
  probability: number;
  bookmaker: string;
  odds: number;
  quotedAt: string;
  publishedAt: string;
  outcome?: SettledOutcome;
}

interface Wager {
  reference: string;
  currency: string;
  stake: number;
  acceptedOdds: number;
  payout: number;
}

const MODEL_VERSION = 'dc-hybrid-v1';
const localFile = path.resolve('data', 'betting_records.json');
interface LocalRecords {
  picks: PaperPick[];
  wagers: Array<{ ownerId: string; wager: Wager }>;
}

function readLocalRecords(): LocalRecords {
  try {
    return JSON.parse(fs.readFileSync(localFile, 'utf8'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    return { picks: [], wagers: [] };
  }
}

function writeLocalRecords(records: LocalRecords): void {
  fs.mkdirSync(path.dirname(localFile), { recursive: true });
  const temporary = `${localFile}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(records), { mode: 0o600 });
  fs.renameSync(temporary, localFile);
}
let tablesReady: Promise<unknown> | undefined;

function ensureTables(): Promise<unknown> {
  return tablesReady ??= getDatabase().query(`
    CREATE TABLE IF NOT EXISTS paper_picks (
      id TEXT PRIMARY KEY, pick JSONB NOT NULL, outcome TEXT
    );
    CREATE TABLE IF NOT EXISTS recorded_wagers (
      owner_id TEXT NOT NULL, reference TEXT NOT NULL, wager JSONB NOT NULL,
      PRIMARY KEY (owner_id, reference)
    );
  `).catch(error => {
    tablesReady = undefined;
    throw error;
  });
}

export function makePaperPick(
  fixture: Fixture,
  market: ResultMarket,
  probability: number,
  snapshot: OddsSnapshot | null,
  now = Date.now(),
): PaperPick | null {
  if (!snapshot?.preMatch || !isPreKickoffFixture(fixture, now)) return null;
  if (!Number.isFinite(probability) || probability <= 0 || probability > 1) return null;
  const quotedAt = Date.parse(snapshot.retrievedAt);
  const snapshotKickoff = Date.parse(snapshot.commenceTime);
  if (!Number.isFinite(quotedAt) || quotedAt > now || !Number.isFinite(snapshotKickoff) || now >= snapshotKickoff) return null;

  const target = market === 'DRAW' ? 'draw' : market === 'HOME_WIN' ? snapshot.homeTeam : snapshot.awayTeam;
  const prices = snapshot.bookmakers.flatMap(book => {
    const outcome = book.markets.find(item => item.key === 'h2h')?.outcomes
      .find(item => item.name.toLowerCase() === target.toLowerCase());
    return book.title.trim() && outcome && Number.isFinite(outcome.price) && outcome.price > 1
      ? [{ odds: outcome.price, bookmaker: book.title }]
      : [];
  });
  const best = prices.sort((a, b) => b.odds - a.odds)[0];
  if (!best || best.odds * probability <= 1) return null;

  return {
    id: `${MODEL_VERSION}:${fixture.id}:${market}`,
    modelVersion: MODEL_VERSION,
    fixtureId: fixture.id,
    date: fixture.date.slice(0, 10),
    kickoff: fixture.kickoffTime,
    league: fixture.league,
    market,
    probability,
    ...best,
    quotedAt: snapshot.retrievedAt,
    publishedAt: new Date(now).toISOString(),
  };
}

export async function savePaperPick(pick: PaperPick): Promise<PaperPick> {
  const db = getDatabase();
  if (!db.isPostgres()) {
    const records = readLocalRecords();
    const existing = records.picks.find(item => item.id === pick.id);
    if (existing) return existing;
    records.picks.push(pick);
    writeLocalRecords(records);
    return pick;
  }
  await ensureTables();
  const { rows } = await db.query<{ pick: PaperPick }>(
    'INSERT INTO paper_picks (id, pick) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING RETURNING pick',
    [pick.id, JSON.stringify(pick)],
  );
  if (rows[0]) return rows[0].pick;
  const existing = await db.query<{ pick: PaperPick }>('SELECT pick FROM paper_picks WHERE id = $1', [pick.id]);
  return existing.rows[0].pick;
}

async function readPaperPicks(): Promise<PaperPick[]> {
  const db = getDatabase();
  if (!db.isPostgres()) return readLocalRecords().picks;
  await ensureTables();
  const { rows } = await db.query<{ pick: PaperPick; outcome: SettledOutcome | null }>('SELECT pick, outcome FROM paper_picks');
  return rows.map(row => ({ ...row.pick, outcome: row.outcome ?? undefined }));
}

export function summarizePaperPicks(picks: readonly PaperPick[]) {
  const settled = picks.filter(pick => pick.outcome);
  const profit = settled.reduce((sum, pick) => sum + (pick.outcome === 'HIT' ? pick.odds - 1 : -1), 0);
  return { pending: picks.length - settled.length, settled: settled.length, profit, roi: settled.length ? profit / settled.length * 100 : null };
}

export async function paperPickRecord(factory: DataProviderFactory, cutoff: number) {
  const picks = await readPaperPicks();
  const pendingByDate = new Map<string, PaperPick[]>();
  for (const pick of picks) {
    if (pick.outcome || Date.parse(pick.kickoff) > Date.now()) continue;
    const pending = pendingByDate.get(pick.date) ?? [];
    pending.push(pick);
    pendingByDate.set(pick.date, pending);
  }

  const db = getDatabase();
  for (const [date, pending] of pendingByDate) {
    let fixtures: Fixture[];
    try {
      fixtures = (await factory.getLiveScoreboard(date)).finished;
      const otherLeagues = new Set(pending.filter(pick => !pick.fixtureId.startsWith('espn-')).map(pick => pick.league));
      const extra = await Promise.allSettled([...otherLeagues].map(league => factory.getFixturesByDate(date, league)));
      for (const result of extra) {
        if (result.status === 'fulfilled') fixtures = fixtures.concat(result.value.filter(fixture => fixture.status === 'FINISHED'));
      }
    } catch {
      continue;
    }
    const results = new Map(fixtures.map(fixture => [fixture.id, fixture]));
    for (const pick of pending) {
      const fixture = results.get(pick.fixtureId);
      if (fixture?.status !== 'FINISHED' || fixture.homeScore === null || fixture.awayScore === null) continue;
      const outcome = evaluateActualOutcome(pick.market, fixture);
      if (outcome !== 'HIT' && outcome !== 'MISS') continue;
      if (db.isPostgres()) await db.query('UPDATE paper_picks SET outcome = $2 WHERE id = $1 AND outcome IS NULL', [pick.id, outcome]);
      else {
        const records = readLocalRecords();
        const stored = records.picks.find(item => item.id === pick.id);
        if (!stored || stored.outcome) continue;
        stored.outcome = outcome;
        writeLocalRecords(records);
      }
    }
  }
  return summarizePaperPicks((await readPaperPicks()).filter(pick => Date.parse(pick.publishedAt) >= cutoff));
}

export async function saveRecordedWager(ownerId: string, wager: Wager): Promise<void> {
  if (!wager.reference || !/^[A-Z]{3}$/.test(wager.currency)
    || !Number.isFinite(wager.stake) || wager.stake <= 0
    || !Number.isFinite(wager.acceptedOdds) || wager.acceptedOdds <= 1
    || !Number.isFinite(wager.payout) || wager.payout < 0) {
    throw new Error('Enter a reference, three-letter currency code, positive stake, decimal odds above 1, and payout of zero or more.');
  }
  const db = getDatabase();
  if (!db.isPostgres()) {
    const records = readLocalRecords();
    const index = records.wagers.findIndex(item => item.ownerId === ownerId && item.wager.reference === wager.reference);
    const entry = { ownerId, wager };
    if (index === -1) records.wagers.push(entry);
    else records.wagers[index] = entry;
    writeLocalRecords(records);
    return;
  }
  await ensureTables();
  await db.query(`
    INSERT INTO recorded_wagers (owner_id, reference, wager) VALUES ($1, $2, $3)
    ON CONFLICT (owner_id, reference) DO UPDATE SET wager = EXCLUDED.wager
  `, [ownerId, wager.reference, JSON.stringify(wager)]);
}

export async function recordedWagerRoi(ownerId: string) {
  const db = getDatabase();
  if (db.isPostgres()) await ensureTables();
  const records = db.isPostgres()
    ? (await db.query<{ wager: Wager }>('SELECT wager FROM recorded_wagers WHERE owner_id = $1', [ownerId])).rows.map(row => row.wager)
    : readLocalRecords().wagers.filter(item => item.ownerId === ownerId).map(item => item.wager);
  const byCurrency = new Map<string, { count: number; stake: number; profit: number }>();
  for (const wager of records) {
    const total = byCurrency.get(wager.currency) ?? { count: 0, stake: 0, profit: 0 };
    total.count++;
    total.stake += wager.stake;
    total.profit += wager.payout - wager.stake;
    byCurrency.set(wager.currency, total);
  }
  return [...byCurrency].map(([currency, total]) => ({ currency, ...total, roi: total.profit / total.stake * 100 }));
}
