

const { supabase } = require('../db/supabase');
const { verifyToken } = require('../services/auth');
const { v4: uuidv4 } = require('uuid');
const { setupTradingHandlers } = require('./trading');

const activeConnections = new Map(); 
const userSockets = new Map(); 
const roomPresence = new Map(); 
const typingUsers = new Map(); 

function getRoomOnlineUsers(roomId) {
  const users = roomPresence.get(roomId);
  return users ? Array.from(users.values()) : [];
}

function broadcastRoomPresence(io, roomId) {
  const users = getRoomOnlineUsers(roomId);
  io.to(roomId).emit('roomPresence', { roomId, users, count: users.length });
}

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

function setupSocketHandlers(io) {
  
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
    
    
    activeConnections.set(socket.id, { 
      userId: socket.userId, 
      username: socket.username 
    });
    
    const isNewUser = !userSockets.has(socket.userId);
    if (!userSockets.has(socket.userId)) {
      userSockets.set(socket.userId, new Set());
    }
    userSockets.get(socket.userId).add(socket.id);
    
    
    try {
      const { data: userProfile } = await supabase
        .from('user_profiles')
        .update({ is_online: true, last_seen_at: new Date().toISOString() })
        .eq('deriv_id', socket.userId)
        .select('deriv_id, username, display_name, profile_photo, status_message')
        .single();
      
      
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

    // Setup trading socket handlers
    setupTradingHandlers(io, socket);

    
    socket.on('joinRoom', async (data) => {
      const { roomId } = data;
      
      try {
        
        socket.join(roomId);
        
        
        if (!roomPresence.has(roomId)) {
          roomPresence.set(roomId, new Map());
        }
        roomPresence.get(roomId).set(socket.userId, {
          id: socket.userId,
          username: socket.username,
          joinedAt: new Date().toISOString()
        });
        
        
        socket.to(roomId).emit('userJoined', {
          roomId,
          userId: socket.userId,
          username: socket.username,
          timestamp: new Date().toISOString()
        });
        
        
        broadcastRoomPresence(io, roomId);
        
        
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

    
    socket.on('leaveRoom', (data) => {
      const { roomId } = data;
      
      socket.leave(roomId);
      
      
      const presence = roomPresence.get(roomId);
      if (presence) {
        presence.delete(socket.userId);
        if (presence.size === 0) {
          roomPresence.delete(roomId);
        }
      }
      
      
      const typing = typingUsers.get(roomId);
      if (typing) {
        typing.delete(socket.userId);
      }
      
      
      socket.to(roomId).emit('userLeft', {
        roomId,
        userId: socket.userId,
        username: socket.username,
        timestamp: new Date().toISOString()
      });
      
      broadcastRoomPresence(io, roomId);
    });

    

    
    socket.on('sendMessage', async (data) => {
      const { roomId, content, replyTo } = data;
      
      if (!content || content.trim().length === 0) {
        socket.emit('error', { code: 'EMPTY_MESSAGE', message: 'Message cannot be empty' });
        return;
      }
      
      try {
        
        const moderation = moderateContent(content);
        if (!moderation.approved) {
          socket.emit('messageModerated', {
            reason: moderation.reason
          });
          return;
        }
        
        
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
        
        
        const typing = typingUsers.get(roomId);
        if (typing) {
          typing.delete(socket.userId);
          io.to(roomId).emit('typingUpdate', { 
            roomId, 
            users: Array.from(typing) 
          });
        }
        
        
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
      
      
      socket.to(roomId).emit('typingUpdate', {
        roomId,
        users: Array.from(typing).map(id => {
          const conn = activeConnections.get(socket.id);
          return { id, username: conn?.username || 'Someone' };
        })
      });
    });

    
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

    
    socket.on('addReaction', async (data) => {
      const { messageId, reaction, roomId } = data;
      
      
      io.to(roomId).emit('reactionAdded', {
        messageId,
        reaction,
        userId: socket.userId,
        username: socket.username
      });
    });

    

    
    socket.on('profileUpdate', async (data) => {
      const { derivId, username, displayName, avatarUrl, statusMessage } = data;
      
      console.log(`Profile update from ${socket.username}:`, data);
      
      
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
          
          
          broadcastRoomPresence(io, roomId);
        }
      }
      
      
      if (username) {
        socket.username = username;
        const conn = activeConnections.get(socket.id);
        if (conn) {
          conn.username = username;
        }
      }
      
      
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

    

    
    socket.on('profile:update', (data) => {
      const { derivId, username, displayName, bio, avatarUrl } = data;
      
      
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
      
      
      io.emit('userProfileUpdated', { derivId, username, displayName, avatarUrl });
    });

    
    socket.on('profile:avatar:update', (data) => {
      const { derivId, avatarUrl } = data;
      
      io.emit('userAvatarUpdated', {
        derivId,
        avatarUrl,
        timestamp: new Date().toISOString()
      });
    });

    
    socket.on('settings:update', (data) => {
      const { type, settings } = data;
      
      
      const sockets = userSockets.get(socket.userId);
      if (sockets) {
        sockets.forEach(socketId => {
          if (socketId !== socket.id) {
            io.to(socketId).emit('settings:updated', { type, settings });
          }
        });
      }
    });

    
    socket.on('session:terminate', (data) => {
      const { sessionId, all, except } = data;
      
      const sockets = userSockets.get(socket.userId);
      if (!sockets) return;

      if (all) {
        
        sockets.forEach(socketId => {
          if (socketId !== except) {
            io.to(socketId).emit('session:terminated', { all: true });
          }
        });
      } else if (sessionId) {
        
        io.to(sessionId).emit('session:terminated', { sessionId });
      }
    });

    
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
      
      
      const targetSockets = userSockets.get(targetUserId);
      if (targetSockets) {
        targetSockets.forEach(socketId => {
          io.to(socketId).emit('directMessage', message);
        });
      }
      
      
      socket.emit('directMessageSent', message);
    });

    

    socket.on('disconnect', async () => {
      console.log(`User disconnected: ${socket.username} (${socket.id})`);
      
      
      activeConnections.delete(socket.id);
      
      const sockets = userSockets.get(socket.userId);
      if (sockets) {
        sockets.delete(socket.id);
        if (sockets.size === 0) {
          userSockets.delete(socket.userId);
          
          
          io.emit('userOffline', {
            derivId: socket.userId,
            username: socket.username,
            timestamp: new Date().toISOString()
          });
          
          
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

    

    socket.on('error', (err) => {
      console.error(`Socket error for ${socket.username}:`, err);
    });
  });

  console.log('📡 Socket.IO handlers initialized');
}

module.exports = { setupSocketHandlers };
