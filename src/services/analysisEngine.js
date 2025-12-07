/**
 * Analysis Engine - PRD-Compliant Trading Strategy Implementation
 * 
 * Core Strategy: DFPM - Dynamic Frequency & Probability Mapping
 * Supporting Strategies: VCS, DER, TPC, DTP, DPB, MTD, RDS
 * 
 * Contract Types: DIGITOVER (Over 1) and DIGITUNDER (Under 8)
 */

const EventEmitter = require('events');

class AnalysisEngine extends EventEmitter {
  constructor() {
    super();

    // Confidence Index thresholds (from PRD)
    this.CI_HIGH = 0.80;     // 🟢 Execute up to 3 runs
    this.CI_MEDIUM = 0.65;   // 🟡 Execute 2 runs
    this.CI_LOW = 0.65;      // 🔴 Skip / Switch market

    this.minTicksRequired = 100; // PRD: 100 historical ticks

    // Win tracking for adaptive weighting
    this.recentTrades = [];
    this.maxRecentTrades = 5;

    // Market consistency tracking
    this.analysisHistory = []; // Last 3 analysis cycles
    this.maxAnalysisHistory = 3;
  }

  /**
   * Main PRD Analysis Flow
   * Returns trade signal if conditions are met
   */
  analyze(market, digitHistory, tickHistory) {
    if (!digitHistory || digitHistory.length < this.minTicksRequired) {
      return {
        shouldTrade: false,
        reason: `Insufficient data - need ${this.minTicksRequired} ticks, have ${digitHistory?.length || 0}`,
        confidence: 0
      };
    }

    // Phase 1: Data is already collected (digitHistory, tickHistory)

    // Phase 2: Frequency Analysis
    const frequencyMap = this.calculateFrequencyMap(digitHistory);

    // Phase 3: Calculate Confidence Index (CI)
    const CI = this.calculateConfidenceIndex(digitHistory, tickHistory, frequencyMap);

    // Phase 4: Signal Validation
    const validation = this.validateSignal(digitHistory, tickHistory, frequencyMap);

    // Run all strategies for detailed signal
    const strategies = this.runAllStrategies(digitHistory, tickHistory, frequencyMap);

    // Determine entry (Over 1 or Under 8)
    const entry = this.determineEntry(digitHistory, tickHistory, frequencyMap);

    // Store analysis for market consistency
    this.analysisHistory.push({
      timestamp: Date.now(),
      CI,
      entry: entry.side,
      market
    });
    if (this.analysisHistory.length > this.maxAnalysisHistory) {
      this.analysisHistory.shift();
    }

    // Decision based on CI level
    if (CI >= this.CI_HIGH && validation.passed) {
      return {
        shouldTrade: true,
        contractType: entry.side === 'OVER' ? 'DIGITOVER' : 'DIGITUNDER',
        prediction: entry.side === 'OVER' ? 1 : 8,
        confidence: CI,
        confidenceLevel: 'high',
        maxRuns: 3,
        reason: entry.reason,
        frequencyMap,
        strategies,
        validation
      };
    } else if (CI >= this.CI_MEDIUM && validation.passed) {
      return {
        shouldTrade: true,
        contractType: entry.side === 'OVER' ? 'DIGITOVER' : 'DIGITUNDER',
        prediction: entry.side === 'OVER' ? 1 : 8,
        confidence: CI,
        confidenceLevel: 'medium',
        maxRuns: 2,
        reason: entry.reason,
        frequencyMap,
        strategies,
        validation
      };
    }

    return {
      shouldTrade: false,
      confidence: CI,
      confidenceLevel: CI < this.CI_MEDIUM ? 'low' : 'medium',
      reason: validation.passed
        ? `CI too low: ${(CI * 100).toFixed(1)}% (need ${this.CI_MEDIUM * 100}%)`
        : validation.reason,
      frequencyMap,
      strategies,
      validation,
      suggestedAction: 'skip_or_switch_market'
    };
  }

  /**
   * Phase 2: Frequency Map Calculation
   * Counts occurrence of each digit (0-9) in the 100-tick dataset
   */
  calculateFrequencyMap(digitHistory) {
    const frequency = {};
    for (let i = 0; i <= 9; i++) frequency[i] = 0;

    digitHistory.forEach(d => frequency[d]++);

    const total = digitHistory.length;
    const probabilityMap = {};

    for (let i = 0; i <= 9; i++) {
      probabilityMap[i] = {
        count: frequency[i],
        probability: (frequency[i] / total) * 100
      };
    }

    return {
      raw: frequency,
      probabilities: probabilityMap,
      total
    };
  }

