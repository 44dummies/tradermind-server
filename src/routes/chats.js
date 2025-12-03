/**
 * Chat API Routes
 * Handles private messaging between friends
 */

const express = require('express');
const router = express.Router();
const ChatService = require('../services/chat');
const FriendsService = require('../services/friends');
const { authMiddleware } = require('../middleware/auth');

router.use(authMiddleware);

// =============================================
// CHAT ROUTES
// =============================================

/**
 * GET /api/chats
 * Get all chats for current user
 */
router.get('/', async (req, res) => {
  try {
    const currentUser = await FriendsService.getProfileByDerivId(req.user.derivId);
    if (!currentUser) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    const chats = await ChatService.getUserChats(currentUser.id);
    
    // Add unread counts
    const chatsWithUnread = await Promise.all(chats.map(async (chat) => {
      const unreadCount = await ChatService.getUnreadCount(chat.id, currentUser.id);
      return { ...chat, unreadCount };
    }));
    
    res.json(chatsWithUnread);
  } catch (error) {
    console.error('Get chats error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/chats/:chatId
 * Get chat by ID
 */
router.get('/:chatId', async (req, res) => {
  try {
    const currentUser = await FriendsService.getProfileByDerivId(req.user.derivId);
    if (!currentUser) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    const chat = await ChatService.getChatById(req.params.chatId);
    if (!chat) {
      return res.status(404).json({ error: 'Chat not found' });
    }
    
    // Verify user is participant
    if (chat.user1_id !== currentUser.id && chat.user2_id !== currentUser.id) {
      return res.status(403).json({ error: 'Not authorized' });
    }
    
    res.json(chat);
  } catch (error) {
    console.error('Get chat error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/chats/with/:userId
 * Get or create chat with a user
 */
router.get('/with/:userId', async (req, res) => {
  try {
    const currentUser = await FriendsService.getProfileByDerivId(req.user.derivId);
    if (!currentUser) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    // Verify friendship
    const friendship = await FriendsService.getFriendshipStatus(currentUser.id, req.params.userId);
    if (!friendship || friendship.status !== 'accepted') {
      return res.status(403).json({ error: 'Must be friends to chat' });
    }
    
    const chatId = await FriendsService.getOrCreateChat(currentUser.id, req.params.userId);
    const chat = await ChatService.getChatById(chatId);
    
    res.json(chat);
  } catch (error) {
    console.error('Get/create chat error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * PUT /api/chats/:chatId/archive
 * Archive/unarchive chat
 */
router.put('/:chatId/archive', async (req, res) => {
  try {
    const currentUser = await FriendsService.getProfileByDerivId(req.user.derivId);
    if (!currentUser) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    const { archived } = req.body;
    const result = await ChatService.toggleArchiveChat(req.params.chatId, currentUser.id, archived);
    res.json(result);
  } catch (error) {
    console.error('Archive chat error:', error);
    res.status(500).json({ error: error.message });
  }
});

// =============================================
// MESSAGE ROUTES
// =============================================

/**
 * GET /api/chats/:chatId/messages
 * Get messages for a chat
 */
router.get('/:chatId/messages', async (req, res) => {
  try {
    const currentUser = await FriendsService.getProfileByDerivId(req.user.derivId);
    if (!currentUser) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    // Verify user is participant
    const chat = await ChatService.getChatById(req.params.chatId);
    if (!chat || (chat.user1_id !== currentUser.id && chat.user2_id !== currentUser.id)) {
      return res.status(403).json({ error: 'Not authorized' });
    }
    
    const { limit, before, after } = req.query;
    const messages = await ChatService.getMessages(req.params.chatId, {
      limit: parseInt(limit) || 50,
      before,
      after
    });
    
    res.json(messages);
  } catch (error) {
    console.error('Get messages error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/chats/:chatId/messages
 * Send a message
 */
router.post('/:chatId/messages', async (req, res) => {
  try {
    const currentUser = await FriendsService.getProfileByDerivId(req.user.derivId);
    if (!currentUser) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    // Verify user is participant
    const chat = await ChatService.getChatById(req.params.chatId);
    if (!chat || (chat.user1_id !== currentUser.id && chat.user2_id !== currentUser.id)) {
      return res.status(403).json({ error: 'Not authorized' });
    }
    
    const message = await ChatService.sendMessage(req.params.chatId, currentUser.id, req.body);
    
    // Emit via socket
    const io = req.app.get('io');
    if (io) {
      io.to(`chat:${req.params.chatId}`).emit('chat:message', message);
      
      // Notify other user
      const otherUserId = chat.user1_id === currentUser.id ? chat.user2_id : chat.user1_id;
      io.to(`user:${otherUserId}`).emit('chat:newMessage', {
        chatId: req.params.chatId,
        message,
        from: currentUser
      });
    }
    
    res.json(message);
  } catch (error) {
    console.error('Send message error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * PUT /api/chats/:chatId/read
 * Mark messages as read
 */
router.put('/:chatId/read', async (req, res) => {
  try {
    const currentUser = await FriendsService.getProfileByDerivId(req.user.derivId);
    if (!currentUser) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    const result = await ChatService.markAsRead(req.params.chatId, currentUser.id);
    
    // Emit read receipt
    const io = req.app.get('io');
    if (io) {
      io.to(`chat:${req.params.chatId}`).emit('chat:read', {
        chatId: req.params.chatId,
        userId: currentUser.id
      });
    }
    
    res.json(result);
  } catch (error) {
    console.error('Mark read error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * DELETE /api/chats/:chatId/messages/:messageId
 * Delete a message
 */
router.delete('/:chatId/messages/:messageId', async (req, res) => {
  try {
    const currentUser = await FriendsService.getProfileByDerivId(req.user.derivId);
    if (!currentUser) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    const result = await ChatService.deleteMessage(req.params.messageId, currentUser.id);
    
    // Emit deletion
    const io = req.app.get('io');
    if (io) {
      io.to(`chat:${req.params.chatId}`).emit('chat:messageDeleted', {
        chatId: req.params.chatId,
        messageId: req.params.messageId
      });
    }
    
    res.json(result);
  } catch (error) {
    console.error('Delete message error:', error);
    res.status(400).json({ error: error.message });
  }
});

// =============================================
// REACTIONS
// =============================================

/**
 * POST /api/chats/:chatId/messages/:messageId/react
 * Add/toggle reaction
 */
router.post('/:chatId/messages/:messageId/react', async (req, res) => {
  try {
    const currentUser = await FriendsService.getProfileByDerivId(req.user.derivId);
    if (!currentUser) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    const { reaction } = req.body;
    const result = await ChatService.addReaction(req.params.messageId, currentUser.id, reaction);
    
    // Emit reaction
    const io = req.app.get('io');
    if (io) {
      io.to(`chat:${req.params.chatId}`).emit('chat:reaction', {
        chatId: req.params.chatId,
        messageId: req.params.messageId,
        userId: currentUser.id,
        reaction,
        reactions: result.reactions
      });
    }
    
    res.json(result);
  } catch (error) {
    console.error('Add reaction error:', error);
    res.status(500).json({ error: error.message });
  }
});

// =============================================
// TYPING INDICATORS
// =============================================

/**
 * POST /api/chats/:chatId/typing
 * Set typing status
 */
router.post('/:chatId/typing', async (req, res) => {
  try {
    const currentUser = await FriendsService.getProfileByDerivId(req.user.derivId);
    if (!currentUser) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    const { isTyping } = req.body;
    await ChatService.setTyping(req.params.chatId, currentUser.id, isTyping);
    
    // Emit typing status
    const io = req.app.get('io');
    if (io) {
      io.to(`chat:${req.params.chatId}`).emit('chat:typing', {
        chatId: req.params.chatId,
        userId: currentUser.id,
        username: currentUser.username,
        isTyping
      });
    }
    
    res.json({ success: true });
  } catch (error) {
    console.error('Typing status error:', error);
    res.status(500).json({ error: error.message });
  }
});

// =============================================
// PING
// =============================================

/**
 * POST /api/chats/:chatId/ping
 * Send a ping
 */
router.post('/:chatId/ping', async (req, res) => {
  try {
    const currentUser = await FriendsService.getProfileByDerivId(req.user.derivId);
    if (!currentUser) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    const message = await ChatService.sendPing(req.params.chatId, currentUser.id);
    
    // Emit ping
    const io = req.app.get('io');
    if (io) {
      const chat = await ChatService.getChatById(req.params.chatId);
      const otherUserId = chat.user1_id === currentUser.id ? chat.user2_id : chat.user1_id;
      
      io.to(`chat:${req.params.chatId}`).emit('chat:message', message);
      io.to(`user:${otherUserId}`).emit('chat:ping', {
        from: currentUser,
        chatId: req.params.chatId
      });
    }
    
    res.json(message);
  } catch (error) {
    console.error('Send ping error:', error);
    res.status(500).json({ error: error.message });
  }
});

// =============================================
// STREAKS
// =============================================

/**
 * PUT /api/chats/:chatId/streak/name
 * Name a streak
 */
router.put('/:chatId/streak/name', async (req, res) => {
  try {
    const currentUser = await FriendsService.getProfileByDerivId(req.user.derivId);
    if (!currentUser) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    const { name } = req.body;
    const result = await ChatService.nameStreak(req.params.chatId, currentUser.id, name);
    res.json(result);
  } catch (error) {
    console.error('Name streak error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/chats/unread/count
 * Get total unread count
 */
router.get('/unread/count', async (req, res) => {
  try {
    const currentUser = await FriendsService.getProfileByDerivId(req.user.derivId);
    if (!currentUser) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    const count = await ChatService.getTotalUnreadCount(currentUser.id);
    res.json({ count });
  } catch (error) {
    console.error('Get unread count error:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
