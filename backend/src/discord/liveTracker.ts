import {
  EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder,
  ButtonStyle, StringSelectMenuOptionBuilder,
} from 'discord.js';
import { MatchAnalysis } from '../types/football.js';
import { BRAND } from './brand.js';
import { buildStatsTab } from './analysisEmbeds.js';

/* ------------------------------------------------------------------ *
 * Live match tracker with auto-refreshing embeds
 * ------------------------------------------------------------------ */

export interface LiveTracker {
  /** Message being kept up to date. */
  channelId: string;
  messageId: string;
  fixtureId: string;
  userId: string;
  /** Whether the user wants score-change pushes. */
  alertsEnabled: boolean;
  /** Fingerprint of the last rendered state, so we only edit on change. */
  fingerprint: string;
  updatedAt: number;
}

const trackers = new Map<string, LiveTracker>();
const key = (messageId: string) => `live-msg:${messageId}`;

export function registerTracker(t: LiveTracker): void {
  trackers.set(key(t.messageId), t);
}

export function getTracker(messageId: string): LiveTracker | undefined {
  return trackers.get(key(messageId));
}

export function removeTracker(messageId: string): boolean {
  return trackers.delete(key(messageId));
}

export function allTrackers(): LiveTracker[] {
  return [...trackers.values()];
}

/** Find a tracker by the custom id payload of one of its buttons. */
export function findTrackerByCustomId(customId: string): { tracker: LiveTracker; action: string; arg?: string } | null {
  // cp:live:refresh:<messageId> | cp:live:stats:<messageId> | cp:live:alerts:<messageId>
  const parts = customId.split(':');
  if (parts[0] !== 'cp' || parts[1] !== 'live') return null;
  const action = parts[2];
  const messageId = parts[3];
  if (!action || !messageId) return null;
  const tracker = trackers.get(key(messageId));
  if (!tracker) return null;
  return { tracker, action, arg: parts[4] };
}

/**
 * State fingerprint. The embed is only edited when this changes, which avoids
 * hammering the Discord API (and avoids needless "user edited" churn).
 */
export function liveFingerprint(analysis: MatchAnalysis): string {
  const f = analysis.fixture;
  const s = f.statistics;
  return [
    f.status,
    f.homeScore ?? '-',
    f.awayScore ?? '-',
    s?.possessionHome ?? '-',
    s?.shotsHome ?? '-',
    s?.shotsAway ?? '-',
    s?.yellowCardsHome ?? '-',
    s?.redCardsHome ?? '-',
    s?.redCardsAway ?? '-',
    analysis.lineups?.home?.isConfirmed ?? false,
  ].join('|');
}

function statLabel(f: any): string {
  if (f.status === 'FINISHED') return 'Full Time';
  if (f.status === 'LIVE') return 'In Play';
  if (f.status === 'POSTPONED') return 'Postponed';
  return 'Scheduled';
}

function bar(ratio: number, width = 10): string {
  const filled = Math.max(0, Math.min(width, Math.round(ratio * width)));
  return '█'.repeat(filled) + '░'.repeat(width - filled);
}

function n(value: unknown): string {
  if (value === null || value === undefined || value === '') return 'N/A';
  const num = Number(value);
  return Number.isFinite(num) ? String(Math.round(num)) : 'N/A';
}

/* ------------------------------------------------------------------ *
 * Embeds
 * ------------------------------------------------------------------ */

export function buildLiveSelectRow(fixtures: any[]): ActionRowBuilder<StringSelectMenuBuilder> {
  const options = fixtures.slice(0, 25).map((f) =>
    new StringSelectMenuOptionBuilder()
      .setLabel(`${f.status === 'LIVE' ? '\u{1F534} ' : ''}${f.homeTeam.name} v ${f.awayTeam.name}`.slice(0, 100))
      .setValue(f.id)
      .setDescription(`${f.league} • ${statLabel(f)}`));

  const menu = new StringSelectMenuBuilder()
    .setCustomId('cp:live:match')
    .setPlaceholder(options.length ? 'Select a match to track live…' : 'No live or upcoming matches')
    .addOptions(options.length ? options : [
      new StringSelectMenuOptionBuilder().setLabel('No matches available').setValue('none').setDescription('Try again later'),
    ])
    .setDisabled(options.length === 0);

  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu);
}

