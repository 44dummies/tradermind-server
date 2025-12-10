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
