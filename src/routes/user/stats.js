/**
 * User Stats Routes
 * Personal trading statistics only
 */

const express = require('express');
const router = express.Router();
const { supabase } = require('../../db/supabase');

/**
 * GET /user/stats
 * Get personal trading statistics
 */
router.get('/', async (req, res) => {
    try {
        const userId = req.user.id;
        const { sessionId } = req.query;

        // Build query for user's trades
        let query = supabase
            .from('trade_logs')
            .select('*')
            .eq('user_id', userId);

        if (sessionId) {
            query = query.eq('session_id', sessionId);
        }

        const { data: trades, error } = await query;

        if (error) throw error;

        // Calculate statistics
        const completedTrades = (trades || []).filter(t => t.result !== 'pending');
        const wins = completedTrades.filter(t => t.result === 'won');
        const losses = completedTrades.filter(t => t.result === 'lost');

        const totalProfit = completedTrades.reduce((sum, t) => sum + (t.profit || 0), 0);
        const totalStake = completedTrades.reduce((sum, t) => sum + (t.stake || 0), 0);

        // Get session participation history
        const { data: sessions } = await supabase
            .from('session_participants')
            .select('session_id, status, current_pnl, tp, sl, accepted_at, removed_at, removal_reason, trading_sessions_v2(name, type)')
            .eq('user_id', userId)
            .order('accepted_at', { ascending: false })
            .limit(10);

        res.json({
            totalTrades: trades?.length || 0,
            completedTrades: completedTrades.length,
            wins: wins.length,
            losses: losses.length,
            winRate: completedTrades.length > 0 ? (wins.length / completedTrades.length) * 100 : 0,
            totalProfit,
            totalStake,
            roi: totalStake > 0 ? (totalProfit / totalStake) * 100 : 0,
            recentSessions: (sessions || []).map(s => ({
                sessionId: s.session_id,
                sessionName: s.trading_sessions_v2?.name,
                sessionType: s.trading_sessions_v2?.type,
                status: s.status,
                pnl: s.current_pnl,
                tp: s.tp,
                sl: s.sl,
                joinedAt: s.accepted_at,
                leftAt: s.removed_at,
                reason: s.removal_reason
            }))
        });
    } catch (error) {
        console.error('Get user stats error:', error);
        res.status(500).json({ error: 'Failed to fetch statistics' });
    }
});

/**
 * GET /user/stats/trades
 * Get personal trade history
 */
router.get('/trades', async (req, res) => {
    try {
        const userId = req.user.id;
        const { limit = 50, offset = 0, sessionId } = req.query;

        let query = supabase
            .from('trade_logs')
            .select('*')
            .eq('user_id', userId)
            .order('created_at', { ascending: false })
            .range(parseInt(offset), parseInt(offset) + parseInt(limit) - 1);

        if (sessionId) {
            query = query.eq('session_id', sessionId);
        }

        const { data, error } = await query;

        if (error) throw error;

        res.json({ trades: data || [] });
    } catch (error) {
        console.error('Get user trades error:', error);
        res.status(500).json({ error: 'Failed to fetch trades' });
    }
});

module.exports = router;
