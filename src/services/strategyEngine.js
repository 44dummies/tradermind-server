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

// ==================== Additional Advanced Math Models ====================

/**
 * Bollinger Bands
 * Returns upper, middle (SMA), lower bands and %B position indicator.
 * %B > 1 = overbought, %B < 0 = oversold
 */
function computeBollingerBands(ticks, period = 20, multiplier = 2) {
  if (ticks.length < period) return { upper: 0, middle: 0, lower: 0, percentB: 0.5 };

  const recent = ticks.slice(-period).map(t => t.quote);
  const sma = recent.reduce((a, b) => a + b, 0) / period;

  // Standard deviation
  const variance = recent.reduce((sum, val) => sum + Math.pow(val - sma, 2), 0) / period;
  const stdDev = Math.sqrt(variance);

  const upper = sma + (multiplier * stdDev);
  const lower = sma - (multiplier * stdDev);
  const currentPrice = ticks[ticks.length - 1].quote;

  // %B = (Price - Lower Band) / (Upper Band - Lower Band)
  const percentB = (upper - lower) !== 0 ? (currentPrice - lower) / (upper - lower) : 0.5;

  return { upper, middle: sma, lower, percentB, stdDev };
}

/**
 * Shannon Entropy for Digit Distribution
 * Measures randomness/predictability of digits.
 * Low entropy = more predictable patterns, High entropy = more random
 * Returns 0-3.32 range (log2(10) max for 10 digits)
 */
function computeDigitEntropy(digitHistory, depth = 30) {
  if (digitHistory.length < depth) return 3.32; // Max entropy = assume random

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

  return entropy;
}

/**
 * EMA Crossover Signal
 * Computes fast and slow EMAs, returns crossover direction.
 * 1 = bullish crossover (fast > slow), -1 = bearish crossover, 0 = neutral
 */
function computeEMACrossover(ticks, fastPeriod = 5, slowPeriod = 12) {
  if (ticks.length < slowPeriod + 2) return { signal: 0, fastEMA: 0, slowEMA: 0 };

  const prices = ticks.map(t => t.quote);

  function ema(data, period) {
    const k = 2 / (period + 1);
    let emaVal = data.slice(0, period).reduce((a, b) => a + b, 0) / period;
    for (let i = period; i < data.length; i++) {
      emaVal = data[i] * k + emaVal * (1 - k);
    }
    return emaVal;
  }

  const fastEMA = ema(prices, fastPeriod);
  const slowEMA = ema(prices, slowPeriod);

  // Previous EMAs for crossover detection
  const prevPrices = prices.slice(0, -1);
  const prevFastEMA = ema(prevPrices, fastPeriod);
  const prevSlowEMA = ema(prevPrices, slowPeriod);

  // Bullish crossover: fast crosses above slow
  // Bearish crossover: fast crosses below slow
  let signal = 0;
  if (prevFastEMA <= prevSlowEMA && fastEMA > slowEMA) signal = 1;  // Bullish
  if (prevFastEMA >= prevSlowEMA && fastEMA < slowEMA) signal = -1; // Bearish

  return { signal, fastEMA, slowEMA, diff: fastEMA - slowEMA };
}

/**
 * Momentum Ratio
 * Measures rate of change over N periods.
 * Positive = upward momentum, Negative = downward momentum
 */
function computeMomentum(ticks, period = 10) {
  if (ticks.length < period + 1) return 0;

  const current = ticks[ticks.length - 1].quote;
  const past = ticks[ticks.length - 1 - period].quote;

  // Momentum as percentage change
  return past !== 0 ? ((current - past) / past) * 100 : 0;
}

function pickDirection(digit) {
  // Over if digit is high, under if low
  return digit >= 5 ? 'OVER' : 'UNDER';
}

