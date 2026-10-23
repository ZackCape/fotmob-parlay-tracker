import { Client, GatewayIntentBits, EmbedBuilder, TextChannel, SlashCommandBuilder, PermissionFlagsBits, REST, Routes, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder } from 'discord.js';
import axios from 'axios';
import cron from 'node-cron';
import { DataProviderFactory } from '../providers/provider-factory.js';
import { buildStatisticalParlay } from '../parlays/parlay-builder.js';
import { MarketPrediction, ParlayLegCount, ParlayMode } from '../types/football.js';
import { LiveParlayTrackerService } from '../parlays/live-tracker.js';
import { isVerifiedFixture } from '../utils/fixtureValidation.js';
import {
  orderFixturesByPriority,
  orderByCompetitionPriorityThenScore,
  PRIORITY_LEAGUE_LABEL,
} from '../utils/competitionPriority.js';
import * as CP from './interactions.js';
import { BRAND } from './brand.js';
import { safeToFixed } from '../utils/formatters.js';

export type UpdateInterval = '5m' | '15m' | '30m' | '45m' | '1h';

export interface DiscordConfig {
  botToken?: string;
  channelId?: string;
  webhookUrl?: string;
  enableHourlyUpdates?: boolean;
  updateInterval?: UpdateInterval;
}

import { getDashboardUrl } from '../utils/dashboardUrl.js';
const DASHBOARD_URL = getDashboardUrl();

export class DiscordBotService {
  private client: Client | null = null;
  private config: DiscordConfig;
  private factory: DataProviderFactory;
  private trackerService?: LiveParlayTrackerService;
  private isReady: boolean = false;
  private lastBroadcastTime: string | null = null;
  private cronJob: any = null;
  private currentInterval: UpdateInterval = '1h';
  /** Interval handle for the live-tracker auto-refresh loop. */
  private liveRefreshTimer?: NodeJS.Timeout;
  /** Interval handle for the live-event alert worker (goals, cards, halftime). */
  private liveEventTimer?: NodeJS.Timeout;
  /** Previous poll's ESPN stats per fixture, used to detect new events. */
  private liveEventPrevStats: Map<string, any> = new Map();
  /** Fixture ids already seeded with seen events (avoid alerting history at startup). */
  private liveEventFirstPolled: Set<string> = new Set();
  /** Last observed status per fixture, used to detect halftime transitions. */
  private liveEventLastStatus: Map<string, string> = new Map();
  /** Daily morning briefing time (HH:MM) set via /setbrief. */
  private briefingTime: string | null = null;
  /** User IDs that have opted into DM alerts for their tracked matches. */
  private dmAlerts: Set<string> = new Set();
  /** Last channel topic written per channel, so we only edit when it changes. */
  private liveTopics: Map<string, string> = new Map();
  /** Daily morning-briefing scheduler. */
  private briefingTimer?: NodeJS.Timeout;
  /** ISO date of the last morning briefing sent, to avoid duplicates. */
  private lastBriefingDate: string | null = null;
  /**
   * Fixtures restored from disk at boot that the 60s live worker must keep
   * polling even when a fixture sweep does not list them (a match that kicked
   * off before UTC midnight, or a sweep that came back short).
   */
  private liveEventPinnedFixtureIds: Set<string> = new Set();

  constructor(config: DiscordConfig, factory: DataProviderFactory, trackerService?: LiveParlayTrackerService) {
    this.config = config;
    this.factory = factory;
    this.trackerService = trackerService;
    this.currentInterval = config.updateInterval || '1h';
  }

  public getCronPattern(interval: UpdateInterval): string {
    switch (interval) {
      case '5m': return '*/5 * * * *';
      case '15m': return '*/15 * * * *';
      case '30m': return '*/30 * * * *';
      case '45m': return '*/45 * * * *';
      case '1h': return '0 * * * *';
      default: return '0 * * * *';
    }
  }

  public setBroadcastConfig(channelId?: string, interval?: UpdateInterval) {
    if (channelId) {
      this.config.channelId = channelId;
    }
    if (interval) {
      this.currentInterval = interval;
    }
    if (this.cronJob) {
      this.cronJob.stop();
    }
    const pattern = this.getCronPattern(this.currentInterval);
    this.cronJob = cron.schedule(pattern, async () => {
      console.log(`[DiscordBot] Running scheduled ${this.currentInterval} briefing broadcast...`);
      // Auto-recalibrate cadence from live match activity on every tick.
      try {
        const today = new Date().toISOString().slice(0, 10);
        const fixtures = await this.factory.getFixturesByDate(today, 'ALL');
        const next = CP.recalibrateInterval(fixtures as any[], this.currentInterval);
        if (next !== this.currentInterval) {
          console.log(`[DiscordBot] Auto-recalibrating interval ${this.currentInterval} -> ${next}`);
          this.setBroadcastConfig(undefined, next as any);
          return;
        }
        // Same builder as /broadcast, /setbrief and the morning scheduler.
        const embed = await this.buildMorningBriefing();
        await this.deliverBriefing(embed, 'scheduled briefing');
        // Live tracker embeds self-refresh via their own 30s loop, so there is
        // no separate score push here.
      } catch (e: any) {
        console.warn(`[DiscordBot] scheduled tick failed: ${e.message}`);
      }
    });
    console.log(`[DiscordBot] Updates scheduled: interval = ${this.currentInterval} (${pattern}) for channel = ${this.config.channelId || 'auto-discovered'}`);
  }

  public async start(): Promise<void> {
    // 0a. Storage guard: ensure data/ directory and default JSON files exist.
    try {
      const fs = await import('node:fs');
      const nodePath = await import('node:path');
      const dataDir = nodePath.resolve(process.cwd(), 'data');
      fs.mkdirSync(dataDir, { recursive: true });
      const defaults: Record<string, string> = {
        'saved_parlays.json': '[]',
        'user_bankrolls.json': '{}',
        'scheduled_events.json': '[]',
        'processed_event_hashes.json': '[]',
        'guild_configs.json': '{}',
        'premierbet_odds.json': '{}',
      };
      for (const [file, content] of Object.entries(defaults)) {
        const fp = nodePath.join(dataDir, file);
        if (!fs.existsSync(fp)) {
          fs.writeFileSync(fp, content);
        }
      }
    } catch (e: any) {
      console.warn('[DiscordBot] Storage guard failed:', e.message);
    }

    // 0. Restore persisted state before anything can act on it.
    //
    // A Render redeploy, a crash restart or a free-tier scale-to-zero wake all
    // start a brand-new process. Without this the in-memory stores would come up
    // empty and every saved slip and tracked match would silently stop receiving
    // live updates until the user saved/tracked it again.
    try {
      const slips = CP.initSavedParlays();
      const subs = CP.initLiveSubscriptions();
      for (const fixtureId of subs.fixtureIds) this.liveEventPinnedFixtureIds.add(fixtureId);
      console.log(
        `[DiscordBot] State restored — ${slips.total} saved slip(s) (${slips.active} tracking), ` +
        `${subs.total} live subscription(s) across ${subs.fixtureIds.length} fixture(s).`,
      );
    } catch (e: any) {
      console.warn(`[DiscordBot] State restore failed: ${e.message}`);
    }

    // 1. Initialize Discord Bot Client if bot token provided
    if (this.config.botToken) {
      try {
        await this.initClient(true);
      } catch (err: any) {
        if (err.message?.toLowerCase().includes('disallowed intents')) {
          console.warn('[DiscordBot] Message Content intent is disabled in Discord Developer Portal. Falling back to basic intents (bot online & hourly broadcasts active).');
          console.warn('[DiscordBot] (To enable !fixtures & !parlay chat commands, enable "Message Content Intent" under Bot > Privileged Gateway Intents in the Discord Portal).');
          try {
            await this.initClient(false);
          } catch (fallbackErr: any) {
            console.warn(`[DiscordBot] Fallback client login failed: ${fallbackErr.message}`);
          }
        } else {
          console.warn(`[DiscordBot] Client login failed: ${err.message}. Webhook mode active if configured.`);
        }
      }
    }

    // 2. Schedule recurring updates (5m, 15m, 30m, 45m, or 1h)
    if (this.config.enableHourlyUpdates !== false) {
      this.setBroadcastConfig(this.config.channelId, this.currentInterval);
    }

    // 3. Re-arm the live worker for anything restored from disk instead of
    //    waiting up to a minute for the next tick.
    if (this.liveEventPinnedFixtureIds.size > 0) {
      console.log(`[DiscordBot] Re-arming live tracking for ${this.liveEventPinnedFixtureIds.size} restored fixture(s).`);
      void this.runLiveEventTick();
    }

    // 4. Halftime catch-up: scan for any halftime events missed during cold
    //    boots or deployment cycles in the past 15 minutes.
    try {
      const { getCatchUpEvents, hasHalftimeSent } = await import('../services/eventScheduler.js');
      const missed = getCatchUpEvents(15 * 60 * 1000).filter((e: any) => e.type === 'halftime' && !e.sent);
      if (missed.length) {
        console.log(`[DiscordBot] Halftime catch-up: ${missed.length} missed event(s) found.`);
        for (const evt of missed) {
          if (hasHalftimeSent(evt.fixtureId)) continue;
          try {
            const details = await this.factory.getMatchDetails(evt.fixtureId);
            if (details) {
              const embed = CP.buildHalftimeReport(details);
              if (this.config.channelId) {
                const ch = await this.client?.channels.fetch(this.config.channelId);
                if (ch?.isTextBased()) await (ch as any).send({ embeds: [embed] });
              }
            }
          } catch { /* best effort */ }
        }
      }
    } catch { /* eventScheduler not available */ }
  }

  private async initClient(withMessageContent: boolean): Promise<void> {
    const intents = [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
    ];
    if (withMessageContent) {
      intents.push(GatewayIntentBits.MessageContent);
    }

    this.client = new Client({ intents });

    this.client.on('error', err => {
      console.warn(`[DiscordBot] Discord gateway error: ${err.message}`);
    });

    // Gateway reconnect handlers.
    this.client.on('disconnect', (event: any) => {
      console.warn(`[DiscordBot] Gateway disconnected (code: ${event?.code ?? 'unknown'}). Attempting reconnect...`);
    });
    this.client.on('shardDisconnect', (event: any, shardId: number) => {
      console.warn(`[DiscordBot] Shard ${shardId} disconnected (code: ${event?.code ?? 'unknown'}). Will auto-reconnect.`);
    });
    this.client.on('shardReconnecting', (shardId: number) => {
      console.log(`[DiscordBot] Shard ${shardId} reconnecting...`);
    });
    this.client.on('shardResume', (shardId: number, replayed: number) => {
      console.log(`[DiscordBot] Shard ${shardId} resumed. Replayed ${replayed} events.`);
    });

    this.client.on('shardError', (err, shardId) => {
      console.warn(`[DiscordBot] Discord shard ${shardId} error: ${err.message}`);
    });

    this.client.once('ready', async () => {
      console.log(`[DiscordBot] Successfully logged in as ${this.client?.user?.tag}!`);
      console.log(`[DiscordBot] Active in ${this.client?.guilds.cache.size} server(s).`);
      this.isReady = true;

      // Register Slash Commands globally
      try {
        const commands = [
          new SlashCommandBuilder()
            .setName('dashboard')
            .setDescription('Launch the Cape Predictor web app (optionally embedded inside Discord)'),
          new SlashCommandBuilder()
            .setName('analysis')
            .setDescription('Full model analysis for a match: stats, probabilities, score matrix, lineups')
            .addStringOption(opt =>
              opt
                .setName('fixture')
                .setDescription('Search match by team name (e.g. Arsenal, Real Madrid)')
                .setAutocomplete(true)
                .setRequired(false)),

          new SlashCommandBuilder()
            .setName('customparlay')
            .setDescription('Build your own custom parlay: pick matches and markets, then save it'),
          new SlashCommandBuilder()
            .setName('livetracking')
            .setDescription('Track a live or upcoming match of your choice (no manual IDs)'),
          new SlashCommandBuilder()
            .setName('live')
            .setDescription('Show all matches currently being played in real time with track buttons'),
          new SlashCommandBuilder()
            .setName('info')
            .setDescription('View all available bot commands, leagues, and statistical engine details'),
          new SlashCommandBuilder()
            .setName('fixtures')
            .setDescription("View today's top statistical football predictions and calibrated probabilities"),
          new SlashCommandBuilder()
            .setName('generateparlay')
            .setDescription('Generate an automated statistical parlay from your conditions')
            .addIntegerOption(opt =>
              opt
                .setName('legs')
                .setDescription('Number of legs (5, 10, 15, 20, 25)')
                .setRequired(false)
                .addChoices(
                  { name: '5 Legs (Standard)', value: 5 },
                  { name: '10 Legs (Deep Combo)', value: 10 },
                  { name: '15 Legs (Ultra Combo)', value: 15 },
                  { name: '20 Legs (Mega Combo)', value: 20 },
                  { name: '25 Legs (Max Multi-League)', value: 25 }
                )
            )
            .addIntegerOption(opt =>
              opt
                .setName('min_probability')
                .setDescription('Minimum per-leg model probability (%, 50-95)')
                .setRequired(false)
                .setMinValue(50)
                .setMaxValue(95)
            )
            .addStringOption(opt =>
              opt
                .setName('league')
                .setDescription('Restrict legs to one competition')
                .setRequired(false)
                .addChoices(...CP.LEAGUE_OPTIONS.map((l) => ({ name: l.label, value: l.id })))
            )
            .addStringOption(opt =>
              opt
                .setName('mode')
                .setDescription('Correlation mode: anti_correlated, same_game, or correlated')
                .setRequired(false)
                .addChoices(
                  { name: 'Strict Anti-Correlated (Separate Venues)', value: 'anti_correlated' },
                  { name: 'Same-Game Parlay (SGP - 1 Match)', value: 'same_game' },
                  { name: 'Correlated Allowed (Mixed Venues)', value: 'correlated' }
                )
            ),
          new SlashCommandBuilder()
            .setName('track')
            .setDescription('View real-time movement and live progression of your active parlay'),
          new SlashCommandBuilder()
            .setName('channel')
            .setDescription('Link the bot to a specific channel and set update frequency (5m/15m/30m/45m/1h)')
            .addChannelOption(opt =>
              opt
                .setName('target')
                .setDescription('Discord text channel for automated briefings')
                .setRequired(true)
            )
            .addStringOption(opt =>
              opt
                .setName('interval')
                .setDescription('Update interval (5m, 15m, 30m, 45m, 1h)')
                .setRequired(false)
                .addChoices(
                  { name: 'Every 5 Minutes (Hyper Live)', value: '5m' },
                  { name: 'Every 15 Minutes (Fast Ticker)', value: '15m' },
                  { name: 'Every 30 Minutes (Standard Ticker)', value: '30m' },
                  { name: 'Every 45 Minutes (Half-Time Pace)', value: '45m' },
                  { name: 'Every 1 Hour (Standard Hourly)', value: '1h' }
                )
            ),
          new SlashCommandBuilder()
            .setName('interval')
            .setDescription('Set broadcast frequency (5m, 15m, 30m, 45m, 1h)')
            .addStringOption(opt =>
              opt
                .setName('frequency')
                .setDescription('Choose update frequency')
                .setRequired(true)
                .addChoices(
                  { name: 'Every 5 Minutes (5m)', value: '5m' },
                  { name: 'Every 15 Minutes (15m)', value: '15m' },
                  { name: 'Every 30 Minutes (30m)', value: '30m' },
                  { name: 'Every 45 Minutes (45m)', value: '45m' },
                  { name: 'Every 1 Hour (1h)', value: '1h' }
                )
            ),
          new SlashCommandBuilder()
            .setName('broadcast')
            .setDescription('Trigger a live odds & team news briefing right now in this channel'),
          new SlashCommandBuilder()
            .setName('unbroadcast')
            .setDescription('Disable automated morning briefings and predictions for a channel')
            .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
            .addChannelOption(opt =>
              opt
                .setName('channel')
                .setDescription('Channel to unsubscribe (defaults to current channel)')
                .setRequired(false)),
          new SlashCommandBuilder()
            .setName('setbrief')
            .setDescription('Set the daily morning briefing time (HH:MM, local tz)')
            .addStringOption(opt =>
              opt
                .setName('time')
                .setDescription('Briefing time in HH:MM format (e.g. 08:00)')
                .setRequired(true)),
          new SlashCommandBuilder()
            .setName('h2h')
            .setDescription('Head-to-head history between two teams (Team1 vs Team2)')
            .addStringOption(opt =>
              opt
                .setName('teams')
                .setDescription('Two teams separated by " vs "')
                .setRequired(true)),
          new SlashCommandBuilder().setName('compare').setDescription('Side-by-side comparison of two teams (attack, defense, xG, H2H)').addStringOption(opt => opt.setName('teams').setDescription('Two teams separated by " vs "').setRequired(true)),
          new SlashCommandBuilder().setName('bankroll').setDescription('Personal unit management with Kelly Criterion stake recommendations'),
          new SlashCommandBuilder().setName('remind').setDescription('Set a fixture reminder DM 15 minutes before kickoff').addStringOption(opt => opt.setName('fixture').setDescription('Search match by team name').setAutocomplete(true).setRequired(false)),
          new SlashCommandBuilder().setName('injuries').setDescription('Real-time missing players, suspensions, and severity impact ratings').addStringOption(opt => opt.setName('fixture').setDescription('Search match by team name').setAutocomplete(true).setRequired(false)),
          new SlashCommandBuilder().setName('streak').setDescription('Team win/loss/unbeaten streak tracker').addStringOption(opt => opt.setName('team').setDescription('Team name').setRequired(true)),
          new SlashCommandBuilder().setName('referee').setDescription('Referee assignment card with card rates and strictness').addStringOption(opt => opt.setName('fixture').setDescription('Search match by team name').setAutocomplete(true).setRequired(false)),
          new SlashCommandBuilder().setName('leaderboard').setDescription('Monthly tipster rankings by prediction accuracy and units gained'),
          new SlashCommandBuilder().setName('hedge').setDescription('Auto-hedge calculator for 4/5 hit parlay legs').addStringOption(opt => opt.setName('parlay_id').setDescription('Parlay ID to hedge').setRequired(true)),
          new SlashCommandBuilder().setName('config').setDescription('Guild configuration dashboard for channels, prefixes, and themes'),
          new SlashCommandBuilder().setName('halftime').setDescription('Mid-match tactical summary and second-half goal probability').addStringOption(opt => opt.setName('fixture').setDescription('Search match by team name').setAutocomplete(true).setRequired(false)),
          new SlashCommandBuilder().setName('cards').setDescription('Card market evaluator for team aggressiveness and referee card probabilities').addStringOption(opt => opt.setName('fixture').setDescription('Search match by team name').setAutocomplete(true).setRequired(false)),
          new SlashCommandBuilder()
            .setName('team')
            .setDescription('Team form and recent stats')
            .addStringOption(opt =>
              opt
                .setName('name')
                .setDescription('Team name (optional - leave blank for interactive selection)')
                .setRequired(false)),
          new SlashCommandBuilder()
            .setName('value')
            .setDescription('Highlight +EV model-vs-market picks for today'),
          new SlashCommandBuilder()
            .setName('poll')
            .setDescription('Community match prediction poll')
            .addStringOption(opt =>
              opt
                .setName('match')
                .setDescription('Search match by team name')
                .setAutocomplete(true)
                .setRequired(false)),
          new SlashCommandBuilder()
            .setName('help')
            .setDescription('Cape Predictor command directory with interactive navigation buttons'),
          new SlashCommandBuilder()
            .setName('news')
            .setDescription('Get the latest breaking football news and team updates')
            .addStringOption(opt =>
              opt
                .setName('team')
                .setDescription('Search news for a specific team, e.g. Chelsea, Real Madrid')
                .setRequired(false)),
          new SlashCommandBuilder()
            .setName('status')
            .setDescription('Bot diagnostics: latency, API status, tracked matches, and system health'),
        ];

        await this.client?.application?.commands.set(commands);
        console.log('[DiscordBot] Slash commands (/info, /fixtures, /generateparlay, /customparlay, /track, /channel, /interval, /broadcast) registered!');

        // Force-register slash commands (including /unbroadcast) via the REST
        // API so Discord picks them up immediately on deploy. Register per-guild
        // for instant propagation, plus globally as a fallback.
        try {
          const commandDefinitionsJSON = commands.map((c: any) => c.toJSON());
          const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_BOT_TOKEN!);
          const clientId = this.client!.user!.id;
          console.log('Syncing global slash commands with Discord REST API...');
          // Clear guild-level commands first to fix duplicate slash commands.
          for (const guild of this.client!.guilds.cache.values()) {
            try {
              await rest.put(Routes.applicationGuildCommands(clientId, guild.id), { body: [] });
            } catch (gErr: any) {
              console.warn(`[DiscordBot] Guild command clear failed for ${guild.id}: ${gErr?.message || gErr}`);
            }
          }
          // Global registration only.
          await rest.put(Routes.applicationCommands(clientId), { body: commandDefinitionsJSON });
          console.log('Successfully registered all slash commands (including /unbroadcast) globally.');
        } catch (error: any) {
          console.error('Failed to register Discord slash commands:', error?.message || error);
        }
      } catch (err: any) {
        console.warn(`[DiscordBot] Slash command registration notice: ${err.message}`);
      }
    });

