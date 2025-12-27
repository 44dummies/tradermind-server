const { supabase } = require('../db/supabase');
const WebSocket = require('ws');
const crypto = require('crypto');
const strategyConfig = require('../config/strategyConfig');
const { decryptToken } = require('../utils/encryption');
const { messageQueue, TOPICS } = require('../queue');
const { createTradeClosedEvent, createTradeExecutedEvent } = require('../trading-engine/eventContract');
const quantEngine = require('./quantEngine');
const perfMonitor = require('../utils/performance');

const connectionManager = require('./connectionManager');
const CircuitBreaker = require('./circuitBreaker');
const auditLogger = require('./auditLogger');
const riskEngine = require('./riskEngine');
const derivClient = require('./derivClient');

/**
 * Trade Executor - Multi-Account Synchronized Trading
 * Executes trades across multiple accounts simultaneously
 * Applies individual TP/SL per account
 * Monitors and closes trades at TP/SL levels
 */
class TradeExecutor {
  constructor() {
    // this.activeConnections = new Map(); // Deprecated: Managed by ConnectionManager
    this.activeMonitors = new Map(); // tradeId -> monitor interval
    this.accountBalances = new Map(); // derivAccountId -> balance

    // Initialize Managers
    connectionManager.init();
    this.circuitBreaker = new CircuitBreaker({
      failureThreshold: strategyConfig.apiErrorThreshold || 5,
      resetTimeout: 60000
    });
    // Risk Engine handles rate limits now
    this.rateLimitDelay = strategyConfig.rateLimitDelay || 500; // Configurable rate limit
    this.consecutiveLosses = 0;
    this.apiErrorCount = 0;
    this.paused = false;
    this.io = null;
    this.processingSignals = new Set(); // Lock for concurrent signals

    // Attempt hydration after short delay to allow Redis to connect
    setTimeout(() => this.hydrateMonitors(), 5000);
  }

  /**
   * Hydrate active monitors from Redis (Crash Recovery)
   */
  async hydrateMonitors() {
    console.log('[TradeExecutor] 🔄 Hydrating active monitors from persistence...');
    try {
      const keys = await messageQueue.scan('monitor:*');
      console.log(`[TradeExecutor] Found ${keys.length} persisted monitors`);

      for (const key of keys) {
        const state = await messageQueue.get(key);
        if (state && state.tradeResult && state.apiToken) {
          const { tradeResult, invitation, session, apiToken, startTime } = state;

          // Validate required fields for recovery
          if (!tradeResult.contractId || (!tradeResult.accountId && !tradeResult.derivAccountId)) {
            console.warn('[TradeExecutor] ⚠️ Skipping malformed monitor state:', key);
            continue;
          }

          // Ensure robust ID construction
          const accountId = tradeResult.accountId || tradeResult.derivAccountId;
          const monitorId = state.monitorId || `${tradeResult.contractId}_${accountId}`;

          if (this.activeMonitors.has(monitorId)) continue; // Already active

          console.log(`[TradeExecutor] Recovering monitor for ${tradeResult.contractId} (Account: ${accountId})`);

          // Restart monitor
          this.startTPSLMonitor(tradeResult, invitation, session, apiToken);
        }
      }
      // 2. Reconcile orphaned intents (CTO Phase 2)
      await this.reconcileOrphanedIntents();
    } catch (e) {
      console.error('[TradeExecutor] Failed to hydrate monitors:', e);
    }
  }

  /**
   * Reconcile trades that were stuck in 'pending_intent' status (Crash Recovery)
   */
  async reconcileOrphanedIntents() {
    console.log('[TradeExecutor] 🔍 Reconciling orphaned trade intents...');
    try {
      // Find intents older than 2 minutes that never got a contract ID
      const { data: orphanedIntents, error } = await supabase
        .from('trade_logs')
        .select('*, sessions:session_id(*)')
        .eq('status', 'pending_intent')
        .lt('created_at', new Date(Date.now() - 120000).toISOString());

      if (error) throw error;
      if (!orphanedIntents || orphanedIntents.length === 0) {
        console.log('[TradeExecutor] ✅ No orphaned intents found');
        return;
      }

      console.log(`[TradeExecutor] ⚠️ Found ${orphanedIntents.length} orphaned intents. Attempting recovery...`);

      for (const intent of orphanedIntents) {
        try {
          // 1. Get account token
          const { data: account } = await supabase
            .from('trading_accounts')
            .select('encrypted_token')
            .eq('account_id', intent.account_id)
            .single();

          if (!account) {
            await supabase.from('trade_logs').update({ status: 'failed_intent', metadata: { error: 'account_not_found' } }).eq('id', intent.id);
            continue;
          }

          console.log(`[TradeExecutor] Marking intent ${intent.id} as stale (Recovered from crash)`);
          await supabase
            .from('trade_logs')
            .update({
              status: 'stale_intent',
              metadata: {
                recovered_at: new Date().toISOString(),
                original_status: 'pending_intent'
              }
            })
            .eq('id', intent.id);

        } catch (intentErr) {
          console.error(`[TradeExecutor] Failed to reconcile intent ${intent.id}:`, intentErr);
        }
      }
    } catch (e) {
      console.error('[TradeExecutor] Reconciliation logic error:', e);
    }
  }



  setSocket(io) {
    this.io = io;
  }

