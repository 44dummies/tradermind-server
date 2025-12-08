/**
 * Trading Service - Backend service for multi-account automated trading
 */

const { supabase } = require('../db/supabase');
const { v4: uuidv4 } = require('uuid');
const WebSocket = require('ws');

// ==================== Constants ====================

const SESSION_TYPE = { DAY: 'day', ONE_TIME: 'one_time', RECOVERY: 'recovery' };
const SESSION_STATUS = { 
  PENDING: 'pending', RUNNING: 'running', PAUSED: 'paused', 
  COMPLETED: 'completed', TP_REACHED: 'tp_reached', SL_REACHED: 'sl_reached', ERROR: 'error' 
};
const ACCOUNT_STATUS = { ACTIVE: 'active', DISCONNECTED: 'disconnected', ERROR: 'error', DISABLED: 'disabled' };

const DERIV_WS_URL = 'wss://ws.derivws.com/websockets/v3?app_id=1089';

// ==================== Account Operations ====================

async function getAccounts(userId) {
  const { data, error } = await supabase
    .from('trading_accounts')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });
  
  if (error) throw error;
  return data || [];
}

async function addAccount(userId, accountData) {
  const { data, error } = await supabase
    .from('trading_accounts')
    .insert({
      id: uuidv4(),
      user_id: userId,
      deriv_account_id: accountData.accountId,
      deriv_token: accountData.derivToken,
      account_type: accountData.accountType || 'real',
      currency: accountData.currency || 'USD',
      balance: accountData.balance || 0,
      is_active: true,
      is_virtual: accountData.isVirtual || false,
      last_balance_update: new Date().toISOString(),
      created_at: new Date().toISOString()
    })
    .select()
    .single();
  
  if (error) throw error;
  return data;
}

async function updateAccount(accountId, updates) {
  const { data, error } = await supabase
    .from('trading_accounts')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', accountId)
    .select()
    .single();
  
  if (error) throw error;
  return data;
}

async function deleteAccount(accountId) {
  const { error } = await supabase
    .from('trading_accounts')
    .delete()
    .eq('id', accountId);
  
  if (error) throw error;
  return { success: true };
}

async function verifyDerivToken(token) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(DERIV_WS_URL);
    const timeout = setTimeout(() => {
      ws.close();
      reject(new Error('Connection timeout'));
    }, 10000);
    
    ws.on('open', () => ws.send(JSON.stringify({ authorize: token })));
    
    ws.on('message', (data) => {
      clearTimeout(timeout);
      const response = JSON.parse(data.toString());
      ws.close();
      
      if (response.error) {
        reject(new Error(response.error.message));
      } else if (response.authorize) {
        resolve({
          accountId: response.authorize.loginid,
          balance: response.authorize.balance,
          currency: response.authorize.currency,
          email: response.authorize.email,
          fullName: response.authorize.fullname,
          isVirtual: response.authorize.is_virtual === 1
        });
      }
    });
    
    ws.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}

// ==================== Session Operations ====================

async function createSession(adminId, sessionData) {
  const { data, error } = await supabase
    .from('trading_sessions')
    .insert({
      id: uuidv4(),
      admin_id: adminId,
      session_name: sessionData.name || `Session ${new Date().toLocaleDateString()}`,
      session_type: sessionData.session_type || sessionData.type || 'day',
      status: 'pending',
      volatility_index: sessionData.volatility_index || sessionData.volatilityIndex || 'R_100',
      contract_type: sessionData.contract_type || sessionData.contractType || 'DIGITEVEN',
      strategy_name: sessionData.strategy || 'DFPM',
      staking_mode: sessionData.staking_mode || sessionData.stakingMode || 'fixed',
      initial_stake: sessionData.initial_stake || sessionData.baseStake || 1.0,
      martingale_multiplier: sessionData.martingale_multiplier || 2.0,
      profit_threshold: sessionData.default_tp || sessionData.targetProfit || 10.0,
      loss_threshold: sessionData.default_sl || sessionData.stopLoss || 5.0,
      total_trades: 0,
      winning_trades: 0,
      losing_trades: 0,
      net_pnl: 0,
      created_at: new Date().toISOString()
    })
    .select()
    .single();
  
  if (error) throw error;
  return data;
}