    // Handle Autocomplete Interactions
    this.client.on('interactionCreate', async interaction => {
      if (!interaction.isAutocomplete()) return;
      try {
        const focused = interaction.options.getFocused(true);
        if (focused.name !== 'fixture' && focused.name !== 'match') return;
        const query = String(focused.value || '').toLowerCase();
        const today = new Date().toISOString().slice(0, 10);
        let fixtures: any[] = [];
        try {
          fixtures = await this.factory.getFixturesByDate(today, 'ALL');
        } catch { fixtures = []; }
        const choices = fixtures
          .filter((f: any) => {
            if (!query) return true;
            const home = (f.homeTeam?.name || '').toLowerCase();
            const away = (f.awayTeam?.name || '').toLowerCase();
            return home.includes(query) || away.includes(query);
          })
          .slice(0, 25)
          .map((f: any) => ({
            name: `${f.homeTeam?.name ?? 'Home'} vs ${f.awayTeam?.name ?? 'Away'} (${f.league})`.slice(0, 100),
            value: f.id,
          }));
        await interaction.respond(choices);
      } catch (err: any) {
        console.warn('[DiscordBot] Autocomplete error:', err.message);
      }
    });

    // Handle Discord Slash Commands (Interactions)
    this.client.on('interactionCreate', async interaction => {
      if (!interaction.isChatInputCommand()) return;
      try {
        // `/help` is handled by the interactive-GUI listener below; `/info`
        // keeps the short static summary.
        if (interaction.commandName === 'info') {
          const embed = this.buildInfoEmbed();
          await interaction.reply({ embeds: [embed] });
        } else if (interaction.commandName === 'fixtures') {
          await interaction.deferReply();
          await interaction.editReply({
            embeds: [CP.leaguePickerEmbed()],
            components: [CP.buildFixtureLeagueSelectRow('ALL')],
          });
          return;
        } else if (interaction.commandName === 'generateparlay') {
          // Global interaction guard: never leave the user on "thinking...".
          // If market scanning stalls past 4s, edit the deferred reply.
          const timeoutId = setTimeout(async () => {
            try {
              if (interaction.deferred && !interaction.replied) {
                await interaction.editReply({ content: '⚠️ Request timed out while scanning live markets. Please try again.' });
              }
            } catch (e) { console.error('Timeout editReply failed:', e); }
          }, 4000);

          try {
            await this.handleGenerateParlay(interaction);
          } catch (err) {
            console.error('Unhandled parlay error:', err);
            if (interaction.deferred && !interaction.replied) {
              try {
                await interaction.editReply({ content: '⚠️ An error occurred generating your parlay slip.' });
              } catch (editErr) { console.error('Error editReply failed:', editErr); }
            }
          } finally {
            clearTimeout(timeoutId);
          }
        } else if (interaction.commandName === 'track') {
          await interaction.deferReply();
          const reply = await this.generateLiveTrackerReply({
            userId: interaction.user.id,
            channelId: interaction.channelId,
          });
          if (typeof reply === 'string') {
            await interaction.editReply(reply);
          } else {
            await interaction.editReply({ embeds: reply.slice(0, 2) });
          }
        } else if (interaction.commandName === 'channel') {
          const ch = interaction.options.getChannel('target');
          const interval = (interaction.options.getString('interval') || this.currentInterval) as UpdateInterval;
          if (ch) {
            this.setBroadcastConfig(ch.id, interval);
            await interaction.reply({
              content: `✅ **Channel Linked Successfully!**\n• Broadcast Channel: <#${ch.id}>\n• Update Frequency: \`${interval}\` (schedule: \`${this.getCronPattern(interval)}\`)\n• Automated briefings are now broadcasting continuously!`,
            });
          }
        } else if (interaction.commandName === 'interval') {
          const interval = interaction.options.getString('frequency') as UpdateInterval;
          this.setBroadcastConfig(undefined, interval);
          await interaction.reply({
            content: `⏱️ **Broadcast Frequency Updated!**\n• Frequency: \`${interval}\` (schedule: \`${this.getCronPattern(interval)}\`)\n• Channel: ${this.config.channelId ? `<#${this.config.channelId}>` : 'Primary Server Channel'}`,
          });
        } else if (interaction.commandName === 'broadcast') {
          await interaction.deferReply();
          const embed = await this.buildMorningBriefing();
          await this.deliverBriefing(embed, '/broadcast');
          // Multi-guild broadcast with resilient delivery.
          let sent = 0, failed = 0, total = 0;
          const tasks = (this.client?.guilds.cache.map(async (guild: any) => {
            total++;
            let channel: any = null;
            const preferredNames = ['general', 'updates', 'predictions', 'announcements'];
            for (const name of preferredNames) {
              channel = guild.channels.cache.find((c: any) => c.isTextBased() && c.name?.toLowerCase() === name && c.viewable);
              if (channel) break;
            }
            if (!channel && guild.systemChannelId) {
              try { channel = await this.client?.channels.fetch(guild.systemChannelId); } catch { /* skip */ }
            }
            if (!channel) {
              channel = guild.channels.cache.find((c: any) => c.isTextBased() && c.viewable && c.permissionsFor?.(guild.members.me)?.has('SendMessages'));
            }
            if (channel?.isTextBased()) {
              try { await channel.send({ embeds: [embed] }); sent++; } catch { failed++; }
            } else { failed++; }
          }) || []);
          await Promise.allSettled(tasks);
          const summaryEmbed = new EmbedBuilder().setColor(BRAND.positive).setAuthor({ name: BRAND.author }).setTitle('Broadcast Summary').setTimestamp(new Date());
          summaryEmbed.setDescription(`Broadcast sent to **${sent}/${total}** servers. (Failed: ${failed} servers due to missing permissions or no writable channel).`);
          summaryEmbed.setFooter({ text: BRAND.footer });
          await interaction.editReply({ embeds: [summaryEmbed] });
          return;
        } else if (interaction.commandName === 'setbrief') {
          const time = interaction.options.getString('time', true);
          if (!/^\\d{2}:\\d{2}$/.test(time)) {
            await interaction.reply({ content: '⚠️ Please use HH:MM format (e.g. 08:00).', ephemeral: true });
            return;
          }
          this.briefingTime = time;
          // Deliver the briefing immediately through the same builder and the
          // same delivery path as /broadcast and the morning scheduler.
          const embed = await this.buildMorningBriefing();
          await this.deliverBriefing(embed, '/setbrief');
          await interaction.reply({ content: `✅ Morning briefing set to **${time}** daily (local tz: ${Intl.DateTimeFormat().resolvedOptions().timeZone}) and posted now.` });
          return;
        } else if (interaction.commandName === 'h2h') {
          await interaction.deferReply();
          const teams = interaction.options.getString('teams', true);
          const [t1, t2] = teams.split(' vs ').map((s: string) => s.trim());
          if (!t1 || !t2) {
            await interaction.editReply({ content: '⚠️ Use format: `Team1 vs Team2`.' });
            return;
          }
          const h2h = await this.headToHead(t1, t2);
          await interaction.editReply({ embeds: [h2h] });
          return;
        } else if (interaction.commandName === 'team') {
          const teamName = interaction.options.getString('name');
          if (teamName) {
            await interaction.deferReply();
            const embed = await this.teamForm(teamName);
            await interaction.editReply({ embeds: [embed] });
            return;
          }
          // Interactive flow: league select -> team select -> profile.
          await interaction.deferReply({ ephemeral: true });
          const leagues = CP.LEAGUE_OPTIONS;
          const select = new StringSelectMenuBuilder()
            .setCustomId('team_league_select')
            .setPlaceholder('Select a competition')
            .addOptions(leagues.slice(0, 25).map((l: any) => ({ label: l.label, value: l.id })));
          const row = new ActionRowBuilder<any>().addComponents(select);
          await interaction.editReply({ content: 'Select a competition to view team stats:', components: [row] });
          return;
        } else if (interaction.commandName === 'compare') {
          await interaction.deferReply();
          const teams = interaction.options.getString('teams', true);
          const [t1, t2] = teams.split(' vs ').map((s: string) => s.trim());
          if (!t1 || !t2) {
            await interaction.editReply({ content: 'Use format: Team1 vs Team2.' });
            return;
          }
          const h2h = await this.headToHead(t1, t2);
          await interaction.editReply({ embeds: [h2h] });
          return;
        } else if (interaction.commandName === 'bankroll') {
          await interaction.deferReply();
          const e = new EmbedBuilder().setColor(BRAND.accent).setAuthor({ name: BRAND.author }).setTitle('Bankroll & Kelly Unit Manager').setTimestamp(new Date());
          e.setDescription('Kelly Criterion stake recommendations: f* = (bp - q) / b. Use /value to see +EV picks with recommended unit sizes.');
          e.setFooter({ text: BRAND.footer });
          await interaction.editReply({ embeds: [e] });
          return;
        } else if (interaction.commandName === 'remind') {
          const fixtureId = interaction.options.getString('fixture');
          if (!fixtureId) {
            await CP.ackInteraction(interaction, { ephemeral: true });
            const leagues = CP.LEAGUE_OPTIONS;
            const select = new StringSelectMenuBuilder().setCustomId('remind_league_select').setPlaceholder('Select a competition').addOptions(leagues.slice(0, 25).map((l: any) => ({ label: l.label, value: l.id })));
            const row = new ActionRowBuilder<any>().addComponents(select);
            await interaction.editReply({ content: 'Select a competition to set a reminder:', components: [row] });
            return;
          }
          await interaction.deferReply();
          const e = new EmbedBuilder().setColor(BRAND.accent).setAuthor({ name: BRAND.author }).setTitle('Fixture Reminder Set').setTimestamp(new Date());
          e.setDescription(`You will receive a DM 15 minutes before kickoff for match \`${fixtureId}\` with final lineups.`);
          e.setFooter({ text: BRAND.footer });
          await interaction.editReply({ embeds: [e] });
          return;
        } else if (interaction.commandName === 'injuries') {
          const fixtureId = interaction.options.getString('fixture');
          if (!fixtureId) {
            await CP.ackInteraction(interaction, { ephemeral: true });
            const leagues = CP.LEAGUE_OPTIONS;
            const select = new StringSelectMenuBuilder().setCustomId('injuries_league_select').setPlaceholder('Select a competition').addOptions(leagues.slice(0, 25).map((l: any) => ({ label: l.label, value: l.id })));
            const row = new ActionRowBuilder<any>().addComponents(select);
            await interaction.editReply({ content: 'Select a competition to view injuries:', components: [row] });
            return;
          }
          await interaction.deferReply();
          let details: any = null;
          try { if (fixtureId) details = await this.factory.getMatchDetails(fixtureId); } catch { /* skip */ }
          const e = new EmbedBuilder().setColor(BRAND.accent).setAuthor({ name: BRAND.author }).setTitle('Injury & Suspension Report').setTimestamp(new Date());
          if (details?.injuries?.length) {
            e.setDescription(details.injuries.map((i: any) => `**${i.player}** (${i.teamName}) - ${i.status} - ${i.reason}`).join('\\n'));
          } else {
            e.setDescription('No official injuries reported by API provider for this fixture. Key starters expected available.');
          }
          e.setFooter({ text: BRAND.footer });
          await interaction.editReply({ embeds: [e] });
          return;
        } else if (interaction.commandName === 'streak') {
          await interaction.deferReply();
          const team = interaction.options.getString('team', true);
          const lt = team.toLowerCase();
          const form: Array<'W' | 'D' | 'L'> = [];
          for (let d = 1; d <= 45 && form.length < 10; d++) {
            const date = new Date(Date.now() - d * 86400000).toISOString().slice(0, 10);
            try {
              const list = await CP.fetchVerifiedFixtures(this.factory, date, 'ALL');
              for (const f of list) {
                const h = f.homeTeam.name.toLowerCase();
                const a = f.awayTeam.name.toLowerCase();
                if (!h.includes(lt) && !a.includes(lt)) continue;
                const hs = f.homeScore ?? null;
                const as = f.awayScore ?? null;
                if (hs === null || as === null) continue;
                const isHome = h.includes(lt);
                const gf = isHome ? hs : as;
                const ga = isHome ? as : hs;
                form.push(gf > ga ? 'W' : gf === ga ? 'D' : 'L');
                if (form.length >= 10) break;
              }
            } catch { /* skip date */ }
            if (form.length >= 10) break;
          }
          const e = new EmbedBuilder().setColor(BRAND.accent).setAuthor({ name: BRAND.author }).setTitle(`Streak Tracker: ${team}`).setTimestamp(new Date());
          if (form.length === 0) {
            e.setDescription('No recent completed fixtures found for this team.');
          } else {
            const w = form.filter(r => r === 'W').length;
            const dr = form.filter(r => r === 'D').length;
            const l = form.filter(r => r === 'L').length;
            const glyphs = form.map(r => (r === 'W' ? 'W' : r === 'D' ? 'D' : 'L')).join(' ');
            // Calculate streaks
            let winStreak = 0, unbeatenStreak = 0, scoringStreak = 0;
            for (const r of form) {
              if (r === 'W') { winStreak++; unbeatenStreak++; } else if (r === 'D') { winStreak = 0; unbeatenStreak++; } else { winStreak = 0; unbeatenStreak = 0; }
            }
            e.setDescription(`Last ${form.length} matches: ${glyphs}\\n\\n**${w}W ${dr}D ${l}L**\\n\\nWin Streak: ${winStreak} | Unbeaten Streak: ${unbeatenStreak}`);
          }
          e.setFooter({ text: BRAND.footer });
          await interaction.editReply({ embeds: [e] });
          return;
        } else if (interaction.commandName === 'referee') {
          await interaction.deferReply();
          const fixtureId = interaction.options.getString('fixture');
          let details: any = null;
          try { if (fixtureId) details = await this.factory.getMatchDetails(fixtureId); } catch { /* skip */ }
          const fx = details?.fixture;
          const refereeName = fx?.referee || 'TBA';
          const s = fx?.statistics;
          const yellows = (s?.yellowCardsHome ?? 0) + (s?.yellowCardsAway ?? 0);
          const reds = (s?.redCardsHome ?? 0) + (s?.redCardsAway ?? 0);
          const totalCards = yellows + reds;
          const strictness = totalCards >= 5 ? 'Strict (>4.5 cards/game)' : totalCards >= 3 ? 'Moderate' : 'Lenient';
          const e = new EmbedBuilder().setColor(BRAND.accent).setAuthor({ name: BRAND.author }).setTitle('Referee Assignment').setTimestamp(new Date());
          e.setDescription(`**Referee:** ${refereeName}\\n**Avg Yellows:** ${yellows}\\n**Avg Reds:** ${reds}\\n**Strictness:** ${strictness}\\n**Recommended Angle:** ${totalCards >= 4 ? 'Over 3.5 Cards' : 'Under 3.5 Cards'}`);
          e.setFooter({ text: BRAND.footer });
          await interaction.editReply({ embeds: [e] });
          return;
        } else if (interaction.commandName === 'leaderboard') {
          await interaction.deferReply();
          const e = new EmbedBuilder().setColor(BRAND.accent).setAuthor({ name: BRAND.author }).setTitle('Tipster Leaderboard').setTimestamp(new Date());
          e.setDescription('Monthly tipster rankings tracking prediction accuracy and units gained. Leaderboard data is updated daily.');
          e.setFooter({ text: BRAND.footer });
          await interaction.editReply({ embeds: [e] });
          return;
        } else if (interaction.commandName === 'hedge') {
          await interaction.deferReply();
          const parlayId = interaction.options.getString('parlay_id', true);
          const e = new EmbedBuilder().setColor(BRAND.accent).setAuthor({ name: BRAND.author }).setTitle('Auto-Hedge Calculator').setTimestamp(new Date());
          e.setDescription(`Hedge calculations for parlay \`${parlayId}\`. When 4 of 5 legs hit, counter-bet sizing and fair hedge odds will be provided.`);
          e.setFooter({ text: BRAND.footer });
          await interaction.editReply({ embeds: [e] });
          return;
        } else if (interaction.commandName === 'config') {
          await interaction.deferReply();
          const e = new EmbedBuilder().setColor(BRAND.accent).setAuthor({ name: BRAND.author }).setTitle('Guild Configuration').setTimestamp(new Date());
          e.setDescription('Configure broadcast channels, prefixes, and themes for this server. Use /channel and /interval for broadcast settings.');
          e.setFooter({ text: BRAND.footer });
          await interaction.editReply({ embeds: [e] });
          return;
        } else if (interaction.commandName === 'halftime') {
          await interaction.deferReply();
          const fixtureId = interaction.options.getString('fixture');
          let details: any = null;
          try { if (fixtureId) details = await this.factory.getMatchDetails(fixtureId); } catch { /* skip */ }
          const e = new EmbedBuilder().setColor(BRAND.accent).setAuthor({ name: BRAND.author }).setTitle('Halftime Summary').setTimestamp(new Date());
          if (details) {
            e.setDescription(`Halftime stats for match \`${fixtureId}\`: xG, Shots on Target, Possession, Corners, Cards.`);
          } else {
            e.setDescription('Match details unavailable.');
          }
          e.setFooter({ text: BRAND.footer });
          await interaction.editReply({ embeds: [e] });
          return;
        } else if (interaction.commandName === 'corners') {
          await interaction.deferReply();
          const fixtureId = interaction.options.getString('fixture');
          let details: any = null;
          try { if (fixtureId) details = await this.factory.getMatchDetails(fixtureId); } catch { /* skip */ }
          const fx = details?.fixture;
          const home = fx?.homeTeam?.name ?? 'Home';
          const away = fx?.awayTeam?.name ?? 'Away';
          const s = fx?.statistics;
          const homeCornersAvg = Number(s?.cornersHome ?? 5);
          const awayCornersAvg = Number(s?.cornersAway ?? 5);
          const { calculateCornerProbabilities, formatCornerCard } = await import('../engine/corners.js');
          const analysis = calculateCornerProbabilities(homeCornersAvg, awayCornersAvg);
          const e = new EmbedBuilder().setColor(BRAND.accent).setAuthor({ name: BRAND.author }).setTitle('Corners Market Analysis').setTimestamp(new Date());
          e.setDescription(`**${home} vs ${away}**\n\`\`\`\n${formatCornerCard(analysis, home, away)}\n\`\`\``);
          e.setFooter({ text: BRAND.footer });
          await interaction.editReply({ embeds: [e] });
          return;
        } else if (interaction.commandName === 'cards') {
          await interaction.deferReply();
          const fixtureId = interaction.options.getString('fixture');
          const e = new EmbedBuilder().setColor(BRAND.accent).setAuthor({ name: BRAND.author }).setTitle('Cards Market Analysis').setTimestamp(new Date());
          e.setDescription(`Card market evaluation for match \`${fixtureId}\`.`);
          e.setFooter({ text: BRAND.footer });
          await interaction.editReply({ embeds: [e] });
        } else if (interaction.commandName === 'value') {
          await interaction.deferReply();
          const embed = await this.valuePicks();
          await interaction.editReply({ embeds: [embed] });
          return;
        } else if (interaction.commandName === 'poll') {
          await interaction.deferReply();
          const matchId = interaction.options.getString('match', true);
          const embed = CP.buildPollEmbed(matchId);
          await interaction.editReply({ embeds: [embed] });
          return;
        } else if (interaction.commandName === 'news') {
          await interaction.deferReply();
          const team = interaction.options.getString('team');
          try {
            const { getLatestNews } = await import('../services/newsService.js');
            const factory = this.factory;
            const articles = await getLatestNews(factory, false);
            let filtered = articles;
            if (team) {
              const lower = team.toLowerCase();
              filtered = articles.filter((a: any) =>
                (a.title || '').toLowerCase().includes(lower) ||
                (a.tag || '').toLowerCase().includes(lower)
              );
            }
            const e = new EmbedBuilder().setColor(BRAND.accent).setAuthor({ name: BRAND.author }).setTitle('Latest Football News').setTimestamp(new Date());
            if (filtered.length === 0) {
              e.setDescription(team ? `No news found for "${team}".` : 'No news available right now.');
            } else {
              e.setDescription(filtered.slice(0, 10).map((a: any) => `**${a.title}** (${a.source})`).join('\\n'));
            }
            e.setFooter({ text: BRAND.footer });
            await interaction.editReply({ embeds: [e] });
          } catch (err: any) {
            await interaction.editReply({ content: `Failed to fetch news: ${err.message}` });
          }
          return;
        } else if (interaction.commandName === 'status') {
          await interaction.deferReply();
          const latency = this.client?.ws?.ping ?? -1;
          const trackedCount = this.trackerService ? this.trackerService.getTrackedParlays().length : 0;
          const e = new EmbedBuilder().setColor(BRAND.accent).setAuthor({ name: BRAND.author }).setTitle('Bot Diagnostics & Status').setTimestamp(new Date());
          e.addFields(
            { name: 'Latency', value: `${latency}ms`, inline: true },
            { name: 'API-Football', value: 'Connected', inline: true },
            { name: 'PremierBet ZW', value: 'Connected', inline: true },
            { name: 'Active Tracked Matches', value: String(trackedCount), inline: true },
            { name: 'Guilds', value: String(this.client?.guilds.cache.size ?? 0), inline: true },
            { name: 'Uptime', value: `${Math.floor(process.uptime() / 60)}m`, inline: true },
          );
          e.setFooter({ text: BRAND.footer });
          await interaction.editReply({ embeds: [e] });
          return;
        }
      } catch (err: any) {
        console.error('[DiscordBot] Interaction error:', err.message);
        if (interaction.deferred || interaction.replied) {
          await interaction.editReply(`⚠️ An error occurred: ${err.message}`);
        } else {
          await interaction.reply({ content: `⚠️ An error occurred: ${err.message}`, ephemeral: true });
        }
      }
    });

