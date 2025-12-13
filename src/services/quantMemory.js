/**
 * Quant Memory - Supabase Persistent Learning State
 * 
 * Migrated from filesystem to Supabase for Railway persistence.
 * Memory survives redeploys and scales across workers.
 */

const { supabase } = require('../db/supabase');

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

// In-memory cache to reduce DB reads
let memoryCache = null;
let lastCacheTime = 0;
const CACHE_TTL = 5000; // 5 seconds
let isInitialized = false;

/**
 * Initialize memory at startup (call this once at server start)
 * This preloads cache so synchronous access works
 */
async function initializeMemory(market = 'default') {
    console.log('[QuantMemory] Initializing from Supabase...');
    await loadMemory(market);
    isInitialized = true;
    console.log('[QuantMemory] Memory initialized');
    return memoryCache;
}

/**
 * Synchronous getter - returns cache or defaults
 * Use this in hot paths like signal generation
 * Falls back to defaults if not yet loaded from DB
 */
function getMemorySync() {
    if (memoryCache) {
        return memoryCache;
    }
    // Return defaults if not yet loaded
    // This allows signal generation to work before first DB load
    return { ...DEFAULT_MEMORY };
}

/**
 * Load memory from Supabase (async)
 */
async function loadMemory(market = 'default') {
    // Check cache first
    if (memoryCache && (Date.now() - lastCacheTime) < CACHE_TTL) {
        return memoryCache;
    }

    try {
        const { data, error } = await supabase
            .from('quant_memory')
            .select('*')
            .eq('market', market)
            .single();

        if (error && error.code !== 'PGRST116') {
            // PGRST116 = not found, which is OK
            console.error('[QuantMemory] Load error:', error.message);
        }

        if (data) {
            // Merge with defaults to ensure new fields exist
            memoryCache = {
                ...DEFAULT_MEMORY,
                ...data.weights_data,
                ...data.performance_data,
                updatedAt: data.updated_at
            };
        } else {
            // Create new memory record
            memoryCache = { ...DEFAULT_MEMORY };
            await saveMemory(memoryCache, market);
        }

        lastCacheTime = Date.now();
        return memoryCache;

    } catch (error) {
        console.error('[QuantMemory] Error loading memory:', error.message);
        return memoryCache || { ...DEFAULT_MEMORY };
    }
}

/**
 * Save memory to Supabase
 */
async function saveMemory(memory, market = 'default') {
    try {
        memory.updatedAt = new Date().toISOString();

        const { error } = await supabase
            .from('quant_memory')
            .upsert({
                market,
                weights_data: {
                    weights: memory.weights,
                    thresholds: memory.thresholds,
                    indicatorPerformance: memory.indicatorPerformance
                },
                performance_data: {
                    performance: memory.performance,
                    lastTrades: memory.lastTrades?.slice(0, memory.maxTradeHistory || 100),
                    regime: memory.regime,
                    currentSession: memory.currentSession
                },
                updated_at: memory.updatedAt
            }, {
                onConflict: 'market'
            });

        if (error) {
            console.error('[QuantMemory] Save error:', error.message);
        }

        // Update cache
        memoryCache = memory;
        lastCacheTime = Date.now();

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
 * @param {Object} memory - Current memory state
 * @param {Object} trade - { side, won, indicators, digit, regime }
 */
async function recordTrade(memory, trade) {
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

    // Save to Supabase (async, non-blocking)
    saveMemory(memory).catch(err => {
        console.error('[QuantMemory] Background save error:', err.message);
    });

    return memory;
}

/**
 * Update regime history
 */
async function recordRegime(memory, regime) {
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
async function startSession(memory, sessionId) {
    memory.currentSession = {
        sessionId,
        startedAt: new Date().toISOString(),
        trades: 0,
        wins: 0,
        losses: 0
    };
    await saveMemory(memory);
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
 * Reset memory to defaults (clears Supabase record)
 */
async function resetMemory(market = 'default') {
    const memory = { ...DEFAULT_MEMORY, createdAt: new Date().toISOString() };

    const { error } = await supabase
        .from('quant_memory')
        .delete()
        .eq('market', market);

    if (error) {
        console.error('[QuantMemory] Reset error:', error.message);
    }

    memoryCache = null;
    lastCacheTime = 0;

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
    initializeMemory,
    getMemorySync,
    DEFAULT_MEMORY
};
