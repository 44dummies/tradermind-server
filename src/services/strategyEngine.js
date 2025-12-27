/**
 * Strategy Engine v3 - CONFIGURABLE PURE DIGIT-BASED ANALYSIS
 * 
 * Fixes applied from code review:
 * 1. All thresholds moved to quantConfig.js
 * 2. Circular delta option for streak detection
 * 3. Defensive checks for invalid digits
 * 4. Consistent property naming (entropy.value, entropy.str)
 * 5. Bayesian-enhanced digit selection
 */

const quantConfig = require('../config/quantConfig');

// ==================== DIGIT-BASED INDICATORS ====================

/**
 * Compute digit frequency distribution
 * Returns probability array for digits 0-9
 */
function computeDigitFrequency(digitHistory, depth = quantConfig.entropy.window) {
  // Defensive: filter invalid digits first
  const validHistory = digitHistory.filter(d => Number.isInteger(d) && d >= 0 && d <= 9);

  if (validHistory.length < depth) depth = validHistory.length;
  if (depth === 0) return Array(10).fill(0.1);

  const recent = validHistory.slice(-depth);
  const counts = Array(10).fill(0);

  for (const d of recent) {
    counts[d]++;
  }

  return counts.map(c => c / depth);
}

/**
 * Markov Chain Transition Matrix for Digits
 * Predicts next digit based on transition probabilities from current digit.
 * Returns prediction only if sufficient observations exist.
 */
function computeMarkovPrediction(digitHistory, minObservations = quantConfig.markov.minObservations) {
  // Defensive: filter invalid
  const validHistory = digitHistory.filter(d => Number.isInteger(d) && d >= 0 && d <= 9);

  if (validHistory.length < 30) return { valid: false, reason: 'Insufficient history' };

  // Build transition matrix: matrix[from][to] = count
  const matrix = Array(10).fill(0).map(() => Array(10).fill(0));
  const fromCounts = Array(10).fill(0);

  for (let i = 0; i < validHistory.length - 1; i++) {
    const from = validHistory[i];
    const to = validHistory[i + 1];
    matrix[from][to]++;
    fromCounts[from]++;
  }

  const currentDigit = validHistory[validHistory.length - 1];
  const observationsFromCurrent = fromCounts[currentDigit];

  // Require minimum observations for current digit
  if (observationsFromCurrent < minObservations) {
    return { valid: false, reason: `Only ${observationsFromCurrent} observations for digit ${currentDigit}` };
  }

  // Calculate transition probabilities from current digit
  const transitions = matrix[currentDigit];
  const probabilities = transitions.map(t => t / observationsFromCurrent);

  // Find most likely next digit
  let maxProb = 0;
  let predictedDigit = -1;
  probabilities.forEach((p, digit) => {
    if (p > maxProb) {
      maxProb = p;
      predictedDigit = digit;
    }
  });

  // Only valid if probability significantly differs from random (significance threshold)
  const isSignificant = maxProb > quantConfig.markov.significanceThreshold;

  return {
    valid: isSignificant,
    predictedDigit,
    probability: maxProb,
    currentDigit,
    observationsFromCurrent,
    probabilities, // Full row for Bayesian
    reason: isSignificant ? `${predictedDigit} at ${(maxProb * 100).toFixed(1)}%` : 'No significant pattern'
  };
}

/**
 * Shannon Entropy for Digit Distribution
 * Returns both numeric value and formatted string for consistency
 */
function computeDigitEntropy(digitHistory, depth = quantConfig.entropy.window) {
  const validHistory = digitHistory.filter(d => Number.isInteger(d) && d >= 0 && d <= 9);

  if (validHistory.length < depth) {
    return {
      value: 3.32,
      str: '3.32',
      isPredictable: false,
      isModerate: false,
      isTooRandom: true
    };
  }

  const recent = validHistory.slice(-depth);
  const counts = Array(10).fill(0);

  for (const d of recent) {
    counts[d]++;
  }

  let entropy = 0;
  for (const count of counts) {
    if (count > 0) {
      const p = count / depth;
      entropy -= p * Math.log2(p);
    }
  }

  return {
    value: entropy,
    str: entropy.toFixed(2),
    // Use config thresholds
    isPredictable: entropy < quantConfig.entropy.predictableThreshold,
    isModerate: entropy >= quantConfig.entropy.predictableThreshold && entropy < quantConfig.entropy.chaosThreshold,
    isTooRandom: entropy >= quantConfig.entropy.chaosThreshold,
    // Legacy compatibility
    entropy: entropy,
    formatted: entropy.toFixed(2)
  };
}

/**
 * Compute circular delta for wrap-aware streak detection
 * Treats 0→9 as -1 and 9→0 as +1 (like a clock)
 */
