/**
 * Quant Engine v3 - Full Quantitative Trading Engine
 * 
 * Fixes applied:
 * 1. Uses quantConfig for all thresholds
 * 2. Proper totalWeight tracking
 * 3. Decision log for observability
 * 4. Bayesian digit selection
 */

const {
    computeDigitFrequency,
    computeDigitEntropy,
    computeMarkovPrediction,
    detectDigitDeltaStreak,
    computeDigitExhaustion,
    detectRecentBias,
    selectOptimalDigit,
    computeTrendStrength,
    computeMomentumStability
} = require('./strategyEngine');

const quantMemory = require('./quantMemory');
const quantConfig = require('../config/quantConfig');
const perfMonitor = require('../utils/performance');

// ==================== MARKET REGIME CLASSIFIER ====================

/**
 * Detect current market regime based on Multi-Factor Analysis
 * Uses Entropy (Digits), Trend Strength (Price), and Stability (Price)
 */
function detectRegime(entropy, trendStrength, stability) {
    // 1. CHAOS: High Entropy OR Very Low Stability
    if (entropy > quantConfig.entropy.chaosThreshold || stability < 0.2) {
        return 'CHAOS';
    }

    // 2. TREND: Strong Trend + Good Stability
    if (trendStrength > 0.6 && stability > 0.4) {
        return 'TREND';
    }

    // 3. RANGE: Low Trend + Moderate/High Stability
    if (trendStrength <= 0.4 && stability > 0.5) {
        return 'RANGE';
    }

    // Default to Transition if unclear
    return 'TRANSITION';
}

/**
 * Get regime trading recommendation
 */
function getRegimeConfig(regime) {
    switch (regime) {
        case 'CHAOS':
            return {
                shouldTrade: false, // NO TRADING
                minConfidence: 1.0,
                message: 'CHAOS - Market too volatile/random'
            };
        case 'TREND':
            return {
                shouldTrade: true,
                minConfidence: 0.65, // Higher confidence needed for trend following
                strategies: ['trend_follow'],
                message: 'TREND - Strong directional bias'
            };
        case 'RANGE':
            return {
                shouldTrade: true,
                minConfidence: 0.60,
                strategies: ['mean_reversion'],
                message: 'RANGE - Mean reversion favored'
            };
        case 'TRANSITION':
        default:
            return {
                shouldTrade: true,
                minConfidence: 0.75, // Be very picky in transition
                message: 'TRANSITION - Exercise caution'
            };
    }
}

// ==================== BAYESIAN DIGIT PREDICTOR ====================

/**
 * Bayesian probability update for digits
 * Combines prior (frequency) with likelihood (Markov transitions)
 * 
 * P(digit|data) ∝ P(data|digit) * P(digit)
 * 
 * @param {number[]} freq - Digit frequency (prior)
 * @param {number[]} markovRow - Transition probabilities from current digit
 * @returns {Object} - Posterior probabilities and predictions
 */
function bayesianDigitPredictor(freq, markovRow) {
    const posterior = [];
    let sum = 0;

    for (let d = 0; d < 10; d++) {
        // Prior: historical frequency
        const prior = freq[d] || 0.1;
        // Likelihood: Markov transition probability
        const likelihood = markovRow[d] || 0.1;
        // Unnormalized posterior
        const p = prior * likelihood;
        posterior.push(p);
        sum += p;
    }

    // Normalize to get proper probabilities
    const normalized = posterior.map(p => sum > 0 ? p / sum : 0.1);

    // Find best predictions
    const sorted = normalized
        .map((prob, digit) => ({ digit, prob }))
        .sort((a, b) => b.prob - a.prob);

    // Calculate OVER vs UNDER probabilities
    const overProb = normalized.slice(5, 10).reduce((a, b) => a + b, 0);
    const underProb = normalized.slice(0, 5).reduce((a, b) => a + b, 0);

    return {
        posterior: normalized,
        bestDigit: sorted[0].digit,
        bestProb: sorted[0].prob,
        secondBest: sorted[1].digit,
        overProb,
        underProb,
        side: overProb > underProb ? 'OVER' : 'UNDER',
        confidence: Math.abs(overProb - underProb)
    };
}

/**
 * Build Markov transition row for current digit
 */
function buildMarkovRow(digitHistory, currentDigit, depth = 50) {
    if (digitHistory.length < depth) return Array(10).fill(0.1);

    const recent = digitHistory.slice(-depth);
    const transitions = Array(10).fill(0);
    let count = 0;

    for (let i = 0; i < recent.length - 1; i++) {
        if (recent[i] === currentDigit) {
            transitions[recent[i + 1]]++;
            count++;
        }
    }

    if (count === 0) return Array(10).fill(0.1);
    return transitions.map(t => t / count);
}

// ==================== FINAL DECISION LAYER ====================

