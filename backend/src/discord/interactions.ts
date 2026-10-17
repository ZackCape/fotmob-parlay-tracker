import {
  EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder,
  ButtonStyle, StringSelectMenuOptionBuilder,
} from 'discord.js';
import { DataProviderFactory } from '../providers/provider-factory.js';
import { isVerifiedFixture } from '../utils/fixtureValidation.js';
import { buildStatisticalParlay } from '../parlays/parlay-builder.js';
import { MarketPrediction, MarketType } from '../types/football.js';

/* ------------------------------------------------------------------ *
 * Cape Predictor brand constants
 * ------------------------------------------------------------------ */
export const BRAND = {
  author: 'Cape Predictor • Football Intelligence',
  tagline: 'Smarter Predictions',
  accent: 0x2563EB, // restrained blue
  positive: 0x16A34A,
  negative: 0xDC2626,
  neutral: 0x6B7280,
  footer: 'Cape Predictor Engine • Powered by Dixon-Coles Probability Engine',
};

/* ------------------------------------------------------------------ *
 * League catalogue for the interactive selector
 * ------------------------------------------------------------------ */
export interface LeagueOption {
  id: string;          // internal league code or 'ALL'
  label: string;
  description: string;
}

export const LEAGUE_OPTIONS: LeagueOption[] = [
  { id: 'ALL', label: "All Today's Matches", description: 'Every verified match today' },
  { id: 'EPL', label: 'Premier League', description: 'English top flight' },
  { id: 'LALIGA', label: 'La Liga', description: 'Spanish top flight' },
  { id: 'SERIE_A', label: 'Serie A', description: 'Italian top flight' },
  { id: 'BUNDESLIGA', label: 'Bundesliga', description: 'German top flight' },
  { id: 'LIGUE1', label: 'Ligue 1', description: 'French top flight' },
  { id: 'CHAMPIONS_LEAGUE', label: 'Champions League', description: 'European club competition' },
  { id: 'CHAMPIONSHIP', label: 'Championship', description: 'English second tier' },
];

export function baseEmbed(title: string, description?: string): EmbedBuilder {
  const e = new EmbedBuilder()
    .setColor(BRAND.accent)
    .setAuthor({ name: BRAND.author })
    .setTitle(title)
    .setFooter({ text: BRAND.footer })
    .setTimestamp(new Date());
  if (description) e.setDescription(description);
  return e;
}

/* ------------------------------------------------------------------ *
 * /fixtures : league selector
 * ------------------------------------------------------------------ */
export function buildLeagueSelectRow(): ActionRowBuilder<StringSelectMenuBuilder> {
  const menu = new StringSelectMenuBuilder()
    .setCustomId('cp:fixtures:league')
    .setPlaceholder('Select a league…')
    .addOptions(
      LEAGUE_OPTIONS.map((l) =>
        new StringSelectMenuOptionBuilder()
          .setLabel(l.label)
          .setValue(l.id)
          .setDescription(l.description)),
    );
  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu);
}

export function leaguePickerEmbed(): EmbedBuilder {
  return baseEmbed('Fixtures • Select a League',
    `*${BRAND.tagline}*\nChoose a competition below to see today's verified fixtures with model win / draw / away probabilities.`);
}

/** Fetch verified fixtures for a league. */
export async function fetchVerifiedFixtures(factory: DataProviderFactory, date: string, league: string) {
  const all = await factory.getFixturesByDate(date, league === 'ALL' ? 'ALL' : league);
  return all.filter(isVerifiedFixture);
}

function statusEmoji(status: string): string {
  if (status === 'LIVE') return '\u{1F534}';
  if (status === 'FINISHED') return '\u26BD';
  if (status === 'POSTPONED') return '\u23F8';
  return '\u23F3';
}

function formatKickoff(iso: string): string {
  if (!iso) return 'TBC';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return 'TBC';
  return `<t:${Math.floor(d.getTime() / 1000)}:t>`;
}