function circularDelta(a, b) {
  // Standard delta
  const direct = b - a;

  // Circular delta: find smaller arc
  if (direct > 5) return direct - 10;  // e.g., 2→9 = -3 not +7
  if (direct < -5) return direct + 10; // e.g., 9→2 = +3 not -7
  return direct;
}

/**
 * Digit Delta Streak Detection
 * Uses circular delta if enabled in config
 */
function detectDigitDeltaStreak(digitHistory, depth = quantConfig.streak.window) {
  const validHistory = digitHistory.filter(d => Number.isInteger(d) && d >= 0 && d <= 9);

  if (validHistory.length < depth) return { streak: 0, direction: 0, meanReversion: false };

  const recent = validHistory.slice(-depth);
  let currentStreak = 0;
  let currentDirection = 0;
  let increases = 0;
  let decreases = 0;

  const useCircular = quantConfig.circularDelta.enabled;

  for (let i = 1; i < recent.length; i++) {
    const delta = useCircular
      ? circularDelta(recent[i - 1], recent[i])
      : recent[i] - recent[i - 1];

    const dir = delta > 0 ? 1 : (delta < 0 ? -1 : 0);

    if (delta > 0) increases++;
    if (delta < 0) decreases++;

    if (dir === currentDirection && dir !== 0) {
      currentStreak++;
    } else if (dir !== 0) {
      currentStreak = 1;
      currentDirection = dir;
    }
  }

  // Mean reversion: if streak >= threshold, expect reversal
  const meanReversion = currentStreak >= quantConfig.streak.meanReversionStreak;
  const suggestedDirection = meanReversion ? -currentDirection : currentDirection;

  return {
    streak: currentStreak,
    direction: currentDirection,
    meanReversion,
    suggestedDirection,
    increases,
    decreases,
    bias: increases > decreases ? 1 : (decreases > increases ? -1 : 0)
  };
}

/**
 * Digit Exhaustion Rule
 * Identifies digits that appear less frequently (likely to appear soon)
 */
function computeDigitExhaustion(digitHistory, depth = quantConfig.exhaustion.window) {
  const freq = computeDigitFrequency(digitHistory, depth);

  // Find least frequent digit (exhausted, due to appear)
  let minFreq = 1;
  let exhaustedDigit = 0;

  // Also find most frequent digit (momentum)
  let maxFreq = 0;
  let hotDigit = 0;

  freq.forEach((f, digit) => {
    if (f < minFreq) { minFreq = f; exhaustedDigit = digit; }
    if (f > maxFreq) { maxFreq = f; hotDigit = digit; }
  });

  // Exhaustion strength: how much below average is the digit?
  const avgFreq = 0.1; // 1/10 for uniform distribution
  const exhaustionStrength = (avgFreq - minFreq) / avgFreq;

  return {
    exhaustedDigit,
    exhaustedFreq: minFreq,
    hotDigit,
    hotFreq: maxFreq,
    exhaustionStrength,
    isSignificant: exhaustionStrength > quantConfig.exhaustion.threshold
  };
}

/**
 * Recent Bias Detection
 * Checks last N digits for OVER (5-9) vs UNDER (0-4) bias.
 */
function detectRecentBias(digitHistory, depth = quantConfig.bias.window) {
  const validHistory = digitHistory.filter(d => Number.isInteger(d) && d >= 0 && d <= 9);

  if (validHistory.length < depth) return { bias: 'NEUTRAL', strength: 0, suggestion: null };

  const recent = validHistory.slice(-depth);
  let over = 0;
  let under = 0;

  for (const d of recent) {
    if (d >= 5) over++;
    else under++;
  }

  const bias = over > under ? 'OVER' : (under > over ? 'UNDER' : 'NEUTRAL');
  const strength = Math.abs(over - under) / depth;

  // Mean reversion: if strong bias, expect opposite
  const meanReversion = strength > quantConfig.bias.meanReversionStrength;
  const suggestion = meanReversion ? (bias === 'OVER' ? 'UNDER' : 'OVER') : null;

  return {
    bias,
    strength,
    over,
    under,
    suggestion: strength > quantConfig.bias.strengthThreshold ? suggestion : null,
    meanReversion
  };
}

/**
 * Select optimal digit using Bayesian posterior + frequency blend
 * score = posterior * alpha + (1 - freq) * (1 - alpha)
 */
/**
 * Select optimal digit using Bayesian posterior + frequency blend
 * score = posterior * alpha + (1 - freq) * (1 - alpha)
 * Enhanced with exponential weighting for candidates
 */
