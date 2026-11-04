import { Router } from 'express';
import { buildStatisticalParlay } from '../parlays/parlay-builder.js';
import { filterPreKickoffFixtures } from '../discord/fixtureStatus.js';
import { orderFixturesByPriority } from '../utils/competitionPriority.js';
export function createParlaysRouter(factory, parlayRepo, trackerService) {
    const router = Router();
    /**
     * POST /api/parlays/generate
     *
     * Only matches that have not kicked off can carry a leg. Finished
     * (FT / AET / PEN / FINISHED), in-play (LIVE / IN_PLAY), halted (HT / PAUSED)
     * and postponed fixtures are all rejected, and the scheduled kick-off must
     * still be in the future — so a leg can never settle against a score the user
     * never had a chance to bet on.
     *
     * Candidates are ranked Premier League and UEFA Champions League first, so
     * the priority fixtures lead the pool (and the response) ahead of the
     * secondary domestic leagues.
     */
    router.post('/generate', async (req, res) => {
        try {
            const { date = new Date().toISOString().substring(0, 10), legsCount = 5, minProbability = 0.58, allowedMarkets, leagueFilter = 'ALL', mode = 'ANTI_CORRELATED', targetFixtureId, prioritizePriorityLeagues = true, } = req.body;
            const validLegCounts = [5, 10, 15, 20, 25];
            if (!validLegCounts.includes(legsCount)) {
                return res.status(400).json({ error: `Invalid legsCount. Must be one of: 5, 10, 15, 20, 25` });
            }
            // Fetch fixtures on that date, then keep only pre-kickoff matches, ranked
            // with the Premier League and Champions League at the top of the slate.
            const allFixtures = await factory.getFixturesByDate(date, leagueFilter);
            const fixtures = orderFixturesByPriority(filterPreKickoffFixtures(allFixtures), prioritizePriorityLeagues !== false);
            // Collect candidate predictions
            const candidatePredictions = [];
            for (const fx of fixtures) {
                const details = await factory.getMatchDetails(fx.id);
                if (details && details.marketPredictions) {
                    candidatePredictions.push(...details.marketPredictions);
                }
            }
            // Build statistical parlay with requested correlation mode (Anti-Correlated, SGP, or Correlated Allowed)
            const parlay = await buildStatisticalParlay(candidatePredictions, {
                targetLegsCount: legsCount,
                minProbability: parseFloat(minProbability),
                allowedMarkets,
                leagueFilter,
                mode,
                targetFixtureId,
                prioritizePriorityLeagues: prioritizePriorityLeagues !== false,
            });
            // Only persist and track a parlay that actually has legs; an empty slate
            // (every match already started) must not create an empty tracked record.
            if (parlay.legs.length > 0) {
                await parlayRepo.saveParlay(parlay);
                await trackerService.trackParlay(parlay);
            }
            return res.json(parlay);
        }
        catch (err) {
            console.error('[ParlaysRouter] Error generating parlay:', err);
            return res.status(500).json({ error: 'Failed to generate statistical parlay', details: err.message });
        }
    });
    /**
     * POST /api/parlays/track
     * Register a custom or saved parlay for live motion tracking
     */
    router.post('/track', async (req, res) => {
        try {
            const parlay = (req.body?.parlay || req.body);
            if (!parlay || !parlay.legs) {
                return res.status(400).json({ error: 'Invalid parlay object payload' });
            }
            const tracked = await trackerService.trackParlay(parlay);
            return res.json({ tracked, ...tracked });
        }
        catch (err) {
            return res.status(500).json({ error: 'Failed to track parlay', details: err.message });
        }
    });
    /**
     * GET /api/parlays/live
     * Returns all currently active live tracked parlays
     */
    router.get('/live', async (_req, res) => {
        try {
            const tracked = trackerService.getTrackedParlays();
            return res.json({ count: tracked.length, parlays: tracked, activeParlays: tracked });
        }
        catch (err) {
            return res.status(500).json({ error: 'Failed to get live tracked parlays', details: err.message });
        }
    });
    /**
     * GET /api/parlays/live/:id
     * Returns live movement and status for a specific parlay
     */
    router.get('/live/:id', async (req, res) => {
        try {
            const parlayId = req.params.id;
            const tracked = await trackerService.evaluateParlayProgress(parlayId);
            return res.json({ tracked, ...tracked });
        }
        catch (err) {
            return res.status(404).json({ error: 'Tracked parlay not found or evaluation failed', details: err.message });
        }
    });
    /**
     * POST /api/parlays/live/:id/tick
     * Advances simulated live match ticker to test visual motion
     */
    router.post('/live/:id/tick', async (req, res) => {
        try {
            const parlayId = req.params.id;
            const updated = await trackerService.advanceSimulationTick(parlayId);
            return res.json({ tracked: updated, ...updated });
        }
        catch (err) {
            return res.status(500).json({ error: 'Failed to advance simulation tick', details: err.message });
        }
    });
    /**
     * GET /api/parlays/history
     */
    router.get('/history', async (_req, res) => {
        try {
            const history = await parlayRepo.getRecentParlays();
            return res.json({ count: history.length, parlays: history });
        }
        catch (err) {
            return res.status(500).json({ error: 'Failed to retrieve parlay history', details: err.message });
        }
    });
    return router;
}
