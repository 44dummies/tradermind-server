const express = require('express');
const router = express.Router();
const isUser = require('../../middleware/isUser');
const sessionManager = require('../../services/sessionManager');
const notificationService = require('../../services/notificationService');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY
);

// ==================== USER DASHBOARD ====================

/**
 * Get user dashboard data
 */
router.get('/dashboard', isUser, async (req, res) => {
  try {
    const userId = req.user.userId;

    // Get user account
    const { data: account, error: accountError } = await supabase
      .from('trading_accounts')
      .select('*')
      .eq('user_id', userId)
      .eq('is_active', true)
      .single();

    if (accountError && accountError.code !== 'PGRST116') {
      throw accountError;
    }

    // Get active invitations (Active Sessions)
    const { data: invitations, error: invError } = await supabase
      .from('session_invitations')
      .select(`
        *,
        trading_sessions (*)
      `)
      .eq('user_id', userId)
      .in('status', ['accepted']);

    if (invError) throw invError;

    // Get PENDING invitations (Explicit Invites)
    const { data: pendingInvitations, error: availError } = await supabase
      .from('session_invitations')
      .select(`
        *,
        trading_sessions (*)
      `)
      .eq('user_id', userId)
      .eq('status', 'pending');

    if (availError) throw availError;

    // Get ALL Open Public Sessions (that I am not invited to yet)
    // 1. Get all open sessions
    const { data: openSessions, error: openError } = await supabase
      .from('trading_sessions')
      .select('*')
      .in('status', ['pending', 'active']) // Include Active sessions too
      .filter('session_type', 'neq', 'private'); // Assuming we only show public non-private sessions, or show all if private column doesn't exist

    if (openError && openError.code !== 'PGRST100') throw openError; // Ignore column error if type doesn't exist

    // 2. Filter out sessions I'm already involved in (active or pending)
    const mySessionIds = new Set([
      ...(invitations?.map(i => i.session_id) || []),
      ...(pendingInvitations?.map(i => i.session_id) || [])
    ]);

    const publicSessions = (openSessions || [])
      .filter(s => !mySessionIds.has(s.id))
      .map(s => ({
        // Mock invitation structure for frontend compatibility
        session_id: s.id,
        user_id: userId,
        status: 'pending', // Treat as pending invite
        created_at: new Date().toISOString(),
        trading_sessions: s
      }));

    const availableSessions = [...(pendingInvitations || []), ...publicSessions];

    // Get user settings
    const { data: settings, error: settingsError } = await supabase
      .from('user_trading_settings')
      .select('*')
      .eq('user_id', userId)
      .single();


    // Get user's recent trades
    const { data: trades, error: tradesError } = await supabase
      .from('trades')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(10);

    if (tradesError) throw tradesError;

    // Calculate mini stats
    const totalTrades = trades?.length || 0;
    const wins = trades?.filter(t => (t.profit_loss || 0) > 0).length || 0;
    const totalPL = trades?.reduce((sum, t) => sum + (t.profit_loss || 0), 0) || 0;

    // Determine current active session
    const currentSession = invitations?.length > 0 ? invitations[0] : null;

    res.json({
      success: true,
      account,
      currentSession: currentSession ? {
        sessionId: currentSession.session_id,
        name: currentSession.trading_sessions?.name || 'Unknown Session',
        status: currentSession.trading_sessions?.status
      } : null,
      availableSessions: availableSessions || [],
      settings: settings || { default_tp: 10, default_sl: 5 },
      invitations: invitations || [],
      recentTrades: trades || [],
      stats: {
        totalTrades,
        wins,
        totalPL
      }
    });
  } catch (error) {
    console.error('[User] Get dashboard error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// ==================== TP/SL MANAGEMENT ====================

/**
 * Update Default TP/SL
 */
router.put('/tpsl', isUser, async (req, res) => {
  try {
    const { tp, sl } = req.body;
    const userId = req.user.userId;

    // Upsert user settings
    const { data, error } = await supabase
      .from('user_trading_settings')
      .upsert({
        user_id: userId,
        default_tp: tp,
        default_sl: sl,
        updated_at: new Date().toISOString()
      }, { onConflict: 'user_id' })
      .select()
      .single();

    if (error) throw error;

    res.json({ success: true, settings: data });
  } catch (error) {
    console.error('[User] Update Default TP/SL error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * Update Session Specific TP/SL
 */
router.put('/tpsl/:sessionId', isUser, async (req, res) => {
  try {
    const { takeProfit, stopLoss } = req.body;
    const userId = req.user.userId;

    const result = await sessionManager.updateTPSL(
      userId,
      req.params.sessionId,
      { takeProfit, stopLoss }
    );

    res.json(result);
  } catch (error) {
    console.error('[User] Update TP/SL error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// ==================== SESSION MANAGEMENT ====================

/**
 * Accept session invitation
 */
router.post('/sessions/:sessionId/accept', isUser, async (req, res) => {
  try {
    const { takeProfit, stopLoss, tp, sl, derivToken } = req.body;
    const userId = req.user.userId;

    const result = await sessionManager.acceptSession(
      userId,
      req.params.sessionId,
      { takeProfit: takeProfit || tp, stopLoss: stopLoss || sl, derivToken }
    );

    res.json(result);
  } catch (error) {
    console.error('[User] Accept session error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * Leave session
 */
router.post('/sessions/:sessionId/leave', isUser, async (req, res) => {
  try {
    const userId = req.user.userId;

    const result = await sessionManager.leaveSession(
      userId,
      req.params.sessionId
    );

    res.json(result);
  } catch (error) {
    console.error('[User] Leave session error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * Get available sessions
 */
router.get('/sessions/available', isUser, async (req, res) => {
  try {
    const userId = req.user.userId;

    // Get pending invitations
    const { data: invitations, error } = await supabase
      .from('session_invitations')
      .select(`
        *,
        trading_sessions (*)
      `)
      .eq('user_id', userId)
      .eq('status', 'pending');

    if (error) throw error;

    res.json({
      success: true,
      sessions: invitations || []
    });
  } catch (error) {
    console.error('[User] Get available sessions error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * Get user's active session status
 */
router.get('/sessions/active', isUser, async (req, res) => {
  try {
    const userId = req.user.userId;

    const { data: invitation, error } = await supabase
      .from('session_invitations')
      .select(`
        *,
        trading_sessions (*)
      `)
      .eq('user_id', userId)
      .eq('status', 'accepted')
      .order('accepted_at', { ascending: false })
      .limit(1)
      .single();

    if (error && error.code !== 'PGRST116') {
      throw error;
    }

    res.json({
      success: true,
      activeSession: invitation || null
    });
  } catch (error) {
    console.error('[User] Get active session error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// ==================== NOTIFICATIONS ====================

/**
 * Get user notifications
 */
router.get('/notifications', isUser, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { limit = 50, unreadOnly = false } = req.query;

    const result = await notificationService.getUserNotifications(userId, {
      limit: parseInt(limit),
      unreadOnly: unreadOnly === 'true'
    });

    res.json(result);
  } catch (error) {
    console.error('[User] Get notifications error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * Mark notification as read
 */
router.put('/notifications/:id/read', isUser, async (req, res) => {
  try {
    const result = await notificationService.markAsRead(req.params.id);

    res.json(result);
  } catch (error) {
    console.error('[User] Mark as read error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * Mark all as read
 */
router.put('/notifications/read-all', isUser, async (req, res) => {
  try {
    const userId = req.user.userId;

    const result = await notificationService.markAllAsRead(userId);

    res.json(result);
  } catch (error) {
    console.error('[User] Mark all as read error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * Get unread count
 */
router.get('/notifications/unread-count', isUser, async (req, res) => {
  try {
    const userId = req.user.userId;

    const result = await notificationService.getUnreadCount(userId);

    res.json(result);
  } catch (error) {
    console.error('[User] Get unread count error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// ==================== PERSONAL STATS ====================

/**
 * Get user's personal stats
 */
router.get('/stats', isUser, async (req, res) => {
  try {
    const userId = req.user.userId;

    // Get all user trades
    const { data: trades, error } = await supabase
      .from('trades')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (error) throw error;

    // Calculate stats
    const totalTrades = trades?.length || 0;
    const wins = trades?.filter(t => (t.profit_loss || 0) > 0).length || 0;
    const losses = trades?.filter(t => (t.profit_loss || 0) < 0).length || 0;
    const winRate = totalTrades > 0 ? (wins / totalTrades) * 100 : 0;
    const totalPL = trades?.reduce((sum, t) => sum + (t.profit_loss || 0), 0) || 0;
    const avgProfit = wins > 0
      ? trades.filter(t => (t.profit_loss || 0) > 0).reduce((sum, t) => sum + t.profit_loss, 0) / wins
      : 0;
    const avgLoss = losses > 0
      ? trades.filter(t => (t.profit_loss || 0) < 0).reduce((sum, t) => sum + t.profit_loss, 0) / losses
      : 0;

    res.json({
      success: true,
      stats: {
        totalTrades,
        wins,
        losses,
        winRate,
        totalPL,
        avgProfit,
        avgLoss
      },
      recentTrades: trades?.slice(0, 20) || []
    });
  } catch (error) {
    console.error('[User] Get stats error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

module.exports = router;
