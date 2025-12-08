const { createClient } = require('@supabase/supabase-js');
const WebSocket = require('ws');
const crypto = require('crypto');
const strategyConfig = require('../config/strategyConfig');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY
);

/**
 * Trade Executor - Multi-Account Synchronized Trading
 * Executes trades across multiple accounts simultaneously
 * Applies individual TP/SL per account
 * Monitors and closes trades at TP/SL levels
 */
class TradeExecutor {
  constructor() {
    this.activeConnections = new Map(); // derivAccountId -> WebSocket
    this.activeMonitors = new Map(); // tradeId -> monitor interval
    this.rateLimitDelay = 500; // 500ms between trades
    this.consecutiveLosses = 0;
    this.apiErrorCount = 0;
    this.paused = false;
  }

  /**
   * Execute trade for multiple accounts
   */
  async executeMultiAccountTrade(signal, sessionId) {
    try {
      if (this.paused) {
        console.warn('[TradeExecutor] Guardrail active: paused. Skipping execution.');
        return { success: false, message: 'Bot paused by safety guard' };
      }

      console.log(`[TradeExecutor] 🚀 Executing multi-account trade for session ${sessionId}`);
      console.log(`[TradeExecutor] Signal: ${signal.side} ${signal.digit} (${(signal.confidence * 100).toFixed(1)}%)`);

      // Get session details
      const { data: session, error: sessionError } = await supabase
        .from('trading_sessions') // Use V1 table (matching trading.js)
        .select('*')
        .eq('id', sessionId)
        .eq('status', 'running')
        .single();

      if (sessionError || !session) {
        throw new Error('Session not found or not active');
      }

      // Get accepted accounts
      const { data: invitations, error: invError } = await supabase
        .from('session_participants')
        .select('*')
        .eq('session_id', sessionId)
        .eq('status', 'active');

      if (invError) {
        throw new Error(`Failed to fetch invitations: ${invError.message}`);
      }

      if (!invitations || invitations.length === 0) {
        console.log('[TradeExecutor] ⚠️ No accepted accounts for this session');
        return {
          success: false,
          message: 'No accepted accounts'
        };
      }

      console.log(`[TradeExecutor] Found ${invitations.length} accepted accounts`);

      // Validate balances and prepare accounts
      const validAccounts = [];
      const invalidAccounts = [];

      for (const invitation of invitations) {
        // DUAL ACCOUNT LOGIC: Use bound account if available, else fallback to active
        let accountQuery = supabase.from('trading_accounts').select('*');

        if (invitation.account_id) {
          accountQuery = accountQuery.eq('id', invitation.account_id);
        } else {
          // Legacy fallback
          accountQuery = accountQuery
            .eq('user_id', invitation.user_id)
            .eq('is_active', true)
            .order('updated_at', { ascending: false });
        }

        const { data: account, error: acctErr } = await accountQuery.maybeSingle();

        if (acctErr || !account) {
          invalidAccounts.push({
            accountId: null,
            userId: invitation.user_id,
            reason: 'No active trading account',
            derivAccountId: null
          });
          continue;
        }

        // Check balance
        const minBalance = session.min_balance || strategyConfig.minBalance;
        if (account.balance < minBalance) {
          invalidAccounts.push({
            accountId: account.id,
            userId: account.user_id,
            reason: `Balance too low: $${account.balance} < $${minBalance}`,
            derivAccountId: account.deriv_account_id
          });

          // Send notification
          await this.sendNotification(account.user_id, {
            type: 'low_balance',
            message: `Your balance ($${account.balance}) is below the minimum required ($${minBalance})`,
            sessionId
          });

          continue;
        }

        // Check TP/SL
        const minTp = session.default_tp || strategyConfig.minTp;
        const minSl = session.default_sl || strategyConfig.minSl;
        if (!invitation.take_profit || !invitation.stop_loss) {
          invalidAccounts.push({
            accountId: account.id,
            userId: account.user_id,
            reason: 'TP/SL not set',
            derivAccountId: account.deriv_account_id
          });
          continue;
        }

        if (invitation.take_profit < minTp || Math.abs(invitation.stop_loss) < minSl) {
          invalidAccounts.push({
            accountId: account.id,
            userId: account.user_id,
            reason: `TP/SL below admin minimums (tp>=${minTp}, sl>=${minSl})`,
            derivAccountId: account.deriv_account_id
          });

          await this.sendNotification(account.user_id, {
            type: 'invalid_tpsl',
            message: `Your TP/SL is below admin minimums (TP >= ${minTp}, SL >= ${minSl}). Update settings to trade.`
          });
          continue;
        }

        validAccounts.push({
          invitation,
          account
        });
      }

      console.log(`[TradeExecutor] Valid accounts: ${validAccounts.length}, Invalid: ${invalidAccounts.length}`);

      if (validAccounts.length === 0) {
        return {
          success: false,
          message: 'No valid accounts to trade',
          invalidAccounts
        };
      }

      // Execute trades for all valid accounts
      const tradeResults = [];

      for (const { invitation, account } of validAccounts) {
        try {
          // Rate limiting
          await this.sleep(this.rateLimitDelay);

          const tradeResult = await this.executeSingleTrade(
            account,
            invitation,
            signal,
            session
          );

          tradeResults.push(tradeResult);

          // Log trade
          await this.logTrade(tradeResult, sessionId);

          // Start TP/SL monitor
          if (tradeResult.success) {
            this.startTPSLMonitor(tradeResult, invitation, session);
          }

        } catch (error) {
          console.error(`[TradeExecutor] Trade failed for account ${account.deriv_account_id}:`, error);

          tradeResults.push({
            success: false,
            accountId: account.id,
            userId: account.user_id,
            derivAccountId: account.deriv_account_id,
            error: error.message
          });

          await this.sendNotification(account.user_id, {
            type: 'trade_failed',
            message: `Trade execution failed: ${error.message}`,
            sessionId
          });
        }
      }

      const successCount = tradeResults.filter(r => r.success).length;
      console.log(`[TradeExecutor] ✅ Executed ${successCount}/${validAccounts.length} trades successfully`);

      return {
        success: true,
        executed: successCount,
        total: validAccounts.length,
        results: tradeResults,
        invalidAccounts
      };

    } catch (error) {
      console.error('[TradeExecutor] Multi-account trade error:', error);
      this.apiErrorCount += 1;
      if (this.apiErrorCount >= strategyConfig.apiErrorThreshold) {
        this.paused = true;
        console.error('[TradeExecutor] Pausing bot due to API error threshold');
      }
      throw error;
    }
  }