async function getSession(sessionId) {
  const { data, error } = await supabase
    .from('trading_sessions')
    .select('*')
    .eq('id', sessionId)
    .single();
  
  if (error) throw error;
  return data;
}

async function getSessions(adminId, options = {}) {
  let query = supabase
    .from('trading_sessions')
    .select('*')
    .eq('admin_id', adminId);
  
  if (options.status) query = query.eq('status', options.status);
  if (options.type) query = query.eq('type', options.type);
  
  query = query.order('created_at', { ascending: false });
  if (options.limit) query = query.limit(options.limit);
  
  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

async function updateSession(sessionId, updates) {
  const { data, error } = await supabase
    .from('trading_sessions')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', sessionId)
    .select()
    .single();
  
  if (error) throw error;
  return data;
}

async function deleteSession(sessionId) {
  // Delete related data first
  await supabase.from('session_invitations').delete().eq('session_id', sessionId);
  await supabase.from('trades').delete().eq('session_id', sessionId);
  
  const { error } = await supabase
    .from('trading_sessions')
    .delete()
    .eq('id', sessionId);
  
  if (error) throw error;
  return { success: true };
}

// ==================== Invitation Operations ====================

async function createInvitation(sessionId, accountId, adminId) {
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes
  
  const { data, error } = await supabase
    .from('session_invitations')
    .insert({
      id: uuidv4(),
      session_id: sessionId,
      account_id: accountId,
      admin_id: adminId,
      status: 'pending',
      expires_at: expiresAt.toISOString(),
      created_at: new Date().toISOString()
    })
    .select()
    .single();
  
  if (error) throw error;
  return data;
}

async function getInvitations(accountId) {
  const { data, error } = await supabase
    .from('session_invitations')
    .select('*, trading_sessions(*)')
    .eq('account_id', accountId)
    .eq('status', 'pending')
    .gt('expires_at', new Date().toISOString());
  
  if (error) throw error;
  return data || [];
}

async function acceptInvitation(invitationId, accountId) {
  const { data: invitation, error: fetchError } = await supabase
    .from('session_invitations')
    .select('*')
    .eq('id', invitationId)
    .eq('account_id', accountId)
    .single();
  
  if (fetchError) throw fetchError;
  if (!invitation) throw new Error('Invitation not found');
  if (new Date(invitation.expires_at) < new Date()) throw new Error('Invitation expired');
  if (invitation.status !== 'pending') throw new Error('Invitation already processed');
  
  const { data, error } = await supabase
    .from('session_invitations')
    .update({ status: 'accepted', accepted_at: new Date().toISOString() })
    .eq('id', invitationId)
    .select()
    .single();
  
  if (error) throw error;
  return data;
}

async function declineInvitation(invitationId, accountId) {
  const { data, error } = await supabase
    .from('session_invitations')
    .update({ status: 'declined' })
    .eq('id', invitationId)
    .eq('account_id', accountId)
    .select()
    .single();
  
  if (error) throw error;
  return data;
}

// ==================== Trade Operations ====================

async function recordTrade(tradeData) {
  const { data, error } = await supabase
    .from('trades')
    .insert({
      id: uuidv4(),
      session_id: tradeData.sessionId,
      account_id: tradeData.accountId,
      contract_id: tradeData.contractId,
      contract_type: tradeData.contractType,
      volatility_index: tradeData.volatilityIndex,
      strategy: tradeData.strategy,
      stake: tradeData.stake,
      prediction: tradeData.prediction,
      entry_tick: tradeData.entryTick,
      result: 'pending',
      created_at: new Date().toISOString()
    })
    .select()
    .single();
  
  if (error) throw error;
  return data;
}

async function updateTradeResult(tradeId, result, profit, exitTick) {
  const { data, error } = await supabase
    .from('trades')
    .update({
      result,
      profit,
      exit_tick: exitTick,
      payout: result === 'won' ? profit : 0,
      updated_at: new Date().toISOString()
    })
    .eq('id', tradeId)
    .select()
    .single();
  
  if (error) throw error;
  return data;
}

async function getSessionTrades(sessionId, options = {}) {
  let query = supabase
    .from('trades')
    .select('*')
    .eq('session_id', sessionId);
  
  if (options.accountId) query = query.eq('account_id', options.accountId);
  query = query.order('created_at', { ascending: false });
  if (options.limit) query = query.limit(options.limit);
  
  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

async function getTradeStats(sessionId, accountId = null) {
  let query = supabase.from('trades').select('*').eq('session_id', sessionId);
  if (accountId) query = query.eq('account_id', accountId);
  
  const { data: trades, error } = await query;
  if (error) throw error;
  
  const completed = trades.filter(t => t.result !== 'pending');
  const wins = completed.filter(t => t.result === 'won');
  const losses = completed.filter(t => t.result === 'lost');
  
  return {
    totalTrades: trades.length,
    completedTrades: completed.length,
    wins: wins.length,
    losses: losses.length,
    winRate: completed.length > 0 ? (wins.length / completed.length) * 100 : 0,
    totalProfit: completed.reduce((sum, t) => sum + (t.profit || 0), 0),
    totalStake: completed.reduce((sum, t) => sum + (t.stake || 0), 0)
  };
}

// ==================== Activity Log Operations ====================

async function logActivity(type, message, metadata = {}) {
  const { error } = await supabase
    .from('activity_logs')
    .insert({
      id: uuidv4(),
      type,
      message,
      metadata,
      created_at: new Date().toISOString()
    });
  
  if (error) console.error('Failed to log activity:', error);
}

async function getActivityLogs(options = {}) {
  let query = supabase
    .from('activity_logs')
    .select('*')
    .order('created_at', { ascending: false });
  
  if (options.type) query = query.eq('type', options.type);
  if (options.limit) query = query.limit(options.limit);
  
  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

// ==================== Bot Control ====================

const botState = {
  isRunning: false,
  activeSessions: new Map(),
  connections: new Map(),
  startTime: null
};

async function startBot() {
  if (botState.isRunning) return { success: false, message: 'Bot already running' };
  
  botState.isRunning = true;
  botState.startTime = Date.now();
  await logActivity('bot_start', 'Trading bot started');
  
  return { success: true, message: 'Bot started' };
}

async function stopBot() {
  if (!botState.isRunning) return { success: false, message: 'Bot not running' };
  
  for (const ws of botState.connections.values()) {
    try { ws.close(); } catch (e) {}
  }
  botState.connections.clear();
  botState.activeSessions.clear();
  botState.isRunning = false;
  botState.startTime = null;
  
  await logActivity('bot_stop', 'Trading bot stopped');
  
  return { success: true, message: 'Bot stopped' };
}

function getBotStatus() {
  return {
    isRunning: botState.isRunning,
    activeSessionCount: botState.activeSessions.size,
    connectionCount: botState.connections.size,
    uptime: botState.startTime ? Date.now() - botState.startTime : 0
  };
}

// ==================== Exports ====================

module.exports = {
  // Constants
  SESSION_TYPE, SESSION_STATUS, ACCOUNT_STATUS,
  
  // Accounts
  getAccounts, addAccount, updateAccount, deleteAccount, verifyDerivToken,
  
  // Sessions
  createSession, getSession, getSessions, updateSession, deleteSession,
  
  // Invitations
  createInvitation, getInvitations, acceptInvitation, declineInvitation,
  
  // Trades
  recordTrade, updateTradeResult, getSessionTrades, getTradeStats,
  
  // Logs
  logActivity, getActivityLogs,
  
  // Bot
  startBot, stopBot, getBotStatus, botState
};
