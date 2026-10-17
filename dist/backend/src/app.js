import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { PredictionRepository, ParlayRepository } from './database/repositories.js';
import { createFixturesRouter } from './routes/fixtures.js';
import { createAnalysisRouter } from './routes/analysis.js';
import { createParlaysRouter } from './routes/parlays.js';
import { createPredictionsRouter } from './routes/predictions.js';
import { createPerformanceRouter } from './routes/performance.js';
import { createStatusRouter } from './routes/status.js';
import { createDiscordRouter } from './routes/discord.js';
import { LiveParlayTrackerService } from './parlays/live-tracker.js';
export function createApp(factory, discordBot, trackerService) {
    const app = express();
    // Middleware
    app.use(cors());
    app.use(express.json());
    // Repositories & Tracker
    const predRepo = new PredictionRepository();
    const parlayRepo = new ParlayRepository();
    const tracker = trackerService || new LiveParlayTrackerService(factory);
    // API Routes
    app.use('/api/fixtures', createFixturesRouter(factory));
    app.use('/api/analysis', createAnalysisRouter(factory));
    app.use('/api/parlays', createParlaysRouter(factory, parlayRepo, tracker));
    app.use('/api/predictions', createPredictionsRouter(factory, predRepo));
    app.use('/api/model/performance', createPerformanceRouter(factory));
    app.use('/api/system/status', createStatusRouter(factory));
    app.use('/api/discord', createDiscordRouter(discordBot));
    // Serve static client build if present (for single-container production deployment)
    const clientBuildPath = path.resolve(process.cwd(), 'dist', 'client');
    if (fs.existsSync(clientBuildPath)) {
        app.use(express.static(clientBuildPath));
        app.use((req, res, next) => {
            if (!req.path.startsWith('/api') && req.method === 'GET') {
                return res.sendFile(path.join(clientBuildPath, 'index.html'), err => {
                    if (err)
                        next();
                });
            }
            next();
        });
    }
    // Global error handler
    app.use((err, req, res, next) => {
        console.error('[App Error]', err);
        res.status(err.status || 500).json({
            error: err.message || 'Internal Server Error',
        });
    });
    return app;
}
