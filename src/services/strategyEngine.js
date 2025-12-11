const config = require('../config/strategyConfig');

/**
 * Strategy Engine (initial implementation)
 * Computes digit probabilities from recent ticks and returns trade signal.
 * This is a first cut: DFPM/DER/DPB + simple volatility and trend components.
 */
function computeDigitFrequency(digitHistory, depth = config.digitFrequencyDepth) {
  const recent = digitHistory.slice(-depth);
  const counts = Array(10).fill(0);
  for (const d of recent) {
    if (Number.isInteger(d) && d >= 0 && d <= 9) counts[d] += 1;
  }
  const total = recent.length || 1;
  return counts.map(c => c / total);
}

function computeVolatility(ticks) {
  const recent = ticks.slice(-20);
  if (recent.length < 2) return 0;
  const diffs = [];
  for (let i = 1; i < recent.length; i++) {
    diffs.push(Math.abs(recent[i].quote - recent[i - 1].quote));
  }
  const avg = diffs.reduce((a, b) => a + b, 0) / diffs.length;
  return avg;
}

function digitExhaustionRule(freq) {
  // Prefer digits that recently appeared less (mean-reversion)
  const min = Math.min(...freq);
  const digit = freq.findIndex(v => v === min);
  return { digit, score: 1 - min };
}

function digitProbabilityBias(freq) {
  // Bias towards most frequent digit (momentum)
  const max = Math.max(...freq);
  const digit = freq.findIndex(v => v === max);
  return { digit, score: max };
}

function trendProbability(freq) {
  // Simple spread between top and median frequency
  const sorted = [...freq].sort((a, b) => b - a);
  const top = sorted[0];
  const median = sorted[Math.min(sorted.length - 1, 4)];
  const score = Math.max(0, top - median);
  const digit = freq.indexOf(top);
  return { digit, score };
}

function confidenceIndex(weights, parts) {
  const { dfpm, vcs, der, tpc, dtp, dpb } = weights;
  return (
    parts.dfpm * dfpm +
    parts.vcs * vcs +
    parts.der * der +
    parts.tpc * tpc +
    parts.dtp * dtp +
    parts.dpb * dpb
  );
}

// ==================== Advanced Math Models ====================

/**
 * Markov Chain Analysis
 * Calculates the probability of the *next* digit given the *current* digit.
 * Returns probability score (0-1) for the momentum direction.
 */
function computeMarkovProbability(digitHistory) {
  if (digitHistory.length < 50) return { probability: 0.5, prediction: null };

  const matrix = Array(10).fill(0).map(() => Array(10).fill(0));
  const counts = Array(10).fill(0);

  // Build Transition Matrix
  for (let i = 0; i < digitHistory.length - 1; i++) {
    const current = digitHistory[i];
    const next = digitHistory[i + 1];
    matrix[current][next]++;
    counts[current]++;
  }

  const lastDigit = digitHistory[digitHistory.length - 1];
  const transitions = matrix[lastDigit];
  const totalObserved = counts[lastDigit];

  if (totalObserved < 3) return { probability: 0.5, prediction: null }; // Not enough data for this specific digit

  // Find most probable next digit
  let maxCount = -1;
  let predictedDigit = -1;

  transitions.forEach((count, digit) => {
    if (count > maxCount) {
      maxCount = count;
      predictedDigit = digit;
    }
  });

  const probability = maxCount / totalObserved;
  return { probability, predictedDigit };
}

/**
 * Relative Strength Index (RSI)
 * Standard 14-period RSI to detect overbought/oversold conditions.
 * Returns RSI value (0-100).
 */
function computeRSI(ticks, period = 14) {
  if (ticks.length < period + 1) return 50;

  let gains = 0;
  let losses = 0;

  // Calculate initial average
  for (let i = ticks.length - period; i < ticks.length; i++) {
    const diff = ticks[i].quote - ticks[i - 1].quote;
    if (diff >= 0) gains += diff;
    else losses += Math.abs(diff);
  }

  let avgGain = gains / period;
  let avgLoss = losses / period;

  const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
}

/**
 * Linear Regression Slope
 * Calculates the slope of the trend line for the last N ticks.
 * Returns slope value (steepness and direction).
 */