function selectOptimalDigit(side, posterior, freq) {
  const alpha = quantConfig.digitSelection.posteriorWeight;

  let candidates;
  // Weighted candidate selection
  if (side === 'OVER') {
    candidates = [5, 6, 7, 8, 9];
  } else {
    candidates = [0, 1, 2, 3, 4];
  }

  let bestScore = -1;
  let bestDigit = side === 'OVER' ? 7 : 2; // Fallback

  for (const digit of candidates) {
    const posteriorProb = posterior[digit] || 0.1;
    // Lower frequency is better for "due" digits (mean reversion)
    const inverseFreq = 1 - (freq[digit] || 0.1);

    // Core Score
    let score = (posteriorProb * alpha) + (inverseFreq * (1 - alpha));

    // Bonus: If digit is 7, 8, 9 (for OVER) or 0, 1, 2 (for UNDER) -> slight structural edge in some indices
    // This is a "Market Hacker" heuristic
    if ((side === 'OVER' && digit >= 7) || (side === 'UNDER' && digit <= 2)) {
      score *= 1.05;
    }

    if (score > bestScore) {
      bestScore = score;
      bestDigit = digit;
    }
  }

  return { digit: bestDigit, score: bestScore };
}

// ==================== SIGNAL GENERATION ====================

/**
 * Generate Trading Signal - PURE DIGIT-BASED
 * (Legacy compatibility - quantEngine.js uses this internally)
 */
function generateSignal({ market, tickHistory, digitHistory, overrides = {} }) {
  // Warmup: need sufficient digit history
  if (!digitHistory || digitHistory.length < quantConfig.warmup.minDigits) {
    return {
      shouldTrade: false,
      reason: `Warmup (${quantConfig.warmup.minDigits} digits)`,
      isWarmup: true,
      confidence: 0
    };
  }

  // ==================== ANALYSIS ====================

  const entropy = computeDigitEntropy(digitHistory, quantConfig.entropy.window);
  const markov = computeMarkovPrediction(digitHistory, quantConfig.markov.minObservations);
  const exhaustion = computeDigitExhaustion(digitHistory, quantConfig.exhaustion.window);
  const streak = detectDigitDeltaStreak(digitHistory, quantConfig.streak.window);
  const recentBias = detectRecentBias(digitHistory, quantConfig.bias.window);
  const freq = computeDigitFrequency(digitHistory, quantConfig.entropy.window);

  // ==================== KILL SWITCHES ====================

  // Kill switch 1: Too random, don't trade
  if (entropy.isTooRandom) {
    return {
      shouldTrade: false,
      reason: `High entropy: ${entropy.str} (random)`,
      confidence: 0,
      entropy: entropy.value
    };
  }

  // ==================== SIGNAL LOGIC ====================

  let votes = { OVER: 0, UNDER: 0 };
  let totalWeight = 0;
  let reasonParts = [];
  let factors = 0;

  // Factor 1: Markov Prediction
  if (markov.valid) {
    const side = markov.predictedDigit >= 5 ? 'OVER' : 'UNDER';
    const weight = Math.min(markov.probability * 1.5, 1.0);
    votes[side] += weight;
    totalWeight += weight;
    factors++;
    reasonParts.push(`MKV:${markov.predictedDigit}@${(markov.probability * 100).toFixed(0)}%`);
  }

  // Factor 2: Digit Exhaustion
  if (exhaustion.isSignificant) {
    const side = exhaustion.exhaustedDigit >= 5 ? 'OVER' : 'UNDER';
    const weight = exhaustion.exhaustionStrength * 0.8;
    votes[side] += weight;
    totalWeight += weight;
    factors++;
    reasonParts.push(`EXH:${exhaustion.exhaustedDigit}`);
  }

  // Factor 3: Delta Streak Mean Reversion
  if (streak.streak >= quantConfig.streak.minStreak && streak.meanReversion) {
    const side = streak.suggestedDirection === 1 ? 'OVER' : 'UNDER';
    const weight = Math.min(streak.streak * 0.12, 0.6);
    votes[side] += weight;
    totalWeight += weight;
    factors++;
    reasonParts.push(`STK:${streak.streak}→REV`);
  }

  // Factor 4: Recent Bias Mean Reversion
  if (recentBias.suggestion && recentBias.meanReversion) {
    const weight = recentBias.strength * 0.6;
    votes[recentBias.suggestion] += weight;
    totalWeight += weight;
    factors++;
    reasonParts.push(`BIAS:${recentBias.bias}→${recentBias.suggestion}`);
  }

  // Factor 5: Entropy Bonus (when predictable)
  if (entropy.isPredictable && totalWeight > 0) {
    const majority = votes.OVER > votes.UNDER ? 'OVER' : 'UNDER';
    const bonus = 0.2;
    votes[majority] += bonus;
    totalWeight += bonus;
    reasonParts.push(`ENT:${entropy.str}✓`);
  }

  // ==================== CONTRADICTION DETECTION ====================

  const voteDiff = Math.abs(votes.OVER - votes.UNDER);
  const voteRatio = totalWeight > 0 ? voteDiff / totalWeight : 0;

  // Stricter contradiction check for "Mhacker" precision
  // If we have mixed signals (both OVER and UNDER votes > 0), require higher ratio
  const hasMixedSignals = votes.OVER > 0.2 && votes.UNDER > 0.2;
  const effectiveContradictionThreshold = hasMixedSignals
    ? quantConfig.confidence.contradictionRatio * 1.2  // Require 20% more clarity if mixed
    : quantConfig.confidence.contradictionRatio;

  if (voteRatio < effectiveContradictionThreshold && factors >= 2) {
    return {
      shouldTrade: false,
      reason: `Contradiction: O=${votes.OVER.toFixed(2)} vs U=${votes.UNDER.toFixed(2)} (Ratio: ${voteRatio.toFixed(2)} < ${effectiveContradictionThreshold.toFixed(2)})`,
      confidence: 0,
      entropy: entropy.value,
      contradiction: true
    };
  }

  // ==================== FINAL DECISION ====================

  const finalSide = votes.OVER > votes.UNDER ? 'OVER' : 'UNDER';
  const winningVote = Math.max(votes.OVER, votes.UNDER);

  // Normalized confidence
  const rawConfidence = totalWeight > 0 ? voteDiff / totalWeight : 0;
  const normalizedConfidence = Math.min(rawConfidence, 1.0);

  // Digit selection with Bayesian + frequency blend
  const markovRow = markov.valid && markov.probabilities ? markov.probabilities : Array(10).fill(0.1);
  const { digit: selectedDigit } = selectOptimalDigit(finalSide, markovRow, freq);

  // Trade requirements
  const shouldTrade = factors >= quantConfig.confidence.minFactors &&
    normalizedConfidence >= quantConfig.confidence.stableMin;

  return {
    shouldTrade,
    side: finalSide,
    digit: selectedDigit,
    confidence: normalizedConfidence,
    factors,
    reason: reasonParts.join(' '),
    market,
    analysis: {
      entropy: entropy.value,
      isPredictable: entropy.isPredictable,
      markovValid: markov.valid,
      markovProb: markov.probability || 0,
      exhaustedDigit: exhaustion.exhaustedDigit,
      streak: streak.streak,
      bias: recentBias.bias,
      votes,
      totalWeight,
      voteRatio
    },
    freq
  };
}