export function buildLivePickerEmbed(fixtureCount: number): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(BRAND.accent)
    .setAuthor({ name: BRAND.author })
    .setTitle('📡 Live Tracking')
    .setDescription(
      `*${BRAND.tagline}*\n` +
      `Select a match below — no manual IDs needed. Cape Predictor keeps an embed in this thread up to date with scores, cards and stats.\n\n` +
      `\`${fixtureCount}\` trackable match${fixtureCount === 1 ? '' : 'es'} available.`,
    )
    .setFooter({ text: BRAND.footer })
    .setTimestamp(new Date());
}

/**
 * Format a live match line with elapsed minute:
 *   🔴 LIVE 62' — Arsenal 2 - 1 Chelsea `Premier League`
 */
function formatLiveLine(f: any): string {
  const home = f.homeTeam.name;
  const away = f.awayTeam.name;
  const score = `${f.homeScore ?? '-'} - ${f.awayScore ?? '-'}`;
  // Elapsed minute from statistics possessionHome hack if present, else just show status.
  const s = f.statistics;
  const minute = (s && typeof s.possessionHome === 'number') ? ` ${Math.round(s.possessionHome)}'` : '';
  return `🔴 LIVE${minute} — **${home}** ${score} **${away}** \`${f.league}\``;
}

/**
 * Recent event line for a live match, derived from ESPN keyEvents when
 * available, else a neutral placeholder.
 *   > **Recent Event:** ⚽ *Goal by Bukayo Saka (58')*
 */
function formatRecentEvent(f: any): string {
  const events = f.statistics?.recentEvents ?? f._recentEvents ?? [];
  const latest = events?.[events.length - 1];
  if (!latest) {
    return `> **Recent Event:** \`No events yet\``;
  }
  const type = latest.type ?? 'Event';
  const player = latest.player ?? 'Unknown';
  const minute = latest.minute ?? '?';
  let emoji = '⚽';
  const t = String(type).toLowerCase();
  if (t.includes('card')) emoji = '🟥';
  else if (t.includes('sub')) emoji = '🔄';
  return `> **Recent Event:** ${emoji} *${type} by ${player} (${minute}')*`;
}

/**
 * Stats line for a live match:
 *   > **Stats:** `Possession 54% - 46%` | `Shots on Target 6 - 3`
 */
function formatLiveStats(f: any): string {
  const s = f.statistics;
  if (!s) {
    return `> **Stats:** \`No stats yet\``;
  }
  const homePoss = Number.isFinite(Number(s.possessionHome)) ? Math.round(s.possessionHome) : '-';
  const awayPoss = Number.isFinite(Number(s.possessionAway)) ? Math.round(s.possessionAway) : '-';
  const homeSot = Number.isFinite(Number(s.shotsOnTargetHome)) ? Math.round(s.shotsOnTargetHome) : '-';
  const awaySot = Number.isFinite(Number(s.shotsOnTargetAway)) ? Math.round(s.shotsOnTargetAway) : '-';
  return `> **Stats:** \`Possession ${homePoss}% - ${awayPoss}%\` | \`Shots on Target ${homeSot} - ${awaySot}\``;
}

/** Embed listing all matches currently being played in real time. */
export function buildLiveMatchesEmbed(fixtures: any[]): EmbedBuilder {
  const e = new EmbedBuilder()
    .setColor(BRAND.accent)
    .setAuthor({ name: BRAND.author })
    .setTitle('🔴 Cape Predictor — Live Matches')
    .setFooter({ text: BRAND.footer })
    .setTimestamp(new Date());

  if (!fixtures.length) {
    e.setDescription(
      `*${BRAND.tagline}*\n` +
      'No matches are currently in progress. Use `/fixtures` to view upcoming scheduled matches.',
    );
    return e;
  }

  const lines = fixtures.map((f) => {
    return `${formatLiveLine(f)}\n${formatRecentEvent(f)}\n${formatLiveStats(f)}`;
  });

  e.setDescription(
    `*${BRAND.tagline}*\n` +
    `All matches currently in progress. Use the buttons below each match to track it.\n\n` +
    lines.join('\n\n'),
  );
  return e;
}

/** Track + stats + refresh button rows: up to 3 buttons per live match,
 * packed into Discord action rows (max 5 components per row).
 *
 *   [ ⚡ Track Match ]  (Primary)   one-click live tracking
 *   [ 📊 Live Match Stats ] (Secondary)  full possession/shots/corners
 *   [ 🔄 Refresh ]  (Secondary)  re-fetch live scores
 */
