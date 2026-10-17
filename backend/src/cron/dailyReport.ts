import cron from 'node-cron';
import fs from 'fs';
import path from 'path';
import { config } from '../config/env.js';

const STATE_FILE = path.resolve(process.cwd(), 'data', 'daily_report_state.json');

interface State { lastReportDate: string | null; }

function readState(): State {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch { return { lastReportDate: null }; }
}
function writeState(s: State) {
  try { fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true }); fs.writeFileSync(STATE_FILE, JSON.stringify(s)); } catch {}
}

function todayInTz(tz: string): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: tz }); // YYYY-MM-DD
}

export function scheduleDailyReport(sendFn: (date: string, tz: string) => Promise<void>) {
  const tz = config.reportTimezone;
  // Run every minute; check if 23:59 local and not yet reported
  cron.schedule('* * * * *', async () => {
    const now = new Date();
    const local = new Date(now.toLocaleString('en-US', { timeZone: tz }));
    const hh = local.getHours();
    const mm = local.getMinutes();
    if (hh === 23 && mm === 59) {
      const today = todayInTz(tz);
      const state = readState();
      if (state.lastReportDate !== today) {
        try {
          await sendFn(today, tz);
          writeState({ lastReportDate: today });
        } catch (e) {
          console.error('[DailyReport] Failed:', (e as any)?.message);
        }
      }
    }
  });
  // Catch-up on startup
  (async () => {
    const today = todayInTz(tz);
    const state = readState();
    const local = new Date(new Date().toLocaleString('en-US', { timeZone: tz }));
    // If past 23:59 today and not reported, send catch-up
    if (local.getHours() * 60 + local.getMinutes() >= 23 * 60 + 59 && state.lastReportDate !== today) {
      try {
        await sendFn(today, tz);
        writeState({ lastReportDate: today });
        console.log('[DailyReport] Catch-up report sent for', today);
      } catch (e) {
        console.error('[DailyReport] Catch-up failed:', (e as any)?.message);
      }
    }
  })();
}