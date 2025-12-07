const strategyEngine = require('./strategyEngine');
const tickCollector = require('./tickCollector');
const tradeExecutor = require('./tradeExecutor');
const config = require('../config/strategyConfig');
const { supabase } = require('../db/supabase');

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
  }

  getLatestStats() {
    return this.latestStats;
  }

  async start(sessionId, markets = config.markets, apiToken = process.env.DERIV_API_TOKEN) {
    this.sessionId = sessionId;
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
      .from('trading_sessions_v2')
      .select('*')
      .eq('id', this.sessionId)
      .single();

    if (error || !session || session.status !== 'running') {
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
      const signal = strategyEngine.generateSignal({
        market,
        tickHistory: ticks,
        digitHistory: digits,
        overrides: {} // Could load from session config
      });

      // Store stats for analytics
      this.latestStats[market] = {
        timestamp: new Date(),
        parts: signal.parts,
        freq: signal.freq,
        confidence: signal.confidence,
        side: signal.side,
        digit: signal.digit
      };

      if (!signal.shouldTrade) continue;

      if (!best || signal.confidence > best.confidence) {
        best = signal;
      }
    }

    if (!best || this.smartDelayTimers.has(best.market)) return;

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
      await supabase.from('activity_logs_v2').insert({
        type: 'signal',
        level: 'info',
        message: `Signal ${revalidated.side} digit ${revalidated.digit} conf ${revalidated.confidence.toFixed(2)}`,
        metadata: { market: revalidated.market, parts: revalidated.parts },
        session_id: this.sessionId,
        created_at: new Date().toISOString()
      });

      try {
        await tradeExecutor.executeMultiAccountTrade(revalidated, this.sessionId);
      } catch (error) {
        console.error('[SignalWorker] Trade execution error:', error);
      }
    }, config.smartDelayMs || 1500);

    this.smartDelayTimers.set(best.market, timer);
  }
}

module.exports = new SignalWorker();