export function buildLiveActionRows(fixtures: any[]): ActionRowBuilder<ButtonBuilder>[] {
  const rows: ActionRowBuilder<ButtonBuilder>[] = [];
  let row = new ActionRowBuilder<ButtonBuilder>();

  const push = (b: ButtonBuilder) => {
    if (row.toJSON().components.length >= 5) {
      rows.push(row);
      row = new ActionRowBuilder<ButtonBuilder>();
    }
    row.addComponents(b);
  };

  for (const f of fixtures) {
    const label = `Track ${f.homeTeam.name.slice(0, 8)} v ${f.awayTeam.name.slice(0, 8)}`.slice(0, 80);
    push(
      new ButtonBuilder()
        .setCustomId(`cp:live:track:${f.id}`)
        .setLabel(label)
        .setEmoji('⚡')
        .setStyle(ButtonStyle.Primary),
    );
    push(
      new ButtonBuilder()
        .setCustomId(`cp:live:lstats:${f.id}`)
        .setLabel('Stats')
        .setEmoji('📊')
        .setStyle(ButtonStyle.Secondary),
    );
    push(
      new ButtonBuilder()
        .setCustomId(`cp:live:lrefresh:${f.id}`)
        .setLabel('Refresh')
        .setEmoji('🔄')
        .setStyle(ButtonStyle.Secondary),
    );
  }

  if (row.toJSON().components.length > 0) {
    rows.push(row);
  }

  return rows;
}

/** Keep the old name as an alias for callers that still reference it. */
export function buildLiveTrackRows(fixtures: any[]): ActionRowBuilder<ButtonBuilder>[] {
  return buildLiveActionRows(fixtures);
}

/** Per-match tracking embed action row: Track Match, Live Stats, Refresh. */
export function buildLiveActionRow(messageId: string, alertsEnabled: boolean): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`cp:live:track:${messageId}`)
      .setLabel('Track Match')
      .setEmoji('⚡')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`cp:live:stats:${messageId}`)
      .setLabel('Live Match Stats')
      .setEmoji('📊')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`cp:live:refresh:${messageId}`)
      .setLabel('Refresh')
      .setEmoji('🔄')
      .setStyle(ButtonStyle.Secondary),
  );
}

/** The auto-refreshing live match embed. */
export function buildLiveMatchEmbed(analysis: MatchAnalysis, alertsEnabled: boolean): EmbedBuilder {
  const f = analysis.fixture;
  const home = f.homeTeam.name;
  const away = f.awayTeam.name;
  const s = f.statistics;

  const e = new EmbedBuilder()
    .setColor(f.status === 'LIVE' ? BRAND.accent : f.status === 'FINISHED' ? BRAND.neutral : BRAND.neutral)
    .setAuthor({ name: BRAND.author })
    .setTitle(`🔴 ${home} ${f.homeScore ?? '-'} — ${f.awayScore ?? '-'} ${away}`)
    .setTimestamp(new Date());

  e.setDescription(
    `**${statLabel(f)}** • ${f.league} • ${alertsEnabled ? '🔔 Alerts on' : '🔕 Alerts off'}\n` +
    `Updated <t:${Math.floor(Date.now() / 1000)}:R>`,
  );

  if (!s) {
    e.addFields({
      name: 'Live stats',
      value: 'No match statistics published yet. This embed will update automatically when data arrives.',
      inline: false,
    });
  } else {
    const poss = Number.isFinite(Number(s.possessionHome)) && s.possessionHome !== null
      ? `\n\`${home}\` ${bar(Math.max(0, Math.min(1, Number(s.possessionHome) / 100)))} \`${away}\`\n${n(s.possessionHome)}% — ${n(s.possessionAway)}%`
      : '\nPossession N/A';

    e.addFields(
      { name: 'Shots', value: `${n(s.shotsHome)} — ${n(s.shotsAway)}`, inline: true },
      { name: 'On Target', value: `${n(s.shotsOnTargetHome)} — ${n(s.shotsOnTargetAway)}`, inline: true },
      { name: 'xG', value: `${Number.isFinite(Number(s.xgHome)) ? Number(s.xgHome).toFixed(2) : 'N/A'} — ${Number.isFinite(Number(s.xgAway)) ? Number(s.xgAway).toFixed(2) : 'N/A'}`, inline: true },
      { name: 'Corners', value: `${n(s.cornersHome)} — ${n(s.cornersAway)}`, inline: true },
      { name: 'Cards 🟨', value: `${n(s.yellowCardsHome)} — ${n(s.yellowCardsAway)}`, inline: true },
      { name: 'Red 🟥', value: `${n(s.redCardsHome)} — ${n(s.redCardsAway)}`, inline: true },
    );
    e.addFields({ name: 'Possession', value: poss, inline: false });
  }

  // Model view, mirroring the dashboard's live analysis.
  const dc = analysis.dixonColesParameters;
  if (dc) {
    e.addFields({
      name: 'Model view',
      value:
        `Expected goals **${Number(dc.homeExpectedGoals).toFixed(2)}** — **${Number(dc.awayExpectedGoals).toFixed(2)}**\n` +
        `Pre-match 1X2: ` + ['HOME_WIN', 'DRAW', 'AWAY_WIN']
          .map((m) => {
            const p = analysis.marketPredictions?.find((x) => x.market === m);
            return p ? `${p.selection} ${(p.estimatedProbability * 100).toFixed(0)}%` : null;
          })
          .filter(Boolean).join(' • '),
      inline: false,
    });
  }

  e.setFooter({ text: `${BRAND.footer} • Auto-refreshes on change` });
  return e;
}