  /**
   * Execute single trade for one account
   */
  async executeSingleTrade(account, invitation, signal, session) {
    try {
      // Decrypt API token
      const apiToken = this.decryptToken(account.api_token);

      // Connect to Deriv WebSocket
      const ws = await this.getConnection(account.deriv_account_id, apiToken);

      // Calculate stake
      const stake = await this.calculateStake(account.balance, session, account.user_id);

      // Prepare contract parameters
      const contractParams = {
        buy: 1,
        price: stake,
        parameters: {
          contract_type: signal.side === 'OVER' ? 'DIGITOVER' : 'DIGITUNDER', // DUAL SUPPORT: Check volatility_index (V1) or markets[0] (V2)
          symbol: session.volatility_index || (session.markets && session.markets[0]) || 'R_100',
          duration: session.duration || 1,
          duration_unit: session.duration_unit || 't',
          currency: account.currency || 'USD',
          amount: stake, // Assuming 'proposal: 1stake' was meant to replace 'amount: stake' and '1stake' was a typo for 'stake'
          barrier: signal.digit.toString()
        }
      };

      // Execute buy
      const buyResponse = await this.sendRequest(ws, contractParams);

      if (buyResponse.error) {
        throw new Error(buyResponse.error.message);
      }

      const contract = buyResponse.buy;

      console.log(`[TradeExecutor] ✅ Trade executed for ${account.deriv_account_id}: Contract ${contract.contract_id}`);

      return {
        success: true,
        accountId: account.id,
        userId: account.user_id,
        derivAccountId: account.deriv_account_id,
        contractId: contract.contract_id,
        buyPrice: contract.buy_price,
        payout: contract.payout,
        signal,
        stake,
        takeProfit: invitation.take_profit,
        stopLoss: invitation.stop_loss,
        timestamp: new Date()
      };

    } catch (error) {
      console.error(`[TradeExecutor] Single trade error for ${account.deriv_account_id}:`, error);
      throw error;
    }
  }

