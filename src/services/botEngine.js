const EventEmitter = require('events');
const tickCollector = require('./tickCollector');
const analysisEngine = require('./analysisEngine');
const tradeExecutor = require('./tradeExecutor');
const sessionManager = require('./sessionManager');
const notificationService = require('./notificationService');

/**
 * Bot Engine - Main Trading Bot Controller
 * Orchestrates tick streaming, analysis, and trade execution
 * Runs continuously until admin stops it
 */
class BotEngine extends EventEmitter {
  constructor() {
    super();
    this.isRunning = false;
    this.isPaused = false;
    this.activeSession = null;
    this.markets = ['R_100']; // Default market
    this.manualOverride = false;
    this.tickHandlers = new Map();
    this.signalHistory = [];
    this.errorCount = 0;
    this.maxErrors = 10;
  }

  /**
   * Start the bot
   */
  async start(adminId, options = {}) {
    try {
      if (this.isRunning) {
        console.log('[BotEngine] ⚠️ Bot already running');
        return {
          success: false,
          message: 'Bot already running'
        };
      }

      console.log('[BotEngine] 🤖 Starting bot...');

      // Get active session
      this.activeSession = await sessionManager.getActiveSession();
      
      if (!this.activeSession) {
        throw new Error('No active trading session found');
      }

      console.log(`[BotEngine] Active session: ${this.activeSession.id} (${this.activeSession.type})`);

      // Set markets from session or options
      this.markets = options.markets || [this.activeSession.market] || ['R_100'];

      // Connect tick collector
      await tickCollector.connect();
      
      // Subscribe to markets
      for (const market of this.markets) {
        tickCollector.subscribeTicks(market);
      }

      // Set up tick handlers
      this.setupTickHandlers();

      // Set state
      this.isRunning = true;
      this.isPaused = false;
      this.manualOverride = false;
      this.errorCount = 0;

      this.emit('started', {
        sessionId: this.activeSession.id,
        markets: this.markets
      });

      console.log('[BotEngine] ✅ Bot started successfully');
      console.log(`[BotEngine] Watching markets: ${this.markets.join(', ')}`);

      return {
        success: true,
        session: this.activeSession,
        markets: this.markets
      };

    } catch (error) {
      console.error('[BotEngine] Start error:', error);
      this.stop();
      throw error;
    }
  }

  /**
   * Stop the bot
   */
  async stop(reason = 'manual') {
    try {
      console.log(`[BotEngine] 🛑 Stopping bot (${reason})...`);

      this.isRunning = false;

      // Remove tick handlers
      for (const [market, handler] of this.tickHandlers) {
        tickCollector.removeListener('tick', handler);
      }
      this.tickHandlers.clear();

      // Disconnect tick collector
      tickCollector.disconnect();

      // Disconnect trade executor
      tradeExecutor.disconnectAll();

      this.emit('stopped', { reason });

      console.log('[BotEngine] ✅ Bot stopped');

      return {
        success: true,
        reason
      };

    } catch (error) {
      console.error('[BotEngine] Stop error:', error);
      throw error;
    }
  }

  /**
   * Pause the bot
   */
  pause() {
    if (!this.isRunning) {
      return { success: false, message: 'Bot not running' };
    }

    this.isPaused = true;
    console.log('[BotEngine] ⏸️ Bot paused');

    this.emit('paused');

    return { success: true };
  }

  /**
   * Resume the bot
   */
  resume() {
    if (!this.isRunning) {
      return { success: false, message: 'Bot not running' };
    }

    this.isPaused = false;
    console.log('[BotEngine] ▶️ Bot resumed');

    this.emit('resumed');

    return { success: true };
  }

  /**
   * Manual override - emergency stop
   */
  emergencyStop() {
    console.log('[BotEngine] 🚨 EMERGENCY STOP ACTIVATED');

    this.manualOverride = true;
    
    return this.stop('emergency_stop');
  }

  /**
   * Set up tick handlers for all markets
   */
  setupTickHandlers() {
    for (const market of this.markets) {
      const handler = async (tickData) => {
        if (tickData.market === market) {
          await this.handleTick(tickData);
        }
      };

      tickCollector.on('tick', handler);
      this.tickHandlers.set(market, handler);
    }

    // Handle disconnection
    tickCollector.on('disconnected', () => {
      console.log('[BotEngine] ⚠️ Tick stream disconnected - pausing bot');
      this.pause();
    });

    // Handle reconnection
    tickCollector.on('connected', () => {
      console.log('[BotEngine] ✅ Tick stream reconnected - resuming bot');
      this.resume();
    });
  }

