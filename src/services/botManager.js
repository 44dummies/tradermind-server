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
      activeSessionTable: null, // 'trading_sessions' or 'trading_sessions_v2'
      lastSignal: null,
      tradesExecuted: 0,
      errors: []
    };
    this.sessionTimer = null; // Auto-stop timer
  }

  initialize(io) {
    this.io = io;
    signalWorker.setSocket(io);
    tradeExecutor.setSocket(io);
    console.log('[BotManager] Socket.IO initialized for real-time updates');

    // Attempt to resume any active session from DB
    this.resumeActiveSession();
  }

  async resumeActiveSession() {
    try {
      console.log('[BotManager]  Checking for active sessions to resume...');

      // Check for 'active' sessions in v2 table
      const { data: v2Session } = await supabase
        .from('trading_sessions_v2')
        .select('*')
        .eq('status', 'active')
        .single();

      if (v2Session) {
        console.log(`[BotManager]  Found active V2 session: ${v2Session.id}. Resuming...`);
        return this.startBot(v2Session.id);
      }

      // Check for 'active' sessions in v1 table
      const { data: v1Session } = await supabase
        .from('trading_sessions')
        .select('*')
        .eq('status', 'active')
        .single();

      if (v1Session) {
        console.log(`[BotManager]  Found active V1 session: ${v1Session.id}. Resuming...`);
        return this.startBot(v1Session.id);
      }

      console.log('[BotManager] No active sessions found.');
    } catch (error) {
      console.error('[BotManager]  Failed to auto-resume session:', error);
    }
  }

  getState() {
    return {
      ...this.state,
      uptime: this.state.startTime ? Date.now() - this.state.startTime : 0,
      executorStats: tradeExecutor.getStats(),
      signalStats: signalWorker.getLatestStats()
    };
  }

  async startBot(sessionId) {
    if (this.state.isRunning) {
      throw new Error('Bot is already running');
    }

    // Try V2 first
    let sessionTable = 'trading_sessions_v2';
    let { data: session, error } = await supabase
      .from(sessionTable)
      .select('*')
      .eq('id', sessionId)
      .single();

    // If not found, try V1
    if (!session) {
      sessionTable = 'trading_sessions';
      const v1Result = await supabase
        .from(sessionTable)
        .select('*')
        .eq('id', sessionId)
        .single();
      session = v1Result.data;
      error = v1Result.error;
    }

    if (error || !session) {
      throw new Error('Session not found');
    }

    // Both V1 and V2 tables use 'active' status based on database constraint
    const statusToSet = 'active';

    // Update session status
    console.log(`[BotManager] Updating session ${sessionId} status to '${statusToSet}' in ${sessionTable}...`);
    const { error: updateError } = await supabase
      .from(sessionTable)
      .update({
        status: statusToSet,
        started_at: new Date().toISOString()
      })
      .eq('id', sessionId);

    if (updateError) {
      console.error('[BotManager]  Failed to update session status:', updateError);
      throw new Error(`Failed to start session: ${updateError.message}`);
    }

    // Verify the update worked
    const { data: verifySession } = await supabase
      .from(sessionTable)
      .select('status')
      .eq('id', sessionId)
      .single();

    console.log(`[BotManager]  Session status after update: ${verifySession?.status}`);

    // Start components
    this.state.isRunning = true;
    this.state.isPaused = false;
    this.state.startTime = Date.now();
    this.state.activeSessionId = sessionId;
    this.state.activeSessionTable = sessionTable;
    this.state.sessionDuration = session.duration_minutes; // Store duration
    this.state.tradesExecuted = 0;
    this.state.errors = [];

    tradeExecutor.paused = false;
    tradeExecutor.consecutiveLosses = 0;
    tradeExecutor.apiErrorCount = 0; // Reset error count on fresh start

    // Start signal worker (pass sessionTable so worker knows where to check status)
    await signalWorker.start(sessionId, session.markets || ['R_100'], process.env.DERIV_API_TOKEN, sessionTable);

    // Session Auto-Stop Timer
    if (session.duration_minutes && session.duration_minutes > 0) {
      const durationMs = session.duration_minutes * 60 * 1000;
      console.log(`[BotManager]  Session auto-stop scheduled in ${session.duration_minutes} minutes`);

      this.sessionTimer = setTimeout(async () => {
        console.log(`[BotManager]  Session duration (${session.duration_minutes}min) reached. Auto-stopping...`);
        try {
          await this.stopBot();

          // Log auto-stop event
          await supabase.from('trading_activity_logs').insert({
            action_type: 'session_auto_stop',
            action_details: {
              level: 'info',
              message: `Session auto-stopped after ${session.duration_minutes} minutes`,
              sessionId
            },
            session_id: sessionId,
            created_at: new Date().toISOString()
          });

          // Emit event to connected clients
          if (this.io) {
            this.io.emit('session_ended', {
              sessionId,
              reason: 'duration_expired',
              message: `Session completed after ${session.duration_minutes} minutes`
            });
          }
        } catch (err) {
          console.error('[BotManager] Auto-stop error:', err);
        }
      }, durationMs);
    }

    console.log(`[BotManager] Bot started for session ${sessionId} (Table: ${sessionTable})`);
    return this.getState();
  }

  async stopBot() {
    if (!this.state.isRunning) {
      throw new Error('Bot is not running');
    }

    const sessionId = this.state.activeSessionId;
    const sessionTable = this.state.activeSessionTable || 'trading_sessions';

    // Stop components
    signalWorker.stop();
    tradeExecutor.disconnectAll();

    // Clear auto-stop timer if running
    if (this.sessionTimer) {
      clearTimeout(this.sessionTimer);
      this.sessionTimer = null;
      console.log('[BotManager]  Session timer cleared');
    }

    // Update state
    this.state.isRunning = false;
    this.state.isPaused = false;
    this.state.startTime = null;
    this.state.activeSessionId = null;
    this.state.activeSessionTable = null;

    // Update session status
    if (sessionId) {
      await supabase
        .from(sessionTable)
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

    const sessionTable = this.state.activeSessionTable || 'trading_sessions';

    // Update session status
    if (this.state.activeSessionId) {
      await supabase
        .from(sessionTable)
        .update({ status: 'paused', paused_at: new Date().toISOString() })
        .eq('id', this.state.activeSessionId);
    }
    return this.getState();
  }

  async resumeBot() {
    if (!this.state.isRunning) return;
    this.state.isPaused = false;
    tradeExecutor.paused = false;

    const sessionTable = this.state.activeSessionTable || 'trading_sessions';

    // Update session status
    if (this.state.activeSessionId) {
      await supabase
        .from(sessionTable)
        .update({ status: 'active' })
        .eq('id', this.state.activeSessionId);
    }
    return this.getState();
  }

  async emergencyStop(reason = 'Manual override') {
    const sessionId = this.state.activeSessionId;
    const sessionTable = this.state.activeSessionTable || 'trading_sessions';

    // Immediately stop all components
    signalWorker.stop();
    tradeExecutor.disconnectAll();
    tradeExecutor.paused = true;

    // Clear auto-stop timer
    if (this.sessionTimer) {
      clearTimeout(this.sessionTimer);
      this.sessionTimer = null;
    }

    // Reset state
    this.state.isRunning = false;
    this.state.isPaused = false;
    this.state.startTime = null;
    this.state.activeSessionId = null;
    this.state.activeSessionTable = null;

    // Update session status to cancelled
    if (sessionId) {
      await supabase
        .from(sessionTable)
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
