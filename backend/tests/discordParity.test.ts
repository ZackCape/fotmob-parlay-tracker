import { describe, it, expect } from 'vitest';
import {
  getParlay, clearParlay, addLeg, removeLeg, saveParlay, setParlayStake,
  parlayCombinedProbability, parlayImpliedOdds, parlayExpectedPayout,
  parlayExpectedValue, hasCorrelatedLegs, buildParlayEmbed, buildSavedParlayEmbed,
  buildParlayPayload, buildStakeModal, MAX_LEGS, MARKET_OPTIONS,
} from '../src/discord/parlayBuilder.js';
import {
  buildAnalysisEmbed, buildAnalysisPayload, buildStatsTab,
  buildProbabilitiesTab, buildScoreMatrixTab, buildLineupsTab, ANALYSIS_TABS,
} from '../src/discord/analysisEmbeds.js';
import {
  buildLiveMatchEmbed, buildLiveActionRow, buildLivePickerEmbed,
  buildLiveSelectRow, liveFingerprint, registerTracker, removeTracker,
  findTrackerByCustomId, buildDashboardPayload, dashboardUrl,
} from '../src/discord/liveTracker.js';
import { BRAND } from '../src/discord/brand.js';
import { LEAGUE_OPTIONS, leagueLabel } from '../src/discord/leagues.js';
import { MatchAnalysis, MarketPrediction } from '../src/types/football.js';

/* ------------------------------------------------------------------ *
 * Fixtures
 * ------------------------------------------------------------------ */
function makeAnalysis(overrides: Partial<MatchAnalysis> = {}): MatchAnalysis {
  const prediction = (market: string, probability: number): MarketPrediction => ({
    id: `${market}-1`, fixtureId: 'espn-1', league: 'EPL',
    fixtureDescription: 'Home v Away', kickoff: '2026-10-17T15:00:00Z',
    market: market as any, marketLabel: market, selection: market,
    estimatedProbability: probability, rawProbability: probability,
    confidenceLower: probability * 0.85, confidenceUpper: Math.min(1, probability * 1.15),
    supportingStatistics: {} as any,
  } as MarketPrediction);

  const matrix = [
    { homeScore: 2, awayScore: 1, probability: 0.12 },
    { homeScore: 1, awayScore: 1, probability: 0.11 },
    { homeScore: 1, awayScore: 0, probability: 0.10 },
    { homeScore: 0, awayScore: 0, probability: 0.09 },
    { homeScore: 2, awayScore: 0, probability: 0.08 },
    { homeScore: 3, awayScore: 1, probability: 0.07 },
  ];

  return {
    fixture: {
      id: 'espn-1', league: 'EPL',
      homeTeam: { id: '1', name: 'Home FC' } as any,
      awayTeam: { id: '2', name: 'Away FC' } as any,
      kickoffTime: '2026-10-17T15:00:00Z', status: 'LIVE',
      homeScore: 1, awayScore: 0, dataSource: 'espn',
      statistics: {
        shotsHome: 12, shotsAway: 5, shotsOnTargetHome: 4, shotsOnTargetAway: 1,
        xgHome: 1.85, xgAway: 0.62, cornersHome: 6, cornersAway: 2,
        foulsHome: 9, foulsAway: 14, yellowCardsHome: 2, yellowCardsAway: 3,
        redCardsHome: 0, redCardsAway: 1, possessionHome: 58.3, possessionAway: 41.7,
      },
    } as any,
    homeForm: { last5Results: ['W', 'D', 'W', 'L', 'W'] } as any,
    awayForm: { last5Results: ['L', 'W', 'D', 'D', 'L'] } as any,
    headToHead: {} as any,
    dixonColesParameters: {
      homeExpectedGoals: 1.85, awayExpectedGoals: 0.62,
      homeAttackStrength: 1.2, homeDefenseWeakness: 0.9,
      awayAttackStrength: 0.8, awayDefenseWeakness: 1.1,
      homeAdvantage: 1.28,
    },
    scoreMatrix: matrix,
    marketPredictions: [
      prediction('HOME_WIN', 0.62),
      prediction('DRAW', 0.23),
      prediction('AWAY_WIN', 0.15),
    ],
    injuries: null,
    lineups: { home: null, away: null },
    dataQualityNotes: [],
    ...overrides,
  } as MatchAnalysis;
}

