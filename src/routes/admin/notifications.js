/**
 * Admin Notifications Routes
 * Send broadcasts and targeted notifications
 */

const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const { supabase } = require('../../db/supabase');

// Get socket io instance for broadcasting (set by main app)
let io = null;
function setIO(ioInstance) {
  io = ioInstance;
}
module.exports.setIO = setIO;

// Notification types
const NOTIFICATION_TYPE = {
    BROADCAST: 'broadcast',
    SESSION_INVITE: 'session_invite',
    RECOVERY_INVITE: 'recovery_invite',
    TP_HIT: 'tp_hit',
    SL_HIT: 'sl_hit',
    LOW_BALANCE: 'low_balance',
    TRADE_EXECUTED: 'trade_executed',
    TRADE_FAILED: 'trade_failed',
    SYSTEM: 'system'
};

/**
 * GET /admin/notifications
 * Get all notifications (with pagination)
 */
router.get('/', async (req, res) => {
    try {
        const { limit = 100, offset = 0, type } = req.query;

        let query = supabase
            .from('system_notifications')
            .select('*')
            .order('created_at', { ascending: false })
            .range(parseInt(offset), parseInt(offset) + parseInt(limit) - 1);

        if (type) {
            query = query.eq('type', type);
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
 * POST /admin/notifications/broadcast
 * Send notification to all users
 */
router.post('/broadcast', async (req, res) => {
    try {
        const { title, message, metadata = {} } = req.body;

        if (!title || !message) {
            return res.status(400).json({ error: 'Title and message are required' });
        }

        // Create broadcast notification (user_id = null means for all)
        const notification = {
            id: uuidv4(),
            user_id: null, // Null for broadcasts
            type: NOTIFICATION_TYPE.BROADCAST,
            title,
            message,
            metadata: { ...metadata, sent_by: req.user.id },
            read: false,
            created_at: new Date().toISOString()
        };

        const { data, error } = await supabase
            .from('system_notifications')
            .insert(notification)
            .select()
            .single();

        if (error) throw error;

        // Broadcast via WebSocket to all connected users
        if (io) {
            io.emit('notification', {
                id: data.id,
                type: 'broadcast',
                title: data.title,
                message: data.message,
                timestamp: data.created_at
            });
            console.log('[Notifications] Broadcast sent via WebSocket');
        }

        res.status(201).json({
            success: true,
            notification: data,
            message: 'Broadcast sent successfully'
        });
    } catch (error) {
        console.error('Send broadcast error:', error);
        res.status(500).json({ error: 'Failed to send broadcast' });
    }
});

/**
 * POST /admin/notifications/session/:sessionId
 * Send notification to all users in a session
 */
router.post('/session/:sessionId', async (req, res) => {
    try {
        const { sessionId } = req.params;
        const { title, message, metadata = {} } = req.body;

        if (!title || !message) {
            return res.status(400).json({ error: 'Title and message are required' });
        }

        // Get all participants in the session
        const { data: participants, error: partError } = await supabase
            .from('session_participants')
            .select('user_id')
            .eq('session_id', sessionId);

        if (partError) throw partError;

        if (!participants || participants.length === 0) {
            return res.status(404).json({ error: 'No participants found in session' });
        }

        // Create notifications for each participant
        const notifications = participants.map(p => ({
            id: uuidv4(),
            user_id: p.user_id,
            type: NOTIFICATION_TYPE.SESSION_INVITE,
            title,
            message,
            metadata: { ...metadata, session_id: sessionId, sent_by: req.user.id },
            read: false,
            created_at: new Date().toISOString()
        }));

        const { data, error } = await supabase
            .from('system_notifications')
            .insert(notifications)
            .select();

        if (error) throw error;

        res.status(201).json({
            success: true,
            count: notifications.length,
            message: `Notification sent to ${notifications.length} participants`
        });
    } catch (error) {
        console.error('Send session notification error:', error);
        res.status(500).json({ error: 'Failed to send notification' });
    }
});

/**
 * POST /admin/notifications/recovery
 * Send notification to users eligible for recovery session
 */
router.post('/recovery', async (req, res) => {
    try {
        const { title, message, metadata = {} } = req.body;

        if (!title || !message) {
            return res.status(400).json({ error: 'Title and message are required' });
        }

        // Get all users who are flagged for recovery
        const { data: users, error: userError } = await supabase
            .from('user_trading_settings')
            .select('user_id')
            .eq('can_join_recovery', true);

        if (userError) throw userError;

        if (!users || users.length === 0) {
            return res.status(404).json({ error: 'No users eligible for recovery session' });
        }

        // Create notifications for each user
        const notifications = users.map(u => ({
            id: uuidv4(),
            user_id: u.user_id,
            type: NOTIFICATION_TYPE.RECOVERY_INVITE,
            title,
            message,
            metadata: { ...metadata, sent_by: req.user.id },
            read: false,
            created_at: new Date().toISOString()
        }));

        const { data, error } = await supabase
            .from('system_notifications')
            .insert(notifications)
            .select();

        if (error) throw error;

        res.status(201).json({
            success: true,
            count: notifications.length,
            message: `Recovery notification sent to ${notifications.length} users`
        });
    } catch (error) {
        console.error('Send recovery notification error:', error);
        res.status(500).json({ error: 'Failed to send recovery notification' });
    }
});

/**
 * POST /admin/notifications/user/:userId
 * Send notification to a specific user
 */
router.post('/user/:userId', async (req, res) => {
    try {
        const { userId } = req.params;
        const { title, message, type = NOTIFICATION_TYPE.SYSTEM, metadata = {} } = req.body;

        if (!title || !message) {
            return res.status(400).json({ error: 'Title and message are required' });
        }

        const notification = {
            id: uuidv4(),
            user_id: userId,
            type,
            title,
            message,
            metadata: { ...metadata, sent_by: req.user.id },
            read: false,
            created_at: new Date().toISOString()
        };

        const { data, error } = await supabase
            .from('system_notifications')
            .insert(notification)
            .select()
            .single();

        if (error) throw error;

        res.status(201).json({
            success: true,
            notification: data
        });
    } catch (error) {
        console.error('Send user notification error:', error);
        res.status(500).json({ error: 'Failed to send notification' });
    }
});

module.exports = router;
