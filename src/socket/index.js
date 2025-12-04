/**
 * Socket.IO Event Handlers
 * Real-time WebSocket communication for chat
 */

const { supabase } = require('../db/supabase');
const { verifyToken } = require('../services/auth');
const { v4: uuidv4 } = require('uuid');

// Active connections tracking
const activeConnections = new Map(); // socketId -> { userId, username }
const userSockets = new Map(); // userId -> Set of socketIds
const roomPresence = new Map(); // roomId -> Map of userId -> userInfo
const typingUsers = new Map(); // roomId -> Set of userIds

/**
 * Get online users in a room
 */
function getRoomOnlineUsers(roomId) {
  const users = roomPresence.get(roomId);
  return users ? Array.from(users.values()) : [];
}

/**
 * Broadcast user presence to room
 */
function broadcastRoomPresence(io, roomId) {
  const users = getRoomOnlineUsers(roomId);
  io.to(roomId).emit('roomPresence', { roomId, users, count: users.length });
}

/**
 * Simple content moderation
 */
function moderateContent(content) {
  const bannedWords = ['spam', 'scam', 'guaranteed profits'];
  const lowerContent = content.toLowerCase();
  
  for (const word of bannedWords) {
    if (lowerContent.includes(word)) {
      return { approved: false, reason: 'Content contains prohibited words' };
    }
  }
  
  if (content.length > 2000) {
    return { approved: false, reason: 'Message too long (max 2000 characters)' };
  }
  
  return { approved: true };
}

/**
 * Setup Socket.IO handlers
 */
