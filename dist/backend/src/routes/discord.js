import { Router } from 'express';
export function createDiscordRouter(botService) {
    const router = Router();
    /**
     * GET /api/discord/status
     */
    router.get('/status', (req, res) => {
        return res.json(botService.getStatus());
    });
    /**
     * POST /api/discord/broadcast
     * Triggers an immediate hourly update broadcast test
     */
    router.post('/broadcast', async (req, res) => {
        try {
            const result = await botService.sendHourlyUpdate();
            return res.json(result);
        }
        catch (err) {
            return res.status(500).json({ success: false, message: err.message });
        }
    });
    /**
     * POST /api/discord/configure
     * Updates broadcast channel and frequency interval (5m, 15m, 30m, 45m, 1h)
     */
    router.post('/configure', (req, res) => {
        try {
            const { channelId, interval } = req.body;
            botService.setBroadcastConfig(channelId, interval);
            return res.json({ success: true, status: botService.getStatus() });
        }
        catch (err) {
            return res.status(500).json({ success: false, message: err.message });
        }
    });
    return router;
}
