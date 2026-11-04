/**
 * TEMPORARY diagnostic (deleted after the run).
 *
 * Compares ESPN's `all` scoreboard with the league-specific scoreboard for the
 * English second tier and the UEFA cups, to decide whether a competition is
 * genuinely not playing or is being dropped for want of a league code.
 */
import axios from 'axios';
const BASE = 'https://site.api.espn.com/apis/site/v2/sports/soccer';
const DATES = ['20261020', '20261021', '20261024', '20261025'];
async function count(slug, date) {
    try {
        const res = await axios.get(`${BASE}/${slug}/scoreboard`, { params: { dates: date }, timeout: 12000 });
        const events = res.data?.events || [];
        const names = events.slice(0, 3).map((e) => e.shortName || e.name).join(' | ');
        return `${events.length}${names ? `  (${names})` : ''}`;
    }
    catch (e) {
        return `ERR ${e.response?.status ?? e.message}`;
    }
}
async function main() {
    for (const date of DATES) {
        console.log(`\n=== ${date} ===`);
        for (const slug of ['eng.2', 'uefa.champions', 'uefa.europa', 'den.1', 'sui.1', 'pol.1', 'bel.1']) {
            console.log(`  ${slug.padEnd(16)} ${await count(slug, date)}`);
        }
    }
}
main().catch((e) => { console.error(e.message); process.exit(1); });