function setupSocketHandlers(io) {
  // Authentication middleware
  io.use((socket, next) => {
    const token = socket.handshake.auth.token;
    if (!token) {
      return next(new Error('Authentication required'));
    }
    
    const decoded = verifyToken(token);
    if (!decoded) {
      return next(new Error('Invalid or expired token'));
    }
    
    socket.userId = decoded.id || decoded.derivId;
    socket.username = decoded.fullName || decoded.email || 'Anonymous';
    next();
  });

  io.on('connection', async (socket) => {
    console.log(`User connected: ${socket.username} (${socket.id})`);
    
    // Track connection
    activeConnections.set(socket.id, { 
      userId: socket.userId, 
      username: socket.username 
    });
    
    const isNewUser = !userSockets.has(socket.userId);
    if (!userSockets.has(socket.userId)) {
      userSockets.set(socket.userId, new Set());
    }
    userSockets.get(socket.userId).add(socket.id);
    
    // Update user online status in database and broadcast if new
    try {
      const { data: userProfile } = await supabase
        .from('user_profiles')
        .update({ is_online: true, last_seen_at: new Date().toISOString() })
        .eq('deriv_id', socket.userId)
        .select('deriv_id, username, display_name, profile_photo, status_message')
        .single();
      
      // If user just came online (first socket), broadcast to all
      if (isNewUser && userProfile) {
        io.emit('userOnline', {
          derivId: userProfile.deriv_id,
          username: userProfile.username,
          displayName: userProfile.display_name,
          avatarUrl: userProfile.profile_photo,
          statusMessage: userProfile.status_message,
          timestamp: new Date().toISOString()
        });
      }
    } catch (err) {
      console.error('Failed to update online status:', err);
    }

    // ============ Room Events ============

    /**
     * Join a chatroom
     */
    socket.on('joinRoom', async (data) => {
      const { roomId } = data;
      
      try {
        // Join socket room
        socket.join(roomId);
        
        // Track presence
        if (!roomPresence.has(roomId)) {
          roomPresence.set(roomId, new Map());
        }
        roomPresence.get(roomId).set(socket.userId, {
          id: socket.userId,
          username: socket.username,
          joinedAt: new Date().toISOString()
        });
        
        // Notify room
        socket.to(roomId).emit('userJoined', {
          roomId,
          userId: socket.userId,
          username: socket.username,
          timestamp: new Date().toISOString()
        });
        
        // Send presence update
        broadcastRoomPresence(io, roomId);
        
        // Send join confirmation with recent messages
        const { data: messages } = await supabase
          .from('Message')
          .select('*')
          .eq('chatroomId', roomId)
          .order('createdAt', { ascending: false })
          .limit(50);
        
        socket.emit('joinedRoom', { 
          roomId, 
          success: true,
          messages: messages?.reverse() || []
        });
        
      } catch (err) {
        console.error('Join room error:', err);
        socket.emit('error', { code: 'JOIN_ERROR', message: 'Failed to join room' });
      }
    });

    /**
     * Leave a chatroom
     */
    socket.on('leaveRoom', (data) => {
      const { roomId } = data;
      
      socket.leave(roomId);
      
      // Update presence
      const presence = roomPresence.get(roomId);
      if (presence) {
        presence.delete(socket.userId);
        if (presence.size === 0) {
          roomPresence.delete(roomId);
        }
      }
      
      // Clear typing status
      const typing = typingUsers.get(roomId);
      if (typing) {
        typing.delete(socket.userId);
      }
      
      // Notify room
      socket.to(roomId).emit('userLeft', {
        roomId,
        userId: socket.userId,
        username: socket.username,
        timestamp: new Date().toISOString()
      });
      
      broadcastRoomPresence(io, roomId);
    });

    // ============ Message Events ============

    /**
     * Send a message
     */
    socket.on('sendMessage', async (data) => {
      const { roomId, content, replyTo } = data;
      
      if (!content || content.trim().length === 0) {
        socket.emit('error', { code: 'EMPTY_MESSAGE', message: 'Message cannot be empty' });
        return;
      }
      
      try {
        // Moderate message
        const moderation = moderateContent(content);
        if (!moderation.approved) {
          socket.emit('messageModerated', {
            reason: moderation.reason
          });
          return;
        }
        
        // Create message in database
        const messageId = uuidv4();
        const { data: message, error } = await supabase
          .from('Message')
          .insert({
            id: messageId,
            senderId: socket.userId,
            chatroomId: roomId,
            content: content.trim(),
            replyToId: replyTo || null,
            status: 'SENT'
          })
          .select()
          .single();
        
        if (error) throw error;
        
        // Clear typing indicator
        const typing = typingUsers.get(roomId);
        if (typing) {
          typing.delete(socket.userId);
          io.to(roomId).emit('typingUpdate', { 
            roomId, 
            users: Array.from(typing) 
          });
        }
        
        // Broadcast message to room
        io.to(roomId).emit('newMessage', {
          id: message.id,
          roomId,
          content: message.content,
          senderId: socket.userId,
          senderName: socket.username,
          replyToId: message.replyToId,
          createdAt: message.createdAt
        });
        
      } catch (err) {
        console.error('Send message error:', err);
        socket.emit('error', { code: 'SEND_ERROR', message: 'Failed to send message' });
      }
    });

    /**
     * Typing indicator
     */
    socket.on('typing', (data) => {
      const { roomId, isTyping } = data;
      
      if (!typingUsers.has(roomId)) {
        typingUsers.set(roomId, new Set());
      }
      
      const typing = typingUsers.get(roomId);
      
      if (isTyping) {
        typing.add(socket.userId);
      } else {
        typing.delete(socket.userId);
      }
      
      // Broadcast typing status
      socket.to(roomId).emit('typingUpdate', {
        roomId,
        users: Array.from(typing).map(id => {
          const conn = activeConnections.get(socket.id);
          return { id, username: conn?.username || 'Someone' };
        })
      });
    });

    /**
     * Mark messages as read
     */
    socket.on('markRead', async (data) => {
      const { roomId, messageId } = data;
      
      try {
        await supabase
          .from('Message')
          .update({ status: 'READ' })
          .eq('chatroomId', roomId)
          .eq('id', messageId);
          
        socket.to(roomId).emit('messagesRead', {
          roomId,
          userId: socket.userId,
          upToMessageId: messageId
        });
      } catch (err) {
        console.error('Mark read error:', err);
      }
    });

    /**
     * Add reaction to message
     */
    socket.on('addReaction', async (data) => {
      const { messageId, reaction, roomId } = data;
      
      // Broadcast reaction (store in memory for simplicity)
      io.to(roomId).emit('reactionAdded', {
        messageId,
        reaction,
        userId: socket.userId,
        username: socket.username
      });
    });

    // ============ Profile Sync Events ============

    /**
     * Handle profile updates - broadcast to all connected users
     */
    socket.on('profileUpdate', async (data) => {
      const { derivId, username, displayName, avatarUrl, statusMessage } = data;
      
      console.log(`Profile update from ${socket.username}:`, data);
      
      // Update all rooms this user is in
      for (const [roomId, presence] of roomPresence) {
        if (presence.has(socket.userId)) {
          presence.set(socket.userId, {
            id: socket.userId,
            derivId: derivId,
            username: username || socket.username,
            displayName: displayName,
            avatarUrl: avatarUrl,
            statusMessage: statusMessage,
            joinedAt: presence.get(socket.userId)?.joinedAt || new Date().toISOString()
          });
          
          // Broadcast updated presence
          broadcastRoomPresence(io, roomId);
        }
      }
      
      // Update socket username for future messages
      if (username) {
        socket.username = username;
        const conn = activeConnections.get(socket.id);
        if (conn) {
          conn.username = username;
        }
      }
      
      // Broadcast profile update to all connected clients
      io.emit('userProfileUpdated', {
        derivId: derivId,
        userId: socket.userId,
        username: username,
        displayName: displayName,
        avatarUrl: avatarUrl,
        statusMessage: statusMessage,
        timestamp: new Date().toISOString()
      });
    });

    // ============ Settings Sync Events ============

    /**
     * Profile update - broadcast to all user's sessions
     */
    socket.on('profile:update', (data) => {
      const { derivId, username, displayName, bio, avatarUrl } = data;
      
      // Broadcast to all this user's sockets
      const sockets = userSockets.get(socket.userId);
      if (sockets) {
        sockets.forEach(socketId => {
          if (socketId !== socket.id) {
            io.to(socketId).emit('profile:updated', {
              username, displayName, bio, avatarUrl, timestamp: new Date().toISOString()
            });
          }
        });
      }
      
      // Also broadcast profile change to interested parties (community, chat)
      io.emit('userProfileUpdated', { derivId, username, displayName, avatarUrl });
    });

    /**
     * Avatar update - broadcast globally
     */
    socket.on('profile:avatar:update', (data) => {
      const { derivId, avatarUrl } = data;
      
      io.emit('userAvatarUpdated', {
        derivId,
        avatarUrl,
        timestamp: new Date().toISOString()
      });
    });

    /**
     * Settings update - sync across user's sessions
     */
    socket.on('settings:update', (data) => {
      const { type, settings } = data;
      
      // Broadcast to all this user's other sockets
      const sockets = userSockets.get(socket.userId);
      if (sockets) {
        sockets.forEach(socketId => {
          if (socketId !== socket.id) {
            io.to(socketId).emit('settings:updated', { type, settings });
          }
        });
      }
    });

    /**
     * Session termination - force logout specific session
     */
    socket.on('session:terminate', (data) => {
      const { sessionId, all, except } = data;
      
      const sockets = userSockets.get(socket.userId);
      if (!sockets) return;

      if (all) {
        // Terminate all sessions except the specified one
        sockets.forEach(socketId => {
          if (socketId !== except) {
            io.to(socketId).emit('session:terminated', { all: true });
          }
        });
      } else if (sessionId) {
        // Terminate specific session
        io.to(sessionId).emit('session:terminated', { sessionId });
      }
    });

    /**
     * User going offline intentionally
     */
    socket.on('user:offline', async (data) => {
      const { derivId } = data;
      
      try {
        await supabase
          .from('user_profiles')
          .update({ is_online: false, last_seen_at: new Date().toISOString() })
          .eq('deriv_id', derivId);
        
        io.emit('userOffline', { derivId, timestamp: new Date().toISOString() });
      } catch (err) {
        console.error('Failed to update offline status:', err);
      }
    });

    /**
     * Request online users list
     */
    socket.on('getOnlineUsers', () => {
      const onlineUsers = [];
      for (const [socketId, info] of activeConnections) {
        onlineUsers.push({
          derivId: info.userId,
          username: info.username,
          socketId: socketId
        });
      }
      socket.emit('onlineUsers', onlineUsers);
    });

    // ============ Direct Messages ============

    /**
     * Send direct message
     */
    socket.on('directMessage', async (data) => {
      const { targetUserId, content } = data;
      
      if (!content || content.trim().length === 0) return;
      
      const messageId = uuidv4();
      const message = {
        id: messageId,
        senderId: socket.userId,
        senderName: socket.username,
        content: content.trim(),
        timestamp: new Date().toISOString()
      };
      
      // Send to target user if online
      const targetSockets = userSockets.get(targetUserId);
      if (targetSockets) {
        targetSockets.forEach(socketId => {
          io.to(socketId).emit('directMessage', message);
        });
      }
      
      // Confirm to sender
      socket.emit('directMessageSent', message);
    });

    // ============ Disconnect ============

    socket.on('disconnect', async () => {
      console.log(`User disconnected: ${socket.username} (${socket.id})`);
      
      // Remove from tracking
      activeConnections.delete(socket.id);
      
      const sockets = userSockets.get(socket.userId);
      if (sockets) {
        sockets.delete(socket.id);
        if (sockets.size === 0) {
          userSockets.delete(socket.userId);
          
          // User completely offline, broadcast to all clients
          io.emit('userOffline', {
            derivId: socket.userId,
            username: socket.username,
            timestamp: new Date().toISOString()
          });
          
          // Update all room presences
          for (const [roomId, presence] of roomPresence) {
            if (presence.has(socket.userId)) {
              presence.delete(socket.userId);
              broadcastRoomPresence(io, roomId);
              
              io.to(roomId).emit('userLeft', {
                roomId,
                userId: socket.userId,
                username: socket.username,
                timestamp: new Date().toISOString()
              });
            }
          }
          
          // Update database
          try {
            await supabase
              .from('user_profiles')
              .update({ is_online: false, last_seen_at: new Date().toISOString() })
              .eq('deriv_id', socket.userId);
          } catch (err) {
            console.error('Failed to update offline status:', err);
          }
        }
      }
    });

    // ============ Error Handling ============

    socket.on('error', (err) => {
      console.error(`Socket error for ${socket.username}:`, err);
    });
  });

  console.log('📡 Socket.IO handlers initialized');
}

module.exports = { setupSocketHandlers };