  /**
   * Phase 3: Confidence Index Calculation (PRD Formula)
   * CI = (0.4 * DB) + (0.25 * VS) + (0.15 * WR) + (0.2 * MC)
   */
  calculateConfidenceIndex(digitHistory, tickHistory, frequencyMap) {
    // Factor 1: Digit Bias Strength (DB) - 40%
    const DB = this.calculateDigitBiasStrength(frequencyMap);

    // Factor 2: Volatility Stability (VS) - 25%
    const VS = this.calculateVolatilityStability(tickHistory);

    // Factor 3: Recent Win Ratio (WR) - 15%
    const WR = this.calculateWinRatio();

    // Factor 4: Market Consistency (MC) - 20%
    const MC = this.calculateMarketConsistency();

    // PRD Formula
    const CI = (0.4 * DB) + (0.25 * VS) + (0.15 * WR) + (0.2 * MC);

    return Math.min(Math.max(CI, 0), 1); // Clamp between 0 and 1
  }

  /**
   * Digit Bias Strength - Difference between Over and Under dominant digits
   */
  calculateDigitBiasStrength(frequencyMap) {
    let overSum = 0;  // Digits 2-9 (for Over 1)
    let underSum = 0; // Digits 0-7 (for Under 8)

    for (let i = 0; i <= 9; i++) {
      if (i >= 2) overSum += frequencyMap.raw[i];
      if (i <= 7) underSum += frequencyMap.raw[i];
    }

    const total = frequencyMap.total;
    const overProb = overSum / total;
    const underProb = underSum / total;

    // Higher difference = stronger bias
    return Math.abs(overProb - underProb);
  }

  /**
   * Volatility Stability - Consistency in tick gaps
   */
  calculateVolatilityStability(tickHistory) {
    if (!tickHistory || tickHistory.length < 10) return 0.5;

    const gaps = [];
    for (let i = 1; i < Math.min(tickHistory.length, 50); i++) {
      const gap = tickHistory[i].epoch - tickHistory[i - 1].epoch;
      gaps.push(gap);
    }

    if (gaps.length === 0) return 0.5;

    const avgGap = gaps.reduce((a, b) => a + b, 0) / gaps.length;
    const variance = gaps.reduce((sum, g) => sum + Math.pow(g - avgGap, 2), 0) / gaps.length;
    const stdDev = Math.sqrt(variance);

    // Lower variance = higher stability
    // PRD: Tick interval variance <= 0.3s is stable
    const normalizedVariance = Math.min(stdDev / avgGap, 1);
    return 1 - normalizedVariance;
  }

  /**
   * Recent Win Ratio - Adaptive weighting from last 5 trades
   */
  calculateWinRatio() {
    if (this.recentTrades.length === 0) return 0.5; // Neutral if no history

    const wins = this.recentTrades.filter(t => t.result === 'win').length;
    return wins / this.recentTrades.length;
  }

  /**
   * Market Consistency - Whether the same bias has persisted across 3 cycles
   */
  calculateMarketConsistency() {
    if (this.analysisHistory.length < 3) return 0.5;

    const lastThree = this.analysisHistory.slice(-3);
    const sameDirectionCount = lastThree.filter(a => a.entry === lastThree[0].entry).length;

    return sameDirectionCount / 3;
  }

  /**
   * Phase 4: Signal Validation (Three Layers)
   */
  validateSignal(digitHistory, tickHistory, frequencyMap) {
    const results = {
      trendValidation: false,
      volatilityCheck: false,
      marketConfidence: false,
      passed: false,
      reason: ''
    };

    // Layer 1: Trend Validation - Bias consistency >= 70%
    const bias = this.determineBias(frequencyMap);
    if (this.analysisHistory.length >= 3) {
      const consistent = this.analysisHistory.filter(a => a.entry === bias).length;
      results.trendValidation = (consistent / this.analysisHistory.length) >= 0.7;
    } else {
      results.trendValidation = true; // Allow if not enough history
    }

    // Layer 2: Volatility Check - Tick gaps should be stable
    const VS = this.calculateVolatilityStability(tickHistory);
    results.volatilityCheck = VS >= 0.5;

    // Layer 3: Market Confidence Check
    const avgGap = this.getAverageTickGap(tickHistory);
    results.marketConfidence = avgGap <= 1.2; // PRD: <= 1.2s

    results.passed = results.trendValidation && results.volatilityCheck && results.marketConfidence;

    if (!results.trendValidation) {
      results.reason = 'Trend inconsistent (fluctuating bias)';
    } else if (!results.volatilityCheck) {
      results.reason = 'Volatility unstable - consider switching market';
    } else if (!results.marketConfidence) {
      results.reason = 'Tick intervals too slow';
    }

    return results;
  }

