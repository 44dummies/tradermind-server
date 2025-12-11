const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY
);

/**
 * Notification Service
 * Handles real-time and database notifications
 * Supports broadcasts, targeted messages, and user notifications
 */
class NotificationService {
  constructor() {
    this.io = null; // Socket.IO instance (set externally)
  }

  /**
   * Set Socket.IO instance
   */
  setSocketIO(io) {
    this.io = io;
    console.log('[NotificationService]  Socket.IO connected');
  }

  /**
   * Send notification to specific user
   */
  async sendToUser(userId, notification) {
    try {
      // Save to database
      const { data, error } = await supabase
        .from('trading_notifications')
        .insert({
          user_id: userId,
          type: notification.type,
          title: notification.title || 'Notification',
          message: notification.message,
          data: notification.data || {},
          is_read: false,
          created_at: new Date().toISOString()
        })
        .select()
        .single();

      if (error) {
        console.error('[NotificationService] DB insert error:', error);
        throw error;
      }

      // Send real-time if Socket.IO available
      if (this.io) {
        this.io.to(`user:${userId}`).emit('notification', {
          ...data,
          timestamp: new Date()
        });
      }

      console.log(`[NotificationService]  Sent notification to user ${userId}`);

      return {
        success: true,
        notification: data
      };

    } catch (error) {
      console.error('[NotificationService] Send to user error:', error);
      throw error;
    }
  }

  /**
   * Broadcast to all users
   */
  async broadcast(notification, adminId) {
    try {
      // Get all users
      const { data: users, error: usersError } = await supabase
        .from('user_profiles')
        .select('deriv_account_id');

      if (usersError) {
        throw new Error(`Failed to fetch users: ${usersError.message}`);
      }

      if (!users || users.length === 0) {
        return {
          success: false,
          message: 'No users to notify'
        };
      }

      // Create notifications for all users
      const notifications = users.map(user => ({
        user_id: user.deriv_account_id,
        type: 'broadcast',
        title: notification.title || 'Announcement',
        message: notification.message,
        data: { ...notification.data, from: adminId },
        is_read: false,
        created_at: new Date().toISOString()
      }));

      const { data, error } = await supabase
        .from('trading_notifications')
        .insert(notifications)
        .select();

      if (error) {
        throw new Error(`Failed to create notifications: ${error.message}`);
      }

      // Send real-time broadcast
      if (this.io) {
        this.io.emit('broadcast', {
          type: 'broadcast',
          title: notification.title,
          message: notification.message,
          data: notification.data,
          timestamp: new Date()
        });
      }

      console.log(`[NotificationService]  Broadcast sent to ${users.length} users`);

      return {
        success: true,
        sentTo: users.length
      };

    } catch (error) {
      console.error('[NotificationService] Broadcast error:', error);
      throw error;
    }
  }

  /**
   * Send to session participants
   */
  async sendToSession(sessionId, notification) {
    try {
      // Get session participants
      const { data: invitations, error: invError } = await supabase
        .from('session_invitations')
        .select('user_id')
        .eq('session_id', sessionId)
        .eq('status', 'accepted');

      if (invError) {
        throw new Error(`Failed to fetch session participants: ${invError.message}`);
      }

      if (!invitations || invitations.length === 0) {
        return {
          success: false,
          message: 'No participants in session'
        };
      }

      // Send to each participant
      const results = [];
      for (const invitation of invitations) {
        try {
          await this.sendToUser(invitation.user_id, {
            ...notification,
            data: { ...notification.data, sessionId }
          });
          results.push({ userId: invitation.user_id, success: true });
        } catch (error) {
          results.push({ userId: invitation.user_id, success: false, error: error.message });
        }
      }

      const successCount = results.filter(r => r.success).length;
      console.log(`[NotificationService]  Sent to ${successCount}/${invitations.length} session participants`);

      return {
        success: true,
        sentTo: successCount,
        total: invitations.length,
        results
      };

    } catch (error) {
      console.error('[NotificationService] Send to session error:', error);
      throw error;
    }
  }

  /**
   * Send to recovery-eligible users
   */
  async sendToRecoveryUsers(notification) {
    try {
      const { data: recoveryStates, error } = await supabase
        .from('recovery_states')
        .select('user_id')
        .eq('status', 'eligible');

      if (error) {
        throw new Error(`Failed to fetch recovery users: ${error.message}`);
      }

      if (!recoveryStates || recoveryStates.length === 0) {
        return {
          success: false,
          message: 'No recovery-eligible users'
        };
      }

      // Send to each user
      const results = [];
      for (const state of recoveryStates) {
        try {
          await this.sendToUser(state.user_id, notification);
          results.push({ userId: state.user_id, success: true });
        } catch (error) {
          results.push({ userId: state.user_id, success: false, error: error.message });
        }
      }

      const successCount = results.filter(r => r.success).length;
      console.log(`[NotificationService]  Sent to ${successCount}/${recoveryStates.length} recovery users`);

      return {
        success: true,
        sentTo: successCount,
        total: recoveryStates.length,
        results
      };

    } catch (error) {
      console.error('[NotificationService] Send to recovery users error:', error);
      throw error;
    }
  }

