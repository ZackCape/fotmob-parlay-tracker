/**
 * TEMPORARY diagnostic (deleted after the run).
 *
 * 1. Counts `all`-scoreboard events by the ESPN league id embedded in `uid`,
 *    to prove whether the dropped competitions are present but mis-attributed.
 * 2. Looks up ESPN's real slug for the Polish top flight via the search API.
 */
import axios from 'axios';
const BASE = 'https://site.api.espn.com/apis/site/v2/sports/soccer/all';
const KNOWN = {
    700: 'EPL', 3914: 'CHAMPIONSHIP', 740: 'LALIGA', 730: 'SERIE_A', 720: 'BUNDESLIGA',
    3927: 'BUNDESLIGA2', 710: 'LIGUE1', 775: 'CHAMPIONS_LEAGUE', 776: 'EUROPA_LEAGUE',
    20296: 'CONFERENCE_LEAGUE', 725: 'EREDIVISIE', 715: 'PRIMEIRA_LIGA', 3901: 'PRO_LEAGUE',
    735: 'SCOTTISH_PREM', 3946: 'SUPER_LIG', 3944: 'SWISS_SUPER', 3907: 'AUSTRIAN_BUNDESLIGA',
    3913: 'DANISH_SUPERLIGA',
};
async function main() {
    for (const date of ['20261020', '20261021', '20261024', '20261025']) {
        const res = await axios.get(`${BASE}/scoreboard`, { params: { dates: date }, timeout: 15000 });
        const events = res.data?.events || [];
        const counts = new Map();
        for (const ev of events) {
            const id = Number(String(ev.uid || '').match(/l:(\d+)/)?.[1]);
            if (!Number.isFinite(id))
                continue;
            counts.set(id, (counts.get(id) ?? 0) + 1);
        }
        const supported = [...counts.entries()].filter(([id]) => KNOWN[id]);
        const unsupported = [...counts.entries()].filter(([id]) => !KNOWN[id]).sort((a, b) => b[1] - a[1]);
        console.log(`\n=== ${date}: ${events.length} events, ${counts.size} leagues (by uid) ===`);
        for (const [id, n] of supported.sort((a, b) => b[1] - a[1])) {
            console.log(`  SUPPORTED  l:${String(id).padEnd(6)} ${KNOWN[id].padEnd(22)} n=${n}`);
        }
        console.log(`  (other leagues present: ${unsupported.slice(0, 6).map(([id, n]) => `l:${id}=${n}`).join(', ')})`);
    }
    console.log('\n=== ESPN search: Polish top flight ===');
    for (const q of ['ekstraklasa', 'swiss super league', 'danish superliga']) {
        try {
            const res = await axios.get('https://site.web.api.espn.com/apis/common/v3/search', {
                params: { query: q, limit: 8, type: 'league' }, timeout: 12000,
            });
            const items = res.data?.items || [];
            console.log(`  "${q}":`);
            for (const it of items.slice(0, 8)) {
                const l = it?.league || it;
                console.log(`     slug="${l?.slug}" id=${l?.id} name="${l?.name || l?.displayName}"`);
            }
            if (items.length === 0)
                console.log('     (no results)');
        }
        catch (e) {
            console.log(`  "${q}": ERR ${e.response?.status ?? e.message}`);
        }
    }
}
main().catch((e) => { console.error('probe error:', e.message); process.exit(1); });