function json(e: any) {
  return JSON.stringify(e.data ?? e);
}

/* ================================================================== *
 * Brand + leagues
 * ================================================================== */
describe('brand constants', () => {
  it('uses the restrained blue accent and Cape Predictor identity', () => {
    expect(BRAND.accent).toBe(0x2563EB);
    expect(BRAND.author).toContain('Cape Predictor');
    expect(BRAND.tagline).toBe('Smarter Predictions');
  });
});

describe('league catalogue', () => {
  it('exposes the requested competitions', () => {
    const ids = LEAGUE_OPTIONS.map((l) => l.id);
    for (const expected of ['EPL', 'LALIGA', 'SERIE_A', 'BUNDESLIGA', 'LIGUE1', 'CHAMPIONS_LEAGUE', 'CHAMPIONSHIP', 'ALL']) {
      expect(ids).toContain(expected);
    }
  });

  it('resolves human labels', () => {
    expect(leagueLabel('EPL')).toBe('Premier League');
    expect(leagueLabel('NOT_A_LEAGUE')).toBe('NOT_A_LEAGUE');
  });
});

/* ================================================================== *
 * Parlay maths
 * ================================================================== */
describe('parlay leg management', () => {
  it('starts empty and never invents legs', () => {
    const p = getParlay('u1');
    expect(p.legs).toHaveLength(0);
    expect(p.stake).toBe(1);
  });

  it('adds a leg and refuses duplicates', () => {
    const p = clearParlay('u2');
    const leg = { fixtureId: 'f1', description: 'A v B', league: 'EPL', market: 'HOME_WIN' as any, selection: 'Home Win', probability: 0.5 };
    expect(addLeg(p, leg).ok).toBe(true);
    expect(p.legs).toHaveLength(1);
    const dup = addLeg(p, { ...leg });
    expect(dup.ok).toBe(false);
    expect(dup.reason).toMatch(/already on your slip/i);
  });

  it('allows different markets on the same match but flags correlation', () => {
    const p = clearParlay('u3');
    addLeg(p, { fixtureId: 'f1', description: 'A v B', league: 'EPL', market: 'HOME_WIN' as any, selection: 'Home Win', probability: 0.5 });
    addLeg(p, { fixtureId: 'f1', description: 'A v B', league: 'EPL', market: 'OVER_2_5' as any, selection: 'Over 2.5', probability: 0.5 });
    expect(p.legs).toHaveLength(2);
    expect(hasCorrelatedLegs(p)).toBe(true);
  });

  it('rejects non-positive or impossible probabilities', () => {
    const p = clearParlay('u4');
    for (const bad of [0, -0.5, NaN, 1.5, Infinity]) {
      const res = addLeg(p, { fixtureId: 'f', description: 'd', league: 'EPL', market: 'DRAW' as any, selection: 'Draw', probability: bad });
      expect(res.ok, `probability ${bad} should be rejected`).toBe(false);
    }
    expect(p.legs).toHaveLength(0);
  });

  it('enforces the maximum leg count', () => {
    const p = clearParlay('u5');
    for (let i = 0; i < MAX_LEGS; i++) {
      addLeg(p, { fixtureId: `f${i}`, description: 'd', league: 'EPL', market: 'HOME_WIN' as any, selection: 'Home Win', probability: 0.5 });
    }
    const over = addLeg(p, { fixtureId: 'fX', description: 'd', league: 'EPL', market: 'HOME_WIN' as any, selection: 'Home Win', probability: 0.5 });
    expect(over.ok).toBe(false);
    expect(p.legs).toHaveLength(MAX_LEGS);
  });

  it('removes legs by 1-based index and rejects bad indices', () => {
    const p = clearParlay('u6');
    addLeg(p, { fixtureId: 'f1', description: 'one', league: 'EPL', market: 'HOME_WIN' as any, selection: 'Home Win', probability: 0.5 });
    addLeg(p, { fixtureId: 'f2', description: 'two', league: 'EPL', market: 'DRAW' as any, selection: 'Draw', probability: 0.4 });
    expect(removeLeg(p, 1).ok).toBe(true);
    expect(p.legs[0].description).toBe('two');
    expect(removeLeg(p, 0).ok).toBe(false);
    expect(removeLeg(p, 99).ok).toBe(false);
  });

  it('refuses to save an empty or correlated slip, and reverts saved on edit', () => {
    const empty = clearParlay('u7');
    expect(saveParlay(empty).ok).toBe(false);

    const corr = clearParlay('u8');
    addLeg(corr, { fixtureId: 'f1', description: 'a', league: 'EPL', market: 'HOME_WIN' as any, selection: 'h', probability: 0.5 });
    addLeg(corr, { fixtureId: 'f1', description: 'b', league: 'EPL', market: 'DRAW' as any, selection: 'd', probability: 0.5 });
    expect(saveParlay(corr).ok).toBe(false);

    const good = clearParlay('u9');
    addLeg(good, { fixtureId: 'f1', description: 'a', league: 'EPL', market: 'HOME_WIN' as any, selection: 'h', probability: 0.5 });
    addLeg(good, { fixtureId: 'f2', description: 'b', league: 'EPL', market: 'DRAW' as any, selection: 'd', probability: 0.5 });
    expect(saveParlay(good).ok).toBe(true);
    expect(good.saved).toBe(true);
    addLeg(good, { fixtureId: 'f3', description: 'c', league: 'EPL', market: 'BTTS_YES' as any, selection: 'btts', probability: 0.5 });
    expect(good.saved).toBe(false);
  });
});

