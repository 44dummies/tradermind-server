/**
 * Admin Logs Routes
 * View all system logs
 */

const express = require('express');
const router = express.Router();
const { supabase } = require('../../db/supabase');

/**
 * GET /admin/logs
 * Get all activity logs with filters
 */
router.get('/', async (req, res) => {
    try {
        const {
            type,
            level,
            userId,
            sessionId,
            startDate,
            endDate,
            limit = 100,
            offset = 0
        } = req.query;

        let query = supabase
            .from('trading_activity_logs')
            .select('*')
            .order('created_at', { ascending: false })
            .range(parseInt(offset), parseInt(offset) + parseInt(limit) - 1);

        if (type) {
            query = query.eq('action_type', type);
        }
        // Level support removed as column does not exist in new schema
        // if (level) {
        //     query = query.eq('action_details->>level', level); 
        // }
        if (userId) {
            query = query.eq('user_id', userId);
        }
        if (sessionId) {
            query = query.eq('session_id', sessionId);
        }
        if (startDate) {
            query = query.gte('created_at', startDate);
        }
        if (endDate) {
            query = query.lte('created_at', endDate);
        }

        const { data, error } = await query;

        if (error) throw error;

        res.json({ logs: data || [] });
    } catch (error) {
        console.error('Get logs error:', error);
        res.status(500).json({ error: 'Failed to fetch logs' });
    }
});

/**
 * GET /admin/logs/trades
 * Get trade-specific logs
 */
router.get('/trades', async (req, res) => {
    try {
        const { sessionId, userId, accountId, result, limit = 100, offset = 0 } = req.query;

        let query = supabase
            .from('trade_logs')
            .select('*')
            .order('created_at', { ascending: false })
            .range(parseInt(offset), parseInt(offset) + parseInt(limit) - 1);

        if (sessionId) {
            query = query.eq('session_id', sessionId);
        }
        if (userId) {
            query = query.eq('user_id', userId);
        }
        if (accountId) {
            query = query.eq('account_id', accountId);
        }
        if (result) {
            query = query.eq('result', result);
        }

        const { data, error } = await query;

        if (error) throw error;

        res.json({ trades: data || [] });
    } catch (error) {
        console.error('Get trade logs error:', error);
        res.status(500).json({ error: 'Failed to fetch trade logs' });
    }
});

/**
 * GET /admin/logs/errors
 * Get error logs only
 */
router.get('/errors', async (req, res) => {
    try {
        const { limit = 100, offset = 0 } = req.query;

        const { data, error } = await supabase
            .from('trading_activity_logs')
            .select('*')
            .eq('level', 'error')
            .order('created_at', { ascending: false })
            .range(parseInt(offset), parseInt(offset) + parseInt(limit) - 1);

        if (error) throw error;

        res.json({ errors: data || [] });
    } catch (error) {
        console.error('Get error logs error:', error);
        res.status(500).json({ error: 'Failed to fetch error logs' });
    }
});

/**
 * GET /admin/logs/signals
 * Get trading signal logs
 */
router.get('/signals', async (req, res) => {
    try {
        const { limit = 100, offset = 0 } = req.query;

        const { data, error } = await supabase
            .from('trading_activity_logs')
            .select('*')
            .eq('action_type', 'signal')
            .order('created_at', { ascending: false })
            .range(parseInt(offset), parseInt(offset) + parseInt(limit) - 1);

        if (error) throw error;

        res.json({ signals: data || [] });
    } catch (error) {
        console.error('Get signal logs error:', error);
        res.status(500).json({ error: 'Failed to fetch signal logs' });
    }
});

/**
 * GET /admin/logs/bot
 * Get bot activity logs
 */
router.get('/bot', async (req, res) => {
    try {
        const { limit = 100, offset = 0 } = req.query;

        const { data, error } = await supabase
            .from('trading_activity_logs')
            .select('*')
            .in('action_type', ['bot_start', 'bot_stop', 'bot_pause', 'bot_resume', 'bot_emergency_stop'])
            .order('created_at', { ascending: false })
            .range(parseInt(offset), parseInt(offset) + parseInt(limit) - 1);

        if (error) throw error;

        res.json({ logs: data || [] });
    } catch (error) {
        console.error('Get bot logs error:', error);
        res.status(500).json({ error: 'Failed to fetch bot logs' });
    }
});

/**
 * GET /admin/logs/types
 * Get available log types
 */
router.get('/types', async (req, res) => {
    try {
        res.json({
            types: [
                'bot_start',
                'bot_stop',
                'bot_pause',
                'bot_resume',
                'bot_emergency_stop',
                'signal',
                'trade_open',
                'trade_close',
                'tp_hit',
                'sl_hit',
                'user_joined',
                'user_removed',
                'session_created',
                'session_started',
                'session_ended',
                'notification_sent',
                'error',
                'warning'
            ],
            levels: ['info', 'warning', 'error', 'debug']
        });
    } catch (error) {
        res.status(500).json({ error: 'Failed to get log types' });
    }
});

module.exports = router;