export function buildLivePayload(analysis: MatchAnalysis, messageId: string, alertsEnabled: boolean) {
  return {
    embeds: [buildLiveMatchEmbed(analysis, alertsEnabled)],
    components: [buildLiveActionRow(messageId, alertsEnabled)],
  };
}

/** Full stats view reused by the "Live Stats" button. */
export function buildLiveStatsPayload(analysis: MatchAnalysis, messageId: string, alertsEnabled: boolean) {
  return {
    embeds: [buildStatsTab(analysis), buildLiveActionRow(messageId, alertsEnabled) as any],
  };
}

/* ------------------------------------------------------------------ *
 * Dashboard / Embedded App launcher
 * ------------------------------------------------------------------ */

export function dashboardUrl(env: { PUBLIC_URL?: string; NODE_ENV?: string } = process.env as any): string {
  if (env.PUBLIC_URL) return env.PUBLIC_URL.replace(/\/$/, '');
  if (env.NODE_ENV === 'production') return 'https://football-analytics-bot-0zwd.onrender.com';
  return 'http://localhost:5000';
}

export function buildDashboardEmbed(url = dashboardUrl()): EmbedBuilder {
  const e = new EmbedBuilder()
    .setColor(BRAND.accent)
    .setAuthor({ name: BRAND.author })
    .setTitle('🚀 Cape Predictor Web App')
    .setDescription(
      `*${BRAND.tagline}*\n` +
      'Open the full dashboard inside Discord — fixtures, league filters, match analysis with xG, ' +
      'score matrices, parlay building and live tracking, all in one place.',
    )
    .addFields(
      { name: '📊 Match Analysis', value: 'Possession, shots, xG and lineups with provider-sourced data.', inline: true },
      { name: '⚽ Score Matrix', value: 'Full Dixon-Coles scoreline distribution per fixture.', inline: true },
      { name: '🎟️ Parlay Builder', value: 'Model probabilities and fair odds for every leg.', inline: true },
      { name: '📡 Live Tracking', value: 'Follow scores and cards as they happen.', inline: true },
      { name: '🔍 League Filters', value: 'Premier League through Champions League.', inline: true },
      { name: '⚙️ Everything in Discord', value: 'Use the buttons below without leaving the app.', inline: true },
    )
    .setFooter({ text: BRAND.footer })
    .setTimestamp(new Date());
  return e;
}

export function buildDashboardComponents(url = dashboardUrl()): ActionRowBuilder<ButtonBuilder>[] {
  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      // NOTE: link buttons must NOT carry a custom id - Discord rejects the
      // payload with "URL and custom id are mutually exclusive."
      new ButtonBuilder()
        .setLabel('Launch Cape Predictor Web App')
        .setEmoji('🚀')
        .setStyle(ButtonStyle.Link)
        .setURL(url),
    ),
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      // Discord Embedded App Framework entry point: `activities` + iframe params
      // let the React app boot inside Discord's embedded frame.
      new ButtonBuilder()
        .setLabel('Open Embedded App')
        .setEmoji('🖥️')
        .setStyle(ButtonStyle.Link)
        .setURL(`${url}/?iframe=true&theme=dark`),
      new ButtonBuilder()
        .setCustomId('cp:nav:fixtures')
        .setLabel('Fixtures')
        .setEmoji('⚽')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId('cp:nav:parlay')
        .setLabel('Custom Parlay')
        .setEmoji('🎟️')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId('cp:nav:live')
        .setLabel('Live Tracking')
        .setEmoji('📡')
        .setStyle(ButtonStyle.Secondary),
    ),
  ];
}

export function buildDashboardPayload(url = dashboardUrl()) {
  return { embeds: [buildDashboardEmbed(url)], components: buildDashboardComponents(url) as any };
}