  /**
   * Determine Entry: Over 1 or Under 8
   * Based on PRD conditions
   */
  determineEntry(digitHistory, tickHistory, frequencyMap) {
    const digit1Prob = frequencyMap.probabilities[1].probability;
    const digit8Prob = frequencyMap.probabilities[8].probability;

    // Over 1 conditions (PRD)
    // - Digit "1" appears <= 7% in last 100 ticks
    // - Digits 2-9 combined probability >= 93%
    const digits2to9Prob = Object.keys(frequencyMap.probabilities)
      .filter(d => parseInt(d) >= 2)
      .reduce((sum, d) => sum + frequencyMap.probabilities[d].probability, 0);

    const overCondition = digit1Prob <= 7 && digits2to9Prob >= 93;

    // Under 8 conditions (PRD)
    // - Digit "8" appears <= 7% in last 100 ticks
    // - Digits 0-7 combined probability >= 93%
    const digits0to7Prob = Object.keys(frequencyMap.probabilities)
      .filter(d => parseInt(d) <= 7)
      .reduce((sum, d) => sum + frequencyMap.probabilities[d].probability, 0);

    const underCondition = digit8Prob <= 7 && digits0to7Prob >= 93;

    // Prefer the stronger condition
    if (overCondition && !underCondition) {
      return {
        side: 'OVER',
        reason: `Over 1 conditions met: Digit 1 at ${digit1Prob.toFixed(1)}%, Digits 2-9 at ${digits2to9Prob.toFixed(1)}%`
      };
    } else if (underCondition && !overCondition) {
      return {
        side: 'UNDER',
        reason: `Under 8 conditions met: Digit 8 at ${digit8Prob.toFixed(1)}%, Digits 0-7 at ${digits0to7Prob.toFixed(1)}%`
      };
    } else if (overCondition && underCondition) {
      // Both conditions met - pick the stronger one
      const overStrength = 93 - digits2to9Prob; // How much above threshold
      const underStrength = 93 - digits0to7Prob;

      return overStrength < underStrength
        ? { side: 'OVER', reason: 'Both conditions met, Over is stronger' }
        : { side: 'UNDER', reason: 'Both conditions met, Under is stronger' };
    }

    // Fallback to bias-based decision
    const bias = this.determineBias(frequencyMap);
    return {
      side: bias,
      reason: `No strict conditions met, using bias: ${bias}`
    };
  }

  /**
   * Determine market bias (OVER or UNDER)
   */
  determineBias(frequencyMap) {
    let overSum = 0;
    let underSum = 0;

    for (let i = 0; i <= 9; i++) {
      if (i >= 5) overSum += frequencyMap.raw[i];
      else underSum += frequencyMap.raw[i];
    }

    return overSum > underSum ? 'OVER' : 'UNDER';
  }

  /**
   * Get average tick gap
   */
  getAverageTickGap(tickHistory) {
    if (!tickHistory || tickHistory.length < 2) return 1;

    const gaps = [];
    for (let i = 1; i < Math.min(tickHistory.length, 20); i++) {
      gaps.push(tickHistory[i].epoch - tickHistory[i - 1].epoch);
    }

    return gaps.reduce((a, b) => a + b, 0) / gaps.length;
  }

  /**
   * Run all 8 strategies for detailed analysis
   */
  runAllStrategies(digitHistory, tickHistory, frequencyMap) {
    return {
      DFPM: this.DFPM(digitHistory, frequencyMap),
      VCS: this.VCS(digitHistory, tickHistory),
      DER: this.DER(digitHistory),
      TPC: this.TPC(digitHistory),
      DTP: this.DTP(digitHistory),
      DPB: this.DPB(digitHistory),
      MTD: this.MTD(digitHistory),
      RDS: this.RDS(digitHistory)
    };
  }