/**
 * Main quant signal generation
 * Combines all models with regime awareness and learning weights
 */
function generateQuantSignal({ market, tickHistory, digitHistory }) {
    perfMonitor.start('quant_signal_gen');

    // Load memory (sync - uses cache or defaults)
    const memory = quantMemory.getMemorySync();

    // Warmup check
    if (!digitHistory || digitHistory.length < 25) {
        return {
            shouldTrade: false,
            reason: 'Warmup (25 digits)',
            isWarmup: true,
            confidence: 0,
            regime: 'unknown'
        };
    }

    // ==================== ANALYSIS ==================== //

    // 0. Market Context Analysis (Price Action)
    const trendStrength = computeTrendStrength(tickHistory);
    const stability = computeMomentumStability(tickHistory);

    // 1. Entropy and Regime
    const entropyData = computeDigitEntropy(digitHistory, 30);

    // Detect Regime using Multi-Factor Model
    const regime = detectRegime(entropyData.entropy, trendStrength, stability);
    const regimeConfig = getRegimeConfig(regime);

    // Record regime
    quantMemory.recordRegime(memory, regime);

    // Kill switch: Don't trade in chaos from regime config
    // Note: detailed reason will be available in stats
    if (!regimeConfig.shouldTrade) {
        return {
            shouldTrade: false,
            reason: regimeConfig.message,
            confidence: 0,
            regime,
            entropy: entropyData.entropy,
            regimeStats: { trendStrength, stability, entropy: entropyData.entropy }
        };
    }

    // 2. Digit Analysis
    const freq = computeDigitFrequency(digitHistory, 30);
    const markov = computeMarkovPrediction(digitHistory, 5);
    const exhaustion = computeDigitExhaustion(digitHistory, 50);
    const streak = detectDigitDeltaStreak(digitHistory, 15);
    const bias = detectRecentBias(digitHistory, 20);

    // 3. Bayesian Prediction
    const currentDigit = digitHistory[digitHistory.length - 1];
    const markovRow = buildMarkovRow(digitHistory, currentDigit, 60);
    const bayesian = bayesianDigitPredictor(freq, markovRow);

    // ==================== WEIGHTED VOTING ==================== //

    const weights = memory.weights;
    let scoreOver = 0;
    let scoreUnder = 0;
    let factors = [];
    let indicatorsUsed = [];

    // Factor 1: Markov Prediction (scaled by learned weight)
    if (markov.valid) {
        const side = markov.predictedDigit >= 5 ? 'OVER' : 'UNDER';
        const contrib = markov.probability * weights.markov;
        if (side === 'OVER') scoreOver += contrib;
        else scoreUnder += contrib;
        factors.push(`MKV:${markov.predictedDigit}@${(markov.probability * 100).toFixed(0)}%`);
        indicatorsUsed.push('markov');
    }

    // Factor 2: Exhaustion (mean reversion)
    if (exhaustion.isSignificant) {
        const side = exhaustion.exhaustedDigit >= 5 ? 'OVER' : 'UNDER';
        const contrib = exhaustion.exhaustionStrength * weights.exhaustion * 0.8;
        if (side === 'OVER') scoreOver += contrib;
        else scoreUnder += contrib;
        factors.push(`EXH:${exhaustion.exhaustedDigit}`);
        indicatorsUsed.push('exhaustion');
    }

    // Factor 3: Streak with mean reversion
    if (streak.streak >= 3) {
        const side = streak.suggestedDirection === 1 ? 'OVER' : 'UNDER';
        const contrib = Math.min(streak.streak * 0.15, 0.6) * weights.streak;
        if (side === 'OVER') scoreOver += contrib;
        else scoreUnder += contrib;
        factors.push(`STK:${streak.streak}→${streak.meanReversion ? 'REV' : 'CON'}`);
        indicatorsUsed.push('streak');
    }

    // Factor 4: Recent Bias
    if (bias.suggestion) {
        const contrib = bias.strength * weights.bias * 0.6;
        if (bias.suggestion === 'OVER') scoreOver += contrib;
        else scoreUnder += contrib;
        factors.push(`BIAS:${bias.suggestion}`);
        indicatorsUsed.push('bias');
    }

    // Factor 5: Bayesian Posterior
    if (bayesian.confidence > 0.1) {
        const contrib = bayesian.confidence * weights.markov * 0.5;
        if (bayesian.side === 'OVER') scoreOver += contrib;
        else scoreUnder += contrib;
        factors.push(`BAY:${bayesian.side}@${(bayesian.confidence * 100).toFixed(0)}%`);
        indicatorsUsed.push('bayesian');
    }

    // ==================== CONTRADICTION DETECTION ==================== //

    const totalScore = scoreOver + scoreUnder;
    const scoreDiff = Math.abs(scoreOver - scoreUnder);
    const voteRatio = totalScore > 0 ? scoreDiff / totalScore : 0;

    // If scores are too close, it's a contradiction
    if (totalScore > 0 && voteRatio < quantConfig.confidence.contradictionRatio && indicatorsUsed.length >= 2) {
        return {
            shouldTrade: false,
            reason: `Contradiction: O=${scoreOver.toFixed(2)} vs U=${scoreUnder.toFixed(2)}`,
            confidence: 0,
            regime,
            entropy: entropyData.value,
            contradiction: true,
            decisionLog: { voteRatio, totalScore, indicatorsUsed }
        };
    }

    // ==================== FINAL DECISION ==================== //

    const finalSide = scoreOver > scoreUnder ? 'OVER' : 'UNDER';
    const winningScore = Math.max(scoreOver, scoreUnder);

    // Normalize confidence using voteRatio (how much winner beats loser)
    const normalizedConfidence = Math.min(voteRatio, 1.0);

    // Regime-adjusted minimum confidence
    const meetsConfidence = normalizedConfidence >= regimeConfig.minConfidence;
    const meetsFactors = indicatorsUsed.length >= quantConfig.confidence.minFactors;

    const shouldTrade = meetsConfidence && meetsFactors;

    // Select digit using Bayesian posterior + frequency blend
    const { digit: selectedDigit, score: digitScore } = selectOptimalDigit(
        finalSide,
        bayesian.posterior,
        freq
    );

    // Decision log for observability/debugging
    const decisionLog = {
        timestamp: new Date().toISOString(),
        entropy: entropyData.value,
        regime,
        votes: { over: scoreOver, under: scoreUnder },
        totalScore,
        voteRatio,
        finalSide,
        normalizedConfidence,
        digitScore,
        indicatorsUsed,
        meetsConfidence,
        meetsFactors
    };

    const duration = perfMonitor.end('quant_signal_gen');
    perfMonitor.logLatency('QuantEngine.generateSignal', duration, 20); // 20ms threshold

    return {
        shouldTrade,
        side: finalSide,
        digit: selectedDigit,
        confidence: normalizedConfidence,
        regime,
        regimeStats: {
            trendStrength: trendStrength.toFixed(3),
            stability: stability.toFixed(3),
            entropy: entropyData.entropy.toFixed(3)
        },
        reason: factors.join(' '),
        indicatorsUsed,
        market,
        regime, // Raw regime code (TREND, RANGE, CHAOS)
        latency: duration,
        decisionLog,

        // Detailed analysis for logging
        analysis: {
            entropy: entropyData.value,
            trendStrength: trendStrength.toFixed(3),
            stability: stability.toFixed(3),
            regime: regimeConfig.message,
            scores: { over: scoreOver.toFixed(2), under: scoreUnder.toFixed(2) },
            weights: {
                markov: weights.markov.toFixed(2),
                exhaustion: weights.exhaustion.toFixed(2),
                streak: weights.streak.toFixed(2),
                bias: weights.bias.toFixed(2)
            },
            bayesian: {
                bestDigit: bayesian.bestDigit,
                confidence: (bayesian.confidence * 100).toFixed(1)
            },
            totalTrades: memory.performance.totalTrades,
            winRate: (memory.performance.winRate * 100).toFixed(1) + '%'
        },

        freq
    };
}

