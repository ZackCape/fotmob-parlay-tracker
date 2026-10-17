import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { OpenFootballAdapter } from '../src/providers/openfootball-adapter.js';

describe('OpenFootballAdapter', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'of-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns empty when data dir missing', async () => {
    const adapter = new OpenFootballAdapter(path.join(tmpDir, 'nope'));
    const res = await adapter.getFixturesByDate('2024-05-19', 'ALL');
    expect(res).toEqual([]);
  });

  it('normalises historical fixtures from JSON and filters by date/league', async () => {
    const data = [
      { date: '2024-05-19', league: 'Premier League', home: 'Arsenal', away: 'Everton', homeGoals: 2, awayGoals: 1 },
      { date: '2024-05-20', league: 'Championship', home: 'Leeds', away: 'Norwich', homeGoals: 1, awayGoals: 1 },
    ];
    fs.writeFileSync(path.join(tmpDir, 'matches.json'), JSON.stringify(data));
    const adapter = new OpenFootballAdapter(tmpDir);
    const all = await adapter.getFixturesByDate('2024-05-19', 'ALL');
    expect(all.length).toBe(1);
    expect(all[0].homeTeam.name).toBe('Arsenal');
    expect(all[0].homeScore).toBe(2);
    expect(all[0].status).toBe('FINISHED');
    expect(all[0].dataSource).toBe('OpenFootball (Historical)');

    const epl = await adapter.getFixturesByDate('2024-05-19', 'EPL');
    expect(epl.length).toBe(1);

    const ch = await adapter.getFixturesByDate('2024-05-19', 'CHAMPIONSHIP');
    expect(ch.length).toBe(0);
  });

  it('does not serve future dates as current/live', async () => {
    const data = [{ date: '2099-01-01', league: 'Premier League', home: 'A', away: 'B', homeGoals: null, awayGoals: null }];
    fs.writeFileSync(path.join(tmpDir, 'f.json'), JSON.stringify(data));
    const adapter = new OpenFootballAdapter(tmpDir);
    const res = await adapter.getFixturesByDate('2099-01-01', 'ALL');
    expect(res).toEqual([]);
  });

  it('dedups duplicate entries', async () => {
    const data = [
      { date: '2024-05-19', league: 'Premier League', home: 'Arsenal', away: 'Everton', homeGoals: 2, awayGoals: 1 },
      { date: '2024-05-19', league: 'Premier League', home: 'Arsenal', away: 'Everton', homeGoals: 2, awayGoals: 1 },
    ];
    fs.writeFileSync(path.join(tmpDir, 'dup.json'), JSON.stringify(data));
    const adapter = new OpenFootballAdapter(tmpDir);
    const res = await adapter.getFixturesByDate('2024-05-19', 'ALL');
    expect(res.length).toBe(1);
  });
});