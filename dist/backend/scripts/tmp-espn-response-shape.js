/**
 * TEMPORARY diagnostic (deleted after the run).
 *
 * ESPN's `all` scoreboard response carries a top-level `leagues` array. This
 * probe prints it alongside each event's `uid` to see whether events can be
 * attributed to a competition from provider data rather than slug guesswork.
 */
import axios from 'axios';
const BASE = 'https://site.api.espn.com/apis/site/v2/sports/soccer/all';
async function main() {
    for (const date of ['20261020', '20261024', '20261025']) {
        const res = await axios.get(`${BASE}/scoreboard`, { params: { dates: date }, timeout: 15000 });
        const leagues = res.data?.leagues || [];
        const events = res.data?.events || [];
        console.log(`\n=== ${date}: ${events.length} events, ${leagues.length} leagues ===`);
        for (const l of leagues.slice(0, 12)) {
            console.log(`  league id=${l.id} slug="${l.slug}" abbr="${l.abbreviation}" name="${l.name}"`);
        }
        console.log('  --- sample events ---');
        for (const ev of events.slice(0, 6)) {
            console.log(`  uid="${ev.uid}" id=${ev.id} slug="${ev.season?.slug}" name="${ev.name}" leaguesField=${JSON.stringify(ev.leagues)}`);
        }
    }
}
main().catch((e) => { console.error('probe error:', e.message); process.exit(1); });
