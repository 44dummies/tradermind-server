/**
 * Debug Routes - Signal Monitoring API
 * Provides endpoints for debugging and monitoring the trading engine.
 */

const express = require('express');
const router = express.Router();

// In-memory signal buffer (circular buffer of last 50 signals)
const signalBuffer = [];
const MAX_SIGNALS = 50;

/**
 * Add a signal to the debug buffer
 * Call this from your signal generation logic
 */
function logSignal(signal) {
    const entry = {
        timestamp: new Date().toISOString(),
        symbol: signal.symbol,
        price: signal.price,
        indicators: signal.indicators || {},
        conditionsPassed: signal.conditionsPassed || [],
        conditionsFailed: signal.conditionsFailed || [],
        signalGenerated: signal.signalGenerated || false,
        signalType: signal.signalType || null, // 'call' or 'put'
        confidence: signal.confidence || 0
    };

    signalBuffer.push(entry);

    // Keep only last MAX_SIGNALS
    if (signalBuffer.length > MAX_SIGNALS) {
        signalBuffer.shift();
    }

    return entry;
}

/**
 * GET /debug/signals
 * Returns the last 50 signals with condition status
 */
router.get('/signals', (req, res) => {
    const { symbol, limit = 50 } = req.query;

    let results = [...signalBuffer];

    // Filter by symbol if provided
    if (symbol) {
        results = results.filter(s => s.symbol === symbol);
    }

    // Apply limit
    results = results.slice(-parseInt(limit));

    // Calculate stats
    const stats = {
        total: results.length,
        signalsGenerated: results.filter(s => s.signalGenerated).length,
        callSignals: results.filter(s => s.signalType === 'call').length,
        putSignals: results.filter(s => s.signalType === 'put').length,
        avgConfidence: results.length > 0
            ? (results.reduce((sum, s) => sum + s.confidence, 0) / results.length).toFixed(2)
            : 0
    };

    // Get most common failures
    const failureCounts = {};
    results.forEach(s => {
        (s.conditionsFailed || []).forEach(condition => {
            failureCounts[condition] = (failureCounts[condition] || 0) + 1;
        });
    });

    const topFailures = Object.entries(failureCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([condition, count]) => ({ condition, count }));

    res.json({
        success: true,
        stats,
        topFailures,
        signals: results.reverse() // Most recent first
    });
});

/**
 * GET /debug/health
 * System health check
 */
router.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        signalBufferSize: signalBuffer.length,
        uptime: process.uptime()
    });
});

/**
 * GET /debug/thresholds
 * Suggest threshold adjustments based on failure patterns
 */
router.get('/thresholds', (req, res) => {
    const failureCounts = {};
    const passCounts = {};

    signalBuffer.forEach(s => {
        (s.conditionsFailed || []).forEach(c => {
            failureCounts[c] = (failureCounts[c] || 0) + 1;
        });
        (s.conditionsPassed || []).forEach(c => {
            passCounts[c] = (passCounts[c] || 0) + 1;
        });
    });

    const suggestions = [];

    Object.entries(failureCounts).forEach(([condition, failCount]) => {
        const passCount = passCounts[condition] || 0;
        const total = failCount + passCount;
        const failRate = (failCount / total * 100).toFixed(1);

        if (parseFloat(failRate) > 70) {
            suggestions.push({
                condition,
                failRate: `${failRate}%`,
                suggestion: 'Consider relaxing this threshold - it blocks too many signals'
            });
        } else if (parseFloat(failRate) < 10) {
            suggestions.push({
                condition,
                failRate: `${failRate}%`,
                suggestion: 'This condition rarely fails - consider tightening the threshold'
            });
        }
    });

    res.json({
        success: true,
        bufferSize: signalBuffer.length,
        suggestions
    });
});

/**
 * POST /debug/clear
 * Clear the signal buffer
 */
router.post('/clear', (req, res) => {
    signalBuffer.length = 0;
    res.json({ success: true, message: 'Signal buffer cleared' });
});

// Export both router and logSignal function
module.exports = router;
module.exports.logSignal = logSignal;