function generateSignal({ market, tickHistory, digitHistory, overrides = {} }) {
  const cfg = { ...config, ...overrides, weighting: { ...config.weighting, ...(overrides.weighting || {}) } };

  if (!tickHistory || tickHistory.length < 10) {
    return { shouldTrade: false, reason: 'Insufficient ticks (Warmup)', isWarmup: true };
  }

  // ==================== Multi-Factor Analysis ====================

  // 1. Markov Chain Probability
  const markov = computeMarkovProbability(digitHistory);

  // 2. Technical Indicators
  const rsi = computeRSI(tickHistory, 14);
  const slope = computeLinearRegressionSlope(tickHistory, 10);
  const bollinger = computeBollingerBands(tickHistory, 15, 2);
  const emaCross = computeEMACrossover(tickHistory, 5, 12);
  const momentum = computeMomentum(tickHistory, 8);

  // 3. Pattern Analysis
  const entropy = computeDigitEntropy(digitHistory, 25);
  const freq = computeDigitFrequency(digitHistory, cfg.digitFrequencyDepth);
  const dfpmScore = Math.max(...freq);

  // ==================== Signal Logic with Multi-Factor Confirmation ====================
  let side = null;
  let confidence = 0;
  let reasonParts = [];
  let confirmations = 0;

  // === Factor 1: Markov Prediction (Primary) ===
  if (markov.probability > 0.3 && markov.predictedDigit !== null) {
    const predictedSide = pickDirection(markov.predictedDigit);
    confidence += markov.probability * 0.5; // 50% base weight
    reasonParts.push(`MKV:${markov.probability.toFixed(2)}`);
    side = predictedSide;
    confirmations++;
  }

  // === Factor 2: RSI Reversal ===
  if (rsi > 70) {
    if (side === 'UNDER' || !side) {
      side = 'UNDER';
      confidence += 0.15;
      reasonParts.push(`RSI:${rsi.toFixed(0)}↓`);
      confirmations++;
    }
  } else if (rsi < 30) {
    if (side === 'OVER' || !side) {
      side = 'OVER';
      confidence += 0.15;
      reasonParts.push(`RSI:${rsi.toFixed(0)}↑`);
      confirmations++;
    }
  }

  // === Factor 3: Bollinger Band Position ===
  if (bollinger.percentB > 0.95) {
    // Price near upper band - expect reversal down
    if (side === 'UNDER' || !side) {
      side = 'UNDER';
      confidence += 0.12;
      reasonParts.push(`BB:OB`);
      confirmations++;
    }
  } else if (bollinger.percentB < 0.05) {
    // Price near lower band - expect reversal up
    if (side === 'OVER' || !side) {
      side = 'OVER';
      confidence += 0.12;
      reasonParts.push(`BB:OS`);
      confirmations++;
    }
  }

  // === Factor 4: EMA Crossover ===
  if (emaCross.signal === 1) {
    // Bullish crossover
    if (side === 'OVER' || !side) {
      side = 'OVER';
      confidence += 0.10;
      reasonParts.push(`EMA:↑`);
      confirmations++;
    }
  } else if (emaCross.signal === -1) {
    // Bearish crossover
    if (side === 'UNDER' || !side) {
      side = 'UNDER';
      confidence += 0.10;
      reasonParts.push(`EMA:↓`);
      confirmations++;
    }
  }

  // === Factor 5: Momentum Confirmation ===
  if (momentum > 0.1 && (side === 'OVER' || !side)) {
    side = side || 'OVER';
    confidence += 0.08;
    reasonParts.push(`MOM:+`);
    confirmations++;
  } else if (momentum < -0.1 && (side === 'UNDER' || !side)) {
    side = side || 'UNDER';
    confidence += 0.08;
    reasonParts.push(`MOM:-`);
    confirmations++;
  }

  // === Factor 6: Trend Slope Confirmation ===
  const isTrendAligned = (side === 'OVER' && slope > 0) || (side === 'UNDER' && slope < 0);
  if (isTrendAligned) {
    confidence += 0.10;
    reasonParts.push(`TRD:${slope > 0 ? '↑' : '↓'}`);
    confirmations++;
  }

  // === Factor 7: Low Entropy Bonus (Predictable Pattern) ===
  // Low entropy means digits are less random, more predictable
  if (entropy < 2.5) {
    confidence += 0.08;
    reasonParts.push(`ENT:${entropy.toFixed(1)}`);
    confirmations++;
  }

  // === Factor 8: Digit Frequency Confirmation ===
  if (dfpmScore > 0.18) {
    confidence += 0.07;
    confirmations++;
  }

  // === Multi-Factor Confirmation Bonus ===
  // More confirmations = higher confidence
  if (confirmations >= 4) {
    confidence += 0.15; // Strong multi-factor confirmation
    reasonParts.push(`CF:${confirmations}`);
  } else if (confirmations >= 3) {
    confidence += 0.08;
  }

  // Final Decision
  const finalSide = side || 'UNDER';
  const finalDigit = finalSide === 'OVER' ? 7 : 2;

  // Require at least 2 confirming factors and 40% confidence
  const shouldTrade = confidence >= 0.40 && confirmations >= 2;

  return {
    shouldTrade,
    side: finalSide,
    digit: finalDigit,
    confidence,
    confirmations,
    reason: reasonParts.join(' '),
    market,
    parts: {
      markov: markov.probability,
      rsi,
      slope,
      bollinger: bollinger.percentB,
      emaCross: emaCross.signal,
      momentum,
      entropy
    },
    freq
  };
}

module.exports = {
  generateSignal,
  computeDigitFrequency,
  confidenceIndex
};