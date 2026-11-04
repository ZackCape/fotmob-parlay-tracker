/**
 * TEMPORARY diagnostic (deleted after the run).
 * Dumps the raw ESPN scoreboard fields that `detectLeague` relies on, so the
 * league mapping can be fixed from evidence instead of guesswork.
 */
import axios from 'axios';
const BASE = 'https://site.api.espn.com/apis/site/v2/sports/soccer/all';
async function main() {
    for (const date of ['20261020', '20261018']) {
        const res = await axios.get(`${BASE}/scoreboard`, { params: { dates: date }, timeout: 12000 });
        const events = res.data?.events || [];
        console.log(`\n=== ${date}: ${events.length} events ===`);
        for (const ev of events) {
            const leaguePaths = (ev.links || [])
                .map((l) => String(l?.href || '').match(/league\/([^?/]+)/)?.[1])
                .filter(Boolean);
            const name = ev.name || '';
            const slug = ev.season?.slug || '';
            const comp = ev.competitions?.[0];
            console.log(`  leagueCodes=${JSON.stringify(leaguePaths).padEnd(18)} slug="${slug}" name="${name}"` +
                ` ${ev.shortName || ''}`);
            if (/dunfermline|partick|hilal|fateh/i.test(name)) {
                console.log('    >>> LINKS:', JSON.stringify((ev.links || []).map((l) => l.href)));
                console.log('    >>> season:', JSON.stringify(ev.season));
                console.log('    >>> leagues:', JSON.stringify(ev.leagues));
                console.log('    >>> competitions[0].date:', comp?.date, 'status:', comp?.status?.type?.name);
            }
        }
    }
}
main().catch((e) => { console.error(e.message); process.exit(1); });
