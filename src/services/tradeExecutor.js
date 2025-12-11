const { createClient } = require('@supabase/supabase-js');
const WebSocket = require('ws');
const crypto = require('crypto');
const strategyConfig = require('../config/strategyConfig');
const { decryptToken } = require('../utils/encryption');
const { messageQueue, TOPICS } = require('../queue');
const { createTradeClosedEvent } = require('../trading-engine/eventContract');

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
    this.io = null;
    this.processingSignals = new Set(); // Lock for concurrent signals
  }

  setSocket(io) {
    this.io = io;
  }

  /**
   * Execute trade for multiple accounts with improved locking
   */
  async executeMultiAccountTrade(signal, sessionId) {
    // Create a lock key based on session and signal details
    const lockKey = `${sessionId}-${signal.market}-${signal.digit}-${signal.side}`;

    if (this.processingSignals.has(lockKey)) {
      console.log(`[TradeExecutor]  Skipping concurrent signal: ${lockKey}`);
      return { executed: 0, total: 0, reason: 'locked' };
    }

    this.processingSignals.add(lockKey);

    try {
      if (this.paused) {
        console.log('[TradeExecutor]  Trading paused, skipping signal');
        return { executed: 0, total: 0 };
      }

      console.log(`[TradeExecutor]  Executing multi-account trade for session ${sessionId}`);
      console.log(`[TradeExecutor] Signal: ${signal.side} ${signal.digit} (${(signal.confidence * 100).toFixed(1)}%)`);

      // Get session details
      const { data: session, error: sessionError } = await supabase
        .from(sessionTable) // Use correct table
        .select('*')
        .eq('id', sessionId)
        .eq('status', 'running')
        .single();

      if (sessionError || !session) {
        throw new Error('Session not found or not active');
      }

      console.log(`[TradeExecutor] Session: ${session.name} (Table: ${sessionTable}, Type: ${session.type || 'N/A'}, MinBal: $${session.min_balance || 0}, TP: $${session.default_tp}, SL: $${session.default_sl})`);

      // Get accepted accounts - join with trading_accounts to get deriv_token
      const { data: invitations, error: invError } = await supabase
        .from('session_participants')
        .select('*')
        .eq('session_id', sessionId)
        .eq('status', 'active');

      if (invError) {
        throw new Error(`Failed to fetch invitations: ${invError.message}`);
      }

      if (!invitations || invitations.length === 0) {
        console.log('[TradeExecutor]  No accepted accounts for this session');
        return {
          success: false,
          message: 'No accepted accounts'
        };
      }

      console.log(`[TradeExecutor] Found ${invitations.length} accepted accounts`);

      // Validate participants and prepare for trading
      const validAccounts = [];
      const invalidAccounts = [];

      for (const participant of invitations) {
        let derivToken = participant.deriv_token;
        let tradingAccount = null;

        // If no token in participant record (V1 flow), look up trading account
        if (!derivToken) {
          const { data: account, error: accountErr } = await supabase
            .from('trading_accounts')
            .select('deriv_token, deriv_account_id, currency, is_active')
            .eq('user_id', participant.user_id)
            .eq('is_active', true)
            .limit(1)
            .maybeSingle();

          if (accountErr) {
            console.error(`[TradeExecutor] Error fetching trading account for user ${participant.user_id}:`, accountErr);
          }

          if (account) {
            tradingAccount = account;
            derivToken = account.deriv_token;
          }
        }

        // Check if we have a valid trading token
        if (!derivToken) {
          invalidAccounts.push({
            userId: participant.user_id,
            reason: 'No trading token provided - user has no active trading account',
            participantId: participant.id
          });
          continue;
        }

        // Get user profile for deriv_id (use account data if available)
        const { data: profile, error: profileErr } = await supabase
          .from('user_profiles')
          .select('deriv_id, currency')
          .eq('id', participant.user_id)
          .single();

        if (profileErr || !profile) {
          invalidAccounts.push({
            userId: participant.user_id,
            reason: 'User profile not found',
            participantId: participant.id
          });
          continue;
        }

        // Use currency from trading account if profile doesn't have it
        if (!profile.currency && tradingAccount?.currency) {
          profile.currency = tradingAccount.currency;
        }

        // Use deriv_account_id from trading account if profile doesn't have deriv_id
        if (!profile.deriv_id && tradingAccount?.deriv_account_id) {
          profile.deriv_id = tradingAccount.deriv_account_id;
        }

        // Use session defaults if participant TP/SL not set (V2 schema requires them, but be defensive)
        const effectiveTp = participant.tp || session.default_tp || 10;
        const effectiveSl = participant.sl || session.default_sl || 5;

        // V2: Check min_balance requirement
        const minBalance = session.min_balance || 0;
        if (participant.initial_balance && participant.initial_balance < minBalance) {
          invalidAccounts.push({
            userId: participant.user_id,
            reason: `Balance ${participant.initial_balance} below minimum ${minBalance}`,
            participantId: participant.id
          });
          continue;
        }

        // Validate TP/SL meet session minimums
        const minTp = session.default_tp || session.profit_threshold || strategyConfig.minTp;
        const minSl = session.default_sl || session.loss_threshold || strategyConfig.minSl;
        if (effectiveTp < minTp || effectiveSl < minSl) {
          invalidAccounts.push({
            userId: participant.user_id,
            reason: `TP/SL below minimums (tp>=${minTp}, sl>=${minSl})`,
            participantId: participant.id
          });
          continue;
        }

        // Store effective values for trade execution
        participant.effectiveTp = effectiveTp;
        participant.effectiveSl = effectiveSl;

        validAccounts.push({
          participant,
          profile,
          apiToken: derivToken // Use token from trading_accounts table
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

      for (const { participant, profile, apiToken } of validAccounts) {
        try {
          // Rate limiting
          await this.sleep(this.rateLimitDelay);

          const tradeResult = await this.executeSingleTrade(
            participant,
            profile,
            apiToken,
            signal,
            session
          );

          tradeResults.push(tradeResult);

          // Log trade
          await this.logTrade(tradeResult, sessionId);

          // Send analysis notification to user
          if (tradeResult.success) {
            await this.sendNotification(participant.user_id, {
              type: 'trade_executed',
              message: ` Trade Executed: ${tradeResult.signal.side} ${tradeResult.signal.digit}`,
              data: {
                contractId: tradeResult.contractId,
                signal: tradeResult.signal.side,
                digit: tradeResult.signal.digit,
                confidence: `${(tradeResult.signal.confidence * 100).toFixed(1)}%`,
                stake: tradeResult.stake,
                payout: tradeResult.payout,
                takeProfit: tradeResult.takeProfit,
                stopLoss: tradeResult.stopLoss,
                timestamp: tradeResult.timestamp
              },
              sessionId
            });

            // Start TP/SL monitor
            this.startTPSLMonitor(tradeResult, participant, session);
          }

        } catch (error) {
          console.error(`[TradeExecutor] Trade failed for user ${profile.deriv_id}:`, error);

          tradeResults.push({
            success: false,
            participantId: participant.id,
            userId: participant.user_id,
            derivAccountId: profile.deriv_id,
            error: error.message
          });

          await this.sendNotification(participant.user_id, {
            type: 'trade_failed',
            message: `Trade execution failed: ${error.message}`,
            sessionId
          });
        }
      }

      const successCount = tradeResults.filter(r => r.success).length;
      console.log(`[TradeExecutor]  Executed ${successCount}/${validAccounts.length} trades successfully`);

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
    } finally {
      // Release lock
      const lockKey = `${sessionId}-${signal.market}-${signal.digit}-${signal.side}`;
      this.processingSignals.delete(lockKey);
    }
  }

  /**
   * Execute single trade for one participant
   */
  async executeSingleTrade(participant, profile, apiToken, signal, session) {
    try {
      // Connect to Deriv WebSocket using the participant's token
      const ws = await this.getConnection(profile.deriv_id, apiToken);

      // Calculate stake (use session base stake for now)
      const stake = session.initial_stake || session.base_stake || 0.35;

      // Prepare contract parameters
      const contractParams = {
        buy: 1,
        price: stake,
        parameters: {
          contract_type: signal.side === 'OVER' ? 'DIGITOVER' : 'DIGITUNDER',
          symbol: session.volatility_index || (session.markets && session.markets[0]) || 'R_100',
          duration: session.duration || 1,
          duration_unit: session.duration_unit || 't',
          currency: profile.currency || 'USD',
          amount: stake,
          barrier: signal.digit.toString()
        }
      };

      // Execute buy
      const buyResponse = await this.sendRequest(ws, contractParams);

      if (buyResponse.error) {
        throw new Error(buyResponse.error.message);
      }

      const contract = buyResponse.buy;

      console.log(`[TradeExecutor]  Trade executed for ${profile.deriv_id}: Contract ${contract.contract_id}`);

      // Emit trade start event
      if (this.io) {
        this.io.emit('trade_update', {
          type: 'open',
          contractId: contract.contract_id,
          market: session.markets ? session.markets[0] : 'R_100', // Assuming single market for now
          signal: signal.side,
          side: signal.side,
          stake: stake,
          price: contract.buy_price,
          payout: contract.payout,
          timestamp: new Date().toISOString()
        });
      }

      return {
        success: true,
        participantId: participant.id,
        userId: participant.user_id,
        derivAccountId: profile.deriv_id,
        contractId: contract.contract_id,
        buyPrice: contract.buy_price,
        payout: contract.payout,
        signal,
        stake,
        takeProfit: participant.effectiveTp || participant.tp,
        stopLoss: participant.effectiveSl || participant.sl,
        timestamp: new Date()
      };

    } catch (error) {
      console.error(`[TradeExecutor] Single trade error for ${profile.deriv_id}:`, error);
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

    console.log(`[TradeExecutor]  Starting Real-Time WS Monitor for contract ${tradeResult.contractId}`);

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
                console.log(`[TradeExecutor]  TP HIT! Closing contract ${tradeResult.contractId} at $${currentPL}`);
                // Remove listener immediately to prevent double firing
                ws.removeListener('message', updateHandler);
                await this.closeTrade(tradeResult, 'tp_hit', currentPL, invitation, session);
                return;
              }

              // Check SL
              if (currentPL <= -Math.abs(invitation.stop_loss)) {
                console.log(`[TradeExecutor]  SL HIT! Closing contract ${tradeResult.contractId} at $${currentPL}`);
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

      // Send comprehensive session report notification
      const reportMessage = reason === 'tp_hit'
        ? ` Take Profit Reached! Session Complete`
        : reason === 'sl_hit'
          ? ` Stop Loss Reached. Session Ended`
          : ` Session Ended`;

      // Get trade history for this user in this session
      const { data: tradeHistory } = await supabase
        .from('trades')
        .select('*')
        .eq('session_id', session.id)
        .eq('user_id', tradeResult.userId)
        .order('created_at', { ascending: false });

      const totalTrades = tradeHistory?.length || 0;
      const wins = tradeHistory?.filter(t => t.result === 'win').length || 0;
      const losses = tradeHistory?.filter(t => t.result === 'loss').length || 0;
      const winRate = totalTrades > 0 ? ((wins / totalTrades) * 100).toFixed(1) : '0';

      await this.sendNotification(tradeResult.userId, {
        type: 'session_report',
        message: reportMessage,
        sessionId: session.id,
        data: {
          reason: reason,
          sessionName: session.name || session.session_name,
          finalPnL: finalPL.toFixed(2),
          result: finalPL >= 0 ? 'profit' : 'loss',
          totalTrades: totalTrades,
          wins: wins,
          losses: losses,
          winRate: `${winRate}%`,
          takeProfit: invitation.tp,
          stopLoss: invitation.sl,
          sessionMode: session.mode || 'real',
          closedAt: new Date().toISOString()
        }
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

      console.log(`[TradeExecutor]  Trade closed: ${reason}, P&L: $${finalPL.toFixed(2)}`);

      // Emit trade close event
      if (this.io) {
        this.io.emit('trade_update', {
          type: 'close',
          contractId: tradeResult.contractId,
          result: finalPL > 0 ? 'win' : 'loss',
          profit: finalPL,
          reason: reason,
          timestamp: new Date().toISOString()
        });
      }

      // Event-Driven: Publish to Redis for SSE
      if (messageQueue.isReady()) {
        const closedEvent = createTradeClosedEvent(
          {
            contract_id: tradeResult.contractId,
            symbol: session.markets ? session.markets[0] : 'R_100', // Best effort symbol
            direction: tradeResult.signal ? tradeResult.signal.side : 'UNKNOWN',
            stake: tradeResult.stake,
            participant_id: invitation.id
          },
          reason,
          finalPL,
          {
            sessionId: session.id,
            userId: tradeResult.userId,
            correlationId: `close-${tradeResult.contractId}`
          }
        );
        messageQueue.publish(TOPICS.TRADE_CLOSED, closedEvent).catch(err => {
          console.error('[TradeExecutor] Failed to publish close event:', err.message);
        });
      }

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

          console.log(`[TradeExecutor]  Recovery session ${session.id} COMPLETED! Target reached.`);

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

        console.log(`[TradeExecutor]  Recovery loss. New multiplier: ${updates.current_multiplier}x`);
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
   * Includes reconnect logic on disconnect
   */
  async getConnection(derivAccountId, apiToken, retryCount = 0) {
    const maxRetries = 3;

    if (this.activeConnections.has(derivAccountId)) {
      const existingWs = this.activeConnections.get(derivAccountId);
      if (existingWs.readyState === WebSocket.OPEN) {
        return existingWs;
      }
      // Connection dead, remove it
      this.activeConnections.delete(derivAccountId);
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
          console.log(`[TradeExecutor]  Connected & authorized for ${derivAccountId}`);
          this.activeConnections.set(derivAccountId, ws);
          resolve(ws);
        } else if (message.msg_type === 'error') {
          reject(new Error(message.error.message));
        }
      });

      ws.on('error', (error) => {
        console.error(`[TradeExecutor] WS error for ${derivAccountId}:`, error.message);
        reject(error);
      });

      ws.on('close', async () => {
        console.warn(`[TradeExecutor] WS disconnected for ${derivAccountId}`);
        this.activeConnections.delete(derivAccountId);

        // Auto-reconnect if within retry limit
        if (retryCount < maxRetries && !this.paused) {
          console.log(`[TradeExecutor] Attempting reconnect (${retryCount + 1}/${maxRetries})...`);
          await this.sleep(2000 * (retryCount + 1)); // Exponential backoff
          try {
            await this.getConnection(derivAccountId, apiToken, retryCount + 1);
          } catch (err) {
            console.error(`[TradeExecutor] Reconnect failed:`, err.message);
          }
        }
      });

      // Timeout after 30 seconds
      setTimeout(() => {
        if (ws.readyState !== WebSocket.OPEN) {
          ws.close();
          reject(new Error('Connection timeout'));
        }
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
