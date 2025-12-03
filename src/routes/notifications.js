/**
 * Notifications API Routes
 */

const express = require('express');
const router = express.Router();
const NotificationsService = require('../services/notifications');
const FriendsService = require('../services/friends');
const { authMiddleware } = require('../middleware/auth');

router.use(authMiddleware);

/**
 * GET /api/notifications
 * Get notifications for current user
 */
router.get('/', async (req, res) => {
  try {
    const currentUser = await FriendsService.getProfileByDerivId(req.user.derivId);
    if (!currentUser) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    const { limit, unreadOnly, offset } = req.query;
    const notifications = await NotificationsService.getNotifications(currentUser.id, {
      limit: parseInt(limit) || 50,
      unreadOnly: unreadOnly === 'true',
      offset: parseInt(offset) || 0
    });
    
    res.json(notifications);
  } catch (error) {
    console.error('Get notifications error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/notifications/unread/count
 * Get unread notification count
 */
router.get('/unread/count', async (req, res) => {
  try {
    const currentUser = await FriendsService.getProfileByDerivId(req.user.derivId);
    if (!currentUser) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    const count = await NotificationsService.getUnreadCount(currentUser.id);
    res.json({ count });
  } catch (error) {
    console.error('Get unread count error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * PUT /api/notifications/:id/read
 * Mark notification as read
 */
router.put('/:id/read', async (req, res) => {
  try {
    const currentUser = await FriendsService.getProfileByDerivId(req.user.derivId);
    if (!currentUser) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    const result = await NotificationsService.markAsRead(req.params.id, currentUser.id);
    res.json(result);
  } catch (error) {
    console.error('Mark read error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * PUT /api/notifications/read-all
 * Mark all notifications as read
 */
router.put('/read-all', async (req, res) => {
  try {
    const currentUser = await FriendsService.getProfileByDerivId(req.user.derivId);
    if (!currentUser) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    const result = await NotificationsService.markAllAsRead(currentUser.id);
    res.json(result);
  } catch (error) {
    console.error('Mark all read error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * DELETE /api/notifications/:id
 * Delete notification
 */
router.delete('/:id', async (req, res) => {
  try {
    const currentUser = await FriendsService.getProfileByDerivId(req.user.derivId);
    if (!currentUser) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    const result = await NotificationsService.delete(req.params.id, currentUser.id);
    res.json(result);
  } catch (error) {
    console.error('Delete notification error:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
