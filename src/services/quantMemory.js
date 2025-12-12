/**
 * Quant Memory - Persistent Learning State
 * 
 * This module provides a persistent memory layer for the trading engine.
 * The memory stores:
 * - Indicator performance (accuracy)
 * - Dynamic weights
 * - Trade history
 * - Market regime history
 * - Entropy clusters
 */

const fs = require('fs');
const path = require('path');

const MEMORY_FILE = path.join(__dirname, '../data/quant_memory.json');

// Default memory structure
const DEFAULT_MEMORY = {
    version: 2,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),

    // Dynamic weights (adjusted by learning loop)
    weights: {
        markov: 1.0,
        exhaustion: 1.0,
        streak: 1.0,
        bias: 1.0,
        entropy: 1.0
    },

    // Thresholds (can be adjusted by learning)
    thresholds: {
        entropy: 2.8,
        minConfidence: 0.25,
        minFactors: 2
    },

    // Overall performance
    performance: {
        OVER: { trades: 0, wins: 0, losses: 0 },
        UNDER: { trades: 0, wins: 0, losses: 0 },
        totalTrades: 0,
        totalWins: 0,
        totalLosses: 0,
        winRate: 0
    },

    // Per-indicator performance
    indicatorPerformance: {
        markov: { correct: 0, wrong: 0, accuracy: 0.5 },
        exhaustion: { correct: 0, wrong: 0, accuracy: 0.5 },
        streak: { correct: 0, wrong: 0, accuracy: 0.5 },
        bias: { correct: 0, wrong: 0, accuracy: 0.5 },
        bayesian: { correct: 0, wrong: 0, accuracy: 0.5 }
    },

    // Last N trades for analysis
    lastTrades: [],
    maxTradeHistory: 100,

    // Market regime tracking
    regime: {
        current: 'stable',
        history: [],
        maxHistory: 50,
        stableCount: 0,
        transitionCount: 0,
        chaosCount: 0
    },

    // Session stats (reset per session)
    currentSession: {
        sessionId: null,
        startedAt: null,
        trades: 0,
        wins: 0,
        losses: 0
    }
};

// Ensure data directory exists
function ensureDataDir() {
    const dataDir = path.dirname(MEMORY_FILE);
    if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
    }
}

/**
 * Load memory from disk
 */
function loadMemory() {
    try {
        ensureDataDir();
        if (fs.existsSync(MEMORY_FILE)) {
            const data = fs.readFileSync(MEMORY_FILE, 'utf8');
            const parsed = JSON.parse(data);
            // Merge with defaults to ensure new fields exist
            return { ...DEFAULT_MEMORY, ...parsed };
        }
    } catch (error) {
        console.error('[QuantMemory] Error loading memory:', error.message);
    }
    return { ...DEFAULT_MEMORY };
}

/**
 * Save memory to disk
 */
function saveMemory(memory) {
    try {
        ensureDataDir();
        memory.updatedAt = new Date().toISOString();
        fs.writeFileSync(MEMORY_FILE, JSON.stringify(memory, null, 2));
    } catch (error) {
        console.error('[QuantMemory] Error saving memory:', error.message);
    }
}

/**
 * Calculate dynamic weight based on accuracy
 * Weight range: 0.3 to 2.0
 * Requires min 20 samples before adjusting
 */
function calculateWeight(indicator) {
    const total = indicator.correct + indicator.wrong;
    if (total < 20) return 1.0; // Not enough data

    const accuracy = indicator.correct / total;
    // Weight scales from 0.3 (30% accuracy) to 2.0 (100% accuracy)
    return 0.3 + (accuracy * 1.7);
}

/**
 * Update memory after a trade completes
 * @param {Object} trade - { side, won, indicators, digit, regime }
 */
function recordTrade(memory, trade) {
    const { side, won, indicators = [], digit, regime, confidence } = trade;

    // Update overall performance
    memory.performance[side].trades++;
    memory.performance.totalTrades++;

    if (won) {
        memory.performance[side].wins++;
        memory.performance.totalWins++;
    } else {
        memory.performance[side].losses++;
        memory.performance.totalLosses++;
    }

    memory.performance.winRate = memory.performance.totalTrades > 0
        ? memory.performance.totalWins / memory.performance.totalTrades
        : 0;

    // Update indicator performance
    for (const ind of indicators) {
        if (memory.indicatorPerformance[ind]) {
            if (won) {
                memory.indicatorPerformance[ind].correct++;
            } else {
                memory.indicatorPerformance[ind].wrong++;
            }
            // Recalculate accuracy
            const perf = memory.indicatorPerformance[ind];
            const total = perf.correct + perf.wrong;
            perf.accuracy = total > 0 ? perf.correct / total : 0.5;
        }
    }

    // Update dynamic weights based on new accuracy
    memory.weights.markov = calculateWeight(memory.indicatorPerformance.markov);
    memory.weights.exhaustion = calculateWeight(memory.indicatorPerformance.exhaustion);
    memory.weights.streak = calculateWeight(memory.indicatorPerformance.streak);
    memory.weights.bias = calculateWeight(memory.indicatorPerformance.bias);

    // Add to trade history
    memory.lastTrades.unshift({
        timestamp: new Date().toISOString(),
        side,
        digit,
        won,
        confidence,
        regime,
        indicators
    });

    // Trim history
    if (memory.lastTrades.length > memory.maxTradeHistory) {
        memory.lastTrades = memory.lastTrades.slice(0, memory.maxTradeHistory);
    }

    // Update session stats
    memory.currentSession.trades++;
    if (won) memory.currentSession.wins++;
    else memory.currentSession.losses++;

    // Save to disk
    saveMemory(memory);

    return memory;
}

/**
 * Update regime history
 */
function recordRegime(memory, regime) {
    if (memory.regime.current !== regime) {
        memory.regime.history.unshift({
            from: memory.regime.current,
            to: regime,
            timestamp: new Date().toISOString()
        });

        if (memory.regime.history.length > memory.regime.maxHistory) {
            memory.regime.history = memory.regime.history.slice(0, memory.regime.maxHistory);
        }

        memory.regime.current = regime;
    }

    // Count regimes
    if (regime === 'stable') memory.regime.stableCount++;
    else if (regime === 'transition') memory.regime.transitionCount++;
    else if (regime === 'chaos') memory.regime.chaosCount++;

    return memory;
}

/**
 * Start a new session
 */
function startSession(memory, sessionId) {
    memory.currentSession = {
        sessionId,
        startedAt: new Date().toISOString(),
        trades: 0,
        wins: 0,
        losses: 0
    };
    saveMemory(memory);
    return memory;
}

/**
 * Get memory summary for logging
 */
function getMemorySummary(memory) {
    return {
        totalTrades: memory.performance.totalTrades,
        winRate: (memory.performance.winRate * 100).toFixed(1) + '%',
        weights: {
            markov: memory.weights.markov.toFixed(2),
            exhaustion: memory.weights.exhaustion.toFixed(2),
            streak: memory.weights.streak.toFixed(2),
            bias: memory.weights.bias.toFixed(2)
        },
        regime: memory.regime.current,
        sessionTrades: memory.currentSession.trades
    };
}

/**
 * Reset memory to defaults
 */
function resetMemory() {
    const memory = { ...DEFAULT_MEMORY, createdAt: new Date().toISOString() };
    saveMemory(memory);
    return memory;
}

module.exports = {
    loadMemory,
    saveMemory,
    recordTrade,
    recordRegime,
    startSession,
    getMemorySummary,
    resetMemory,
    calculateWeight,
    DEFAULT_MEMORY
};