/** Build an embed of match cards with model probabilities. */
export function buildFixturesEmbed(
  fixtures: any[],
  predictionsByFixture: Map<string, MarketPrediction[]>,
  leagueLabel: string,
): EmbedBuilder {
  const e = baseEmbed(`Fixtures • ${leagueLabel}`,
    `*${BRAND.tagline}* • ${fixtures.length} verified match${fixtures.length === 1 ? '' : 'es'}`);

  if (!fixtures.length) {
    e.setDescription('No verified fixtures are available for this league today. Providers may be rate-limited or the league may be out of season.');
    return e;
  }

  const lines = fixtures.slice(0, 12).map((f, i) => {
    const preds = predictionsByFixture.get(f.id) || [];
    const probs = ['HOME_WIN', 'DRAW', 'AWAY_WIN']
      .map((m) => preds.find((p) => p.market === m))
      .filter(Boolean)
      .map((p) => `${(p!.estimatedProbability * 100).toFixed(0)}%`)
      .join(' / ');
    const score = f.status === 'FINISHED' ? ` **${f.homeScore}-${f.awayScore}**` : '';
    return `\`${String(i + 1).padStart(2, '0')}\` ${statusEmoji(f.status)} **${f.homeTeam.name}** vs **${f.awayTeam.name}**${score}\n     ${f.league} • ${formatKickoff(f.kickoffTime)}${probs ? ` • H/D/A ${probs}` : ''}`;
  });

  e.setDescription(lines.join('\n'));
  e.setFooter({ text: `${BRAND.footer} • H/D/A = model estimate` });
  return e;
}

/** Action row with Analyse / Track buttons for the first visible fixture. */
export function buildFixtureActionRows(fixtures: any[]): ActionRowBuilder<ButtonBuilder>[] {
  const target = fixtures[0];
  if (!target) return [];
  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`cp:analyze:${target.id}`)
        .setLabel('Analyze')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(`cp:track:${target.id}`)
        .setLabel('Track Live')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId('cp:nav:fixtures')
        .setLabel('Change League')
        .setStyle(ButtonStyle.Secondary),
    ),
  ];
}

/* ------------------------------------------------------------------ *
 * /customparlay : user-built slip
 * ------------------------------------------------------------------ */
export interface ParlayLeg {
  fixtureId: string;
  description: string;
  market: MarketType;
  selection: string;
  probability: number;
}

export interface CustomParlay {
  ownerId: string;
  legs: ParlayLeg[];
  createdAt: number;
  saved: boolean;
}

const parlayStore = new Map<string, CustomParlay>();

/** Fixture the user picked in the "match" dropdown, pending a market choice. */
export const pendingMatch = new Map<string, string>();

export function getParlay(ownerId: string): CustomParlay {
  let p = parlayStore.get(ownerId);
  if (!p) {
    p = { ownerId, legs: [], createdAt: Date.now(), saved: false };
    parlayStore.set(ownerId, p);
  }
  return p;
}

export const MARKET_OPTIONS: Array<{ value: MarketType; label: string; description: string }> = [
  { value: 'HOME_WIN', label: 'Home Win', description: '1 (home team to win)' },
  { value: 'DRAW', label: 'Draw', description: 'X (level after 90 mins)' },
  { value: 'AWAY_WIN', label: 'Away Win', description: '2 (away team to win)' },
  { value: 'OVER_2_5', label: 'Over 2.5 Goals', description: 'More than 2.5 goals' },
  { value: 'UNDER_2_5', label: 'Under 2.5 Goals', description: 'Fewer than 2.5 goals' },
  { value: 'BTTS_YES', label: 'BTTS Yes', description: 'Both teams to score' },
  { value: 'DOUBLE_CHANCE_1X', label: 'Home or Draw', description: 'Double chance 1X' },
];

export function buildMatchSelectRow(fixtures: any[]): ActionRowBuilder<StringSelectMenuBuilder> {
  const menu = new StringSelectMenuBuilder()
    .setCustomId('cp:parlay:match')
    .setPlaceholder('Select a match for your slip…')
    .addOptions(
      fixtures.slice(0, 25).map((f) =>
        new StringSelectMenuOptionBuilder()
          .setLabel(`${f.homeTeam.name} v ${f.awayTeam.name}`.slice(0, 100))
          .setValue(f.id)
          .setDescription(`${f.league} • ${new Date(f.kickoffTime).toISOString().slice(11, 16)} UTC`)),
    );
  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu);
}