function computeLinearRegressionSlope(ticks, length = 10) {
  if (ticks.length < length) return 0;

  const n = length;
  const recent = ticks.slice(-n);

  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumXX = 0;

  recent.forEach((tick, i) => {
    const x = i;
    const y = tick.quote;
    sumX += x;
    sumY += y;
    sumXY += x * y;
    sumXX += x * x;
  });

  const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
  return slope;
}

function pickDirection(digit) {
  // Over if digit is high, under if low
  return digit >= 5 ? 'OVER' : 'UNDER';
}

function generateSignal({ market, tickHistory, digitHistory, overrides = {} }) {
  const cfg = { ...config, ...overrides, weighting: { ...config.weighting, ...(overrides.weighting || {}) } };

  if (!tickHistory || tickHistory.length < 20) {
    return { shouldTrade: false, reason: 'Insufficient ticks (Warmup)', isWarmup: true };
  }

  // 1. Math Analysis
  const markov = computeMarkovProbability(digitHistory);
  const rsi = computeRSI(tickHistory, 14);
  const slope = computeLinearRegressionSlope(tickHistory, 10);

  // 2. Frequency Analysis (Legacy but useful for confirmation)
  const freq = computeDigitFrequency(digitHistory, cfg.digitFrequencyDepth);
  const dfpmScore = Math.max(...freq);

  // 3. Signal Logic
  let side = null;
  let confidence = 0;
  let reasonParts = [];

  // STRATEGY: Markov + RSI Reversal + Trend Confirmation

  // Case A: Strong Markov Prediction
  if (markov.probability > 0.4 && markov.predictedDigit !== null) {
    // If Markov predicts a high digit (>=5), we expect OVER? 
    // Actually, distinct digit markets are chaotic. 
    // Let's use Markov to predict direction.
    const predictedSide = pickDirection(markov.predictedDigit);
    confidence += markov.probability * 0.4; // 40% weight
    reasonParts.push(`MKV:${markov.probability.toFixed(2)}`);
    side = predictedSide;
  }

  // Case B: RSI Reversal (Overbought/Oversold)
  if (rsi > 70) {
    // Overbought -> Expect Drop -> Sell/Under/Put
    // For digit markets, "Put" usually aligns with "Under" or predicting low digits.
    // Let's assume we want to bet UNDER if RSI is high.
    if (side === 'UNDER' || !side) {
      side = 'UNDER';
      confidence += 0.3; // 30% weight
      reasonParts.push(`RSI_High:${rsi.toFixed(0)}`);
    } else {
      confidence -= 0.1; // Conflict
    }
  } else if (rsi < 30) {
    // Oversold -> Expect Rise -> Buy/Over/Call
    if (side === 'OVER' || !side) {
      side = 'OVER';
      confidence += 0.3; // 30% weight
      reasonParts.push(`RSI_Low:${rsi.toFixed(0)}`);
    } else {
      confidence -= 0.1; // Conflict
    }
  }

  // Case C: Trend Slope Confirmation
  // If we are betting OVER (Up), we want positive slope.
  // If we are betting UNDER (Down), we want negative slope.
  const isTrendAligned = (side === 'OVER' && slope > 0) || (side === 'UNDER' && slope < 0);
  if (isTrendAligned) {
    confidence += 0.2; // 20% weight
    reasonParts.push(`Trend:${slope > 0 ? 'Up' : 'Down'}`);
  }

  // Legacy Freq confirm
  if (side === 'OVER' && dfpmScore > 0.15) confidence += 0.1;
  if (side === 'UNDER' && dfpmScore > 0.15) confidence += 0.1;

  // Final Decision
  // Default to UNDER if no clear signal but we need a side for the object structure
  const finalSide = side || 'UNDER';
  const finalDigit = side === 'OVER' ? 7 : 2; // Arbitrary safe digits for directional bets

  return {
    shouldTrade: confidence >= 0.65, // Require 65% composite confidence
    side: finalSide, // 'OVER' or 'UNDER' (mapped to Call/Put in executor)
    digit: finalDigit,
    confidence,
    reason: reasonParts.join(' '),
    market,
    parts: { markov: markov.probability, rsi, slope },
    freq
  };
}

module.exports = {
  generateSignal,
  computeDigitFrequency,
  confidenceIndex
};