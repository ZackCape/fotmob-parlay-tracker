/**
 * TEMPORARY diagnostic (deleted after the run).
 * Applies the adapter's real LEAGUE_MAP + SLUG_MAP to raw ESPN events and
 * reports which path resolved each competition, so false positives are visible.
 */
import axios from 'axios';
import { LEAGUE_MAP, SLUG_MAP } from '../src/providers/espn-adapter.js';
const BASE = 'https://site.api.espn.com/apis/site/v2/sports/soccer/all';
function resolve(ev) {
    for (const l of ev?.links || []) {
        const m = String(l?.href || '').match(/league\/([^?/]+)/);
        if (m && LEAGUE_MAP[m[1]])
            return { league: LEAGUE_MAP[m[1]], via: 'link', code: m[1] };
    }
    const slug = ev?.season?.slug || '';
    for (const [re, lg] of SLUG_MAP)
        if (re.test(slug))
            return { league: lg, via: 'slug', code: slug };
    const name = ev?.name || '';
    for (const [re, lg] of SLUG_MAP)
        if (re.test(name))
            return { league: lg, via: 'name', code: name };
    return null;
}
async function main() {
    const dates = ['20261018', '20261019', '20261024'];
    const byLeague = new Map();
    let total = 0;
    for (const date of dates) {
        const res = await axios.get(`${BASE}/scoreboard`, { params: { dates: date }, timeout: 12000 });
        const events = res.data?.events || [];
        total += events.length;
        for (const ev of events) {
            const r = resolve(ev);
            if (!r)
                continue;
            if (!byLeague.has(r.league))
                byLeague.set(r.league, []);
            byLeague.get(r.league).push({ name: ev.name || ev.shortName || '', via: r.via, code: r.code });
        }
    }
    console.log(`scanned ${total} events across ${dates.length} dates\n`);
    for (const [league, rows] of [...byLeague.entries()].sort()) {
        const via = [...new Set(rows.map((r) => r.via))].join(',');
        const codes = [...new Set(rows.map((r) => r.code))].join(' | ');
        console.log(`${league.padEnd(22)} n=${String(rows.length).padEnd(4)} via=${via.padEnd(10)} codes="${codes}"`);
        for (const r of rows.slice(0, 4))
            console.log(`    ${r.name}  [${r.via}:${r.code}]`);
    }
}
main().catch((e) => { console.error(e.message); process.exit(1); });