export function buildMarketSelectRow(): ActionRowBuilder<StringSelectMenuBuilder> {
  const menu = new StringSelectMenuBuilder()
    .setCustomId('cp:parlay:market')
    .setPlaceholder('Select a market…')
    .addOptions(
      MARKET_OPTIONS.map((m) =>
        new StringSelectMenuOptionBuilder().setLabel(m.label).setValue(m.value).setDescription(m.description)),
    );
  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu);
}

export function buildParlayActionRows(disabled = false): ActionRowBuilder<ButtonBuilder>[] {
  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId('cp:parlay:add').setLabel('Add Leg').setStyle(ButtonStyle.Primary).setDisabled(disabled),
      new ButtonBuilder().setCustomId('cp:parlay:save').setLabel('Save Parlay').setStyle(ButtonStyle.Success).setDisabled(disabled),
      new ButtonBuilder().setCustomId('cp:parlay:clear').setLabel('Clear').setStyle(ButtonStyle.Danger),
    ),
  ];
}

export function addLeg(parlay: CustomParlay, leg: ParlayLeg): { ok: boolean; reason?: string } {
  if (parlay.legs.length >= 10) return { ok: false, reason: 'Maximum 10 legs per slip.' };
  if (parlay.legs.some((l) => l.fixtureId === leg.fixtureId && l.market === leg.market)) {
    return { ok: false, reason: 'That market is already on your slip for this match.' };
  }
  parlay.legs.push(leg);
  return { ok: true };
}

export function parlayCombinedProbability(parlay: CustomParlay): number {
  return parlay.legs.reduce((acc, l) => acc * Math.max(0.001, l.probability), 1);
}

export function parlayImpliedOdds(parlay: CustomParlay): number | null {
  const p = parlayCombinedProbability(parlay);
  return p > 0 ? 1 / p : null;
}

export function buildParlayEmbed(parlay: CustomParlay, notice?: string): EmbedBuilder {
  const e = baseEmbed('Custom Parlay', `*${BRAND.tagline}* — build your own potential parlay`);
  if (notice) e.setDescription(`> ${notice}`);

  if (!parlay.legs.length) {
    e.addFields({ name: 'Your slip', value: 'No legs yet.\nUse the dropdowns below to select a match and a market, then press **➕ Add Leg**.', inline: false });
    return e;
  }

  const legsText = parlay.legs
    .map((l, i) => `\`${i + 1}\` **${l.description}**\n     ${l.selection} • model ${(l.probability * 100).toFixed(1)}% • fair ${(1 / Math.max(0.001, l.probability)).toFixed(2)}x`)
    .join('\n');

  const combined = parlayCombinedProbability(parlay);
  const odds = parlayImpliedOdds(parlay);

  e.addFields(
    { name: `Slip (${parlay.legs.length} leg${parlay.legs.length === 1 ? '' : 's'})`, value: legsText.slice(0, 1024), inline: false },
    {
      name: 'Combined (model estimate)',
      value: [
        `Combined probability: **${(combined * 100).toFixed(2)}%**`,
        `Model-implied fair odds: **${odds ? odds.toFixed(2) : 'n/a'}x**`,
        parlay.saved ? 'Status: **saved for live tracking**' : 'Status: draft',
        'Not bookmaker odds. Estimates only — never a guaranteed win.',
      ].join('\n'),
      inline: false,
    },
  );
  return e;
}

/* ------------------------------------------------------------------ *
 * /livetracking : match selector (no manual IDs)
 * ------------------------------------------------------------------ */
export function buildLiveSelectRow(fixtures: any[]): ActionRowBuilder<StringSelectMenuBuilder> {
  const menu = new StringSelectMenuBuilder()
    .setCustomId('cp:live:match')
    .setPlaceholder('Select a live or upcoming match to track…')
    .addOptions(
      fixtures.slice(0, 25).map((f) =>
        new StringSelectMenuOptionBuilder()
          .setLabel(`${f.status === 'LIVE' ? '\u{1F534} ' : ''}${f.homeTeam.name} v ${f.awayTeam.name}`.slice(0, 100))
          .setValue(f.id)
          .setDescription(`${f.league} • ${f.status}`)),
    );
  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu);
}

