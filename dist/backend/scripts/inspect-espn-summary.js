/** Inspect the real ESPN summary payload for available per-team strength signals. */
import axios from 'axios';
const BASE = 'https://site.api.espn.com/apis/site/v2/sports/soccer/all';
async function main() {
    const board = await axios.get(`${BASE}/scoreboard`, { params: { dates: '20261017', limit: '100' } });
    const ev = board.data.events.find((e) => e.competitions?.[0]?.status?.type?.name !== 'STATUS_SCHEDULED');
    const id = ev.id;
    console.log('event:', id, ev.name);
    const res = await axios.get(`${BASE}/summary`, { params: { event: id } });
    const d = res.data;
    console.log('top-level keys:', Object.keys(d).join(', '));
    console.log('\n--- boxscore.teams[*] keys ---');
    (d.boxscore?.teams || []).forEach((t) => {
        console.log(' team:', t.team?.displayName, '| keys:', Object.keys(t).join(', '));
        console.log('   statistics:', (t.statistics || []).map((s) => `${s.name}=${s.displayValue}`).join(' | '));
    });
    console.log('\n--- header competitors records ---');
    (d.header?.competitions?.[0]?.competitors || []).forEach((c) => {
        console.log(' ', c.homeAway, c.team?.displayName, '| records:', JSON.stringify(c.records), '| curatedRank:', JSON.stringify(c.curatedRank?.current));
    });
    console.log('\n--- boxscore.form ---');
    console.log(JSON.stringify(d.form, null, 1)?.slice(0, 1200));
    console.log('\n--- standings? ---', d.standings ? Object.keys(d.standings).join(',') : 'none');
    console.log('\n--- predictors / odds ---');
    console.log('predictors:', JSON.stringify(d.predictors)?.slice(0, 600));
    console.log('pickcenter:', JSON.stringify(d.pickcenter)?.slice(0, 600));
    console.log('\n--- teams entries (id/uid) ---');
    (d.header?.competitions?.[0]?.competitors || []).forEach((c) => console.log(' ', c.team?.displayName, '=>', c.team?.id));
}
main().catch(e => { console.error('ERR', e.message); process.exit(1); });