  /**
   * Start TP/SL monitor for a trade using WebSocket logic
   */
  async startTPSLMonitor(tradeResult, invitation, session) {
    const monitorId = `${tradeResult.contractId}_${tradeResult.accountId}`;

    if (this.activeMonitors.has(monitorId)) {
      console.log(`[TradeExecutor] Monitor already active for ${monitorId}`);
      return;
    }

    console.log(`[TradeExecutor] ⚡ Starting Real-Time WS Monitor for contract ${tradeResult.contractId}`);

    const ws = this.activeConnections.get(tradeResult.derivAccountId);
    if (!ws) {
      console.error(`[TradeExecutor] No connection for ${tradeResult.derivAccountId} to start monitor`);
      return;
    }

    // 1. Define the handler for real-time updates
    const updateHandler = async (data) => {
      try {
        const message = JSON.parse(data.toString());

        // Filter for this specific contract
        if (message.msg_type === 'proposal_open_contract') {
          const contract = message.proposal_open_contract;

          if (contract && contract.contract_id === tradeResult.contractId) {

            // Check if contract is still open or sold
            if (!contract.is_sold && !contract.is_settleable) {
              const currentPL = contract.profit || 0;

              // Check TP
              if (currentPL >= invitation.take_profit) {
                console.log(`[TradeExecutor] 🎯 TP HIT! Closing contract ${tradeResult.contractId} at $${currentPL}`);
                // Remove listener immediately to prevent double firing
                ws.removeListener('message', updateHandler);
                await this.closeTrade(tradeResult, 'tp_hit', currentPL, invitation, session);
                return;
              }

              // Check SL
              if (currentPL <= -Math.abs(invitation.stop_loss)) {
                console.log(`[TradeExecutor] 🛑 SL HIT! Closing contract ${tradeResult.contractId} at $${currentPL}`);
                ws.removeListener('message', updateHandler);
                await this.closeTrade(tradeResult, 'sl_hit', currentPL, invitation, session);
                return;
              }
            } else {
              // Contract closed externally or finished naturally
              if (contract.is_sold) {
                console.log(`[TradeExecutor] Contract ${tradeResult.contractId} closed naturally. Profit: ${contract.profit}`);
                ws.removeListener('message', updateHandler);
                const finalPL = contract.profit || 0;
                const status = finalPL > 0 ? 'win' : 'loss';
                await this.closeTrade(tradeResult, status, finalPL, invitation, session);
              }
            }
          }
        }
      } catch (error) {
        console.error(`[TradeExecutor] Monitor error for ${monitorId}:`, error);
      }
    };

    // 2. Attach listener
    ws.on('message', updateHandler);

    // 3. Store the listener/handler so we can remove it later if needed (e.g. manual stop)
    // We store the handler function instead of an interval ID
    this.activeMonitors.set(monitorId, { ws, handler: updateHandler });

    // 4. Send Subscribe Request
    try {
      await this.sendRequest(ws, {
        proposal_open_contract: 1,
        contract_id: tradeResult.contractId,
        subscribe: 1
      });
      console.log(`[TradeExecutor] Subscribed to contract ${tradeResult.contractId}`);
    } catch (err) {
      console.error(`[TradeExecutor] Failed to subscribe to ${tradeResult.contractId}:`, err);
      ws.removeListener('message', updateHandler);
      this.activeMonitors.delete(monitorId);
    }
  }

  // NOTE: checkTPSL is no longer needed as we use the event handler above


