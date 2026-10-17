import dotenv from 'dotenv';
import path from 'path';

// Load environment variables
dotenv.config();

export interface AppConfig {
  port: number;
  nodeEnv: string;
  databaseUrl?: string;
  sqliteDbPath: string;
  dataProvider: 'auto' | 'api-football' | 'football-data' | 'fotmob' | 'footballdatabase' | 'verified-archive' | 'openfootball';
  apiFootballKey?: string;
  apiFootballKeys: string[];
  footballDataOrgKey?: string;
  theOddsApiKey?: string;
  theOddsApiRegions: string;
  theOddsApiMonthlyLimit: number;
  theOddsApiSafetyReserve: number;
  cacheTtlMinutes: number;
  syncCronSchedule: string;
  apiFootballDailyLimit: number;
  apiFootballSafetyMargin: number;
  openfootballEnabled: boolean;
  openfootballDataDir: string;
  discordBotToken?: string;
  discordChannelId?: string;
  discordWebhookUrl?: string;
  enableDiscordHourly: boolean;
  discordUpdateInterval: '5m' | '15m' | '30m' | '45m' | '1h';
  reportTimezone: string;
  parlayReportChannelId?: string;
}

export const config: AppConfig = {
  port: parseInt(process.env.PORT || '5000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  databaseUrl: process.env.DATABASE_URL || undefined,
  sqliteDbPath: process.env.SQLITE_DB_PATH || path.resolve(process.cwd(), 'data', 'football_analytics.db'),
  dataProvider: (process.env.DATA_PROVIDER as AppConfig['dataProvider']) || 'auto',
  apiFootballKey: process.env.API_FOOTBALL_KEY || undefined,
  apiFootballKeys: (() => {
    const list: string[] = [];
    if (process.env.API_FOOTBALL_KEYS) {
      list.push(...process.env.API_FOOTBALL_KEYS.split(',').map(k => k.trim()).filter(Boolean));
    }
    if (process.env.API_FOOTBALL_KEY) list.push(process.env.API_FOOTBALL_KEY);
    for (let i = 1; i <= 10; i++) {
      const v = process.env[`API_FOOTBALL_KEY_${i}`];
      if (v) list.push(v);
    }
    return [...new Set(list)];
  })(),
  footballDataOrgKey: process.env.FOOTBALL_DATA_ORG_KEY || undefined,
  cacheTtlMinutes: parseInt(process.env.CACHE_TTL_MINUTES || '15', 10),
  syncCronSchedule: process.env.SYNC_CRON_SCHEDULE || '0 */4 * * *',
  openfootballEnabled: process.env.OPENFOOTBALL_ENABLED !== 'false',
  openfootballDataDir: process.env.OPENFOOTBALL_DATA_DIR || path.resolve(process.cwd(), 'data', 'openfootball'),
  apiFootballDailyLimit: parseInt(process.env.API_FOOTBALL_DAILY_LIMIT || '90', 10),
  apiFootballSafetyMargin: parseInt(process.env.API_FOOTBALL_SAFETY_MARGIN || '10', 10),
  theOddsApiKey: process.env.THE_ODDS_API_KEY || undefined,
  theOddsApiRegions: process.env.THE_ODDS_API_REGIONS || 'uk',
  theOddsApiMonthlyLimit: parseInt(process.env.THE_ODDS_API_MONTHLY_LIMIT || '500', 10),
  theOddsApiSafetyReserve: parseInt(process.env.THE_ODDS_API_SAFETY_RESERVE || '50', 10),
  discordBotToken: process.env.DISCORD_BOT_TOKEN || undefined,
  discordChannelId: process.env.DISCORD_CHANNEL_ID || undefined,
  discordWebhookUrl: process.env.DISCORD_WEBHOOK_URL || undefined,
  enableDiscordHourly: process.env.ENABLE_DISCORD_HOURLY !== 'false',
  discordUpdateInterval: (process.env.DISCORD_UPDATE_INTERVAL as any) || '1h',
  reportTimezone: process.env.REPORT_TIMEZONE || 'Africa/Harare',
  parlayReportChannelId: process.env.PARLAY_REPORT_CHANNEL_ID || undefined,
};