  // =====================================================
  // INDIVIDUAL STRATEGY IMPLEMENTATIONS
  // =====================================================

  /**
   * DFPM - Dynamic Frequency & Probability Mapping
   */
  DFPM(digitHistory, frequencyMap) {
    const sorted = Object.entries(frequencyMap.probabilities)
      .sort((a, b) => a[1].probability - b[1].probability);

    const leastFrequent = sorted[0];
    const mostFrequent = sorted[sorted.length - 1];

    return {
      signal: parseInt(leastFrequent[0]) >= 2 ? 'OVER' : 'UNDER',
      confidence: (10 - leastFrequent[1].probability) / 10,
      leastFrequentDigit: parseInt(leastFrequent[0]),
      mostFrequentDigit: parseInt(mostFrequent[0]),
      reason: `Digit ${leastFrequent[0]} least frequent (${leastFrequent[1].probability.toFixed(1)}%)`
    };
  }

  /**
   * VCS - Volatility Compression Strategy
   * Conditions: Tick interval variance <= 0.25s, digits clustered
   */
  VCS(digitHistory, tickHistory) {
    const lastTen = digitHistory.slice(-10);
    const min = Math.min(...lastTen);
    const max = Math.max(...lastTen);
    const range = max - min;

    // Compressed if range <= 4
    const isCompressed = range <= 4;
    const avgDigit = lastTen.reduce((a, b) => a + b, 0) / lastTen.length;

    return {
      signal: avgDigit < 5 ? 'OVER' : 'UNDER',
      confidence: isCompressed ? 0.7 : 0.3,
      isCompressed,
      range,
      avgDigit,
      reason: isCompressed
        ? `Compressed cluster (range ${range}), avg digit ${avgDigit.toFixed(1)}`
        : `Wide range (${range}), pattern unclear`
    };
  }

  /**
   * DER - Digit Exhaustion Reversal
   * Same digit appears >= 5 times in last 10
   */
  DER(digitHistory) {
    const lastTen = digitHistory.slice(-10);
    const frequency = {};

    lastTen.forEach(d => frequency[d] = (frequency[d] || 0) + 1);

    const sorted = Object.entries(frequency).sort((a, b) => b[1] - a[1]);
    const [exhaustedDigit, count] = [parseInt(sorted[0][0]), sorted[0][1]];

    if (count >= 5) {
      return {
        signal: exhaustedDigit <= 1 ? 'OVER' : exhaustedDigit >= 8 ? 'UNDER' : null,
        confidence: count / 10,
        exhaustedDigit,
        count,
        reason: `Digit ${exhaustedDigit} exhausted (${count}/10 appearances)`
      };
    }

    return {
      signal: null,
      confidence: 0,
      reason: 'No digit exhaustion detected'
    };
  }

  /**
   * TPC - Two-Phase Confirmation Strategy
   * Probability for direction >= 92% confirmed over 3 cycles
   */
  TPC(digitHistory) {
    const cycles = [
      digitHistory.slice(-10),
      digitHistory.slice(-20, -10),
      digitHistory.slice(-30, -20)
    ];

    const results = cycles.map(cycle => {
      const lowDigits = cycle.filter(d => d <= 4).length;
      const highDigits = cycle.filter(d => d >= 5).length;
      return lowDigits > highDigits ? 'low' : 'high';
    });

    const consistent = results.every(r => r === results[0]);

    return {
      signal: results[0] === 'low' ? 'OVER' : 'UNDER',
      confidence: consistent ? 0.85 : 0.4,
      consistent,
      cycleResults: results,
      reason: consistent
        ? `Both phases confirm ${results[0]}-digit dominance`
        : 'Phases inconsistent'
    };
  }