// Legacy compatibility
function confidenceIndex(weights, parts) {
  return 0.5; // Deprecated
}

// ==================== PRICE-BASED INDICATORS ====================

/**
 * Compute Trend Strength using Linear Regression Slope
 * Normalized to 0-1 range
 */
function computeTrendStrength(tickHistory, window = 20) {
  if (!tickHistory || tickHistory.length < window) return 0;

  const recent = tickHistory.slice(-window);
  const n = recent.length;

  // Simple linear regression
  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;

  for (let i = 0; i < n; i++) {
    sumX += i;
    sumY += recent[i];
    sumXY += i * recent[i];
    sumX2 += i * i;
  }

  const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);

  // Normalize slope (arbitrary scaling for ticks)
  // detailed tick slopes are usually small, e.g. 0.001
  // We want a value between 0 and 1.
  const strength = Math.min(Math.abs(slope) * 1000, 1.0);

  return strength;
}

/**
 * Compute Momentum Stability
 * Based on variance of returns (volatility)
 * High stability = Low volatility
 */
function computeMomentumStability(tickHistory, window = 20) {
  if (!tickHistory || tickHistory.length < window) return 0;

  const recent = tickHistory.slice(-window);
  const returns = [];

  for (let i = 1; i < recent.length; i++) {
    returns.push(recent[i] - recent[i - 1]);
  }

  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;

  const variance = returns.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / returns.length;

  // Stability is inverse of variance
  // If variance is 0 (perfect line), stability is 1.
  // If variance is high (0.1), stability approaches 0.
  const stability = 1 / (1 + variance * 10000);

  return Math.min(stability, 1.0);
}

module.exports = {
  generateSignal,
  computeDigitFrequency,
  computeDigitEntropy,
  computeMarkovPrediction,
  detectDigitDeltaStreak,
  computeDigitExhaustion,
  detectRecentBias,
  selectOptimalDigit,
  circularDelta,
  confidenceIndex,
  computeTrendStrength,
  computeMomentumStability
};