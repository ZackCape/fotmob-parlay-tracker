import dotenv from 'dotenv';
import path from 'path';
// Load environment variables
dotenv.config();
export const config = {
    port: parseInt(process.env.PORT || '5000', 10),
    nodeEnv: process.env.NODE_ENV || 'development',
    databaseUrl: process.env.DATABASE_URL || undefined,
    sqliteDbPath: process.env.SQLITE_DB_PATH || path.resolve(process.cwd(), 'data', 'football_analytics.db'),
    dataProvider: process.env.DATA_PROVIDER || 'auto',
    apiFootballKey: process.env.API_FOOTBALL_KEY || undefined,
    footballDataOrgKey: process.env.FOOTBALL_DATA_ORG_KEY || undefined,
    cacheTtlMinutes: parseInt(process.env.CACHE_TTL_MINUTES || '15', 10),
    syncCronSchedule: process.env.SYNC_CRON_SCHEDULE || '0 */4 * * *',
    discordBotToken: process.env.DISCORD_BOT_TOKEN || undefined,
    discordChannelId: process.env.DISCORD_CHANNEL_ID || undefined,
    discordWebhookUrl: process.env.DISCORD_WEBHOOK_URL || undefined,
    enableDiscordHourly: process.env.ENABLE_DISCORD_HOURLY !== 'false',
    discordUpdateInterval: process.env.DISCORD_UPDATE_INTERVAL || '1h',
};
