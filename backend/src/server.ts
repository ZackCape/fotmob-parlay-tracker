import { createApp } from './app.js';
import { DataProviderFactory } from './providers/provider-factory.js';
import { initializeBackgroundJobs } from './cron/scheduler.js';
import { DiscordBotService } from './discord/bot.js';
import { LiveParlayTrackerService } from './parlays/live-tracker.js';
import { config } from './config/env.js';
import { getDatabase } from './database/db.js';

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

  // Initialize App
  const app = createApp(factory, discordBot, parlayTracker);

  const server = app.listen(config.port, () => {
    console.log(`🚀 Server listening on http://localhost:${config.port}`);
    console.log(`📊 Health Check: http://localhost:${config.port}/api/system/status`);
    console.log(`🤖 Discord Status: http://localhost:${config.port}/api/discord/status`);
    console.log(`📅 Fixtures API: http://localhost:${config.port}/api/fixtures?date=2026-10-18`);
    console.log('----------------------------------------------------');
  });

  return server;
}

bootstrap().catch(err => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});
