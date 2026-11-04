import { Router } from 'express';
export function createNewsRouter(factory) {
    const router = Router();
    /**
     * GET /api/news
     * Returns authentic breaking European football news headlines and match previews
     * scraped directly from FootballDatabase.eu.
     */
    router.get('/', async (req, res) => {
        try {
            const articles = await factory.getLatestNews();
            return res.json({
                success: true,
                count: articles.length,
                articles,
            });
        }
        catch (err) {
            console.error('[NewsRouter] Failed to retrieve news:', err);
            return res.status(500).json({
                error: 'Failed to retrieve football news',
                details: err.message,
            });
        }
    });
    return router;
}
