// Default strategy configuration
module.exports = {
  // Core System
  minStake: 0.35,
  rateLimitDelay: 500,
  connectionTimeout: 30000,
  requestTimeout: 15000,

  // System Defaults (Refactored)
  system: {
    defaultMarket: 'R_100',
    fallbackMarket: 'R_100',
    retryAttempts: 3
  },
  timeouts: {
    workerPause: 10000, // Circuit breaker pause
  },

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
  risk: {
    // Consolidated Risk Settings
    enabled: true,
    maxDailyLoss: 50,
    maxDrawdownPct: 15,
    maxExposure: 1000,
    maxConsecutiveLosses: 5,
    maxGlobalConcurrent: 10,
    maxConcurrentPerAsset: 3
  },
  // Legacy support for parts of the system using riskGuard
  riskGuard: {
    maxGlobalConcurrent: 10,
    maxConcurrentPerAsset: 3
  },
  rateLimits: {
    tradesPerMinute: 30,
    tradesPerHour: 500
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
  },
  // Advanced Strategy Parameters
  positionSizing: {
    enabled: true,
    baseConfidence: 0.6, // Confidence level for 1x stake
    maxMultiplier: 2.0, // Max stake multiplier (e.g. 2x stake for high confidence)
    minMultiplier: 0.5  // Min stake multiplier for low confidence
  },
  exitLogic: {
    trailingStop: {
      enabled: true,
      activationThreshold: 0.3, // Start trailing after 30% profit
      callbackRate: 0.2 // Close if profit drops 20% from peak
    },
    timeStop: {
      enabled: true,
      maxDurationTicks: 10, // Hard stop after N ticks (for tick trades)
      maxDurationSec: 60 // Hard stop after N seconds (safety)
    },
    regimeFilter: {
      strictMode: true // If true, exit immediately if regime becomes CHAOS
    },
    zombieTrade: {
      enabled: true,
      thresholdRatio: 0.15 // Close if PnL < 15% of stake
    },
    breakEven: {
      enabled: true,
      thresholdRatio: 0.25 // Activate if PnL > 25% of stake
    }
  }
};