describe('parlay calculations', () => {
  it('returns neutral values for an empty slip', () => {
    const p = clearParlay('calc-empty');
    expect(parlayCombinedProbability(p)).toBe(1);
    expect(parlayImpliedOdds(p)).toBeNull();
    expect(parlayExpectedPayout(p)).toBeNull();
    expect(parlayExpectedValue(p)).toBeNull();
  });

  it('multiplies leg probabilities and inverts for fair odds', () => {
    const p = clearParlay('calc-1');
    addLeg(p, { fixtureId: 'f1', description: 'a', league: 'EPL', market: 'HOME_WIN' as any, selection: 'h', probability: 0.5 });
    addLeg(p, { fixtureId: 'f2', description: 'b', league: 'EPL', market: 'DRAW' as any, selection: 'd', probability: 0.4 });
    expect(parlayCombinedProbability(p)).toBeCloseTo(0.2, 10);
    expect(parlayImpliedOdds(p)).toBeCloseTo(5, 10);
  });

  it('payout scales with the stake', () => {
    const p = clearParlay('calc-2');
    addLeg(p, { fixtureId: 'f1', description: 'a', league: 'EPL', market: 'HOME_WIN' as any, selection: 'h', probability: 0.5 });
    setParlayStake(p, 10);
    expect(parlayExpectedPayout(p)).toBeCloseTo(20, 5);
    setParlayStake(p, 2.5);
    expect(parlayExpectedPayout(p)).toBeCloseTo(5, 5);
  });

  it('rejects invalid stakes', () => {
    const p = clearParlay('calc-2b');
    for (const bad of ['abc', 0, -5, NaN, Infinity]) {
      expect(setParlayStake(p, bad).ok, `stake ${bad} should be rejected`).toBe(false);
    }
    expect(setParlayStake(p, 5).ok).toBe(true);
    expect(p.stake).toBe(5);
  });

  it('expected value is ~0 at fair odds (never a fake profit)', () => {
    const p = clearParlay('calc-3');
    addLeg(p, { fixtureId: 'f1', description: 'a', league: 'EPL', market: 'HOME_WIN' as any, selection: 'h', probability: 0.62 });
    addLeg(p, { fixtureId: 'f2', description: 'b', league: 'EPL', market: 'OVER_2_5' as any, selection: 'o', probability: 0.55 });
    setParlayStake(p, 10);
    const ev = parlayExpectedValue(p);
    // EV = P(win) * payout - stake, which is exactly zero at fair odds.
    expect(ev).not.toBeNull();
    expect(Math.abs(ev as number)).toBeLessThan(0.01);
    // The payout itself is much larger than the EV - they must not be confused.
    expect(parlayExpectedPayout(p) as number).toBeGreaterThan(10);
  });

  it('keeps every probability inside (0,1)', () => {
    const p = clearParlay('calc-4');
    for (let i = 0; i < 8; i++) {
      addLeg(p, { fixtureId: `f${i}`, description: 'd', league: 'EPL', market: 'HOME_WIN' as any, selection: 'h', probability: 0.9 });
    }
    const c = parlayCombinedProbability(p);
    expect(c).toBeGreaterThan(0);
    expect(c).toBeLessThan(1);
  });
});

