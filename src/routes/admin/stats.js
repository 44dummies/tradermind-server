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
        const { sessionId, startDate, endDate, timeRange } = req.query;

        // Calculate date range based on timeRange (Default to 30d)
        let dateFilter = null;
        const range = timeRange || '30d';

        const now = new Date();
        if (range === '24h') {
            dateFilter = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
        } else if (range === '7d') {
            dateFilter = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
        } else if (range === '30d') {
            dateFilter = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
        }

        // Build query for trades from 'trade_logs' (V2 Table)
        let tradesQuery = supabase
            .from('trade_logs')
            .select('result, profit, stake, created_at, contract_id, metadata, confidence, contract_type')
            .neq('result', 'pending')
            .not('profit', 'is', null);

        if (sessionId) {
            tradesQuery = tradesQuery.eq('session_id', sessionId);
        }
        if (dateFilter || startDate) {
            tradesQuery = tradesQuery.gte('created_at', dateFilter || startDate);
        }
        if (endDate) {
            tradesQuery = tradesQuery.lte('created_at', endDate);
        }

        const { data: trades, error } = await tradesQuery.order('created_at', { ascending: true });

        if (error) throw error;

        // Calculate statistics
        // V2: result is 'win' or 'loss' (or 'closed' with profit > 0 or <= 0)
        const wins = (trades || []).filter(t => t.result === 'win' || parseFloat(t.profit) > 0);
        const losses = (trades || []).filter(t => t.result === 'loss' || parseFloat(t.profit) <= 0);
        const completedTrades = trades || [];

        let totalProfit = 0;
        completedTrades.forEach(t => {
            totalProfit += parseFloat(t.profit) || 0;
        });

        const avgProfit = completedTrades.length > 0 ? totalProfit / completedTrades.length : 0;

        // Calculate daily stats
        const dailyMap = {};
        completedTrades.forEach(t => {
            const date = new Date(t.created_at).toLocaleDateString('en-US', { weekday: 'short' });
            if (!dailyMap[date]) dailyMap[date] = { date, trades: 0, profit: 0, wins: 0 };
            dailyMap[date].trades++;
            if (t.result === 'win' || parseFloat(t.profit) > 0) dailyMap[date].wins++;
            dailyMap[date].profit += parseFloat(t.profit) || 0;
        });
        const dailyStats = Object.values(dailyMap).map(d => ({
            ...d,
            winRate: d.trades > 0 ? (d.wins / d.trades) * 100 : 0
        }));

        // Calculate contract stats
        const contractMap = {};
        completedTrades.forEach(t => {
            const type = t.contract_type || t.metadata?.type || 'DIGIT_DIFF';
            if (!contractMap[type]) contractMap[type] = { type, count: 0, wins: 0, profit: 0 };
            contractMap[type].count++;
            if (t.result === 'win' || parseFloat(t.profit) > 0) contractMap[type].wins++;
            contractMap[type].profit += parseFloat(t.profit) || 0;
        });
        const contractStats = Object.values(contractMap).map(c => ({
            ...c,
            winRate: c.count > 0 ? (c.wins / c.count) * 100 : 0
        }));

        // Best and worst day
        const dayProfits = Object.values(dailyMap).map(d => d.profit);
        const bestDay = dayProfits.length > 0 ? Math.max(...dayProfits) : 0;
        const worstDay = dayProfits.length > 0 ? Math.min(...dayProfits) : 0;

        res.json({
            success: true,
            totalTrades: completedTrades.length,
            wins: wins.length,
            losses: losses.length,
            winRate: completedTrades.length > 0 ? (wins.length / completedTrades.length) * 100 : 0,
            totalProfit,
            averageTrade: avgProfit,
            bestDay,
            worstDay,
            tradingDays: Object.keys(dailyMap).length,
            dailyStats,
            contractStats,
            digitDistribution: {} // Not tracked in V2 basic logs
        });
    } catch (error) {
        console.error('Get stats error:', error);
        res.status(500).json({ success: false, error: 'Failed to fetch statistics' });
    }
});

/**
 * GET /admin/stats/balances
 * Get aggregated balances across all users
 */
