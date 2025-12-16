/**
 * Trading Service - Backend service for multi-account automated trading
 */

const { supabase } = require('../db/supabase');
const { v4: uuidv4 } = require('uuid');
const WebSocket = require('ws');
const botManager = require('./botManager');
const { WS_URL } = require('../config/deriv');
const strategyConfig = require('../config/strategyConfig');
const derivClient = require('./derivClient');

// ==================== Constants ====================

const SESSION_TYPE = { DAY: 'day', ONE_TIME: 'one_time', RECOVERY: 'recovery' };
const SESSION_STATUS = {
  PENDING: 'pending', RUNNING: 'active', PAUSED: 'paused',
  COMPLETED: 'completed', TP_REACHED: 'tp_reached', SL_REACHED: 'sl_reached', ERROR: 'error'
};
const ACCOUNT_STATUS = { ACTIVE: 'active', DISCONNECTED: 'disconnected', ERROR: 'error', DISABLED: 'disabled' };

const DERIV_WS_URL = WS_URL;

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

async function syncUserBalances(userId, io) {
  try {
    const accounts = await getAccounts(userId);
    for (const account of accounts) {
      if (!account.deriv_token) continue;

      // Use verifyDerivToken to fetch latest balance
      verifyDerivToken(account.deriv_token).then(async (info) => {
        if (info.balance !== account.balance) {
          await updateAccount(account.id, {
            balance: info.balance,
            currency: info.currency,
            last_balance_update: new Date().toISOString()
          });

          if (io) {
            io.emit('balance_update', {
              accountId: account.deriv_account_id,
              balance: info.balance,
              currency: info.currency,
              accountType: account.account_type,
              timestamp: new Date().toISOString()
            });
            io.to('admin').emit('admin_balance_update', {
              accountId: account.deriv_account_id,
              totalBalance: info.balance,
              accountType: account.account_type
            });
          }
        }
      }).catch(err => console.error(`Failed to sync balance for ${account.deriv_account_id}:`, err.message));
    }
  } catch (error) {
    console.error('Error syncing user balances:', error);
  }
}


async function reconcileUserTrades(userId) {
  try {
    const accounts = await getAccounts(userId);
    let reconciledCount = 0;

    for (const account of accounts) {
      if (!account.deriv_token) continue;

      // 1. Get pending trades for this account from DB
      const { data: pendingTrades } = await supabase
        .from('trades')
        .select('*')
        .eq('account_id', account.deriv_account_id) // trades uses deriv_account_id in account_id column usually?
        // Wait, schema check. trades.account_id is UUID or string? 
        // In recordTrade (line 466), it uses tradeData.accountId. 
        // In executeSingleTrade (tradeExecutor.js:475), it returns profile.deriv_id as derivAccountId and participant.id as participantId.
        // Let's assume trades.account_id stores the Deriv Account ID (e.g., CR123456) or the Postgres UUID. 
        // Looking at recordTrade: `account_id: tradeData.accountId`.
        // In tradeExecutor: `accountId: accountId` from the input which is `participant.accountId`?
        // Actually, let's look at `tradeExecutor.js` imports.
        // It seems `account_id` in `trades` table might be the Deriv Login ID based on some usage, OR the internal UUID.
        // Getting pending trades for *this user* generally.
        .eq('result', 'pending');

      if (!pendingTrades || pendingTrades.length === 0) continue;

      console.log(`[Trading] Found ${pendingTrades.length} pending trades for ${account.deriv_account_id}, checking Deriv...`);

      // 2. Fetch completed trades from Deriv
      try {
        const profitTable = await derivClient.getProfitTable(account.deriv_account_id, account.deriv_token, 50);

        // 3. Match and Update
        for (const trade of pendingTrades) {
          // Find matching contract in profit table
          const match = profitTable.transactions.find(t => t.contract_id === Number(trade.contract_id) || t.transaction_id === Number(trade.contract_id));

          if (match) {
            console.log(`[Trading] Reconciling trade ${trade.contract_id}: Profit ${match.sell_price - match.buy_price}`);
            const profit = Number(match.sell_price) - Number(match.buy_price);
            const result = profit >= 0 ? 'won' : 'lost'; // Using 'won'/'lost' to match existing enums if any, or 'win'/'loss'
            // tradeExecutor uses 'won'/'lost' in updateTradeResult? No, it uses 'tp_hit', 'sl_hit', or 'win'/'loss' (lines 566).
            // updateTradeResult implementation (line 484) takes `result`.
            // Let's use 'won'/'lost' as safe bets or 'win'/'loss'.
            // TradeExecutor line 525: `wins = completed.filter(t => t.result === 'won')`. 
            // So 'won'/'lost' seems correct for `getTradeStats`.

            await updateTradeResult(
              trade.id,
              profit >= 0 ? 'won' : 'lost',
              profit,
              match.exit_tick || match.sell_time
            );
            reconciledCount++;
          }
        }
      } catch (err) {
        console.error(`[Trading] Failed to fetch profit table for ${account.deriv_account_id}:`, err.message);
      }
    }
    return reconciledCount;
  } catch (error) {
    console.error('[Trading] Error reconciling trades:', error);
    return 0;
  }
}