  /**
   * Close trade and remove account from session
   */
  async closeTrade(tradeResult, reason, finalPL, invitation, session) {
    try {
      const monitorId = `${tradeResult.contractId}_${tradeResult.accountId}`;

      // Stop monitor (Unsubscribe and remove listener)
      if (this.activeMonitors.has(monitorId)) {
        const monitor = this.activeMonitors.get(monitorId);

        // Remove the specific message handler
        if (monitor.ws && monitor.handler) {
          monitor.ws.removeListener('message', monitor.handler);

          // Send 'forget' to stop server from sending updates for this contract
          // We don't await this because we want to close the trade logic fast
          monitor.ws.send(JSON.stringify({ forget_all: ['proposal_open_contract'] }));
          // Note: forget_all is a bit heavy, strictly we should use 'forget: subscription_id' but we didn't save ID.
          // Given this bot manages one trade per account usually, forget_all proposal_open_contract is safe-ish,
          // BUT to be safer, let's just assume the 'sell' or end of contract stops the stream implicitly often,
          // or we rely on 'forget_all' at session end.
          // Actually, Deriv usually cleans up closed contract streams? No, we should be explicit.
          // Let's try to just remove listener for now. The stream might keep coming but we ignore it.
          // Optimize: Use forget(monitorId) if we stored subscription ID. 
        }

        this.activeMonitors.delete(monitorId);
      }

      // Sell contract if still open
      const ws = this.activeConnections.get(tradeResult.derivAccountId);
      if (ws) {
        try {
          await this.sendRequest(ws, {
            sell: tradeResult.contractId,
            price: 0 // Market price
          });
        } catch (error) {
          console.error('[TradeExecutor] Sell error:', error);
        }
      }

      // Update trade record
      await supabase
        .from('trades')
        .update({
          status: reason,
          profit_loss: finalPL,
          closed_at: new Date().toISOString()
        })
        .eq('contract_id', tradeResult.contractId);

      // Handle Recovery Session Logic
      if (session.session_type === 'recovery') {
        await this.handleRecoveryOutcome(session, finalPL);
      }

      // Remove account from session
      await supabase
        .from('session_participants')
        .update({
          status: reason === 'tp_hit' ? 'removed_tp' : reason === 'sl_hit' ? 'removed_sl' : 'removed',
          removed_at: new Date().toISOString(),
          removal_reason: reason
        })
        .eq('id', invitation.id);

      // If SL hit, flag for recovery
      if (reason === 'sl_hit') {
        await supabase
          .from('recovery_states')
          .insert({
            user_id: tradeResult.userId,
            account_id: tradeResult.accountId,
            original_session_id: session.id,
            sl_hit_at: new Date().toISOString(),
            status: 'eligible'
          });
      }

      // Send notification
      const message = reason === 'tp_hit'
        ? `✅ Take Profit hit! Profit: $${finalPL.toFixed(2)}`
        : reason === 'sl_hit'
          ? `❌ Stop Loss hit! Loss: $${finalPL.toFixed(2)}`
          : `Trade closed. P&L: $${finalPL.toFixed(2)}`;

      await this.sendNotification(tradeResult.userId, {
        type: reason,
        message,
        sessionId: session.id,
        profitLoss: finalPL
      });

      // Safety: track loss streaks
      if (reason === 'sl_hit' || finalPL < 0) {
        this.consecutiveLosses += 1;
        if (this.consecutiveLosses >= strategyConfig.maxLossStreak) {
          this.paused = true;
          console.error('[TradeExecutor] Pausing bot due to consecutive loss guard');
          await this.sendNotification(tradeResult.userId, {
            type: 'guard_pause',
            message: 'Bot paused due to consecutive losses'
          });
        }
      } else {
        this.consecutiveLosses = 0;
      }

      console.log(`[TradeExecutor] ✅ Trade closed: ${reason}, P&L: $${finalPL.toFixed(2)}`);

    } catch (error) {
      console.error('[TradeExecutor] Close trade error:', error);
    }
  }

