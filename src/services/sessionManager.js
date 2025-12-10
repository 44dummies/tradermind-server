const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY
);

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
        .from('trading_sessions')
        .insert({
          created_by: adminId,
          session_type: type,
          name: name || `${type.toUpperCase()} Session`,
          minimum_balance: minBalance,
          default_tp: defaultTP || 10,
          default_sl: defaultSL || 5,
          market: markets?.[0] || 'R_100',
          duration: duration || 1,
          duration_unit: durationUnit || 't',
          stake_percentage: stakePercentage || 0.02,
          status: this.SESSION_STATUS.PENDING,
          created_at: new Date().toISOString()
        })
        .select()
        .single();

      if (error) {
        throw new Error(`Failed to create session: ${error.message}`);
      }

      console.log(`[SessionManager] ✅ Created ${type} session: ${session.id}`);

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
        invited_at: new Date().toISOString()
      }));

      const { data, error } = await supabase
        .from('session_invitations')
        .insert(invitations)
        .select();

      if (error) {
        throw new Error(`Failed to send invitations: ${error.message}`);
      }

      console.log(`[SessionManager] ✅ Invited ${userIds.length} users to session ${sessionId}`);

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
      const { takeProfit, stopLoss } = tpsl;

      // Get session first to know the mode
      const { data: session, error: sessionError } = await supabase
        .from('trading_sessions')
        .select('*')
        .eq('id', sessionId)
        .single();

      if (sessionError || !session) {
        throw new Error('Session not found');
      }

      // Resolve account based on session mode (Dual Account System)
      // If mode is set (v2), find specific account type. If null (v1), fallback to active.
      let accountQuery = supabase
        .from('trading_accounts')
        .select('*')
        .eq('user_id', userId);

      if (session.mode) {
        accountQuery = accountQuery.eq('account_type', session.mode);
      } else {
        accountQuery = accountQuery.eq('is_active', true);
      }

      const { data: account, error: accountError } = await accountQuery.maybeSingle();

      if (accountError || !account) {
        const typeReq = session.mode ? session.mode.toUpperCase() : 'ACTIVE';
        throw new Error(`No ${typeReq} trading account found. Please connect a ${typeReq} account.`);
      }

      // Check balance
      if (account.balance < session.minimum_balance) {
        throw new Error(`Balance too low. Minimum required: $${session.minimum_balance}`);
      }

      // Validate TP/SL
      if (takeProfit < session.default_tp) {
        throw new Error(`Take Profit must be at least $${session.default_tp}`);
      }

      if (stopLoss < session.default_sl) {
        throw new Error(`Stop Loss must be at least $${session.default_sl}`);
      }

      // Update invitation
      const { data: invitation, error: updateError } = await supabase
        .from('session_invitations')
        .update({
          status: 'accepted',
          take_profit: takeProfit,
          stop_loss: stopLoss,
          // Store the resolved account info for specific binding
          account_id: account.id,
          account_type: account.account_type,
          accepted_at: new Date().toISOString()
        })
        .eq('session_id', sessionId)
        .eq('user_id', userId)
        .select()
        .single();

      if (updateError) {
        throw new Error(`Failed to accept session: ${updateError.message}`);
      }

      console.log(`[SessionManager] ✅ User ${userId} accepted session ${sessionId}`);

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
      // Update session status
      const { data: session, error } = await supabase
        .from('trading_sessions')
        .update({
          status: this.SESSION_STATUS.ACTIVE,
          started_at: new Date().toISOString()
        })
        .eq('id', sessionId)
        .select()
        .single();

      if (error) {
        throw new Error(`Failed to start session: ${error.message}`);
      }

      console.log(`[SessionManager] ✅ Started session ${sessionId}`);

      // Notify all accepted users
      const { data: invitations } = await supabase
        .from('session_invitations')
        .select('user_id')
        .eq('session_id', sessionId)
        .eq('status', 'accepted');

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
      const { data: session, error } = await supabase
        .from('trading_sessions')
        .update({
          status: this.SESSION_STATUS.COMPLETED,
          completed_at: new Date().toISOString()
        })
        .eq('id', sessionId)
        .select()
        .single();

      if (error) {
        throw new Error(`Failed to stop session: ${error.message}`);
      }

      console.log(`[SessionManager] ✅ Stopped session ${sessionId}`);

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

      console.log(`[SessionManager] ✅ Created recovery session for ${userIds.length} users`);

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
        .from('trading_sessions')
        .select('*')
        .eq('status', this.SESSION_STATUS.ACTIVE)
        .order('started_at', { ascending: false })
        .limit(1)
        .single();

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
      const { data: session } = await supabase
        .from('trading_sessions')
        .select('*')
        .eq('id', sessionId)
        .single();

      // Get invitations
      const { data: invitations } = await supabase
        .from('session_invitations')
        .select('*')
        .eq('session_id', sessionId);

      // Get trades
      const { data: trades } = await supabase
        .from('trades')
        .select('*')
        .eq('session_id', sessionId);

      const accepted = invitations?.filter(i => i.status === 'accepted').length || 0;
      const pending = invitations?.filter(i => i.status === 'pending').length || 0;
      const removed = invitations?.filter(i => i.status === 'removed' || i.status === 'removed_tp' || i.status === 'removed_sl').length || 0;

      const totalTrades = trades?.length || 0;
      const openTrades = trades?.filter(t => t.status === 'open').length || 0;
      const closedTrades = trades?.filter(t => t.status !== 'open').length || 0;

      const totalPL = trades?.reduce((sum, t) => sum + (t.profit_loss || 0), 0) || 0;

      return {
        session,
        stats: {
          totalInvitations: invitations?.length || 0,
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
        .from('session_invitations')
        .update({
          take_profit: takeProfit,
          stop_loss: stopLoss
        })
        .eq('session_id', sessionId)
        .eq('user_id', userId)
        .select()
        .single();

      if (error) {
        throw new Error(`Failed to update TP/SL: ${error.message}`);
      }

      console.log(`[SessionManager] ✅ Updated TP/SL for user ${userId} in session ${sessionId}`);

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
      await supabase
        .from('trading_activity_logs')
        .insert({
          ...activity,
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
        .from('session_invitations')
        .update({
          status: 'left',
          left_at: new Date().toISOString()
        })
        .eq('session_id', sessionId)
        .eq('user_id', userId)
        .select()
        .single();

      if (error) {
        throw new Error(`Failed to leave session: ${error.message}`);
      }

      console.log(`[SessionManager] ✅ User ${userId} left session ${sessionId}`);

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
