const { supabase } = require('../db/supabase');

/**
 * Session Manager
 * Manages Day, One-Time, and Recovery sessions
 * Handles session creation, user acceptance, and lifecycle
 */
class SessionManager {
  constructor() {
    this.SESSION_TYPES = {
      DAY: 'day',
      ONE_TIME: 'one_time',
      RECOVERY: 'recovery'
    };

    this.SESSION_STATUS = {
      PENDING: 'pending',
      ACTIVE: 'active',
      COMPLETED: 'completed',
      CANCELLED: 'cancelled'
    };
  }

  /**
   * Create a new trading session
   */
  async createSession(adminId, sessionData) {
    try {
      const {
        type,
        name,
        minimumBalance,
        defaultTP,
        defaultSL,
        markets,
        duration,
        durationUnit,
        stakePercentage
      } = sessionData;

      // Validate session type
      if (!Object.values(this.SESSION_TYPES).includes(type)) {
        throw new Error('Invalid session type');
      }

      // Set minimum balance based on session type
      let minBalance = minimumBalance;
      if (type === this.SESSION_TYPES.DAY && !minBalance) {
        minBalance = 100; // Higher for day sessions
      } else if (type === this.SESSION_TYPES.ONE_TIME && !minBalance) {
        minBalance = 10; // Lower for one-time sessions
      } else if (type === this.SESSION_TYPES.RECOVERY && !minBalance) {
        minBalance = 5; // Lowest for recovery
      }

      // Create session
      const { data: session, error } = await supabase
        .from('trading_sessions_v2')
        .insert({
          admin_id: adminId,
          type: type, // V2 uses 'type'
          name: name || `${type.toUpperCase()} Session`,
          min_balance: minBalance,
          default_tp: defaultTP || 10,
          default_sl: defaultSL || 5,
          markets: markets || ['R_100'],
          duration: duration || 1,
          duration_unit: durationUnit || 't',
          staking_mode: sessionData.stakingMode || 'fixed',
          base_stake: stakePercentage || 0.35, // V2 uses base_stake
          status: 'pending',
          created_at: new Date().toISOString()
        })
        .select()
        .single();

      if (error) {
        throw new Error(`Failed to create session: ${error.message}`);
      }

      console.log(`[SessionManager]  Created ${type} session: ${session.id}`);

      // Log activity
      await this.logActivity({
        session_id: session.id,
        action: 'session_created',
        admin_id: adminId,
        details: { type, minBalance }
      });

      return {
        success: true,
        session
      };

    } catch (error) {
      console.error('[SessionManager] Create session error:', error);
      throw error;
    }
  }

  /**
   * Invite users to session
   */
  async inviteUsers(sessionId, userIds, adminId) {
    try {
      const invitations = userIds.map(userId => ({
        session_id: sessionId,
        user_id: userId,
        status: 'pending',
        kp: 0,
        tp: 0,
        sl: 0,
        initial_balance: 0,
        current_pnl: 0,
        created_at: new Date().toISOString()
      }));

      const { data, error } = await supabase
        .from('session_participants')
        .insert(invitations)
        .select();

      if (error) {
        throw new Error(`Failed to send invitations: ${error.message}`);
      }

      console.log(`[SessionManager]  Invited ${userIds.length} users to session ${sessionId} (V2)`);

      // Send notifications
      for (const userId of userIds) {
        await this.sendNotification(userId, {
          type: 'session_invite',
          message: `You've been invited to a trading session`,
          sessionId
        });
      }

      // Log activity
      await this.logActivity({
        session_id: sessionId,
        action: 'users_invited',
        admin_id: adminId,
        details: { count: userIds.length }
      });

      return {
        success: true,
        invitations: data
      };

    } catch (error) {
      console.error('[SessionManager] Invite users error:', error);
      throw error;
    }
  }

