/**
 * Quant Strategy Configuration
 * All tunable thresholds and parameters in one place
 * 
 * Move all magic numbers here for backtesting/tuning
 */

module.exports = {
    // ==================== ENTROPY THRESHOLDS ====================
    entropy: {
        // Below this = predictable patterns, good to trade
        predictableThreshold: 2.5,
        // Above this = too random, kill-switch (max possible ~3.32 for 10 digits)
        chaosThreshold: 3.15,
        // Moderate randomness - trade cautiously
        transitionThreshold: 2.8,
        // Window size for entropy calculation
        window: 30
    },

    // ==================== MARKOV CHAIN ====================
    markov: {
        // Minimum observations before trusting transition probability
        minObservations: 5,
        // Probability must exceed this to be considered significant
        significanceThreshold: 0.15,
        // History depth for transition matrix
        historyDepth: 50
    },

    // ==================== CONFIDENCE AND VOTING ====================
    confidence: {
        // Stable regime minimum confidence to trade
        stableMin: 0.25,
        // Transition regime minimum confidence
        transitionMin: 0.40,
        // Contradiction threshold (voteRatio below this = reject)
        contradictionRatio: 0.15,
        // Minimum number of agreeing factors to trade
        minFactors: 2
    },

    // ==================== DIGIT EXHAUSTION ====================
    exhaustion: {
        // How much below average (10%) to trigger exhaustion
        // 0.4 = digit must be 40% below average
        threshold: 0.4,
        // Window size for frequency analysis
        window: 50
    },

    // ==================== STREAK DETECTION ====================
    streak: {
        // Minimum streak length to consider
        minStreak: 3,
        // Streak length to trigger mean reversion
        meanReversionStreak: 4,
        // Window for streak detection
        window: 12
    },

    // ==================== BIAS DETECTION ====================
    bias: {
        // Imbalance strength to trigger bias signal
        strengthThreshold: 0.2,
        // Imbalance strength to trigger mean reversion
        meanReversionStrength: 0.3,
        // Window for bias detection
        window: 15
    },

    // ==================== BAYESIAN PREDICTOR ====================
    bayesian: {
        // Alpha: blend between Markov (1) and frequency (0) for posterior
        alpha: 0.6,
        // Minimum posterior confidence to include in voting
        minConfidence: 0.1,
        // Depth for Markov row building
        markovRowDepth: 60
    },

    // ==================== DIGIT SELECTION ====================
    digitSelection: {
        // Alpha: blend between posterior (1) and inverse-frequency (0)
        // score = posterior * alpha + (1 - freq) * (1 - alpha)
        posteriorWeight: 0.7
    },

    // ==================== WARMUP ====================
    warmup: {
        // Minimum digits before trading
        minDigits: 25
    },

    // ==================== LEARNING WEIGHTS ====================
    learning: {
        // Minimum weight (worst performers)
        minWeight: 0.3,
        // Maximum weight (best performers)
        maxWeight: 2.0,
        // Minimum trades before adjusting weights
        minTradesForAdjustment: 20
    },

    // ==================== CIRCULAR DELTA ====================
    circularDelta: {
        // Whether to use circular delta for streak detection
        // true = wrap-aware (0→9 = -1, 9→0 = +1)
        enabled: false
    }
};
