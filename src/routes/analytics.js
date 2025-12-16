const express = require('express');
const router = express.Router();
const { supabase } = require('../db/supabase');
const { authMiddleware } = require('../middleware/auth');
const isAdmin = require('../middleware/isAdmin');

/**
 * GET /api/analytics/regime-performance
 * Aggregates performance metrics grouped by Market Regime (TREND, RANGE, CHAOS)
 */
router.get('/regime-performance', authMiddleware, isAdmin, async (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 1000;

        // Fetch recent trades with signal data
        const { data: trades, error } = await supabase
            .from('trades')
            .select('signal, profit_loss, status')
            .order('created_at', { ascending: false })
            .limit(limit);

        if (error) throw error;

        // Aggregate in memory dynamically
        const stats = {};

        trades.forEach(trade => {
            let regime = (trade.signal && trade.signal.regime) ? trade.signal.regime.toUpperCase() : 'UNKNOWN';

            if (!stats[regime]) {
                stats[regime] = { count: 0, wins: 0, losses: 0, pnl: 0 };
            }

            const target = stats[regime];

            target.count++;
            target.pnl += (trade.profit_loss || 0);

            const isWin = trade.profit_loss > 0;
            if (isWin) target.wins++;
            else target.losses++;
        });

        // Calculate derived metrics
        const results = Object.entries(stats).map(([regime, data]) => ({
            regime,
            trades: data.count,
            winRate: data.count > 0 ? ((data.wins / data.count) * 100).toFixed(1) + '%' : '0%',
            netPnl: data.pnl.toFixed(2),
            avgPnl: data.count > 0 ? (data.pnl / data.count).toFixed(2) : '0.00'
        }));

        res.json(results);

    } catch (error) {
        console.error('Analytics Error:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * GET /api/analytics/confidence-winrate
 * Aggregates Win Rate by Confidence Bucket (e.g. 60-70%, 70-80%)
 */
router.get('/confidence-winrate', authMiddleware, isAdmin, async (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 1000;

        const { data: trades, error } = await supabase
            .from('trades')
            .select('confidence, profit_loss')
            .not('confidence', 'is', null)
            .order('created_at', { ascending: false })
            .limit(limit);

        if (error) throw error;

        // Buckets: 0.5-0.6, 0.6-0.7, 0.7-0.8, 0.8-0.9, 0.9-1.0
        const buckets = {
            '50-60%': { min: 0.5, max: 0.6, wins: 0, total: 0 },
            '60-70%': { min: 0.6, max: 0.7, wins: 0, total: 0 },
            '70-80%': { min: 0.7, max: 0.8, wins: 0, total: 0 },
            '80-90%': { min: 0.8, max: 0.9, wins: 0, total: 0 },
            '90-100%': { min: 0.9, max: 1.1, wins: 0, total: 0 }
        };

        trades.forEach(trade => {
            const conf = trade.confidence;
            const isWin = trade.profit_loss > 0;

            for (const key in buckets) {
                if (conf >= buckets[key].min && conf < buckets[key].max) {
                    buckets[key].total++;
                    if (isWin) buckets[key].wins++;
                    break;
                }
            }
        });

        const results = Object.entries(buckets).map(([range, data]) => ({
            range,
            trades: data.total,
            winRate: data.total > 0 ? ((data.wins / data.total) * 100).toFixed(1) : '0.0'
        }));

        res.json(results);

    } catch (error) {
        console.error('Analytics Error:', error);
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;
