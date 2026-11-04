import axios from 'axios';
const BASE = 'https://site.api.espn.com/apis/site/v2/sports/soccer/all';
async function main() {
    const res = await axios.get(`${BASE}/summary`, { params: { event: '401878771' } });
    const d = res.data;
    const lf = d.lastFiveGames;
    console.log('lastFiveGames type:', Array.isArray(lf) ? 'array' : typeof lf, 'len:', lf?.length);
    if (Array.isArray(lf)) {
        lf.forEach((g, i) => {
            console.log(`\n[${i}] keys:`, Object.keys(g).join(', '));
            console.log(`[${i}] team.id:`, g.team?.id, '| team.displayName:', g.team?.displayName);
            console.log(`[${i}] displayOrder:`, JSON.stringify(g.displayOrder));
            console.log(`[${i}] events:`, Array.isArray(g.events) ? g.events.length : typeof g.events);
            const ev = (g.events || [])[0];
            if (ev) {
                console.log(`[${i}] ev[0] keys:`, Object.keys(ev).join(', '));
                const comps = ev.competitions?.[0]?.competitors || [];
                console.log(`[${i}] ev[0] competitors:`, comps.map((c) => `id=${c.team?.id} name=${c.team?.displayName} score=${JSON.stringify(c.score)}`).join(' | '));
            }
        });
    }
    // Also confirm boxscore statistics mapping works
    const map = {};
    for (const t of d.boxscore?.teams || []) {
        for (const st of t.statistics || [])
            map[`${t.homeAway}.${st.name}`] = st.displayValue;
    }
    console.log('\nboxscore mapped sample:', JSON.stringify(Object.entries(map).slice(0, 12)));
}
main().catch(e => { console.error('ERR', e.message); process.exit(1); });
