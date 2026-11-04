/**
 * Cape Predictor — Live Stream & SSE Endpoint Router
 *
 * Exposes GET /api/live/stream (Server-Sent Events) for real-time momentum
 * updates, incident timelines (goals, VAR rollbacks, red cards), pressure
 * squeeze radar alerts, and in-play odds shifts.
 */
import { Router } from 'express';
import { onLiveEvent, offLiveEvent, } from '../services/instantStreamService.js';
import { getAllLiveMatches, getLiveMatch, } from '../services/liveTrackingService.js';
export function createLiveStreamRouter() {
    const router = Router();
    /**
     * GET /api/live/stream
     * Persistent SSE connection for live match events, momentum updates,
     * VAR incident notifications, and pressure squeeze alerts.
     */
    router.get('/stream', (req, res) => {
        // SSE Headers
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache, no-transform');
        res.setHeader('Connection', 'keep-alive');
        res.setHeader('X-Accel-Buffering', 'no');
        if (typeof res.flushHeaders === 'function') {
            res.flushHeaders();
        }
        // Initial connection frame
        const connectedPayload = {
            status: 'connected',
            timestamp: Date.now(),
            activeMatches: getAllLiveMatches().length,
        };
        res.write(`event: connected\ndata: ${JSON.stringify(connectedPayload)}\n\n`);
        // Periodic 15-second keepalive comment to prevent proxy timeouts
        const keepaliveTimer = setInterval(() => {
            try {
                res.write(':keepalive\n\n');
            }
            catch {
                clearInterval(keepaliveTimer);
            }
        }, 15000);
        // Event listener attached to instantStreamService EventEmitter bus
        const eventListener = (payload) => {
            try {
                const eventName = payload.type.toLowerCase();
                res.write(`event: ${eventName}\ndata: ${JSON.stringify(payload)}\n\n`);
            }
            catch (err) {
                console.warn('[SSE] Failed to write event frame to client:', err);
            }
        };
        onLiveEvent(eventListener);
        // Cleanup when client disconnects
        req.on('close', () => {
            clearInterval(keepaliveTimer);
            offLiveEvent(eventListener);
            res.end();
        });
    });
    /**
     * GET /api/live/matches
     * Returns current active live matches with momentum and incident history.
     */
    router.get('/matches', (_req, res) => {
        const matches = getAllLiveMatches();
        res.json({
            timestamp: Date.now(),
            count: matches.length,
            matches,
        });
    });
    /**
     * GET /api/live/tracker/:fixtureId
     * Returns current in-play snapshot, momentum history, and timeline for a single match.
     */
    router.get('/tracker/:fixtureId', (req, res) => {
        const fixtureId = String(req.params.fixtureId);
        const match = getLiveMatch(fixtureId);
        if (!match) {
            return res.status(404).json({
                error: 'Fixture not active or currently tracked',
                fixtureId,
            });
        }
        res.json({ match });
    });
    return router;
}
