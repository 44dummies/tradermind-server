/**
 * Friends Center Socket Handlers
 * Real-time WebSocket events for the friends system
 */

const FriendsService = require('../services/friends');
const ChatService = require('../services/chat');
const SharedService = require('../services/shared');
const NotificationsService = require('../services/notifications');

// Store user socket mappings
const userSockets = new Map(); // Map<userId, Set<socketId>>
const socketUsers = new Map(); // Map<socketId, userId>

function setupFriendsSocketHandlers(io) {
  const friendsNamespace = io.of('/friends');

  friendsNamespace.on('connection', async (socket) => {
    console.log(`[Friends] Socket connected: ${socket.id}`);

    // =============================================
    // AUTHENTICATION & PRESENCE
    // =============================================

    socket.on('auth', async (data) => {
      try {
        const { derivId, token } = data;
        
        // Get user profile
        const profile = await FriendsService.getProfileByDerivId(derivId);
        if (!profile) {
          socket.emit('auth:error', { message: 'User not found' });
          return;
        }

        const userId = profile.id;
        socket.userId = userId;
        socket.derivId = derivId;
        socket.userProfile = profile;

        // Track socket
        if (!userSockets.has(userId)) {
          userSockets.set(userId, new Set());
        }
        userSockets.get(userId).add(socket.id);
        socketUsers.set(socket.id, userId);

        // Join user room
        socket.join(`user:${userId}`);

        // Update online status
        await FriendsService.updateOnlineStatus(userId, true, socket.id);

        // Notify friends
        const friends = await FriendsService.getFriends(userId);
        for (const f of friends) {
          friendsNamespace.to(`user:${f.friend_id}`).emit('friend:online', {
            userId,
            username: profile.username,
            isOnline: true
          });
        }

        // Get unread counts
        const notificationCount = await NotificationsService.getUnreadCount(userId);
        const messageCount = await ChatService.getTotalUnreadCount(userId);
        const pendingRequests = await FriendsService.getPendingRequests(userId);

        socket.emit('auth:success', {
          user: profile,
          unreadNotifications: notificationCount,
          unreadMessages: messageCount,
          pendingRequests: pendingRequests.length
        });

        console.log(`[Friends] User authenticated: ${profile.username} (${userId})`);
      } catch (error) {
        console.error('[Friends] Auth error:', error);
        socket.emit('auth:error', { message: error.message });
      }
    });

    // =============================================
    // CHAT ROOM MANAGEMENT
    // =============================================

    socket.on('chat:join', async (chatId) => {
      try {
        if (!socket.userId) {
          socket.emit('error', { message: 'Not authenticated' });
          return;
        }

        // Verify user is participant
        const chat = await ChatService.getChatById(chatId);
        if (!chat || (chat.user1_id !== socket.userId && chat.user2_id !== socket.userId)) {
          socket.emit('error', { message: 'Not authorized for this chat' });
          return;
        }

        socket.join(`chat:${chatId}`);
        socket.currentChatId = chatId;

        // Mark messages as read
        await ChatService.markAsRead(chatId, socket.userId);

        // Notify other user
        const otherUserId = chat.user1_id === socket.userId ? chat.user2_id : chat.user1_id;
        friendsNamespace.to(`user:${otherUserId}`).emit('chat:joined', {
          chatId,
          userId: socket.userId
        });

        console.log(`[Friends] User ${socket.userId} joined chat ${chatId}`);
      } catch (error) {
        console.error('[Friends] Join chat error:', error);
        socket.emit('error', { message: error.message });
      }
    });

    socket.on('chat:leave', (chatId) => {
      socket.leave(`chat:${chatId}`);
      if (socket.currentChatId === chatId) {
        socket.currentChatId = null;
      }
    });

    // =============================================
    // MESSAGING
    // =============================================

    socket.on('chat:message', async (data) => {
      try {
        if (!socket.userId) {
          socket.emit('error', { message: 'Not authenticated' });
          return;
        }

        const { chatId, ...messageData } = data;

        // Verify user is participant
        const chat = await ChatService.getChatById(chatId);
        if (!chat || (chat.user1_id !== socket.userId && chat.user2_id !== socket.userId)) {
          socket.emit('error', { message: 'Not authorized' });
          return;
        }

        // Send message
        const message = await ChatService.sendMessage(chatId, socket.userId, messageData);

        // Emit to chat room
        friendsNamespace.to(`chat:${chatId}`).emit('chat:message', message);

        // Notify other user if not in chat
        const otherUserId = chat.user1_id === socket.userId ? chat.user2_id : chat.user1_id;
        friendsNamespace.to(`user:${otherUserId}`).emit('chat:newMessage', {
          chatId,
          message,
          from: socket.userProfile
        });

      } catch (error) {
        console.error('[Friends] Message error:', error);
        socket.emit('error', { message: error.message });
      }
    });

    socket.on('chat:typing', async (data) => {
      try {
        const { chatId, isTyping } = data;
        
        // Update typing status
        await ChatService.setTyping(chatId, socket.userId, isTyping);

        // Emit to chat room
        friendsNamespace.to(`chat:${chatId}`).emit('chat:typing', {
          chatId,
          userId: socket.userId,
          username: socket.userProfile?.username,
          isTyping
        });
      } catch (error) {
        console.error('[Friends] Typing error:', error);
      }
    });

    socket.on('chat:read', async (chatId) => {
      try {
        await ChatService.markAsRead(chatId, socket.userId);
        
        friendsNamespace.to(`chat:${chatId}`).emit('chat:read', {
          chatId,
          userId: socket.userId
        });
      } catch (error) {
        console.error('[Friends] Read error:', error);
      }
    });

    socket.on('chat:reaction', async (data) => {
      try {
        const { chatId, messageId, reaction } = data;
        
        const result = await ChatService.addReaction(messageId, socket.userId, reaction);
        
        friendsNamespace.to(`chat:${chatId}`).emit('chat:reaction', {
          chatId,
          messageId,
          userId: socket.userId,
          reaction,
          reactions: result.reactions
        });
      } catch (error) {
        console.error('[Friends] Reaction error:', error);
      }
    });

    socket.on('chat:ping', async (chatId) => {
      try {
        const message = await ChatService.sendPing(chatId, socket.userId);
        
        friendsNamespace.to(`chat:${chatId}`).emit('chat:message', message);

        const chat = await ChatService.getChatById(chatId);
        const otherUserId = chat.user1_id === socket.userId ? chat.user2_id : chat.user1_id;
        
        friendsNamespace.to(`user:${otherUserId}`).emit('chat:ping', {
          from: socket.userProfile,
          chatId
        });
      } catch (error) {
        console.error('[Friends] Ping error:', error);
      }
    });

    // =============================================
    // SHARED NOTES (Real-time collaboration)
    // =============================================

    socket.on('notes:join', (chatId) => {
      socket.join(`notes:${chatId}`);
    });

    socket.on('notes:leave', (chatId) => {
      socket.leave(`notes:${chatId}`);
    });

    socket.on('notes:update', async (data) => {
      try {
        const { chatId, content, title } = data;
        
        const notes = await SharedService.updateNotes(chatId, socket.userId, content, title);
        
        // Emit to all in notes room except sender
        socket.to(`notes:${chatId}`).emit('notes:updated', {
          chatId,
          notes,
          editedBy: socket.userId,
          editedByUsername: socket.userProfile?.username
        });
      } catch (error) {
        console.error('[Friends] Notes update error:', error);
      }
    });

    socket.on('notes:cursor', (data) => {
      // Real-time cursor position
      const { chatId, position } = data;
      socket.to(`notes:${chatId}`).emit('notes:cursor', {
        userId: socket.userId,
        username: socket.userProfile?.username,
        position
      });
    });

    // =============================================
    // SHARED WATCHLIST
    // =============================================

    socket.on('watchlist:update', async (data) => {
      const { chatId, action, payload } = data;
      
      try {
        let watchlist;
        
        switch (action) {
          case 'addSymbol':
            watchlist = await SharedService.addSymbol(chatId, socket.userId, payload);
            break;
          case 'removeSymbol':
            watchlist = await SharedService.removeSymbol(chatId, payload.symbol);
            break;
          case 'updateNotes':
            watchlist = await SharedService.updateSymbolNotes(chatId, payload.symbol, payload.notes);
            break;
        }
        
        friendsNamespace.to(`chat:${chatId}`).emit('watchlist:updated', {
          chatId,
          watchlist,
          action,
          updatedBy: socket.userId
        });
      } catch (error) {
        console.error('[Friends] Watchlist update error:', error);
        socket.emit('error', { message: error.message });
      }
    });

    // =============================================
    // FRIEND REQUESTS
    // =============================================

    socket.on('friend:request', async (targetUserId) => {
      try {
        const result = await FriendsService.sendFriendRequest(socket.userId, targetUserId);
        
        friendsNamespace.to(`user:${targetUserId}`).emit('friend:request', {
          from: socket.userProfile,
          friendship: result
        });
        
        socket.emit('friend:requestSent', { success: true, friendship: result });
      } catch (error) {
        socket.emit('error', { message: error.message });
      }
    });

    socket.on('friend:accept', async (friendshipId) => {
      try {
        const result = await FriendsService.acceptFriendRequest(socket.userId, friendshipId);
        
        friendsNamespace.to(`user:${result.friendship.user_id}`).emit('friend:accepted', {
          from: socket.userProfile,
          friendship: result.friendship,
          chatId: result.chatId
        });
        
        socket.emit('friend:accepted', {
          friendship: result.friendship,
          chatId: result.chatId
        });
      } catch (error) {
        socket.emit('error', { message: error.message });
      }
    });

    socket.on('friend:decline', async (friendshipId) => {
      try {
        await FriendsService.declineFriendRequest(socket.userId, friendshipId);
        socket.emit('friend:declined', { friendshipId });
      } catch (error) {
        socket.emit('error', { message: error.message });
      }
    });

    // =============================================
    // NOTIFICATIONS
    // =============================================

    socket.on('notification:read', async (notificationId) => {
      try {
        await NotificationsService.markAsRead(notificationId, socket.userId);
      } catch (error) {
        console.error('[Friends] Notification read error:', error);
      }
    });

    socket.on('notifications:readAll', async () => {
      try {
        await NotificationsService.markAllAsRead(socket.userId);
      } catch (error) {
        console.error('[Friends] Read all notifications error:', error);
      }
    });

    // =============================================
    // PRESENCE
    // =============================================

    socket.on('presence:update', async (status) => {
      try {
        if (socket.userId) {
          await FriendsService.updateProfile(socket.userId, { status_message: status });
          
          const friends = await FriendsService.getFriends(socket.userId);
          for (const f of friends) {
            friendsNamespace.to(`user:${f.friend_id}`).emit('friend:statusUpdate', {
              userId: socket.userId,
              status
            });
          }
        }
      } catch (error) {
        console.error('[Friends] Presence update error:', error);
      }
    });

    // =============================================
    // DISCONNECT
    // =============================================

    socket.on('disconnect', async () => {
      try {
        const userId = socketUsers.get(socket.id);
        
        if (userId) {
          socketUsers.delete(socket.id);
          const userSocketSet = userSockets.get(userId);
          
          if (userSocketSet) {
            userSocketSet.delete(socket.id);
            
            // If no more sockets for this user, mark offline
            if (userSocketSet.size === 0) {
              userSockets.delete(userId);
              
              await FriendsService.updateOnlineStatus(userId, false);
              
              // Notify friends
              const friends = await FriendsService.getFriends(userId);
              for (const f of friends) {
                friendsNamespace.to(`user:${f.friend_id}`).emit('friend:offline', {
                  userId,
                  lastSeen: new Date().toISOString()
                });
              }
            }
          }
        }
        
        console.log(`[Friends] Socket disconnected: ${socket.id}`);
      } catch (error) {
        console.error('[Friends] Disconnect error:', error);
      }
    });
  });

  // Also support main namespace for backward compatibility
  io.on('connection', (socket) => {
    // Forward to friends namespace if friends-related
    socket.on('friends:*', (event, data) => {
      friendsNamespace.emit(event, data);
    });
  });

  console.log('[Friends] Socket handlers initialized');
}

// Helper: Send notification to user
async function sendNotificationToUser(io, userId, notification) {
  io.of('/friends').to(`user:${userId}`).emit('notification', notification);
}

// Helper: Get online friends
function getOnlineFriends(userId, friendIds) {
  return friendIds.filter(id => userSockets.has(id));
}

module.exports = { 
  setupFriendsSocketHandlers, 
  sendNotificationToUser,
  getOnlineFriends,
  userSockets,
  socketUsers
};
