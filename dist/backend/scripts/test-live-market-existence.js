import { buildStatisticalParlay } from '../src/parlays/parlay-builder.js';
let failures = 0;
let checks = 0;
function check(label, condition, detail) {
    checks++;
    if (condition)
        console.log(`  PASS  ${label}`);
    else {
        failures++;
        console.log(`  FAIL  ${label}${detail ? ` -> ${detail}` : ''}`);
    }
}
function section(title) {
    console.log(`\n${'='.repeat(70)}\n${title}\n${'='.repeat(70)}`);
}
function prediction(fixtureId, league, market, probability) {
    return {
        id: `${fixtureId}-${market}`,
        fixtureId,
        league: league,
        fixtureDescription: `Fixture ${fixtureId}`,
        kickoff: '15:00:00Z',
        market: market,
        marketLabel: 'Market',
        selection: `Selection ${market}`,
        estimatedProbability: probability,
        rawProbability: probability,
        confidenceLower: probability - 0.05,
        confidenceUpper: probability + 0.05,
        supportingStatistics: {
            homeGoalAverageLast5: 1.5, awayGoalAverageLast5: 1.2, homeConcededAverageLast5: 1.0,
            awayConcededAverageLast5: 1.1, homeXgAverage: 1.4, awayXgAverage: 1.1, bttsFrequencyLast10: 0.5,
            over25FrequencyLast10: 0.5, h2hSummary: 'H2H', cleanSheetRateHome: 0.3, cleanSheetRateAway: 0.2,
        },
        sampleSize: 10,
        dataFreshnessDays: 1,
        riskFactors: [],
        actualOutcome: 'PENDING',
    };
}
section('1) Bookmaker-verified line filter');
{
    // Scenario: bookmaker only publishes Over 1.5 and Over 2.5 (no Over 0.5)
    const publishedMarkets = ['HOME_WIN', 'DRAW', 'AWAY_WIN', 'OVER_1_5', 'OVER_2_5', 'BTTS_YES', 'OVER_8_5_CORNERS'];
    const candidates = [
        prediction('monaco-1', 'LIGUE1', 'OVER_0_5', 0.95), // Not published - should be filtered
        prediction('monaco-1', 'LIGUE1', 'OVER_1_5', 0.75), // Published - should pass
        prediction('monaco-1', 'LIGUE1', 'OVER_2_5', 0.65), // Published - should pass
        prediction('monaco-1', 'LIGUE1', 'BTTS_YES', 0.70), // Published - should pass
    ];
    const parlay = await buildStatisticalParlay(candidates, {
        targetLegsCount: 5,
        minProbability: 0.5,
        publishedMarkets,
    });
    check('Over 0.5 Goals excluded (not published)', !parlay.legs.some((l) => l.market === 'OVER_0_5'), JSON.stringify(parlay.legs.map((l) => l.market)));
    check('Over 1.5 Goals included (published)', parlay.legs.some((l) => l.market === 'OVER_1_5'), JSON.stringify(parlay.legs.map((l) => l.market)));
    check('no unlisted markets in output', parlay.legs.every((l) => publishedMarkets.includes(l.market)), JSON.stringify(parlay.legs.map((l) => l.market)));
}
section('2) Sub-1.15x micro-odds rejected');
{
    const publishedMarkets = ['HOME_WIN', 'OVER_1_5', 'OVER_2_5'];
    const candidates = [
        prediction('micro-1', 'EPL', 'HOME_WIN', 0.95), // 1.05x - below 1.15, should be filtered
        prediction('good-1', 'EPL', 'HOME_WIN', 0.65), // 1.54x - should pass
        prediction('good-2', 'EPL', 'OVER_1_5', 0.60), // 1.67x - should pass
        prediction('good-3', 'EPL', 'OVER_2_5', 0.55), // 1.82x - should pass
    ];
    const parlay = await buildStatisticalParlay(candidates, {
        targetLegsCount: 5,
        minProbability: 0.5,
        publishedMarkets,
    });
    check('micro-odds (1.05x) excluded', !parlay.legs.some((l) => l.fixtureId === 'micro-1'), JSON.stringify(parlay.legs.map((l) => l.fixtureId)));
    check('valid odds legs included', parlay.legs.length >= 2, String(parlay.legs.length));
}
section('3) Unlisted lines default to available bookmaker lines');
{
    // When Over 0.5 is not published, system falls back to Over 1.5
    const publishedMarkets = ['HOME_WIN', 'OVER_1_5', 'OVER_2_5', 'BTTS_YES'];
    const candidates = [
        prediction('fallback-1', 'EPL', 'OVER_0_5', 0.90), // Not published
        prediction('fallback-1', 'EPL', 'OVER_1_5', 0.70), // Published
        prediction('fallback-1', 'EPL', 'OVER_2_5', 0.55), // Published
        prediction('fallback-1', 'EPL', 'BTTS_YES', 0.65), // Published
    ];
    const parlay = await buildStatisticalParlay(candidates, {
        targetLegsCount: 5,
        minProbability: 0.5,
        publishedMarkets,
    });
    check('Over 0.5 excluded (unlisted)', !parlay.legs.some((l) => l.market === 'OVER_0_5'), JSON.stringify(parlay.legs.map((l) => l.market)));
    check('Over 1.5 included (listed)', parlay.legs.some((l) => l.market === 'OVER_1_5'), JSON.stringify(parlay.legs.map((l) => l.market)));
}
section('4) No publishedMarkets = all markets allowed (backwards compat)');
{
    const candidates = [
        prediction('compat-1', 'EPL', 'OVER_0_5', 0.90),
        prediction('compat-1', 'EPL', 'OVER_1_5', 0.70),
    ];
    const parlay = await buildStatisticalParlay(candidates, {
        targetLegsCount: 5,
        minProbability: 0.5,
    });
    check('all markets allowed without publishedMarkets', parlay.legs.length > 0, String(parlay.legs.length));
}
section('SUMMARY');
console.log(`checks run : ${checks}`);
console.log(`failures   : ${failures}`);
if (failures > 0) {
    console.error(`\nBOOKMAKER-VERIFIED LINES VERIFICATION FAILED (${failures} check(s))`);
    process.exit(1);
}
console.log('\nBOOKMAKER-VERIFIED LINES VERIFICATION PASSED');
