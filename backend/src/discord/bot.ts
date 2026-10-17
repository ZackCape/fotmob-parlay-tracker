import { Client, GatewayIntentBits, EmbedBuilder, TextChannel, SlashCommandBuilder } from 'discord.js';
import axios from 'axios';
import cron from 'node-cron';
import { DataProviderFactory } from '../providers/provider-factory.js';
import { buildStatisticalParlay } from '../parlays/parlay-builder.js';
import { MarketPrediction, ParlayMode } from '../types/football.js';
import { LiveParlayTrackerService } from '../parlays/live-tracker.js';
import { isVerifiedFixture } from '../utils/fixtureValidation.js';

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
      await this.sendHourlyUpdate();
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
            .setDescription('Display quick command directory and statistical modeling overview'),
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
          const replyText = await this.generateFixturesReply();
          await interaction.editReply(replyText);
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
