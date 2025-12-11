/**
 * DB Worker - Persists trade events to database with retry logic
 * Consumes from trade:executed and trade:closed streams
 */
const { messageQueue, TOPICS } = require('../queue');
const { supabase } = require('../db/supabase');

class DBWorker {
    constructor() {
        this.isRunning = false;
        this.retryQueue = []; // Failed inserts to retry
        this.maxRetries = 3;
        this.retryDelayMs = 5000;
    }

    /**
     * Start the worker
     */
    async start() {
        if (this.isRunning) return;
        this.isRunning = true;

        console.log('[DBWorker] Starting...');

        // Subscribe to trade events
        await messageQueue.subscribe(TOPICS.TRADE_EXECUTED, async (event) => {
            await this.handleTradeExecuted(event);
        });

        await messageQueue.subscribe(TOPICS.TRADE_CLOSED, async (event) => {
            await this.handleTradeClosed(event);
        });

        // Start retry processor
        this.startRetryProcessor();

        console.log('[DBWorker] Started, listening for trade events');
    }

    /**
     * Handle trade executed event
     */
    async handleTradeExecuted(event) {
        const { payload, sessionId, correlationId } = event;

        try {
            const { error } = await supabase.from('trades').insert({
                session_id: sessionId,
                user_id: payload.participantId,
                contract_id: payload.contractId,
                symbol: payload.symbol,
                direction: payload.direction,
                stake: payload.stake,
                entry_price: payload.entryPrice,
                status: 'open',
                correlation_id: correlationId,
                created_at: new Date(event.timestamp).toISOString()
            });

            if (error) {
                throw error;
            }

            console.log(`[DBWorker] Trade persisted: ${payload.contractId}`);
        } catch (error) {
            console.error(`[DBWorker] Failed to persist trade:`, error.message);
            this.queueForRetry({ type: 'trade_executed', event, retryCount: 0 });
        }
    }

    /**
     * Handle trade closed event
     */
    async handleTradeClosed(event) {
        const { payload } = event;

        try {
            const { error } = await supabase
                .from('trades')
                .update({
                    profit_loss: payload.profitLoss,
                    status: payload.closeReason === 'TP_REACHED' ? 'tp_hit' :
                        payload.closeReason === 'SL_REACHED' ? 'sl_hit' :
                            payload.profitLoss > 0 ? 'win' : 'loss',
                    closed_at: new Date(event.timestamp).toISOString()
                })
                .eq('contract_id', payload.contractId);

            if (error) {
                throw error;
            }

            // Update participant PnL
            await this.updateParticipantPnL(payload.participantId, payload.profitLoss);

            console.log(`[DBWorker] Trade closed: ${payload.contractId} (${payload.closeReason})`);
        } catch (error) {
            console.error(`[DBWorker] Failed to update trade:`, error.message);
            this.queueForRetry({ type: 'trade_closed', event, retryCount: 0 });
        }
    }

    /**
     * Update participant running PnL
     */
    async updateParticipantPnL(participantId, profitLoss) {
        try {
            // Get current PnL
            const { data: participant } = await supabase
                .from('session_participants')
                .select('current_pnl')
                .eq('id', participantId)
                .single();

            if (participant) {
                await supabase
                    .from('session_participants')
                    .update({
                        current_pnl: (participant.current_pnl || 0) + profitLoss
                    })
                    .eq('id', participantId);
            }
        } catch (error) {
            console.error(`[DBWorker] Failed to update participant PnL:`, error.message);
        }
    }

    /**
     * Queue failed operation for retry
     */
    queueForRetry(item) {
        if (item.retryCount < this.maxRetries) {
            item.retryCount++;
            item.retryAt = Date.now() + (this.retryDelayMs * item.retryCount);
            this.retryQueue.push(item);
            console.log(`[DBWorker] Queued for retry (attempt ${item.retryCount})`);
        } else {
            console.error(`[DBWorker] Max retries exceeded, dropping event:`, item.event.id);
        }
    }

    /**
     * Process retry queue
     */
    startRetryProcessor() {
        setInterval(async () => {
            const now = Date.now();
            const readyItems = this.retryQueue.filter(item => item.retryAt <= now);
            this.retryQueue = this.retryQueue.filter(item => item.retryAt > now);

            for (const item of readyItems) {
                if (item.type === 'trade_executed') {
                    await this.handleTradeExecuted(item.event);
                } else if (item.type === 'trade_closed') {
                    await this.handleTradeClosed(item.event);
                }
            }
        }, this.retryDelayMs);
    }

    /**
     * Stop the worker
     */
    async stop() {
        this.isRunning = false;
        await messageQueue.unsubscribe(TOPICS.TRADE_EXECUTED);
        await messageQueue.unsubscribe(TOPICS.TRADE_CLOSED);
        console.log('[DBWorker] Stopped');
    }

    /**
     * Get worker stats
     */
    getStats() {
        return {
            isRunning: this.isRunning,
            retryQueueSize: this.retryQueue.length
        };
    }
}

module.exports = new DBWorker();
