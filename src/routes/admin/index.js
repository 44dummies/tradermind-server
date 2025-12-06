const express = require('express');
const router = express.Router();
const isAdmin = require('../../middleware/isAdmin');
const botEngine = require('../../services/botEngine');
const sessionManager = require('../../services/sessionManager');
const notificationService = require('../../services/notificationService');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// ==================== BOT CONTROL ====================

/**
 * Start bot
 */
router.post('/bot/start', isAdmin, async (req, res) => {
  try {
    const { markets } = req.body;

    const result = await botEngine.start(req.user.userId, { markets });

    res.json(result);
  } catch (error) {
    console.error('[Admin] Start bot error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * Stop bot
 */
router.post('/bot/stop', isAdmin, async (req, res) => {
  try {
    const result = await botEngine.stop('admin_stop');

    res.json(result);
  } catch (error) {
    console.error('[Admin] Stop bot error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * Emergency stop
 */
router.post('/bot/emergency-stop', isAdmin, async (req, res) => {
  try {
    const result = await botEngine.emergencyStop();

    res.json(result);
  } catch (error) {
    console.error('[Admin] Emergency stop error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * Get bot status
 */
router.get('/bot/status', isAdmin, async (req, res) => {
  try {
    const status = botEngine.getStatus();

    res.json({
      success: true,
      status
    });
  } catch (error) {
    console.error('[Admin] Get bot status error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * Get bot stats
 */
router.get('/bot/stats', isAdmin, async (req, res) => {
  try {
    const stats = botEngine.getStats();

    res.json({
      success: true,
      stats
    });
  } catch (error) {
    console.error('[Admin] Get bot stats error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// ==================== SESSION MANAGEMENT ====================

/**
 * Create session
 */
router.post('/sessions', isAdmin, async (req, res) => {
  try {
    const result = await sessionManager.createSession(
      req.user.userId,
      req.body
    );

    res.json(result);
  } catch (error) {
    console.error('[Admin] Create session error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * Get all sessions
 */
router.get('/sessions', isAdmin, async (req, res) => {
  try {
    const { data: sessions, error } = await supabase
      .from('trading_sessions')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) throw error;

    res.json({
      success: true,
      sessions
    });
  } catch (error) {
    console.error('[Admin] Get sessions error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * Get session details
 */
router.get('/sessions/:id', isAdmin, async (req, res) => {
  try {
    const stats = await sessionManager.getSessionStats(req.params.id);

    res.json({
      success: true,
      ...stats
    });
  } catch (error) {
    console.error('[Admin] Get session details error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * Start session
 */
router.post('/sessions/:id/start', isAdmin, async (req, res) => {
  try {
    const result = await sessionManager.startSession(
      req.params.id,
      req.user.userId
    );

    res.json(result);
  } catch (error) {
    console.error('[Admin] Start session error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * Stop session
 */
router.post('/sessions/:id/stop', isAdmin, async (req, res) => {
  try {
    const result = await sessionManager.stopSession(
      req.params.id,
      req.user.userId
    );

    res.json(result);
  } catch (error) {
    console.error('[Admin] Stop session error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * Invite users to session
 */
router.post('/sessions/:id/invite', isAdmin, async (req, res) => {
  try {
    const { userIds } = req.body;

    const result = await sessionManager.inviteUsers(
      req.params.id,
      userIds,
      req.user.userId
    );

    res.json(result);
  } catch (error) {
    console.error('[Admin] Invite users error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * Create recovery session
 */
router.post('/sessions/recovery', isAdmin, async (req, res) => {
  try {
    const result = await sessionManager.createRecoverySession(
      req.user.userId,
      req.body
    );

    res.json(result);
  } catch (error) {
    console.error('[Admin] Create recovery session error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// ==================== ACCOUNTS MANAGEMENT ====================

/**
 * Get all trading accounts
 */
router.get('/accounts', isAdmin, async (req, res) => {
  try {
    const { data: accounts, error } = await supabase
      .from('trading_accounts')
      .select('*, user_profiles (display_name, email)')
      .order('created_at', { ascending: false });

    if (error) throw error;

    res.json({
      success: true,
      accounts
    });
  } catch (error) {
    console.error('[Admin] Get accounts error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// ==================== NOTIFICATIONS ====================

/**
 * Send broadcast
 */
router.post('/notifications/broadcast', isAdmin, async (req, res) => {
  try {
    const result = await notificationService.broadcast(
      req.body,
      req.user.userId
    );

    res.json(result);
  } catch (error) {
    console.error('[Admin] Broadcast error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * Send to session
 */
router.post('/notifications/session/:sessionId', isAdmin, async (req, res) => {
  try {
    const result = await notificationService.sendToSession(
      req.params.sessionId,
      req.body
    );

    res.json(result);
  } catch (error) {
    console.error('[Admin] Send to session error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * Send to recovery users
 */
router.post('/notifications/recovery', isAdmin, async (req, res) => {
  try {
    const result = await notificationService.sendToRecoveryUsers(req.body);

    res.json(result);
  } catch (error) {
    console.error('[Admin] Send to recovery users error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// ==================== ANALYTICS ====================

/**
 * Get full analytics
 */
router.get('/analytics', isAdmin, async (req, res) => {
  try {
    // Get all trades
    const { data: trades, error: tradesError } = await supabase
      .from('trades')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(1000);

    if (tradesError) throw tradesError;

    // Calculate stats
    const totalTrades = trades?.length || 0;
    const wins = trades?.filter(t => (t.profit_loss || 0) > 0).length || 0;
    const losses = trades?.filter(t => (t.profit_loss || 0) < 0).length || 0;
    const winRate = totalTrades > 0 ? (wins / totalTrades) * 100 : 0;
    const totalPL = trades?.reduce((sum, t) => sum + (t.profit_loss || 0), 0) || 0;

    // Group by session
    const bySession = {};
    trades?.forEach(trade => {
      if (!bySession[trade.session_id]) {
        bySession[trade.session_id] = {
          trades: 0,
          wins: 0,
          losses: 0,
          totalPL: 0
        };
      }
      bySession[trade.session_id].trades++;
      if ((trade.profit_loss || 0) > 0) bySession[trade.session_id].wins++;
      if ((trade.profit_loss || 0) < 0) bySession[trade.session_id].losses++;
      bySession[trade.session_id].totalPL += (trade.profit_loss || 0);
    });

    res.json({
      success: true,
      analytics: {
        overview: {
          totalTrades,
          wins,
          losses,
          winRate,
          totalPL
        },
        bySession
      }
    });
  } catch (error) {
    console.error('[Admin] Get analytics error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * Get all logs
 */
router.get('/logs', isAdmin, async (req, res) => {
  try {
    const { limit = 100 } = req.query;

    const { data: logs, error } = await supabase
      .from('trading_activity_logs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(parseInt(limit));

    if (error) throw error;

    res.json({
      success: true,
      logs
    });
  } catch (error) {
    console.error('[Admin] Get logs error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

module.exports = router;
