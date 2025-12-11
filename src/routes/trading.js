/**
 * Trading Routes - API endpoints for trading system
 */

const express = require('express');
const router = express.Router();
const { authMiddleware } = require('../middleware/auth');
const trading = require('../services/trading');

// ==================== Account Routes ====================

router.get('/accounts', authMiddleware, async (req, res) => {
  try {
    const accounts = await trading.getAccounts(req.userId);
    res.json({ success: true, data: accounts });
  } catch (error) {
    console.error('Error fetching accounts:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/accounts', authMiddleware, async (req, res) => {
  try {
    const { derivToken } = req.body;
    if (!derivToken) {
      return res.status(400).json({ success: false, error: 'Deriv token required' });
    }

    const accountInfo = await trading.verifyDerivToken(derivToken);
    const account = await trading.addAccount(req.userId, {
      accountId: accountInfo.accountId,
      derivToken,
      accountType: accountInfo.isVirtual ? 'demo' : 'real',
      currency: accountInfo.currency,
      balance: accountInfo.balance
    });

    await trading.logActivity('account_added', `Account ${accountInfo.accountId} added`, { adminId: req.userId });
    res.status(201).json({ success: true, data: { ...account, email: accountInfo.email, fullName: accountInfo.fullName } });
  } catch (error) {
    console.error('Error adding account:', error);
    res.status(400).json({ success: false, error: error.message });
  }
});

router.post('/accounts/verify', authMiddleware, async (req, res) => {
  try {
    const { derivToken } = req.body;
    if (!derivToken) {
      return res.status(400).json({ success: false, error: 'Deriv token required' });
    }

    const accountInfo = await trading.verifyDerivToken(derivToken);
    res.json({ success: true, data: accountInfo });
  } catch (error) {
    console.error('Error verifying token:', error);
    res.status(400).json({ success: false, error: error.message });
  }
});

router.put('/accounts/:id', authMiddleware, async (req, res) => {
  try {
    const account = await trading.updateAccount(req.params.id, req.body);
    res.json({ success: true, data: account });
  } catch (error) {
    console.error('Error updating account:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

router.delete('/accounts/:id', authMiddleware, async (req, res) => {
  try {
    await trading.deleteAccount(req.params.id);
    await trading.logActivity('account_deleted', 'Account deleted', { adminId: req.userId, accountId: req.params.id });
    res.json({ success: true, message: 'Account deleted' });
  } catch (error) {
    console.error('Error deleting account:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ==================== Session Routes ====================

router.get('/sessions', authMiddleware, async (req, res) => {
  try {
    const { status, type, limit } = req.query;
    const isAdmin = req.user && (req.user.role === 'admin' || req.user.is_admin);

    // If not admin, force public access mode
    const options = {
      status,
      type,
      limit: limit ? parseInt(limit) : undefined,
      publicAccess: !isAdmin
    };

    const sessions = await trading.getSessions(req.userId, options);
    res.json({ success: true, data: sessions });
  } catch (error) {
    console.error('Error fetching sessions:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Endpoint to get session tick history (for chart warmup)
router.get('/sessions/:id/ticks', authMiddleware, async (req, res) => {
  try {
    const session = await trading.getSession(req.params.id);
    if (!session) return res.status(404).json({ success: false, error: 'Session not found' });

    // Get tick history from collector for each market in the session
    const tickCollector = require('../services/tickCollector');
    const markets = session.markets || ['R_100'];
    const ticks = {};

    markets.forEach(market => {
      ticks[market] = tickCollector.getTickHistory(market);
    });

    res.json({ success: true, data: ticks });
  } catch (error) {
    console.error('Error fetching session ticks:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Endpoint to get session statistics (P/L, Win Rate, etc.)
router.get('/sessions/:id/stats', authMiddleware, async (req, res) => {
  try {
    const sessionId = req.params.id;

    // Get trades for this session from activity logs
    const { data: trades, error: tradesErr } = await supabase
      .from('trading_activity_logs')
      .select('*')
      .eq('session_id', sessionId)
      .in('action_type', ['trade_opened', 'trade_closed', 'trade_won', 'trade_lost']);

    if (tradesErr) throw tradesErr;

    // Calculate stats
    const closedTrades = trades?.filter(t =>
      t.action_type === 'trade_won' || t.action_type === 'trade_lost' || t.action_type === 'trade_closed'
    ) || [];

    const wins = trades?.filter(t => t.action_type === 'trade_won').length || 0;
    const losses = trades?.filter(t => t.action_type === 'trade_lost').length || 0;
    const totalClosed = wins + losses;

    // Sum up profits from metadata
    let totalProfit = 0;
    closedTrades.forEach(t => {
      if (t.action_details?.profit) {
        totalProfit += parseFloat(t.action_details?.profit) || 0;
      } else if (t.action_details?.pnl) {
        totalProfit += parseFloat(t.action_details?.pnl) || 0;
      }
    });

    const winRate = totalClosed > 0 ? (wins / totalClosed) * 100 : 0;
    const openTrades = trades?.filter(t => t.action_type === 'trade_opened').length || 0;

    res.json({
      success: true,
      data: {
        totalTrades: totalClosed,
        openTrades,
        wins,
        losses,
        winRate: winRate.toFixed(1),
        totalProfit: totalProfit.toFixed(2),
        avgProfit: totalClosed > 0 ? (totalProfit / totalClosed).toFixed(2) : '0.00'
      }
    });
  } catch (error) {
    console.error('Error fetching session stats:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Update user's TP/SL for a session
router.put('/sessions/:id/tpsl', authMiddleware, async (req, res) => {
  try {
    const sessionId = req.params.id;
    const userId = req.userId;
    const { takeProfit, stopLoss } = req.body;

    if (takeProfit === undefined || stopLoss === undefined) {
      return res.status(400).json({ success: false, error: 'takeProfit and stopLoss are required' });
    }

    // Import supabase
    const { supabase } = require('../db/supabase');

    // Update the user's TP/SL in session_participants
    const { data, error } = await supabase
      .from('session_participants')
      .update({
        tp: parseFloat(takeProfit),
        sl: parseFloat(stopLoss),
        updated_at: new Date().toISOString()
      })
      .eq('session_id', sessionId)
      .eq('user_id', userId)
      .select()
      .single();

    if (error) {
      console.error('Error updating TP/SL:', error);
      return res.status(500).json({ success: false, error: 'Failed to update TP/SL' });
    }

    if (!data) {
      return res.status(404).json({ success: false, error: 'Participation not found' });
    }

    await trading.logActivity('tpsl_updated', `User updated TP: $${takeProfit}, SL: $${stopLoss}`, {
      user_id: userId,
      session_id: sessionId
    });

    res.json({ success: true, data: { takeProfit: data.tp, stopLoss: data.sl } });
  } catch (error) {
    console.error('Error updating TP/SL:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get trading constants (strategies, markets, staking modes)
router.get('/constants', authMiddleware, async (req, res) => {
  try {
    res.json({
      success: true,
      data: {
        strategies: [
          { id: 'DFPM', name: 'Digit Frequency Pattern Matching', description: 'Analyzes digit patterns for predictions' },
          { id: 'VCS', name: 'Volatility Correlation Strategy', description: 'Uses volatility analysis for entries' },
          { id: 'MARKOV', name: 'Markov Chain Predictor', description: 'Probability-based digit prediction' },
          { id: 'RSI_TREND', name: 'RSI + Trend Analysis', description: 'Combines RSI with trend regression' }
        ],
        markets: [
          { id: 'R_100', name: 'Volatility 100 Index', tickInterval: 1 },
          { id: 'R_75', name: 'Volatility 75 Index', tickInterval: 1 },
          { id: 'R_50', name: 'Volatility 50 Index', tickInterval: 1 },
          { id: 'R_25', name: 'Volatility 25 Index', tickInterval: 1 },
          { id: 'R_10', name: 'Volatility 10 Index', tickInterval: 1 }
        ],
        stakingModes: [
          { id: 'fixed', name: 'Fixed Stake', description: 'Same stake every trade' },
          { id: 'martingale', name: 'Martingale', description: 'Double on loss, reset on win' },
          { id: 'compounding', name: 'Compounding', description: 'Percentage of current balance' }
        ],
        contractTypes: [
          { id: 'DIGITOVER', name: 'Digit Over' },
          { id: 'DIGITUNDER', name: 'Digit Under' },
          { id: 'DIGITDIFF', name: 'Digit Differs' },
          { id: 'DIGITMATCH', name: 'Digit Matches' },
          { id: 'DIGITEVEN', name: 'Digit Even' },
          { id: 'DIGITODD', name: 'Digit Odd' }
        ],
        riskLimits: {
          maxDailyLoss: 100,
          maxExposure: 50,
          maxConsecutiveLosses: 5,
          defaultStake: 0.35
        }
      }
    });
  } catch (error) {
    console.error('Error fetching constants:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/sessions/:id', authMiddleware, async (req, res) => {
  try {
    const session = await trading.getSession(req.params.id);
    if (!session) return res.status(404).json({ success: false, error: 'Session not found' });
    res.json({ success: true, data: session });
  } catch (error) {
    console.error('Error fetching session:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/sessions', authMiddleware, async (req, res) => {
  try {
    const session = await trading.createSession(req.userId, req.body);
    await trading.logActivity('session_created', `Session "${session.name}" created`, { adminId: req.userId, sessionId: session.id });
    res.status(201).json({ success: true, data: session });
  } catch (error) {
    console.error('Error creating session:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

router.put('/sessions/:id', authMiddleware, async (req, res) => {
  try {
    const session = await trading.updateSession(req.params.id, req.body);
    res.json({ success: true, data: session });
  } catch (error) {
    console.error('Error updating session:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

router.delete('/sessions/:id', authMiddleware, async (req, res) => {
  try {
    await trading.deleteSession(req.params.id);
    await trading.logActivity('session_deleted', 'Session deleted', { adminId: req.userId, sessionId: req.params.id });
    res.json({ success: true, message: 'Session deleted' });
  } catch (error) {
    console.error('Error deleting session:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/sessions/:id/start', authMiddleware, async (req, res) => {
  try {
    const session = await trading.updateSession(req.params.id, {
      status: trading.SESSION_STATUS.RUNNING,
      started_at: new Date().toISOString()
    });
    await trading.logActivity('session_started', `Session "${session.name}" started`, { sessionId: req.params.id });
    res.json({ success: true, data: session });
  } catch (error) {
    console.error('Error starting session:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/sessions/:id/stop', authMiddleware, async (req, res) => {
  try {
    const session = await trading.updateSession(req.params.id, {
      status: trading.SESSION_STATUS.COMPLETED,
      ended_at: new Date().toISOString()
    });
    await trading.logActivity('session_stopped', `Session "${session.name}" stopped`, { sessionId: req.params.id });
    res.json({ success: true, data: session });
  } catch (error) {
    console.error('Error stopping session:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/sessions/:id/pause', authMiddleware, async (req, res) => {
  try {
    const session = await trading.updateSession(req.params.id, { status: trading.SESSION_STATUS.PAUSED });
    await trading.logActivity('session_paused', `Session "${session.name}" paused`, { sessionId: req.params.id });
    res.json({ success: true, data: session });
  } catch (error) {
    console.error('Error pausing session:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/sessions/:id/resume', authMiddleware, async (req, res) => {
  try {
    const session = await trading.updateSession(req.params.id, { status: trading.SESSION_STATUS.RUNNING });
    await trading.logActivity('session_resumed', `Session "${session.name}" resumed`, { sessionId: req.params.id });
    res.json({ success: true, data: session });
  } catch (error) {
    console.error('Error resuming session:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/sessions/:id/join', authMiddleware, async (req, res) => {
  try {
    const { accountId } = req.body;
    if (!accountId) return res.status(400).json({ success: false, error: 'Account ID required' });

    // Optional: Check if session allows public joining or invite only
    // For now, allow joining any visible session
    const invitation = await trading.joinSession(req.params.id, accountId);
    await trading.logActivity('session_joined', 'User joined session', { sessionId: req.params.id, accountId });
    res.json({ success: true, data: invitation });
  } catch (error) {
    console.error('Error joining session:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ==================== Invitation Routes ====================

router.post('/sessions/:id/invite', authMiddleware, async (req, res) => {
  try {
    const { accountIds } = req.body;
    if (!accountIds || !Array.isArray(accountIds) || accountIds.length === 0) {
      return res.status(400).json({ success: false, error: 'Account IDs required' });
    }

    const invitations = await Promise.all(
      accountIds.map(accountId => trading.createInvitation(req.params.id, accountId, req.userId))
    );

    await trading.logActivity('invitations_sent', `${invitations.length} invitations sent`, { sessionId: req.params.id });
    res.status(201).json({ success: true, data: invitations });
  } catch (error) {
    console.error('Error creating invitations:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/invitations', authMiddleware, async (req, res) => {
  try {
    const { accountId } = req.query;
    if (!accountId) return res.status(400).json({ success: false, error: 'Account ID required' });

    const invitations = await trading.getInvitations(accountId);
    res.json({ success: true, data: invitations });
  } catch (error) {
    console.error('Error fetching invitations:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/invitations/:id/accept', authMiddleware, async (req, res) => {
  try {
    const { accountId } = req.body;
    if (!accountId) return res.status(400).json({ success: false, error: 'Account ID required' });

    const invitation = await trading.acceptInvitation(req.params.id, accountId);
    await trading.logActivity('invitation_accepted', 'Invitation accepted', { invitationId: req.params.id, accountId });
    res.json({ success: true, data: invitation });
  } catch (error) {
    console.error('Error accepting invitation:', error);
    res.status(400).json({ success: false, error: error.message });
  }
});

router.post('/invitations/:id/decline', authMiddleware, async (req, res) => {
  try {
    const { accountId } = req.body;
    if (!accountId) return res.status(400).json({ success: false, error: 'Account ID required' });

    const invitation = await trading.declineInvitation(req.params.id, accountId);
    res.json({ success: true, data: invitation });
  } catch (error) {
    console.error('Error declining invitation:', error);
    res.status(400).json({ success: false, error: error.message });
  }
});

// ==================== Trade Routes ====================

router.get('/sessions/:id/trades', authMiddleware, async (req, res) => {
  try {
    const { accountId, limit } = req.query;
    const trades = await trading.getSessionTrades(req.params.id, {
      accountId, limit: limit ? parseInt(limit) : undefined
    });
    res.json({ success: true, data: trades });
  } catch (error) {
    console.error('Error fetching trades:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/sessions/:id/stats', authMiddleware, async (req, res) => {
  try {
    const { accountId } = req.query;
    const stats = await trading.getTradeStats(req.params.id, accountId);
    res.json({ success: true, data: stats });
  } catch (error) {
    console.error('Error fetching stats:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ==================== Bot Control Routes ====================

router.get('/bot/status', authMiddleware, async (req, res) => {
  try {
    const status = trading.getBotStatus();
    res.json({ success: true, data: status });
  } catch (error) {
    console.error('Error getting bot status:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/bot/start', authMiddleware, async (req, res) => {
  try {
    const result = await trading.startBot();
    res.json({ success: result.success, message: result.message });
  } catch (error) {
    console.error('Error starting bot:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/bot/stop', authMiddleware, async (req, res) => {
  try {
    const result = await trading.stopBot();
    res.json({ success: result.success, message: result.message });
  } catch (error) {
    console.error('Error stopping bot:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ==================== Activity Log Routes ====================

router.get('/logs', authMiddleware, async (req, res) => {
  try {
    const { type, limit } = req.query;
    const logs = await trading.getActivityLogs({
      type, limit: limit ? parseInt(limit) : undefined
    });
    res.json({ success: true, data: logs });
  } catch (error) {
    console.error('Error fetching logs:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ==================== Constants Route ====================

router.get('/constants', (req, res) => {
  res.json({
    success: true,
    data: {
      sessionTypes: trading.SESSION_TYPE,
      sessionStatuses: trading.SESSION_STATUS,
      accountStatuses: trading.ACCOUNT_STATUS,
      contractTypes: ['DIGITEVEN', 'DIGITODD', 'DIGITOVER', 'DIGITUNDER', 'DIGITMATCH', 'DIGITDIFF', 'CALL', 'PUT'],
      strategies: ['DFPM', 'VCS', 'DER', 'TPC', 'DTP', 'DPB', 'MTD', 'RDS'],
      volatilityIndices: ['R_10', 'R_25', 'R_50', 'R_75', 'R_100', '1HZ10V', '1HZ25V', '1HZ50V', '1HZ75V', '1HZ100V'],
      stakingModes: ['fixed', 'martingale', 'compounding']
    }
  });
});

module.exports = router;