/**
 * Record trade outcome and update learning
 */
function recordTradeOutcome(tradeData) {
    const memory = quantMemory.getMemorySync();
    quantMemory.recordTrade(memory, tradeData);

    const weightMsg = tradeData.weight ? `(Weight: ${tradeData.weight})` : '';
    console.log(`[QuantEngine] Trade recorded: ${tradeData.side} ${tradeData.won ? 'WON' : 'LOST'} ${weightMsg}`);
    console.log(`[QuantEngine] Memory: ${JSON.stringify(quantMemory.getMemorySummary(memory))}`);

    return memory;
}

/**
 * Initialize session in memory
 */
async function initSession(sessionId) {
    console.log(`[QuantEngine] Initializing session: ${sessionId}`);

    // Force reload from DB to ensure fresh state
    const memory = await quantMemory.loadMemory();

    // Initialize session structure
    await quantMemory.startSession(memory, sessionId);

    console.log(`[QuantEngine] Session initialized: ${sessionId}, Memory Version: ${memory.version}`);
    return memory;
}

/**
 * Get current engine state for debugging
 */
function getEngineState() {
    const memory = quantMemory.getMemorySync();
    return {
        summary: quantMemory.getMemorySummary(memory),
        memory
    };
}

module.exports = {
    generateQuantSignal,
    recordTradeOutcome,
    initSession,
    getEngineState,
    detectRegime,
    getRegimeConfig,
    bayesianDigitPredictor,
    buildMarkovRow
};
