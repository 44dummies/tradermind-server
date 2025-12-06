/**
 * Analysis Engine - Implements 8 Trading Strategies
 * 
 * Strategies:
 * 1. DFPM - Digit Frequency Probability Map
 * 2. VCS - Volatility Confidence System
 * 3. DER - Digit Exhaustion Rule
 * 4. TPC - Trend Probability
 * 5. DTP - Digit Trend Prediction
 * 6. DPB - Digit Probability Bias
 * 7. MTD - Multi-Timeframe Digit Trend
 * 8. RDS - Reversal Digit Strategy
 */

class AnalysisEngine {
  constructor() {
    this.confidenceThreshold = 0.75; // 75% minimum confidence to trade
    this.minTicksRequired = 50; // Minimum ticks needed for analysis
  }

  /**
   * Main analysis function
   * Returns trade signal if CI >= threshold
   */
  analyze(market, digitHistory, tickHistory) {
    if (!digitHistory || digitHistory.length < this.minTicksRequired) {
      return {
        shouldTrade: false,
        reason: `Insufficient data - need ${this.minTicksRequired} ticks, have ${digitHistory.length}`,
        confidence: 0
      };
    }

    // Run all strategies
    const dfpm = this.DFPM(digitHistory);
    const vcs = this.VCS(digitHistory, tickHistory);
    const der = this.DER(digitHistory);
    const tpc = this.TPC(digitHistory);
    const dtp = this.DTP(digitHistory);
    const dpb = this.DPB(digitHistory);
    const mtd = this.MTD(digitHistory);
    const rds = this.RDS(digitHistory);

    // Calculate composite Confidence Index
    const strategyScores = [dfpm, vcs, der, tpc, dtp, dpb, mtd, rds];
    const validScores = strategyScores.filter(s => s.confidence > 0);
    
    if (validScores.length === 0) {
      return {
        shouldTrade: false,
        reason: 'No valid strategy signals',
        confidence: 0
      };
    }

    // Weighted average confidence
    const totalConfidence = validScores.reduce((sum, s) => sum + s.confidence, 0);
    const avgConfidence = totalConfidence / validScores.length;

    // Find consensus on side and digit
    const sideCounts = { OVER: 0, UNDER: 0 };
    const digitCounts = {};

    validScores.forEach(s => {
      if (s.side) sideCounts[s.side]++;
      if (s.digit !== undefined) {
        digitCounts[s.digit] = (digitCounts[s.digit] || 0) + 1;
      }
    });

    const consensusSide = sideCounts.OVER >= sideCounts.UNDER ? 'OVER' : 'UNDER';
    const consensusDigit = Object.keys(digitCounts).reduce((a, b) => 
      digitCounts[a] > digitCounts[b] ? a : b
    );

    // Generate signal if confidence is high enough
    if (avgConfidence >= this.confidenceThreshold) {
      return {
        shouldTrade: true,
        side: consensusSide,
        digit: parseInt(consensusDigit),
        confidence: avgConfidence,
        reason: `${validScores.length}/8 strategies agree - ${consensusSide} ${consensusDigit}`,
        strategyDetails: {
          DFPM: dfpm,
          VCS: vcs,
          DER: der,
          TPC: tpc,
          DTP: dtp,
          DPB: dpb,
          MTD: mtd,
          RDS: rds
        }
      };
    }

    return {
      shouldTrade: false,
      confidence: avgConfidence,
      reason: `Confidence too low: ${(avgConfidence * 100).toFixed(1)}% (need ${(this.confidenceThreshold * 100)}%)`,
      strategyDetails: {
        DFPM: dfpm,
        VCS: vcs,
        DER: der,
        TPC: tpc,
        DTP: dtp,
        DPB: dpb,
        MTD: mtd,
        RDS: rds
      }
    };
  }

  /**
   * Strategy 1: Digit Frequency Probability Map (DFPM)
   * Identifies overdue digits based on frequency distribution
   */
  DFPM(digitHistory) {
    const frequency = {};
    for (let i = 0; i <= 9; i++) frequency[i] = 0;

    // Count frequency
    digitHistory.forEach(d => frequency[d]++);

    // Find least frequent digit (overdue)
    const sortedDigits = Object.keys(frequency)
      .map(d => ({ digit: parseInt(d), count: frequency[d] }))
      .sort((a, b) => a.count - b.count);

    const overdueDigit = sortedDigits[0].digit;
    const expectedFreq = digitHistory.length / 10;
    const deviation = (expectedFreq - sortedDigits[0].count) / expectedFreq;

    return {
      confidence: Math.min(deviation, 0.9),
      digit: overdueDigit,
      side: overdueDigit >= 5 ? 'OVER' : 'UNDER',
      reason: `Digit ${overdueDigit} is overdue (appeared ${sortedDigits[0].count} times, expected ${expectedFreq.toFixed(1)})`
    };
  }