  /**
   * Execute trade for multiple accounts with improved locking
   * @param {Object} signal - Trade signal from quant engine
   * @param {string} sessionId - Session ID
   * @param {string} sessionTable - Table name (default: 'trading_sessions')
   */
  async executeMultiAccountTrade(signal, sessionId, sessionTable = 'trading_sessions_v2') {
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

      // Calculate and log execution latency
      if (signal.generatedAt) {
        const latency = new Date() - new Date(signal.generatedAt);
        console.log(`[TradeExecutor] ⏱ Execution Latency: ${latency}ms`);
      }

      // 1. Get Session Details (Robust Lookup)
      let session = null;
      let usedTable = sessionTable;

      // Try requested table first
      let { data: primarySession, error: primaryError } = await supabase
        .from(sessionTable)
        .select('*')
        .eq('id', sessionId)
        .maybeSingle();

      if (primarySession) {
        session = primarySession;
      } else {
        // Fallback: Try the other table
        const altTable = sessionTable === 'trading_sessions' ? 'trading_sessions_v2' : 'trading_sessions';
        console.log(`[TradeExecutor] Session not found in ${sessionTable}, trying fallback to ${altTable}...`);

        const { data: altSession, error: altError } = await supabase
          .from(altTable)
          .select('*')
          .eq('id', sessionId)
          .maybeSingle();

        if (altSession) {
          session = altSession;
          usedTable = altTable;
          console.log(`[TradeExecutor] Found session in fallback table: ${altTable}`);
        } else {
          console.error(`[TradeExecutor] Session ${sessionId} not found in either table. Primary Err: ${primaryError?.message}, Alt Err: ${altError?.message}`);
        }
      }

      if (!session) {
        throw new Error('Session not found');
      }

      // Check if session is active in code (more flexible - support active/running)
      if (session.status !== 'active' && session.status !== 'running') {
        console.log(`[TradeExecutor] Session ${session.name || session.session_name} status is '${session.status}', not 'active/running'. Skipping.`);
        return { executed: 0, total: 0, reason: `session_${session.status}` };
      }

      // Normalize session data (handle V1/V2 differences)
      const sessionData = {
        ...session,
        name: session.name || session.session_name,
        min_balance: session.min_balance || session.minimum_balance || 0,
        default_tp: session.default_tp || session.profit_threshold,
        default_sl: session.default_sl || session.loss_threshold,
        markets: session.markets || (session.volatility_index ? [session.volatility_index] : [strategyConfig.system.defaultMarket])
      };

      console.log(`[TradeExecutor] Session: ${sessionData.name} (Table: ${sessionTable}, Type: ${sessionData.type || 'N/A'}, MinBal: $${sessionData.min_balance}, TP: $${sessionData.default_tp}, SL: $${sessionData.default_sl})`);

      // 0. QUALITY GATE: Evaluate Entry based on Session Health
      const entryDecision = this.evaluateEntry(signal, sessionData);
      if (!entryDecision.allow) {
        console.log(`[TradeExecutor] 🛑 Entry blocked: ${entryDecision.reason}`);
        return { executed: 0, total: 0, reason: entryDecision.reason };
      }

      // ==================== RISK ENGINE CHECK ====================
      // Centralized verification of Rate Limits, Correlation, and Session Safety
      const riskCheck = await riskEngine.checkRisk(sessionId, sessionData, signal);

      if (!riskCheck.allowed) {
        console.warn(`[TradeExecutor] 🛑 Risk Blocked: ${riskCheck.reason} (${riskCheck.detail})`);

        // Handle specific side effects (e.g. pausing session)
        if (riskCheck.reason === 'session_max_loss' || riskCheck.reason === 'session_drawdown') {
          await this.pauseSession(sessionId, sessionTable, riskCheck.reason);
        }

        return { executed: 0, total: 0, reason: riskCheck.reason };
      }

      // Get accepted accounts - join with trading_accounts to get deriv_token
      let { data: invitations, error: invError } = await supabase
        .from('session_participants')
        .select('*')
        .eq('session_id', sessionId)
        .eq('status', 'active');

      // Fallback for V1 sessions (check session_invitations)
      if (!invError && (!invitations || invitations.length === 0)) {
        console.log('[TradeExecutor] No V2 participants found, checking V1 session_invitations...');
        const { data: v1Invitations, error: v1Error } = await supabase
          .from('session_invitations')
          .select('*')
          .eq('session_id', sessionId)
          .eq('status', 'accepted');

        if (!v1Error && v1Invitations && v1Invitations.length > 0) {
          invitations = v1Invitations;
          console.log(`[TradeExecutor] Found ${invitations.length} V1 participants`);
        } else if (v1Error) {
          console.error('[TradeExecutor] Error fetching V1 invitations:', v1Error);
        }
      }

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

        // Get session mode (real or demo)
        const sessionMode = sessionData.mode || 'demo';
        const accountType = sessionMode === 'real' ? 'real' : 'demo';

        // Decrypt token if encrypted (format: iv:encryptedData)
        if (derivToken && derivToken.includes(':')) {
          try {
            derivToken = decryptToken(derivToken);
            console.log(`[TradeExecutor] Decrypted deriv_token for user ${participant.user_id}`);
          } catch (decryptErr) {
            console.warn(`[TradeExecutor] Failed to decrypt token for user ${participant.user_id}, treating as plain:`, decryptErr.message);
          }
        }

        // If no token in participant record (V1 flow), look up trading account matching session mode
        if (!derivToken) {
          const { data: account, error: accountErr } = await supabase
            .from('trading_accounts')
            .select('deriv_token, deriv_account_id, currency, is_active, account_type')
            .eq('user_id', participant.user_id)
            .eq('is_active', true)
            .eq('account_type', accountType) // Match session mode to account type!
            .limit(1)
            .maybeSingle();

          if (accountErr) {
            console.error(`[TradeExecutor] Error fetching ${accountType} account for user ${participant.user_id}:`, accountErr);
          }

          if (account) {
            tradingAccount = account;
            derivToken = account.deriv_token;

            // Decrypt token from trading_accounts if encrypted
            if (derivToken && derivToken.includes(':')) {
              try {
                derivToken = decryptToken(derivToken);
                console.log(`[TradeExecutor] Decrypted account token for user ${participant.user_id}`);
              } catch (decryptErr) {
                console.warn(`[TradeExecutor] Failed to decrypt account token for user ${participant.user_id}:`, decryptErr.message);
              }
            }

            console.log(`[TradeExecutor] Found ${accountType} account for user ${participant.user_id}: ${account.deriv_account_id}`);
          } else {
            // No matching account type found
            invalidAccounts.push({
              userId: participant.user_id,
              reason: `No ${accountType.toUpperCase()} account found - session requires ${accountType} account`,
              participantId: participant.id
            });
            continue;
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

        // Calculate stake for this participant - strictly use min_balance as stake if available (User Goal #9)
        const baseStake = sessionData.min_balance || sessionData.initial_stake || 0.35;

        // Default TP/SL is 50% of stake if not set by user or session
        // Priority: 1) User's custom TP/SL, 2) Session defaults, 3) 50% of stake
        const defaultTPSL = baseStake * 0.5; // 50% of stake
        const effectiveTp = participant.tp || sessionData.default_tp || Math.max(defaultTPSL, 0.35);
        const effectiveSl = participant.sl || sessionData.default_sl || Math.max(defaultTPSL, 0.35);

        // V2: Check min_balance requirement
        const minBalance = sessionData.min_balance || 0;
        if (participant.initial_balance && participant.initial_balance < minBalance) {
          invalidAccounts.push({
            userId: participant.user_id,
            reason: `Balance ${participant.initial_balance} below minimum ${minBalance}`,
            participantId: participant.id
          });
          continue;
        }

        // Validate TP/SL meet session minimums (if session has minimums set)
        const minTp = sessionData.default_tp || 0;
        const minSl = sessionData.default_sl || 0;
        if (minTp > 0 && effectiveTp < minTp) {
          invalidAccounts.push({
            userId: participant.user_id,
            reason: `Take Profit ($${effectiveTp}) below session minimum ($${minTp})`,
            participantId: participant.id
          });
          continue;
        }
        if (minSl > 0 && effectiveSl < minSl) {
          invalidAccounts.push({
            userId: participant.user_id,
            reason: `Stop Loss ($${effectiveSl}) below session minimum ($${minSl})`,
            participantId: participant.id
          });
          continue;
        }

        // Store effective values for trade execution
        participant.effectiveTp = effectiveTp;
        participant.effectiveSl = effectiveSl;

        // Ensure we have deriv_account_id for the connection manager
        participant.deriv_account_id = profile.deriv_id || tradingAccount?.deriv_account_id;

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

      // Execute trades for all valid accounts using parallel batches (CTO Phase 3)
      const tradeResults = await this.executeParallelBatches(validAccounts, signal, sessionData, sessionId, lockKey);

      const successCount = tradeResults.filter(r => r && r.success).length;
      console.log(`[TradeExecutor] 🏁 Finalizing execution for ${validAccounts.length} participants. Success: ${successCount}`);

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
  async executeSingleTrade(participant, profile, apiToken, signal, sessionData, intentId = null) {
    const perfId = `trade_exec_${profile.deriv_id}_${signal.market}_${Date.now()}`;
    perfMonitor.start(perfId);

    try {
      // Determines Stake
      let stake = participant.stake || sessionData.stake_amount || strategyConfig.minStake;

      // DYNAMIC SIZING logic
      if (sessionData.dynamic_sizing || sessionData.use_kelly) {
        // Default assumptions if no history
        const winRate = sessionData.win_rate || 0.55;
        const payout = 0.95; // Standard approx for synthetic indices

        const kellyStake = quantEngine.calculateKellyStake(
          participant.balance || participant.initial_balance,
          winRate,
          payout,
          0.2 // Conservative 20% Kelly
        );

        if (kellyStake > stake) {
          console.log(`[TradeExecutor] 🧠 Kelly Upgrade: $${stake} -> $${kellyStake.toFixed(2)} (${(winRate * 100).toFixed(0)}% WR)`);
          stake = Math.max(strategyConfig.minStake, parseFloat(kellyStake.toFixed(2)));
        }
      }

      // Validation against min/max
      stake = Math.max(stake, strategyConfig.minStake);

      const contractParams = {
        contract_type: signal.side === 'OVER' ? 'DIGITOVER' : 'DIGITUNDER',
        symbol: signal.market || (sessionData.markets && sessionData.markets[0]) || strategyConfig.system.defaultMarket,
        duration: sessionData.duration || 1,
        duration_unit: sessionData.duration_unit || 't',
        currency: profile.currency || 'USD',
        amount: stake,
        barrier: signal.digit.toString()
      };

      // 1. Get Proposal (Robustness or Turbo)
      const isTurbo = strategyConfig.system.turboMode || sessionData.turbo_mode;
      let executeParams;

      if (isTurbo) {
        console.log(`[TradeExecutor] 🚀 Turbo Mode: Skipping proposal for ${profile.deriv_id}`);
        // Direct buy params
        executeParams = contractParams;
      } else {
        // Robust Mode: Get Proposal first
        const proposal = await derivClient.getProposal(participant.deriv_account_id, apiToken, contractParams);

        if (!proposal || !proposal.id) {
          throw new Error('Failed to get valid proposal ID from Deriv');
        }

        executeParams = {
          proposal_id: proposal.id,
          price: proposal.ask_price
        };
      }

      // 2. Execute Buy
      const buyResult = await derivClient.buy(participant.deriv_account_id, apiToken, executeParams);


      if (!buyResult.success) {
        throw new Error('Buy execution failed');
      }

      const duration = perfMonitor.end(perfId);
      perfMonitor.logLatency(`Trade execution for ${profile.deriv_id}`, duration, 2000);

      console.log(`[TradeExecutor]  Trade executed for ${profile.deriv_id}: Contract ${buyResult.contract_id}`);

      // Emit trade start event
      if (this.io) {
        this.io.emit('trade_update', {
          type: 'open',
          sessionId: sessionData.id,
          contractId: buyResult.contract_id,
          market: sessionData.markets ? sessionData.markets[0] : strategyConfig.system.defaultMarket,
          signal: signal.side,
          side: signal.side,
          stake: stake,
          price: buyResult.buy_price,
          payout: buyResult.payout,
          timestamp: new Date().toISOString()
        });
      }

      // Event-Driven: Publish to Redis for SSE
      if (messageQueue.isReady()) {
        const executedEvent = createTradeExecutedEvent(
          {
            contract_id: buyResult.contract_id,
            symbol: sessionData.markets ? sessionData.markets[0] : strategyConfig.system.defaultMarket,
            direction: signal.side,
            stake: stake,
            entry_price: buyResult.buy_price,
            start_time: Math.floor(Date.now() / 1000), // Approximate if not returned
            participant_id: participant.id
          },
          {
            sessionId: sessionData.id,
            userId: participant.user_id,
            correlationId: `trade-${buyResult.contract_id}`
          }
        );
        messageQueue.publish(TOPICS.TRADE_EXECUTED, executedEvent);
      }

      return {
        success: true,
        participantId: participant.id,
        userId: participant.user_id,
        derivAccountId: profile.deriv_id,
        contractId: buyResult.contract_id,
        buyPrice: buyResult.buy_price,
        payout: buyResult.payout,
        signal,
        stake,
        takeProfit: participant.effectiveTp || participant.tp,
        stopLoss: participant.effectiveSl || participant.sl,
        timestamp: new Date(),
        executionDuration: duration
      };

    } catch (error) {
      console.error(`[TradeExecutor] Single trade error for ${profile.deriv_id}:`, error);
      throw error;
    }
  }

  /**
   * Start TP/SL monitor for a trade using WebSocket logic
   */
  async startTPSLMonitor(tradeResult, invitation, session, apiToken) {
    const monitorId = `${tradeResult.contractId}_${tradeResult.accountId}`;

    if (this.activeMonitors.has(monitorId)) {
      console.log(`[TradeExecutor] Monitor already active for ${monitorId}`);
      return;
    }

    console.log(`[TradeExecutor]  Starting Real-Time WS Monitor for contract ${tradeResult.contractId}`);

    // REFACTOR: Use ConnectionManager to ensure we get the valid authorized WS
    // Note: This relies on pooling to give us the SAME connection if it's reused
    let ws;
    try {
      ws = await connectionManager.getConnection(apiToken, tradeResult.derivAccountId);
    } catch (e) {
      console.error(`[TradeExecutor] Failed to get connection for monitor ${monitorId}`, e);
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
                console.log(`[TradeExecutor] 🎯 Entry: ${contract.entry_spot}, Exit: ${contract.current_spot || contract.exit_tick}`);
                // Remove listener immediately to prevent double firing
                ws.removeListener('message', updateHandler);

                const auditData = {
                  entrySpot: contract.entry_spot,
                  exitSpot: contract.current_spot || contract.exit_tick,
                  durationMs: new Date() - new Date(tradeResult.timestamp)
                };

                await this.closeTrade(tradeResult, 'tp_hit', currentPL, invitation, session, auditData);
                return;
              }

              // Check SL
              if (currentPL <= -Math.abs(invitation.stop_loss)) {
                console.log(`[TradeExecutor]  SL HIT! Closing contract ${tradeResult.contractId} at $${currentPL}`);
                console.log(`[TradeExecutor] 🎯 Entry: ${contract.entry_spot}, Exit: ${contract.current_spot || contract.exit_tick}`);
                ws.removeListener('message', updateHandler);

                const auditData = {
                  entrySpot: contract.entry_spot,
                  exitSpot: contract.current_spot || contract.exit_tick,
                  durationMs: new Date() - new Date(tradeResult.timestamp)
                };

                await this.closeTrade(tradeResult, 'sl_hit', currentPL, invitation, session, auditData);
                return;
              }
            } else {
              // Contract closed externally or finished naturally
              if (contract.is_sold) {
                console.log(`[TradeExecutor] Contract ${tradeResult.contractId} closed naturally. Profit: ${contract.profit}`);
                console.log(`[TradeExecutor] 🎯 Entry: ${contract.entry_spot}, Exit: ${contract.exit_tick || contract.current_spot}`);
                ws.removeListener('message', updateHandler);
                const finalPL = contract.profit || 0;
                const status = finalPL > 0 ? 'win' : 'loss';

                const auditData = {
                  entrySpot: contract.entry_spot,
                  exitSpot: contract.exit_tick || contract.current_spot,
                  durationMs: new Date() - new Date(tradeResult.timestamp)
                };

                await this.closeTrade(tradeResult, status, finalPL, invitation, session, auditData);
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
      const response = await this.sendRequest(ws, {
        proposal_open_contract: 1,
        contract_id: tradeResult.contractId,
        subscribe: 1
      });

      if (response.proposal_open_contract && response.proposal_open_contract.id) {
        // Store subscription ID for targeted unsubscribe
        this.activeMonitors.get(monitorId).subscriptionId = response.proposal_open_contract.id;
      } else if (response.subscription && response.subscription.id) {
        // Fallback location for ID
        this.activeMonitors.get(monitorId).subscriptionId = response.subscription.id;
      }

      console.log(`[TradeExecutor] Subscribed to contract ${tradeResult.contractId} (SubID: ${this.activeMonitors.get(monitorId).subscriptionId})`);
    } catch (err) {
      console.error(`[TradeExecutor] Failed to subscribe to ${tradeResult.contractId}:`, err);
      ws.removeListener('message', updateHandler);
      this.activeMonitors.delete(monitorId);
      return;
    }

    // 5. Initialize Strategic Exit State
    let maxProfit = -Infinity;
    const { trailingStop, timeStop } = strategyConfig.exitLogic;
    const startTime = Date.now();

    // PERSISTENCE: Save monitor state to Redis for recovery
    try {
      // Optimization: Minify session object to reduce Redis memory usage
      const minifiedSession = {
        id: session.id,
        user_id: session.user_id,
        min_balance: session.min_balance,
        default_tp: session.default_tp,
        default_sl: session.default_sl,
        stake_amount: session.stake_amount, // Critical for recovery logic if used
        markets: session.markets
      };

      const monitorState = {
        tradeResult,
        invitation,
        session: minifiedSession,
        apiToken, // Required for recovery reconnection
        startTime,
        monitorId
      };
      // Save with 24h expiry (just in case)
      await messageQueue.set(`monitor:${monitorId}`, monitorState, 86400);
    } catch (e) {
      console.error(`[TradeExecutor] Failed to persist monitor state for ${monitorId}`, e);
    }

    // 6. Time Stop Safety Monitor (Independent Interval)
    if (timeStop.enabled) {
      // Dynamic Time Stop: Scale with confidence
      // High confidence (0.9) -> 1.5x duration
      // Low confidence (0.6) -> 1.0x duration
      const confidence = tradeResult.signal?.confidence || 0.6;
      const confidenceScaler = Math.max(1.0, confidence / 0.6);
      const scaledMaxDuration = timeStop.maxDurationSec * confidenceScaler;

      const timeStopCheck = setInterval(async () => {
        const elapsedSec = (Date.now() - startTime) / 1000;
        if (elapsedSec > scaledMaxDuration) {
          console.warn(`[TradeExecutor] ⏱ TIME STOP Triggered (${elapsedSec.toFixed(1)}s > ${scaledMaxDuration.toFixed(1)}s). Forcing close.`);
          clearInterval(timeStopCheck);

          // Force close if still active
          if (this.activeMonitors.has(monitorId)) {
            ws.removeListener('message', updateHandler);
            await this.closeTrade(tradeResult, 'time_stop', 0, invitation, session, {
              durationMs: Date.now() - startTime
            });
          }
        }
      }, 5000); // Check every 5s

      // Attach interval to monitor object so we can clear it
      this.activeMonitors.get(monitorId).timeStopInterval = timeStopCheck;
    }

    // 7. Update Handler with Advanced Logic
    // We rewrite the handler logic here to include trailing stop
    const advancedHandler = async (data) => {
      try {
        const message = JSON.parse(data.toString());

        if (message.msg_type === 'proposal_open_contract') {
          const contract = message.proposal_open_contract;

          if (contract && contract.contract_id === tradeResult.contractId) {

            // Handle Trailing Stop Logic (Profit Protection)
            if (!contract.is_sold) {
              const currentPL = contract.profit || 0;

              // Thesis Invalidation: Zombie Trade (Strategic Exit)
              // If 50% of time passed, we are negative, and price is stagnating (low variance), Exit.
              // Adjusted for confidence: Higher confidence allows more stagnation.
              const elapsedSec = (Date.now() - startTime) / 1000;
              const zombieThresholdTime = (scaledMaxDuration || 60) * 0.5;

              if (elapsedSec > zombieThresholdTime && currentPL < 0) {
                // Check Stagnation: If currentPL is very small negative (drifting)
                // Logic: "Momentum decays"
                // Use configured threshold or default 0.15
                const zombieThreshold = strategyConfig.exitLogic.zombieTrade?.thresholdRatio || 0.15;
                if (Math.abs(currentPL) < (tradeResult.stake * zombieThreshold)) {
                  console.log(`[TradeExecutor] 🧟 Zombie Trade detected (Momentum Decay). Closing.`);
                  ws.removeListener('message', advancedHandler);
                  await this.closeTrade(tradeResult, 'thesis_invalidated', currentPL, invitation, session, {
                    entrySpot: contract.entry_spot,
                    exitSpot: contract.current_spot,
                    durationMs: Date.now() - startTime
                  });
                  return;
                }
              }

              // Track Peak Profit
              if (currentPL > maxProfit) {
                maxProfit = currentPL;
              }

              // Check Trailing Stop
              if (trailingStop.enabled && maxProfit > (tradeResult.stake * trailingStop.activationThreshold)) {
                // If we are profitable enough to activate...
                const drawdown = maxProfit - currentPL;
                const stopThreshold = maxProfit * trailingStop.callbackRate;

                if (drawdown >= stopThreshold) {
                  console.log(`[TradeExecutor] 📉 Trailing Stop Hit! Peak: $${maxProfit}, Current: $${currentPL}`);
                  ws.removeListener('message', advancedHandler);
                  await this.closeTrade(tradeResult, 'trailing_stop', currentPL, invitation, session, {
                    entrySpot: contract.entry_spot, // Note: might differ from initial entry
                    exitSpot: contract.current_spot,
                    durationMs: Date.now() - startTime
                  });
                  return;
                }
              }

              // Check Break-Even (Profit Protection)
              // Real Break-Even Lock: Lock capital, not hope.
              const beThresholdRatio = strategyConfig.exitLogic.breakEven?.thresholdRatio || 0.25;
              const beThreshold = tradeResult.stake * beThresholdRatio;

              if (maxProfit >= beThreshold && currentPL <= 0) {
                console.log(`[TradeExecutor] 🛡️ Break-Even Lock triggered. Peak: $${maxProfit}, Current: $${currentPL}`);
                ws.removeListener('message', advancedHandler);
                await this.closeTrade(tradeResult, 'break_even', currentPL, invitation, session, {
                  entrySpot: contract.entry_spot,
                  exitSpot: contract.current_spot,
                  durationMs: Date.now() - startTime
                });
                return;
              }

              // Classic TP/SL checks continue below...
              // Check TP
              if (currentPL >= invitation.take_profit) {
                // ... existing TP logic ...
                console.log(`[TradeExecutor]  TP HIT! Closing contract ${tradeResult.contractId} at $${currentPL}`);
                ws.removeListener('message', advancedHandler);
                await this.closeTrade(tradeResult, 'tp_hit', currentPL, invitation, session, { entrySpot: contract.entry_spot, exitSpot: contract.current_spot, durationMs: Date.now() - startTime });
                return;
              }
              // Check SL
              if (currentPL <= -Math.abs(invitation.stop_loss)) {
                // ... existing SL logic ...
                console.log(`[TradeExecutor]  SL HIT! Closing contract ${tradeResult.contractId} at $${currentPL}`);
                ws.removeListener('message', advancedHandler);
                await this.closeTrade(tradeResult, 'sl_hit', currentPL, invitation, session, { entrySpot: contract.entry_spot, exitSpot: contract.current_spot, durationMs: Date.now() - startTime });
                return;
              }

            } else {
              // Contract ended naturally logic...
              if (contract.is_sold) {
                // ... existing natural close logic ...
                console.log(`[TradeExecutor] Contract ${tradeResult.contractId} closed naturally. Profit: ${contract.profit}`);
                ws.removeListener('message', advancedHandler);
                const finalPL = contract.profit || 0;
                const status = finalPL > 0 ? 'win' : 'loss';
                await this.closeTrade(tradeResult, status, finalPL, invitation, session, { entrySpot: contract.entry_spot, exitSpot: contract.exit_tick, durationMs: Date.now() - startTime });
              }
            }
          }
        }
      } catch (e) { console.error('Monitor Error', e); }
    };

    // Replace the simple handler with advanced one
    ws.removeListener('message', updateHandler); // Remove the basic one we attached in step 1-2
    ws.on('message', advancedHandler);
    this.activeMonitors.get(monitorId).handler = advancedHandler; // Update ref

  }

  // NOTE: checkTPSL is no longer needed as we use the event handler above

  /**
   * Monitor all accounts in a session for balance updates
   */
  async monitorSessionAccounts(sessionId, sessionTable = 'trading_sessions_v2') {
    try {
      console.log(`[TradeExecutor] Initializing balance monitors for session ${sessionId}...`);

      // Get accepted participants (No JOIN to avoid foreign key issues)
      const { data: participants, error } = await supabase
        .from('session_participants')
        .select('*')
        .eq('session_id', sessionId)
        .eq('status', 'active');

      if (error) throw error;

      if (!participants || participants.length === 0) {
        console.log('[TradeExecutor] No participants to monitor.');
        return;
      }

      const derivClient = require('./derivClient');

      for (const p of participants) {
        let token = p.deriv_token;
        let accountId = null;
        let accountType = 'demo';

        // 1. Try to get token from participant record (Primary)
        if (token) {
          try {
            // Attempt decrypt if it looks encrypted (usually has :) or just try decrypt
            // If manual loop, decryptToken handles it or throws?
            // Since we have `decryptToken` imported, let's use it.
            // If it's not encrypted, it might return garbage or error. 
            // Assuming decryptToken handles standard format.
            if (token.includes(':')) {
              token = decryptToken(token);
            }
          } catch (e) {
            console.warn(`[TradeExecutor] Failed to decrypt token for user ${p.user_id}, treating as plain.`);
          }
        }

        // 2. Fallback: Look up trading account if no token or we need accountId/type details
        // We usually need accountId for subscription confirmation, though derivClient uses token.
        // Let's fetch the account anyway to get accountId for the event emission
        const { data: account } = await supabase
          .from('trading_accounts')
          .select('deriv_account_id, deriv_token, account_type')
          .eq('user_id', p.user_id)
          .eq('is_active', true)
          .limit(1)
          .maybeSingle();

        if (account) {
          accountId = account.deriv_account_id;
          accountType = account.account_type;
          if (!token) token = account.deriv_token; // Fallback token
        }

        if (!token) continue;

        // Use a placeholder ID if we still don't have one (unlikely if we have token)
        accountId = accountId || `user_${p.user_id}`;

        // Subscribe to balance
        await derivClient.subscribeBalance(accountId, token, (balanceData) => {
          // Cache balance for sizing
          this.accountBalances.set(balanceData.accountId, balanceData.balance);

          // Emit update to frontend
          if (this.io) {
            this.io.emit('balance_update', {
              accountId: balanceData.accountId,
              balance: balanceData.balance,
              currency: balanceData.currency,
              accountType: accountType,
              timestamp: new Date().toISOString()
            });

            // Also emit specifically for admin stats aggregation
            this.io.to('admin').emit('admin_balance_update', {
              accountId: balanceData.accountId,
              totalBalance: balanceData.balance,
              accountType: accountType
            });
          }
        });
      }

      console.log(`[TradeExecutor] Monitoring balances for ${participants.length} accounts`);
    } catch (error) {
      console.error('[TradeExecutor] Failed to monitor session accounts:', error);
    }
  }


  /**
   * Close trade and remove account from session
   */
  async closeTrade(tradeResult, reason, finalPL, invitation, session, auditData = {}) {
    try {
      const monitorId = `${tradeResult.contractId}_${tradeResult.accountId}`;

      // Stop monitor (Unsubscribe and remove listener)
      let wsToUse = null;

      if (this.activeMonitors.has(monitorId)) {
        const monitor = this.activeMonitors.get(monitorId);
        wsToUse = monitor.ws; // Capture WS for sell order before deletion

        // Clear Time Stop interval
        if (monitor.timeStopInterval) {
          clearInterval(monitor.timeStopInterval);
        }

        // Remove the specific message handler
        if (monitor.ws && monitor.handler) {
          monitor.ws.removeListener('message', monitor.handler);

          if (monitor.subscriptionId) {
            try {
              monitor.ws.send(JSON.stringify({ forget: monitor.subscriptionId }));
            } catch (e) {/* ignore */ }
          }
        }

        this.activeMonitors.delete(monitorId);

        // PERSISTENCE: Remove from Redis
        try {
          await messageQueue.del(`monitor:${monitorId}`);
        } catch (e) {
          // ignore
        }

        // CORRELATION: Free up slot
        await riskEngine.deregisterTrade({ contractId: tradeResult.contractId, market: tradeResult.market });
      }

      // Sell contract if still open
      // Use the WS from the monitor we just closed
      if (wsToUse && wsToUse.readyState === WebSocket.OPEN) {
        try {
          console.log(`[TradeExecutor] Attempting close sell for ${tradeResult.contractId}`);
          await this.sendRequest(wsToUse, {
            sell: tradeResult.contractId,
            price: 0 // Market price
          });
        } catch (error) {
          console.error('[TradeExecutor] Sell error:', error);
        }
      } else {
        console.warn(`[TradeExecutor] Could not sell ${tradeResult.contractId} - No active WS connection found.`);
      }

      // Update trade record
      await supabase
        .from('trade_logs')
        .update({
          result: reason === 'tp_hit' || reason === 'win' ? 'won' : reason === 'sl_hit' || reason === 'loss' ? 'lost' : 'cancelled', // V2 result enum
          profit: finalPL,
          closed_at: new Date().toISOString(),
          entry_tick: auditData.entrySpot,
          exit_tick: auditData.exitSpot,
          // duration_ms: auditData.durationMs // V2 doesn't have duration_ms in trade_logs usually
        })
        .eq('contract_id', tradeResult.contractId);

      // CRITICAL LOGGING FOR DASHBOARD STATS
      // Standardizing on activity_logs_v2 (metadata column)
      await supabase.from('activity_logs_v2').insert({
        session_id: session.id,
        type: finalPL > 0 ? 'trade_won' : 'trade_lost',
        level: 'info',
        message: `${finalPL > 0 ? 'Won' : 'Lost'} trade for contract ${tradeResult.contractId}`,
        metadata: {
          contractId: tradeResult.contractId,
          symbol: tradeResult.symbol || session.markets?.[0] || 'Unknown',
          profit: finalPL,
          pnl: finalPL,
          stake: tradeResult.stake,
          result: reason,
          entry: auditData.entrySpot,
          exit: auditData.exitSpot,
          userId: tradeResult.userId
        },
        user_id: tradeResult.userId,
        created_at: new Date().toISOString()
      });

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
        .from('trade_logs')
        .select('*')
        .eq('session_id', session.id)
        .eq('user_id', tradeResult.userId)
        .order('created_at', { ascending: false });

      const totalTrades = tradeHistory?.length || 0;
      const wins = tradeHistory?.filter(t => t.result === 'win').length || 0;
      const losses = tradeHistory?.filter(t => t.result === 'loss').length || 0;
      const winRate = totalTrades > 0 ? ((wins / totalTrades) * 100).toFixed(1) : '0';

      const durationSec = auditData.durationMs ? (auditData.durationMs / 1000).toFixed(1) : '0.0';

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
          closedAt: new Date().toISOString(),
          duration: `${durationSec}s`
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

      console.log(`[TradeExecutor]  Trade closed: ${reason}, P&L: $${finalPL.toFixed(2)}, Duration: ${durationSec}s`);

      // === Update Session Stats (Real-time PnL) ===
      try {
        const { data: currentSession } = await supabase
          .from('trading_sessions_v2')
          .select('current_pnl, trade_count, win_count, loss_count')
          .eq('id', session.id)
          .single();

        if (currentSession) {
          const newPnl = (currentSession.current_pnl || 0) + finalPL;
          const newTradeCount = (currentSession.trade_count || 0) + 1;
          const resultCol = finalPL > 0 ? 'win_count' : 'loss_count';
          const newResultCount = (currentSession[resultCol] || 0) + 1;

          await supabase
            .from('trading_sessions_v2')
            .update({
              current_pnl: newPnl,
              trade_count: newTradeCount,
              [resultCol]: newResultCount
            })
            .eq('id', session.id);

          // Broadcast updated session stats to all clients
          if (this.io) {
            const statsPayload = {
              id: session.id,
              current_pnl: newPnl,
              trade_count: newTradeCount,
              win_count: finalPL > 0 ? newResultCount : currentSession.win_count,
              loss_count: finalPL <= 0 ? newResultCount : currentSession.loss_count,
              last_trade_result: finalPL > 0 ? 'win' : 'loss',
              last_trade_pnl: finalPL,
              timestamp: new Date().toISOString()
            };

            this.io.emit('session_update', { session: statsPayload });

            // Also emit a specific stats_update for the user's dashboard performance cards
            this.io.emit('stats_update', {
              userId: tradeResult.userId,
              sessionId: session.id,
              stats: statsPayload
            });
          }
        }
      } catch (statsErr) {
        console.error('[TradeExecutor] Failed to update session stats:', statsErr);
      }

      // Emit Admin Audit Event
      if (this.io) {
        // Calculate latency from signal if available
        let latency = 0;
        if (tradeResult.signal?.generatedAt) {
          latency = new Date(tradeResult.timestamp).getTime() - new Date(tradeResult.signal.generatedAt).getTime();
        }

        this.io.to('admin').emit('trade_audit', {
          contractId: tradeResult.contractId,
          sessionId: session.id,
          userId: tradeResult.userId,
          entrySpot: auditData.entrySpot,
          exitSpot: auditData.exitSpot,
          durationMs: auditData.durationMs,
          executionLatencyMs: latency,
          result: finalPL > 0 ? 'win' : 'loss',
          pnl: finalPL,
          reason,
          timestamp: new Date().toISOString()
        });
      }

      // === QUANT ENGINE LEARNING: Record trade outcome ===
      try {
        const learningWeight = {
          tp_hit: 1.0,
          trailing_stop: 0.6,
          break_even: 0.3,
          time_stop: 0.2,
          sl_hit: 1.0,
          manual_exit: 0.5
        }[reason] || 0.5;

        const tradeDataForLearning = {
          side: tradeResult.signal?.side || 'UNDER',
          won: finalPL > 0,
          digit: tradeResult.signal?.digit,
          confidence: tradeResult.signal?.confidence,
          regime: tradeResult.signal?.regime || 'unknown',
          indicators: tradeResult.signal?.indicatorsUsed || [],
          weight: learningWeight
        };
        quantEngine.recordTradeOutcome(tradeDataForLearning);
        console.log(`[TradeExecutor] 🧠 Learning updated: ${finalPL > 0 ? 'WIN' : 'LOSS'} recorded (W: ${learningWeight})`);
      } catch (learningErr) {
        console.error('[TradeExecutor] Learning callback error:', learningErr.message);
      }

      // Emit trade close event
      if (this.io) {
        this.io.emit('trade_update', {
          type: 'close',
          sessionId: session?.id,  // Add session ID for filtering
          userId: tradeResult.userId,
          contractId: tradeResult.contractId,
          result: finalPL > 0 ? 'win' : 'loss',
          profit: finalPL,
          reason: reason,
          payout: tradeResult.payout,
          stake: tradeResult.stake,
          entrySpot: auditData.entrySpot,
          exitSpot: auditData.exitSpot,
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
   * Get WebSocket connection logic (Delegated to Manager)
   */
  async getConnection(derivAccountId, apiToken) {
    try {
      return await connectionManager.getConnection(apiToken, derivAccountId);
    } catch (error) {
      console.error(`[TradeExecutor] Failed to get connection for ${derivAccountId}:`, error);
      throw error;
    }
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

      // Timeout after configured duration
      setTimeout(() => {
        ws.removeListener('message', messageHandler);
        reject(new Error('Request timeout'));
      }, strategyConfig.requestTimeout || 15000);
    });
  }

  /**
   * Calculate stake based on account balance and session type
   */
  async calculateStake(balance, session, userId, confidence = 0.6) {
    try {
      // 1. Recovery Mode Logic (Overrides everything)
      if (session.session_type === 'recovery') {
        const { data: recoveryState } = await supabase
          .from('recovery_states')
          .select('*')
          .eq('session_id', session.id)
          .single();

        if (recoveryState) {
          const stake = session.initial_stake * (recoveryState.current_multiplier || 1.0);
          return Math.max(strategyConfig.minStake || 0.35, parseFloat(stake.toFixed(2)));
        }
      }

      // 2. Determine Base Stake
      let baseStake = strategyConfig.minStake || 0.35;
      if (session.staking_mode === 'fixed') {
        baseStake = Math.max(strategyConfig.minStake || 0.35, parseFloat(session.initial_stake));
      } else {
        // Percentage Staking
        const percentage = session.stake_percentage || 0.02;
        baseStake = Math.max(strategyConfig.minStake || 0.35, parseFloat((balance * percentage).toFixed(2)));
      }

      // 3. Confidence Weighting (if enabled)
      if (strategyConfig.positionSizing?.enabled) {
        const { baseConfidence, maxMultiplier, minMultiplier } = strategyConfig.positionSizing;

        // Calculate multiplier: (signalConfidence / baseConfidence)
        // e.g. 0.8 / 0.6 = 1.33x stake
        let multiplier = confidence / baseConfidence;

        // Clamp multiplier
        multiplier = Math.max(minMultiplier, Math.min(multiplier, maxMultiplier));

        const weightedStake = baseStake * multiplier;
        console.log(`[TradeExecutor] ⚖️ Sizing: Base $${baseStake} * ${multiplier.toFixed(2)}x (Conf: ${(confidence * 100).toFixed(0)}%) = $${weightedStake.toFixed(2)}`);
        return parseFloat(weightedStake.toFixed(2));
      }

      return baseStake;

    } catch (error) {
      console.error('[TradeExecutor] Calculate stake error:', error);
      return strategyConfig.minStake || 0.35; // Fallback to minimum
    }
  }

  /**
   * Decrypt API token
   */


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
  /**
   * Log trade to database
   */
  async logTrade(tradeResult, sessionId, intentId = null) {
    const { retryOperation } = require('../utils/dbUtils');
    try {
      if (!tradeResult.success) return;

      let executionLatencyMs = null;
      if (tradeResult.signal?.generatedAt) {
        executionLatencyMs = new Date(tradeResult.timestamp) - new Date(tradeResult.signal.generatedAt);
      }

      await retryOperation(async () => {
        let query;

        if (intentId) {
          // Update existing intent record
          query = supabase
            .from('trade_logs')
            .update({
              contract_id: tradeResult.contractId,
              // buy_price: tradeResult.buyPrice, // V2 uses stake, might not have buy_price
              // payout: tradeResult.payout,
              stake: tradeResult.stake,
              result: 'pending', // V2 uses result
              // execution_latency_ms: executionLatencyMs
            })
            .eq('id', intentId);
        } else {
          // Fallback to insert if no intentId provided
          query = supabase
            .from('trade_logs')
            .insert({
              session_id: sessionId,
              account_id: tradeResult.accountId || tradeResult.derivAccountId,
              user_id: tradeResult.userId,
              contract_id: tradeResult.contractId,
              // buy_price: tradeResult.buyPrice,
              // payout: tradeResult.payout,
              stake: tradeResult.stake,
              // signal: tradeResult.signal,
              confidence: tradeResult.signal?.confidence,
              result: 'pending',
              created_at: (tradeResult.timestamp || new Date()).toISOString(),
              // execution_latency_ms: executionLatencyMs
            });
        }

        const { error } = await query;
        if (error) throw error;
      });

    } catch (error) {
      console.error('[TradeExecutor] Log trade error:', error);
      // We don't throw here to avoid crashing the trade flow, but we logged it.
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
    for (const [id, monitor] of this.activeMonitors) {
      if (monitor.timeStopInterval) clearInterval(monitor.timeStopInterval);
      // Remove listeners if needed
      if (monitor.ws && monitor.handler) {
        monitor.ws.removeListener('message', monitor.handler);
      }
    }
    this.activeMonitors.clear();

    // Close all WebSocket connections via Manager
    connectionManager.shutdown();

    console.log('[TradeExecutor] All connections closed');
  }

  getStats() {
    return {
      activeConnections: connectionManager ? connectionManager.activeConnections?.size || 0 : 0,
      activeMonitors: this.activeMonitors ? this.activeMonitors.size : 0
    };
  }

  /**
   * Pause a session due to risk limits
   */
  async pauseSession(sessionId, sessionTable, reason) {
    try {
      console.log(`[TradeExecutor] Pausing session ${sessionId} due to: ${reason}`);

      const { error } = await supabase
        .from(sessionTable)
        .update({
          status: 'paused',
          metadata: { paused_reason: reason, paused_at: new Date().toISOString() }
        })
        .eq('id', sessionId);

      if (error) {
        console.error(`[TradeExecutor] Failed to pause session ${sessionId}:`, error);
      } else {
        // Notify admin/users?
        if (this.io) {
          this.io.emit('session_update', {
            session: { id: sessionId, status: 'paused' }
          });
        }
      }
    } catch (err) {
      console.error('[TradeExecutor] Pause session error:', err);
    }
  }

  /**
   * Evaluate Entry Quality
   * Acts as a risk governor based on session performance and signal context
   */
  evaluateEntry(signal, session) {
    // 1. Confidence floor increases when session is bleeding
    const tradeCount = session.trade_count || 0;
    const winCount = session.win_count || 0;
    const winRate = tradeCount > 0 ? winCount / tradeCount : 1;

    let minConfidence = 0.6; // Base requirement

    // Adaptive Confidence: If performing poorly, require higher quality
    if (tradeCount >= 5 && winRate < 0.45) {
      minConfidence = 0.75;
    }

    if (signal.confidence < minConfidence) {
      return { allow: false, reason: `low_confidence_session_guard (Req: ${minConfidence}, Act: ${signal.confidence.toFixed(2)}, WR: ${(winRate * 100).toFixed(0)}%)` };
    }

    // 2. Loss streak throttle
    // If we have global consecutive losses, be stricter
    if (this.consecutiveLosses >= 2 && signal.confidence < 0.8) {
      return { allow: false, reason: 'loss_streak_throttle' };
    }

    // 3. Regime-strategy compatibility
    if (signal.regime === 'TRANSITION' && signal.confidence < 0.7) {
      return { allow: false, reason: 'regime_transition_guard' };
    }

    // 4. Volatility Guard (Added per request)
    // Check if signal has volatility/stability score. 
    // If stability is too low (high volatility), reject unless confidence is extreme.
    // (Using stability from signal.regimeStats if available, where lower stability = higher volatility)
    if (signal.regimeStats && parseFloat(signal.regimeStats.stability) < 0.3) {
      // High volatility context
      if (signal.confidence < 0.85) {
        return { allow: false, reason: 'volatility_guard' };
      }
    }

    return { allow: true };
  }

  /**
   * Refactored multi-account loop to use parallel batches
   */
  async executeParallelBatches(validAccounts, signal, sessionData, sessionId, lockKey) {
    const batchSize = strategyConfig.system?.batchSize || 10;
    const tradeResults = [];
    const isTurbo = strategyConfig.system.turboMode || sessionData.turbo_mode;

    for (let i = 0; i < validAccounts.length; i += batchSize) {
      const batch = validAccounts.slice(i, i + batchSize);
      console.log(`[TradeExecutor] 🚀 Executing batch ${Math.floor(i / batchSize) + 1} (${batch.length} accounts) - Turbo: ${isTurbo}`);

      const batchPromises = batch.map(async ({ participant, profile, apiToken }) => {
        try {
          let intentId = null;
          let tradeResult = null;

          if (isTurbo) {
            // Turbo Mode: Parallel Execution (Optimistic)
            // We launch both DB log and Trade Execution simultaneously to save RTT
            const [id, result] = await Promise.all([
              this.logIntent(participant, sessionId, signal),
              this.executeSingleTrade(participant, profile, apiToken, signal, sessionData, null) // Pass null as intentId since we don't have it yet
            ]);
            intentId = id;
            tradeResult = result;
          } else {
            // Robust Mode: Serial Execution (Atomicity)
            // We ensure intent is logged BEFORE execution
            intentId = await this.logIntent(participant, sessionId, signal);
            tradeResult = await this.executeSingleTrade(participant, profile, apiToken, signal, sessionData, intentId);
          }

          // 3. Post-Execution Workflow
          if (tradeResult.success) {
            // Update trade with contract ID
            // If parallel, we pass the now-resolved intentId
            await this.logTrade(tradeResult, sessionId, intentId);

            // Audit Log
            auditLogger.log('TRADE_EXECUTED', {
              contractId: tradeResult.contractId,
              stake: tradeResult.stake,
              signal: tradeResult.signal
            }, {
              userId: participant.user_id,
              sessionId
            });

            // Send notification
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

            // Start Monitor
            this.startTPSLMonitor(tradeResult, participant, sessionData, apiToken);

            // Register with Risk Guard
            riskEngine.registerTrade({ contractId: tradeResult.contractId, market: tradeResult.market || signal.market });
          } else {
            // Log failed trade attempt
            tradeResult.success = false;
            tradeResult.userId = participant.user_id;
            tradeResult.error = tradeResult.error || 'Execution failed';
          }

          return tradeResult;
        } catch (error) {
          console.error(`[TradeExecutor] Batch trade error for user ${participant.user_id}:`, error);
          return { success: false, userId: participant.user_id, error: error.message };
        }
      });

      const results = await Promise.all(batchPromises);
      tradeResults.push(...results);

      // Turbo: Reduced delay (100ms), Robust: Normal delay (500ms)
      if (i + batchSize < validAccounts.length) {
        const delay = isTurbo ? 100 : (strategyConfig.system?.batchDelay || 500);
        await this.sleep(delay);
      }
    }

    return tradeResults;
  }

  /**
   * Log a trade intent before sending to Deriv
   */
  async logIntent(participant, sessionId, signal) {
    try {
      const { data, error } = await supabase
        .from('trade_logs')
        .insert({
          session_id: sessionId,
          account_id: participant.deriv_account_id,
          user_id: participant.user_id,
          result: 'pending',
          confidence: signal?.confidence,
          stake: 0,
          created_at: new Date().toISOString()
        })
        .select('id')
        .single();

      if (error) {
        console.warn('[TradeExecutor] Intent logging DB error:', error.message);
        return null; // Don't block trade if DB is just slow, but we've warned
      }
      return data.id;
    } catch (err) {
      console.error('[TradeExecutor] Intent logging fatal error:', err.message);
      return null;
    }
  }

  /**
   * Update trade intent with real contract ID
   */
  async updateTradeWithContract(tradeId, contractId) {
    try {
      await supabase
        .from('trade_logs')
        .update({ contract_id: contractId, result: 'pending' })
        .eq('id', tradeId);
    } catch (err) {
      console.error('[TradeExecutor] Failed to update trade intent:', err.message);
    }
  }
}

module.exports = new TradeExecutor();