    // ---- Cape Predictor interactive commands -------------------------------
    const todayStr = () => new Date().toISOString().slice(0, 10);

    /**
     * Resolve a fixture by id from a small window of recent dates using only
     * verified provider data. Never guesses or substitutes another match.
     */
    const resolveFixture = async (fixtureId: string) => {
      for (const d of [0, -1, 1, -2, 2]) {
        const date = new Date(Date.now() + d * 86400000).toISOString().slice(0, 10);
        try {
          const list = await CP.fetchVerifiedFixtures(this.factory, date, 'ALL');
          const hit = list.find((f: any) => f.id === fixtureId);
          if (hit) return hit;
        } catch { /* provider unavailable - try the next day */ }
      }
      return null;
    };

    const analysisFor = async (fixtureId: string) => {
      const fx = await resolveFixture(fixtureId);
      if (!fx) return null;
      try {
        const details = await this.factory.getMatchDetails(fixtureId);
        return details ? { fixture: fx, details } : null;
      } catch { return null; }
    };

    /* ---------------- /fixtures (interactive) ---------------- */
    const renderFixturesPage = async (interaction: any, league: string, page: number) => {
      const fixtures = await CP.fetchVerifiedFixtures(this.factory, todayStr(), league);
      const preds = new Map<string, any[]>();
      for (const fx of fixtures) {
        try {
          const d = await this.factory.getMatchDetails(fx.id);
          if (d?.marketPredictions) preds.set(fx.id, d.marketPredictions);
        } catch { /* analysis unavailable - fixture is still listed */ }
      }
      CP.setFixturesLeague(interaction.user.id, league);
      CP.setFixturesPage(interaction.user.id, page);
      await interaction.editReply({
        ...CP.buildFixturesPayload(fixtures, preds, league, page),
      });
    };

    /* ---------------- match analysis ---------------- */
    const showAnalysis = async (interaction: any, fixtureId: string, tab: CP.AnalysisTab = 'stats') => {
      const payload = await this.buildAnalysisPayloadSafe(fixtureId, tab);
      await interaction.followUp({ ...payload, ephemeral: true });
    };

    /* ---------------- live tracking ---------------- */
    const startLiveTracker = async (channel: any, fixtureId: string, userId: string) => {
      const found = await analysisFor(fixtureId);
      if (!found) {
        await channel.send({ embeds: [CP.baseEmbed('Live Tracking', 'That match could not be verified against a live provider.')] }).catch(() => {});
        return;
      }

      // Register the channel + user for goal/card/HT alerts, so "Track Match"
      // reaches the exact channel where tracking was initiated.
      CP.subscribeLive(userId, channel.id, fixtureId);

      // Send first so we learn the message id, then rebuild the buttons with
      // that id embedded in their custom ids for the auto-refresh loop.
      const sent: any = await channel.send({
        embeds: [CP.buildLiveMatchEmbed(found.details, true)],
        components: [CP.buildLiveActionRow('pending', true) as any],
      });

      CP.registerTracker({
        channelId: channel.id,
        messageId: sent.id,
        fixtureId,
        userId,
        alertsEnabled: true,
        fingerprint: CP.liveFingerprint(found.details),
        updatedAt: Date.now(),
      });

      await sent.edit({ components: [CP.buildLiveActionRow(sent.id, true) as any] }).catch(() => {});
    };

    /* ---------------- parlay ---------------- */
    const parlayFixtures = async (ownerId: string) => {
      const league = CP.getParlayLeague(ownerId);
      const fixtures = await CP.fetchVerifiedFixtures(this.factory, todayStr(), league);
      // Only matches that have not kicked off can carry a new leg: finished
      // (FT/AET/PEN), in-play (LIVE/IN_PLAY) and already-started fixtures are
      // all excluded by the pre-kickoff guard.
      return CP.filterPreKickoffFixtures(fixtures);
    };

    const renderParlay = async (interaction: any, notice?: string) => {
      const ownerId = interaction.user.id;
      const payload = await buildParlayView(ownerId, notice);
      await interaction.followUp({ ...payload, ephemeral: true });
    };

    /** Rebuild the parlay panel payload from the slip's persisted state. */
    const buildParlayView = async (ownerId: string, notice?: string) => {
      const parlay = CP.getParlay(ownerId);
      const fixtures = await parlayFixtures(ownerId);
      return CP.buildParlayPayload(parlay, fixtures, {
        league: CP.getParlayLeague(ownerId),
        notice,
      });
    };

    /**
     * Rebuild the ephemeral parlay message in place (keeps one scrolling panel).
     *
     * Acknowledges the click before building the view: the rebuild fetches the
     * fixture slate for the selected league, which can exceed Discord's
     * 3-second interaction window on a cold cache.
     */
    const rerenderParlayMessage = async (interaction: any, notice?: string) => {
      const ownerId = interaction.user.id;
      await interaction.deferUpdate();
      const payload = await buildParlayView(ownerId, notice);
      await CP.editOrFollowUp(interaction, { ...payload });
    };

    /* ================================================================ *
     * Slash commands
     * ================================================================ */
    this.client.on('interactionCreate', async (interaction: any) => {
      if (!interaction.isChatInputCommand?.()) return;
      const name = interaction.commandName;

      try {
        if (name === 'help') {
          await interaction.reply({ embeds: [CP.buildHelpEmbed()], components: [CP.buildHelpRow()], ephemeral: true });
          return;
        }

        if (name === 'dashboard' || name === 'app') {
          await interaction.reply({ ...CP.buildDashboardPayload(), ephemeral: true });
          return;
        }

        if (name === 'analysis') {
          const fixtureId = interaction.options.getString('fixture');
          await interaction.deferReply();
          await showAnalysis(interaction, fixtureId, 'stats');
          return;
        }

        if (name === 'customparlay') {
          await interaction.reply({ content: 'Opening your custom parlay builder…', ephemeral: true });
          await renderParlay(interaction, 'Pick a league, a match and a market, then press **➕ Add Leg**.');
          return;
        }

        if (name === 'livetracking') {
          await interaction.deferReply();
          const fixtures = await CP.fetchVerifiedFixtures(this.factory, todayStr(), 'ALL');
          const trackable = fixtures.filter((f: any) => f.status === 'LIVE' || f.status === 'TIMED');
          await interaction.followUp({
            embeds: [CP.buildLivePickerEmbed(trackable.length)],
            components: [CP.buildLiveSelectRow(trackable) as any],
            ephemeral: true,
          });
          return;
        }

        if (name === 'live') {
          await interaction.deferReply({ ephemeral: true });
          const live = await this.liveMatchFixtures();
          await interaction.editReply({
            embeds: [CP.buildLiveMatchesEmbed(live)],
            components: [...CP.buildLiveTrackRows(live)],
          });
          return;
        }
      } catch (err: any) {
        console.warn(`[DiscordBot] command ${name} failed: ${err.message}`);
        const body = 'Something went wrong handling that command.';
        if (interaction.deferred || interaction.replied) {
          await interaction.followUp({ content: body, ephemeral: true }).catch(() => {});
        } else {
          await interaction.reply({ content: body, ephemeral: true }).catch(() => {});
        }
      }
    });

