/**
 * Shared Resources API Routes
 * Handles shared notes and watchlists between friends
 */

const express = require('express');
const router = express.Router();
const SharedService = require('../services/shared');
const ChatService = require('../services/chat');
const FriendsService = require('../services/friends');
const { authenticateToken } = require('../middleware/auth');

router.use(authenticateToken);

// =============================================
// SHARED NOTES
// =============================================

/**
 * GET /api/shared/:chatId/notes
 * Get shared notes for a chat
 */
router.get('/:chatId/notes', async (req, res) => {
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
    
    const notes = await SharedService.getNotes(req.params.chatId);
    res.json(notes);
  } catch (error) {
    console.error('Get shared notes error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * PUT /api/shared/:chatId/notes
 * Update shared notes
 */
router.put('/:chatId/notes', async (req, res) => {
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
    
    const { content, title } = req.body;
    const notes = await SharedService.updateNotes(req.params.chatId, currentUser.id, content, title);
    
    // Emit update
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

// =============================================
// SHARED WATCHLIST
// =============================================

/**
 * GET /api/shared/:chatId/watchlist
 * Get shared watchlist
 */
router.get('/:chatId/watchlist', async (req, res) => {
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
    
    const watchlist = await SharedService.getWatchlist(req.params.chatId);
    res.json(watchlist);
  } catch (error) {
    console.error('Get shared watchlist error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/shared/:chatId/watchlist/symbol
 * Add symbol to watchlist
 */
router.post('/:chatId/watchlist/symbol', async (req, res) => {
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
    
    const watchlist = await SharedService.addSymbol(req.params.chatId, currentUser.id, req.body);
    
    // Emit update
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

/**
 * DELETE /api/shared/:chatId/watchlist/symbol/:symbol
 * Remove symbol from watchlist
 */
router.delete('/:chatId/watchlist/symbol/:symbol', async (req, res) => {
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
    
    const watchlist = await SharedService.removeSymbol(req.params.chatId, req.params.symbol);
    
    // Emit update
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

/**
 * PUT /api/shared/:chatId/watchlist/symbol/:symbol/notes
 * Update symbol notes
 */
router.put('/:chatId/watchlist/symbol/:symbol/notes', async (req, res) => {
  try {
    const currentUser = await FriendsService.getProfileByDerivId(req.user.derivId);
    if (!currentUser) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    const { notes } = req.body;
    const watchlist = await SharedService.updateSymbolNotes(req.params.chatId, req.params.symbol, notes);
    
    // Emit update
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

/**
 * POST /api/shared/:chatId/watchlist/strategy
 * Add strategy
 */
router.post('/:chatId/watchlist/strategy', async (req, res) => {
  try {
    const currentUser = await FriendsService.getProfileByDerivId(req.user.derivId);
    if (!currentUser) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    const watchlist = await SharedService.addStrategy(req.params.chatId, currentUser.id, req.body);
    
    // Emit update
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

/**
 * PUT /api/shared/:chatId/watchlist/timeframes
 * Update timeframes
 */
router.put('/:chatId/watchlist/timeframes', async (req, res) => {
  try {
    const { timeframes } = req.body;
    const watchlist = await SharedService.updateTimeframes(req.params.chatId, timeframes);
    
    // Emit update
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

/**
 * PUT /api/shared/:chatId/watchlist/name
 * Rename watchlist
 */
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
