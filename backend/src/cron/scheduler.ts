import cron from 'node-cron';
import { DataProviderFactory } from '../providers/provider-factory.js';
import { config } from '../config/env.js';

export function initializeBackgroundJobs(factory: DataProviderFactory): void {
  console.log(`[Scheduler] Initializing automated sync schedule: ${config.syncCronSchedule}`);

  cron.schedule(config.syncCronSchedule, async () => {
    console.log('[Scheduler] Running scheduled background data refresh...');
    try {
      const today = new Date().toISOString().substring(0, 10);
      // Pre-warm cache for today and tomorrow
      const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().substring(0, 10);

      await factory.getFixturesByDate(today, 'ALL');
      await factory.getFixturesByDate(tomorrow, 'ALL');

      console.log(`[Scheduler] Data refresh completed successfully for ${today} and ${tomorrow}.`);
    } catch (err: any) {
      console.error('[Scheduler] Error during scheduled sync:', err.message);
    }
  });
}
