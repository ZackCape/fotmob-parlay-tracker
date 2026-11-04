/**
 * TEMPORARY diagnostic (deleted after the run).
 * Looks up the real ESPN soccer league slugs so a wrong code (e.g. pol.1) can be
 * corrected from evidence instead of guesswork.
 */
import axios from 'axios';
const CORE = 'https://sports.core.api.espn.com/v2/sports/soccer/leagues';
async function main() {
    const res = await axios.get(CORE, { params: { limit: 500 }, timeout: 20000 });
    const items = res.data?.items || [];
    const refs = items.map((i) => String(i.$ref || ''));
    console.log(`${refs.length} leagues in the ESPN soccer directory\n`);
    const interesting = /pol|sui|den|bel|ned|por|sco|tur|aut|eng|esp|ita|ger|fra|champ|league/i;
    for (const ref of refs) {
        const code = ref.match(/leagues\/(?:[a-z]+\.)?([a-z0-9_.]+)\?/)?.[1] || ref.split('/').pop()?.split('?')[0] || '';
        if (!interesting.test(code))
            continue;
        try {
            const one = await axios.get(ref, { timeout: 12000 });
            const name = one.data?.name || '';
            const slug = one.data?.slug || '';
            console.log(`  ${String(code).padEnd(22)} slug="${slug}" name="${name}"`);
        }
        catch {
            console.log(`  ${String(code).padEnd(22)} (unreadable)`);
        }
    }
}
main().catch((e) => { console.error('probe error:', e.message); process.exit(1); });
