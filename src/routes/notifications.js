const express = require('express');
const router = express.Router();
const notificationService = require('../services/notificationService');
const { authMiddleware } = require('../middleware/auth');

// Apply auth middleware to all routes
router.use(authMiddleware);

/**
 * Get user notifications
 * GET /api/notifications
 */
router.get('/', async (req, res) => {
    try {
        const userId = req.userId;
        const { limit = 50, offset = 0, unreadOnly = false } = req.query;

        const result = await notificationService.getUserNotifications(userId, {
            limit: parseInt(limit),
            offset: parseInt(offset),
            unreadOnly: unreadOnly === 'true'
        });

        res.json(result);
    } catch (error) {
        console.error('[Notifications] Get error:', error);
        res.status(500).json({ success: false, error: 'Failed to fetch notifications' });
    }
});

/**
 * Get unread count
 * GET /api/notifications/unread/count
 */
router.get('/unread/count', async (req, res) => {
    try {
        const userId = req.userId;
        const result = await notificationService.getUnreadCount(userId);
        res.json(result);
    } catch (error) {
        console.error('[Notifications] Get unread count error:', error);
        res.status(500).json({ success: false, error: 'Failed to get unread count' });
    }
});

/**
 * Mark notification as read
 * PUT /api/notifications/:id/read
 */
router.put('/:id/read', async (req, res) => {
    try {
        const result = await notificationService.markAsRead(req.params.id);
        res.json(result);
    } catch (error) {
        console.error('[Notifications] Mark read error:', error);
        res.status(500).json({ success: false, error: 'Failed to mark as read' });
    }
});

/**
 * Mark all as read
 * PUT /api/notifications/read-all
 */
router.put('/read-all', async (req, res) => {
    try {
        const userId = req.userId;
        const result = await notificationService.markAllAsRead(userId);
        res.json(result);
    } catch (error) {
        console.error('[Notifications] Mark all read error:', error);
        res.status(500).json({ success: false, error: 'Failed to mark all as read' });
    }
});

/**
 * Delete notification
 * DELETE /api/notifications/:id
 */
router.delete('/:id', async (req, res) => {
    try {
        const result = await notificationService.deleteNotification(req.params.id);
        res.json(result);
    } catch (error) {
        console.error('[Notifications] Delete error:', error);
        res.status(500).json({ success: false, error: 'Failed to delete notification' });
    }
});

module.exports = router;