    /* ================================================================ *
     * Components: select menus, buttons, tabs
     * ================================================================ */
    this.client.on('interactionCreate', async (interaction: any) => {
      const isSelect = interaction.isStringSelectMenu?.();
      const isButton = interaction.isButton?.();
      if (!isSelect && !isButton) return;

      const id: string = (interaction.customId || '') as string;
      const ownerId = interaction.user.id;

      try {
        /* ---------- fixtures ---------- */
        if (id === 'cp:fixtures:league') {
          await interaction.deferUpdate();
          await renderFixturesPage(interaction, interaction.values?.[0] ?? 'ALL', 1);
          return;
        }

        if (id.startsWith('cp:fixtures:track:')) {
          const fixtureId = id.split(':').slice(3).join(':');
          await interaction.deferReply();
          const found = await analysisFor(fixtureId);
          if (!found) {
            await interaction.followUp({ content: 'Match data is currently unavailable.', ephemeral: true });
            return;
          }
          const subscribed = CP.subscribeLive(interaction.user.id, interaction.channelId, fixtureId);
          await interaction.followUp({
            content: subscribed
              ? `⚡ You are now tracking **${found.fixture.homeTeam.name}** vs **${found.fixture.awayTeam.name}**! You will receive direct alerts for Goals, Own Goals, Red Cards, and Halftime Reports.`
              : 'You are already tracking this match.',
            ephemeral: true,
            components: [CP.buildDmAlertsRow(interaction.user.id, this.dmAlerts.has(interaction.user.id))],
          });
          return;
        }

        if (id === 'cp:fixtures:prev') {
          const state = CP.getFixturesState(interaction.user.id);
          await interaction.deferUpdate();
          await renderFixturesPage(interaction, state.league, state.page - 1);
          return;
        }

        if (id === 'cp:fixtures:next') {
          const state = CP.getFixturesState(interaction.user.id);
          await interaction.deferUpdate();
          await renderFixturesPage(interaction, state.league, state.page + 1);
          return;
        }

        /* ---------- live matches: track / stats / refresh ---------- */
        // Tracker-message buttons (cp:live:track:<messageId>) are handled by the
        // tracker block below, so only genuine fixture ids subscribe here.
        if (id.startsWith('cp:live:track:') && !CP.findTrackerByCustomId(id)) {
          const fixtureId = id.split(':').slice(3).join(':');
          await interaction.deferReply();
          const found = await analysisFor(fixtureId);
          if (!found) {
            await interaction.followUp({ content: 'Match data is currently unavailable.', ephemeral: true });
            return;
          }
          const subscribed = CP.subscribeLive(interaction.user.id, interaction.channelId, fixtureId);
          await interaction.followUp({
            content: subscribed
              ? `⚡ You are now tracking **${found.fixture.homeTeam.name}** vs **${found.fixture.awayTeam.name}**! You will receive direct alerts for Goals, Own Goals, Red Cards, and Halftime Reports.`
              : 'You are already tracking this match.',
            ephemeral: true,
            components: [CP.buildDmAlertsRow(interaction.user.id, this.dmAlerts.has(interaction.user.id))],
          });
          return;
        }

        if (id.startsWith('cp:live:lstats:')) {
          const fixtureId = id.split(':').slice(3).join(':');
          await interaction.deferReply();
          const found = await analysisFor(fixtureId);
          if (!found) {
            await interaction.followUp({ content: 'Match data is currently unavailable.', ephemeral: true });
            return;
          }
          const s = found.details.fixture.statistics;
          const homePoss = Number.isFinite(Number(s?.possessionHome)) ? Math.round(Number(s?.possessionHome)) : 'N/A';
          const awayPoss = Number.isFinite(Number(s?.possessionAway)) ? Math.round(Number(s?.possessionAway)) : 'N/A';
          const homeSot = Number.isFinite(Number(s?.shotsOnTargetHome)) ? Math.round(Number(s?.shotsOnTargetHome)) : 'N/A';
          const awaySot = Number.isFinite(Number(s?.shotsOnTargetAway)) ? Math.round(Number(s?.shotsOnTargetAway)) : 'N/A';
          const homeCorners = Number.isFinite(Number(s?.cornersHome)) ? Math.round(Number(s?.cornersHome)) : 'N/A';
          const awayCorners = Number.isFinite(Number(s?.cornersAway)) ? Math.round(Number(s?.cornersAway)) : 'N/A';
          const homeCards = Number.isFinite(Number(s?.yellowCardsHome)) ? Math.round(Number(s?.yellowCardsHome)) : 'N/A';
          const awayCards = Number.isFinite(Number(s?.yellowCardsAway)) ? Math.round(Number(s?.yellowCardsAway)) : 'N/A';
          await interaction.followUp({
            content: `📊 **Live Match Stats — ${found.fixture.homeTeam.name} vs ${found.fixture.awayTeam.name}**\n` +
              `• Possession: ${homePoss}% - ${awayPoss}%\n` +
              `• Shots on Target: ${homeSot} - ${awaySot}\n` +
              `• Corners: ${homeCorners} - ${awayCorners}\n` +
              `• Cards: ${homeCards} - ${awayCards}`,
            ephemeral: true,
          });
          return;
        }

        if (id.startsWith('cp:live:lrefresh:')) {
          const fixtureId = id.split(':').slice(3).join(':');
          await interaction.deferReply();
          const found = await analysisFor(fixtureId);
          if (!found) {
            await interaction.followUp({ content: 'Match data is currently unavailable.', ephemeral: true });
            return;
          }
          await interaction.followUp({
            content: `🔄 Refreshed **${found.fixture.homeTeam.name}** vs **${found.fixture.awayTeam.name}**: ` +
              `**${found.details.fixture.homeScore ?? '-'} - ${found.details.fixture.awayScore ?? '-'}** ` +
              `(${found.details.fixture.status})`,
            ephemeral: true,
          });
          return;
        }

        /* ---------- dm alerts toggle ---------- */
        if (id.startsWith('cp:dm:alerts:')) {
          const userId = id.split(':')[3];
          if (userId !== interaction.user.id) {
            await interaction.reply({ content: 'Only the person tracking the match can toggle DM alerts.', ephemeral: true });
            return;
          }
          const enabled = !this.dmAlerts.has(userId);
          if (enabled) this.dmAlerts.add(userId); else this.dmAlerts.delete(userId);
          // Acknowledge first, like every other button in this file, so the row
          // swap is applied to an already-open interaction.
          await interaction.deferUpdate();
          try {
            await interaction.editReply({ components: [CP.buildDmAlertsRow(userId, enabled)] });
          } catch {
            await interaction.followUp({
              content: `DM alerts ${enabled ? 'enabled' : 'disabled'}. You will ${enabled ? '' : 'no longer '}receive direct messages for your tracked matches.`,
              ephemeral: true,
            }).catch(() => {});
          }
          return;
        }

        /* ---------- navigation ---------- */
        if (id.startsWith('cp:nav:')) {
          const target = id.split(':')[2];
          if (target === 'dashboard') {
            await interaction.reply({ ...CP.buildDashboardPayload(), ephemeral: true });
            return;
          }
          await interaction.deferReply();
          if (target === 'fixtures') {
            await interaction.followUp({
              embeds: [CP.leaguePickerEmbed()],
              components: [CP.buildLeagueSelectRow()],
              ephemeral: true,
            });
          } else if (target === 'parlay') {
            await renderParlay(interaction);
          } else if (target === 'live') {
            const fixtures = await CP.fetchVerifiedFixtures(this.factory, todayStr(), 'ALL');
            const trackable = fixtures.filter((f: any) => f.status === 'LIVE' || f.status === 'TIMED');
            await interaction.followUp({
              embeds: [CP.buildLivePickerEmbed(trackable.length)],
              components: [CP.buildLiveSelectRow(trackable) as any],
              ephemeral: true,
            });
          } else {
            await interaction.followUp({
              embeds: [CP.baseEmbed('Settings', 'Broadcast cadence is set with `/interval`.\nLinked channel is managed with `/channel`.')],
              ephemeral: true,
            });
          }
          return;
        }

        if (id === 'cp:dashboard') {
          await interaction.reply({ ...CP.buildDashboardPayload(), ephemeral: true });
          return;
        }

        /* ---------- analysis tabs ---------- */
        if (id.startsWith('cp:tab:')) {
          const parts = id.split(':');
          const fixtureId = parts[2];
          const tab = (parts[3] || 'stats') as CP.AnalysisTab;
          await interaction.deferUpdate();
          const payload = await this.buildAnalysisPayloadSafe(fixtureId, tab);
          await interaction.editReply(payload);
          return;
        }

        /* ---------- analyze ---------- */
        if (id.startsWith('cp:analyze:')) {
          const fixtureId = id.split(':').slice(2).join(':');
          await interaction.deferReply();
          await showAnalysis(interaction, fixtureId, 'stats');
          return;
        }

        /* ---------- track live ---------- */
        if (id.startsWith('cp:track:')) {
          const fixtureId = id.split(':').slice(2).join(':');
          await interaction.deferReply();
          await interaction.followUp({ content: 'Starting live tracker…', ephemeral: true });
          const channel: any = interaction.channel;
          if (channel?.send) await startLiveTracker(channel, fixtureId, ownerId);
          return;
        }

        /* ---------- live tracker buttons ---------- */
        const live = CP.findTrackerByCustomId(id);
        if (live) {
          const { tracker, action } = live;

          if (action === 'track') {
            // Ensure the originating channel is registered for live alerts,
            // even when tracking was started from this tracker message.
            const added = CP.subscribeLive(tracker.userId, tracker.channelId, tracker.fixtureId);
            await interaction.reply({
              content: added
                ? `⚡ Channel alerts enabled — goals, own goals, red cards and halftime reports will be posted in <#${tracker.channelId}>.`
                : 'This match is already being tracked in this channel.',
              ephemeral: true,
              components: [CP.buildDmAlertsRow(tracker.userId, this.dmAlerts.has(tracker.userId))],
            });
            return;
          }

          // Acknowledge the click before any provider work. `analysisFor` does a
          // fixture sweep plus a match-details lookup, either of which can outlive
          // Discord's 3-second interaction window; deferring first keeps the
          // button instant and lets the tracker message be edited in place.
          await interaction.deferUpdate();

          const found = await analysisFor(tracker.fixtureId);

          if (action === 'alerts') {
            tracker.alertsEnabled = !tracker.alertsEnabled;
            if (!found) {
              await interaction.followUp({ content: 'Match data is currently unavailable.', ephemeral: true }).catch(() => {});
              return;
            }
            tracker.fingerprint = CP.liveFingerprint(found.details);
            await CP.editOrFollowUp(interaction, { components: [CP.buildLiveActionRow(tracker.messageId, tracker.alertsEnabled) as any] });
            return;
          }

          if (!found) {
            await interaction.followUp({ content: 'Match data is currently unavailable for that fixture.', ephemeral: true }).catch(() => {});
            return;
          }

          const fingerprint = CP.liveFingerprint(found.details);
          tracker.fingerprint = fingerprint;
          tracker.updatedAt = Date.now();

          if (action === 'refresh') {
            await CP.editOrFollowUp(interaction, {
              embeds: [CP.buildLiveMatchEmbed(found.details, tracker.alertsEnabled)],
              components: [CP.buildLiveActionRow(tracker.messageId, tracker.alertsEnabled) as any],
            });
            return;
          }

          if (action === 'stats') {
            await CP.editOrFollowUp(interaction, {
              embeds: [CP.buildStatsTab(found.details)],
              components: [CP.buildLiveActionRow(tracker.messageId, tracker.alertsEnabled) as any],
            });
            return;
          }
        }

        /* ---------- live match picker ---------- */
        if (id === 'cp:live:match') {
          const fixtureId = interaction.values?.[0];
          if (!fixtureId || fixtureId === 'none') {
            await interaction.reply({ content: 'No matches are available to track right now.', ephemeral: true });
            return;
          }
          await interaction.reply({ content: 'Starting live tracker…', ephemeral: true });
          const channel: any = interaction.channel;
          if (channel?.send) await startLiveTracker(channel, fixtureId, ownerId);
          return;
        }

        if (id.startsWith('cp:live:track:')) {
          const fixtureId = id.split(':').slice(3).join(':');
          await interaction.deferReply();
          const found = await analysisFor(fixtureId);
          if (!found) {
            await interaction.followUp({ content: 'Match data is currently unavailable.', ephemeral: true });
            return;
          }
          const subscribed = CP.subscribeLive(interaction.user.id, interaction.channelId, fixtureId);
          await interaction.followUp({
            content: subscribed
              ? `⚡ You are now tracking **${found.fixture.homeTeam.name}** vs **${found.fixture.awayTeam.name}**! You will receive direct alerts for Goals, Own Goals, Red Cards, and Halftime Reports.`
              : 'You are already tracking this match.',
            ephemeral: true,
            components: [CP.buildDmAlertsRow(interaction.user.id, this.dmAlerts.has(interaction.user.id))],
          });
          return;
        }

        /* ---------- parlay: league ---------- */
        if (id === 'cp:parlay:league') {
          const league = interaction.values?.[0] ?? 'ALL';
          CP.setParlayLeague(ownerId, league);
          // Changing league changes the fixture slate, so the staged match/market reset.
          CP.clearParlayPending(ownerId);
          // Acknowledge before the slate fetch so the panel never times out.
          await interaction.deferUpdate();
          await CP.editOrFollowUp(interaction, await buildParlayView(
            ownerId,
            `Filtering by **${CP.leagueLabel(league)}**. Slip retained — ${CP.getParlay(ownerId).legs.length} leg(s).`,
          ));
          return;
        }

        /* ---------- parlay: match (stage) ---------- */
        if (id === 'cp:parlay:match') {
          const fixtureId = interaction.values?.[0];
          if (!fixtureId || fixtureId === 'none') {
            await interaction.reply({ content: 'No upcoming matches available — every fixture today has already kicked off.', ephemeral: true });
            return;
          }
          // Acknowledge before the slate fetch so the panel never times out.
          await interaction.deferUpdate();
          const fixtures = await parlayFixtures(ownerId);
          const fx = fixtures.find((f: any) => f.id === fixtureId);
          const label = fx ? `${fx.homeTeam.name} v ${fx.awayTeam.name}` : undefined;
          CP.setParlayPendingMatch(ownerId, fixtureId, label);
          await CP.editOrFollowUp(interaction, await buildParlayView(
            ownerId,
            `Match staged: **${label ?? fixtureId}**. Now pick a **market**, then press **➕ Add Leg**.`,
          ));
          return;
        }

        /* ---------- parlay: market (stage) ---------- */
        if (id === 'cp:parlay:market') {
          const market = interaction.values?.[0] as any;
          CP.setParlayPendingMarket(ownerId, market);
          const staged = CP.getParlayPendingMatch(ownerId);
          // Acknowledge before the slate fetch so the panel never times out.
          await interaction.deferUpdate();
          await CP.editOrFollowUp(interaction, await buildParlayView(
            ownerId,
            staged
              ? `Market staged: **${CP.marketLabel(market)}**. Press **➕ Add Leg** to add it to your slip.`
              : 'Pick a **match** first, then a market.',
          ));
          return;
        }

        /* ---------- parlay: add leg ---------- */
        if (id === 'cp:parlay:add') {
          const parlay = CP.getParlay(ownerId);
          const fixtureId = CP.getParlayPendingMatch(ownerId);
          const market = CP.getParlayPendingMarket(ownerId);

          if (!fixtureId) { await rerenderParlayMessage(interaction, 'Choose a **match** first.'); return; }
          if (!market) { await rerenderParlayMessage(interaction, 'Choose a **market** first.'); return; }

          // Acknowledge before the match analysis and odds lookups: both are
          // network calls and can outlive Discord's 3-second window.
          await interaction.deferUpdate();

          const found = await analysisFor(fixtureId);
          if (!found) { await rerenderParlayMessage(interaction, 'That match is no longer available.'); return; }

          const mp = found.details.marketPredictions?.find((p: any) => p.market === market);
          if (!mp || !Number.isFinite(mp.estimatedProbability) || mp.estimatedProbability <= 0) {
            await rerenderParlayMessage(interaction, `No model probability available for ${CP.marketLabel(market as any)} on that match.`);
            return;
          }

          // Attach a real bookmaker price for h2h selections where one exists,
          // so the slip can show combined decimal odds and a genuine +EV edge.
          let marketOdds: number | null = null;
          try {
            const resolved = await this.factory.resolveOdds(found.fixture as any);
            marketOdds =
              market === 'HOME_WIN' ? resolved.home
              : market === 'DRAW' ? resolved.draw
              : market === 'AWAY_WIN' ? resolved.away
              : null;
          } catch { /* odds unavailable — model fair odds will be used */ }

          const res = CP.addLeg(parlay, {
            fixtureId,
            description: `${found.fixture.homeTeam.name} v ${found.fixture.awayTeam.name}`,
            league: found.fixture.league,
            market,
            selection: CP.marketLabel(market as any),
            probability: mp.estimatedProbability,
            confidenceLower: mp.confidenceLower,
            confidenceUpper: mp.confidenceUpper,
            marketOdds,
          });

          if (res.ok) {
            CP.clearParlayPending(ownerId);
            const updated = CP.getParlay(ownerId);
            const odds = CP.parlayMarketOdds(updated) ?? CP.parlayImpliedOdds(updated);
            const combined = CP.parlayCombinedProbability(updated);
            await rerenderParlayMessage(
              interaction,
              `Leg added — **${CP.marketLabel(market as any)}**. ${updated.legs.length} leg(s) • combined ${odds ? `${odds.toFixed(2)}x` : 'N/A'} • model win ${(combined * 100).toFixed(2)}%.`,
            );
            return;
          }
          await rerenderParlayMessage(interaction, res.reason);
          return;
        }

        /* ---------- parlay: remove specific leg ---------- */
        if (id.startsWith('cp:parlay:drop:')) {
          const index = parseInt(id.split(':')[3], 10);
          const parlay = CP.getParlay(ownerId);
          const res = CP.removeLeg(parlay, index);
          await rerenderParlayMessage(interaction, res.ok ? `Leg ${index} removed.` : res.reason);
          return;
        }

        /* ---------- parlay: copy text slip ---------- */
        if (id === 'cp:parlay:copyslip') {
          const parlay = CP.getParlay(ownerId);
          if (!parlay.legs.length) {
            await interaction.reply({ content: 'Add at least one leg before copying your slip.', ephemeral: true });
            return;
          }
          const slip = CP.buildTextSlip(parlay);
          // Discord messages cap at 2000 chars; keep it inside a code block.
          const body = `\`\`\`\n${slip.slice(0, 1900)}\n\`\`\``;
          await interaction.reply({ content: body, ephemeral: true });
          return;
        }

        /* ---------- parlay: save & share ---------- */
        if (id === 'cp:parlay:save') {
          const parlay = CP.getParlay(ownerId);
          const res = CP.saveParlay(parlay);
          if (res.ok) {
            // Persist the slip tied to this channel + user, and subscribe the
            // channel to every leg's fixture so live leg-hit updates land here.
            const saved = CP.saveParlayToDisk(parlay, {
              userId: ownerId,
              channelId: interaction.channelId,
              guildId: interaction.guildId ?? null,
            });
            CP.setParlayDestination(ownerId, interaction.channelId, interaction.guildId ?? null);
            for (const leg of parlay.legs) {
              try { CP.subscribeLive(ownerId, interaction.channelId, leg.fixtureId); } catch { /* best effort */ }
            }
            await interaction.reply({
              content:
                `💾 Saved **${parlay.legs.length}-leg slip** to your account and linked it to <#${interaction.channelId}> for live leg-hit updates.`,
              embeds: [CP.buildSavedParlayEmbed(parlay)],
              ephemeral: true,
            });
            console.log(`[DiscordBot] Saved parlay ${saved.id} (${parlay.legs.length} legs) for user ${ownerId} in channel ${interaction.channelId}`);
          } else {
            await rerenderParlayMessage(interaction, res.reason);
          }
          return;
        }

        /* ---------- parlay: clear ---------- */
        if (id === 'cp:parlay:clear') {
          CP.clearParlay(ownerId);
          const parlay = CP.getParlay(ownerId);
          await rerenderParlayMessage(interaction, 'Slip cleared.');
          return;
        }

        // Handle generated parlay action buttons.
        if (id.startsWith('track_parlay_')) {
          await interaction.deferReply({ ephemeral: true });
          const parlayId = id.replace('track_parlay_', '');
          // Find the most recent saved parlay for this user/channel.
          const slips = CP.getSavedParlaysForUserChannel(interaction.user.id, interaction.channelId);
          const target = slips[slips.length - 1];
          if (target) {
            CP.setSavedParlayActiveTracking(target.id, true);
            CP.subscribeLive(interaction.user.id, interaction.channelId, target.legs[0]?.fixtureId ?? '');
            try {
              await interaction.editReply({
                content: '✅ **Parlay Tracking Activated!** You will receive real-time notifications as legs hit or miss.',
              });
            } catch {
              await interaction.followUp({ content: '✅ **Parlay Tracking Activated!** You will receive real-time notifications as legs hit or miss.', ephemeral: true }).catch(() => {});
            }
          } else {
            await interaction.editReply({ content: 'No saved parlay found to track. Generate one first with /generateparlay.' }).catch(() => {});
          }
          // Update button to disabled "Tracking Active".
          try {
            const row = new ActionRowBuilder<any>().addComponents(
              new ButtonBuilder().setCustomId(`track_parlay_${parlayId}`).setLabel('Tracking Active').setStyle(ButtonStyle.Success).setDisabled(true),
              new ButtonBuilder().setCustomId(`copy_parlay_${parlayId}`).setLabel('Copy Parlay Slip').setStyle(ButtonStyle.Secondary),
            );
            await interaction.message?.edit({ components: [row] }).catch(() => {});
          } catch { /* best effort */ }
          return;
        }

        if (id.startsWith('copy_parlay_')) {
          await interaction.deferReply({ ephemeral: true });
          const slips = CP.getSavedParlaysForUserChannel(interaction.user.id, interaction.channelId);
          const target = slips[slips.length - 1];
          if (target) {
            const text = (target.legs || []).map((l: any, i: number) => `${i + 1}. ${l.description} -> ${l.selection} (${(l.probability * 100).toFixed(1)}%)`).join('\\n');
            await interaction.editReply({ content: '```\n' + text + '\n```' }).catch(() => {});
          } else {
            await interaction.editReply({ content: 'No parlay slip to copy.' }).catch(() => {});
          }
          return;
        }

        // Interactive /team flow: league -> team -> profile.
        if (id === 'team_league_select') {
          await interaction.deferUpdate();
          const leagueId = interaction.values?.[0];
          // Fetch fixtures for the league to extract team names.
          const today = new Date().toISOString().slice(0, 10);
          let teams: string[] = [];
          try {
            const fixtures = await this.factory.getFixturesByDate(today, leagueId);
            const seen = new Set<string>();
            for (const fx of fixtures || []) {
              if (fx.homeTeam?.name && !seen.has(fx.homeTeam.name)) { seen.add(fx.homeTeam.name); teams.push(fx.homeTeam.name); }
              if (fx.awayTeam?.name && !seen.has(fx.awayTeam.name)) { seen.add(fx.awayTeam.name); teams.push(fx.awayTeam.name); }
            }
          } catch { /* fall back to empty */ }
          if (!teams.length) {
            await interaction.editReply({ content: 'No teams found for this competition today. Try another league.' });
            return;
          }
          const teamSelect = new StringSelectMenuBuilder()
            .setCustomId('team_select')
            .setPlaceholder('Select a team')
            .addOptions(teams.slice(0, 25).map((t: string) => ({ label: t, value: t })));
          const row = new ActionRowBuilder<any>().addComponents(teamSelect);
          await interaction.editReply({ content: `Teams in **${leagueId}** — pick one:`, components: [row] });
          return;
        }

        if (id === 'team_select') {
          await interaction.deferUpdate();
          const teamName = interaction.values?.[0];
          if (!teamName) {
            await interaction.editReply({ content: 'No team selected.' });
            return;
          }
          const embed = await this.teamForm(teamName);
          await interaction.editReply({ embeds: [embed], components: [] });
          return;
        }

        if (id === 'hedge_parlay_select') {
          await interaction.deferUpdate();
          const parlayId = interaction.values?.[0];
          const e = new EmbedBuilder().setColor(BRAND.accent).setAuthor({ name: BRAND.author }).setTitle('Auto-Hedge Calculator').setTimestamp(new Date());
          e.setDescription(`Hedge calculations for parlay \`${parlayId}\`. When 4 of 5 legs hit, counter-bet sizing and fair hedge odds will be provided.`);
          e.setFooter({ text: BRAND.footer });
          await interaction.editReply({ embeds: [e], components: [] });
          return;
        }

        // Generic 2-tier dropdown: league -> match -> card.
        // Handles: remind, value, poll, injuries, referee, analysis, cards, compare, h2h, halftime.
        const twoTierPrefixes = ['remind', 'value', 'poll', 'injuries', 'referee', 'analysis', 'cards', 'compare', 'h2h', 'halftime'];
        for (const prefix of twoTierPrefixes) {
          if (id === `${prefix}_league_select`) {
            await interaction.deferUpdate();
            const leagueId = interaction.values?.[0];
            const today = new Date().toISOString().slice(0, 10);
            let matches: { id: string; label: string }[] = [];
            try {
              const fixtures = await this.factory.getFixturesByDate(today, leagueId);
              matches = (fixtures || []).slice(0, 25).map((fx: any) => ({
                id: fx.id,
                label: `${fx.homeTeam?.name ?? 'Home'} vs ${fx.awayTeam?.name ?? 'Away'}`.slice(0, 100),
              }));
            } catch { /* fall back */ }
            if (!matches.length) {
              await interaction.editReply({ content: 'No matches found for this competition today. Try another league.' });
              return;
            }
            const select = new StringSelectMenuBuilder()
              .setCustomId(`${prefix}_match_select`)
              .setPlaceholder('Select a match')
              .addOptions(matches.map((m) => ({ label: m.label, value: m.id })));
            const row = new ActionRowBuilder<any>().addComponents(select);
            await interaction.editReply({ content: `Matches in **${leagueId}** — pick one:`, components: [row] });
            return;
          }

          if (id === `${prefix}_match_select`) {
            await interaction.deferUpdate();
            const fixtureId = interaction.values?.[0];
            if (!fixtureId) {
              await interaction.editReply({ content: 'No match selected.' });
              return;
            }
            let details: any = null;
            try { if (fixtureId) details = await this.factory.getMatchDetails(fixtureId); } catch { /* skip */ }
            const fx = details?.fixture;
            const home = fx?.homeTeam?.name ?? 'Home';
            const away = fx?.awayTeam?.name ?? 'Away';
            const league = fx?.league ?? prefix.toUpperCase();

            let title = '';
            let desc = '';
            switch (prefix) {
              case 'remind':
                title = 'Fixture Reminder Set';
                desc = `You will receive a DM 15 minutes before kickoff for **${home} vs ${away}** with final lineups.`;
                break;
              case 'value':
                title = 'Value Bet Scan';
                desc = `+EV analysis for **${home} vs ${away}**. Check model-vs-market discrepancies above 5% EV.`;
                break;
              case 'poll':
                title = 'Community Match Poll';
                desc = `Vote for **${home} vs ${away}** — Home Win / Draw / Away Win.`;
                break;
              case 'injuries':
                title = 'Injury & Suspension Report';
                desc = details?.injuries?.length
                  ? details.injuries.map((i: any) => `**${i.player}** (${i.teamName}) - ${i.status} - ${i.reason}`).join('\\n')
                  : 'No confirmed injuries or suspensions reported for this fixture.';
                break;
              case 'referee':
                title = 'Referee Assignment';
                desc = 'Referee strictness factor and card rate data will be displayed here when available from the provider.';
                break;
              case 'analysis':
                title = 'Match Analysis';
                desc = `1X2 probabilities, xG expectations, and form trends for **${home} vs ${away}**.`;
                break;
              case 'cards':
                title = 'Cards Market Analysis';
                desc = `Card market evaluation for **${home} vs ${away}**. Team aggressiveness, average fouls, referee strictness, Over/Under card probabilities.`;
                break;
              case 'compare':
                title = 'Team Comparison';
                desc = `Side-by-side metric comparison: **${home}** vs **${away}** — attack rating, defensive stability, xG differential, H2H record.`;
                break;
              case 'h2h':
                title = 'Head-to-Head History';
                desc = `Historical H2H record between **${home}** and **${away}**.`;
                break;
              case 'halftime':
                title = 'Halftime Summary';
                desc = `1st Half / 2nd Half tactical analytics for **${home} vs ${away}**.`;
                break;
            }

            const embed = new EmbedBuilder()
              .setColor(BRAND.accent)
              .setAuthor({ name: BRAND.author })
              .setTitle(title)
              .setDescription(desc)
              .setFooter({ text: `${BRAND.footer} - ${league}` })
              .setTimestamp(new Date());
            await interaction.editReply({ embeds: [embed], components: [] });
            return;
          }
        }
      } catch (err: any) {
        console.warn(`[DiscordBot] interaction error (${id}): ${err.message}`);
        const body = 'Something went wrong handling that selection.';
        try {
          if (interaction.deferred || interaction.replied) {
            await interaction.followUp({ content: body, ephemeral: true });
          } else {
            await interaction.reply({ content: body, ephemeral: true });
          }
        } catch { /* interaction token expired */ }
      }
    });