  /**
   * Strategy 2: Volatility Confidence System (VCS)
   * Analyzes tick volatility to determine confidence
   */
  VCS(digitHistory, tickHistory) {
    if (!tickHistory || tickHistory.length < 20) {
      return { confidence: 0 };
    }

    // Calculate volatility (standard deviation of quotes)
    const quotes = tickHistory.slice(-20).map(t => t.quote);
    const mean = quotes.reduce((sum, q) => sum + q, 0) / quotes.length;
    const variance = quotes.reduce((sum, q) => sum + Math.pow(q - mean, 2), 0) / quotes.length;
    const volatility = Math.sqrt(variance);

    // Higher volatility = lower confidence
    const normalizedVol = Math.min(volatility / mean, 1);
    const confidence = 1 - normalizedVol;

    // Get recent digit trend
    const recentDigits = digitHistory.slice(-10);
    const avgDigit = recentDigits.reduce((sum, d) => sum + d, 0) / recentDigits.length;

    return {
      confidence: confidence * 0.8,
      digit: Math.round(avgDigit),
      side: avgDigit >= 5 ? 'OVER' : 'UNDER',
      reason: `Volatility-based confidence: ${(confidence * 100).toFixed(1)}%`
    };
  }

  /**
   * Strategy 3: Digit Exhaustion Rule (DER)
   * Detects when a digit has appeared too frequently and is exhausted
   */
  DER(digitHistory) {
    const window = 20;
    const recentDigits = digitHistory.slice(-window);
    
    const frequency = {};
    for (let i = 0; i <= 9; i++) frequency[i] = 0;
    recentDigits.forEach(d => frequency[d]++);

    // Find most frequent (exhausted) digit
    const sorted = Object.keys(frequency)
      .map(d => ({ digit: parseInt(d), count: frequency[d] }))
      .sort((a, b) => b.count - a.count);

    const exhaustedDigit = sorted[0].digit;
    const expectedFreq = window / 10;
    const excess = (sorted[0].count - expectedFreq) / expectedFreq;

    // Predict opposite digit
    const oppositeDigit = 9 - exhaustedDigit;

    return {
      confidence: Math.min(excess, 0.85),
      digit: oppositeDigit,
      side: oppositeDigit >= 5 ? 'OVER' : 'UNDER',
      reason: `Digit ${exhaustedDigit} exhausted (${sorted[0].count}/${window}), betting opposite ${oppositeDigit}`
    };
  }

  /**
   * Strategy 4: Trend Probability (TPC)
   * Identifies upward or downward digit trends
   */
  TPC(digitHistory) {
    const window = 15;
    const recentDigits = digitHistory.slice(-window);
    
    if (recentDigits.length < window) {
      return { confidence: 0 };
    }

    // Calculate trend (linear regression slope)
    let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
    
    recentDigits.forEach((digit, idx) => {
      sumX += idx;
      sumY += digit;
      sumXY += idx * digit;
      sumX2 += idx * idx;
    });

    const n = recentDigits.length;
    const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
    
    // Predict next digit based on trend
    const trendDirection = slope > 0 ? 'up' : 'down';
    const lastDigit = recentDigits[recentDigits.length - 1];
    const predictedDigit = Math.max(0, Math.min(9, Math.round(lastDigit + slope)));

    return {
      confidence: Math.min(Math.abs(slope) * 2, 0.9),
      digit: predictedDigit,
      side: predictedDigit >= 5 ? 'OVER' : 'UNDER',
      reason: `Trend ${trendDirection} (slope: ${slope.toFixed(3)}), predicting ${predictedDigit}`
    };
  }

  /**
   * Strategy 5: Digit Trend Prediction (DTP)
   * Uses moving averages to predict next digit
   */
  DTP(digitHistory) {
    const shortWindow = 5;
    const longWindow = 20;

    if (digitHistory.length < longWindow) {
      return { confidence: 0 };
    }

    // Short-term and long-term moving averages
    const shortMA = digitHistory.slice(-shortWindow).reduce((sum, d) => sum + d, 0) / shortWindow;
    const longMA = digitHistory.slice(-longWindow).reduce((sum, d) => sum + d, 0) / longWindow;

    // Crossover signal
    const signal = shortMA - longMA;
    const predictedDigit = Math.round(shortMA);

    return {
      confidence: Math.min(Math.abs(signal) / 2, 0.85),
      digit: predictedDigit,
      side: predictedDigit >= 5 ? 'OVER' : 'UNDER',
      reason: `MA crossover: short=${shortMA.toFixed(1)}, long=${longMA.toFixed(1)}`
    };
  }

