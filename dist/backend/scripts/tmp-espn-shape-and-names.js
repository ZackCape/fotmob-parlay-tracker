/**
 * TEMPORARY diagnostic (deleted after the run).
 * 1. Verifies the league-specific scoreboard has the same JSON shape the
 *    adapter already maps.
 * 2. Names the ESPN league ids seen in the `all` feed, to locate Poland.
 */
import axios from 'axios';
const SITE = 'https://site.api.espn.com/apis/site/v2/sports/soccer';
const CORE = 'https://sports.core.api.espn.com/v2/sports/soccer/leagues';
async function shape() {
    const res = await axios.get(`${SITE}/eng.2/scoreboard`, { params: { dates: '20261024' }, timeout: 12000 });
    const events = res.data?.events || [];
    console.log(`eng.2 scoreboard: ${events.length} events`);
    const ev = events[0];
    const comp = ev.competitions?.[0];
    console.log(`  event keys: ${Object.keys(ev).join(', ')}`);
    console.log(`  uid=${ev.uid} id=${ev.id} date=${ev.date} seasonSlug=${ev.season?.slug}`);
    console.log(`  comp keys: ${Object.keys(comp || {}).join(', ')}`);
    console.log(`  comp.date=${comp?.date} statusState=${comp?.status?.type?.state} statusName=${comp?.status?.type?.name}`);
    console.log(`  displayClock=${JSON.stringify(comp?.status?.displayClock)} period=${comp?.status?.period}`);
    console.log(`  competitors: ${JSON.stringify((comp?.competitors || []).map((c) => ({ ha: c.homeAway, name: c.team?.displayName, score: c.score, logo: !!c.team?.logo, id: c.team?.id })))}`);
    console.log(`  venue=${comp?.venue?.fullName}`);
}
async function names() {
    const ids = [3959, 770, 5487, 3916, 3915, 23480, 750, 760, 3906, 20956, 20955, 20226, 8097, 8301, 23390, 20865, 21231, 5499];
    console.log('\nleague id -> name');
    for (const id of ids) {
        try {
            const res = await axios.get(`${CORE}/${id}`, { timeout: 10000 });
            console.log(`  l:${String(id).padEnd(6)} "${res.data?.name}" slug="${res.data?.slug}"`);
        }
        catch (e) {
            console.log(`  l:${String(id).padEnd(6)} ERR ${e.response?.status ?? e.message}`);
        }
    }
}
(async () => { await shape(); await names(); })().catch((e) => { console.error('probe error:', e.message); process.exit(1); });
