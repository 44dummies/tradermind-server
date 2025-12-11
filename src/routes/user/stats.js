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

        // Build query for user's trades from activity logs
        let query = supabase
            .from('trading_activity_logs')
            .select('*')
            .eq('user_id', userId)
            .in('action_type', ['trade_won', 'trade_lost']);

        if (sessionId) {
            query = query.eq('session_id', sessionId);
        }

        const { data: trades, error } = await query;

        if (error) throw error;

        // Calculate statistics from activity logs
        const wins = (trades || []).filter(t => t.action_type === 'trade_won');
        const losses = (trades || []).filter(t => t.action_type === 'trade_lost');
        const completedTrades = trades || [];

        let totalProfit = 0;
        let totalStake = 0;
        completedTrades.forEach(t => {
            totalProfit += parseFloat(t.action_details?.profit) || 0;
            totalStake += parseFloat(t.action_details?.stake) || 0;
        });

        // Get session participation history
        const { data: sessions } = await supabase
            .from('session_participants')
            .select('session_id, status, current_pnl, tp, sl, accepted_at, removed_at, removal_reason, trading_sessions_v2(name, type)')
            .eq('user_id', userId)
            .order('accepted_at', { ascending: false })
            .limit(10);

        res.json({
            totalTrades: completedTrades.length,
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
            .from('trading_activity_logs')
            .select('*')
            .eq('user_id', userId)
            .in('action_type', ['trade_won', 'trade_lost', 'trade_opened', 'trade_closed'])
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
