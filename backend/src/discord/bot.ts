import { Client, GatewayIntentBits, EmbedBuilder, TextChannel, SlashCommandBuilder } from 'discord.js';
import axios from 'axios';
import cron from 'node-cron';
import { DataProviderFactory } from '../providers/provider-factory.js';
import { buildStatisticalParlay } from '../parlays/parlay-builder.js';
import { MarketPrediction, ParlayMode } from '../types/football.js';
import { LiveParlayTrackerService } from '../parlays/live-tracker.js';
import { isVerifiedFixture } from '../utils/fixtureValidation.js';
import * as CP from './interactions.js';

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
      console.log(`[DiscordBot] Running scheduled ${this.currentInterval} odds & parlay broadcast...`);
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
        await this.sendHourlyUpdate();
        // Live tracker embeds self-refresh via their own 30s loop, so there is
        // no separate score push here.
      } catch (e: any) {
        console.warn(`[DiscordBot] scheduled tick failed: ${e.message}`);
      }
    });
    console.log(`[DiscordBot] Updates scheduled: interval = ${this.currentInterval} (${pattern}) for channel = ${this.config.channelId || 'auto-discovered'}`);
  }

  public async start(): Promise<void> {
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
                .setDescription('Match ID (press 📊 Analyze on a fixture to copy one)')
                .setRequired(true)),
          new SlashCommandBuilder()
            .setName('customparlay')
            .setDescription('Build your own custom parlay: pick matches and markets, then save it'),
          new SlashCommandBuilder()
            .setName('livetracking')
            .setDescription('Track a live or upcoming match of your choice (no manual IDs)'),
          new SlashCommandBuilder()
            .setName('info')
            .setDescription('View all available bot commands, leagues, and statistical engine details'),
          new SlashCommandBuilder()
            .setName('fixtures')
            .setDescription("View today's top statistical football predictions and calibrated probabilities"),
          new SlashCommandBuilder()
            .setName('parlay')
            .setDescription('Build statistical parlays (Anti-Correlated, Same-Game, or Correlated)')
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
            .setName('sgp')
            .setDescription('Build a Same-Game Parlay stacking Over 0.5 Goals, Corners, Cards & Double Chance on 1 match'),
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
            .setName('help')
            .setDescription('Cape Predictor command directory with interactive navigation buttons'),
        ];

        await this.client?.application?.commands.set(commands);
        console.log('[DiscordBot] Slash commands (/info, /fixtures, /parlay, /sgp, /track, /channel, /interval, /broadcast) registered!');
      } catch (err: any) {
        console.warn(`[DiscordBot] Slash command registration notice: ${err.message}`);
      }
    });

    // Handle Discord Slash Commands (Interactions)
    this.client.on('interactionCreate', async interaction => {
      if (!interaction.isChatInputCommand()) return;
      try {
        if (interaction.commandName === 'info' || interaction.commandName === 'help') {
          const embed = this.buildInfoEmbed();
          await interaction.reply({ embeds: [embed] });
        } else if (interaction.commandName === 'fixtures') {
          await interaction.deferReply();
          await renderFixturesPage(interaction, 'ALL', 1);
          return;
        } else if (interaction.commandName === 'parlay') {
          await interaction.deferReply();
          const legs = interaction.options.getInteger('legs') || 5;
          const modeOpt = interaction.options.getString('mode') || 'anti_correlated';
          const mode: ParlayMode = modeOpt === 'same_game'
            ? 'SAME_GAME_PARLAY'
            : modeOpt === 'correlated'
            ? 'CORRELATED_ALLOWED'
            : 'ANTI_CORRELATED';
          const replyText = await this.generateParlayReply(legs, mode);
          await interaction.editReply(replyText);
        } else if (interaction.commandName === 'sgp') {
          await interaction.deferReply();
          const replyText = await this.generateSgpReply();
          await interaction.editReply(replyText);
        } else if (interaction.commandName === 'track') {
          await interaction.deferReply();
          const reply = await this.generateLiveTrackerReply();
          if (typeof reply === 'string') {
            await interaction.editReply(reply);
          } else {
            await interaction.editReply({ embeds: [reply] });
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
          const res = await this.sendHourlyUpdate();
          await interaction.editReply(res.message);
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
      const state = CP.getFixturesState(interaction.user.id);
      await interaction.editReply({
        ...CP.buildFixturesPayload(fixtures, preds, league, page, state.selectedMatchId),
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
        await channel.send({ embeds: [CP.baseEmbed('Live Tracking', 'That match could not be verified against a live provider.')], ephemeral: true }).catch(() => {});
        return;
      }

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
      return CP.fetchVerifiedFixtures(this.factory, todayStr(), league);
    };

    const renderParlay = async (interaction: any, notice?: string) => {
      const ownerId = interaction.user.id;
      const parlay = CP.getParlay(ownerId);
      const fixtures = await parlayFixtures(ownerId);
      await interaction.followUp({
        ...CP.buildParlayPayload(parlay, fixtures, {
          league: CP.getParlayLeague(ownerId),
          notice,
        }),
        ephemeral: true,
      });
    };

    /** Rebuild the ephemeral parlay message in place (keeps one scrolling panel). */
    const rerenderParlayMessage = async (interaction: any, notice?: string) => {
      const ownerId = interaction.user.id;
      const parlay = CP.getParlay(ownerId);
      const fixtures = await parlayFixtures(ownerId);
      const payload = CP.buildParlayPayload(parlay, fixtures, {
        league: CP.getParlayLeague(ownerId),
        notice,
      });
      await interaction.update({ ...payload }).catch(async (e: any) => {
        // Fall back to a fresh ephemeral message if the original expired.
        await interaction.followUp({ ...payload, ephemeral: true }).catch(() => {});
      });
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
          const fixtureId = interaction.options.getString('fixture', true);
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
     * Modal submissions (stake input)
     * ================================================================ */
    this.client.on('interactionCreate', async (interaction: any) => {
      if (!interaction.isModalSubmitCommand?.()) return;
      if (interaction.customId !== 'cp:parlay:stake-modal') return;

      const ownerId = interaction.user.id;
      const parlay = CP.getParlay(ownerId);
      const raw = interaction.fields.getTextInputValue('stake');
      const stake = Number(raw);

      if (!Number.isFinite(stake) || stake <= 0) {
        await interaction.update({
          ...CP.buildParlayPayload(parlay, await parlayFixtures(ownerId), {
            league: CP.getParlayLeague(ownerId),
            notice: 'Stake must be a positive number.',
          }),
        }).catch(() => {});
        return;
      }

      parlay.stake = Number(stake.toFixed(2));
      await interaction.update({
        ...CP.buildParlayPayload(parlay, await parlayFixtures(ownerId), {
          league: CP.getParlayLeague(ownerId),
          notice: `Stake set to **${parlay.stake}** unit${parlay.stake === 1 ? '' : 's'}.`,
        }),
      }).catch(() => {});
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

        if (id === 'cp:fixtures:match') {
          const matchId = interaction.values?.[0];
          const state = CP.getFixturesState(interaction.user.id);
          CP.setFixturesSelectedMatch(interaction.user.id, matchId && matchId !== 'none' ? matchId : null);
          await interaction.deferUpdate();
          await renderFixturesPage(interaction, state.league, state.page);
          return;
        }

        if (id === 'cp:fixtures:analyze') {
          const state = CP.getFixturesState(interaction.user.id);
          const fixtureId = state.selectedMatchId;
          if (!fixtureId) {
            await interaction.reply({ content: 'Please select a match first.', ephemeral: true });
            return;
          }
          await interaction.deferReply();
          await showAnalysis(interaction, fixtureId, 'stats');
          return;
        }

        if (id === 'cp:fixtures:parlay') {
          const state = CP.getFixturesState(interaction.user.id);
          const fixtureId = state.selectedMatchId;
          if (!fixtureId) {
            await interaction.reply({ content: 'Please select a match first.', ephemeral: true });
            return;
          }
          await interaction.deferUpdate();
          const found = await analysisFor(fixtureId);
          if (!found) {
            await interaction.followUp({ content: 'Match data is currently unavailable.', ephemeral: true });
            return;
          }
          const pick = CP.bestPickForFixture(found.details.marketPredictions);
          if (!pick) {
            await interaction.followUp({ content: 'No market pick available for this match.', ephemeral: true });
            return;
          }
          const parlay = CP.getParlay(interaction.user.id);
          const res = CP.addLeg(parlay, {
            fixtureId,
            description: `${found.fixture.homeTeam.name} v ${found.fixture.awayTeam.name}`,
            league: found.fixture.league,
            market: pick.market,
            selection: pick.label,
            probability: pick.probability,
          });
          if (!res.ok) {
            await interaction.followUp({ content: res.reason, ephemeral: true });
            return;
          }
          CP.setFixturesSelectedMatch(interaction.user.id, null);
          await renderFixturesPage(interaction, state.league, state.page);
          return;
        }

        if (id === 'cp:fixtures:track') {
          const state = CP.getFixturesState(interaction.user.id);
          const fixtureId = state.selectedMatchId;
          if (!fixtureId) {
            await interaction.reply({ content: 'Please select a match first.', ephemeral: true });
            return;
          }
          await interaction.deferUpdate();
          const found = await analysisFor(fixtureId);
          if (!found) {
            await interaction.followUp({ content: 'Match data is currently unavailable.', ephemeral: true });
            return;
          }
          const channel: any = interaction.channel;
          if (channel?.send) await startLiveTracker(channel, fixtureId, interaction.user.id);
          CP.setFixturesSelectedMatch(interaction.user.id, null);
          await renderFixturesPage(interaction, state.league, state.page);
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
          const found = await analysisFor(tracker.fixtureId);

          if (action === 'alerts') {
            tracker.alertsEnabled = !tracker.alertsEnabled;
            if (!found) {
              await interaction.reply({ content: 'Match data is currently unavailable.', ephemeral: true });
              return;
            }
            tracker.fingerprint = CP.liveFingerprint(found.details);
            await interaction.update({ components: [CP.buildLiveActionRow(tracker.messageId, tracker.alertsEnabled) as any] });
            return;
          }

          if (!found) {
            await interaction.reply({ content: 'Match data is currently unavailable for that fixture.', ephemeral: true });
            return;
          }

          const fingerprint = CP.liveFingerprint(found.details);
          tracker.fingerprint = fingerprint;
          tracker.updatedAt = Date.now();

          if (action === 'refresh') {
            await interaction.update({
              embeds: [CP.buildLiveMatchEmbed(found.details, tracker.alertsEnabled)],
              components: [CP.buildLiveActionRow(tracker.messageId, tracker.alertsEnabled) as any],
            });
            return;
          }

          if (action === 'stats') {
            await interaction.update({
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

        /* ---------- parlay: league ---------- */
        if (id === 'cp:parlay:league') {
          CP.setParlayLeague(ownerId, interaction.values?.[0] ?? 'ALL');
          CP.clearParlayPending(ownerId);
          await interaction.deferUpdate();
          const parlay = CP.getParlay(ownerId);
          const fixtures = await parlayFixtures(ownerId);
          await interaction.editReply(CP.buildParlayPayload(parlay, fixtures, {
            league: CP.getParlayLeague(ownerId),
            notice: `Filtering by **${CP.leagueLabel(CP.getParlayLeague(ownerId))}**.`,
          }));
          return;
        }

        /* ---------- parlay: match (stage) ---------- */
        if (id === 'cp:parlay:match') {
          const fixtureId = interaction.values?.[0];
          if (!fixtureId || fixtureId === 'none') {
            await interaction.reply({ content: 'No verified matches available.', ephemeral: true });
            return;
          }
          CP.setParlayPendingMatch(ownerId, fixtureId);
          await interaction.deferUpdate();
          const parlay = CP.getParlay(ownerId);
          const fixtures = await parlayFixtures(ownerId);
          await interaction.editReply(CP.buildParlayPayload(parlay, fixtures, {
            league: CP.getParlayLeague(ownerId),
            notice: 'Match staged. Now pick a **market**, then press **➕ Add Leg**.',
          }));
          return;
        }

        /* ---------- parlay: market (stage) ---------- */
        if (id === 'cp:parlay:market') {
          CP.setParlayPendingMarket(ownerId, interaction.values?.[0] as any);
          await interaction.deferUpdate();
          const parlay = CP.getParlay(ownerId);
          const fixtures = await parlayFixtures(ownerId);
          const staged = CP.getParlayPendingMatch(ownerId);
          await interaction.editReply(CP.buildParlayPayload(parlay, fixtures, {
            league: CP.getParlayLeague(ownerId),
            notice: staged
              ? `Market staged. Press **➕ Add Leg** to add it to your slip.`
              : 'Pick a **match** first, then a market.',
          }));
          return;
        }

        /* ---------- parlay: add leg ---------- */
        if (id === 'cp:parlay:add') {
          const parlay = CP.getParlay(ownerId);
          const fixtureId = CP.getParlayPendingMatch(ownerId);
          const market = CP.getParlayPendingMarket(ownerId);

          if (!fixtureId) { await rerenderParlayMessage(interaction, 'Choose a **match** first.'); return; }
          if (!market) { await rerenderParlayMessage(interaction, 'Choose a **market** first.'); return; }

          const found = await analysisFor(fixtureId);
          if (!found) { await rerenderParlayMessage(interaction, 'That match is no longer available.'); return; }

          const mp = found.details.marketPredictions?.find((p: any) => p.market === market);
          if (!mp || !Number.isFinite(mp.estimatedProbability) || mp.estimatedProbability <= 0) {
            await rerenderParlayMessage(interaction, `No model probability available for ${CP.marketLabel(market as any)} on that match.`);
            return;
          }

          const res = CP.addLeg(parlay, {
            fixtureId,
            description: `${found.fixture.homeTeam.name} v ${found.fixture.awayTeam.name}`,
            league: found.fixture.league,
            market,
            selection: CP.marketLabel(market as any),
            probability: mp.estimatedProbability,
            confidenceLower: mp.confidenceLower,
            confidenceUpper: mp.confidenceUpper,
          });

          if (res.ok) CP.clearParlayPending(ownerId);
          await rerenderParlayMessage(interaction, res.ok ? `Leg added — ${CP.marketLabel(market as any)}.` : res.reason);
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

        /* ---------- parlay: stake modal ---------- */
        if (id === 'cp:parlay:stake') {
          const parlay = CP.getParlay(ownerId);
          await interaction.showModal(CP.buildStakeModal(parlay.stake));
          return;
        }

        /* ---------- parlay: save ---------- */
        if (id === 'cp:parlay:save') {
          const parlay = CP.getParlay(ownerId);
          const res = CP.saveParlay(parlay);
          if (res.ok) {
            await interaction.reply({ embeds: [CP.buildSavedParlayEmbed(parlay)], ephemeral: true });
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
        const replyText = await this.generateSgpReply();
        await message.reply(replyText);
      } else if (content === '!track' || content === '/track') {
        const reply = await this.generateLiveTrackerReply();
        if (typeof reply === 'string') {
          await message.reply(reply);
        } else {
          await message.reply({ embeds: [reply] });
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
      } else if (content.startsWith('!parlay') || content.startsWith('/parlay')) {
        const parts = content.split(' ');
        const legs = parseInt(parts[1] || '5', 10);
        const mode: ParlayMode = content.includes('sgp') || content.includes('same')
          ? 'SAME_GAME_PARLAY'
          : content.includes('corr')
          ? 'CORRELATED_ALLOWED'
          : 'ANTI_CORRELATED';
        const replyText = await this.generateParlayReply(legs, mode);
        await message.reply(replyText);
      } else if (content === '!broadcast' || content === '/broadcast') {
        const res = await this.sendHourlyUpdate();
        await message.reply(res.message);
      }
    });

    await this.client.login(this.config.botToken);
  }

  /**
   * Builds rich World Cup styled embed payload for Discord
   */
  public async buildBroadcastPayload() {
    const today = new Date().toISOString().substring(0, 10);
    const allFixtures = await this.factory.getFixturesByDate(today, 'ALL');
    const fixtures = allFixtures.filter(fx => isVerifiedFixture(fx));

    // Collect predictions and injury bulletins
    const candidatePredictions: MarketPrediction[] = [];
    const injuryBulletins: string[] = [];

    for (const fx of fixtures.slice(0, 12)) {
      const details = await this.factory.getMatchDetails(fx.id);
      if (details) {
        if (details.marketPredictions) {
          candidatePredictions.push(...details.marketPredictions);
        }
        if (details.injuries && details.injuries.length > 0) {
          for (const inj of details.injuries.slice(0, 2)) {
            injuryBulletins.push(`⚠️ **${inj.teamName}**: ${inj.player} (${inj.status} - ${inj.reason})`);
          }
        }
      }
    }

    // Generate featured 5-leg parlay
    const parlay5 = buildStatisticalParlay(candidatePredictions, {
      targetLegsCount: 5,
      minProbability: 0.60,
    });

    const topPicks = candidatePredictions
      .sort((a, b) => b.estimatedProbability - a.estimatedProbability)
      .slice(0, 5);

    // Fetch verified real news
    let topNews: string[] = [];
    try {
      const newsArticles = await this.factory.getLatestNews();
      topNews = newsArticles.slice(0, 3).map(n => `• [${n.tag || 'News'}] **${n.title}** (${n.source})`);
    } catch (e) {
      // non-fatal
    }

    return {
      today,
      fixturesCount: fixtures.length,
      topPicks,
      injuryBulletins: injuryBulletins.slice(0, 4),
      topNews,
      parlay5,
    };
  }

  /**
   * Broadcasts update to configured Discord Channel or Webhook
   */
  public async sendHourlyUpdate(): Promise<{ success: boolean; message: string }> {
    try {
      const data = await this.buildBroadcastPayload();
      this.lastBroadcastTime = new Date().toISOString();

      const topPicksFormatted = data.topPicks
        .map((p, i) => `${i + 1}. **${p.fixtureDescription}** [${p.league}]\n   • **Selection**: \`${p.selection}\` • **Calibrated Prob**: \`${(p.estimatedProbability * 100).toFixed(1)}%\``)
        .join('\n\n') || 'No qualifying value picks found on current schedule.';

      const injuriesFormatted = data.injuryBulletins.join('\n') || '✅ No critical injury or suspension changes reported in the last hour.';

      const newsFormatted = data.topNews.join('\n') || '✅ Squad updates and team sheets synchronized.';

      const parlayLegsFormatted = data.parlay5.legs
        .map((l, i) => `**Leg ${i + 1}**: ${l.fixtureDescription} ➔ \`${l.selection}\` (${(l.estimatedProbability * 100).toFixed(0)}%)`)
        .join('\n');

      const embedPayload = {
        title: `🏆 Cape Predictor Briefing • ${data.today}`,
        description: `*Football Intelligence. Smarter Predictions.* Live statistical projections across **Premier League, Championship, La Liga, Serie A, Ligue 1, Bundesliga & UEFA Competitions**.\n*Pure mathematical models • Real-time stats from ESPN & API-Football (free tier) with verified fallback • Zero bookmaker biases*`,
        color: 0x2563EB, // Restrained blue primary
        fields: [
          {
            name: `📊 Top Calibrated Value Picks`,
            value: topPicksFormatted,
            inline: false,
          },
          {
            name: `⚡ Featured 5-Leg Statistical Parlay (${(data.parlay5.combinedProbability * 100).toFixed(1)}% | ${data.parlay5.compoundOddsDecimal}x)`,
            value: parlayLegsFormatted || 'Insufficient matches on date to build 5 independent legs.',
            inline: false,
          },
          {
            name: `🏥 Breaking Team Absences & Player Injuries`,
            value: injuriesFormatted,
            inline: false,
          },
          {
            name: `📰 Verified European Football Headlines (FootballDatabase.eu)`,
            value: newsFormatted,
            inline: false,
          },
          {
            name: `🛡️ Anti-Correlation & Risk Disclosure`,
            value: `Every leg is from a distinct fixture in a separate stadium. Multi-leg combinations multiply tail risk exponentially. Predictions are never guarantees or sure wins.`,
            inline: false,
          },
        ],
        footer: {
          text: `Cape Predictor Engine • Powered by Dixon-Coles Probability Engine`,
        },
        timestamp: new Date().toISOString(),
      };

      let sentViaWebhook = false;
      let sentViaBot = false;

      // Send via Webhook if configured
      if (this.config.webhookUrl) {
        await axios.post(this.config.webhookUrl, {
          username: 'Cape Predictor',
        avatar_url: 'https://cdn.discordapp.com/embed/avatars/0.png',
          embeds: [embedPayload],
        });
        sentViaWebhook = true;
      }

      // Send via Bot Client if channel configured OR auto-discover first writable channel in joined guilds
      if (this.client && this.isReady) {
        let channel: any = null;
        if (this.config.channelId) {
          try {
            channel = await this.client.channels.fetch(this.config.channelId);
          } catch (e: any) {
            console.warn(`[DiscordBot] Fetching channel ${this.config.channelId} failed: ${e.message}`);
          }
        }

        // Auto-discover first available text channel if no explicit channel ID is set
        if (!channel) {
          for (const guild of this.client.guilds.cache.values()) {
            const found = guild.channels.cache.find(
              c => c.isTextBased() && (c as any).viewable
            );
            if (found) {
              channel = found;
              break;
            }
          }
        }

        if (channel && channel.isTextBased()) {
          const embed = new EmbedBuilder(embedPayload as any);
          await (channel as TextChannel).send({ embeds: [embed] });
          sentViaBot = true;
        }
      }

      if (!sentViaWebhook && !sentViaBot) {
        return {
          success: false,
          message: this.client && this.client.guilds.cache.size === 0
            ? 'Bot is logged in, but not yet invited to any Discord server. Please use the OAuth2 invite link to add it to your server!'
            : 'Neither DISCORD_WEBHOOK_URL nor DISCORD_CHANNEL_ID is configured, and no writable channel was found.',
        };
      }

      this.lastBroadcastTime = new Date().toISOString();
      return {
        success: true,
        message: `Hourly briefing dispatched successfully (Webhook: ${sentViaWebhook}, Bot: ${sentViaBot}).`,
      };
    } catch (err: any) {
      console.error('[DiscordBot] Failed to send broadcast:', err.message);
      return { success: false, message: err.message };
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
            '• `/parlay [legs] [mode]` — Build multi-leg parlays (anti-correlated, same-game, or correlated)\n' +
            '• `/sgp` (or `!sgp`) — Build a Same-Game Parlay (Over 0.5 Goals, Corners, Cards & 1X on 1 match)\n' +
            '• `/track` (or `!track`) — View real-time movement and live progression of your active parlay\n' +
            '• `/broadcast` (or `!broadcast`) — Instantly dispatch the latest hourly odds briefing\n' +
            '• `/help` (or `!help`) — Quick help manual and status summary',
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

  public async generateFixturesReply(): Promise<string> {
    const data = await this.buildBroadcastPayload();
    if (data.topPicks.length === 0) {
      return `⚽ **No live fixture predictions available for today (${data.today})**. Check the web dashboard for upcoming calendar dates!`;
    }
    const formatted = data.topPicks
      .map(p => `• **${p.fixtureDescription}** (${p.league}): \`${p.selection}\` — **${(p.estimatedProbability * 100).toFixed(1)}%** prob (est ${(1 / Math.max(0.01, p.estimatedProbability)).toFixed(2)}x)`)
      .join('\n');
    return `⚽ **Today's Top Statistical Picks** (${data.today}):\n\n${formatted}\n\n*Type \`/parlay 5\` or \`/sgp\` or \`/info\` for more commands.*`;
  }

  public async generateParlayReply(legsCount: number, mode: ParlayMode = 'ANTI_CORRELATED'): Promise<string> {
    const valid = [5, 10, 15, 20, 25];
    const target = valid.includes(legsCount) ? (legsCount as any) : 5;
    const today = new Date().toISOString().substring(0, 10);
    const allFixtures = await this.factory.getFixturesByDate(today, 'ALL');
    const fixtures = allFixtures.filter(fx => isVerifiedFixture(fx));
    const preds: MarketPrediction[] = [];

    for (const fx of fixtures) {
      const details = await this.factory.getMatchDetails(fx.id);
      if (details?.marketPredictions) preds.push(...details.marketPredictions);
    }

    if (preds.length === 0) {
      return 'No verified live fixtures are available from the configured providers. Please try again later or check the web dashboard.';
    }
    const parlay = buildStatisticalParlay(preds, { targetLegsCount: target, minProbability: 0.58, mode });
    if (this.trackerService) {
      await this.trackerService.trackParlay(parlay);
    }

    const legsList = parlay.legs.map((l, i) => `${i + 1}. **${l.fixtureDescription}**: \`${l.selection}\` (${(l.estimatedProbability * 100).toFixed(0)}% | ${l.league})`).join('\n');

    return (
      `⚡ **${parlay.actualLegsCount}-Leg ${parlay.mode === 'SAME_GAME_PARLAY' ? 'Same-Game Parlay (SGP)' : 'Statistical Parlay'}**:\n\n${legsList}\n\n` +
      `• **Combined Probability**: \`${(parlay.combinedProbability * 100).toFixed(2)}%\`\n` +
      `• **Fair Compound Odds**: \`${parlay.compoundOddsDecimal}x\`\n` +
      `• **Mode**: \`${parlay.mode}\`\n\n` +
      `*Type \`/track\` to follow live match motion!*`
    );
  }

  public async generateSgpReply(): Promise<string> {
    const today = new Date().toISOString().substring(0, 10);
    const allFixtures = await this.factory.getFixturesByDate(today, 'ALL');
    const fixtures = allFixtures.filter(fx => isVerifiedFixture(fx));
    const preds: MarketPrediction[] = [];

    for (const fx of fixtures) {
      const details = await this.factory.getMatchDetails(fx.id);
      if (details?.marketPredictions) preds.push(...details.marketPredictions);
    }

    if (preds.length === 0) {
      return 'No verified live fixtures are available from the configured providers. Please try again later or check the web dashboard.';
    }
    const parlay = buildStatisticalParlay(preds, {
      targetLegsCount: 5,
      minProbability: 0.58,
      mode: 'SAME_GAME_PARLAY',
    });

    if (this.trackerService) {
      await this.trackerService.trackParlay(parlay);
    }

    const legsList = parlay.legs
      .map((l, i) => `${i + 1}. \`${l.marketLabel}\`: **${l.selection}** — **${(l.estimatedProbability * 100).toFixed(1)}%** prob`)
      .join('\n');

    return (
      `🔥 **Same-Game Parlay (SGP) — Single Match Stacking**:\n` +
      `🏟️ Match: **${parlay.legs[0]?.fixtureDescription || 'Featured Fixture'}**\n\n` +
      `${legsList}\n\n` +
      `• **Correlated Joint Probability**: \`${(parlay.combinedProbability * 100).toFixed(2)}%\`\n` +
      `• **Fair Compound Odds**: \`${parlay.compoundOddsDecimal}x\`\n` +
      `• **Correlation Mechanism**: Over 0.5 Goals + Over 5.5 Corners + Cards calibrated via copula adjustment.\n\n` +
      `*Type \`/track\` to follow live in-game movement!*`
    );
  }

  public async generateLiveTrackerReply(): Promise<EmbedBuilder | string> {
    if (!this.trackerService) {
      return '⚠️ Live tracker service is not active.';
    }

    const trackedList = this.trackerService.getTrackedParlays();
    if (trackedList.length === 0) {
      return 'No parlays are currently tracked! Generate one first using /parlay or /sgp, or track one in the web dashboard at ' + DASHBOARD_URL + '.';
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
        `• **Current Cashout / Equity Index**: \`${(updated.cashoutProbabilityIndex * 100).toFixed(1)}%\``
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

    return embed;
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
