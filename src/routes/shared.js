

const express = require('express');
const router = express.Router();
const SharedService = require('../services/shared');
const ChatService = require('../services/chat');
const { getProfileByDerivId, upsertUserProfile } = require('../services/profile');
const { authMiddleware } = require('../middleware/auth');

router.use(authMiddleware);

router.get('/:chatId/notes', async (req, res) => {
  try {
    const currentUser = await getProfileByDerivId(req.user.derivId);
    if (!currentUser) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    
    const chat = await ChatService.getChatById(req.params.chatId);
    if (!chat || (chat.user1_id !== currentUser.id && chat.user2_id !== currentUser.id)) {
      return res.status(403).json({ error: 'Not authorized' });
    }
    
    const notes = await SharedService.getNotes(req.params.chatId);
    res.json(notes);
  } catch (error) {
    console.error('Get shared notes error:', error);
    res.status(500).json({ error: error.message });
  }
});

router.put('/:chatId/notes', async (req, res) => {
  try {
    const currentUser = await getProfileByDerivId(req.user.derivId);
    if (!currentUser) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    
    const chat = await ChatService.getChatById(req.params.chatId);
    if (!chat || (chat.user1_id !== currentUser.id && chat.user2_id !== currentUser.id)) {
      return res.status(403).json({ error: 'Not authorized' });
    }
    
    const { content, title } = req.body;
    const notes = await SharedService.updateNotes(req.params.chatId, currentUser.id, content, title);
    
    
    const io = req.app.get('io');
    if (io) {
      io.to(`chat:${req.params.chatId}`).emit('shared:notesUpdate', {
        chatId: req.params.chatId,
        notes,
        editedBy: currentUser.id
      });
    }
    
    res.json(notes);
  } catch (error) {
    console.error('Update shared notes error:', error);
    res.status(500).json({ error: error.message });
  }
});

router.get('/:chatId/watchlist', async (req, res) => {
  try {
    const currentUser = await getProfileByDerivId(req.user.derivId);
    if (!currentUser) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    
    const chat = await ChatService.getChatById(req.params.chatId);
    if (!chat || (chat.user1_id !== currentUser.id && chat.user2_id !== currentUser.id)) {
      return res.status(403).json({ error: 'Not authorized' });
    }
    
    const watchlist = await SharedService.getWatchlist(req.params.chatId);
    res.json(watchlist);
  } catch (error) {
    console.error('Get shared watchlist error:', error);
    res.status(500).json({ error: error.message });
  }
});

router.post('/:chatId/watchlist/symbol', async (req, res) => {
  try {
    const currentUser = await getProfileByDerivId(req.user.derivId);
    if (!currentUser) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    
    const chat = await ChatService.getChatById(req.params.chatId);
    if (!chat || (chat.user1_id !== currentUser.id && chat.user2_id !== currentUser.id)) {
      return res.status(403).json({ error: 'Not authorized' });
    }
    
    const watchlist = await SharedService.addSymbol(req.params.chatId, currentUser.id, req.body);
    
    
    const io = req.app.get('io');
    if (io) {
      io.to(`chat:${req.params.chatId}`).emit('shared:watchlistUpdate', {
        chatId: req.params.chatId,
        watchlist
      });
    }
    
    res.json(watchlist);
  } catch (error) {
    console.error('Add symbol error:', error);
    res.status(400).json({ error: error.message });
  }
});

router.delete('/:chatId/watchlist/symbol/:symbol', async (req, res) => {
  try {
    const currentUser = await getProfileByDerivId(req.user.derivId);
    if (!currentUser) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    
    const chat = await ChatService.getChatById(req.params.chatId);
    if (!chat || (chat.user1_id !== currentUser.id && chat.user2_id !== currentUser.id)) {
      return res.status(403).json({ error: 'Not authorized' });
    }
    
    const watchlist = await SharedService.removeSymbol(req.params.chatId, req.params.symbol);
    
    
    const io = req.app.get('io');
    if (io) {
      io.to(`chat:${req.params.chatId}`).emit('shared:watchlistUpdate', {
        chatId: req.params.chatId,
        watchlist
      });
    }
    
    res.json(watchlist);
  } catch (error) {
    console.error('Remove symbol error:', error);
    res.status(500).json({ error: error.message });
  }
});

router.put('/:chatId/watchlist/symbol/:symbol/notes', async (req, res) => {
  try {
    const currentUser = await getProfileByDerivId(req.user.derivId);
    if (!currentUser) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    const { notes } = req.body;
    const watchlist = await SharedService.updateSymbolNotes(req.params.chatId, req.params.symbol, notes);
    
    
    const io = req.app.get('io');
    if (io) {
      io.to(`chat:${req.params.chatId}`).emit('shared:watchlistUpdate', {
        chatId: req.params.chatId,
        watchlist
      });
    }
    
    res.json(watchlist);
  } catch (error) {
    console.error('Update symbol notes error:', error);
    res.status(500).json({ error: error.message });
  }
});

router.post('/:chatId/watchlist/strategy', async (req, res) => {
  try {
    const currentUser = await getProfileByDerivId(req.user.derivId);
    if (!currentUser) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    const watchlist = await SharedService.addStrategy(req.params.chatId, currentUser.id, req.body);
    
    
    const io = req.app.get('io');
    if (io) {
      io.to(`chat:${req.params.chatId}`).emit('shared:watchlistUpdate', {
        chatId: req.params.chatId,
        watchlist
      });
    }
    
    res.json(watchlist);
  } catch (error) {
    console.error('Add strategy error:', error);
    res.status(500).json({ error: error.message });
  }
});

router.put('/:chatId/watchlist/timeframes', async (req, res) => {
  try {
    const { timeframes } = req.body;
    const watchlist = await SharedService.updateTimeframes(req.params.chatId, timeframes);
    
    
    const io = req.app.get('io');
    if (io) {
      io.to(`chat:${req.params.chatId}`).emit('shared:watchlistUpdate', {
        chatId: req.params.chatId,
        watchlist
      });
    }
    
    res.json(watchlist);
  } catch (error) {
    console.error('Update timeframes error:', error);
    res.status(500).json({ error: error.message });
  }
});

router.put('/:chatId/watchlist/name', async (req, res) => {
  try {
    const { name } = req.body;
    const watchlist = await SharedService.renameWatchlist(req.params.chatId, name);
    res.json(watchlist);
  } catch (error) {
    console.error('Rename watchlist error:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