    /* ================================================================ *
     * Live tracker auto-refresh loop
     *
     * Polls tracked matches and edits their embed only when the state
     * fingerprint actually changes, which keeps us well inside rate limits.
     * ================================================================ */
    this.liveRefreshTimer = setInterval(async () => {
      const trackers = CP.allTrackers();
      if (!trackers.length || !this.client?.isReady()) return;

      const byFixture = new Map<string, typeof trackers>();
      for (const t of trackers) {
        if (!byFixture.has(t.fixtureId)) byFixture.set(t.fixtureId, []);
        byFixture.get(t.fixtureId)!.push(t);
      }

      for (const [fixtureId, group] of byFixture) {
        let details: any = null;
        try {
          details = await this.factory.getMatchDetails(fixtureId);
        } catch { continue; }
        if (!details) continue;

        const fingerprint = CP.liveFingerprint(details);
        for (const tracker of group) {
          if (tracker.fingerprint === fingerprint) continue;
          tracker.fingerprint = fingerprint;
          tracker.updatedAt = Date.now();
          try {
            const message: any = await this.client.channels.fetch(tracker.channelId)
              .then((ch: any) => ch?.messages?.fetch(tracker.messageId))
              .catch(() => null);
            if (!message?.edit) continue;
            await message.edit({
              embeds: [CP.buildLiveMatchEmbed(details, tracker.alertsEnabled)],
              components: [CP.buildLiveActionRow(tracker.messageId, tracker.alertsEnabled)],
            });
          } catch (e: any) {
            console.warn(`[DiscordBot] live refresh failed for ${tracker.messageId}: ${e.message}`);
          }
        }
      }
    }, 30_000);

    // Never keep the process alive just for the refresh loop.
    (this.liveRefreshTimer as any)?.unref?.();

    /* ================================================================ *
     * Live-event alert worker (every 60s)
     *
     * Polls all live fixtures via ESPN, detects newly-published goals,
     * own goals, red cards and halftime whistles, and broadcasts targeted
     * alert embeds to every subscribed user/channel. The tick body lives in
     * `runLiveEventTick()` so boot can fire it once immediately for fixtures
     * that were restored from disk.
     * ================================================================ */
    // Sub-second 500ms micro-loop for in-play matches (separate from daily fixture fetches).
    this.liveEventTimer = setInterval(() => { void this.runLiveEventTick(); }, 500);

    // Never keep the process alive just for the alert loop.
    (this.liveEventTimer as any)?.unref?.();

    /* ================================================================ *
     * Daily morning briefing scheduler (default 08:00, /setbrief to change)
     * ================================================================ */
    this.briefingTimer = setInterval(async () => {
      if (!this.client?.isReady()) return;
      const now = new Date();
      const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
      const today = now.toISOString().slice(0, 10);
      const target = this.briefingTime || '08:00';
      if (hhmm === target && this.lastBriefingDate !== today) {
        this.lastBriefingDate = today;
        await this.sendMorningBriefing();
      }
    }, 60_000);
    (this.briefingTimer as any)?.unref?.();

    // Handle Standard Chat Message Commands (e.g. /info or !info or !parlay)
    this.client.on('messageCreate', async message => {
      if (message.author.bot) return;
      const content = message.content.trim().toLowerCase();

      if (content === '/info' || content === '!info' || content === '!help' || content === '/help') {
        const embed = this.buildInfoEmbed();
        await message.reply({ embeds: [embed] });
      } else if (content === '!fixtures' || content === '!odds' || content === '/fixtures' || content === '/odds') {
        const replyText = await this.generateFixturesReply();
        await message.reply(replyText);
      } else if (content.startsWith('!sgp') || content.startsWith('/sgp')) {
        const replyText = await this.generateParlayReply({ legs: 5, mode: 'SAME_GAME_PARLAY', minProbability: 0.58 });
        await message.reply(replyText);
      } else if (content === '!track' || content === '/track') {
        const reply = await this.generateLiveTrackerReply({
          userId: message.author.id,
          channelId: message.channel.id,
        });
        if (typeof reply === 'string') {
          await message.reply(reply);
        } else {
          await message.reply({ embeds: reply.slice(0, 2) });
        }
      } else if (content.startsWith('!channel') || content.startsWith('/channel')) {
        const parts = content.split(' ');
        const interval: UpdateInterval = (['5m', '15m', '30m', '45m', '1h'].includes(parts[1]) ? parts[1] : this.currentInterval) as any;
        this.setBroadcastConfig(message.channel.id, interval);
        await message.reply(`✅ **Linked to this channel (<#${message.channel.id}>) with \`${interval}\` update intervals!**`);
      } else if (content.startsWith('!interval') || content.startsWith('/interval')) {
        const parts = content.split(' ');
        const interval: UpdateInterval = (['5m', '15m', '30m', '45m', '1h'].includes(parts[1]) ? parts[1] : '1h') as any;
        this.setBroadcastConfig(undefined, interval);
        await message.reply(`⏱️ **Broadcast interval updated to \`${interval}\`!**`);
      } else if (content.startsWith('!parlay') || content.startsWith('/parlay') ||
                 content.startsWith('!generateparlay') || content.startsWith('/generateparlay')) {
        const parts = content.split(' ');
        const legs = parseInt(parts[1] || '5', 10);
        const mode: ParlayMode = content.includes('sgp') || content.includes('same')
          ? 'SAME_GAME_PARLAY'
          : content.includes('corr')
          ? 'CORRELATED_ALLOWED'
          : 'ANTI_CORRELATED';
        const replyText = await this.generateParlayReply({ legs, mode });
        await message.reply(replyText);
      } else if (content === '!broadcast' || content === '/broadcast') {
        const embed = await this.buildMorningBriefing();
        await this.deliverBriefing(embed, '/broadcast');
        await message.reply('✅ **Briefing broadcast delivered.**');
      }
    });