export interface LiveSubscription {
  channelId: string;
  fixtureId: string;
  description: string;
  subscribedAt: number;
}

const liveSubs = new Map<string, LiveSubscription>();
const subsKey = (channelId: string) => `live:${channelId}`;

export function subscribeLive(channelId: string, fixtureId: string, description: string): LiveSubscription {
  const sub = { channelId, fixtureId, description, subscribedAt: Date.now() };
  liveSubs.set(subsKey(channelId), sub);
  return sub;
}

export function unsubscribeLive(channelId: string): boolean {
  return liveSubs.delete(subsKey(channelId));
}

export function getLiveSubscription(channelId: string): LiveSubscription | undefined {
  return liveSubs.get(subsKey(channelId));
}

export function allLiveSubscriptions(): LiveSubscription[] {
  return [...liveSubs.values()];
}

export function buildLiveTrackingEmbed(fixtures: any[]): EmbedBuilder {
  return baseEmbed('Live Tracking',
    `*${BRAND.tagline}*\nSelect a match below — no manual IDs needed. Cape Predictor will post score and status changes for it in this channel.`);
}

/* ------------------------------------------------------------------ *
 * /help : navigation buttons
 * ------------------------------------------------------------------ */
export const HELP_BUTTONS: Array<{ id: string; label: string }> = [
  { id: 'cp:nav:fixtures', label: 'Fixtures' },
  { id: 'cp:nav:parlay', label: 'Custom Parlay' },
  { id: 'cp:nav:live', label: 'Live Tracking' },
  { id: 'cp:nav:settings', label: 'Settings' },
];

export function buildHelpRow(): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    HELP_BUTTONS.map((h) =>
      new ButtonBuilder().setCustomId(h.id).setLabel(h.label).setStyle(ButtonStyle.Secondary)),
  );
}

export function buildHelpEmbed(): EmbedBuilder {
  const e = baseEmbed('Cape Predictor • Command Directory',
    `*${BRAND.tagline}*\nStatistical football intelligence powered by a Dixon-Coles probability engine and real verified fixture data.`);
  e.addFields(
    { name: '⚽ Fixtures', value: '`/fixtures` — pick a league, see kickoff times and H/D/A model probabilities.', inline: false },
    { name: '🎯 Predictions', value: '`/fixtures` shows per-match model estimates. `/parlay` builds a statistical slip.', inline: false },
    { name: '🎟️ Custom Parlay', value: '`/customparlay` — pick your own matches and markets, save the slip.', inline: false },
    { name: '📡 Live Tracking', value: '`/livetracking` — select a match and receive score/status updates.', inline: false },
    { name: '⚙️ Settings', value: '`/interval` set broadcast cadence • `/channel` link a channel.', inline: false },
  );
  return e;
}

/* ------------------------------------------------------------------ *
 * Interval recalibration
 * ------------------------------------------------------------------ */
export type Interval = '5m' | '15m' | '30m' | '45m' | '1h';

export function cronForInterval(interval: Interval): string {
  switch (interval) {
    case '5m': return '*/5 * * * *';
    case '15m': return '*/15 * * * *';
    case '30m': return '*/30 * * * *';
    case '45m': return '*/45 * * * *';
    case '1h': return '0 * * * *';
    default: return '0 * * * *';
  }
}

/**
 * Auto-recalibrate the broadcast cadence based on match activity:
 * live matches -> 5m, matches today -> 15m, otherwise the configured interval.
 */
export function recalibrateInterval(fixtures: any[], configured: Interval): Interval {
  const hasLive = fixtures.some((f) => f.status === 'LIVE');
  if (hasLive) return '5m';
  const upcoming = fixtures.some((f) => f.status === 'TIMED');
  if (upcoming) return '15m';
  return configured;
}

export { buildStatisticalParlay };
