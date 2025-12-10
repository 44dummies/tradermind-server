const { supabase } = require('../db/supabase');
const signalWorker = require('./signalWorker');
const tradeExecutor = require('./tradeExecutor');

class BotManager {
  constructor() {
    this.state = {
      isRunning: false,
      isPaused: false,
      startTime: null,
      activeSessionId: null,
      lastSignal: null,
      tradesExecuted: 0,
      errors: []
    };
  }

  getState() {
    return {
      ...this.state,
      uptime: this.state.startTime ? Date.now() - this.state.startTime : 0,
      executorStats: tradeExecutor.getStats()
    };
  }

  async startBot(sessionId) {
    if (this.state.isRunning) {
      throw new Error('Bot is already running');
    }

    // Verify session
    const { data: session, error } = await supabase
      .from('trading_sessions')
      .select('*')
      .eq('id', sessionId)
      .single();

    if (error || !session) {
      throw new Error('Session not found');
    }

    // Update session status
    await supabase
      .from('trading_sessions')
      .update({
        status: 'running',
        started_at: new Date().toISOString()
      })
      .eq('id', sessionId);

    // Start components
    this.state.isRunning = true;
    this.state.isPaused = false;
    this.state.startTime = Date.now();
    this.state.activeSessionId = sessionId;
    this.state.sessionDuration = session.duration_minutes; // Store duration
    this.state.tradesExecuted = 0;
    this.state.errors = [];

    tradeExecutor.paused = false;
    tradeExecutor.consecutiveLosses = 0;

    // Start signal worker
    await signalWorker.start(sessionId, session.markets || ['R_100']);

    console.log(`[BotManager] Bot started for session ${sessionId}`);
    return this.getState();
  }

  async stopBot() {
    if (!this.state.isRunning) {
      throw new Error('Bot is not running');
    }

    const sessionId = this.state.activeSessionId;

    // Stop components
    signalWorker.stop();
    tradeExecutor.disconnectAll();

    // Update state
    this.state.isRunning = false;
    this.state.isPaused = false;
    this.state.startTime = null;
    this.state.activeSessionId = null;

    // Update session status
    if (sessionId) {
      await supabase
        .from('trading_sessions')
        .update({
          status: 'completed',
          ended_at: new Date().toISOString()
        })
        .eq('id', sessionId);
    }

    console.log(`[BotManager] Bot stopped for session ${sessionId}`);
    return this.getState();
  }

  async pauseBot() {
    if (!this.state.isRunning) return;
    this.state.isPaused = true;
    tradeExecutor.paused = true;
    // Update session status
    if (this.state.activeSessionId) {
      await supabase
        .from('trading_sessions')
        .update({ status: 'paused', paused_at: new Date().toISOString() })
        .eq('id', this.state.activeSessionId);
    }
    return this.getState();
  }

  async resumeBot() {
    if (!this.state.isRunning) return;
    this.state.isPaused = false;
    tradeExecutor.paused = false;
    // Update session status
    if (this.state.activeSessionId) {
      await supabase
        .from('trading_sessions')
        .update({ status: 'running' })
        .eq('id', this.state.activeSessionId);
    }
    return this.getState();
  }

  async emergencyStop(reason = 'Manual override') {
    const sessionId = this.state.activeSessionId;

    // Immediately stop all components
    signalWorker.stop();
    tradeExecutor.disconnectAll();
    tradeExecutor.paused = true;

    // Reset state
    this.state.isRunning = false;
    this.state.isPaused = false;
    this.state.startTime = null;
    this.state.activeSessionId = null;

    // Update session status to cancelled
    if (sessionId) {
      await supabase
        .from('trading_sessions')
        .update({
          status: 'cancelled',
          ended_at: new Date().toISOString()
        })
        .eq('id', sessionId);
    }

    console.log(`[BotManager] EMERGENCY STOP executed. Reason: ${reason}`);
    return this.getState();
  }
}

module.exports = new BotManager();