router.get('/balances', async (req, res) => {
    try {
        // Get all active trading accounts
        const { data: accounts, error } = await supabase
            .from('trading_accounts')
            .select('account_type, balance, is_active, is_virtual')
            .eq('is_active', true);

        if (error) throw error;

        // Aggregate balances
        let realBalance = 0;
        let demoBalance = 0;

        (accounts || []).forEach(account => {
            const balance = parseFloat(account.balance) || 0;
            if (account.is_virtual || account.account_type === 'demo') {
                demoBalance += balance;
            } else {
                realBalance += balance;
            }
        });

        res.json({
            success: true,
            data: {
                real: realBalance,
                demo: demoBalance,
                totalAccounts: accounts?.length || 0
            }
        });
    } catch (error) {
        console.error('Get balances error:', error);
        res.status(500).json({ success: false, error: 'Failed to fetch balances' });
    }
});

/**
 * GET /admin/stats/accounts
 * Get per-account performance
 */
router.get('/accounts', async (req, res) => {
    try {
        const { sessionId, limit = 50 } = req.query;

        // Queries 'trade_logs' (V2)
        let query = supabase
            .from('trade_logs')
            .select('user_id, account_id, profit, stake, result')
            .neq('result', 'pending')
            .not('profit', 'is', null);

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
            if (t.result === 'win' || parseFloat(t.profit) > 0) {
                accountStats[key].wins++;
            } else {
                accountStats[key].losses++;
            }
            accountStats[key].profit += parseFloat(t.profit) || 0;
            accountStats[key].stake += parseFloat(t.stake) || 0;
        });

        // Convert to array
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

        // Queries 'trade_logs' (V2)
        let query = supabase
            .from('trade_logs')
            .select('profit, stake, result, metadata')
            .neq('result', 'pending')
            .not('profit', 'is', null);

        if (sessionId) {
            query = query.eq('session_id', sessionId);
        }

        const { data: trades, error } = await query;

        if (error) throw error;

        // Group by market
        const marketStats = {};

        (trades || []).forEach(t => {
            const market = t.metadata?.market || 'Unknown';
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
            if (t.result === 'win' || parseFloat(t.profit) > 0) {
                marketStats[market].wins++;
            } else {
                marketStats[market].losses++;
            }
            marketStats[market].profit += parseFloat(t.profit) || 0;
            marketStats[market].stake += parseFloat(t.stake) || 0;
        });

        // Convert to array
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

        // Queries 'trade_logs' (V2)
        let query = supabase
            .from('trade_logs')
            .select('profit, stake, result, metadata, confidence, contract_type')
            .neq('result', 'pending')
            .not('profit', 'is', null);

        if (sessionId) {
            query = query.eq('session_id', sessionId);
        }

        const { data: trades, error } = await query;

        if (error) throw error;

        // Group by strategy
        const strategyStats = {};

        (trades || []).forEach(t => {
            const strategy = t.metadata?.strategy || t.contract_type || 'Unknown';
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
            if (t.result === 'win' || parseFloat(t.profit) > 0) {
                strategyStats[strategy].wins++;
            } else {
                strategyStats[strategy].losses++;
            }
            strategyStats[strategy].profit += parseFloat(t.profit) || 0;
            strategyStats[strategy].stake += parseFloat(t.stake) || 0;
            if (t.confidence) {
                strategyStats[strategy].totalConfidence += parseFloat(t.confidence);
            }
        });

        // Convert to array
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

        // Queries 'trade_logs' (V2)
        let query = supabase
            .from('trade_logs')
            .select('created_at, profit, result')
            .neq('result', 'pending')
            .not('profit', 'is', null)
            .order('created_at', { ascending: true });

        if (sessionId) {
            query = query.eq('session_id', sessionId);
        }

        const { data: trades, error } = await query;

        if (error) throw error;

        // Build cumulative profit curve
        let cumulative = 0;
        const timeline = (trades || []).map((t, i) => {
            const profit = parseFloat(t.profit) || 0;
            cumulative += profit;
            return {
                index: i,
                timestamp: t.created_at,
                profit: profit,
                cumulative,
                result: t.result === 'win' || profit > 0 ? 'won' : 'lost'
            };
        });

        res.json({ timeline });
    } catch (error) {
        console.error('Get timeline error:', error);
        res.status(500).json({ error: 'Failed to fetch timeline' });
    }
});

module.exports = router;