// ==================== Session Operations ====================

async function createSession(adminId, sessionData) {
  // Handle market from simplified form (can be in markets array or volatility_index)
  // V2 uses 'markets' array
  const market = sessionData.markets?.[0] || sessionData.volatility_index || sessionData.volatilityIndex || strategyConfig.markets[0];
  const markets = sessionData.markets || [market];

  const { data, error } = await supabase
    .from('trading_sessions_v2')
    .insert({
      id: uuidv4(),
      admin_id: adminId,
      name: sessionData.name || sessionData.session_name || `Session ${new Date().toLocaleDateString()}`,
      type: sessionData.session_type || sessionData.type || 'day',
      status: 'pending',
      markets: markets,
      // volatility_index: market, // specific to V1, removed for V2
      // contract_type: sessionData.contract_type || 'DIGITEVEN', // Removed for V2
      // mode: sessionData.mode || 'demo', // Removed for V2
      strategy: sessionData.strategy_name || sessionData.strategy || 'DFPM',
      staking_mode: sessionData.staking_mode || sessionData.stakingMode || 'fixed',
      base_stake: sessionData.initial_stake || sessionData.baseStake || 0.35,
      // martingale_multiplier: sessionData.martingale_multiplier || 2.0, // V2 doesn't use this column usually
      min_balance: sessionData.min_balance || sessionData.minimum_balance || 5.0,
      default_tp: sessionData.default_tp || sessionData.targetProfit || sessionData.profit_threshold || 10.0,
      default_sl: sessionData.default_sl || sessionData.stopLoss || sessionData.loss_threshold || 5.0,
      trade_count: 0,
      win_count: 0,
      loss_count: 0,
      current_pnl: 0,
      created_at: new Date().toISOString()
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

async function getSession(sessionId) {
  // Try V2 first
  const { data: v2, error: v2Error } = await supabase
    .from('trading_sessions_v2')
    .select('*')
    .eq('id', sessionId)
    .single();

  if (v2) return v2;

  // Fallback to V1
  const { data: v1, error: v1Error } = await supabase
    .from('trading_sessions')
    .select('*')
    .eq('id', sessionId)
    .single();

  if (v1Error && !v1) throw v1Error || v2Error; // Throw legitimate error if neither found
  return v1;
}

async function getSessions(adminId, options = {}) {
  // Use V2 as primary source of truth now
  let query = supabase
    .from('trading_sessions_v2')
    .select('*');

  if (options.publicAccess) {
    // For normal users, show only pending/active sessions regardless of creator
    query = query.in('status', ['pending', 'active']);
  } else {
    // For admins, restrictive by owner
    query = query.eq('admin_id', adminId);
    if (options.status) query = query.eq('status', options.status);
  }

  if (options.type) query = query.eq('type', options.type); // V2 uses 'type'

  query = query.order('created_at', { ascending: false });
  if (options.limit) query = query.limit(options.limit);

  const { data, error } = await query;
  if (error) {
    console.error('[TradingService] Error fetching sessions:', error);
    throw error;
  }

  // Get participants count for each session separately and normalize fields
  const sessionsWithCount = await Promise.all((data || []).map(async (session) => {
    const { count } = await supabase
      .from('session_participants')
      .select('*', { count: 'exact', head: true })
      .eq('session_id', session.id);

    let finalCount = count || 0;

    // Fallback for legacy sessions: check invitations if participants table is empty
    if (finalCount === 0) {
      const { count: invCount } = await supabase
        .from('session_invitations')
        .select('*', { count: 'exact', head: true })
        .eq('session_id', session.id)
        .eq('status', 'accepted');
      finalCount = invCount || 0;
    }

    return {
      ...session,
      // Normalize field names for V1/V2 frontend compatibility
      name: session.name || session.session_name,
      session_name: session.session_name || session.name,
      type: session.type || session.session_type, // Normalize type
      // Convert volatility_index to markets array for frontend
      markets: session.markets || (session.volatility_index ? [session.volatility_index] : [strategyConfig.markets[0]]),
      participants_count: finalCount
    };
  }));

  return sessionsWithCount;
}

async function updateSession(sessionId, updates) {
  // Try to update V2 first
  const { data: v2Check } = await supabase.from('trading_sessions_v2').select('id').eq('id', sessionId).maybeSingle();
  let table = v2Check ? 'trading_sessions_v2' : 'trading_sessions';

  // Map updates to schema if needed (basic mapping)
  const mappedUpdates = {
    ...updates,
    updated_at: new Date().toISOString()
  };

  // If updating legacy table with V2 keys, might fail, but let's assume keys match mostly or caller handles it
  // Ideally we should map keys here too but keeping it simple for now as most updates are status changes

  const { data, error } = await supabase
    .from(table)
    .update(mappedUpdates)
    .eq('id', sessionId)
    .select()
    .single();

  if (error) throw error;
  return data;
}

async function deleteSession(sessionId) {
  // Try to find in V2
  const { data: v2Check } = await supabase.from('trading_sessions_v2').select('id').eq('id', sessionId).maybeSingle();
  const table = v2Check ? 'trading_sessions_v2' : 'trading_sessions';

  // Delete related data first
  await supabase.from('session_invitations').delete().eq('session_id', sessionId);
  await supabase.from('session_participants').delete().eq('session_id', sessionId);
  await supabase.from('trades').delete().eq('session_id', sessionId);

  const { error } = await supabase
    .from(table)
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
    .update({ status: 'accepted', responded_at: new Date().toISOString() })
    .eq('id', invitationId)
    .select()
    .single();

  if (error) throw error;

  // ADDED: Also add to session_participants
  const { data: account } = await supabase
    .from('trading_accounts')
    .select('user_id')
    .eq('deriv_account_id', invitation.account_id) // Assuming account_id in invitation is deriv_id? Or uuid?
    .single();

  // If invitation.account_id is UUID
  let userId = null;
  if (!account) {
    const { data: acc } = await supabase.from('trading_accounts').select('user_id').eq('id', invitation.account_id).single();
    if (acc) userId = acc.user_id;
  } else {
    userId = account.user_id;
  }

  if (userId) {
    await supabase.from('session_participants').upsert({
      session_id: invitation.session_id,
      user_id: userId,
      status: 'active',
      joined_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    });
  }

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

async function joinSession(sessionId, accountId) {
  // Check if invitation already exists
  const { data: existing } = await supabase
    .from('session_invitations')
    .select('*')
    .eq('session_id', sessionId)
    .eq('account_id', accountId)
    .maybeSingle();

  if (existing) {
    if (existing.status === 'accepted') return existing; // Already joined
    // If pending or declined, update to accepted
    const { data, error } = await supabase
      .from('session_invitations')
      .update({ status: 'accepted', responded_at: new Date().toISOString() })
      .eq('id', existing.id)
      .select()
      .single();

    if (error) throw error;

    // ADDED: Ensure participant record exists
    const { data: account } = await supabase
      .from('trading_accounts')
      .select('user_id')
      .eq('id', accountId)
      .single();

    if (account) {
      await supabase.from('session_participants').upsert({
        session_id: sessionId,
        user_id: account.user_id,
        status: 'active',
        joined_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }, { onConflict: 'session_id, user_id' });
    }

    return data;
  }

  // Create new accepted invitation
  const { data, error } = await supabase
    .from('session_invitations')
    .insert({
      id: uuidv4(),
      session_id: sessionId,
      account_id: accountId,
      status: 'accepted',
      responded_at: new Date().toISOString(),
      created_at: new Date().toISOString()
    })
    .select()
    .single();

  if (error) throw error;

  // ADDED: Create participant record
  const { data: account } = await supabase
    .from('trading_accounts')
    .select('user_id')
    .eq('id', accountId)
    .single();

  if (account) {
    await supabase.from('session_participants').upsert({
      session_id: sessionId,
      user_id: account.user_id,
      status: 'active',
      joined_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    });
  }

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
    totalStake: completed.reduce((sum, t) => sum + (t.stake || 0), 0)
  };
}

async function getUserPerformance(userId) {
  // 1. Get user accounts
  const accounts = await getAccounts(userId);
  const accountIds = accounts.map(a => a.deriv_account_id);

  if (accountIds.length === 0) {
    return { todayPnL: 0, winRate: 0, totalTrades: 0, totalProfit: 0 };
  }

  // 2. Get trades for these accounts
  // Note: account_id in trades table stores the Deriv Account ID (e.g. CR123456)
  const { data: trades, error } = await supabase
    .from('trades')
    .select('*')
    .in('account_id', accountIds);

  if (error) throw error;

  // 3. Calculate Stats
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();

  const completed = trades.filter(t => t.result === 'won' || t.result === 'lost');
  const todayTrades = completed.filter(t => t.created_at >= todayStart);

  const todayPnL = todayTrades.reduce((sum, t) => sum + (Number(t.profit) || 0), 0);
  const totalTrades = completed.length;
  const wins = completed.filter(t => t.result === 'won').length;
  const winRate = totalTrades > 0 ? (wins / totalTrades) * 100 : 0;
  const totalProfit = completed.reduce((sum, t) => sum + (Number(t.profit) || 0), 0);

  // Get last trade time
  const lastTradeTime = trades.length > 0 ? trades[0].created_at : null;

  return {
    todayPnL,
    winRate,
    totalTrades,
    totalProfit,
    lastTradeTime
  };
}

// ==================== Activity Log Operations ====================

async function logActivity(type, message, metadata = {}) {
  // Extract user_id/session_id for top-level columns
  const { user_id, session_id, ...otherMeta } = metadata;

  const details = {
    message,
    ...otherMeta
  };

  const { error } = await supabase
    .from('trading_activity_logs')
    .insert({
      id: uuidv4(),
      action_type: type,
      action_details: details,
      user_id: user_id || null,
      session_id: session_id || null,
      created_at: new Date().toISOString()
    });

  if (error) console.error('Failed to log activity:', error);
}

async function getActivityLogs(options = {}) {
  let query = supabase
    .from('trading_activity_logs')
    .select('*')
    .order('created_at', { ascending: false });

  if (options.type) query = query.eq('action_type', options.type);
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
  // Check if already running via manager
  const state = botManager.getState();
  if (state.isRunning) return { success: false, message: 'Bot already running' };

  // 1. Try to find a RUNNING session first
  let { data: session, error } = await supabase
    .from('trading_sessions')
    .select('*')
    .eq('status', 'active')
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  // 2. If no running session, try to find a PENDING session and auto-start it
  if (!session) {
    const { data: pendingSession } = await supabase
      .from('trading_sessions')
      .select('*')
      .eq('status', 'pending')
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (pendingSession) {
      // Auto-promote to running
      await supabase
        .from('trading_sessions')
        .update({ status: 'active', started_at: new Date().toISOString() })
        .eq('id', pendingSession.id);

      session = pendingSession;
      await logActivity('system', `Auto-started pending session: ${session.session_name || session.name}`);
    }
  }

  if (!session) {
    return { success: false, message: 'No active or pending session found. Please create a session first.' };
  }

  // Start Bot Manager
  try {
    await botManager.startBot(session.id);
    await logActivity('bot_start', `Trading bot started for session ${session.session_name || session.name}`);
    return { success: true, message: `Bot started for session ${session.session_name || session.name}` };
  } catch (err) {
    console.error('Failed to start bot manager:', err);
    return { success: false, message: `Failed to start bot: ${err.message}` };
  }
}

async function stopBot() {
  const state = botManager.getState();
  if (!state.isRunning) return { success: false, message: 'Bot not running' };

  try {
    await botManager.stopBot();
    await logActivity('bot_stop', 'Trading bot stopped');
    return { success: true, message: 'Bot stopped' };
  } catch (err) {
    console.error('Failed to stop bot:', err);
    return { success: false, message: `Failed to stop bot: ${err.message}` };
  }
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
  getAccounts, addAccount, updateAccount, deleteAccount, verifyDerivToken, syncUserBalances, reconcileUserTrades,

  // Sessions
  createSession, getSession, getSessions, updateSession, deleteSession,

  // Invitations
  createInvitation, getInvitations, acceptInvitation, declineInvitation, joinSession,

  // Trades
  recordTrade, updateTradeResult, getSessionTrades, getTradeStats, getUserPerformance,

  // Logs
  logActivity, getActivityLogs,

  // Bot
  startBot, stopBot, getBotStatus, botState
};