  /**
   * DTP - Digit Transition Probability
   * Transition pattern repeats >= 4 times in last 20
   */
  DTP(digitHistory) {
    const lastTwenty = digitHistory.slice(-20);
    const transitions = {};

    for (let i = 1; i < lastTwenty.length; i++) {
      const key = `${lastTwenty[i - 1]}->${lastTwenty[i]}`;
      transitions[key] = (transitions[key] || 0) + 1;
    }

    const sorted = Object.entries(transitions).sort((a, b) => b[1] - a[1]);

    if (sorted[0] && sorted[0][1] >= 4) {
      const [from, to] = sorted[0][0].split('->').map(Number);
      return {
        signal: to >= 2 ? 'OVER' : to <= 7 ? 'UNDER' : null,
        confidence: sorted[0][1] / 20,
        pattern: sorted[0][0],
        count: sorted[0][1],
        predictedDigit: to,
        reason: `Transition ${from}->${to} repeated ${sorted[0][1]} times`
      };
    }

    return {
      signal: null,
      confidence: 0,
      reason: 'No repeating transition pattern'
    };
  }

  /**
   * DPB - Digit Pressure Break
   * Digits stuck at boundary (0-1 or 8-9) for >= 3 ticks
   */
  DPB(digitHistory) {
    const lastFive = digitHistory.slice(-5);

    const lowBoundary = lastFive.filter(d => d <= 1).length;
    const highBoundary = lastFive.filter(d => d >= 8).length;

    if (lowBoundary >= 3) {
      return {
        signal: 'OVER',
        confidence: lowBoundary / 5,
        boundary: 'low',
        count: lowBoundary,
        reason: `Stuck at low boundary (0-1) for ${lowBoundary} ticks`
      };
    }

    if (highBoundary >= 3) {
      return {
        signal: 'UNDER',
        confidence: highBoundary / 5,
        boundary: 'high',
        count: highBoundary,
        reason: `Stuck at high boundary (8-9) for ${highBoundary} ticks`
      };
    }

    return {
      signal: null,
      confidence: 0,
      reason: 'No boundary pressure detected'
    };
  }

  /**
   * MTD - Micro-Trend Direction Bias
   * Sequence of 4-8 ticks showing continuous movement
   */
  MTD(digitHistory) {
    const lastEight = digitHistory.slice(-8);

    let upCount = 0;
    let downCount = 0;

    for (let i = 1; i < lastEight.length; i++) {
      if (lastEight[i] > lastEight[i - 1]) upCount++;
      else if (lastEight[i] < lastEight[i - 1]) downCount++;
    }

    const total = upCount + downCount;
    if (total === 0) return { signal: null, confidence: 0, reason: 'No clear trend' };

    const trendStrength = Math.max(upCount, downCount) / total;

    return {
      signal: upCount > downCount ? 'UNDER' : 'OVER', // Counter-trend
      confidence: trendStrength * 0.7,
      trend: upCount > downCount ? 'upward' : 'downward',
      upCount,
      downCount,
      reason: `Micro-trend ${upCount > downCount ? 'up' : 'down'} (${upCount}/${downCount}), betting opposite`
    };
  }

  /**
   * RDS - Repeating Digit Suppression
   * A digit repeats 2-4 times in a row
   */
  RDS(digitHistory) {
    const lastFive = digitHistory.slice(-5);

    let repeats = 1;
    const lastDigit = lastFive[lastFive.length - 1];

    for (let i = lastFive.length - 2; i >= 0; i--) {
      if (lastFive[i] === lastDigit) repeats++;
      else break;
    }

    if (repeats >= 2) {
      return {
        signal: lastDigit <= 1 ? 'OVER' : lastDigit >= 8 ? 'UNDER' : null,
        confidence: Math.min(repeats * 0.25, 0.9),
        repeatingDigit: lastDigit,
        repeats,
        reason: `Digit ${lastDigit} repeated ${repeats} times, expecting break`
      };
    }

    return {
      signal: null,
      confidence: 0,
      reason: 'No repeating digit pattern'
    };
  }

  // =====================================================
  // TRADE RESULT TRACKING
  // =====================================================

  /**
   * Record trade result for adaptive weighting
   */
  recordTradeResult(result) {
    this.recentTrades.push({
      result, // 'win' or 'loss'
      timestamp: Date.now()
    });

    if (this.recentTrades.length > this.maxRecentTrades) {
      this.recentTrades.shift();
    }
  }

  /**
   * Get current settings
   */
  getSettings() {
    return {
      CI_HIGH: this.CI_HIGH,
      CI_MEDIUM: this.CI_MEDIUM,
      minTicksRequired: this.minTicksRequired,
      recentTradesCount: this.recentTrades.length,
      analysisHistoryCount: this.analysisHistory.length
    };
  }
}

// Export singleton
module.exports = new AnalysisEngine();