  /**
   * Strategy 6: Digit Probability Bias (DPB)
   * Detects systematic bias towards OVER or UNDER
   */
  DPB(digitHistory) {
    const window = 30;
    const recentDigits = digitHistory.slice(-window);

    const overCount = recentDigits.filter(d => d >= 5).length;
    const underCount = recentDigits.filter(d => d < 5).length;

    const bias = overCount > underCount ? 'OVER' : 'UNDER';
    const confidence = Math.abs(overCount - underCount) / window;

    // Bet on the bias
    const avgDigit = recentDigits.reduce((sum, d) => sum + d, 0) / recentDigits.length;
    const predictedDigit = bias === 'OVER' ? Math.ceil(avgDigit) : Math.floor(avgDigit);

    return {
      confidence: confidence * 0.8,
      digit: predictedDigit,
      side: bias,
      reason: `${bias} bias detected: ${overCount} over vs ${underCount} under`
    };
  }

  /**
   * Strategy 7: Multi-Timeframe Digit Trend (MTD)
   * Analyzes multiple timeframes for consensus
   */
  MTD(digitHistory) {
    const timeframes = [10, 20, 50];
    const predictions = [];

    timeframes.forEach(window => {
      if (digitHistory.length >= window) {
        const segment = digitHistory.slice(-window);
        const avg = segment.reduce((sum, d) => sum + d, 0) / segment.length;
        predictions.push(avg);
      }
    });

    if (predictions.length === 0) {
      return { confidence: 0 };
    }

    const consensus = predictions.reduce((sum, p) => sum + p, 0) / predictions.length;
    const predictedDigit = Math.round(consensus);

    // Confidence based on how aligned the timeframes are
    const variance = predictions.reduce((sum, p) => sum + Math.pow(p - consensus, 2), 0) / predictions.length;
    const confidence = Math.max(0, 1 - Math.sqrt(variance));

    return {
      confidence: confidence * 0.85,
      digit: predictedDigit,
      side: predictedDigit >= 5 ? 'OVER' : 'UNDER',
      reason: `Multi-timeframe consensus: ${predictedDigit} (variance: ${variance.toFixed(2)})`
    };
  }

  /**
   * Strategy 8: Reversal Digit Strategy (RDS)
   * Detects reversal points in digit sequences
   */
  RDS(digitHistory) {
    const window = 10;
    const recentDigits = digitHistory.slice(-window);

    if (recentDigits.length < window) {
      return { confidence: 0 };
    }

    // Detect consecutive increases/decreases
    let streak = 1;
    let direction = null;

    for (let i = 1; i < recentDigits.length; i++) {
      const currentDirection = recentDigits[i] > recentDigits[i - 1] ? 'up' : 'down';
      
      if (direction === null) {
        direction = currentDirection;
      } else if (direction === currentDirection) {
        streak++;
      } else {
        break;
      }
    }

    // Predict reversal after long streak
    const lastDigit = recentDigits[recentDigits.length - 1];
    const reversalThreshold = 4;

    if (streak >= reversalThreshold) {
      const predictedDigit = direction === 'up' 
        ? Math.max(0, lastDigit - 2)
        : Math.min(9, lastDigit + 2);

      return {
        confidence: Math.min(streak / 10, 0.9),
        digit: predictedDigit,
        side: predictedDigit >= 5 ? 'OVER' : 'UNDER',
        reason: `Reversal signal after ${streak} ${direction} moves`
      };
    }

    return {
      confidence: 0,
      reason: 'No reversal pattern detected'
    };
  }

  /**
   * Smart delay - revalidate signal after 1 tick
   */
  async smartDelay(market, tickCollector, initialSignal) {
    return new Promise((resolve) => {
      const validator = (tickData) => {
        if (tickData.market === market) {
          // Remove listener
          tickCollector.removeListener('tick', validator);

          // Re-analyze with new tick
          const newDigitHistory = tickCollector.getDigitHistory(market);
          const newTickHistory = tickCollector.getTickHistory(market);
          const revalidatedSignal = this.analyze(market, newDigitHistory, newTickHistory);

          // Check if signal still valid
          if (revalidatedSignal.shouldTrade && 
              revalidatedSignal.side === initialSignal.side &&
              revalidatedSignal.digit === initialSignal.digit) {
            resolve({
              valid: true,
              signal: revalidatedSignal
            });
          } else {
            resolve({
              valid: false,
              reason: 'Signal invalidated after 1 tick',
              initialSignal,
              revalidatedSignal
            });
          }
        }
      };

      tickCollector.on('tick', validator);

      // Timeout after 60 seconds
      setTimeout(() => {
        tickCollector.removeListener('tick', validator);
        resolve({
          valid: false,
          reason: 'Smart delay timeout'
        });
      }, 60000);
    });
  }

  /**
   * Set confidence threshold
   */
  setConfidenceThreshold(threshold) {
    this.confidenceThreshold = Math.max(0, Math.min(1, threshold));
    console.log(`[AnalysisEngine] Confidence threshold set to ${(this.confidenceThreshold * 100).toFixed(1)}%`);
  }

  /**
   * Get current settings
   */
  getSettings() {
    return {
      confidenceThreshold: this.confidenceThreshold,
      minTicksRequired: this.minTicksRequired
    };
  }
}

module.exports = new AnalysisEngine();
