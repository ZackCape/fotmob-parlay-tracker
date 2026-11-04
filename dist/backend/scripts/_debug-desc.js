import { DataProviderFactory } from '../src/providers/provider-factory.js';
import { config } from '../src/config/env.js';
import * as CP from '../src/discord/interactions.js';
(async () => {
    const f = new DataProviderFactory(config);
    const fx = await CP.fetchVerifiedFixtures(f, '2026-10-18', 'ALL');
    const p = new Map();
    for (const x of fx) {
        try {
            const d = await f.getMatchDetails(x.id);
            if (d?.marketPredictions)
                p.set(x.id, d.marketPredictions);
        }
        catch { /* ignore */ }
    }
    const payload = CP.buildFixturesPayload(fx, p, 'ALL', 1, null);
    const e = payload.embeds[0].toJSON();
    console.log('TITLE:', JSON.stringify(e.title));
    console.log('DESC:', JSON.stringify(e.description));
    console.log('FOOTER:', JSON.stringify(e.footer));
})();
