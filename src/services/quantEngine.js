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
    selectOptimalDigit
} = require('./strategyEngine');

const quantMemory = require('./quantMemory');
const quantConfig = require('../config/quantConfig');

// ==================== MARKET REGIME CLASSIFIER ====================

/**
 * Detect current market regime based on entropy
 */
function detectRegime(entropy) {
    if (entropy > quantConfig.entropy.chaosThreshold) return 'chaos';
    if (entropy > quantConfig.entropy.transitionThreshold) return 'transition';
    return 'stable';
}

/**
 * Get regime trading recommendation
 */
function getRegimeConfig(regime) {
    switch (regime) {
        case 'chaos':
            return {
                shouldTrade: false,
                minConfidence: 1.0,
                message: 'Market chaos - Skip trading'
            };
        case 'transition':
            return {
                shouldTrade: true,
                minConfidence: quantConfig.confidence.transitionMin,
                message: 'Transition - Trade cautiously'
            };
        case 'stable':
        default:
            return {
                shouldTrade: true,
                minConfidence: quantConfig.confidence.stableMin,
                message: 'Stable - Normal trading'
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
    // Load memory
    const memory = quantMemory.loadMemory();

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

    // 1. Entropy and Regime
    const entropyData = computeDigitEntropy(digitHistory, 30);
    const regime = detectRegime(entropyData.entropy);
    const regimeConfig = getRegimeConfig(regime);

    // Record regime
    quantMemory.recordRegime(memory, regime);

    // Kill switch: Don't trade in chaos
    if (!regimeConfig.shouldTrade) {
        return {
            shouldTrade: false,
            reason: regimeConfig.message,
            confidence: 0,
            regime,
            entropy: entropyData.entropy
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

    return {
        shouldTrade,
        side: finalSide,
        digit: selectedDigit,
        confidence: normalizedConfidence,
        regime,
        reason: factors.join(' '),
        indicatorsUsed,
        market,
        decisionLog,

        // Detailed analysis for logging
        analysis: {
            entropy: entropyData.value,
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
    const memory = quantMemory.loadMemory();
    quantMemory.recordTrade(memory, tradeData);

    console.log(`[QuantEngine] Trade recorded: ${tradeData.side} ${tradeData.won ? 'WON' : 'LOST'}`);
    console.log(`[QuantEngine] Memory: ${JSON.stringify(quantMemory.getMemorySummary(memory))}`);

    return memory;
}

/**
 * Initialize session in memory
 */
function initSession(sessionId) {
    const memory = quantMemory.loadMemory();
    quantMemory.startSession(memory, sessionId);
    console.log(`[QuantEngine] Session initialized: ${sessionId}`);
    return memory;
}

/**
 * Get current engine state for debugging
 */
function getEngineState() {
    const memory = quantMemory.loadMemory();
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
