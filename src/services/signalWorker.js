const strategyEngine = require('./strategyEngine');
const tickCollector = require('./tickCollector');
const tradeExecutor = require('./tradeExecutor');
const config = require('../config/strategyConfig');
const { supabase } = require('../db/supabase');
const { logSignal } = require('../routes/debug');
const { captureError, trackEvent } = require('../utils/alert');

/**
 * Signal Worker (initial version)
 * - Subscribes to configured markets
 * - Generates signals from tick buffers
 * - Applies smart delay revalidation
 * - Hands off to tradeExecutor
 *
 * Note: Not auto-started. Wire this into bot start/stop when ready.
 */
class SignalWorker {
  constructor() {
    this.interval = null;
    this.smartDelayTimers = new Map(); // market -> timeout id
    this.sessionId = null;
    this.latestStats = {}; // market -> stats object
    this.lastSignal = null;
    this.io = null; // Socket.IO instance
  }

  getLatestStats() {
    return this.latestStats;
  }

  setSocket(io) {
    this.io = io;
  }

  async start(sessionId, markets = config.markets, apiToken = process.env.DERIV_API_TOKEN, sessionTable = 'trading_sessions') {
    this.sessionId = sessionId;
    this.sessionTable = sessionTable;
    // Ensure connection
    if (!tickCollector.isConnected()) {
      await tickCollector.connect(apiToken);
    }

    markets.forEach(m => tickCollector.subscribeTicks(m));

    // Run every 3 seconds
    this.interval = setInterval(() => this.tick(markets), 3000);
    console.log('[SignalWorker] ✅ started');
  }

  stop() {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }

    for (const timer of this.smartDelayTimers.values()) {
      clearTimeout(timer);
    }
    this.smartDelayTimers.clear();
    console.log('[SignalWorker] ⏹ stopped');
  }

  async tick(markets) {
    // Ensure session is still running
    const { data: session, error } = await supabase
      .from(this.sessionTable || 'trading_sessions')
      .select('*')
      .eq('id', this.sessionId)
      .single();

    if (error) {
      console.error('[SignalWorker] ❌ Session query error:', error.message);
      return;
    }

    if (!session) {
      console.error('[SignalWorker] ❌ Session not found:', this.sessionId);
      return;
    }

    if (session.status !== 'running' && session.status !== 'active') {
      console.log(`[SignalWorker] ⏸️ Session status is "${session.status}", not running/active. Skipping.`);
      return;
    }

    // Drawdown guard
    if (config.drawdownGuard?.enabled) {
      const { data: pnlAgg } = await supabase
        .from('trades')
        .select('profit_loss', { count: 'exact', head: true })
        .eq('session_id', this.sessionId)
        .neq('profit_loss', null)
        .limit(1);
      const netPnl = (pnlAgg && pnlAgg.reduce) ? pnlAgg.reduce((a, b) => a + (b.profit_loss || 0), 0) : 0;
      const balanceRef = session.min_balance || 1;
      const ddPct = balanceRef ? (Math.abs(netPnl) / balanceRef) * 100 : 0;
      if (netPnl < 0 && ddPct >= config.drawdownGuard.maxDrawdownPct) {
        tradeExecutor.paused = true;
        console.error('[SignalWorker] Drawdown guard triggered, pausing executor');
        return;
      }
    }

    let best = null;
    for (const market of markets) {
      const ticks = tickCollector.getTickHistory(market);
      const digits = tickCollector.getDigitHistory(market);

      // Log tick collection status
      console.log(`[SignalWorker] 📊 ${market}: ${ticks.length} ticks, ${digits.length} digits`);

      // Emit tick update to market room
      if (this.io && ticks.length > 0) {
        const latestTick = ticks[ticks.length - 1];
        this.io.to(`market_${market}`).emit('tick_update', {
          market,
          tick: latestTick.quote,
          time: latestTick.epoch
        });
      }

      const signal = strategyEngine.generateSignal({
        market,
        tickHistory: ticks,
        digitHistory: digits,
        overrides: {} // Could load from session config
      });

      // Emit signal analysis update to market room
      if (this.io) {
        this.io.to(`market_${market}`).emit('signal_update', {
          market,
          ...signal,
          timestamp: new Date().toISOString()
        });
      }

      // Store stats for analytics
      this.latestStats[market] = {
        timestamp: new Date(),
        parts: signal.parts,
        freq: signal.freq,
        confidence: signal.confidence,
        side: signal.side,
        digit: signal.digit
      };

      // Log to debug buffer for /debug/signals endpoint
      logSignal({
        symbol: market,
        price: ticks.length > 0 ? ticks[ticks.length - 1].quote : 0,
        indicators: signal.parts || {},
        conditionsPassed: signal.shouldTrade ? ['CONFIDENCE_OK'] : [],
        conditionsFailed: signal.shouldTrade ? [] : ['CONFIDENCE_LOW'],
        signalGenerated: signal.shouldTrade,
        signalType: signal.side?.toLowerCase() === 'over' ? 'call' : 'put',
        confidence: signal.confidence || 0
      });

      // Log signal result
      if (signal.shouldTrade) {
        console.log(`[SignalWorker] ✅ Signal generated: ${signal.side} digit ${signal.digit} (confidence: ${(signal.confidence * 100).toFixed(1)}%)`);
      } else {
        console.log(`[SignalWorker] ⏳ No trade signal: ${signal.reason || 'confidence too low'}`);
      }

      if (!signal.shouldTrade) continue;

      if (!best || signal.confidence > best.confidence) {
        best = signal;
      }
    }

    if (!best) {
      console.log('[SignalWorker] ⏳ No qualifying signal this tick');
      return;
    }

    if (this.smartDelayTimers.has(best.market)) {
      console.log(`[SignalWorker] ⏳ Smart delay active for ${best.market}, waiting...`);
      return;
    }

    const timer = setTimeout(async () => {
      this.smartDelayTimers.delete(best.market);
      const freshTicks = tickCollector.getTickHistory(best.market);
      const freshDigits = tickCollector.getDigitHistory(best.market);
      const revalidated = strategyEngine.generateSignal({ market: best.market, tickHistory: freshTicks, digitHistory: freshDigits });

      if (!revalidated.shouldTrade) {
        console.log('[SignalWorker] Smart delay vetoed trade for', best.market);
        return;
      }

      // Log strategy decision
      await supabase.from('trading_activity_logs').insert({
        action_type: 'signal',
        action_details: {
          level: 'info',
          message: `Signal ${revalidated.side} digit ${revalidated.digit} conf ${revalidated.confidence.toFixed(2)}`,
          market: revalidated.market,
          parts: revalidated.parts
        },
        session_id: this.sessionId,
        created_at: new Date().toISOString()
      });

      try {
        await tradeExecutor.executeMultiAccountTrade(revalidated, this.sessionId, this.sessionTable);
        trackEvent('TRADE_EXECUTED', { market: revalidated.market, side: revalidated.side, confidence: revalidated.confidence });
      } catch (error) {
        console.error('[SignalWorker] Trade execution error:', error);
        captureError(error, { market: revalidated.market, sessionId: this.sessionId, phase: 'execution' });
      }
    }, config.smartDelayMs || 1500);

    this.smartDelayTimers.set(best.market, timer);
  }
}

module.exports = new SignalWorker();