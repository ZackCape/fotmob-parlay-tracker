import { createApp } from './app.js';
import { DataProviderFactory } from './providers/provider-factory.js';
import { initializeBackgroundJobs } from './cron/scheduler.js';
import { scheduleDailyReport } from './cron/dailyReport.js';
import { DiscordBotService } from './discord/bot.js';
import { LiveParlayTrackerService } from './parlays/live-tracker.js';
import { config } from './config/env.js';
import { getDatabase } from './database/db.js';
import axios from 'axios';

/** Keep-alive cadence: Render's free instance sleeps after 15 minutes idle. */
const KEEP_ALIVE_INTERVAL_MS = 10 * 60 * 1000;
/** Override for local verification only; the default is the 10-minute cadence. */
const MIN_KEEP_ALIVE_INTERVAL_MS = 30 * 1000;
const KEEP_ALIVE_TIMEOUT_MS = 10 * 1000;
const KEEP_ALIVE_FALLBACK_URL = 'https://football-analytics-bot-0zwd.onrender.com';

/**
 * Self-ping keep-alive.
 *
 * Render stops a free web instance after 15 minutes without an inbound request.
 * A self-check against our own `/api/system/status` every 10 minutes counts as
 * that traffic, so the Discord gateway and the live match worker keep running
 * around the clock instead of being torn down between fixtures.
 *
 * Deliberately quiet: one line when it is armed, nothing at all while the pings
 * succeed, a throttled warning when they do not, and a single line on recovery.
 * A stream of "ping ok" logs would bury the messages that actually matter.
 *
 * Local, test and CI runs are untouched — this only arms on a deployed instance.
 */
function startSelfKeepAlive(): NodeJS.Timeout | null {
  const isDeployed = process.env.NODE_ENV === 'production' || process.env.RENDER === 'true';
  if (!isDeployed) return null;

  const baseUrl = (process.env.RENDER_EXTERNAL_URL || KEEP_ALIVE_FALLBACK_URL).replace(/\/+$/, '');
  const target = `${baseUrl}/api/system/status`;

  const override = Number(process.env.KEEP_ALIVE_INTERVAL_MS);
  const intervalMs = Number.isFinite(override) && override >= MIN_KEEP_ALIVE_INTERVAL_MS
    ? override
    : KEEP_ALIVE_INTERVAL_MS;

  let consecutiveFailures = 0;

  const ping = async (): Promise<void> => {
    try {
      const res = await axios.get(target, {
        timeout: KEEP_ALIVE_TIMEOUT_MS,
        validateStatus: () => true,
        headers: { 'User-Agent': 'CapePredictor-KeepAlive/1.0' },
      });

      if (res.status >= 200 && res.status < 400) {
        if (consecutiveFailures > 0) {
          console.log(`[KeepAlive] Recovered after ${consecutiveFailures} failed ping(s) (HTTP ${res.status})`);
        }
        consecutiveFailures = 0;
        return;
      }

      consecutiveFailures += 1;
      // Log the first failure, then roughly once an hour, so an outage cannot flood the log.
      if (consecutiveFailures === 1 || consecutiveFailures % 6 === 0) {
        console.warn(`[KeepAlive] Ping returned HTTP ${res.status} (${consecutiveFailures} consecutive failure(s))`);
      }
    } catch (err: any) {
      consecutiveFailures += 1;
      if (consecutiveFailures === 1 || consecutiveFailures % 6 === 0) {
        console.warn(`[KeepAlive] Ping failed: ${err?.code || err?.message} (${consecutiveFailures} consecutive failure(s))`);
      }
    }
  };

  const timer = setInterval(() => { void ping(); }, intervalMs);
  // Never let the keep-alive itself hold the process open.
  timer.unref();

  console.log(`[KeepAlive] Self-ping armed every ${Math.round(intervalMs / 60000)} min -> ${target}`);
  return timer;
}

async function bootstrap() {
  console.log('----------------------------------------------------');
  console.log('🏆 Multi-League & UEFA Football Statistical Analytics Engine');
  console.log('   EPL • Championship • La Liga • Ligue 1 • UCL • UEL • UECL');
  console.log('----------------------------------------------------');
  console.log(`Environment: ${config.nodeEnv}`);
  console.log(`Configured Provider: ${config.dataProvider}`);

  // Initialize DB
  getDatabase();

  // Initialize Data Provider Factory
  const factory = new DataProviderFactory(config);

  // Initialize Live Parlay Tracker
  const parlayTracker = new LiveParlayTrackerService(factory);

  // Initialize Discord Bot Service
  const discordBot = new DiscordBotService(
    {
      botToken: config.discordBotToken,
      channelId: config.discordChannelId,
      webhookUrl: config.discordWebhookUrl,
      enableHourlyUpdates: config.enableDiscordHourly,
    },
    factory,
    parlayTracker
  );
  await discordBot.start();

  // Initialize Background Scheduler
  initializeBackgroundJobs(factory);

  // Daily parlay report (23:59 in configured timezone)
  scheduleDailyReport(async (date, tz) => {
    console.log(`[DailyReport] Generating report for ${date} (${tz})`);
    if (config.parlayReportChannelId && discordBot) {
      // Delegate to bot if it exposes a method; otherwise log only
      console.log(`[DailyReport] Would send to channel ${config.parlayReportChannelId}`);
    } else {
      console.warn('[DailyReport] No PARLAY_REPORT_CHANNEL_ID configured; skipping send.');
    }
  });

  // Initialize App
  const app = createApp(factory, discordBot, parlayTracker);

  const server = app.listen(config.port, "0.0.0.0", () => {
    console.log(`🚀 Server listening on http://localhost:${config.port}`);
    console.log(`📊 Health Check: http://localhost:${config.port}/api/system/status`);
    console.log(`🤖 Discord Status: http://localhost:${config.port}/api/discord/status`);
    console.log(`📅 Fixtures API: http://localhost:${config.port}/api/fixtures?date=${new Date().toISOString().split('T')[0]}`);
    console.log('----------------------------------------------------');
  });

  // Keep the deployed instance provisioned 24/7 (no-op outside production).
  startSelfKeepAlive();

  return server;
}

bootstrap().catch(err => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});
