/**
 * Trading Socket Handlers
 * Real-time trading events and notifications
 */

const { supabase } = require('../db/supabase');
const trading = require('../services/trading');

// Track active trading connections
const tradingConnections = new Map(); // sessionId -> Set of socket ids
const userTradingSockets = new Map(); // userId -> Set of socket ids

/**
 * Setup trading socket handlers
 * @param {Server} io - Socket.IO server instance
 * @param {Socket} socket - Socket connection
 */
function setupTradingHandlers(io, socket) {
  const userId = socket.userId;

  // Track user's trading socket
  if (!userTradingSockets.has(userId)) {
    userTradingSockets.set(userId, new Set());
  }
  userTradingSockets.get(userId).add(socket.id);

  // ==================== Session Events ====================

  /**
   * Join a trading session room for real-time updates
   */
  socket.on('trading:joinSession', async (data) => {
    const { sessionId } = data;

    try {
      // Verify user has access to this session in v2 system
      const { data: participation } = await supabase
        .from('session_participants')
        .select('*')
        .eq('session_id', sessionId)
        .eq('user_id', userId)
        .eq('status', 'active')
        .single();

      const { data: session } = await supabase
        .from('trading_sessions_v2')
        .select('admin_id')
        .eq('id', sessionId)
        .single();

      if (!participation && session?.admin_id !== userId) {
        socket.emit('trading:error', {
          message: 'Not authorized to join this session'
        });
        return;
      }

      const roomId = `trading:${sessionId}`;
      socket.join(roomId);

      // Track connection
      if (!tradingConnections.has(sessionId)) {
        tradingConnections.set(sessionId, new Set());
      }
      tradingConnections.get(sessionId).add(socket.id);

      socket.emit('trading:joinedSession', {
        sessionId,
        message: 'Successfully joined session'
      });

      // Notify others in session
      socket.to(roomId).emit('trading:userJoined', {
        sessionId,
        userId,
        username: socket.username,
        timestamp: new Date().toISOString()
      });

      console.log(`User ${socket.username} joined trading session ${sessionId}`);
    } catch (error) {
      console.error('Error joining trading session:', error);
      socket.emit('trading:error', { message: error.message });
    }
  });

  /**
   * Leave a trading session room
   */
  socket.on('trading:leaveSession', (data) => {
    const { sessionId } = data;
    const roomId = `trading:${sessionId}`;

    socket.leave(roomId);

    // Remove from tracking
    if (tradingConnections.has(sessionId)) {
      tradingConnections.get(sessionId).delete(socket.id);
    }

    socket.to(roomId).emit('trading:userLeft', {
      sessionId,
      userId,
      username: socket.username,
      timestamp: new Date().toISOString()
    });

    console.log(`User ${socket.username} left trading session ${sessionId}`);
  });

  // ==================== Tick Streaming ====================

  /**
   * Subscribe to tick updates for a volatility index
   */
  socket.on('trading:subscribeTicks', async (data) => {
    const { volatilityIndex, sessionId } = data;
    const tickRoom = `ticks:${volatilityIndex}`;

    socket.join(tickRoom);

    socket.emit('trading:ticksSubscribed', {
      volatilityIndex,
      message: `Subscribed to ${volatilityIndex} ticks`
    });

    console.log(`User ${socket.username} subscribed to ${volatilityIndex} ticks`);
  });

  /**
   * Unsubscribe from tick updates
   */
  socket.on('trading:unsubscribeTicks', (data) => {
    const { volatilityIndex } = data;
    const tickRoom = `ticks:${volatilityIndex}`;

    socket.leave(tickRoom);

    socket.emit('trading:ticksUnsubscribed', {
      volatilityIndex,
      message: `Unsubscribed from ${volatilityIndex} ticks`
    });
  });

  // ==================== Trade Events ====================

  /**
   * Request to execute a manual trade
   */
  socket.on('trading:executeTrade', async (data) => {
    const { sessionId, accountId, contractType, stake, prediction } = data;

    try {
      // Verify user owns this account
      const { data: account } = await supabase
        .from('trading_accounts')
        .select('*')
        .eq('id', accountId)
        .eq('user_id', userId)
        .single();

      if (!account) {
        socket.emit('trading:error', {
          message: 'Account not found or not authorized'
        });
        return;
      }

      // Execute trade through service
      const result = await trading.executeTrade({
        sessionId,
        userId,
        accountId,
        contractType,
        stake,
        prediction,
        volatilityIndex: data.volatilityIndex || 'R_100'
      });

      socket.emit('trading:tradeExecuted', result);

      // Broadcast to session room
      if (sessionId) {
        const roomId = `trading:${sessionId}`;
        socket.to(roomId).emit('trading:tradeUpdate', {
          sessionId,
          trade: result,
          executedBy: socket.username,
          timestamp: new Date().toISOString()
        });
      }
    } catch (error) {
      console.error('Error executing trade:', error);
      socket.emit('trading:error', { message: error.message });
    }
  });

  // ==================== Bot Control ====================

  /**
   * Start trading bot
   */
  socket.on('trading:startBot', async (data) => {
    const { sessionId, accountId } = data;

    try {
      const result = await trading.startBot(userId, sessionId, accountId);

      socket.emit('trading:botStarted', {
        sessionId,
        status: 'running',
        message: 'Trading bot started'
      });

      // Notify session room
      const roomId = `trading:${sessionId}`;
      io.to(roomId).emit('trading:sessionUpdate', {
        sessionId,
        status: 'active',
        startedBy: socket.username,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('Error starting bot:', error);
      socket.emit('trading:error', { message: error.message });
    }
  });

  /**
   * Stop trading bot
   */
  socket.on('trading:stopBot', async (data) => {
    const { sessionId } = data;

    try {
      const result = await trading.stopBot(userId, sessionId);

      socket.emit('trading:botStopped', {
        sessionId,
        status: 'stopped',
        message: 'Trading bot stopped'
      });

      // Notify session room
      const roomId = `trading:${sessionId}`;
      io.to(roomId).emit('trading:sessionUpdate', {
        sessionId,
        status: 'paused',
        stoppedBy: socket.username,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('Error stopping bot:', error);
      socket.emit('trading:error', { message: error.message });
    }
  });

  // ==================== Notifications ====================

  /**
   * Mark notification as read
   */
  socket.on('trading:markNotificationRead', async (data) => {
    const { notificationId } = data;

    try {
      await supabase
        .from('trading_notifications')
        .update({ is_read: true, read_at: new Date().toISOString() })
        .eq('id', notificationId)
        .eq('user_id', userId);

      socket.emit('trading:notificationRead', { notificationId });
    } catch (error) {
      console.error('Error marking notification read:', error);
    }
  });

  /**
   * Get unread notification count
   */
  socket.on('trading:getUnreadCount', async () => {
    try {
      const { count } = await supabase
        .from('trading_notifications')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', userId)
        .eq('is_read', false);

      socket.emit('trading:unreadCount', { count: count || 0 });
    } catch (error) {
      console.error('Error getting unread count:', error);
    }
  });

  // ==================== Cleanup ====================

  socket.on('disconnect', () => {
    // Remove from user sockets
    if (userTradingSockets.has(userId)) {
      userTradingSockets.get(userId).delete(socket.id);
      if (userTradingSockets.get(userId).size === 0) {
        userTradingSockets.delete(userId);
      }
    }

    // Remove from all trading sessions
    for (const [sessionId, sockets] of tradingConnections.entries()) {
      if (sockets.has(socket.id)) {
        sockets.delete(socket.id);
        const roomId = `trading:${sessionId}`;
        socket.to(roomId).emit('trading:userLeft', {
          sessionId,
          userId,
          username: socket.username,
          timestamp: new Date().toISOString()
        });
      }
    }

    console.log(`Trading socket disconnected: ${socket.username}`);
  });
}

// ==================== Broadcast Functions ====================

/**
 * Broadcast tick update to subscribers
 */
function broadcastTick(io, volatilityIndex, tickData) {
  const tickRoom = `ticks:${volatilityIndex}`;
  io.to(tickRoom).emit('trading:tick', {
    volatilityIndex,
    tick: tickData,
    timestamp: new Date().toISOString()
  });
}

/**
 * Broadcast trade result to session
 */
function broadcastTradeResult(io, sessionId, tradeData) {
  const roomId = `trading:${sessionId}`;
  io.to(roomId).emit('trading:tradeResult', {
    sessionId,
    trade: tradeData,
    timestamp: new Date().toISOString()
  });
}

/**
 * Broadcast session status update
 */
function broadcastSessionStatus(io, sessionId, status, stats = {}) {
  const roomId = `trading:${sessionId}`;
  io.to(roomId).emit('trading:sessionStatus', {
    sessionId,
    status,
    stats,
    timestamp: new Date().toISOString()
  });
}

/**
 * Send notification to specific user
 */
async function sendTradingNotification(io, userId, notification) {
  try {
    // Save to database
    const { data: savedNotification } = await supabase
      .from('trading_notifications')
      .insert({
        user_id: userId,
        notification_type: notification.type,
        title: notification.title,
        message: notification.message,
        session_id: notification.sessionId || null,
        metadata: notification.metadata || {}
      })
      .select()
      .single();

    // Send to user's sockets
    if (userTradingSockets.has(userId)) {
      for (const socketId of userTradingSockets.get(userId)) {
        io.to(socketId).emit('trading:notification', {
          ...savedNotification,
          timestamp: new Date().toISOString()
        });
      }
    }

    return savedNotification;
  } catch (error) {
    console.error('Error sending trading notification:', error);
    return null;
  }
}

/**
 * Broadcast session invitation
 */
async function broadcastInvitation(io, userId, invitation, session) {
  const notification = {
    type: 'session_invite',
    title: 'Trading Session Invitation',
    message: `You've been invited to join "${session.session_name}"`,
    sessionId: session.id,
    metadata: {
      invitationId: invitation.id,
      sessionName: session.session_name,
      strategy: session.strategy_name,
      volatilityIndex: session.volatility_index
    }
  };

  return sendTradingNotification(io, userId, notification);
}

module.exports = {
  setupTradingHandlers,
  broadcastTick,
  broadcastTradeResult,
  broadcastSessionStatus,
  sendTradingNotification,
  broadcastInvitation
};