  /**
   * Get user notifications
   */
  async getUserNotifications(userId, options = {}) {
    try {
      const {
        limit = 50,
        offset = 0,
        unreadOnly = false
      } = options;

      let query = supabase
        .from('trading_notifications')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1);

      if (unreadOnly) {
        query = query.eq('is_read', false);
      }

      const { data, error, count } = await query;

      if (error) {
        throw new Error(`Failed to fetch notifications: ${error.message}`);
      }

      return {
        success: true,
        notifications: data || [],
        total: count || 0
      };

    } catch (error) {
      console.error('[NotificationService] Get user notifications error:', error);
      throw error;
    }
  }

  /**
   * Mark notification as read
   */
  async markAsRead(notificationId) {
    try {
      const { data, error } = await supabase
        .from('trading_notifications')
        .update({
          is_read: true,
          read_at: new Date().toISOString()
        })
        .eq('id', notificationId)
        .select()
        .single();

      if (error) {
        throw new Error(`Failed to mark as read: ${error.message}`);
      }

      return {
        success: true,
        notification: data
      };

    } catch (error) {
      console.error('[NotificationService] Mark as read error:', error);
      throw error;
    }
  }

  /**
   * Mark all as read for user
   */
  async markAllAsRead(userId) {
    try {
      const { data, error } = await supabase
        .from('trading_notifications')
        .update({
          is_read: true,
          read_at: new Date().toISOString()
        })
        .eq('user_id', userId)
        .eq('is_read', false)
        .select();

      if (error) {
        throw new Error(`Failed to mark all as read: ${error.message}`);
      }

      return {
        success: true,
        updated: data?.length || 0
      };

    } catch (error) {
      console.error('[NotificationService] Mark all as read error:', error);
      throw error;
    }
  }

  /**
   * Delete notification
   */
  async deleteNotification(notificationId) {
    try {
      const { error } = await supabase
        .from('trading_notifications')
        .delete()
        .eq('id', notificationId);

      if (error) {
        throw new Error(`Failed to delete notification: ${error.message}`);
      }

      return {
        success: true
      };

    } catch (error) {
      console.error('[NotificationService] Delete notification error:', error);
      throw error;
    }
  }

  /**
   * Get unread count for user
   */
  async getUnreadCount(userId) {
    try {
      const { count, error } = await supabase
        .from('trading_notifications')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', userId)
        .eq('is_read', false);

      if (error) {
        throw new Error(`Failed to get unread count: ${error.message}`);
      }

      return {
        success: true,
        count: count || 0
      };

    } catch (error) {
      console.error('[NotificationService] Get unread count error:', error);
      throw error;
    }
  }

  /**
   * Send low balance warning
   */
  async sendLowBalanceWarning(userId, balance, minimumRequired) {
    return this.sendToUser(userId, {
      type: 'low_balance',
      title: 'Low Balance Warning',
      message: `Your balance ($${balance}) is below the minimum required ($${minimumRequired})`,
      data: { balance, minimumRequired }
    });
  }

  /**
   * Send TP hit notification
   */
  async sendTPHit(userId, profitLoss, sessionId) {
    return this.sendToUser(userId, {
      type: 'tp_hit',
      title: 'Take Profit Hit! ',
      message: `Congratulations! Your take profit was reached. Profit: $${profitLoss.toFixed(2)}`,
      data: { profitLoss, sessionId }
    });
  }

  /**
   * Send SL hit notification
   */
  async sendSLHit(userId, profitLoss, sessionId) {
    return this.sendToUser(userId, {
      type: 'sl_hit',
      title: 'Stop Loss Hit ',
      message: `Your stop loss was reached. Loss: $${Math.abs(profitLoss).toFixed(2)}. You're eligible for recovery session.`,
      data: { profitLoss, sessionId }
    });
  }

  /**
   * Send trade executed notification
   */
  async sendTradeExecuted(userId, tradeDetails) {
    return this.sendToUser(userId, {
      type: 'trade_executed',
      title: 'Trade Executed ',
      message: `New trade executed: ${tradeDetails.side} ${tradeDetails.digit}`,
      data: tradeDetails
    });
  }

  /**
   * Send session invite
   */
  async sendSessionInvite(userId, sessionId, sessionType) {
    return this.sendToUser(userId, {
      type: 'session_invite',
      title: 'New Session Invitation',
      message: `You've been invited to a ${sessionType} trading session`,
      data: { sessionId, sessionType }
    });
  }
}

module.exports = new NotificationService();
