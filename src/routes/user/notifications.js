/**
 * User Notifications Routes
 * Get and manage user notifications
 */

const express = require('express');
const router = express.Router();
const { supabase } = require('../../db/supabase');

/**
 * GET /user/notifications
 * Get user's notifications (including broadcasts)
 */
router.get('/', async (req, res) => {
    try {
        const userId = req.user.id;
        const { limit = 50, offset = 0, unreadOnly = false } = req.query;

        let query = supabase
            .from('system_notifications')
            .select('*')
            .or(`user_id.eq.${userId},user_id.is.null`)
            .order('created_at', { ascending: false })
            .range(parseInt(offset), parseInt(offset) + parseInt(limit) - 1);

        if (unreadOnly === 'true') {
            query = query.eq('read', false);
        }

        const { data, error } = await query;

        if (error) throw error;

        res.json({ notifications: data || [] });
    } catch (error) {
        console.error('Get notifications error:', error);
        res.status(500).json({ error: 'Failed to fetch notifications' });
    }
});

/**
 * GET /user/notifications/unread-count
 * Get count of unread notifications
 */
router.get('/unread-count', async (req, res) => {
    try {
        const userId = req.user.id;

        const { count, error } = await supabase
            .from('system_notifications')
            .select('*', { count: 'exact', head: true })
            .or(`user_id.eq.${userId},user_id.is.null`)
            .eq('read', false);

        if (error) throw error;

        res.json({ count: count || 0 });
    } catch (error) {
        console.error('Get unread count error:', error);
        res.status(500).json({ error: 'Failed to fetch unread count' });
    }
});

/**
 * PATCH /user/notifications/:id/read
 * Mark notification as read
 */
router.patch('/:id/read', async (req, res) => {
    try {
        const { id } = req.params;
        const userId = req.user.id;

        // Verify ownership or it's a broadcast
        const { data: notification } = await supabase
            .from('system_notifications')
            .select('user_id')
            .eq('id', id)
            .single();

        if (!notification) {
            return res.status(404).json({ error: 'Notification not found' });
        }

        // Only mark as read if user owns it or it's a broadcast
        if (notification.user_id !== null && notification.user_id !== userId) {
            return res.status(403).json({ error: 'Not authorized' });
        }

        // For broadcasts, we need a different approach - track read status per user
        // For now, just update the notification
        const { error } = await supabase
            .from('system_notifications')
            .update({ read: true })
            .eq('id', id);

        if (error) throw error;

        res.json({ success: true });
    } catch (error) {
        console.error('Mark read error:', error);
        res.status(500).json({ error: 'Failed to mark as read' });
    }
});

/**
 * POST /user/notifications/mark-all-read
 * Mark all notifications as read
 */
router.post('/mark-all-read', async (req, res) => {
    try {
        const userId = req.user.id;

        // Mark user-specific notifications as read
        const { error } = await supabase
            .from('system_notifications')
            .update({ read: true })
            .eq('user_id', userId)
            .eq('read', false);

        if (error) throw error;

        res.json({ success: true });
    } catch (error) {
        console.error('Mark all read error:', error);
        res.status(500).json({ error: 'Failed to mark all as read' });
    }
});

module.exports = router;
