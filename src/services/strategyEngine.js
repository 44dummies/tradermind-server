/**
 * Strategy Engine v2 - PURE DIGIT-BASED ANALYSIS
 * 
 * This engine focuses ONLY on digit patterns, NOT price indicators.
 * Price-based indicators (RSI, MACD, Bollinger, etc.) do NOT correlate
 * with last-digit probability and are mathematically invalid for digit prediction.
 * 
 * Valid indicators for digit prediction:
 * 1. Digit Frequency Analysis (DFPM)
 * 2. Markov Chain for digit transitions
 * 3. Shannon Entropy for randomness detection
 * 4. Digit Streak Detection (using delta, not absolute value)
 * 5. Digit Exhaustion Rule (mean reversion)
 * 6. Recent Bias Detection
 */

const config = require('../config/strategyConfig');

// ==================== DIGIT-BASED INDICATORS ====================

/**
 * Compute digit frequency distribution
 * Returns probability array for digits 0-9
 */
function computeDigitFrequency(digitHistory, depth = 20) {
  if (digitHistory.length < depth) depth = digitHistory.length;
  if (depth === 0) return Array(10).fill(0.1);

  const recent = digitHistory.slice(-depth);
  const counts = Array(10).fill(0);

  for (const d of recent) {
    if (Number.isInteger(d) && d >= 0 && d <= 9) counts[d]++;
  }

  return counts.map(c => c / depth);
}

/**
 * Markov Chain Transition Matrix for Digits
 * Predicts next digit based on transition probabilities from current digit.
 * Returns prediction only if sufficient observations exist.
 */
function computeMarkovPrediction(digitHistory, minObservations = 5) {
  if (digitHistory.length < 30) return { valid: false, reason: 'Insufficient history' };

  // Build transition matrix: matrix[from][to] = count
  const matrix = Array(10).fill(0).map(() => Array(10).fill(0));
  const fromCounts = Array(10).fill(0);

  for (let i = 0; i < digitHistory.length - 1; i++) {
    const from = digitHistory[i];
    const to = digitHistory[i + 1];
    if (Number.isInteger(from) && Number.isInteger(to) &&
      from >= 0 && from <= 9 && to >= 0 && to <= 9) {
      matrix[from][to]++;
      fromCounts[from]++;
    }
  }

  const currentDigit = digitHistory[digitHistory.length - 1];
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

  // Only valid if probability significantly differs from random (10%)
  const isSignificant = maxProb > 0.15;

  return {
    valid: isSignificant,
    predictedDigit,
    probability: maxProb,
    currentDigit,
    observationsFromCurrent,
    reason: isSignificant ? `${predictedDigit} at ${(maxProb * 100).toFixed(1)}%` : 'No significant pattern'
  };
}

/**
 * Shannon Entropy for Digit Distribution
 * Measures randomness of digit appearances.
 * Max entropy for 10 digits = log2(10) ≈ 3.32 (completely random)
 * Low entropy = predictable patterns
 * 
 * Thresholds:
 * - entropy > 3.0: Very random, avoid trading
 * - entropy 2.5-3.0: Moderate randomness, trade cautiously
 * - entropy < 2.2: Predictable patterns, good to trade
 */
function computeDigitEntropy(digitHistory, depth = 30) {
  if (digitHistory.length < depth) return { entropy: 3.32, isPredictable: false };

  const recent = digitHistory.slice(-depth);
  const counts = Array(10).fill(0);

  for (const d of recent) {
    if (Number.isInteger(d) && d >= 0 && d <= 9) counts[d]++;
  }

  let entropy = 0;
  for (const count of counts) {
    if (count > 0) {
      const p = count / depth;
      entropy -= p * Math.log2(p);
    }
  }

  return {
    entropy,
    isPredictable: entropy < 2.2,  // Correct threshold
    isModerate: entropy >= 2.2 && entropy < 2.8,
    isTooRandom: entropy >= 2.8,
    formatted: entropy.toFixed(2)
  };
}

/**
 * Digit Delta Streak Detection
 * Detects consecutive increases or decreases in digit values.
 * Uses DELTA (change direction), not absolute value comparison.
 * 
 * Mean reversion: after long streak, expect reversal
 */
