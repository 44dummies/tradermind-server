/**
 * Admin Stats Routes
 * Full analytics and statistics
 */

const express = require('express');
const router = express.Router();
const { supabase } = require('../../db/supabase');
const signalWorker = require('../../services/signalWorker');

/**
 * GET /admin/stats/live
 * Get live market analysis from SignalWorker
 */
router.get('/live', (req, res) => {
    try {
        const stats = signalWorker.getLatestStats();
        res.json({
            success: true,
            data: stats
        });
    } catch (error) {
        console.error('Live stats error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * GET /admin/stats
 * Get overall trading statistics
 */
router.get('/', async (req, res) => {
    try {
        const { sessionId, startDate, endDate } = req.query;

        // Build query for trades
        let tradesQuery = supabase
            .from('trade_logs')
            .select('*');

        if (sessionId) {
            tradesQuery = tradesQuery.eq('session_id', sessionId);
        }
        if (startDate) {
            tradesQuery = tradesQuery.gte('created_at', startDate);
        }
        if (endDate) {
            tradesQuery = tradesQuery.lte('created_at', endDate);
        }

        const { data: trades, error } = await tradesQuery;

        if (error) throw error;

        // Calculate statistics
        const completedTrades = (trades || []).filter(t => t.result !== 'pending');
        const wins = completedTrades.filter(t => t.result === 'won');
        const losses = completedTrades.filter(t => t.result === 'lost');

        const totalProfit = completedTrades.reduce((sum, t) => sum + (t.profit || 0), 0);
        const totalStake = completedTrades.reduce((sum, t) => sum + (t.stake || 0), 0);
        const avgProfit = completedTrades.length > 0 ? totalProfit / completedTrades.length : 0;

        // Calculate streaks
        let currentWinStreak = 0;
        let maxWinStreak = 0;
        let currentLossStreak = 0;
        let maxLossStreak = 0;

        completedTrades.forEach(t => {
            if (t.result === 'won') {
                currentWinStreak++;
                currentLossStreak = 0;
                maxWinStreak = Math.max(maxWinStreak, currentWinStreak);
            } else {
                currentLossStreak++;
                currentWinStreak = 0;
                maxLossStreak = Math.max(maxLossStreak, currentLossStreak);
            }
        });

        // Get session count
        const { count: sessionCount } = await supabase
            .from('trading_sessions_v2')
            .select('*', { count: 'exact', head: true });

        // Get active users count
        const { count: activeUsers } = await supabase
            .from('session_participants')
            .select('*', { count: 'exact', head: true })
            .eq('status', 'active');

        res.json({
            totalTrades: trades?.length || 0,
            completedTrades: completedTrades.length,
            pendingTrades: (trades?.length || 0) - completedTrades.length,
            wins: wins.length,
            losses: losses.length,
            winRate: completedTrades.length > 0 ? (wins.length / completedTrades.length) * 100 : 0,
            totalProfit,
            totalStake,
            avgProfit,
            roi: totalStake > 0 ? (totalProfit / totalStake) * 100 : 0,
            maxWinStreak,
            maxLossStreak,
            currentWinStreak,
            currentLossStreak,
            sessionCount: sessionCount || 0,
            activeUsers: activeUsers || 0
        });
    } catch (error) {
        console.error('Get stats error:', error);
        res.status(500).json({ error: 'Failed to fetch statistics' });
    }
});

/**
 * GET /admin/stats/accounts
 * Get per-account performance
 */
router.get('/accounts', async (req, res) => {
    try {
        const { sessionId, limit = 50 } = req.query;

        // Get trade stats grouped by account
        let query = supabase
            .from('trade_logs')
            .select('user_id, account_id, result, profit, stake');

        if (sessionId) {
            query = query.eq('session_id', sessionId);
        }

        const { data: trades, error } = await query;

        if (error) throw error;

        // Group by account
        const accountStats = {};

        (trades || []).forEach(t => {
            const key = t.account_id || t.user_id;
            if (!accountStats[key]) {
                accountStats[key] = {
                    accountId: t.account_id,
                    userId: t.user_id,
                    totalTrades: 0,
                    wins: 0,
                    losses: 0,
                    profit: 0,
                    stake: 0
                };
            }

            accountStats[key].totalTrades++;
            if (t.result === 'won') {
                accountStats[key].wins++;
            } else if (t.result === 'lost') {
                accountStats[key].losses++;
            }
            accountStats[key].profit += t.profit || 0;
            accountStats[key].stake += t.stake || 0;
        });

        // Convert to array and calculate rates
        const accounts = Object.values(accountStats)
            .map(a => ({
                ...a,
                winRate: a.totalTrades > 0 ? (a.wins / a.totalTrades) * 100 : 0,
                roi: a.stake > 0 ? (a.profit / a.stake) * 100 : 0
            }))
            .sort((a, b) => b.profit - a.profit)
            .slice(0, parseInt(limit));

        res.json({ accounts });
    } catch (error) {
        console.error('Get account stats error:', error);
        res.status(500).json({ error: 'Failed to fetch account statistics' });
    }
});

/**
 * GET /admin/stats/markets
 * Get per-market performance
 */
router.get('/markets', async (req, res) => {
    try {
        const { sessionId } = req.query;

        let query = supabase
            .from('trade_logs')
            .select('market, result, profit, stake');

        if (sessionId) {
            query = query.eq('session_id', sessionId);
        }

        const { data: trades, error } = await query;

        if (error) throw error;

        // Group by market
        const marketStats = {};

        (trades || []).forEach(t => {
            const market = t.market || 'Unknown';
            if (!marketStats[market]) {
                marketStats[market] = {
                    market,
                    totalTrades: 0,
                    wins: 0,
                    losses: 0,
                    profit: 0,
                    stake: 0
                };
            }

            marketStats[market].totalTrades++;
            if (t.result === 'won') {
                marketStats[market].wins++;
            } else if (t.result === 'lost') {
                marketStats[market].losses++;
            }
            marketStats[market].profit += t.profit || 0;
            marketStats[market].stake += t.stake || 0;
        });

        // Convert to array with rates
        const markets = Object.values(marketStats)
            .map(m => ({
                ...m,
                winRate: m.totalTrades > 0 ? (m.wins / m.totalTrades) * 100 : 0,
                roi: m.stake > 0 ? (m.profit / m.stake) * 100 : 0
            }))
            .sort((a, b) => b.totalTrades - a.totalTrades);

        res.json({ markets });
    } catch (error) {
        console.error('Get market stats error:', error);
        res.status(500).json({ error: 'Failed to fetch market statistics' });
    }
});

/**
 * GET /admin/stats/strategies
 * Get per-strategy performance
 */
router.get('/strategies', async (req, res) => {
    try {
        const { sessionId } = req.query;

        let query = supabase
            .from('trade_logs')
            .select('strategy, result, profit, stake, confidence');

        if (sessionId) {
            query = query.eq('session_id', sessionId);
        }

        const { data: trades, error } = await query;

        if (error) throw error;

        // Group by strategy
        const strategyStats = {};

        (trades || []).forEach(t => {
            const strategy = t.strategy || 'Unknown';
            if (!strategyStats[strategy]) {
                strategyStats[strategy] = {
                    strategy,
                    totalTrades: 0,
                    wins: 0,
                    losses: 0,
                    profit: 0,
                    stake: 0,
                    totalConfidence: 0
                };
            }

            strategyStats[strategy].totalTrades++;
            if (t.result === 'won') {
                strategyStats[strategy].wins++;
            } else if (t.result === 'lost') {
                strategyStats[strategy].losses++;
            }
            strategyStats[strategy].profit += t.profit || 0;
            strategyStats[strategy].stake += t.stake || 0;
            strategyStats[strategy].totalConfidence += t.confidence || 0;
        });

        // Convert to array with rates
        const strategies = Object.values(strategyStats)
            .map(s => ({
                ...s,
                winRate: s.totalTrades > 0 ? (s.wins / s.totalTrades) * 100 : 0,
                roi: s.stake > 0 ? (s.profit / s.stake) * 100 : 0,
                avgConfidence: s.totalTrades > 0 ? s.totalConfidence / s.totalTrades : 0
            }))
            .sort((a, b) => b.winRate - a.winRate);

        res.json({ strategies });
    } catch (error) {
        console.error('Get strategy stats error:', error);
        res.status(500).json({ error: 'Failed to fetch strategy statistics' });
    }
});

/**
 * GET /admin/stats/timeline
 * Get profit curve over time
 */
router.get('/timeline', async (req, res) => {
    try {
        const { sessionId, interval = 'hour' } = req.query;

        let query = supabase
            .from('trade_logs')
            .select('created_at, profit, result')
            .order('created_at', { ascending: true });

        if (sessionId) {
            query = query.eq('session_id', sessionId);
        }

        const { data: trades, error } = await query;

        if (error) throw error;

        // Build cumulative profit curve
        let cumulative = 0;
        const timeline = (trades || []).map((t, i) => {
            cumulative += t.profit || 0;
            return {
                index: i,
                timestamp: t.created_at,
                profit: t.profit || 0,
                cumulative,
                result: t.result
            };
        });

        res.json({ timeline });
    } catch (error) {
        console.error('Get timeline error:', error);
        res.status(500).json({ error: 'Failed to fetch timeline' });
    }
});

module.exports = router;
