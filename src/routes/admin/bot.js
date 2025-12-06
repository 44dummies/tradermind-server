const express = require('express');
const router = express.Router();
const botManager = require('../../services/botManager');

/**
 * GET /admin/bot/status
 * Get current bot status
 */
router.get('/status', async (req, res) => {
    try {
        res.json(botManager.getState());
    } catch (error) {
        console.error('Get bot status error:', error);
        res.status(500).json({ error: 'Failed to get bot status' });
    }
});

/**
 * POST /admin/bot/start
 * Start the trading bot
 */
router.post('/start', async (req, res) => {
    try {
        const { sessionId } = req.body;
        if (!sessionId) {
            return res.status(400).json({ error: 'Session ID is required' });
        }
        const state = await botManager.startBot(sessionId);
        res.json({ success: true, message: 'Bot started', state });
    } catch (error) {
        console.error('Start bot error:', error);
        res.status(400).json({ error: error.message });
    }
});

/**
 * POST /admin/bot/stop
 * Stop the trading bot
 */
router.post('/stop', async (req, res) => {
    try {
        const state = await botManager.stopBot();
        res.json({ success: true, message: 'Bot stopped', state });
    } catch (error) {
        console.error('Stop bot error:', error);
        res.status(400).json({ error: error.message });
    }
});

/**
 * POST /admin/bot/pause
 * Pause trading
 */
