/**
 * TEMPORARY diagnostic (deleted after the run).
 * Reads the authoritative ESPN numeric league id + canonical slug for every
 * supported competition from the league-specific scoreboard endpoint.
 */
import axios from 'axios';
const BASE = 'https://site.api.espn.com/apis/site/v2/sports/soccer';
const CODES = [
    'eng.1', 'eng.2', 'esp.1', 'ita.1', 'ger.1', 'ger.2', 'fra.1',
    'uefa.champions', 'uefa.europa', 'uefa.europa.conf',
    'ned.1', 'por.1', 'bel.1', 'sco.1', 'tur.1', 'sui.1', 'aut.1', 'den.1',
    'pol.1', 'pol.ekstraklasa', 'pol.extrakasa', 'pol.1.ekstraklasa',
];
async function main() {
    for (const code of CODES) {
        try {
            const res = await axios.get(`${BASE}/${code}/scoreboard`, { params: { dates: '20261024' }, timeout: 12000 });
            const l = res.data?.leagues?.[0];
            const events = res.data?.events?.length ?? 0;
            console.log(`  ${code.padEnd(22)} id=${String(l?.id).padEnd(6)} slug="${l?.slug}" name="${l?.name}" events=${events}`);
        }
        catch (e) {
            console.log(`  ${code.padEnd(22)} ERR ${e.response?.status ?? e.message}`);
        }
    }
}
main().catch((e) => { console.error('probe error:', e.message); process.exit(1); });
