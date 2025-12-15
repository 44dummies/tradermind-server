// Default strategy configuration
module.exports = {
  // Tier 1 (Core): R_100, R_75, R_50
  // Tier 2 (Exp):  R_25
  markets: ['R_100', 'R_75', 'R_50', 'R_25'],
  tickWindow: 50, // number of recent ticks to analyze
  digitFrequencyDepth: 20,
  minConfidence: 0.58,
  smartDelayMs: 1500,
  maxLossStreak: 5,
  apiErrorThreshold: 5,
  drawdownGuard: {
    enabled: true,
    maxDrawdownPct: 15
  },
  minBalance: 10,
  minTp: 5,
  minSl: 3,
  weighting: {
    dfpm: 0.35,
    vcs: 0.2,
    der: 0.15,
    tpc: 0.15,
    dtp: 0.1,
    dpb: 0.05
  }
};