  /**
   * User accepts session invitation
   */
  async acceptSession(userId, sessionId, tpsl) {
    try {
      const { takeProfit, stopLoss, derivToken } = tpsl;

      // Get session (Try V2 first)
      const { data: v2Session } = await supabase
        .from('trading_sessions_v2')
        .select('*')
        .eq('id', sessionId)
        .maybeSingle();

      const { data: v1Session } = !v2Session ? await supabase
        .from('trading_sessions')
        .select('*')
        .eq('id', sessionId)
        .single() : { data: null };

      const session = v2Session || v1Session;

      if (!session) {
        throw new Error('Session not found');
      }

      // If derivToken is provided directly, use it (v2 flow)
      // Otherwise, look up from trading_accounts (v1 flow)
      let account = null;
      let derivTokenToUse = derivToken;

      if (!derivToken) {
        // Resolve account based on session mode (Dual Account System)
        let accountQuery = supabase
          .from('trading_accounts')
          .select('*')
          .eq('user_id', userId);

        if (session.mode) {
          accountQuery = accountQuery.eq('account_type', session.mode);
        } else {
          accountQuery = accountQuery.eq('is_active', true);
        }

        const { data: foundAccount, error: accountError } = await accountQuery.maybeSingle();

        if (accountError || !foundAccount) {
          const typeReq = session.mode ? session.mode.toUpperCase() : 'ACTIVE';
          throw new Error(`No ${typeReq} trading account found. Please connect a ${typeReq} account.`);
        }

        account = foundAccount;
        derivTokenToUse = account.deriv_token;

        // Check balance if we have account data
        if (account.balance < session.minimum_balance) {
          throw new Error(`Your balance ($${account.balance.toFixed(2)}) is below the minimum required ($${session.minimum_balance}). Please wait for a session with lower balance requirements.`);
        }
      }

      // Validate TP/SL (use defaults if not provided)
      const finalTP = takeProfit || session.default_tp || 10;
      const finalSL = stopLoss || session.default_sl || 5;

      if (finalTP < session.default_tp) {
        throw new Error(`Take Profit must be at least $${session.default_tp}`);
      }

      if (finalSL < session.default_sl) {
        throw new Error(`Stop Loss must be at least $${session.default_sl}`);
      }

      // 2. Accept invitation in session_participants
      // Columns: id, session_id, user_id, tp, sl, status, initial_balance, current_pnl, accepted_at
      const participantData = {
        session_id: sessionId,
        user_id: userId,
        tp: finalTP,
        sl: finalSL,
        status: 'active',
        initial_balance: account?.balance || 0,
        accepted_at: new Date().toISOString()
      };

      const { data: participation, error: partError } = await supabase
        .from('session_participants')
        .upsert(participantData, { onConflict: 'session_id, user_id' })
        .select()
        .single();

      if (partError) {
        console.error('[SessionManager] Failed to create participation:', partError);
        throw new Error(`Failed to join session: ${partError.message}`);
      }

      console.log(`[SessionManager]  User ${userId} joined session ${sessionId} with TP: ${finalTP}, SL: ${finalSL}`);
      const invitation = participation; // Return participation as the result

      console.log(`[SessionManager]  User ${userId} accepted session ${sessionId}`);

      // Send notification
      await this.sendNotification(userId, {
        type: 'session_accepted',
        message: `You've joined the trading session (TP: $${takeProfit}, SL: $${stopLoss})`,
        sessionId
      });

      // Log activity
      await this.logActivity({
        session_id: sessionId,
        action: 'user_accepted',
        user_id: userId,
        details: { takeProfit, stopLoss }
      });

      return {
        success: true,
        invitation
      };

    } catch (error) {
      console.error('[SessionManager] Accept session error:', error);
      throw error;
    }
  }

