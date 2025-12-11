/**
 * Notification Worker - Dispatches notifications with delivery confirmation
 * Consumes from notifications stream, delivers via Socket.IO
 */
const { messageQueue, TOPICS } = require('../queue');
const { supabase } = require('../db/supabase');

class NotificationWorker {
    constructor() {
        this.io = null;
        this.isRunning = false;
        this.delivered = 0;
        this.failed = 0;
    }

    /**
     * Initialize with Socket.IO instance
     */
    setSocket(io) {
        this.io = io;
    }

    /**
     * Start the worker
     */
    async start() {
        if (this.isRunning) return;
        this.isRunning = true;

        console.log('[NotificationWorker] Starting...');

        await messageQueue.subscribe(TOPICS.NOTIFICATIONS, async (event) => {
            await this.handleNotification(event);
        });

        // Also listen for trade events to send notifications
        await messageQueue.subscribe(TOPICS.TRADE_EXECUTED, async (event) => {
            await this.notifyTradeExecuted(event);
        });

        await messageQueue.subscribe(TOPICS.TRADE_CLOSED, async (event) => {
            await this.notifyTradeClosed(event);
        });

        console.log('[NotificationWorker] Started');
    }

    /**
     * Handle notification event
     */
    async handleNotification(event) {
        const { payload, userId } = event;

        try {
            // Save to database
            await supabase.from('notifications').insert({
                user_id: userId,
                title: payload.title,
                message: payload.message,
                type: payload.type,
                data: payload.data,
                read: false,
                created_at: new Date(event.timestamp).toISOString()
            });

            // Emit via Socket.IO
            if (this.io) {
                this.io.to(`user:${userId}`).emit('notification', {
                    id: event.id,
                    ...payload
                });
                this.delivered++;
            }

            console.log(`[NotificationWorker] Delivered to ${userId}: ${payload.title}`);
        } catch (error) {
            this.failed++;
            console.error(`[NotificationWorker] Failed:`, error.message);
        }
    }

    /**
     * Notify user about trade execution
     */
    async notifyTradeExecuted(event) {
        const { payload, sessionId, userId } = event;

        if (!userId) return;

        const notification = {
            title: 'Trade Executed',
            message: `${payload.direction} trade opened on ${payload.symbol} - Stake: $${payload.stake}`,
            type: 'trade_executed',
            data: {
                contractId: payload.contractId,
                symbol: payload.symbol,
                stake: payload.stake,
                sessionId
            }
        };

        await this.sendToUser(userId, notification);
    }

    /**
     * Notify user about trade closure
     */
    async notifyTradeClosed(event) {
        const { payload, userId } = event;

        if (!userId) return;

        const isWin = payload.profitLoss > 0;
        const notification = {
            title: isWin ? '🎉 Trade Won!' : '📉 Trade Lost',
            message: `${payload.symbol} closed: ${isWin ? '+' : ''}$${payload.profitLoss.toFixed(2)} (${payload.closeReason})`,
            type: 'trade_closed',
            data: {
                contractId: payload.contractId,
                profitLoss: payload.profitLoss,
                reason: payload.closeReason
            }
        };

        await this.sendToUser(userId, notification);
    }

    /**
     * Send notification to specific user
     */
    async sendToUser(userId, notification) {
        try {
            // Save
            await supabase.from('notifications').insert({
                user_id: userId,
                title: notification.title,
                message: notification.message,
                type: notification.type,
                data: notification.data,
                read: false
            });

            // Emit
            if (this.io) {
                this.io.to(`user:${userId}`).emit('notification', notification);
                this.delivered++;
            }
        } catch (error) {
            this.failed++;
            console.error(`[NotificationWorker] Send failed:`, error.message);
        }
    }

    /**
     * Broadcast to all connected users
     */
    broadcast(notification) {
        if (this.io) {
            this.io.emit('notification', notification);
        }
    }

    /**
     * Stop the worker
     */
    async stop() {
        this.isRunning = false;
        await messageQueue.unsubscribe(TOPICS.NOTIFICATIONS);
        console.log('[NotificationWorker] Stopped');
    }

    /**
     * Get stats
     */
    getStats() {
        return {
            isRunning: this.isRunning,
            delivered: this.delivered,
            failed: this.failed
        };
    }
}

module.exports = new NotificationWorker();
