/**
 * TEMPORARY verification harness (deleted after the run).
 *
 * Hits the real ESPN public scoreboard through the real DataProviderFactory and
 * proves that (a) the newly registered competitions are no longer dropped, and
 * (b) a league-filtered request returns only that competition.
 */
import { DataProviderFactory } from '../src/providers/provider-factory.js';
import { config } from '../src/config/env.js';
import { filterPreKickoffFixtures } from '../src/discord/fixtureStatus.js';
const EXPANDED = [
    'EREDIVISIE', 'EKSTRAKLASA', 'PRIMEIRA_LIGA', 'PRO_LEAGUE', 'SCOTTISH_PREM',
    'CHAMPIONSHIP', 'SUPER_LIG', 'SWISS_SUPER', 'AUSTRIAN_BUNDESLIGA', 'DANISH_SUPERLIGA',
];
const iso = (ms) => new Date(ms).toISOString().substring(0, 10);
async function main() {
    const factory = new DataProviderFactory(config);
    const today = Date.now();
    const seen = new Map();
    const perLeagueFixtures = new Map();
    for (let d = 0; d < 7; d++) {
        const date = iso(today + d * 24 * 3600_000);
        const fixtures = await factory.getFixturesByDate(date, 'ALL');
        console.log(`${date}: ${fixtures.length} fixtures`);
        for (const f of fixtures) {
            seen.set(f.league, (seen.get(f.league) ?? 0) + 1);
            if (!perLeagueFixtures.has(f.league))
                perLeagueFixtures.set(f.league, []);
            perLeagueFixtures.get(f.league).push(f);
        }
    }
    console.log('\n--- leagues observed over the next 7 days ---');
    const observed = [...seen.entries()].sort((a, b) => b[1] - a[1]);
    for (const [league, count] of observed)
        console.log(`  ${league.padEnd(22)} ${count}`);
    let failures = 0;
    const check = (label, ok, extra = '') => {
        console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? ` — ${extra}` : ''}`);
        if (!ok)
            failures++;
    };
    console.log('\n--- expanded competitions actually resolved ---');
    const resolved = EXPANDED.filter((l) => seen.has(l));
    for (const l of resolved) {
        console.log(`  observed ${l} (${seen.get(l)} fixtures)`);
    }
    if (resolved.length === 0) {
        console.log('  (none of the expanded leagues play in the next 7 days)');
    }
    console.log('\n--- fixture identity spot-check (guards against a wrong slug mapping) ---');
    for (const league of resolved) {
        const samples = (perLeagueFixtures.get(league) ?? []).slice(0, 6);
        for (const f of samples) {
            console.log(`  ${league.padEnd(22)} ${f.homeTeam?.name} v ${f.awayTeam?.name}  [${f.date}]`);
        }
    }
    // A league-filtered request must never answer with a different competition.
    console.log('\n--- league filter isolation (all 19 competitions) ---');
    const ALL_LEAGUES = [...EXPANDED, 'EPL', 'LALIGA', 'SERIE_A', 'LIGUE1', 'BUNDESLIGA', 'BUNDESLIGA2', 'CHAMPIONS_LEAGUE', 'EUROPA_LEAGUE', 'CONFERENCE_LEAGUE'];
    for (const league of ALL_LEAGUES) {
        const want = perLeagueFixtures.get(league) ?? [];
        if (want.length === 0)
            continue;
        const date = want[0].date;
        const filtered = await factory.getFixturesByDate(date, league);
        const pure = filtered.every((f) => f.league === league);
        check(`${league} filter returns only ${league}`, pure, `${filtered.length} fixtures` + (pure ? '' : ` got ${JSON.stringify([...new Set(filtered.map((f) => f.league))])}`));
    }
    // The pre-kickoff guardrail must behave identically for the new leagues.
    if (resolved.length > 0) {
        console.log('\n--- pre-kickoff guardrail on live data ---');
        for (const league of resolved) {
            const fixtures = (perLeagueFixtures.get(league) ?? []);
            const kept = filterPreKickoffFixtures(fixtures);
            const statuses = fixtures.map((f) => f.status);
            const keptStatuses = [...new Set(kept.map((f) => f.status))];
            check(`${league}: no finished/live fixture survives the guard`, kept.every((f) => f.status === 'TIMED' && new Date(f.kickoffTime).getTime() > Date.now()), `${fixtures.length} in / ${kept.length} kept (kept statuses: ${JSON.stringify(keptStatuses)}, source statuses: ${JSON.stringify([...new Set(statuses)])})`);
        }
    }
    console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
    process.exit(failures === 0 ? 0 : 1);
}
main().catch((e) => {
    console.error('harness error:', e);
    process.exit(2);
});
