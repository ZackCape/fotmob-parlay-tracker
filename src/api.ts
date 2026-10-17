import { Fixture, MatchAnalysis, StatisticalParlay, ParlayLegCount, ParlayMode, LiveTrackedParlay, ModelPerformanceReport, SystemStatus, MarketPrediction } from './types';

const API_BASE = '/api';

export async function fetchFixtures(date: string, league: string = 'ALL'): Promise<{ count: number; fixtures: Fixture[] }> {
  const res = await fetch(`${API_BASE}/fixtures?date=${encodeURIComponent(date)}&league=${encodeURIComponent(league)}`);
  if (!res.ok) throw new Error(`Failed to fetch fixtures: ${res.statusText}`);
  return res.json();
}

export async function fetchMatchAnalysis(fixtureId: string): Promise<MatchAnalysis> {
  const res = await fetch(`${API_BASE}/analysis/${encodeURIComponent(fixtureId)}`);
  if (!res.ok) throw new Error(`Failed to fetch match analysis: ${res.statusText}`);
  return res.json();
}

export async function generateParlay(options: {
  date: string;
  legsCount: ParlayLegCount;
  mode?: ParlayMode;
  minProbability?: number;
  allowedMarkets?: string[];
  leagueFilter?: string;
}): Promise<StatisticalParlay> {
  const res = await fetch(`${API_BASE}/parlays/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(options),
  });
  if (!res.ok) throw new Error(`Failed to generate parlay: ${res.statusText}`);
  return res.json();
}

export async function trackParlay(parlay: StatisticalParlay): Promise<LiveTrackedParlay> {
  const res = await fetch(`${API_BASE}/parlays/track`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ parlay }),
  });
  if (!res.ok) throw new Error(`Failed to track parlay: ${res.statusText}`);
  const data = await res.json();
  return data.tracked;
}

export async function fetchLiveTrackedParlays(): Promise<{ activeParlays: LiveTrackedParlay[] }> {
  const res = await fetch(`${API_BASE}/parlays/live`);
  if (!res.ok) throw new Error(`Failed to fetch live parlays: ${res.statusText}`);
  return res.json();
}

export async function fetchLiveParlayById(id: string): Promise<LiveTrackedParlay> {
  const res = await fetch(`${API_BASE}/parlays/live/${encodeURIComponent(id)}`);
  if (!res.ok) throw new Error(`Failed to fetch live parlay: ${res.statusText}`);
  const data = await res.json();
  return data.tracked;
}

export async function simulateLiveTick(id: string): Promise<LiveTrackedParlay> {
  const res = await fetch(`${API_BASE}/parlays/live/${encodeURIComponent(id)}/tick`, {
    method: 'POST',
  });
  if (!res.ok) throw new Error(`Failed to simulate match motion: ${res.statusText}`);
  const data = await res.json();
  return data.tracked;
}

export async function fetchHistoricalPredictions(): Promise<{ total: number; predictions: MarketPrediction[] }> {
  const res = await fetch(`${API_BASE}/predictions/history`);
  if (!res.ok) throw new Error(`Failed to fetch predictions history: ${res.statusText}`);
  return res.json();
}

export async function fetchModelPerformance(): Promise<ModelPerformanceReport> {
  const res = await fetch(`${API_BASE}/model/performance`);
  if (!res.ok) throw new Error(`Failed to fetch model performance: ${res.statusText}`);
  return res.json();
}

export async function fetchSystemStatus(): Promise<SystemStatus> {
  const res = await fetch(`${API_BASE}/system/status`);
  if (!res.ok) throw new Error(`Failed to fetch system status: ${res.statusText}`);
  return res.json();
}

export async function fetchDiscordStatus(): Promise<{
  botEnabled: boolean;
  botReady: boolean;
  botTag?: string | null;
  guildsCount?: number;
  webhookConfigured: boolean;
  hourlyScheduleActive: boolean;
  lastBroadcastTime: string | null;
  activeChannelId?: string | null;
  updateInterval?: string;
}> {
  const res = await fetch(`${API_BASE}/discord/status`);
  if (!res.ok) throw new Error(`Failed to fetch Discord status: ${res.statusText}`);
  return res.json();
}

export async function triggerDiscordBroadcast(): Promise<{ success: boolean; message: string }> {
  const res = await fetch(`${API_BASE}/discord/broadcast`, { method: 'POST' });
  if (!res.ok) throw new Error(`Discord broadcast failed: ${res.statusText}`);
  return res.json();
}

export async function configureDiscord(config: { channelId?: string; interval?: string }): Promise<any> {
  const res = await fetch(`${API_BASE}/discord/configure`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(config),
  });
  if (!res.ok) throw new Error(`Failed to configure Discord: ${res.statusText}`);
  return res.json();
}

export interface FootballNewsArticle {
  id: string;
  title: string;
  summary: string;
  url: string;
  source: string;
  publishedAt: string;
  imageUrl?: string;
  tag?: string;
}

export async function fetchNews(): Promise<{ success: boolean; count: number; articles: FootballNewsArticle[] }> {
  const res = await fetch(`${API_BASE}/news`);
  if (!res.ok) throw new Error(`Failed to fetch news: ${res.statusText}`);
  return res.json();
}

export async function fetchLearningStats(): Promise<any> {
  const res = await fetch(`${API_BASE}/learning/stats`);
  if (!res.ok) throw new Error(`Failed to fetch learning stats: ${res.statusText}`);
  return res.json();
}

export async function fetchLearningEvents(): Promise<any> {
  const res = await fetch(`${API_BASE}/learning/events`);
  if (!res.ok) throw new Error(`Failed to fetch learning events: ${res.statusText}`);
  return res.json();
}


