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

function pickDirection(digit) {
  // Over if digit is high, under if low
  return digit >= 5 ? 'OVER' : 'UNDER';
}

function generateSignal({ market, tickHistory, digitHistory, overrides = {} }) {
  const cfg = { ...config, ...overrides, weighting: { ...config.weighting, ...(overrides.weighting || {}) } };
  if (!tickHistory || tickHistory.length < 10) {
    return { shouldTrade: false, reason: 'Insufficient ticks' };
  }

  const freq = computeDigitFrequency(digitHistory, cfg.digitFrequencyDepth);
  const dfpmScore = Math.max(...freq);
  const derInfo = digitExhaustionRule(freq);
  const dpbInfo = digitProbabilityBias(freq);
  const tpcInfo = trendProbability(freq);
  const volatility = computeVolatility(tickHistory);

  // Normalize volatility confidence (rough heuristic)
  const vcsScore = Math.min(1, volatility / 1.0);

  // Digit Trend Prediction: blend exhaustion and bias
  const dtpScore = (derInfo.score + dpbInfo.score) / 2;
  const chosenDigit = dpbInfo.score >= derInfo.score ? dpbInfo.digit : derInfo.digit;
  const side = pickDirection(chosenDigit);

  const parts = {
    dfpm: dfpmScore,
    vcs: vcsScore,
    der: derInfo.score,
    tpc: tpcInfo.score,
    dtp: dtpScore,
    dpb: dpbInfo.score
  };

  const confidence = confidenceIndex(cfg.weighting, parts);

  return {
    shouldTrade: confidence >= cfg.minConfidence,
    side,
    digit: chosenDigit,
    confidence,
    reason: `dfpm:${dfpmScore.toFixed(2)} der:${derInfo.score.toFixed(2)} dpb:${dpbInfo.score.toFixed(2)} tpc:${tpcInfo.score.toFixed(2)} vcs:${vcsScore.toFixed(2)}`,
    market,
    parts,
    freq // Return digit frequency array for analytics
  };
}

module.exports = {
  generateSignal,
  computeDigitFrequency,
  confidenceIndex
};