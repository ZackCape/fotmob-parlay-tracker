/**
 * TEMPORARY diagnostic (deleted after the run).
 * Enumerates ESPN's soccer league directory (with lang=en) and prints the
 * entries for Poland / Switzerland / Denmark / Belgium to find real slugs.
 */
import axios from 'axios';
const CORE = 'https://sports.core.api.espn.com/v2/sports/soccer/leagues';
async function main() {
    try {
        const index = await axios.get('https://site.api.espn.com/apis/site/v2/sports/soccer/leagues', { timeout: 15000 });
        console.log('site leagues index:', JSON.stringify(index.data).substring(0, 300));
    }
    catch (e) {
        console.log('site leagues index ERR', e.response?.status ?? e.message);
    }
    const res = await axios.get(CORE, { params: { limit: 500, lang: 'en' }, timeout: 25000 });
    const refs = (res.data?.items || []).map((i) => String(i.$ref || ''));
    const withLang = refs.map((r) => `${r}${r.includes('?') ? '&' : '?'}lang=en`);
    console.log(`\n${withLang.length} directory entries`);
    const found = [];
    const BATCH = 20;
    for (let i = 0; i < withLang.length; i += BATCH) {
        const batch = withLang.slice(i, i + BATCH);
        const settled = await Promise.allSettled(batch.map((u) => axios.get(u, { timeout: 12000 })));
        settled.forEach((s) => {
            if (s.status !== 'fulfilled')
                return;
            const d = s.value.data;
            const name = String(d?.name || '');
            const slug = String(d?.slug || '');
            if (/poland|ekstraklasa|swiss|denmark|belgi|superliga|eredivisie|primeira/i.test(`${name} ${slug}`)) {
                found.push(`slug="${slug}" id=${d?.id} name="${name}"`);
            }
        });
    }
    console.log('\nmatched directory entries:');
    for (const f of found.sort())
        console.log(`  ${f}`);
}
main().catch((e) => { console.error('probe error:', e.message); process.exit(1); });
