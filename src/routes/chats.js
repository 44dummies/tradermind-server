

const express = require('express');
const router = express.Router();
const ChatService = require('../services/chat');
const { getProfileByDerivId, upsertUserProfile } = require('../services/profile');
const { authMiddleware } = require('../middleware/auth');

router.use(authMiddleware);

async function getOrCreateUser(derivId) {
  let user = await getProfileByDerivId(derivId);
  if (!user) {
    user = await upsertUserProfile(derivId, {
      username: `trader_${derivId.toLowerCase().slice(0, 8)}`,
      fullname: null,
      email: null,
      country: null
    });
  }
  return user;
}

router.get('/', async (req, res) => {
  try {
    const currentUser = await getOrCreateUser(req.user.derivId);
    if (!currentUser) {
      return res.status(500).json({ error: 'Failed to get/create user' });
    }
    
    const chats = await ChatService.getUserChats(currentUser.id);
    
    
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

router.get('/:chatId', async (req, res) => {
  try {
    const currentUser = await getOrCreateUser(req.user.derivId);
    if (!currentUser) {
      return res.status(500).json({ error: 'Failed to get/create user' });
    }
    
    const chat = await ChatService.getChatById(req.params.chatId);
    if (!chat) {
      return res.status(404).json({ error: 'Chat not found' });
    }
    
    
    if (chat.user1_id !== currentUser.id && chat.user2_id !== currentUser.id) {
      return res.status(403).json({ error: 'Not authorized' });
    }
    
    res.json(chat);
  } catch (error) {
    console.error('Get chat error:', error);
    res.status(500).json({ error: error.message });
  }
});

router.get('/with/:userId', async (req, res) => {
  try {
    const currentUser = await getOrCreateUser(req.user.derivId);
    if (!currentUser) {
      return res.status(500).json({ error: 'Failed to get/create user' });
    }
    
    
    const chat = await ChatService.getOrCreateDirectChat(currentUser.id, req.params.userId);
    
    res.json(chat);
  } catch (error) {
    console.error('Get/create chat error:', error);
    res.status(500).json({ error: error.message });
  }
});

router.put('/:chatId/archive', async (req, res) => {
  try {
    const currentUser = await getOrCreateUser(req.user.derivId);
    if (!currentUser) {
      return res.status(500).json({ error: 'Failed to get/create user' });
    }
    
    const { archived } = req.body;
    const result = await ChatService.toggleArchiveChat(req.params.chatId, currentUser.id, archived);
    res.json(result);
  } catch (error) {
    console.error('Archive chat error:', error);
    res.status(500).json({ error: error.message });
  }
});

router.get('/:chatId/messages', async (req, res) => {
  try {
    const currentUser = await getOrCreateUser(req.user.derivId);
    if (!currentUser) {
      return res.status(500).json({ error: 'Failed to get/create user' });
    }
    
    
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

router.post('/:chatId/messages', async (req, res) => {
  try {
    const currentUser = await getOrCreateUser(req.user.derivId);
    if (!currentUser) {
      return res.status(500).json({ error: 'Failed to get/create user' });
    }
    
    
    const chat = await ChatService.getChatById(req.params.chatId);
    if (!chat || (chat.user1_id !== currentUser.id && chat.user2_id !== currentUser.id)) {
      return res.status(403).json({ error: 'Not authorized' });
    }
    
    const message = await ChatService.sendMessage(req.params.chatId, currentUser.id, req.body);
    
    
    const io = req.app.get('io');
    if (io) {
      io.to(`chat:${req.params.chatId}`).emit('chat:message', message);
      
      
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

router.put('/:chatId/read', async (req, res) => {
  try {
    const currentUser = await getOrCreateUser(req.user.derivId);
    if (!currentUser) {
      return res.status(500).json({ error: 'Failed to get/create user' });
    }
    
    const result = await ChatService.markAsRead(req.params.chatId, currentUser.id);
    
    
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

router.delete('/:chatId/messages/:messageId', async (req, res) => {
  try {
    const currentUser = await getOrCreateUser(req.user.derivId);
    if (!currentUser) {
      return res.status(500).json({ error: 'Failed to get/create user' });
    }
    
    const result = await ChatService.deleteMessage(req.params.messageId, currentUser.id);
    
    
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

router.post('/:chatId/messages/:messageId/react', async (req, res) => {
  try {
    const currentUser = await getOrCreateUser(req.user.derivId);
    if (!currentUser) {
      return res.status(500).json({ error: 'Failed to get/create user' });
    }
    
    const { reaction } = req.body;
    const result = await ChatService.addReaction(req.params.messageId, currentUser.id, reaction);
    
    
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

router.post('/:chatId/typing', async (req, res) => {
  try {
    const currentUser = await getOrCreateUser(req.user.derivId);
    if (!currentUser) {
      return res.status(500).json({ error: 'Failed to get/create user' });
    }
    
    const { isTyping } = req.body;
    await ChatService.setTyping(req.params.chatId, currentUser.id, isTyping);
    
    
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

router.post('/:chatId/ping', async (req, res) => {
  try {
    const currentUser = await getOrCreateUser(req.user.derivId);
    if (!currentUser) {
      return res.status(500).json({ error: 'Failed to get/create user' });
    }
    
    const message = await ChatService.sendPing(req.params.chatId, currentUser.id);
    
    
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

router.put('/:chatId/streak/name', async (req, res) => {
  try {
    const currentUser = await getOrCreateUser(req.user.derivId);
    if (!currentUser) {
      return res.status(500).json({ error: 'Failed to get/create user' });
    }
    
    const { name } = req.body;
    const result = await ChatService.nameStreak(req.params.chatId, currentUser.id, name);
    res.json(result);
  } catch (error) {
    console.error('Name streak error:', error);
    res.status(500).json({ error: error.message });
  }
});

router.get('/unread/count', async (req, res) => {
  try {
    const currentUser = await getOrCreateUser(req.user.derivId);
    if (!currentUser) {
      return res.status(500).json({ error: 'Failed to get/create user' });
    }
    
    const count = await ChatService.getTotalUnreadCount(currentUser.id);
    res.json({ count });
  } catch (error) {
    console.error('Get unread count error:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