  /**
   * Handle incoming tick
   */
  async handleTick(tickData) {
    try {
      // Skip if paused or manual override
      if (this.isPaused || this.manualOverride) {
        return;
      }

      // Skip if not enough data
      if (tickData.digitHistory.length < 50) {
        console.log(`[BotEngine] Collecting data for ${tickData.market}... (${tickData.digitHistory.length}/50 ticks)`);
        return;
      }

      // Analyze tick data
      const signal = analysisEngine.analyze(
        tickData.market,
        tickData.digitHistory,
        tickData.tickHistory
      );

      // Log analysis
      this.emit('analysis', {
        market: tickData.market,
        signal,
        timestamp: new Date()
      });

      // Check if we should trade
      if (!signal.shouldTrade) {
        console.log(`[BotEngine] ${tickData.market}: ${signal.reason}`);
        return;
      }

      console.log(`[BotEngine] 🎯 SIGNAL DETECTED!`);
      console.log(`[BotEngine] Market: ${tickData.market}`);
      console.log(`[BotEngine] Side: ${signal.side}, Digit: ${signal.digit}`);
      console.log(`[BotEngine] Confidence: ${(signal.confidence * 100).toFixed(1)}%`);
      console.log(`[BotEngine] Reason: ${signal.reason}`);

      // Smart delay - revalidate after 1 tick
      console.log('[BotEngine] ⏳ Applying smart delay (revalidating after 1 tick)...');
      
      const validation = await analysisEngine.smartDelay(
        tickData.market,
        tickCollector,
        signal
      );

      if (!validation.valid) {
        console.log(`[BotEngine] ❌ Signal invalidated: ${validation.reason}`);
        return;
      }

      console.log('[BotEngine] ✅ Signal validated!');

      // Execute trade
      await this.executeTrade(validation.signal);

    } catch (error) {
      console.error('[BotEngine] Tick handler error:', error);
      
      this.errorCount++;
      
      // Safety shutdown if too many errors
      if (this.errorCount >= this.maxErrors) {
        console.error(`[BotEngine] 🚨 Too many errors (${this.errorCount}/${this.maxErrors}) - stopping bot`);
        await this.stop('error_threshold');
      }
    }
  }

  /**
   * Execute trade for all accounts
   */
  async executeTrade(signal) {
    try {
      console.log('[BotEngine] 🚀 Executing trade...');

      // Store signal in history
      this.signalHistory.push({
        signal,
        timestamp: new Date(),
        sessionId: this.activeSession.id
      });

      // Keep only last 100 signals
      if (this.signalHistory.length > 100) {
        this.signalHistory = this.signalHistory.slice(-100);
      }

      // Execute multi-account trade
      const result = await tradeExecutor.executeMultiAccountTrade(
        signal,
        this.activeSession.id
      );

      console.log(`[BotEngine] ✅ Trade execution complete: ${result.executed}/${result.total} successful`);

      this.emit('trade_executed', {
        signal,
        result,
        timestamp: new Date()
      });

      // Reset error count on successful trade
      this.errorCount = 0;

    } catch (error) {
      console.error('[BotEngine] Execute trade error:', error);
      
      this.errorCount++;
      
      this.emit('trade_error', {
        error: error.message,
        signal,
        timestamp: new Date()
      });
    }
  }

  /**
   * Get bot status
   */
  getStatus() {
    return {
      isRunning: this.isRunning,
      isPaused: this.isPaused,
      manualOverride: this.manualOverride,
      activeSession: this.activeSession,
      markets: this.markets,
      tickCollectorStatus: tickCollector.isConnected(),
      tradeExecutorStats: tradeExecutor.getStats(),
      errorCount: this.errorCount,
      signalCount: this.signalHistory.length
    };
  }

  /**
   * Get recent signals
   */
  getRecentSignals(limit = 10) {
    return this.signalHistory.slice(-limit).reverse();
  }

  /**
   * Get bot statistics
   */
  getStats() {
    const tickStats = tickCollector.getStats();
    const tradeStats = tradeExecutor.getStats();

    return {
      status: this.getStatus(),
      tickCollector: tickStats,
      tradeExecutor: tradeStats,
      signals: {
        total: this.signalHistory.length,
        recent: this.getRecentSignals(5)
      }
    };
  }

  /**
   * Change active session
   */
  async changeSession(sessionId) {
    try {
      const session = await sessionManager.getActiveSession();

      if (!session || session.id !== sessionId) {
        throw new Error('Session not active');
      }

      this.activeSession = session;
      
      console.log(`[BotEngine] ✅ Switched to session ${sessionId}`);

      return {
        success: true,
        session
      };

    } catch (error) {
      console.error('[BotEngine] Change session error:', error);
      throw error;
    }
  }

  /**
   * Add market to watch list
   */
  addMarket(market) {
    if (this.markets.includes(market)) {
      return { success: false, message: 'Market already added' };
    }

    this.markets.push(market);

    if (this.isRunning) {
      tickCollector.subscribeTicks(market);
    }

    console.log(`[BotEngine] ✅ Added market: ${market}`);

    return { success: true, markets: this.markets };
  }

  /**
   * Remove market from watch list
   */
  removeMarket(market) {
    const index = this.markets.indexOf(market);
    
    if (index === -1) {
      return { success: false, message: 'Market not found' };
    }

    this.markets.splice(index, 1);

    if (this.isRunning) {
      tickCollector.unsubscribeTicks(market);
    }

    console.log(`[BotEngine] ✅ Removed market: ${market}`);

    return { success: true, markets: this.markets };
  }
}

module.exports = new BotEngine();