  /**
   * Start session (admin)
   */
  async startSession(sessionId, adminId) {
    try {
      // Update session status (Try V2, then V1)
      const { data: v2Session } = await supabase.from('trading_sessions_v2').select('id').eq('id', sessionId).maybeSingle();
      const table = v2Session ? 'trading_sessions_v2' : 'trading_sessions';

      const { data: session, error } = await supabase
        .from(table)
        .update({
          status: v2Session ? 'running' : this.SESSION_STATUS.ACTIVE, // V2 uses 'running'
          started_at: new Date().toISOString()
        })
        .eq('id', sessionId)
        .select()
        .single();

      if (error) {
        throw new Error(`Failed to start session: ${error.message}`);
      }

      console.log(`[SessionManager]  Started session ${sessionId}`);

      // Notify all accepted users
      const { data: invitations } = await supabase
        .from('session_participants')
        .select('user_id')
        .eq('session_id', sessionId)
        .eq('status', 'active');

      for (const invitation of invitations || []) {
        await this.sendNotification(invitation.user_id, {
          type: 'session_started',
          message: 'Trading session has started!',
          sessionId
        });
      }

      // Log activity
      await this.logActivity({
        session_id: sessionId,
        action: 'session_started',
        admin_id: adminId
      });

      return {
        success: true,
        session
      };

    } catch (error) {
      console.error('[SessionManager] Start session error:', error);
      throw error;
    }
  }

  /**
   * Stop session (admin)
   */
  async stopSession(sessionId, adminId) {
    try {
      const { data: v2Session } = await supabase.from('trading_sessions_v2').select('id').eq('id', sessionId).maybeSingle();
      const table = v2Session ? 'trading_sessions_v2' : 'trading_sessions';

      const { data: session, error } = await supabase
        .from(table)
        .update({
          status: 'completed',
          completed_at: new Date().toISOString()
        })
        .eq('id', sessionId)
        .select()
        .single();

      if (error) {
        throw new Error(`Failed to stop session: ${error.message}`);
      }

      console.log(`[SessionManager]  Stopped session ${sessionId}`);

      // Log activity
      await this.logActivity({
        session_id: sessionId,
        action: 'session_stopped',
        admin_id: adminId
      });

      return {
        success: true,
        session
      };

    } catch (error) {
      console.error('[SessionManager] Stop session error:', error);
      throw error;
    }
  }

  /**
   * Create recovery session for SL-hit users
   */
  async createRecoverySession(adminId, sessionData) {
    try {
      // Get eligible recovery users
      const { data: recoveryStates, error: recoveryError } = await supabase
        .from('recovery_states')
        .select('*')
        .eq('status', 'eligible');

      if (recoveryError) {
        throw new Error(`Failed to fetch recovery users: ${recoveryError.message}`);
      }

      if (!recoveryStates || recoveryStates.length === 0) {
        return {
          success: false,
          message: 'No users eligible for recovery session'
        };
      }

      // Create recovery session
      const session = await this.createSession(adminId, {
        ...sessionData,
        type: this.SESSION_TYPES.RECOVERY,
        minimumBalance: sessionData.minimumBalance || 5
      });

      // Auto-invite recovery users
      const userIds = recoveryStates.map(r => r.user_id);
      await this.inviteUsers(session.session.id, userIds, adminId);

      // Update recovery states
      await supabase
        .from('recovery_states')
        .update({
          recovery_session_id: session.session.id,
          status: 'invited'
        })
        .in('user_id', userIds);

      console.log(`[SessionManager]  Created recovery session for ${userIds.length} users`);

      return {
        success: true,
        session: session.session,
        invitedUsers: userIds.length
      };

    } catch (error) {
      console.error('[SessionManager] Create recovery session error:', error);
      throw error;
    }
  }

  /**
   * Get active session
   */
  async getActiveSession() {
    try {
      const { data: session, error } = await supabase
        .from('trading_sessions_v2')
        .select('*')
        .in('status', ['running', 'active'])
        .order('started_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error && error.code !== 'PGRST116') {
        throw error;
      }

      return session;

    } catch (error) {
      console.error('[SessionManager] Get active session error:', error);
      return null;
    }
  }