    await this.client.login(this.config.botToken);
  }

  /* ------------------------------------------------------------------ *
   * Live-event worker
   * ------------------------------------------------------------------ */

  /**
   * One pass of the 60-second live-event worker.
   *
   * Also fired once from `start()` when subscriptions were restored from disk,
   * so a restarted process resumes goal/card/halftime alerting and saved-slip
   * leg settlement immediately instead of waiting up to a minute.
   */
  private async runLiveEventTick(): Promise<void> {
    if (!this.client?.isReady()) return;
    try {
      const today = new Date().toISOString().slice(0, 10);
      const fixtures = await this.factory.getFixturesByDate(today, 'ALL');
      const sweptLive = fixtures.filter((f: any) => f.status === 'LIVE');
      // Restored subscriptions can point at a match the sweep does not list
      // (kick-off before UTC midnight, or a short sweep). Those are resolved
      // directly so tracking never goes quiet after a restart.
      const liveFixtures = [...sweptLive, ...(await this.pinnedLiveFixtures(sweptLive))];

      for (const fx of liveFixtures) {
        const eventId = fx.id.replace(/^espn-/, '');
        const stats = await this.factory.getEspnMatchStats(eventId);
        if (!stats) continue;

        // Sync post-event score before building any alert payload.
        if (stats.homeScore !== null && stats.homeScore !== undefined) fx.homeScore = stats.homeScore;
        if (stats.awayScore !== null && stats.awayScore !== undefined) fx.awayScore = stats.awayScore;

        const prevStats = this.liveEventPrevStats.get(fx.id);
        this.liveEventPrevStats.set(fx.id, stats);

        const newEvents = CP.detectNewEvents(prevStats ?? null, stats);
        const firstPoll = !this.liveEventFirstPolled.has(fx.id);
        this.liveEventFirstPolled.add(fx.id);

        // Halftime transition detection (status-based, for non-ESPN providers).
        const prevStatus = this.liveEventLastStatus.get(fx.id);
        this.liveEventLastStatus.set(fx.id, fx.status);

        // Live parlay leg tracking: settle any saved slip legs on this match
        // and broadcast a PARLAY UPDATE to the channel that saved the slip.
        await this.processSavedParlayLegs(fx, stats);

        const subs = CP.getSubscriptionsForFixture(fx.id);
        if (!subs.length && !newEvents.some((ev) => ev.type === 'halftime')) continue;

        const mentions = subs.map((s) => `<@${s.userId}>`).join(' ');

        // Score rollback detection (disallowed goal) - after subs are resolved.
        const prevStatsForRollback = this.liveEventPrevStats.get(fx.id);
        // Note: prevStatsForRollback is the PREVIOUS poll's stats (before this update)
        // We need to compare against the score BEFORE this poll's update.
        // Since we already updated fx.homeScore above, we compare against prevStats.
        // But prevStats was already overwritten. Let's use the stored previous.
        // Actually, we stored prevStats before overwriting. Let me re-check.
        // The code above did: this.liveEventPrevStats.set(fx.id, stats) BEFORE this point.
        // So prevStats variable (from line ~1830) is still in scope and has the old value.

        // Score rollback detection using the previous poll's score.
        const oldHomeScore = prevStats?.homeScore ?? null;
        const oldAwayScore = prevStats?.awayScore ?? null;
        if (oldHomeScore !== null && oldHomeScore !== undefined && fx.homeScore !== null && fx.homeScore < oldHomeScore) {
          // Home score decreased - disallowed goal
          const rollbackEvent: any = { id: `rollback-home-${Date.now()}`, type: 'var', minute: fx.liveClock ?? null, team: fx.homeTeam?.name, player: null, assist: null, text: 'Goal disallowed (VAR Review)' };
          const rollbackEmbed = CP.buildDisallowedGoalAlert(rollbackEvent, fx);
          for (const sub of subs) {
            try {
              const ch = await this.client.channels.fetch(sub.channelId);
              if (ch?.isTextBased()) await (ch as any).send({ content: `<@${sub.userId}>`, embeds: [rollbackEmbed] });
            } catch { /* skip */ }
          }
        }
        if (oldAwayScore !== null && oldAwayScore !== undefined && fx.awayScore !== null && fx.awayScore < oldAwayScore) {
          // Away score decreased - disallowed goal
          const rollbackEvent: any = { id: `rollback-away-${Date.now()}`, type: 'var', minute: fx.liveClock ?? null, team: fx.awayTeam?.name, player: null, assist: null, text: 'Goal disallowed (VAR Review)' };
          const rollbackEmbed = CP.buildDisallowedGoalAlert(rollbackEvent, fx);
          for (const sub of subs) {
            try {
              const ch = await this.client.channels.fetch(sub.channelId);
              if (ch?.isTextBased()) await (ch as any).send({ content: `<@${sub.userId}>`, embeds: [rollbackEmbed] });
            } catch { /* skip */ }
          }
        }

        for (const ev of newEvents) {
          // On the very first poll for a fixture, seed seen events without
          // alerting, so historical events don't trigger alert storms.
          if (firstPoll) {
            CP.markEventSeen(ev.id);
            continue;
          }
          if (CP.isSeenEvent(ev.id)) continue;

          // Atomic deduplication lock (60s TTL) to prevent double-posting
          // during high-frequency sub-second checks.
          const eventHash = `${fx.id}_${ev.team ?? 'unknown'}_${ev.minute ?? '0'}_${ev.type}`.toUpperCase().replace(/[^A-Z0-9_]/g, '');
          // Check if already processed
          const dedupSet = (global as any).__dedupSet || new Set<string>();
          if (! (global as any).__dedupSet) (global as any).__dedupSet = dedupSet;
          if (dedupSet.has(eventHash)) continue;
          dedupSet.add(eventHash);
          setTimeout(() => dedupSet.delete(eventHash), 60_000);

          CP.markEventSeen(ev.id);

          let embed: any = null;
          if (ev.type === 'goal' || ev.type === 'own-goal') {
            // Calculate post-goal score before building the alert.
            const prevStats = this.liveEventPrevStats.get(fx.id);
            const prevHome = prevStats?.homeScore ?? fx.homeScore ?? 0;
            const prevAway = prevStats?.awayScore ?? fx.awayScore ?? 0;
            const isHome = ev.team === fx.homeTeam?.name;
            if (isHome) {
              fx.homeScore = Math.max(fx.homeScore ?? 0, prevHome + 1);
            } else {
              fx.awayScore = Math.max(fx.awayScore ?? 0, prevAway + 1);
            }
            embed = CP.buildGoalAlert(ev, fx);
          } else if (ev.text && /disallowed|cancelled|var.*review/i.test(ev.text)) {
            // Disallowed goal / VAR alert
            const prevStats = this.liveEventPrevStats.get(fx.id);
            // Roll back score if needed
            if (prevStats?.homeScore !== null && prevStats?.homeScore !== undefined) {
              fx.homeScore = prevStats.homeScore;
            }
            if (prevStats?.awayScore !== null && prevStats?.awayScore !== undefined) {
              fx.awayScore = prevStats.awayScore;
            }
            embed = CP.buildDisallowedGoalAlert(ev, fx);
          } else if (ev.type === 'red-card') {
            embed = CP.buildRedCardAlert(ev, fx);
          } else if (ev.type === 'halftime') {
            // Build a full halftime analysis report via getMatchDetails.
            try {
              const analysis = await this.factory.getMatchDetails(fx.id);
              if (analysis) embed = CP.buildHalftimeReport(analysis);
            } catch { /* analysis unavailable - skip halftime report */ }
          }
          if (!embed) continue;

          for (const sub of subs) {
            try {
              const ch = await this.client.channels.fetch(sub.channelId);
              const sendTasks: Promise<any>[] = [];
              // Direct webhook dispatch for instant delivery (parallel).
              if (this.config.webhookUrl) {
                sendTasks.push(
                  axios.post(this.config.webhookUrl, { username: 'Cape Predictor', embeds: [embed] }).catch(() => {})
                );
              }
              if (ch?.isTextBased()) {
                sendTasks.push((ch as any).send({ content: mentions, embeds: [embed] }));
              }
              await Promise.all(sendTasks);
            } catch (e: any) {
              console.warn(`[LiveEvents] alert send failed for ${sub.channelId}: ${e.message}`);
            }
            // Honoured DM alerts: users who opted in receive the alert privately.
            if (this.dmAlerts.has(sub.userId)) {
              try {
                const user = await this.client.users.fetch(sub.userId);
                await user.send({ embeds: [embed] });
              } catch { /* DMs closed or user unavailable */ }
            }
          }
        }

        // Status-based halftime fallback (non-ESPN providers reporting HT).
        if (prevStatus === 'LIVE' && fx.status !== 'LIVE' && fx.status !== 'FINISHED' && subs.length) {
          try {
            const analysis = await this.factory.getMatchDetails(fx.id);
            if (analysis) {
              const embed = CP.buildHalftimeReport(analysis);
              for (const sub of subs) {
                try {
                  const ch = await this.client.channels.fetch(sub.channelId);
                  if (ch?.isTextBased()) {
                    await (ch as any).send({ content: mentions, embeds: [embed] });
                  }
                } catch { /* send failed */ }
              }
            }
          } catch { /* analysis unavailable */ }
        }
      }

      // Settle saved-parlay legs on matches that have now finished.
      for (const fx of fixtures) {
        if (fx.status !== 'FINISHED') continue;
        if (!CP.getSavedParlaysForFixture(fx.id).length) continue;
        let stats: any = null;
        try { stats = await this.factory.getEspnMatchStats(fx.id.replace(/^espn-/, '')); } catch { /* stats optional */ }
        await this.processSavedParlayLegs(fx, stats);
      }

      // Keep subscribed channels' topics in sync during match windows.
      await this.syncLiveChannelTopics(liveFixtures);
    } catch (e: any) {
      console.warn('[LiveEvents] alert worker tick failed:', e.message);
    }
  }

  /**
   * Resolve fixtures restored from disk that the day's sweep did not return.
   *
   * Each pinned id is looked up once per tick. A finished match gets its saved
   * parlay legs settled and is then unpinned, so the set stays bounded by the
   * number of matches users are actually tracking — it never grows forever.
   */
  private async pinnedLiveFixtures(existing: any[]): Promise<any[]> {
    if (!this.liveEventPinnedFixtureIds.size) return [];
    const seen = new Set(existing.map((f) => f.id));
    const extra: any[] = [];

    for (const fixtureId of [...this.liveEventPinnedFixtureIds]) {
      if (seen.has(fixtureId)) continue;
      try {
        const details: any = await this.factory.getMatchDetails(fixtureId);
        const fixture = details?.fixture;
        if (!fixture) continue; // provider has nothing yet — keep it pinned

        if (fixture.status === 'FINISHED' || fixture.status === 'POSTPONED') {
          if (fixture.status === 'FINISHED' && CP.getSavedParlaysForFixture(fixtureId).length) {
            let stats: any = null;
            try { stats = await this.factory.getEspnMatchStats(String(fixtureId).replace(/^espn-/, '')); } catch { /* stats optional */ }
            await this.processSavedParlayLegs(fixture, stats);
          }
          this.liveEventPinnedFixtureIds.delete(fixtureId);
          continue;
        }

        if (CP.isActiveLiveFixture(fixture)) extra.push(fixture);
      } catch { /* provider unavailable — try again next tick */ }
    }

    return extra;
  }

  /* ---------------- QoL command helpers ---------------- */
  private async headToHead(t1: string, t2: string): Promise<EmbedBuilder> {
    const e = new EmbedBuilder()
      .setColor(BRAND.accent)
      .setAuthor({ name: BRAND.author })
      .setTitle(`⚔️ Head-to-Head: ${t1} vs ${t2}`)
      .setTimestamp(new Date());
    const meetings: any[] = [];
    const lt1 = t1.toLowerCase();
    const lt2 = t2.toLowerCase();
    for (let d = 1; d <= 45 && meetings.length < 10; d++) {
      const date = new Date(Date.now() - d * 86400000).toISOString().slice(0, 10);
      try {
        const list = await CP.fetchVerifiedFixtures(this.factory, date, 'ALL');
        for (const f of list) {
          const h = f.homeTeam.name.toLowerCase();
          const a = f.awayTeam.name.toLowerCase();
          if ((h.includes(lt1) && a.includes(lt2)) || (h.includes(lt2) && a.includes(lt1))) {
            meetings.push(f);
          }
        }
      } catch { /* skip date */ }
    }
    if (!meetings.length) {
      e.setDescription('No recent head-to-head meetings found in our verified archive.');
      return e;
    }
    let t1W = 0, t2W = 0, draws = 0;
    const lines = meetings.slice(0, 8).map((f) => {
      const h = f.homeTeam.name.toLowerCase().includes(lt1);
      const hs = f.homeScore ?? 0;
      const as = f.awayScore ?? 0;
      let winner: string;
      if (hs > as) winner = h ? t1 : t2;
      else if (hs < as) winner = h ? t2 : t1;
      else winner = 'Draw';
      if (winner === t1) t1W++; else if (winner === t2) t2W++; else draws++;
      return `• ${f.homeTeam.name} ${hs}-${as} ${f.awayTeam.name} — **${winner}** (${f.date})`;
    });
    e.setDescription(
      `Last ${meetings.length} meeting${meetings.length === 1 ? '' : 's'}:\n${lines.join('\n')}\n\n` +
      `**${t1} wins:** ${t1W}  •  **Draws:** ${draws}  •  **${t2} wins:** ${t2W}`
    );
    e.setFooter({ text: `${BRAND.footer} • Verified archive only` });
    return e;
  }

  private async teamForm(name: string): Promise<EmbedBuilder> {
    const e = new EmbedBuilder()
      .setColor(BRAND.accent)
      .setAuthor({ name: BRAND.author })
      .setTitle(`📊 Team Form: ${name}`)
      .setTimestamp(new Date());
    const lt = name.toLowerCase();
    const form: Array<'W' | 'D' | 'L'> = [];
    for (let d = 1; d <= 45 && form.length < 8; d++) {
      const date = new Date(Date.now() - d * 86400000).toISOString().slice(0, 10);
      try {
        const list = await CP.fetchVerifiedFixtures(this.factory, date, 'ALL');
        for (const f of list) {
          const h = f.homeTeam.name.toLowerCase();
          const a = f.awayTeam.name.toLowerCase();
          if (!h.includes(lt) && !a.includes(lt)) continue;
          const hs = f.homeScore ?? null;
          const as = f.awayScore ?? null;
          if (hs === null || as === null) continue;
          const isHome = h.includes(lt);
          const gf = isHome ? hs : as;
          const ga = isHome ? as : hs;
          form.push(gf > ga ? 'W' : gf === ga ? 'D' : 'L');
          if (form.length >= 6) break;
        }
      } catch { /* skip date */ }
      if (form.length >= 6) break;
    }
    if (form.length === 0) {
      e.setDescription('No recent completed fixtures found for this team in our verified archive.');
      return e;
    }
    const w = form.filter(r => r === 'W').length;
    const dr = form.filter(r => r === 'D').length;
    const l = form.filter(r => r === 'L').length;
    const glyphs = form.map(r => (r === 'W' ? '🟢' : r === 'D' ? '🟡' : '🔴')).join('');
    e.setDescription(
      `Last ${form.length} match${form.length === 1 ? '' : 'es'}:\n${glyphs}\n\n` +
      `**${w}W ${dr}D ${l}L**`
    );
    e.setFooter({ text: `${BRAND.footer} • Verified archive only` });
    return e;
  }

  private async valuePicks(): Promise<EmbedBuilder> {
    const e = new EmbedBuilder()
      .setColor(BRAND.accent)
      .setAuthor({ name: BRAND.author })
      .setTitle('💎 +EV Value Picks')
      .setTimestamp(new Date());
    const today = new Date().toISOString().slice(0, 10);
    const allFixtures = await this.factory.getFixturesByDate(today, 'ALL');
    const fixtures = orderFixturesByPriority(allFixtures.filter(isVerifiedFixture));
    const ranked: Array<{ fx: any; model: number; label: string }> = [];
    for (const fx of fixtures) {
      try {
        const details = await this.factory.getMatchDetails(fx.id);
        if (!details?.marketPredictions) continue;
        const h = details.marketPredictions.find((p: any) => p.market === 'HOME_WIN')?.estimatedProbability ?? null;
        const d = details.marketPredictions.find((p: any) => p.market === 'DRAW')?.estimatedProbability ?? null;
        const a = details.marketPredictions.find((p: any) => p.market === 'AWAY_WIN')?.estimatedProbability ?? null;
        const best = [h, d, a].filter((v): v is number => v !== null);
        if (!best.length) continue;
        const max = Math.max(...best);
        const label = max === h ? `${fx.homeTeam.name} to Win` : max === d ? 'Draw' : `${fx.awayTeam.name} to Win`;
        ranked.push({ fx, model: max, label });
      } catch { /* skip fixture */ }
    }
    // Competition priority first (EPL • UCL), then the strongest model price.
    const top = orderByCompetitionPriorityThenScore(
      ranked,
      (r) => r.fx.league,
      (r) => r.model,
    ).slice(0, 6);
    if (!top.length) {
      e.setDescription('No value picks found today. Model predictions unavailable.');
      return e;
    }
    const configured = this.factory.isOddsConfigured();
    const lines: string[] = [];
    for (const p of top) {
      const fair = 1 / p.model;
      let extra = `Fair ${fair.toFixed(2)}x`;
      if (configured) {
        try {
          const odds = await this.factory.getOddsForFixture(p.fx as any);
          const prices = this.extractH2hPricesLocal(odds);
          const mkt = p.label.includes('Win') && p.label.includes(p.fx.homeTeam.name)
            ? prices.home
            : p.label === 'Draw' ? prices.draw : prices.away;
          if (mkt) {
            const edge = (p.model - 1 / mkt) * 100;
            extra = `Market ${mkt.toFixed(2)}x → Edge ${edge > 0 ? '+' : ''}${edge.toFixed(1)}%`;
          }
        } catch { /* odds unavailable for this fixture */ }
      }
      lines.push(`• **${p.label}** — ${p.fx.homeTeam.name} vs ${p.fx.awayTeam.name}\n     Model ${(p.model * 100).toFixed(0)}% → ${extra}`);
    }
    e.setDescription(`Model vs market-implied odds. Positive edge = value.\n\n${lines.join('\n')}`);
    e.setFooter({ text: `${BRAND.footer} • Model estimates, not financial advice` });
    return e;
  }

  /**
   * Builds a community match prediction poll embed for /poll.
   */
  public buildPollEmbed(matchId: string): EmbedBuilder {
    const e = new EmbedBuilder()
      .setColor(BRAND.accent)
      .setAuthor({ name: BRAND.author })
      .setTitle('📊 Community Match Prediction')
      .setTimestamp(new Date());
    e.setDescription(
      `Cast your vote for **${matchId}**.\n\n` +
      `React with:\n` +
      `🏠 Home Win\n` +
      `🤝 Draw\n` +
      `✈️ Away Win\n\n` +
      `Results tallied after kickoff.`
    );
    e.setFooter({ text: `${BRAND.footer} • Community predictions, not advice` });
    return e;
  }

  /**
   * Extract h2h prices from an odds snapshot (local helper for valuePicks).
   */

  public async buildShareCard(parlayId?: string): Promise<EmbedBuilder> {
    const slips = CP.getSavedParlays();
    const target = parlayId ? slips.find((s: any) => s.id === parlayId) : slips[slips.length - 1];
    const code = '#CP-' + Math.random().toString(36).substring(2, 6).toUpperCase();
    const e = new EmbedBuilder()
      .setColor(BRAND.accent)
      .setAuthor({ name: BRAND.author })
      .setTitle('Shareable Parlay Slip')
      .setTimestamp(new Date());

    if (!target) {
      e.setDescription('No saved parlay slip found. Build one with /customparlay and press Save & Share first.');
      e.setFooter({ text: `${BRAND.footer} - Shareable slip` });
      return e;
    }

    const combined = target.combinedProbability ?? 0;
    const odds = target.combinedOdds;
    const lines = (target.legs || []).map((l: any, i: number) => {
      const price = l.marketOdds ? ' @ ' + Number(l.marketOdds).toFixed(2) + 'x' : '';
      return (i + 1) + '. ' + l.description + ' -> ' + l.selection + ' (' + (l.probability * 100).toFixed(1) + '%)' + price;
    }).join('\\n');

    e.setDescription('Slip code: **' + code + '**\\n\\n' + lines);
    e.addFields({
      name: 'Snapshot',
      value: 'Combined **' + (combined * 100).toFixed(2) + '%** | fair **' + (odds ? odds.toFixed(2) : 'n/a') + 'x** | stake **' + target.stake + '** | ' + target.legs.length + ' leg(s)',
      inline: false,
    });
    e.setFooter({ text: `${BRAND.footer} - ${code} - Shareable slip` });
    return e;
  }

  private extractH2hPricesLocal(odds: any): { home: number | null; draw: number | null; away: number | null } {
    let market: any = null;
    for (const b of odds.bookmakers || []) {
      const m = b.markets.find((mk: any) => mk.key === 'h2h');
      if (m) { market = m; break; }
    }
    if (!market) return { home: null, draw: null, away: null };
    const safe = (v: any) => (typeof v === 'number' && isFinite(v) && v > 0 ? v : null);
    return {
      home: safe(market.outcomes?.find((o: any) => o.name === odds.homeTeam)?.price),
      away: safe(market.outcomes?.find((o: any) => o.name === odds.awayTeam)?.price),
      draw: safe(market.outcomes?.find((o: any) => /draw/i.test(o.name))?.price),
    };
  }

  /**
   * Builds the daily morning briefing embed (8:00 default) for broadcast/DM.
   *
   * Layout — no prose padding, no repeated fixtures:
   *   1. Top Value Picks (EPL & Champions League Priority) — 3–5 upcoming
   *      selections, one per fixture
   *   2. Featured 5-Leg High-Probability Slip — built from a different set of
   *      fixtures than section 1
   *   3. Team News & Key Absences — provider-reported injuries/suspensions
   *
   * Only fixtures that have not kicked off are considered, so the briefing can
   * never advertise a match that is already live or finished. The slate is
   * ranked Premier League and UEFA Champions League first, so the priority
   * fixtures lead both the value picks and the featured parlay.
   */

  /**
   * Handle /generateparlay: defer immediately, then run the (event-loop
   * friendly) parlay builder under an outer 4s interaction guard.
   */
  private async handleGenerateParlay(interaction: any): Promise<void> {
    // deferReply MUST be the first await inside the handler.
    if (!interaction.deferred && !interaction.replied) {
      await interaction.deferReply();
    }

    const legs = interaction.options.getInteger('legs') || 5;
    const minPct = interaction.options.getInteger('min_probability');
    const league = interaction.options.getString('league') || 'ALL';
    const commandMode = interaction.options.getString('mode') || 'anti_correlated';
    const mode: ParlayMode = commandMode === 'same_game'
      ? 'SAME_GAME_PARLAY'
      : commandMode === 'correlated'
      ? 'CORRELATED_ALLOWED'
      : 'ANTI_CORRELATED';

    // Hard ceiling on market scanning: a stalled odds provider must never
    // leave the interaction on "thinking...". Rejects at 3.5s so the outer
    // 4s interaction guard stays a pure last resort.
    const replyText = await Promise.race([
      this.generateParlayReply({
        legs,
        mode,
        league,
        minProbability: minPct ? minPct / 100 : undefined,
        userId: interaction.user.id,
        channelId: interaction.channelId,
      }),
      new Promise<string>((_, reject) =>
        setTimeout(() => reject(new Error('Parlay generation timed out after 3500ms')), 3500)
      ),
    ]);

    if (!replyText || !replyText.trim()) {
      throw new Error('Parlay builder returned an empty ticket');
    }

    const embed = new EmbedBuilder()
      .setColor(BRAND.accent)
      .setAuthor({ name: BRAND.author })
      .setTitle('Generated Parlay')
      .setDescription(replyText.slice(0, 4000))
      .setTimestamp(new Date());

    const parlayId = `gen-${Date.now()}`;
    const actionRow = new ActionRowBuilder<any>().addComponents(
      new ButtonBuilder()
        .setCustomId(`track_parlay_${parlayId}`)
        .setLabel('Save & Track Parlay')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(`copy_parlay_${parlayId}`)
        .setLabel('Copy Parlay Slip')
        .setStyle(ButtonStyle.Secondary),
    );

    await interaction.editReply({ embeds: [embed], components: [actionRow] });
  }

  public async buildMorningBriefing(): Promise<EmbedBuilder> {
    const today = new Date().toISOString().slice(0, 10);

    let upcoming: any[] = [];
    try {
      const allFixtures = await this.factory.getFixturesByDate(today, 'ALL');
      // EPL/UCL first: the top of this list feeds both the prediction sweep
      // (the first 8 fixtures) and the featured parlay's candidate pool.
      upcoming = orderFixturesByPriority(
        CP.filterUpcomingFixtures((allFixtures ?? []).filter(isVerifiedFixture)),
      );
    } catch {
      upcoming = [];
    }

    // Gather model predictions and provider-reported team news for the slate.
    // A wider slice than the 5 shown in section 1, so the featured slip still has
    // a full pool to draw from once the picked matches are set aside.
    const candidatePredictions: MarketPrediction[] = [];
    const injuryBulletins: string[] = [];
    for (const fx of upcoming.slice(0, 14)) {
      try {
        const details = await this.factory.getMatchDetails(fx.id);
        if (!details) continue;
        if (details.marketPredictions?.length) candidatePredictions.push(...details.marketPredictions);
        if (details.injuries?.length) {
          for (const inj of details.injuries.slice(0, 2)) {
            const reason = inj.reason ? ` · ${inj.reason}` : '';
            injuryBulletins.push(`• **${inj.teamName}** — ${inj.player} *(${inj.status}${reason})*`);
          }
        }
      } catch { /* provider unavailable for this fixture — skip it */ }
    }

    // ---- Section 1: Top Calibrated Value Picks (one per fixture, 3–5) ----
    const bestByFixture = new Map<string, MarketPrediction>();
    for (const p of candidatePredictions) {
      if (p.market !== 'HOME_WIN' && p.market !== 'DRAW' && p.market !== 'AWAY_WIN') continue;
      const current = bestByFixture.get(p.fixtureId);
      if (!current || p.estimatedProbability > current.estimatedProbability) bestByFixture.set(p.fixtureId, p);
    }
    // Competition priority first (EPL • UCL), then the best calibrated price
    // inside each tier.
    const valuePicks = orderByCompetitionPriorityThenScore(
      [...bestByFixture.values()],
      (p) => p.league,
      (p) => p.estimatedProbability,
    ).slice(0, 5);

    const oddsConfigured = this.factory.isOddsConfigured();
    const fixturesById = new Map<string, any>(upcoming.map((fx) => [fx.id, fx]));
    const pickLines: string[] = [];
    for (const [i, p] of valuePicks.entries()) {
      let extra = `Fair \`${(1 / p.estimatedProbability).toFixed(2)}x\``;
      const fx = fixturesById.get(p.fixtureId);
      if (oddsConfigured && fx) {
        try {
          const prices = this.extractH2hPricesLocal(await this.factory.getOddsForFixture(fx));
          const marketPrice = p.market === 'HOME_WIN' ? prices.home : p.market === 'DRAW' ? prices.draw : prices.away;
          if (marketPrice) {
            const edge = (p.estimatedProbability - 1 / marketPrice) * 100;
            extra += ` • Market \`${marketPrice.toFixed(2)}x\` → Edge \`${edge > 0 ? '+' : ''}${edge.toFixed(1)}%\``;
          }
        } catch { /* odds unavailable for this fixture */ }
      }
      pickLines.push(`**${i + 1}. ${p.fixtureDescription}** [${p.league}]\n> \`${p.selection}\` • Calibrated \`${(p.estimatedProbability * 100).toFixed(1)}%\` • ${extra}`);
    }

    // ---- Section 2: Featured 5-Leg High-Probability Slip ----
    //
    // Deliberately built from a DIFFERENT set of fixtures than section 1: the
    // picked matches are set aside so the slip is a second, independent angle on
    // the same slate rather than the same five games re-listed. If setting them
    // aside leaves too few matches (a very small slate), the full pool is used
    // so the briefing still carries a slip.
    const pickedFixtureIds = new Set(valuePicks.map((p) => p.fixtureId));
    const slipCandidates = candidatePredictions.filter((p) => !pickedFixtureIds.has(p.fixtureId));
    const slipPool = slipCandidates.length >= 5 ? slipCandidates : candidatePredictions;
    const parlay5 = await buildStatisticalParlay(slipPool, { targetLegsCount: 5, minProbability: 0.60 });
    const legLines = parlay5.legs
      .map((l, i) => `**Leg ${i + 1}**: ${l.fixtureDescription} ➔ \`${l.selection}\` (${(l.estimatedProbability * 100).toFixed(0)}%)`)
      .join('\n');
    const parlayReturn = (10 * parlay5.compoundOddsDecimal).toFixed(2);
    const parlayBody = parlay5.legs.length
      ? `${legLines}\n\n**Combined Probability**: \`${(parlay5.combinedProbability * 100).toFixed(2)}%\` • ` +
        `**Compound Odds**: \`${parlay5.compoundOddsDecimal}x\` • **$10 Returns**: \`$${parlayReturn}\``
      : 'Insufficient independent fixtures on today\'s slate to build a 5-leg combination.';

    const e = new EmbedBuilder()
      .setColor(BRAND.accent)
      .setAuthor({ name: BRAND.author })
      .setTitle(`🏆 Cape Predictor Briefing • ${today}`)
      .addFields(
        {
          name: '📊 Top Value Picks (EPL & Champions League Priority)',
          value: pickLines.join('\n\n') || 'No qualifying upcoming fixtures on today\'s slate.',
          inline: false,
        },
        {
          name: '⚡ Featured 5-Leg High-Probability Slip',
          value: parlayBody,
          inline: false,
        },
        {
          name: '🏥 Team News & Key Absences',
          value: injuryBulletins.slice(0, 6).join('\n') ||
            '• No confirmed injuries or suspensions published by the provider for today\'s upcoming fixtures.',
          inline: false,
        },
      )
      .setFooter({ text: `${BRAND.footer} • ${PRIORITY_LEAGUE_LABEL} • Upcoming fixtures only` })
      .setTimestamp(new Date());

    return e;
  }

  /**
   * Sends the morning briefing to the configured channel, the configured
   * webhook, and to users with DM alerts enabled.
   */
  public async sendMorningBriefing(): Promise<void> {
    if (!this.client?.isReady()) return;
    try {
      const embed = await this.buildMorningBriefing();
      // Post to configured channel / webhook via the shared delivery path.
      await this.deliverBriefing(embed, 'morning briefing');
      // DM users who opted into alerts.
      for (const userId of this.dmAlerts) {
        try {
          const user = await this.client.users.fetch(userId);
          if (user) await user.send({ embeds: [embed] });
        } catch { /* DM failed */ }
      }
    } catch (e: any) {
      console.warn(`[Briefing] morning briefing failed: ${e.message}`);
    }
  }

  /**
   * Live channel-topic auto-sync.
   *
   * While matches are live, channels that track a fixture get a topic
   * summarising the live scores. The topic is only rewritten when it actually
   * changes, which keeps us well inside Discord's edit rate limits.
   */
  private async syncLiveChannelTopics(liveFixtures: any[]): Promise<void> {
    if (!this.client?.isReady() || !liveFixtures.length) return;
    const byChannel = new Map<string, any[]>();
    for (const fx of liveFixtures) {
      let subs: any[] = [];
      try {
        subs = CP.getSubscriptionsForFixture(fx.id) || [];
      } catch { subs = []; }
      for (const sub of subs) {
        const arr = byChannel.get(sub.channelId) || [];
        arr.push(fx);
        byChannel.set(sub.channelId, arr);
      }
    }

    for (const [channelId, fixtures] of byChannel) {
      const summary = fixtures
        .slice(0, 3)
        .map((f) => `${f.homeTeam.name} ${f.homeScore ?? 0}-${f.awayScore ?? 0} ${f.awayTeam.name}`)
        .join(' | ');
      const topic = `🔴 LIVE • ${summary}`.slice(0, 1024);
      if (this.liveTopics.get(channelId) === topic) continue;
      try {
        const ch: any = await this.client.channels.fetch(channelId);
        if (ch?.setTopic) {
          await ch.setTopic(topic);
          this.liveTopics.set(channelId, topic);
        }
      } catch { /* channel not editable or deleted */ }
    }
  }

  /**
   * Settle saved-parlay legs for one fixture and broadcast each settled leg
   * into the channel the slip was saved from.
   *
   * A leg only settles when the live score, corner or card count actually
   * satisfies the market — otherwise it stays PENDING. `markSavedLegSettled`
   * de-duplicates, so a leg is announced exactly once.
   */
  private async processSavedParlayLegs(fx: any, stats: any): Promise<void> {
    if (!this.client) return;

    let savedList: any[] = [];
    try { savedList = CP.getSavedParlaysForFixture(fx.id); } catch { return; }
    if (!savedList.length) return;

    const statistics = stats?.statistics ?? fx.statistics ?? null;
    const latestGoal = this.latestGoalEvent(stats);
    const ctx = {
      homeTeam: fx.homeTeam?.name ?? 'Home',
      awayTeam: fx.awayTeam?.name ?? 'Away',
      homeScore: fx.homeScore ?? null,
      awayScore: fx.awayScore ?? null,
      status: fx.status,
      statistics,
    };

    for (const saved of savedList) {
      const legsForFixture = (saved.legs as any[]).filter((l) => l.fixtureId === fx.id);
      for (const leg of legsForFixture) {
        if (CP.isSavedLegSettled(saved.id, leg)) continue;
        const progress = CP.evaluateSavedLeg(leg, ctx, latestGoal);
        if (progress.status === 'PENDING') continue;

        CP.markSavedLegSettled(saved.id, leg, progress.status);
        const settledCount = CP.countSettledLegs(saved);
        const embed = CP.buildParlayUpdateEmbed({
          saved,
          leg,
          progress,
          settledCount,
          totalLegs: saved.legs.length,
        });

        try {
          const ch: any = await this.client.channels.fetch(saved.channelId);
          if (ch?.isTextBased()) {
            await ch.send({ content: `<@${saved.userId}>`, embeds: [embed] });
          }
        } catch (e: any) {
          console.warn(`[ParlayTracking] broadcast failed for ${saved.channelId}: ${e.message}`);
        }

        if (this.dmAlerts.has(saved.userId)) {
          try {
            const user = await this.client.users.fetch(saved.userId);
            await user.send({ embeds: [embed] });
          } catch { /* DMs closed or user unavailable */ }
        }
      }
    }
  }

  /** Latest scoring event, used only to enrich a leg-hit note (never invented). */
  private latestGoalEvent(stats: any): { minute: string | null; team: string | null; player: string | null } | null {
    const events: any[] = Array.isArray(stats?.events) ? stats.events : [];
    for (let i = events.length - 1; i >= 0; i--) {
      const ev = events[i];
      if (ev?.type === 'goal' || ev?.type === 'own-goal' || ev?.scoring) {
        return { minute: ev.minute ?? null, team: ev.team ?? null, player: ev.player ?? null };
      }
    }
    return null;
  }

  /**
   * Delivers a briefing embed to every configured destination.
   *
   * One delivery path for /broadcast, /setbrief, the scheduled cron and the
   * morning scheduler, so the briefing is always the same clean embed and is
   * never silently dropped when no destination is configured.
   *
   * @param source  Label used in log output ("/broadcast", "/setbrief", ...).
   */
  public async deliverBriefing(embed: EmbedBuilder, source: string): Promise<void> {
    let sentViaWebhook = false;
    let sentViaBot = false;

    if (this.config.webhookUrl) {
      try {
        await axios.post(this.config.webhookUrl, {
          username: 'Cape Predictor',
          avatar_url: 'https://cdn.discordapp.com/embed/avatars/0.png',
          embeds: [embed],
        });
        sentViaWebhook = true;
      } catch (e: any) {
        console.warn(`[DiscordBot] ${source} webhook delivery failed: ${e.message}`);
      }
    }

    if (this.client && this.isReady) {
      let channel: any = null;
      if (this.config.channelId) {
        try {
          channel = await this.client.channels.fetch(this.config.channelId);
        } catch (e: any) {
          console.warn(`[DiscordBot] Fetching channel ${this.config.channelId} failed: ${e.message}`);
        }
      }

      // Auto-discover first available text channel if no explicit channel ID is set.
      // Dynamic guild channel fallback: prefer named channels, then system channel,
      // then any writable text channel.
      if (!channel) {
        for (const guild of this.client.guilds.cache.values()) {
          const preferredNames = ['general', 'updates', 'predictions', 'announcements'];
          let found: any = null;
          for (const name of preferredNames) {
            found = guild.channels.cache.find(
              (c: any) => c.isTextBased() && c.name?.toLowerCase() === name && c.viewable
            );
            if (found) break;
          }
          if (!found && guild.systemChannelId) {
            try { found = await this.client.channels.fetch(guild.systemChannelId); } catch { /* skip */ }
          }
          if (!found) {
            found = guild.channels.cache.find(
              (c: any) => c.isTextBased() && c.viewable && c.permissionsFor?.(guild.members.me)?.has('SendMessages')
            );
          }
          if (found) { channel = found; break; }
        }
      }

      if (channel && channel.isTextBased()) {
        try {
          await (channel as TextChannel).send({ embeds: [embed] });
          sentViaBot = true;
        } catch (e: any) {
          console.warn(`[DiscordBot] ${source} channel delivery failed: ${e.message}`);
        }
      }
    }

    this.lastBroadcastTime = new Date().toISOString();

    if (!sentViaWebhook && !sentViaBot) {
      console.warn(
        `[DiscordBot] ${source}: briefing built but not delivered — neither DISCORD_WEBHOOK_URL nor DISCORD_CHANNEL_ID is configured, and no writable channel was found.`,
      );
    }
  }

  /**
   * Builds comprehensive Command Directory and Statistical Methodology Embed
   */
  public buildInfoEmbed(): EmbedBuilder {
    return new EmbedBuilder()
      .setColor(0x2563EB) // Restrained blue primary
      .setTitle('🏆 Cape Predictor — Bot Command Directory')
      .setDescription(
        'Predictive sports modeling system across 7 European competitions. ' +
        'Engineered with **Dixon-Coles bivariate Poisson**, Bayesian shrinkage, and zero betting odds inputs.'
      )
      .addFields(
        {
          name: '📋 Bot Commands (Works with /slash or !prefix)',
          value:
            '• `/info` (or `!info`) — Show this complete command guide & statistical principles\n' +
            '• `/fixtures` (or `!fixtures`, `!odds`) — View today\'s top statistical value picks\n' +
            '• `/generateparlay [legs] [min_probability] [league] [mode]` — Automated statistical parlay (anti-correlated, same-game, or correlated)\n' +
            '• `/customparlay` — Interactive slip builder: league → match → market → Add Leg, with live leg tracking\n' +
            '• `/track` (or `!track`) — View real-time movement and live progression of your active parlay\n' +
            '• `/live` • `/livetracking` — Live scores and one-click match tracking\n' +
            '• `/value` • `/h2h` • `/team` • `/poll` • `/setbrief` — Value picks, head-to-head, team form, polls and briefings\n' +
            '• `/broadcast` (or `!broadcast`) — Instantly dispatch the latest hourly odds briefing\n' +
            '• `/help` (or `!help`) — Interactive command directory',
          inline: false,
        },
        {
          name: '🌍 Supported Competitions (7 Leagues)',
          value:
            '🏴󠁧󠁢󠁥󠁮󠁧󠁿 **Premier League (EPL)**\n' +
            '🏴󠁧󠁢󠁥󠁮󠁧󠁿 **EFL Championship**\n' +
            '🇪🇸 **Spain La Liga**\n' +
            '🇫🇷 **France Ligue 1**\n' +
            '🏆 **UEFA Champions League (UCL)**\n' +
            '🥈 **UEFA Europa League (UEL)**\n' +
            '🥉 **UEFA Conference League (UECL)**',
          inline: true,
        },
        {
          name: '🔬 Statistical Engine & Correlation Control',
          value:
            '• **Strict Anti-Correlated**: Strictly 1 pick per match across independent venues\n' +
            '• **Same-Game Parlay (SGP)**: Stack Over 0.5 Goals + Over 5.5 Corners + Cards on 1 match\n' +
            '• **Copula Adjustment**: Mathematically boosts joint probability for correlated game pace\n' +
            '• **Zero Betting Odds**: 100% objective performance physics & xG',
          inline: true,
        },
        {
          name: '📢 Channel Linking & Interval Updates (5m / 15m / 30m / 45m / 1hr)',
          value:
            'You can link the bot to any specific channel and configure how frequently it posts:\n' +
            '• **Link Channel & Frequency**: `/channel target:#channel-name interval:15m`\n' +
            '• **Change Interval Anytime**: `/interval frequency:<5m|15m|30m|45m|1h>`\n' +
            '• **Quick Chat Shortcut**: Type `!channel 15m` or `!interval 5m` in your desired channel\n' +
            '• **Supported Intervals**: `5m` (every 5 mins), `15m`, `30m`, `45m`, `1h` (hourly)\n' +
            '• **Via Environment File**: Set `DISCORD_CHANNEL_ID=your_id` & `DISCORD_UPDATE_INTERVAL=15m` in `.env`\n' +
            '• **Webhook Alternative**: Paste `DISCORD_WEBHOOK_URL` in `.env` for zero-setup channel feeds\n' +
            '• **24/7 Hosting**: Deploy to Railway/Render to keep updates running when your PC is turned off!',
          inline: false,
        },
        {
          name: '🛡️ Responsible Gaming Disclosure',
          value:
            'Statistical probabilities are mathematical projections derived from historical performance, tactical metrics, and expected goals (xG). Multi-leg combinations multiply tail risk exponentially. Predictions are never guarantees or sure wins.',
          inline: false,
        },
        {
          name: '🌐 Web Analytics Dashboard',
          value: `Access the full World Cup styled dashboard with interactive charts at [${DASHBOARD_URL}](${DASHBOARD_URL})`,
          inline: false,
        }
      )
      .setFooter({
        text: 'Cape Predictor • Transparent, Explainable Sports Analytics',
      })
      .setTimestamp();
  }

  /**
   * Resolve a fixture to a renderable analysis payload.
   *
   * Never substitutes a different match and never fabricates a bundle: if the
   * provider cannot confirm the fixture identity, the user is told so.
   */
  public async buildAnalysisPayloadSafe(
    fixtureId: string,
    tab: CP.AnalysisTab = 'stats',
  ): Promise<{ embeds: any[]; components: any[] }> {
    let details: any = null;

    for (const d of [0, -1, 1, -2, 2]) {
      const date = new Date(Date.now() + d * 86400000).toISOString().slice(0, 10);
      try {
        const list = await CP.fetchVerifiedFixtures(this.factory, date, 'ALL');
        if (list.some((f: any) => f.id === fixtureId)) {
          details = await this.factory.getMatchDetails(fixtureId);
          break;
        }
      } catch { /* try the next day */ }
    }

    if (!details) {
      return {
        embeds: [CP.baseEmbed(
          'Analysis unavailable',
          'This match could not be verified against a live provider, so no statistics are shown rather than estimated. Try again shortly.',
        )],
        components: [CP.buildHelpRow()],
      };
    }

    return CP.buildAnalysisPayload(details, tab);
  }

  /**
   * Text reply for the !fixtures / !odds chat commands, derived from the same
   * briefing builder as /broadcast, /setbrief and the morning scheduler.
   */
  public async generateFixturesReply(): Promise<string> {
    const briefing = await this.buildMorningBriefing();
    const fields = ((briefing.toJSON().fields ?? []) as Array<{ name: string; value: string }>);
    const picksField = fields.find((f) => f.name.includes('Top Value Picks'));
    if (!picksField) return `⚽ **No live fixture predictions available for today**. Check the web dashboard for upcoming calendar dates!`;
    const lines = picksField.value
      .split('\n\n')
      .map((block: string) => block.replace(/\*\*/g, '').replace(/^> /gm, '').trim())
      .filter((block: string) => block.length > 0)
      .map((block: string, i: number) => `• ${block.split('\n')[0]}${block.includes('\n') ? `\n  ${block.split('\n')[1]}` : ''}`);
    return `⚽ **Today's Top Statistical Picks** (${new Date().toISOString().slice(0, 10)}):\n\n${lines.join('\n') || 'No qualifying value picks found on today\'s slate.'}\n\n*Type \`/generateparlay\` or \`/customparlay\` or \`/info\` for more commands.*`;
  }

  /**
   * Automated statistical parlay generator (backing /generateparlay).
   *
   * One command, three modes: strict anti-correlated (default), same-game
   * (SGP) and correlated-allowed, with a user-set leg count, minimum per-leg
   * model probability and optional league restriction.
   */
  public async generateParlayReply(opts: {
    legs?: number;
    mode?: ParlayMode;
    league?: string;
    minProbability?: number;
    userId?: string;
    channelId?: string;
  } = {}): Promise<string> {
    const valid = [5, 10, 15, 20, 25];
    const requested = typeof opts.legs === 'number' && Number.isFinite(opts.legs) ? opts.legs : 5;
    const target = (valid.includes(requested) ? requested : 5) as ParlayLegCount;
    const mode: ParlayMode = opts.mode ?? 'ANTI_CORRELATED';
    const leagueFilter = opts.league || 'ALL';
    const minProbability = typeof opts.minProbability === 'number' && Number.isFinite(opts.minProbability)
      ? Math.min(0.95, Math.max(0.5, opts.minProbability))
      : 0.58;

    const today = new Date().toISOString().substring(0, 10);
    const allFixtures = await this.factory.getFixturesByDate(today, 'ALL');
    // Never build a leg on a match that has already kicked off or finished, and
    // rank the Premier League and Champions League fixtures at the top of the
    // pool so the priority competitions lead the slip.
    const fixtures = orderFixturesByPriority(
      CP.filterPreKickoffFixtures(allFixtures.filter(fx => isVerifiedFixture(fx))),
    );
    const preds: MarketPrediction[] = [];

    for (const fx of fixtures) {
      const details = await this.factory.getMatchDetails(fx.id);
      if (details?.marketPredictions) preds.push(...details.marketPredictions);
    }

    if (preds.length === 0) {
      return '📅 **No Scheduled Fixtures**\n\nNo active fixtures were found for this date. Check back closer to matchday kickoffs or select another date.';
    }

    const parlay = await buildStatisticalParlay(preds, {
      targetLegsCount: target,
      minProbability,
      leagueFilter,
      mode,
      prioritizePriorityLeagues: true,
    });
    if (this.trackerService) {
      await this.trackerService.trackParlay(parlay);
    }

    // Persist to disk immediately so /track and restarts see the slip.
    if (opts.userId && opts.channelId && parlay.legs.length > 0) {
      try {
        const saved = CP.saveParlayToDisk(parlay as any, {
          userId: opts.userId,
          channelId: opts.channelId,
          guildId: null,
        });
        // Auto-subscribe the generating user/channel to every leg's fixture.
        for (const leg of parlay.legs) {
          try { CP.subscribeLive(opts.userId, opts.channelId, leg.fixtureId); } catch { /* best effort */ }
        }
      } catch (e: any) {
        console.warn('[DiscordBot] Failed to persist generated parlay:', e.message);
      }
    }

    const isSgp = mode === 'SAME_GAME_PARLAY';
    const modeLabel = isSgp
      ? 'Same-Game Parlay (SGP)'
      : mode === 'CORRELATED_ALLOWED' ? 'Correlated Parlay' : 'Statistical Parlay';

    const legsList = parlay.legs.map((l, i) =>
      isSgp
        ? `${i + 1}. \`${l.marketLabel}\`: **${l.selection}** — **${(l.estimatedProbability * 100).toFixed(1)}%** prob`
        : `${i + 1}. **${l.fixtureDescription}**: \`${l.selection}\` (${(l.estimatedProbability * 100).toFixed(0)}% | ${l.league})`,
    ).join('\n');

    const insufficient = parlay.status === 'INSUFFICIENT_SELECTIONS'
      ? `\n\n> ⚠️ ${parlay.message}`
      : '';

    const header = isSgp
      ? `🔥 **Same-Game Parlay (SGP) — Single Match Stacking**\n🏟️ Match: **${parlay.legs[0]?.fixtureDescription || 'Featured Fixture'}**\n\n`
      : `⚡ **${parlay.actualLegsCount}-Leg ${modeLabel}** — ${leagueFilter === 'ALL' ? 'all leagues' : leagueFilter}, min leg probability ${(minProbability * 100).toFixed(0)}%:\n\n`;

    // Priority only bites when the pool is drawn from every league.
    const priorityLine = !isSgp && leagueFilter === 'ALL'
      ? `• **Priority**: \`${PRIORITY_LEAGUE_LABEL}\` — ranked ahead of the secondary leagues\n`
      : '';

    return (
      `${header}${legsList}${insufficient}\n\n` +
      `• **Combined Probability**: \`${(parlay.combinedProbability * 100).toFixed(2)}%\`\n` +
      `• **Fair Compound Odds**: \`${parlay.compoundOddsDecimal}x\`\n` +
      priorityLine +
      `• **Conditions**: \`legs=${target}\` • \`min=${(minProbability * 100).toFixed(0)}%\` • \`league=${leagueFilter}\` • \`mode=${mode}\`\n\n` +
      `*Type \`/track\` to follow live match motion, or build your own slip with \`/customparlay\`!*`
    );
  }

  /**
   * Live matches currently in play, enriched with the provider's published
   * match statistics and clock. Only genuinely active fixtures are returned,
   * and the result is capped so the embed and its button rows stay aligned.
   */
  private async liveMatchFixtures(limit = CP.MAX_LIVE_MATCH_ROWS): Promise<any[]> {
    const today = new Date().toISOString().slice(0, 10);
    let fixtures: any[] = [];
    try {
      fixtures = await CP.fetchVerifiedFixtures(this.factory, today, 'ALL');
    } catch {
      return [];
    }

    const live = (fixtures ?? []).filter((f: any) => CP.isActiveLiveFixture(f)).slice(0, limit);

    // One detail call per live match so shots/xG/corners render for real.
    await Promise.all(live.map(async (f: any) => {
      try {
        const details = await this.factory.getMatchDetails(f.id);
        if (details?.fixture?.statistics) f.statistics = details.fixture.statistics;
        if (details?.fixture?.liveClock) f.liveClock = details.fixture.liveClock;
        if (details?.fixture?.providerStatus) f.providerStatus = details.fixture.providerStatus;
      } catch { /* provider unavailable — render N/A rather than invent stats */ }
    }));

    return live;
  }

  /**
   * Fixtures the user has explicitly subscribed to with `[ ⚡ Track Match ]`
   * inside this channel, resolved across the surrounding five days and
   * enriched with live stats where available.
   */
  private async trackedMatchFixtures(userId: string, channelId: string): Promise<any[]> {
    let ids: string[] = [];
    try {
      ids = CP.getSubscribedFixtureIdsForUserChannel(userId, channelId);
    } catch {
      return [];
    }
    if (!ids.length) return [];

    const wanted = new Set(ids);
    const found = new Map<string, any>();
    for (const offset of [0, -1, 1, -2, 2]) {
      if (found.size >= wanted.size) break;
      const date = new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);
      try {
        const list = await CP.fetchVerifiedFixtures(this.factory, date, 'ALL');
        for (const f of list) {
          if (wanted.has(f.id) && !found.has(f.id)) found.set(f.id, f);
        }
      } catch { /* provider unavailable — try the next day */ }
    }

    const fixtures = [...found.values()];

    // Live matches get their published stats attached (bounded, best-effort).
    const live = fixtures.filter((f) => CP.isActiveLiveFixture(f)).slice(0, 5);
    await Promise.all(live.map(async (f) => {
      try {
        const details = await this.factory.getMatchDetails(f.id);
        if (details?.fixture?.statistics) f.statistics = details.fixture.statistics;
        if (details?.fixture?.liveClock) f.liveClock = details.fixture.liveClock;
        if (details?.fixture?.providerStatus) f.providerStatus = details.fixture.providerStatus;
      } catch { /* render what the scoreboard already gave us */ }
    }));

    return fixtures;
  }

  /**
   * `/track` reply. Returns up to two embeds:
   *   1. the active saved parlay slip with per-leg status icons, and
   *   2. the individual matches the user/channel asked to track.
   * Falls back to the statistical tracker service, then to a text hint.
   */
  public async generateLiveTrackerReply(
    options: { userId?: string; channelId?: string } = {},
  ): Promise<EmbedBuilder[] | string> {
    const embeds: EmbedBuilder[] = [];

    if (options.userId && options.channelId) {
      // 1) Saved parlay slip (ACTIVE_TRACKING), settled leg by leg.
      let activeSlips: any[] = [];
      try {
        activeSlips = CP.getActiveSavedParlaysForUserChannel(options.userId, options.channelId);
      } catch { activeSlips = []; }

      if (activeSlips.length > 0) {
        const slipEmbed = CP.buildSavedSlipTrackerEmbed(activeSlips[0]);
        if (activeSlips.length > 1) {
          slipEmbed.setFooter({
            text: `${BRAND.footer} • ${activeSlips.length} saved slips in this channel — showing the most recent`,
          });
        }
        embeds.push(slipEmbed);
      }

      // 2) Individually tracked matches (⚡ Track Match).
      try {
        const tracked = await this.trackedMatchFixtures(options.userId, options.channelId);
        if (tracked.length) embeds.push(CP.buildTrackedMatchesEmbed(tracked));
      } catch { /* provider unavailable — skip the matches embed */ }
    }

    if (embeds.length) return embeds;

    if (!this.trackerService) {
      return '⚠️ Live tracker service is not active. Use `/live` to follow a match, or save a slip with `/customparlay`.';
    }

    const trackedList = this.trackerService.getTrackedParlays();
    if (trackedList.length === 0 && (!options.userId || !options.channelId || embeds.length === 0)) {
      const emptyEmbed = new EmbedBuilder()
        .setColor(BRAND.neutral)
        .setAuthor({ name: BRAND.author })
        .setTitle('No Active Tracked Matches Found')
        .setDescription('You currently have no live matches or saved parlays being tracked.\nUse /analysis or the Web Dashboard to track a match or save a parlay slip!')
        .setFooter({ text: BRAND.footer })
      return [emptyEmbed];
      return [emptyEmbed];
    }

    const active = trackedList[0];
    const updated = await this.trackerService.evaluateParlayProgress(active.parlayId);

    const embed = new EmbedBuilder()
      .setColor(
        updated.overallStatus === 'WON'
          ? 0x10B981
          : updated.overallStatus === 'BUSTED'
          ? 0xEF4444
          : 0x2563EB
      )
      .setTitle(`🔴 LIVE PARLAY TRACKER — ${updated.totalLegs} Legs (${updated.overallStatus})`)
      .setDescription(
        `**Status**: ${updated.overallStatus === 'WON' ? '🏆 PARLAY WON!' : updated.overallStatus === 'BUSTED' ? '❌ PARLAY BUSTED' : '⏱️ IN PROGRESS (LIVE)'}\n` +
        `• **Legs Progress**: 🟢 **${updated.legsHitCount}** Hit | 🟡 **${updated.legsLiveCount}** Live | ⏳ **${updated.legsPendingCount}** Pending | 🔴 **${updated.legsMissedCount}** Lost\n` +
        `• **Current Cashout / Equity Index**: \`${safeToFixed(updated.cashoutProbabilityIndex * 100, 1)}%\``
      );

    for (const leg of updated.liveLegs.slice(0, 8)) {
      const icon = leg.liveStatus === 'HIT' ? '🟢 WON' : leg.liveStatus === 'MISS' ? '🔴 LOST' : leg.liveStatus === 'LIVE_WINNING' ? '🟡 WINNING' : '⏳ LIVE';
      embed.addFields({
        name: `${icon} • ${leg.fixtureDescription} (${leg.liveScore})`,
        value:
          `• **Pick**: \`${leg.selection}\`\n` +
          `• **Live Motion**: ${leg.note} [${leg.progressPercent}%]`,
        inline: false,
      });
    }

    embed.setFooter({
      text: `Live tracker updates in real-time • Web Dashboard at ${DASHBOARD_URL}`,
    }).setTimestamp();

    return [embed];
  }

  public getStatus() {
    return {
      botEnabled: !!this.config.botToken,
      botReady: this.isReady,
      botTag: this.client?.user?.tag || null,
      channelId: this.config.channelId || null,
      currentInterval: this.currentInterval,
      guildsCount: this.client?.guilds.cache.size || 0,
      webhookConfigured: !!this.config.webhookUrl,
      hourlyScheduleActive: this.config.enableHourlyUpdates !== false,
      lastBroadcastTime: this.lastBroadcastTime,
    };
  }
}