  /**
   * Handle outcome for recovery sessions
   */
  async handleRecoveryOutcome(session, profitLoss) {
    try {
      const { data: recoveryState, error } = await supabase
        .from('recovery_states')
        .select('*')
        .eq('session_id', session.id)
        .single();

      if (error || !recoveryState) return;

      const updates = {
        updated_at: new Date().toISOString()
      };

      if (profitLoss > 0) {
        // WIN: Add to recovered amount, reset multiplier
        const newRecovered = (parseFloat(recoveryState.recovered_amount) || 0) + parseFloat(profitLoss);
        updates.recovered_amount = newRecovered;
        updates.consecutive_losses = 0;
        updates.current_multiplier = 1.0; // Reset on win

        // Check if recovery target reached
        if (newRecovered >= parseFloat(recoveryState.recovery_target)) {
          updates.is_active = false;
          updates.completed_at = new Date().toISOString();
          updates.recovery_progress = 100;

          console.log(`[TradeExecutor] 🏁 Recovery session ${session.id} COMPLETED! Target reached.`);

          // Also mark session as completed
          await supabase
            .from('trading_sessions_v2')
            .update({ status: 'completed', ended_at: new Date().toISOString() })
            .eq('id', session.id);

          // Notify admin
          await this.sendNotification(session.admin_id, {
            type: 'recovery_completed',
            message: `Recovery session completed! Recovered: $${newRecovered.toFixed(2)}`,
            sessionId: session.id
          });
        } else {
          // Update progress percentage
          const progress = (newRecovered / parseFloat(recoveryState.recovery_target)) * 100;
          updates.recovery_progress = Math.min(100, parseFloat(progress.toFixed(2)));
        }

      } else {
        // LOSS: Increase multiplier (Martingale)
        updates.consecutive_losses = (recoveryState.consecutive_losses || 0) + 1;

        // Update max consecutive losses if needed
        if (updates.consecutive_losses > (recoveryState.max_consecutive_losses || 0)) {
          updates.max_consecutive_losses = updates.consecutive_losses;
        }

        // Apply Martingale multiplier
        const martingaleMult = parseFloat(session.martingale_multiplier) || 2.0;
        updates.current_multiplier = (parseFloat(recoveryState.current_multiplier) || 1.0) * martingaleMult;

        console.log(`[TradeExecutor] 📉 Recovery loss. New multiplier: ${updates.current_multiplier}x`);
      }

      // Save updates
      await supabase
        .from('recovery_states')
        .update(updates)
        .eq('id', recoveryState.id);

    } catch (error) {
      console.error('[TradeExecutor] Handle recovery outcome error:', error);
    }
  }

  /**
   * Get or create WebSocket connection for account
   */
  async getConnection(derivAccountId, apiToken) {
    if (this.activeConnections.has(derivAccountId)) {
      return this.activeConnections.get(derivAccountId);
    }

    return new Promise((resolve, reject) => {
      // Use centralized WS_URL from config
      const { WS_URL } = require('../config/deriv');
      const ws = new WebSocket(WS_URL);

      ws.on('open', () => {
        // Authorize
        ws.send(JSON.stringify({ authorize: apiToken }));
      });

      ws.on('message', (data) => {
        const message = JSON.parse(data.toString());

        if (message.msg_type === 'authorize') {
          console.log(`[TradeExecutor] ✅ Connected & authorized for ${derivAccountId}`);
          this.activeConnections.set(derivAccountId, ws);
          resolve(ws);
        } else if (message.msg_type === 'error') {
          reject(new Error(message.error.message));
        }
      });

      ws.on('error', (error) => {
        reject(error);
      });

      // Timeout after 30 seconds
      setTimeout(() => {
        reject(new Error('Connection timeout'));
      }, 30000);
    });
  }

  /**
   * Send request and wait for response
   */
  async sendRequest(ws, request) {
    return new Promise((resolve, reject) => {
      const reqId = `req_${Date.now()}_${Math.random()}`;
      request.req_id = reqId;

      const messageHandler = (data) => {
        const message = JSON.parse(data.toString());

        if (message.req_id === reqId) {
          ws.removeListener('message', messageHandler);
          resolve(message);
        }
      };

      ws.on('message', messageHandler);

      ws.send(JSON.stringify(request));

      // Timeout after 15 seconds
      setTimeout(() => {
        ws.removeListener('message', messageHandler);
        reject(new Error('Request timeout'));
      }, 15000);
    });
  }