  /**
   * Get session statistics
   */
  async getSessionStats(sessionId) {
    try {
      // Get session
      // Get session (Try V2 first)
      const { data: v2Session } = await supabase
        .from('trading_sessions_v2')
        .select('*')
        .eq('id', sessionId)
        .maybeSingle();

      const { data: v1Session } = !v2Session ? await supabase
        .from('trading_sessions')
        .select('*')
        .eq('id', sessionId)
        .single() : { data: null };

      const session = v2Session || v1Session;

      if (!session) throw new Error('Session not found for stats');

      // Get participants (invitations)
      const { data: participants } = await supabase
        .from('session_participants')
        .select('*')
        .eq('session_id', sessionId);

      // Get trades from V2 logs
      const { data: trades } = await supabase
        .from('trade_logs')
        .select('*')
        .eq('session_id', sessionId);

      const accepted = participants?.filter(i => i.status === 'active').length || 0;
      const pending = participants?.filter(i => i.status === 'pending').length || 0;
      const removed = participants?.filter(i => i.status === 'removed' || i.status === 'removed_tp' || i.status === 'removed_sl' || i.status === 'kicked').length || 0;

      const totalTrades = trades?.length || 0;
      const openTrades = trades?.filter(t => t.status === 'open').length || 0;
      const closedTrades = trades?.filter(t => t.status !== 'open').length || 0;

      const totalPL = trades?.reduce((sum, t) => sum + (t.profit_loss || 0), 0) || 0;

      return {
        session,
        stats: {
          totalInvitations: participants?.length || 0,
          accepted,
          pending,
          removed,
          totalTrades,
          openTrades,
          closedTrades,
          totalPL
        }
      };

    } catch (error) {
      console.error('[SessionManager] Get session stats error:', error);
      throw error;
    }
  }

  /**
   * Update user TP/SL
   */
  async updateTPSL(userId, sessionId, tpsl) {
    try {
      const { takeProfit, stopLoss } = tpsl;

      const { data, error } = await supabase
        .from('session_participants')
        .update({
          tp: takeProfit,
          sl: stopLoss,
          updated_at: new Date().toISOString()
        })
        .eq('session_id', sessionId)
        .eq('user_id', userId)
        .select()
        .single();

      if (error) {
        throw new Error(`Failed to update TP/SL: ${error.message}`);
      }

      console.log(`[SessionManager]  Updated TP/SL for user ${userId} in session ${sessionId}`);

      return {
        success: true,
        invitation: data
      };

    } catch (error) {
      console.error('[SessionManager] Update TP/SL error:', error);
      throw error;
    }
  }

  /**
   * Send notification
   */
  async sendNotification(userId, notification) {
    try {
      await supabase
        .from('trading_notifications')
        .insert({
          user_id: userId,
          type: notification.type,
          message: notification.message,
          data: notification,
          created_at: new Date().toISOString()
        });
    } catch (error) {
      console.error('[SessionManager] Notification error:', error);
    }
  }

  /**
   * Log activity
   */
  async logActivity(activity) {
    try {
      const { action, details, ...rest } = activity;
      await supabase
        .from('activity_logs_v2')
        .insert({
          type: action,
          metadata: details,
          ...rest,
          created_at: new Date().toISOString()
        });
    } catch (error) {
      console.error('[SessionManager] Log activity error:', error);
    }
  }
  /**
   * User leaves session
   */
  async leaveSession(userId, sessionId) {
    try {
      const { data, error } = await supabase
        .from('session_participants')
        .update({
          status: 'left',
          removed_at: new Date().toISOString()
        })
        .eq('session_id', sessionId)
        .eq('user_id', userId)
        .select()
        .single();

      if (error) {
        throw new Error(`Failed to leave session: ${error.message}`);
      }

      console.log(`[SessionManager]  User ${userId} left session ${sessionId}`);

      // Log activity
      await this.logActivity({
        session_id: sessionId,
        action: 'user_left',
        user_id: userId
      });

      return {
        success: true,
        invitation: data
      };

    } catch (error) {
      console.error('[SessionManager] Leave session error:', error);
      throw error;
    }
  }
}

module.exports = new SessionManager();