/* ================================================================== *
 * Embed payloads
 * ================================================================== */
describe('parlay embeds', () => {
  it('renders an empty slip without leaking undefined', () => {
    const e = buildParlayEmbed(clearParlay('emb-1'), 'hello');
    const text = json(e);
    expect(text).not.toMatch(/undefined|NaN/);
    expect(text).toContain('No legs yet');
  });

  it('renders legs with probability and fair odds', () => {
    const p = clearParlay('emb-2');
    addLeg(p, { fixtureId: 'f1', description: 'A v B', league: 'EPL', market: 'HOME_WIN' as any, selection: 'Home Win', probability: 0.5 });
    const text = json(buildParlayEmbed(p));
    expect(text).toContain('A v B');
    expect(text).toContain('50.0%');
    expect(text).toContain('2.00x');
  });

  it('suppresses the combined figure for correlated slips', () => {
    const p = clearParlay('emb-3');
    addLeg(p, { fixtureId: 'f1', description: 'a', league: 'EPL', market: 'HOME_WIN' as any, selection: 'h', probability: 0.5 });
    addLeg(p, { fixtureId: 'f1', description: 'b', league: 'EPL', market: 'DRAW' as any, selection: 'd', probability: 0.5 });
    const text = json(buildParlayEmbed(p));
    expect(text).toContain('same match');
    expect(text).not.toContain('Combined probability:');
  });

  it('saved embed restates the slip snapshot', () => {
    const p = clearParlay('emb-4');
    addLeg(p, { fixtureId: 'f1', description: 'A v B', league: 'EPL', market: 'HOME_WIN' as any, selection: 'Home Win', probability: 0.5 });
    saveParlay(p);
    const text = json(buildSavedParlayEmbed(p));
    expect(text).toContain('Parlay Saved');
    expect(text).toContain('A v B');
  });

  it('respects Discord embed limits', () => {
    const p = clearParlay('emb-5');
    for (let i = 0; i < MAX_LEGS; i++) {
      addLeg(p, { fixtureId: `f${i}`, description: `Match ${i}`.repeat(10), league: 'EPL', market: 'HOME_WIN' as any, selection: 'Home Win', probability: 0.5 });
    }
    const d = buildParlayEmbed(p).data as any;
    expect((d.fields || []).length).toBeLessThanOrEqual(25);
    (d.fields || []).forEach((f: any) => expect(f.value.length).toBeLessThanOrEqual(1024));
  });

  it('builds a payload with league, match, market, actions and drop rows', () => {
    const p = clearParlay('emb-6');
    addLeg(p, { fixtureId: 'f1', description: 'A v B', league: 'EPL', market: 'HOME_WIN' as any, selection: 'Home Win', probability: 0.5 });
    const fixtures = [
      { id: 'f1', league: 'EPL', kickoffTime: '2026-10-17T15:00:00Z', homeTeam: { name: 'A' }, awayTeam: { name: 'B' } },
    ];
    const payload = buildParlayPayload(p, fixtures, { league: 'EPL' });
    expect(payload.components.length).toBeGreaterThanOrEqual(4);
    const ids = payload.components.flatMap((r: any) => r.toJSON().components).map((c: any) => c.custom_id);
    expect(ids).toContain('cp:parlay:league');
    expect(ids).toContain('cp:parlay:match');
    expect(ids).toContain('cp:parlay:market');
    expect(ids).toContain('cp:parlay:add');
    expect(ids).toContain('cp:parlay:save');
    expect(ids.some((i: string) => i.startsWith('cp:parlay:drop:'))).toBe(true);
    // Component hard limits.
    expect(payload.components.length).toBeLessThanOrEqual(5);
    payload.components.forEach((r: any) => expect(r.toJSON().components.length).toBeLessThanOrEqual(5));
  });

  it('disables the match selector when no fixtures exist', () => {
    const payload = buildParlayPayload(clearParlay('emb-7'), []);
    const menu = payload.components[1].toJSON().components[0];
    expect(menu.disabled).toBe(true);
    expect(menu.options[0].value).toBe('none');
  });

  it('offers the requested markets', () => {
    const values = MARKET_OPTIONS.map((m) => m.value);
    for (const v of ['HOME_WIN', 'DRAW', 'AWAY_WIN', 'OVER_2_5', 'UNDER_2_5', 'BTTS_YES']) {
      expect(values).toContain(v);
    }
  });

  it('builds a stake modal carrying the current stake', () => {
    const p = clearParlay('emb-8');
    setParlayStake(p, 25);
    const modal = buildStakeModal(p.stake);
    expect(modal.data.custom_id).toBe('cp:parlay:stake-modal');
  });
});