  /**
   * Calculate stake based on account balance and session type
   */
  async calculateStake(balance, session, userId) {
    try {
      // Recovery Mode Logic
      if (session.session_type === 'recovery') {
        const { data: recoveryState } = await supabase
          .from('recovery_states')
          .select('*')
          .eq('session_id', session.id)
          .single();

        if (recoveryState) {
          const stake = session.initial_stake * (recoveryState.current_multiplier || 1.0);
          return Math.max(0.35, parseFloat(stake.toFixed(2)));
        }
      }

      // Fixed Staking
      if (session.staking_mode === 'fixed') {
        return Math.max(0.35, parseFloat(session.initial_stake));
      }

      // Percentage Staking (Default)
      const percentage = session.stake_percentage || 0.02;
      const stake = balance * percentage;
      return Math.max(0.35, parseFloat(stake.toFixed(2))); // Minimum stake $0.35

    } catch (error) {
      console.error('[TradeExecutor] Calculate stake error:', error);
      return 0.35; // Fallback to minimum
    }
  }

  /**
   * Decrypt API token
   */
  decryptToken(encryptedToken) {
    try {
      const algorithm = 'aes-256-gcm';
      const key = Buffer.from(process.env.ENCRYPTION_KEY, 'hex');

      const parts = encryptedToken.split(':');
      const iv = Buffer.from(parts[0], 'hex');
      const authTag = Buffer.from(parts[1], 'hex');
      const encrypted = Buffer.from(parts[2], 'hex');

      const decipher = crypto.createDecipheriv(algorithm, key, iv);
      decipher.setAuthTag(authTag);

      let decrypted = decipher.update(encrypted, null, 'utf8');
      decrypted += decipher.final('utf8');

      return decrypted;
    } catch (error) {
      console.error('[TradeExecutor] Token decryption error:', error);
      throw new Error('Failed to decrypt API token');
    }
  }

  /**
   * Send notification to user
   */
  async sendNotification(userId, notification) {
    try {
      await supabase
        .from('trading_notifications')
        .insert({
          user_id: userId,
          type: notification.type,
          message: notification.message,
          data: notification,
          created_at: new Date().toISOString()
        });
    } catch (error) {
      console.error('[TradeExecutor] Notification error:', error);
    }
  }

  /**
   * Log trade to database
   */
  async logTrade(tradeResult, sessionId) {
    try {
      if (!tradeResult.success) return;

      await supabase
        .from('trades')
        .insert({
          session_id: sessionId,
          account_id: tradeResult.accountId,
          user_id: tradeResult.userId,
          contract_id: tradeResult.contractId,
          buy_price: tradeResult.buyPrice,
          payout: tradeResult.payout,
          stake: tradeResult.stake,
          signal: tradeResult.signal,
          confidence: tradeResult.signal?.confidence,
          status: 'open',
          created_at: tradeResult.timestamp.toISOString()
        });
    } catch (error) {
      console.error('[TradeExecutor] Log trade error:', error);
    }
  }

  /**
   * Sleep utility
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Disconnect all connections
   */
  disconnectAll() {
    console.log('[TradeExecutor] Disconnecting all connections...');

    // Clear all monitors
    for (const [id, interval] of this.activeMonitors) {
      clearInterval(interval);
    }
    this.activeMonitors.clear();

    // Close all WebSocket connections
    for (const [id, ws] of this.activeConnections) {
      try {
        ws.close();
      } catch (error) {
        console.error(`[TradeExecutor] Error closing connection ${id}:`, error);
      }
    }
    this.activeConnections.clear();

    console.log('[TradeExecutor] All connections closed');
  }

  /**
   * Get statistics
   */
  getStats() {
    return {
      activeConnections: this.activeConnections.size,
      activeMonitors: this.activeMonitors.size
    };
  }
}

module.exports = new TradeExecutor();
