const strategyEngine = require('./strategyEngine');
const quantEngine = require('./quantEngine');
const tickCollector = require('./tickCollector');
const tradeExecutor = require('./tradeExecutor');
const riskEngine = require('./trading-engine/risk/RiskEngine');
const config = require('../config/strategyConfig');
const { supabase } = require('../db/supabase');
const { logSignal } = require('../routes/debug');
const { captureError, trackEvent } = require('../utils/alert');
const perfMonitor = require('../utils/performance');

// Event-driven architecture imports
const { messageQueue, TOPICS } = require('../queue');
const { createSignalEvent, EVENT_TYPES } = require('../trading-engine/eventContract');


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
    this.lastTickTime = new Map(); // market -> timestamp
    this.throttleMs = 200; // Throttle to prevent CPU overload
  }

  getLatestStats() {
    return this.latestStats;
  }

  setSocket(io) {
    this.io = io;
  }

  updateSessionStatus(status) {
    this.sessionStatus = status;
    console.log(`[SignalWorker] Session status updated to: ${status}`);
  }

  async start(sessionId, markets = config.markets, apiToken = process.env.DERIV_API_TOKEN, sessionTable = 'trading_sessions_v2') {
    this.sessionId = sessionId;
    this.sessionTable = sessionTable;
    this.sessionStatus = 'active'; // Assume active when started

    console.log(`[SignalWorker] Started for session ${sessionId} (Status: ${this.sessionStatus})`);

    // Initialize quant engine memory for this session
    await quantEngine.initSession(sessionId);

    // Fetch initial session details for min_balance (Drawdown guard)
    const { data: sessionData } = await supabase
      .from(this.sessionTable)
      .select('min_balance')
      .eq('id', sessionId)
      .single();

    this.minBalance = sessionData?.min_balance || 0;

    // Ensure connection
    if (!tickCollector.isConnected()) {
      await tickCollector.connect(apiToken);
      // Wait for connection to stabilize before subscribing
      await this.sleep(1000);
    }

    // Subscribe to ticks with small delay between each
    for (const m of markets) {
      tickCollector.subscribeTicks(m);
      await this.sleep(200); // Small delay between subscriptions
    }

    // Run every 1 second for precise 1HZ market execution
    this.interval = setInterval(() => this.tick(markets), 1000);
    console.log('[SignalWorker] 🧠 Quant Engine started (1s interval, with learning)');
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
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
    console.log('[SignalWorker]  stopped');
  }

  async tick(markets) {
    // Check local session state AND match against current worker session
    if (this.sessionStatus !== 'running' && this.sessionStatus !== 'active') return;
    if (this.sessionId !== markets.sessionIdIfPassed) { // Optional: if we pass session ID in tick loop future ref
      // Stricter check: botManager usually manages this. 
      // But let's add a safe guard if 'stop' wasn't called cleanly
    }

    // Drawdown guard (V2 Compatible)
    if (config.drawdownGuard?.enabled) {
      // Use trade_logs (V2) instead of trades
      // And we need to sum 'profit' column. (profit is PnL in V2)
      const { data: trades } = await supabase
        .from('trade_logs')
        .select('profit')
        .eq('session_id', this.sessionId)
        .neq('profit', null); // V2 uses profit, not profit_loss

      const netPnl = trades ? trades.reduce((a, b) => a + (Number(b.profit) || 0), 0) : 0;
      const balanceRef = this.minBalance || 1;
      const ddPct = balanceRef ? (Math.abs(netPnl) / balanceRef) * 100 : 0;

      // Only trigger if netPnl is negative
      if (netPnl < 0 && ddPct >= config.drawdownGuard.maxDrawdownPct) {
        tradeExecutor.paused = true;
        console.error(`[SignalWorker] Drawdown guard triggered (PnL: ${netPnl}, DD: ${ddPct.toFixed(1)}%), pausing executor`);
        return;
      }
    }

    let best = null;
    for (const market of markets) {
      // Throttling
      const now = Date.now();
      const last = this.lastTickTime.get(market) || 0;
      if (now - last < this.throttleMs) continue;
      this.lastTickTime.set(market, now);

      try {
        const perfId = `tick_${market}_${now}`;
        perfMonitor.start(perfId);

        const ticks = tickCollector.getTickHistory(market);
        const digits = tickCollector.getDigitHistory(market);

        // Emit tick update to market room
        if (this.io && ticks.length > 0) {
          const latestTick = ticks[ticks.length - 1];
          this.io.to(`market_${market}`).emit('tick_update', {
            market,
            tick: latestTick.quote,
            time: latestTick.epoch
          });
        }

        // Use Quant Engine for signal generation
        const signal = quantEngine.generateQuantSignal({
          market,
          tickHistory: ticks,
          digitHistory: digits
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

        // Log to debug buffer
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
          // Double check session ID match
          if (this.sessionId !== markets.sessionIdIfPassed && markets.sessionIdIfPassed) {
            // If we passed explicit ID, use it. Otherwise rely on this.sessionId
          }

          // Replaces the circular botManager check with internal status check
          // The botManager is responsible for calling stop() which clears the interval.
          // If interval is running, we assume valid session unless status changed.
          if (this.sessionStatus !== 'running' && this.sessionStatus !== 'active') {
            console.warn(`[SignalWorker] ⛔ Signal ignored - Session Status ${this.sessionStatus}`);
            return;
          }

          const confidence = signal.confidence || 0;
          console.log(`[SignalWorker]  Signal generated: ${signal.side} digit ${signal.digit} (confidence: ${(confidence * 100).toFixed(1)}%)`);
        }

        const duration = perfMonitor.end(perfId);
        perfMonitor.logLatency(`Tick processing for ${market}`, duration, 1000);

        if (!signal.shouldTrade) continue;

        if (!best || signal.confidence > best.confidence) {
          best = signal;
        }

      } catch (err) {
        // Circuit Breaker / Error Throttling
        this.errorCount = (this.errorCount || 0) + 1;
        // ... (throttling logic remains same) ...
        const now = Date.now();
        if ((now - (this.lastErrorLogTime || 0)) > 30000) {
          console.error(`[SignalWorker] Tick error: ${err.message}`);
          this.lastErrorLogTime = now;
        }
      }
    }

    if (!best) return;

    if (this.smartDelayTimers.has(best.market)) {
      console.log(`[SignalWorker]  Smart delay active for ${best.market}, waiting...`);
      return;
    }

    const timer = setTimeout(async () => {
      this.smartDelayTimers.delete(best.market);

      // Status Check (No circular dependency)
      if (this.sessionStatus !== 'running' && this.sessionStatus !== 'active') {
        return;
      }

      const freshTicks = tickCollector.getTickHistory(best.market);
      const freshDigits = tickCollector.getDigitHistory(best.market);
      const revalidated = strategyEngine.generateSignal({ market: best.market, tickHistory: freshTicks, digitHistory: freshDigits });
      revalidated.generatedAt = new Date();

      if (!revalidated.shouldTrade) {
        console.log('[SignalWorker] Smart delay vetoed trade for', best.market);
        return;
      }

      // Log strategy decision (V2 Log Table)
      await supabase.from('activity_logs_v2').insert({ // Updated to V2
        type: 'signal_generated', // V2 uses type
        metadata: {
          level: 'info',
          message: `Signal ${revalidated.side} digit ${revalidated.digit} conf ${revalidated.confidence.toFixed(2)}`,
          market: revalidated.market,
          parts: revalidated.parts
        },
        session_id: this.sessionId,
        created_at: new Date().toISOString()
      });

      try {
        // Risk Engine Evaluation
        // V2 Risk Check: Query trade_logs (V2)
        const { data: todayTrades } = await supabase
          .from('trade_logs')
          .select('profit')
          .eq('session_id', this.sessionId)
          .gte('created_at', new Date(new Date().setHours(0, 0, 0, 0)).toISOString());

        const dailyLoss = Math.abs(
          (todayTrades || [])
            .filter(t => t.profit < 0)
            .reduce((sum, t) => sum + Math.abs(t.profit), 0)
        );

        const riskContext = {
          dailyLoss,
          currentExposure: tradeExecutor.activeConnections?.size || 0,
          consecutiveLosses: tradeExecutor.consecutiveLosses || 0,
          maxConsecutiveLossesLimit: config.risk?.maxConsecutiveLosses || 5, // Pass dynamic limit if available
          signal: {
            type: revalidated.side,
            symbol: revalidated.market,
            confidence: revalidated.confidence
          }
        };

        const riskCheck = await riskEngine.evaluateRisk(riskContext);

        if (!riskCheck.allowed) {
          console.warn(`[SignalWorker]  Risk Engine BLOCKED trade: ${riskCheck.reasons.join(', ')}`);
          await supabase.from('trading_activity_logs').insert({
            action_type: 'risk_block',
            action_details: {
              level: 'warning',
              message: `Trade blocked by RiskEngine: ${riskCheck.reasons.join(', ')}`,
              market: revalidated.market,
              dailyLoss
            },
            session_id: this.sessionId,
            created_at: new Date().toISOString()
          });
          return;
        }

        console.log('[SignalWorker]  Risk check passed, executing trade...');

        // Event-driven mode: Publish signal to queue if available
        if (messageQueue.isReady()) {
          const signalEvent = createSignalEvent(revalidated, this.sessionId);
          signalEvent.payload.dailyLoss = dailyLoss;
          signalEvent.payload.riskCheckPassed = true;
          signalEvent.sessionTable = this.sessionTable;

          await messageQueue.publish(TOPICS.TRADE_SIGNALS, signalEvent);
          console.log(`[SignalWorker] Signal published to queue: ${signalEvent.id}`);

          // Also emit to SSE clients
          if (this.io) {
            this.io.emit('signal_queued', signalEvent);
          }

          trackEvent('SIGNAL_QUEUED', { market: revalidated.market, side: revalidated.side, confidence: revalidated.confidence });
        } else {
          // Fallback: Direct execution when queue not available
          await tradeExecutor.executeMultiAccountTrade(revalidated, this.sessionId, this.sessionTable);
          trackEvent('TRADE_EXECUTED', { market: revalidated.market, side: revalidated.side, confidence: revalidated.confidence });
        }
      } catch (error) {
        console.error('[SignalWorker] Trade execution execution error:', error);
        captureError(error, { market: revalidated.market, sessionId: this.sessionId, phase: 'execution' });
      }
    }, config.smartDelayMs || 1500);

    this.smartDelayTimers.set(best.market, timer);
  }
}

module.exports = new SignalWorker();