/* ================================================================== *
 * Analysis tabs
 * ================================================================== */
describe('match analysis tabs', () => {
  const analysis = makeAnalysis();

  it('renders all four tabs without undefined/NaN', () => {
    for (const tab of ['stats', 'probabilities', 'matrix', 'lineups'] as const) {
      const text = json(buildAnalysisEmbed(analysis, tab));
      expect(text, tab).not.toMatch(/undefined|NaN/);
      expect(text.length).toBeGreaterThan(0);
    }
  });

  it('defaults to the stats tab', () => {
    expect(buildAnalysisEmbed(analysis).data.title).toBe(buildStatsTab(analysis).data.title);
  });

  it('stats tab shows possession, xG, corners and cards', () => {
    const text = json(buildStatsTab(analysis));
    // Possession is shown rounded to whole percent in the headline bar.
    expect(text).toContain('58%');
    expect(text).toContain('42%');
    expect(text).toContain('1.85');   // xG home, two decimals
    expect(text).toContain('0.62');   // xG away
    expect(text).toContain('Possession');
    expect(text).toContain('Corners');
    expect(text).toContain('Cards');
  });

  it('renders N/A rather than a fabricated zero when stats are missing', () => {
    const noStats = makeAnalysis({ fixture: { ...analysis.fixture, statistics: null } as any });
    const text = json(buildStatsTab(noStats));
    expect(text).toContain('N/A');
    expect(text).toMatch(/No match statistics/i);
    expect(text).not.toMatch(/undefined|NaN/);
  });

  it('probabilities tab shows all three 1X2 outcomes and fair odds', () => {
    const text = json(buildProbabilitiesTab(analysis));
    expect(text).toContain('62.0%');
    expect(text).toContain('23.0%');
    expect(text).toContain('15.0%');
    expect(text).toMatch(/fair/i);
  });

  it('probabilities tab degrades honestly with no bookmaker odds', () => {
    const text = json(buildProbabilitiesTab(analysis, null));
    expect(text).toMatch(/unavailable/i);
  });

  it('probabilities tab shows an edge when market odds are supplied', () => {
    const text = json(buildProbabilitiesTab(analysis, { home: 2.2, draw: 3.6, away: 3.4 }));
    expect(text).toContain('Value vs market');
    expect(text).toMatch(/Edge|Overround/);
  });

  it('score matrix tab lists scores in descending probability', () => {
    const e = buildScoreMatrixTab(analysis);
    const d = e.data as any;
    const lines = String(d.description).split('\n').filter((l) => /^\`\d\`/.test(l));
    expect(lines.length).toBe(5);
    const pcts = lines.map((l) => parseFloat(l.match(/([\d.]+)%/)![1]));
    for (let i = 1; i < pcts.length; i++) expect(pcts[i]).toBeLessThanOrEqual(pcts[i - 1]);
    expect(lines[0]).toContain('2-1');
  });

  it('score matrix tab handles an empty matrix', () => {
    const empty = makeAnalysis({ scoreMatrix: [] as any });
    const text = json(buildScoreMatrixTab(empty));
    expect(text).toMatch(/No score matrix/i);
    expect(text).not.toMatch(/undefined|NaN/);
  });

  it('lineups tab shows form glyphs and a clear XI placeholder', () => {
    const text = json(buildLineupsTab(analysis));
    expect(text).toContain('🟢');   // home form has wins
    expect(text).toContain('🔴');   // away form has losses
    expect(text).toMatch(/not published/i);
  });

  it('tab bar marks exactly the active tab and disables it', () => {
    const payload = buildAnalysisPayload(analysis, 'matrix');
    const buttons = payload.components[0].toJSON().components;
    expect(buttons).toHaveLength(ANALYSIS_TABS.length);
    const active = buttons.filter((b: any) => b.disabled);
    expect(active).toHaveLength(1);
    expect(String((active[0] as any).custom_id)).toMatch(/:matrix$/);
  });

  it('link buttons carry a URL and never a custom id', () => {
    const payload = buildAnalysisPayload(analysis, 'stats');
    const all = payload.components.flatMap((r: any) => r.toJSON().components);
    for (const c of all) {
      if (c.style === 5) {
        expect(c.url, 'link button needs a url').toBeTruthy();
        expect(c.custom_id, 'link button must not have a custom id').toBeUndefined();
      }
    }
  });

  it('custom ids stay within Discord limits', () => {
    const payload = buildAnalysisPayload(analysis, 'stats');
    payload.components.flatMap((r: any) => r.toJSON().components).forEach((c: any) => {
      if (c.custom_id) expect(c.custom_id.length).toBeLessThanOrEqual(100);
    });
  });
});

/* ================================================================== *
 * Live tracker
 * ================================================================== */
describe('live tracker', () => {
  const analysis = makeAnalysis();

  it('renders the live embed with score and alert state', () => {
    const text = json(buildLiveMatchEmbed(analysis, true));
    expect(text).toContain('Home FC');
    expect(text).toContain('Alerts on');
    expect(text).not.toMatch(/undefined|NaN/);
    const muted = json(buildLiveMatchEmbed(analysis, false));
    expect(muted).toContain('Alerts off');
  });

  it('handles a fixture with no statistics', () => {
    const noStats = makeAnalysis({ fixture: { ...analysis.fixture, statistics: null } as any });
    const text = json(buildLiveMatchEmbed(noStats, true));
    expect(text).not.toMatch(/undefined|NaN/);
    expect(text).toMatch(/statistics published yet/i);
  });

  it('exposes Force Refresh, Live Stats and Toggle Alerts', () => {
    const row = buildLiveActionRow('999', true);
    const ids = row.toJSON().components.map((c: any) => c.custom_id);
    expect(ids).toContain('cp:live:refresh:999');
    expect(ids).toContain('cp:live:stats:999');
    expect(ids).toContain('cp:live:alerts:999');
  });

  it('changes the alerts button label with state', () => {
    const on = buildLiveActionRow('1', true).toJSON().components.find((c: any) => String(c.custom_id).startsWith('cp:live:alerts')) as any;
    const off = buildLiveActionRow('1', false).toJSON().components.find((c: any) => String(c.custom_id).startsWith('cp:live:alerts')) as any;
    expect(on!.label).toBe('Mute Alerts');
    expect(off!.label).toBe('Enable Alerts');
  });

  it('match selector lists fixtures and handles the empty case', () => {
    const fixtures = [{ id: 'f1', status: 'LIVE', league: 'EPL', homeTeam: { name: 'A' }, awayTeam: { name: 'B' } }];
    const row = buildLiveSelectRow(fixtures);
    expect(row.toJSON().components[0].options).toHaveLength(1);
    const empty = buildLiveSelectRow([]);
    expect(empty.toJSON().components[0].disabled).toBe(true);
    expect(empty.toJSON().components[0].options[0].value).toBe('none');
  });

  it('picker embed reports the match count', () => {
    expect(json(buildLivePickerEmbed(4))).toContain('4');
  });

  it('fingerprint is stable then changes with the score', () => {
    const a = liveFingerprint(analysis);
    expect(liveFingerprint(analysis)).toBe(a);
    const scored: any = JSON.parse(JSON.stringify(analysis));
    scored.fixture.homeScore = 5;
    expect(liveFingerprint(scored)).not.toBe(a);
  });

  it('fingerprint changes when a red card is shown', () => {
    const before = liveFingerprint(analysis);
    const withCard: any = JSON.parse(JSON.stringify(analysis));
    withCard.fixture.statistics.redCardsHome = 1;
    expect(liveFingerprint(withCard)).not.toBe(before);
  });

  it('registers, resolves and removes trackers', () => {
    registerTracker({
      channelId: 'c1', messageId: 'm1', fixtureId: 'f1', userId: 'u1',
      alertsEnabled: true, fingerprint: 'x', updatedAt: 0,
    });
    expect(findTrackerByCustomId('cp:live:refresh:m1')?.action).toBe('refresh');
    expect(findTrackerByCustomId('cp:live:stats:m1')?.action).toBe('stats');
    expect(findTrackerByCustomId('cp:live:alerts:m1')?.action).toBe('alerts');
    expect(findTrackerByCustomId('cp:live:refresh:other')).toBeNull();
    expect(findTrackerByCustomId('cp:nav:fixtures')).toBeNull();
    expect(findTrackerByCustomId('garbage')).toBeNull();
    expect(removeTracker('m1')).toBe(true);
    expect(findTrackerByCustomId('cp:live:refresh:m1')).toBeNull();
  });
});

/* ================================================================== *
 * Dashboard
 * ================================================================== */
describe('dashboard launcher', () => {
  it('produces a link button plus an embedded-app link', () => {
    const payload = buildDashboardPayload('https://example.test');
    const all = payload.components.flatMap((r: any) => r.toJSON().components);
    const links = all.filter((c: any) => c.style === 5);
    expect(links.some((c: any) => c.url === 'https://example.test')).toBe(true);
    expect(links.some((c: any) => c.url.includes('iframe=true'))).toBe(true);
    for (const c of links) expect(c.custom_id).toBeUndefined();
  });

  it('embeds are branded', () => {
    const payload = buildDashboardPayload('https://example.test');
    expect(json(payload.embeds[0])).toContain('Cape Predictor');
  });

  it('resolves the dashboard url from PUBLIC_URL', () => {
    expect(dashboardUrl({ PUBLIC_URL: 'https://capepredictor.app/' })).toBe('https://capepredictor.app');
  });
});