function detectDigitDeltaStreak(digitHistory, depth = 12) {
  if (digitHistory.length < depth) return { streak: 0, direction: 0, meanReversion: false };

  const recent = digitHistory.slice(-depth);
  let currentStreak = 0;
  let currentDirection = 0;
  let increases = 0;
  let decreases = 0;

  for (let i = 1; i < recent.length; i++) {
    const delta = recent[i] - recent[i - 1];
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

  // Mean reversion: if streak >= 4, expect reversal
  const meanReversion = currentStreak >= 4;
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
 * Uses mean-reversion principle.
 */
function computeDigitExhaustion(digitHistory, depth = 40) {
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
    isSignificant: exhaustionStrength > 0.4 // 40% below average
  };
}

/**
 * Recent Bias Detection
 * Checks last N digits for OVER (5-9) vs UNDER (0-4) bias.
 */
function detectRecentBias(digitHistory, depth = 15) {
  if (digitHistory.length < depth) return { bias: 0, strength: 0 };

  const recent = digitHistory.slice(-depth);
  let over = 0;
  let under = 0;

  for (const d of recent) {
    if (d >= 5) over++;
    else under++;
  }

  const bias = over > under ? 'OVER' : (under > over ? 'UNDER' : 'NEUTRAL');
  const strength = Math.abs(over - under) / depth;

  // Mean reversion: if strong bias, expect opposite
  const meanReversion = strength > 0.3; // 30% imbalance
  const suggestion = meanReversion ? (bias === 'OVER' ? 'UNDER' : 'OVER') : bias;

  return {
    bias,
    strength,
    over,
    under,
    suggestion: strength > 0.2 ? suggestion : null,
    meanReversion
  };
}

// ==================== SIGNAL GENERATION ====================

/**
 * Generate Trading Signal - PURE DIGIT-BASED
 * 
 * Uses ONLY digit-pattern indicators:
 * 1. Markov transition prediction
 * 2. Entropy (trade only when predictable)
 * 3. Digit exhaustion (mean reversion)
 * 4. Delta streak (with mean reversion)
 * 5. Recent bias detection
 * 
 * Features:
 * - Contradiction detection (reject conflicting signals)
 * - Normalized confidence (0-1 scale)
 * - Kill-switch for high entropy (random market)
 */
function generateSignal({ market, tickHistory, digitHistory, overrides = {} }) {
  // Warmup: need sufficient digit history
  if (!digitHistory || digitHistory.length < 20) {
    return {
      shouldTrade: false,
      reason: 'Warmup (20 digits)',
      isWarmup: true,
      confidence: 0
    };
  }

  // ==================== ANALYSIS ====================

  const entropy = computeDigitEntropy(digitHistory, 30);
  const markov = computeMarkovPrediction(digitHistory, 5);
  const exhaustion = computeDigitExhaustion(digitHistory, 40);
  const streak = detectDigitDeltaStreak(digitHistory, 12);
  const recentBias = detectRecentBias(digitHistory, 15);
  const freq = computeDigitFrequency(digitHistory, 25);

  // ==================== KILL SWITCHES ====================

  // Kill switch 1: Too random, don't trade
  if (entropy.isTooRandom) {
    return {
      shouldTrade: false,
      reason: `High entropy: ${entropy.formatted} (random)`,
      confidence: 0,
      entropy: entropy.entropy
    };
  }

  // ==================== SIGNAL LOGIC ====================

  let votes = {
    OVER: 0,
    UNDER: 0
  };
  let totalWeight = 0;
  let reasonParts = [];
  let factors = 0;
  let contradictions = 0;

  // Factor 1: Markov Prediction (weight: 3)
  if (markov.valid) {
    const side = markov.predictedDigit >= 5 ? 'OVER' : 'UNDER';
    const weight = Math.min(markov.probability * 3, 1.5); // Cap weight
    votes[side] += weight;
    totalWeight += 1.5;
    factors++;
    reasonParts.push(`MKV:${markov.predictedDigit}@${(markov.probability * 100).toFixed(0)}%`);
  }

  // Factor 2: Digit Exhaustion (weight: 2)
  if (exhaustion.isSignificant) {
    const side = exhaustion.exhaustedDigit >= 5 ? 'OVER' : 'UNDER';
    const weight = exhaustion.exhaustionStrength * 2;
    votes[side] += weight;
    totalWeight += 1.0;
    factors++;
    reasonParts.push(`EXH:${exhaustion.exhaustedDigit}`);
  }

  // Factor 3: Delta Streak Mean Reversion (weight: 1.5)
  if (streak.streak >= 3 && streak.meanReversion) {
    // Mean reversion: trade opposite of current streak
    const side = streak.suggestedDirection === 1 ? 'OVER' : 'UNDER';
    const weight = Math.min(streak.streak * 0.3, 1.2);
    votes[side] += weight;
    totalWeight += 1.0;
    factors++;
    reasonParts.push(`STK:${streak.streak}→REV`);
  }

  // Factor 4: Recent Bias Mean Reversion (weight: 1)
  if (recentBias.suggestion && recentBias.meanReversion) {
    const weight = recentBias.strength;
    votes[recentBias.suggestion] += weight;
    totalWeight += 0.8;
    factors++;
    reasonParts.push(`BIAS:${recentBias.bias}→${recentBias.suggestion}`);
  }

  // Factor 5: Entropy Bonus (weight: 0.5 bonus when predictable)
  if (entropy.isPredictable) {
    // Bonus goes to majority vote
    const majority = votes.OVER > votes.UNDER ? 'OVER' : 'UNDER';
    votes[majority] += 0.3;
    reasonParts.push(`ENT:${entropy.formatted}✓`);
  }

  // ==================== CONTRADICTION DETECTION ====================

  // Check if votes are close (contradiction)
  const voteDiff = Math.abs(votes.OVER - votes.UNDER);
  const voteRatio = totalWeight > 0 ? voteDiff / totalWeight : 0;

  if (voteRatio < 0.2 && factors >= 2) {
    // Factors disagree too much
    contradictions = factors;
    return {
      shouldTrade: false,
      reason: `Contradiction: OVER=${votes.OVER.toFixed(2)} vs UNDER=${votes.UNDER.toFixed(2)}`,
      confidence: 0,
      entropy: entropy.entropy,
      contradictions
    };
  }

  // ==================== FINAL DECISION ====================

  const finalSide = votes.OVER > votes.UNDER ? 'OVER' : 'UNDER';
  const winningVote = Math.max(votes.OVER, votes.UNDER);
  const losingVote = Math.min(votes.OVER, votes.UNDER);

  // Normalized confidence: how much does winner beat loser?
  // Max possible weight is ~4.3, normalize to 0-1
  const rawConfidence = totalWeight > 0 ? (winningVote - losingVote) / (totalWeight + 1) : 0;
  const normalizedConfidence = Math.min(rawConfidence * 1.5, 1.0); // Scale and cap

  // Digit selection based on frequency
  let selectedDigit;
  if (finalSide === 'OVER') {
    // Pick least frequent high digit (5-9)
    const highDigits = freq.slice(5, 10);
    const minIdx = highDigits.indexOf(Math.min(...highDigits));
    selectedDigit = minIdx + 5;
  } else {
    // Pick least frequent low digit (0-4)
    const lowDigits = freq.slice(0, 5);
    const minIdx = lowDigits.indexOf(Math.min(...lowDigits));
    selectedDigit = minIdx;
  }

  // Trade requirements:
  // 1. At least 2 agreeing factors
  // 2. Confidence > 30%
  // 3. Not too random
  const shouldTrade = factors >= 2 && normalizedConfidence >= 0.30 && !entropy.isTooRandom;

  return {
    shouldTrade,
    side: finalSide,
    digit: selectedDigit,
    confidence: normalizedConfidence,
    factors,
    contradiction: contradictions > 0,
    reason: reasonParts.join(' '),
    market,
    analysis: {
      entropy: entropy.entropy,
      isPredictable: entropy.isPredictable,
      markovValid: markov.valid,
      markovProb: markov.probability || 0,
      exhaustedDigit: exhaustion.exhaustedDigit,
      streak: streak.streak,
      bias: recentBias.bias
    },
    votes,
    freq
  };
}

// Legacy function for compatibility
function confidenceIndex(weights, parts) {
  return 0.5; // Deprecated
}

module.exports = {
  generateSignal,
  computeDigitFrequency,
  computeDigitEntropy,
  computeMarkovPrediction,
  detectDigitDeltaStreak,
  computeDigitExhaustion,
  detectRecentBias,
  confidenceIndex
};