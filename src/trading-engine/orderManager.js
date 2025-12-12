/**
 * Order Manager - Consumes trade signals and coordinates execution
 * Bridges the message queue to the trade executor
 */
const { messageQueue, TOPICS } = require('../queue');
const tradeExecutor = require('../services/tradeExecutor');
const { createTradeExecutedEvent, createTradeClosedEvent, EVENT_TYPES } = require('./eventContract');

class OrderManager {
    constructor() {
        this.isRunning = false;
        this.io = null;
        this.processedSignals = 0;
        this.failedSignals = 0;
    }

    /**
     * Set Socket.IO instance
     */
    setSocket(io) {
        this.io = io;
        tradeExecutor.setSocket(io);
    }

    /**
     * Start consuming signals from queue
     */
    async start() {
        if (this.isRunning) return;
        this.isRunning = true;

        console.log('[OrderManager] Starting signal consumer...');

        // Subscribe to trade signals queue
        await messageQueue.subscribe(TOPICS.TRADE_SIGNALS, async (signalEvent) => {
            await this.processSignal(signalEvent);
        });

        console.log('[OrderManager] Started, consuming from trade:signals');
    }

    /**
     * Process a signal event from the queue
     */
    async processSignal(signalEvent) {
        const { id, payload, sessionId, correlationId, sessionTable } = signalEvent;

        console.log(`[OrderManager] Processing signal ${id} for session ${sessionId}`);

        try {
            // Reconstruct signal object for executor
            const signal = {
                market: payload.symbol,
                side: payload.direction,
                digit: payload.digit,
                confidence: payload.confidence,
                analysis: payload.analysis
            };

            // Execute the trade
            const result = await tradeExecutor.executeMultiAccountTrade(
                signal,
                sessionId,
                sessionTable || 'trading_sessions'  // V1 table is the default
            );

            this.processedSignals++;

            // Publish trade executed events for each successful trade
            if (result && result.results) {
                for (const trade of result.results) {
                    const tradeEvent = createTradeExecutedEvent(trade, {
                        sessionId,
                        userId: trade.user_id,
                        correlationId
                    });
                    await messageQueue.publish(TOPICS.TRADE_EXECUTED, tradeEvent);
                }
            }

            console.log(`[OrderManager] Signal ${id} processed successfully`);

        } catch (error) {
            this.failedSignals++;
            console.error(`[OrderManager] Failed to process signal ${id}:`, error.message);

            // Could publish a signal_failed event here for monitoring
        }
    }

    /**
     * Publish trade closed event (called by tradeExecutor)
     */
    async publishTradeClosed(trade, reason, finalPL, context) {
        if (!messageQueue.isReady()) return;

        const event = createTradeClosedEvent(trade, reason, finalPL, context);
        await messageQueue.publish(TOPICS.TRADE_CLOSED, event);
    }

    /**
     * Stop the order manager
     */
    async stop() {
        this.isRunning = false;
        await messageQueue.unsubscribe(TOPICS.TRADE_SIGNALS);
        console.log('[OrderManager] Stopped');
    }

    /**
     * Get stats
     */
    getStats() {
        return {
            isRunning: this.isRunning,
            processedSignals: this.processedSignals,
            failedSignals: this.failedSignals
        };
    }
}

// Singleton
const orderManager = new OrderManager();

module.exports = orderManager;
