/** Inspect the real ESPN keyEvents payload for live event detail. */
import axios from 'axios';
const BASE = 'https://site.api.espn.com/apis/site/v2/sports/soccer/all';
async function main() {
    const board = await axios.get(`${BASE}/scoreboard`, { params: { dates: process.argv[2] || '20261017', limit: '100' } });
    const events = board.data.events || [];
    console.log('scoreboard events:', events.length);
    // Prefer an in-progress match.
    const live = events.find((e) => {
        const t = e.competitions?.[0]?.status?.type?.name;
        return t && t !== 'STATUS_SCHEDULED' && t !== 'STATUS_FINAL';
    }) || events[0];
    if (!live) {
        console.log('no events');
        return;
    }
    console.log('\nscoreboard event keys:', Object.keys(live).join(', '));
    const st = live.competitions?.[0]?.status;
    console.log('status:', JSON.stringify(st));
    console.log('competition keys:', Object.keys(live.competitions[0]).join(', '));
    const h = live.competitions[0].competitors[0];
    console.log('competitor keys:', Object.keys(h).join(', '));
    console.log('competitor sample:', JSON.stringify({ id: h.id, homeAway: h.homeAway, score: h.score, linescores: h.linescores }, null, 1));
    const res = await axios.get(`${BASE}/summary`, { params: { event: live.id } });
    const d = res.data;
    const ke = d.keyEvents || [];
    console.log('\n=== keyEvents:', ke.length, '===');
    for (const e of ke) {
        console.log(JSON.stringify({
            id: e.id,
            type: e.type,
            clock: e.clock,
            team: e.team?.displayName,
            teamId: e.team?.id,
            scoringPlay: e.scoringPlay,
            redCard: e.redCard,
            yellowCard: e.yellowCard,
            penaltyKick: e.penaltyKick,
            participants: (e.participants || []).map((p) => ({
                type: p.type, athlete: p.athlete?.displayName, id: p.athlete?.id,
            })),
        }));
    }
    console.log('\n=== header competitors ===');
    (d.header?.competitions?.[0]?.competitors || []).forEach((c) => console.log(' ', c.homeAway, c.team?.displayName, 'score=', JSON.stringify(c.score), 'linescores=', (c.linescores || []).length));
    console.log('\n=== keyEvents top-level keys (first) ===');
    console.log(Object.keys(ke[0] || {}).join(', '));
}
main().catch(e => { console.error('ERR', e.message); process.exit(1); });