router.post('/pause', async (req, res) => {
    try {
        const state = await botManager.pauseBot();
        res.json({ success: true, message: 'Bot paused', state });
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

/**
 * POST /admin/bot/resume
 * Resume trading
 */
router.post('/resume', async (req, res) => {
    try {
        const state = await botManager.resumeBot();
        res.json({ success: true, message: 'Bot resumed', state });
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

module.exports = router;

/**
 * GET /admin/bot/status
 * Get current bot status
 */
router.get('/status', async (req, res) => {
    try {
        res.json({
            isRunning: botState.isRunning,
            isPaused: botState.isPaused,
            startTime: botState.startTime,
            activeSessionId: botState.activeSessionId,
            uptime: botState.startTime ? Date.now() - botState.startTime : 0,
            tickConnectionCount: botState.tickConnections.size,
            accountConnectionCount: botState.accountConnections.size,
            lastSignal: botState.lastSignal,
            tradesExecuted: botState.tradesExecuted,
            recentErrors: botState.errors.slice(-10)
        });
    } catch (error) {
        console.error('Get bot status error:', error);
        res.status(500).json({ error: 'Failed to get bot status' });
    }
});

/**
 * POST /admin/bot/start
 * Start the trading bot
 */
router.post('/start', async (req, res) => {
    try {
        const { sessionId } = req.body;

        if (botState.isRunning) {
            return res.status(400).json({ error: 'Bot is already running' });
        }

        if (!sessionId) {
            return res.status(400).json({ error: 'Session ID is required' });
        }

        // Verify session exists and is valid
        const { data: session, error } = await supabase
            .from('trading_sessions_v2')
            .select('*')
            .eq('id', sessionId)
            .single();

        if (error || !session) {
            return res.status(404).json({ error: 'Session not found' });
        }

        if (session.status === 'running') {
            return res.status(400).json({ error: 'Session is already running' });
        }

        // Update session status
        await supabase
            .from('trading_sessions_v2')
            .update({
                status: 'running',
                started_at: new Date().toISOString()
            })
            .eq('id', sessionId);

        // Start the bot
        botState.isRunning = true;
        botState.isPaused = false;
        botState.startTime = Date.now();
        botState.activeSessionId = sessionId;
        botState.tradesExecuted = 0;
        botState.errors = [];

        // Reset executor guards and start signal worker
        tradeExecutor.paused = false;
        tradeExecutor.consecutiveLosses = 0;
        tradeExecutor.apiErrorCount = 0;
        await signalWorker.start(sessionId);

        // Log activity
        await supabase
            .from('activity_logs_v2')
            .insert({
                id: uuidv4(),
                type: 'bot_start',
                level: 'info',
                message: `Trading bot started by admin`,
                metadata: { sessionId, adminId: req.user.id },
                user_id: req.user.id,
                session_id: sessionId,
                created_at: new Date().toISOString()
            });

        res.json({
            success: true,
            message: 'Bot started successfully',
            status: {
                isRunning: true,
                sessionId,
                startTime: botState.startTime
            }
        });
    } catch (error) {
        console.error('Start bot error:', error);
        res.status(500).json({ error: 'Failed to start bot' });
    }
});

/**
 * POST /admin/bot/stop
 * Stop the trading bot gracefully
 */
router.post('/stop', async (req, res) => {
    try {
        if (!botState.isRunning) {
            return res.status(400).json({ error: 'Bot is not running' });
        }

        const sessionId = botState.activeSessionId;

        // Update session status
        if (sessionId) {
            await supabase
                .from('trading_sessions_v2')
                .update({
                    status: 'completed',
                    ended_at: new Date().toISOString()
                })
                .eq('id', sessionId);
        }

        // Stop signal worker
        signalWorker.stop();
        tradeExecutor.paused = true;

        // Close all connections
        for (const ws of botState.tickConnections.values()) {
            try { ws.close(); } catch (e) { }
        }
        for (const ws of botState.accountConnections.values()) {
            try { ws.close(); } catch (e) { }
        }

        // Log activity
        await supabase
            .from('activity_logs_v2')
            .insert({
                id: uuidv4(),
                type: 'bot_stop',
                level: 'info',
                message: `Trading bot stopped by admin`,
                metadata: {
                    sessionId,
                    adminId: req.user.id,
                    uptime: Date.now() - botState.startTime,
                    tradesExecuted: botState.tradesExecuted
                },
                user_id: req.user.id,
                session_id: sessionId,
                created_at: new Date().toISOString()
            });

        // Reset bot state
        botState = {
            isRunning: false,
            isPaused: false,
            startTime: null,
            activeSessionId: null,
            tickConnections: new Map(),
            accountConnections: new Map(),
            lastSignal: null,
            tradesExecuted: 0,
            errors: []
        };

        res.json({
            success: true,
            message: 'Bot stopped successfully'
        });
    } catch (error) {
        console.error('Stop bot error:', error);
        res.status(500).json({ error: 'Failed to stop bot' });
    }
});

/**
 * POST /admin/bot/pause
 * Pause the trading bot
 */
router.post('/pause', async (req, res) => {
    try {
        if (!botState.isRunning) {
            return res.status(400).json({ error: 'Bot is not running' });
        }

        botState.isPaused = true;
        tradeExecutor.paused = true;

        res.json({
            success: true,
            message: 'Bot paused'
        });
    } catch (error) {
        console.error('Pause bot error:', error);
        res.status(500).json({ error: 'Failed to pause bot' });
    }
});

/**
 * POST /admin/bot/resume
 * Resume the trading bot
 */
router.post('/resume', async (req, res) => {
    try {
        if (!botState.isRunning) {
            return res.status(400).json({ error: 'Bot is not running' });
        }

        if (!botState.isPaused) {
            return res.status(400).json({ error: 'Bot is not paused' });
        }

        botState.isPaused = false;
        tradeExecutor.paused = false;

        res.json({
            success: true,
            message: 'Bot resumed'
        });
    } catch (error) {
        console.error('Resume bot error:', error);
        res.status(500).json({ error: 'Failed to resume bot' });
    }
});

/**
 * POST /admin/bot/override
 * Emergency stop - immediately halt all trading
 */
router.post('/override', async (req, res) => {
    try {
        const sessionId = botState.activeSessionId;

        // Immediately close all connections
        for (const ws of botState.tickConnections.values()) {
            try { ws.close(); } catch (e) { }
        }
        for (const ws of botState.accountConnections.values()) {
            try { ws.close(); } catch (e) { }
        }

        // Stop signal worker and pause executor
        signalWorker.stop();
        tradeExecutor.paused = true;

        // Update session status
        if (sessionId) {
            await supabase
                .from('trading_sessions_v2')
                .update({
                    status: 'cancelled',
                    ended_at: new Date().toISOString()
                })
                .eq('id', sessionId);
        }

        // Log emergency stop
        await supabase
            .from('activity_logs_v2')
            .insert({
                id: uuidv4(),
                type: 'bot_emergency_stop',
                level: 'warning',
                message: `EMERGENCY STOP triggered by admin`,
                metadata: {
                    sessionId,
                    adminId: req.user.id,
                    reason: req.body.reason || 'Manual override'
                },
                user_id: req.user.id,
                session_id: sessionId,
                created_at: new Date().toISOString()
            });

        // Reset bot state
        botState = {
            isRunning: false,
            isPaused: false,
            startTime: null,
            activeSessionId: null,
            tickConnections: new Map(),
            accountConnections: new Map(),
            lastSignal: null,
            tradesExecuted: 0,
            errors: []
        };

        res.json({
            success: true,
            message: 'Emergency stop executed - all trading halted'
        });
    } catch (error) {
        console.error('Override error:', error);
        res.status(500).json({ error: 'Failed to execute emergency stop' });
    }
});

// Export bot state for use by other services
module.exports = router;
module.exports.getBotState = () => botState;
module.exports.setBotState = (newState) => { botState = { ...botState, ...newState }; };
