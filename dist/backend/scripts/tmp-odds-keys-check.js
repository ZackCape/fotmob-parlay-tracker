/**
 * TEMPORARY verification harness (deleted after the run).
 *
 * The Odds API `/v4/sports` listing is free (no quota), so we can confirm that
 * every sport key we registered actually exists and is active — a wrong key
 * silently looks like "no odds published". The API key is never printed.
 */
import axios from 'axios';
// Importing the config module is what loads `.env` into process.env.
import '../src/config/env.js';
import { ODDS_SPORT_KEYS } from '../src/providers/theodds-adapter.js';
async function main() {
    const key = process.env.THE_ODDS_API_KEY || process.env.ODDS_API_KEY || '';
    if (!key) {
        console.log('no odds key configured — cannot verify (skipping, not a failure)');
        process.exit(0);
    }
    const res = await axios.get('https://api.the-odds-api.com/v4/sports', {
        params: { apiKey: key },
        timeout: 20000,
    });
    const all = res.data || [];
    const byKey = new Map(all.map((s) => [s.key, s]));
    console.log(`live catalogue: ${all.length} sports; remaining quota: ${res.headers['x-requests-remaining']}\n`);
    let failures = 0;
    for (const [league, sportKey] of Object.entries(ODDS_SPORT_KEYS)) {
        const s = byKey.get(sportKey);
        if (!s) {
            console.log(`  FAIL  ${league.padEnd(22)} ${sportKey} — not in the live catalogue`);
            failures++;
        }
        else {
            console.log(`  PASS  ${league.padEnd(22)} ${sportKey} — "${s.title}" (group="${s.group}", active=${s.active})`);
        }
    }
    console.log(`\n${failures === 0 ? 'ALL SPORT KEYS VALID' : `${failures} SPORT KEY(S) INVALID`}`);
    if (failures > 0) {
        console.log('\n--- candidate sports matching the missing leagues ---');
        const hints = [/swiss/i, /switzerland/i];
        for (const s of all) {
            if (hints.some((h) => h.test(`${s.key} ${s.title} ${s.group}`))) {
                console.log(`  ${s.key} — "${s.title}" (group="${s.group}", active=${s.active})`);
            }
        }
    }
    process.exit(failures === 0 ? 0 : 1);
}
main().catch((e) => {
    console.error('harness error:', e.response?.status ?? e.message);
    process.exit(2);
});
