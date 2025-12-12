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
        // If bot is already stopped, return success instead of error
        if (error.message === 'Bot is not running') {
            res.json({ success: true, message: 'Bot already stopped', state: botManager.getState() });
        } else {
            console.error('Stop bot error:', error);
            res.status(400).json({ error: error.message });
        }
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

/**
 * POST /admin/bot/override
 * Emergency stop - immediately halt all trading
 */
router.post('/override', async (req, res) => {
    try {
        const { reason } = req.body;

        // Force stop regardless of current state
        const state = await botManager.emergencyStop(reason);

        console.log(`[Bot] EMERGENCY STOP executed. Reason: ${reason || 'Manual override'}`);

        res.json({
            success: true,
            message: 'Emergency stop executed - all trading halted',
            state
        });
    } catch (error) {
        console.error('Emergency stop error:', error);
        res.status(500).json({ error: 'Failed to execute emergency stop' });
    }
});

module.exports = router;
